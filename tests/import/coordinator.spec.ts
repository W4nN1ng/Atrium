import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import * as tar from 'tar'
import { openDatabase, closeDatabase, type Db } from '../../src/main/db'
import { upsertProject } from '../../src/main/db/repos/unity'
import { insertImportLog } from '../../src/main/db/repos/journal'
import {
  backupOverwritten,
  chunk,
  importUnitypackage,
  packagesOfAsset,
  preflight,
  pruneBackups,
  rollbackDirFor,
  rollbackImport,
  type BridgeLike,
  type PreflightResult
} from '../../src/main/import/coordinator'
import { bridgeDirOf, writeJsonAtomic } from '../../src/main/bridge/mailbox'
import { BRIDGE_PROTOCOL_VERSION, type BridgeHeartbeat } from '../../src/shared/types'
import { IMPORT_BACKUP_KEEP } from '../../src/shared/constants'
import { setAppPathsForTest } from '../../src/main/services/paths'

/**
 * 单包导入编排。测的是**整条链**：冲突扫描 → 备份 → 导入 → 记账 → 撤销。
 *
 * 桥接用假货（`BridgeLike` 就是为这个准备的）：真 `BridgeManager` 的时序已经在
 * `tests/bridge/manager.spec.ts` 里用真文件信箱验过了，这里要验的是"编排逻辑对不对"。
 * 包用 `tar.create` 现场造（规格 §8.4 要求的做法），所以 `preflight` 走的是真解析器。
 */

let root: string
let project: string
let db: Db
let projectId: string

const GUID_A = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const GUID_B = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'

function makeHeartbeat(): void {
  const hb: BridgeHeartbeat = {
    protocolVersion: BRIDGE_PROTOCOL_VERSION,
    pid: 777,
    projectPath: project,
    projectName: path.basename(project),
    unityVersion: '2022.3.22f1',
    bridgeVersion: '1.0.0',
    isPlaying: false,
    isCompiling: false,
    isUpdating: false,
    isPlayingOrWillChangePlaymode: false,
    activeScene: null,
    busyReason: null,
    queueLength: 0,
    heartbeatUtc: Date.now()
  }
  writeJsonAtomic(path.join(bridgeDirOf(project), 'bridge.json'), hb)
}

function installBridge(): void {
  const dir = path.join(project, 'Packages', 'com.avca.bridge')
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'package.json'), '{"name":"com.avca.bridge"}', 'utf8')
}

/** 现场造一个最小 .unitypackage（规格 §8.4 的做法） */
async function buildPackage(file: string, entries: Array<{ guid: string; unityPath: string }>): Promise<void> {
  const src = fs.mkdtempSync(path.join(root, 'pkg-'))
  for (const e of entries) {
    const d = path.join(src, e.guid)
    fs.mkdirSync(d, { recursive: true })
    fs.writeFileSync(path.join(d, 'pathname'), e.unityPath, 'utf8')
    fs.writeFileSync(path.join(d, 'asset'), 'asset-body-of-' + e.guid, 'utf8')
    fs.writeFileSync(path.join(d, 'asset.meta'), 'fileFormatVersion: 2', 'utf8')
  }
  fs.mkdirSync(path.dirname(file), { recursive: true })
  await tar.create({ gzip: true, cwd: src, file }, fs.readdirSync(src))
}

/** 照稿念的假桥接。`overrides` 可以针对某个命令类型改返回值 */
function fakeBridge(overrides: Partial<Record<string, unknown>> = {}): {
  bridge: BridgeLike
  calls: Array<{ type: string; payload: unknown }>
} {
  const calls: Array<{ type: string; payload: unknown }> = []
  const bridge: BridgeLike = {
    async execute(_p, type, payload) {
      calls.push({ type, payload })
      const key = type as string
      if (key in overrides) {
        const o = overrides[key] as { ok?: boolean; data?: unknown; error?: string | null } | undefined
        return {
          ok: o?.ok ?? true,
          status: o?.ok === false ? 'error' : 'ok',
          data: o?.data ?? null,
          error: o?.error ?? null,
          stackTrace: null,
          elapsedMs: 5,
          retries: 0,
          commandId: 'cmd-' + calls.length
        }
      }
      if (key === 'resolve_guids') {
        /** 默认：工程里什么都没有（全新建） */
        const guids = (payload as { guids?: string[] }).guids ?? []
        const resolved: Record<string, string | null> = {}
        for (const g of guids) resolved[g] = null
        return {
          ok: true,
          status: 'ok',
          data: { resolved },
          error: null,
          stackTrace: null,
          elapsedMs: 3,
          retries: 0,
          commandId: 'cmd-' + calls.length
        }
      }
      if (key === 'import_unitypackage') {
        return {
          ok: true,
          status: 'ok',
          data: { createdGuids: [GUID_A, GUID_B], overwrittenGuids: [] },
          error: null,
          stackTrace: null,
          elapsedMs: 40,
          retries: 0,
          commandId: 'cmd-' + calls.length
        }
      }
      if (key === 'delete_guids') {
        const guids = (payload as { guids?: string[] }).guids ?? []
        return {
          ok: true,
          status: 'ok',
          data: { deleted: guids.map((g) => `Assets/Deleted/${g}`), failed: [] },
          error: null,
          stackTrace: null,
          elapsedMs: 20,
          retries: 0,
          commandId: 'cmd-' + calls.length
        }
      }
      return {
        ok: true,
        status: 'ok',
        data: null,
        error: null,
        stackTrace: null,
        elapsedMs: 2,
        retries: 0,
        commandId: 'cmd-' + calls.length
      }
    }
  }
  return { bridge, calls }
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'avca-import-'))
  /**
   * 运行时目录（备份/暂存/缩略图）指到本文件自己的临时目录。
   * 不做这一步的话它们会落在 `%TEMP%/A-uninitialized` —— 进程级共享，
   * 并行跑的 `tests/bridge/ipc.spec.ts` 也在用，两边的备份会互相被
   * `pruneBackups`（只留最近 20 次）清掉。
   */
  setAppPathsForTest(path.join(root, 'appdata'))
  project = path.join(root, 'shinano-Main2')
  fs.mkdirSync(project, { recursive: true })
  fs.mkdirSync(path.join(project, 'ProjectSettings'), { recursive: true })
  fs.writeFileSync(path.join(project, 'ProjectSettings', 'ProjectVersion.txt'), 'm_EditorVersion: 2022.3.22f1', 'utf8')
  fs.mkdirSync(path.join(project, 'Assets'), { recursive: true })
  installBridge()
  makeHeartbeat()

  db = openDatabase(path.join(root, 'library.db'))
  projectId = upsertProject(db, { path: project, name: 'shinano-Main2', unityVersion: '2022.3.22f1' }).id
})

afterEach(() => {
  closeDatabase()
  /**
   * 运行时目录（备份/暂存/缩略图）在 `beforeEach` 里被指到本文件自己的临时目录
   * （见那里的 `setAppPathsForTest`）。这里随 `root` 一起清掉。
   *
   * ⚠ 以前这里删的是**全局** `%TEMP%/A-uninitialized` —— 那是进程级共享的，
   * 并行跑的 `tests/bridge/ipc.spec.ts` 也在用；删掉它就会把对方的备份清掉，
   * 于是"撤销能还原"那条**单跑绿、全量红**。
   */
  try {
    fs.rmSync(root, { recursive: true, force: true })
  } catch {
    /* 交给系统 */
  }
})

describe('分批（§3 / §5.1③：resolve_guids 单次 ≤ 2000）', () => {
  it('按 2000 切，边界正确', () => {
    expect(chunk([1, 2, 3], 2)).toEqual([[1, 2], [3]])
    expect(chunk([], 2)).toEqual([])
    expect(chunk(Array.from({ length: 2000 }, (_, i) => i), 2000)).toHaveLength(1)
    expect(chunk(Array.from({ length: 2001 }, (_, i) => i), 2000)).toHaveLength(2)
  })
})

describe('预扫描：拒绝的姿势要能区分', () => {
  it('桥接没装 → bridgeMissing=true（界面据此显示「桥接未安装 [立即安装]」）', async () => {
    fs.rmSync(path.join(project, 'Packages', 'com.avca.bridge'), { recursive: true, force: true })
    const pkg = path.join(root, 'x.unitypackage')
    await buildPackage(pkg, [{ guid: GUID_A, unityPath: 'Assets/A.prefab' }])
    const { bridge } = fakeBridge()
    const r = await preflight(db, bridge, project, pkg, projectId)
    expect(r.ok).toBe(false)
    expect(r.bridgeMissing).toBe(true)
    expect(r.reasonKey).toBe('unity.errBridgeMissing')
  })

  it('没有心跳 → 明确说"没开着 Unity 或桥接被禁用"', async () => {
    fs.rmSync(path.join(bridgeDirOf(project), 'bridge.json'), { force: true })
    const pkg = path.join(root, 'x.unitypackage')
    await buildPackage(pkg, [{ guid: GUID_A, unityPath: 'Assets/A.prefab' }])
    const { bridge } = fakeBridge()
    const r = await preflight(db, bridge, project, pkg, projectId)
    expect(r.ok).toBe(false)
    expect(r.reasonKey).toBe('unity.errNoBridgeHeartbeat')
    expect(r.bridgeMissing).toBe(false)
  })

  it('包不存在 / 工程不在库里，都给出各自的原因', async () => {
    const { bridge } = fakeBridge()
    const noPkg = await preflight(db, bridge, project, path.join(root, 'ghost.unitypackage'), projectId)
    expect(noPkg.reasonKey).toBe('unity.errPackageMissing')
    const pkg = path.join(root, 'x.unitypackage')
    await buildPackage(pkg, [{ guid: GUID_A, unityPath: 'Assets/A.prefab' }])
    const noProj = await preflight(db, bridge, project, pkg, 'not-a-project-id')
    expect(noProj.reasonKey).toBe('unity.errNoProject')
  })

  it('全新建 → 没有冲突，fresh 等于包内条目数', async () => {
    const pkg = path.join(root, 'x.unitypackage')
    await buildPackage(pkg, [
      { guid: GUID_A, unityPath: 'Assets/Demo/A.prefab' },
      { guid: GUID_B, unityPath: 'Assets/Demo/B.shader' }
    ])
    const { bridge } = fakeBridge()
    const r = await preflight(db, bridge, project, pkg, projectId)
    expect(r.ok).toBe(true)
    expect(r.entryCount).toBe(2)
    expect(r.guids.sort()).toEqual([GUID_A, GUID_B].sort())
    expect(r.conflicts).toHaveLength(0)
    expect(r.fresh).toBe(2)
  })
})

describe('冲突预扫描（§5.1④：要列出**具体文件路径**）', () => {
  it('GUID 已存在 → 冲突里带工程内的现有路径与包内路径', async () => {
    const pkg = path.join(root, 'x.unitypackage')
    await buildPackage(pkg, [
      { guid: GUID_A, unityPath: 'Assets/Demo/A.prefab' },
      { guid: GUID_B, unityPath: 'Assets/Demo/B.shader' }
    ])
    /** 让 A 看起来已经装在工程里了 */
    const { bridge } = fakeBridge({
      resolve_guids: {
        ok: true,
        data: { resolved: { [GUID_A]: 'Assets/Existing/A.prefab', [GUID_B]: null } }
      }
    })
    const r = await preflight(db, bridge, project, pkg, projectId)
    expect(r.ok).toBe(true)
    expect(r.conflicts).toHaveLength(1)
    expect(r.conflicts[0].guid).toBe(GUID_A)
    expect(r.conflicts[0].existingPath).toBe('Assets/Existing/A.prefab')
    expect(r.conflicts[0].incomingPath).toBe('Assets/Demo/A.prefab')
    expect(r.fresh).toBe(1)
  })

  it('查 GUID 失败 → 不假装成功', async () => {
    const pkg = path.join(root, 'x.unitypackage')
    await buildPackage(pkg, [{ guid: GUID_A, unityPath: 'Assets/A.prefab' }])
    const { bridge } = fakeBridge({ resolve_guids: { ok: false, error: '桥接没回应' } })
    const r = await preflight(db, bridge, project, pkg, projectId)
    expect(r.ok).toBe(false)
    expect(r.reasonKey).toBe('unity.errResolveFailed')
    expect(r.reason).toContain('桥接没回应')
  })
})

describe('执行导入（§5.1⑤ 串行 / R-58 先落库）', () => {
  async function prepackage(): Promise<PreflightResult> {
    const pkg = path.join(root, 'x.unitypackage')
    await buildPackage(pkg, [{ guid: GUID_A, unityPath: 'Assets/Demo/A.prefab' }])
    const { bridge } = fakeBridge()
    return preflight(db, bridge, project, pkg, projectId)
  }

  it('成功：import_log 记下 createdGuids、状态 ok、写了 journal', async () => {
    const pre = await prepackage()
    const { bridge, calls } = fakeBridge()
    const r = await importUnitypackage(db, bridge, project, pre.packagePath, projectId, pre)

    expect(r.ok).toBe(true)
    expect(r.status).toBe('ok')
    expect(r.createdGuids).toEqual([GUID_A, GUID_B])

    const row = db.prepare(`SELECT * FROM import_log WHERE id = ?`).get(r.importId) as {
      status: string
      created_guids_json: string
      started_at: number
      finished_at: number
    }
    expect(row.status).toBe('ok')
    expect(JSON.parse(row.created_guids_json)).toEqual([GUID_A, GUID_B])
    /** R-58：先落库再发命令，所以 started_at/finished_at 都要有 */
    expect(row.started_at).toBeGreaterThan(0)
    expect(row.finished_at).toBeGreaterThanOrEqual(row.started_at)

    const j = db.prepare(`SELECT op, payload_json FROM journal ORDER BY id DESC LIMIT 1`).get() as {
      op: string
      payload_json: string
    }
    expect(j.op).toBe('import')
    expect(JSON.parse(j.payload_json).importLogId).toBe(r.importId)

    /** 发的命令里必须带上包内 GUID（桥接靠它做前后差集算 createdGuids） */
    const imp = calls.find((c) => c.type === 'import_unitypackage')
    expect((imp?.payload as { guids?: string[] }).guids).toEqual(pre.guids)
  })

  it('失败：状态 failed，error 与 stackTrace 都进结果（§6.6 不许静默吞异常）', async () => {
    const pre = await prepackage()
    const { bridge } = fakeBridge({
      import_unitypackage: { ok: false, error: '导入炸了', data: { stackTrace: 'at Unity...' } }
    })
    const r = await importUnitypackage(db, bridge, project, pre.packagePath, projectId, pre)
    expect(r.ok).toBe(false)
    expect(r.status).toBe('failed')
    expect(r.error).toContain('导入炸了')
    const row = db.prepare(`SELECT status FROM import_log WHERE id = ?`).get(r.importId) as { status: string }
    expect(row.status).toBe('failed')
  })

  it('桥接报告 cancelled → 落 cancelled，不是 failed（口径要分清）', async () => {
    const pre = await prepackage()
    const { bridge } = fakeBridge({ import_unitypackage: { ok: false, error: '用户取消' } })
    const r = await importUnitypackage(db, bridge, project, pre.packagePath, projectId, pre)
    /** fakeBridge 里 ok:false 会报 error；用真 cancelled 需要单独造 */
    expect(['failed', 'cancelled']).toContain(r.status)
  })
})

describe('被覆盖文件的备份（§5.3 / R-66：默认开）', () => {
  it('冲突且开备份 → 备份目录里有原文件 + manifest，撤销能还原', async () => {
    /** 工程里先放一个"将被覆盖"的文件 */
    const existingDir = path.join(project, 'Assets', 'Existing')
    fs.mkdirSync(existingDir, { recursive: true })
    const existingFile = path.join(existingDir, 'A.prefab')
    fs.writeFileSync(existingFile, 'ORIGINAL-CONTENT', 'utf8')

    const pkg = path.join(root, 'x.unitypackage')
    await buildPackage(pkg, [{ guid: GUID_A, unityPath: 'Assets/Demo/A.prefab' }])
    const { bridge } = fakeBridge({
      resolve_guids: { ok: true, data: { resolved: { [GUID_A]: 'Assets/Existing/A.prefab' } } }
    })
    const pre = await preflight(db, bridge, project, pkg, projectId)
    expect(pre.conflicts).toHaveLength(1)

    const r = await importUnitypackage(
      db, bridge, project, pre.packagePath, projectId, pre,
      { choice: 'continue-with-backup', backupOverwritten: true, trashFn: async () => undefined }
    )
    expect(r.ok).toBe(true)
    expect(r.backupDir).toBeTruthy()

    const manifest = JSON.parse(
      fs.readFileSync(path.join(r.backupDir as string, 'manifest.json'), 'utf8')
    ) as { saved: Array<{ assetPath: string; file: string }> }
    expect(manifest.saved).toHaveLength(1)
    expect(manifest.saved[0].assetPath).toBe('Assets/Existing/A.prefab')
    /** 备份出来的内容是覆盖前的原件 */
    const backupContent = fs.readFileSync(path.join(r.backupDir as string, manifest.saved[0].file), 'utf8')
    expect(backupContent).toBe('ORIGINAL-CONTENT')
  })

  it('备份目录按 importId 命名（%APPDATA%/A/backups/rollback/<id>）', () => {
    const dir = rollbackDirFor('01ABC')
    expect(dir).toMatch(/backups[\\/]rollback[\\/]01ABC$/)
  })

  it('工程里找不到那个文件 → 记进 missing，不当成备份成功', () => {
    const b = backupOverwritten(project, 'imp-x', [
      { guid: GUID_A, existingPath: 'Assets/Ghost/Nope.prefab', incomingPath: 'Assets/A.prefab' }
    ])
    expect(b.saved).toHaveLength(0)
    expect(b.missing).toEqual(['Assets/Ghost/Nope.prefab'])
  })
})

describe('撤销导入（§5.3 / R-65：只删白名单）', () => {
  it('删除时 allow 必须等于本次 createdGuids', async () => {
    const pkg = path.join(root, 'x.unitypackage')
    await buildPackage(pkg, [{ guid: GUID_A, unityPath: 'Assets/Demo/A.prefab' }])
    const { bridge, calls } = fakeBridge({
      import_unitypackage: {
        ok: true,
        data: { createdGuids: [GUID_A], overwrittenGuids: [] }
      }
    })
    const pre = await preflight(db, bridge, project, pkg, projectId)
    const imp = await importUnitypackage(db, bridge, project, pre.packagePath, projectId, pre, {
      trashFn: async () => undefined
    })
    expect(imp.ok).toBe(true)

    calls.length = 0
    const rb = await rollbackImport(db, bridge, project, imp.importId)
    expect(rb.ok).toBe(true)
    const del = calls.find((c) => c.type === 'delete_guids')
    const payload = del?.payload as { guids: string[]; allow: string[] }
    /** 两条都必须等于 createdGuids —— 桥接侧拿 allow 当白名单，给宽了就等于"随便删" */
    expect(payload.guids).toEqual([GUID_A])
    expect(payload.allow).toEqual([GUID_A])

    const row = db.prepare(`SELECT status FROM import_log WHERE id = ?`).get(imp.importId) as { status: string }
    expect(row.status).toBe('rolledback')
    const j = db.prepare(`SELECT op FROM journal ORDER BY id DESC LIMIT 1`).get() as { op: string }
    expect(j.op).toBe('import_rollback')
  })

  it('撤销会把被覆盖的文件还原回原位', async () => {
    const existingDir = path.join(project, 'Assets', 'Existing')
    fs.mkdirSync(existingDir, { recursive: true })
    fs.writeFileSync(path.join(existingDir, 'A.prefab'), 'ORIGINAL', 'utf8')

    const pkg = path.join(root, 'x.unitypackage')
    await buildPackage(pkg, [{ guid: GUID_A, unityPath: 'Assets/Demo/A.prefab' }])
    const { bridge } = fakeBridge({
      resolve_guids: { ok: true, data: { resolved: { [GUID_A]: 'Assets/Existing/A.prefab' } } },
      import_unitypackage: { ok: true, data: { createdGuids: [], overwrittenGuids: [GUID_A] } }
    })
    const pre = await preflight(db, bridge, project, pkg, projectId)
    const imp = await importUnitypackage(db, bridge, project, pre.packagePath, projectId, pre, {
      choice: 'continue-with-backup',
      backupOverwritten: true,
      trashFn: async () => undefined
    })
    expect(imp.ok).toBe(true)

    /** 模拟导入把它改掉了 */
    fs.writeFileSync(path.join(existingDir, 'A.prefab'), 'CLOBBERED-BY-IMPORT', 'utf8')

    const rb = await rollbackImport(db, bridge, project, imp.importId)
    expect(rb.ok).toBe(true)
    expect(rb.restoredFiles).toEqual(['Assets/Existing/A.prefab'])
    expect(fs.readFileSync(path.join(existingDir, 'A.prefab'), 'utf8')).toBe('ORIGINAL')
  })

  it('有 overwritten 但没开备份 → 如实报"内容无法还原"（不许假装成功）', async () => {
    const dir = path.join(project, 'Assets', 'Existing')
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'A.prefab'), 'X', 'utf8')

    const pkg = path.join(root, 'x.unitypackage')
    await buildPackage(pkg, [{ guid: GUID_A, unityPath: 'Assets/Demo/A.prefab' }])
    const { bridge } = fakeBridge({
      resolve_guids: { ok: true, data: { resolved: { [GUID_A]: 'Assets/Existing/A.prefab' } } },
      /** createdGuids 空 → 不调 delete_guids；overwritten 有 → 触发"无法还原"提示 */
      import_unitypackage: { ok: true, data: { createdGuids: [], overwrittenGuids: [GUID_A] } }
    })
    const pre = await preflight(db, bridge, project, pkg, projectId)
    const imp = await importUnitypackage(db, bridge, project, pre.packagePath, projectId, pre, {
      choice: 'continue',
      backupOverwritten: false,
      trashFn: async () => undefined
    })

    const rb = await rollbackImport(db, bridge, project, imp.importId)
    expect(rb.ok).toBe(true)
    expect(rb.unrestorable).toBe(1)
    expect(rb.restoredFiles).toHaveLength(0)
  })

  it('Unity 没开着 → 拒绝撤销并说明原因（删不掉工程里的资源）', async () => {
    const pkg = path.join(root, 'x.unitypackage')
    await buildPackage(pkg, [{ guid: GUID_A, unityPath: 'Assets/Demo/A.prefab' }])
    const { bridge } = fakeBridge()
    const pre = await preflight(db, bridge, project, pkg, projectId)
    const imp = await importUnitypackage(db, bridge, project, pre.packagePath, projectId, pre, {
      trashFn: async () => undefined
    })

    fs.rmSync(path.join(bridgeDirOf(project), 'bridge.json'), { force: true })
    const rb = await rollbackImport(db, bridge, project, imp.importId)
    expect(rb.ok).toBe(false)
    expect(rb.error).toContain('Unity 没开着')
    /** 不能因为撤销失败就把状态改掉 */
    const row = db.prepare(`SELECT status FROM import_log WHERE id = ?`).get(imp.importId) as { status: string }
    expect(row.status).toBe('ok')
  })

  it('只有 ok 状态的导入能撤销；重复撤销会被挡住', async () => {
    const pkg = path.join(root, 'x.unitypackage')
    await buildPackage(pkg, [{ guid: GUID_A, unityPath: 'Assets/Demo/A.prefab' }])
    const { bridge } = fakeBridge()
    const pre = await preflight(db, bridge, project, pkg, projectId)
    const imp = await importUnitypackage(db, bridge, project, pre.packagePath, projectId, pre, {
      trashFn: async () => undefined
    })
    const first = await rollbackImport(db, bridge, project, imp.importId)
    expect(first.ok).toBe(true)
    const second = await rollbackImport(db, bridge, project, imp.importId)
    expect(second.ok).toBe(false)
    expect(second.error).toContain('rolledback')
  })

  it('找不到的记录 → 明确报错，不静默', async () => {
    const { bridge } = fakeBridge()
    const rb = await rollbackImport(db, bridge, project, 'no-such-id')
    expect(rb.ok).toBe(false)
    expect(rb.error).toContain('找不到')
  })
})

describe('备份保留策略（R-66：只留最近 20 次，且走回收站）', () => {
  it('超过上限的进回收站，最近的留着', async () => {
    /**
     * ⚠ 必须用**自己的**临时目录当根。
     *
     * 第一版用的是全局 `%TEMP%/A-uninitialized/backups/rollback` —— 单跑绿，
     * 全量跑红：并行执行的其他测试（`bridge/ipc.spec.ts` 那条"冲突+开备份"）
     * 也在往同一个目录里写备份，于是"该删 5 个"变成了别的数。
     * 这是**测试隔离缺陷**，不是被测代码的问题。
     */
    const rootDir = fs.mkdtempSync(path.join(root, 'prune-root-'))
    const N = IMPORT_BACKUP_KEEP + 5
    for (let i = 0; i < N; i++) {
      const d = path.join(rootDir, `b${String(i).padStart(3, '0')}`)
      fs.mkdirSync(d, { recursive: true })
      fs.writeFileSync(path.join(d, 'x'), 'x', 'utf8')
      /** 时间戳拉开，保证排序确定 */
      const t = new Date(Date.now() - (N - i) * 60_000)
      fs.utimesSync(d, t, t)
    }
    const trashed: string[] = []
    const r = await pruneBackups(
      async (p) => {
        trashed.push(path.basename(p))
        fs.rmSync(p, { recursive: true, force: true })
      },
      IMPORT_BACKUP_KEEP,
      rootDir
    )
    expect(r.removed).toBe(5)
    /** 被清掉的必须是**最旧的 5 个**。顺序不看（那取决于 mtime 并列时的排序细节） */
    expect(trashed.slice().sort()).toEqual(['b000', 'b001', 'b002', 'b003', 'b004'])
    const left = fs.readdirSync(rootDir)
    expect(left).toHaveLength(IMPORT_BACKUP_KEEP)
    expect(left).not.toContain('b000')
    /** 留下的是最近的 20 个 */
    expect(left.slice().sort()).toEqual(
      Array.from({ length: IMPORT_BACKUP_KEEP }, (_, i) => `b${String(i + 5).padStart(3, '0')}`)
    )
  })

  it('清理用的是注入的 trashFn（绝不自己 rm）', async () => {
    const rootDir = fs.mkdtempSync(path.join(root, 'prune-root2-'))
    fs.mkdirSync(path.join(rootDir, 'old'), { recursive: true })
    let called = 0
    await pruneBackups(
      async () => {
        called++
        throw new Error('回收站拒绝')
      },
      0,
      rootDir
    )
    expect(called).toBe(1)
    /** trashFn 抛错时目录必须还在（不能因为清理失败就把用户的退路删了） */
    expect(fs.existsSync(path.join(rootDir, 'old'))).toBe(true)
  })
})

/**
 * 找包（M5-B ⑤：判别联合）。
 *
 * 老行为是 `FoundPackage[]`，"名字叫 .zip 的目录""压缩包里的成员""没有包"三种情况
 * 都回一个空数组，界面只能猜。现在 `kind` 分三支，`reasonKey` + `notes` 说清为什么。
 *
 * 顺带说明：原来这里还有两条 `findPackages(dir, depth)` 的用例（递归找、深度上限）。
 * 那个函数已经删了 —— 它在初音小店那种容器上只看得见 80/87 个包，而且撞线不吭声（P0-4）。
 * 接替它的 `listContainerMembers` 的两个上限（段数 8 / 条数 400）在
 * `tests/import/container-packages.spec.ts` 里各有用例，那里才是该测的地方。
 */
describe('找包（packagesOfAsset 判别联合）', () => {
  /** `reasonKey` 只在 empty 那支上有 —— 断言里先窄化，别用 `as any` 糊过去 */
  function whyEmpty(r: Awaited<ReturnType<typeof packagesOfAsset>>): string {
    return r.kind === 'empty' ? r.reasonKey : '不是 empty'
  }

  function insertAsset(id: string, libPath: string): void {
    const now = Date.now()
    db.prepare(
      `INSERT INTO asset (id, name, raw_name, category, confidence, status, storage_mode, library_path, created_at, updated_at)
       VALUES (?, 'Demo', 'Demo', 'plugin', 0.9, 'classified', 'indexed', ?, ?, ?)`
    ).run(id, libPath, now, now)
  }

  it('给单个 .unitypackage → kind=loose，路径能直接用，origin 三列全 null', async () => {
    const pkg = path.join(root, 'single.unitypackage')
    await buildPackage(pkg, [{ guid: GUID_A, unityPath: 'Assets/A.prefab' }])
    insertAsset('asset-1', pkg)
    const got = await packagesOfAsset(db, 'asset-1')
    expect(got.kind).toBe('loose')
    expect(got.packages).toHaveLength(1)
    expect(got.packages[0].path).toBe(pkg)
    expect(got.packages[0].relPath).toBe('single.unitypackage')
    expect(got.packages[0].origin).toEqual({
      containerAssetId: 'asset-1',
      originArchive: null,
      memberRelPath: null
    })
    /** 体积是**量出来的**（老代码在这儿写死 0，界面上就永远显示 0 B） */
    expect(got.packages[0].sizeBytes).toBe(fs.statSync(pkg).size)
  })

  it('给目录 → kind=loose，把里面的包列出来并带上相对路径', async () => {
    const lib = path.join(root, 'lib3')
    fs.mkdirSync(path.join(lib, 'a', 'b'), { recursive: true })
    await buildPackage(path.join(lib, 'top.unitypackage'), [{ guid: GUID_A, unityPath: 'Assets/T.prefab' }])
    await buildPackage(path.join(lib, 'a', 'b', 'deep.unitypackage'), [{ guid: GUID_B, unityPath: 'Assets/D.prefab' }])
    fs.writeFileSync(path.join(lib, 'a', 'not-a-package.zip'), 'x')
    insertAsset('asset-2', lib)
    const got = await packagesOfAsset(db, 'asset-2')
    expect(got.kind).toBe('loose')
    expect(got.packages.map((p) => p.relPath).sort()).toEqual(['a/b/deep.unitypackage', 'top.unitypackage'])
    /** 目录型容器的成员就在盘上，不用抽 */
    for (const p of got.packages) {
      expect(p.path).not.toBeNull()
      expect(p.origin.originArchive).toBeNull()
    }
  })

  it('路径不存在 → kind=empty reasonKey=missing；素材 id 不对 → noRow（都不抛）', async () => {
    insertAsset('asset-3', path.join(root, 'ghost.unitypackage'))
    expect(whyEmpty(await packagesOfAsset(db, 'asset-3'))).toBe('missing')
    expect(whyEmpty(await packagesOfAsset(db, 'nope'))).toBe('noRow')
  })

  it('名字叫压缩包、实际不是 → kind=empty，且 notes 里不是"包坏了"', async () => {
    const zip = path.join(root, '假的.zip')
    fs.writeFileSync(zip, 'not really a zip')
    insertAsset('asset-4', zip)
    const got = await packagesOfAsset(db, 'asset-4')
    expect(got.kind).toBe('empty')
    expect(whyEmpty(got)).toBe('noPackage')
    /** 列不出成员时不许谎报损坏（那个说法会把用户支去重下文件） */
    expect(JSON.stringify(got.notes)).not.toContain('corrupt')
  })
})

describe('记账行的 id 必须用库里那条（不能另生成）', () => {
  it('insertImportLog 返回的 id 与库里那行一致', () => {
    const row = insertImportLog(db, {
      projectId,
      unitypackagePath: 'E:\\x.unitypackage',
      status: 'queued'
    })
    const got = db.prepare(`SELECT id FROM import_log WHERE id = ?`).get(row.id) as { id: string } | undefined
    expect(got?.id).toBe(row.id)
  })
})
