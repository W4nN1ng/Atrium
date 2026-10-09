import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import * as tar from 'tar'
import { openDatabase, closeDatabase, type Db } from '../../src/main/db'
import { upsertProject } from '../../src/main/db/repos/unity'
import { registerBridgeIpc, type PreflightView } from '../../src/main/bridge/ipc'
import { BridgeManager } from '../../src/main/bridge/manager'
import { BRIDGE_PACKAGE_NAME } from '../../src/main/bridge/installer'
import { bridgeDirOf } from '../../src/main/bridge/mailbox'
import type { IpcRegistrar } from '../../src/main/ipc/types'
import { FakeUnity } from '../bridge/fake-unity'
import { setAppPathsForTest } from '../../src/main/services/paths'
import { setSettings } from '../../src/main/services/settings'
import { sizeOfTree } from '../../src/main/import/extractRoot'
import { IMPORT_BATCH_MAX, type BatchOutcome } from '../../src/main/import/memberImport'
import { makeZip } from '../helpers/containers'
import type { BatchRollbackOutcome, PlanView } from '../../src/shared/types'

/**
 * `bridge/ipc.ts` 的**集成**测试。
 *
 * 为什么值得单独写一份：`tests/renderer/ipc-channels.spec.ts` 只检查
 * "每个 `ipc.handle` 的通道都在白名单里" —— 那是**白名单对账**，不是接线验证。
 * 接线写错（参数取错、守卫走错分支、忘了 rewatch）它是抓不到的。
 *
 * 这里用一个假注册器把处理器**抓下来直接调**，并且接上**真的 `BridgeManager`**
 * 与 `FakeUnity`（一个真在监听 `inbox/` 的对端）——
 * 所以从 IPC 边界一路跑到文件信箱的整条链都被覆盖了，不需要 Unity。
 */

// ---------------------------------------------------------------- 假注册器

interface Registrar {
  registrar: IpcRegistrar
  call<T = unknown>(channel: string, ...args: unknown[]): Promise<T>
  broadcasts: Array<{ event: string; payload: unknown }>
  channels(): string[]
}

function makeRegistrar(): Registrar {
  const handlers = new Map<string, (...args: unknown[]) => unknown>()
  const broadcasts: Array<{ event: string; payload: unknown }> = []
  const registrar: IpcRegistrar = {
    ipc: {
      handle(channel, fn) {
        if (handlers.has(channel)) throw new Error('重复注册：' + channel)
        handlers.set(channel, fn as (...args: unknown[]) => unknown)
      }
    },
    broadcast(event, payload) {
      broadcasts.push({ event, payload })
    }
  }
  return {
    registrar,
    broadcasts,
    channels: () => [...handlers.keys()],
    async call<T>(channel: string, ...args: unknown[]): Promise<T> {
      const fn = handlers.get(channel)
      if (!fn) throw new Error('通道没注册：' + channel)
      return (await fn(...args)) as T
    }
  }
}

// ---------------------------------------------------------------- 夹具

let root: string
let project: string
let db: Db
let projectId: string
let manager: BridgeManager
let fake: FakeUnity
let R: Registrar
let api: ReturnType<typeof registerBridgeIpc>
let pkgPath: string

const GUID_A = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const GUID_B = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'

async function buildPackage(file: string, guids: Array<{ guid: string; unityPath: string }>): Promise<void> {
  const src = fs.mkdtempSync(path.join(root, 'pkg-'))
  for (const g of guids) {
    const d = path.join(src, g.guid)
    fs.mkdirSync(d, { recursive: true })
    fs.writeFileSync(path.join(d, 'pathname'), g.unityPath, 'utf8')
    fs.writeFileSync(path.join(d, 'asset'), 'body-' + g.guid, 'utf8')
    fs.writeFileSync(path.join(d, 'asset.meta'), 'fileFormatVersion: 2', 'utf8')
  }
  fs.mkdirSync(path.dirname(file), { recursive: true })
  await tar.c({ gzip: true, cwd: src, file, prefix: './' }, fs.readdirSync(src))
}

/** FakeUnity 的行为：照真桥接的协议回答每种命令 */
function wireFake(existing: Record<string, string> = {}): { deleted: string[] } {
  const seen = { deleted: [] as string[] }
  fake.onCommand((cmd) => {
    const p = (cmd.payload ?? {}) as Record<string, unknown>
    if (cmd.type === 'resolve_guids') {
      const guids = (p.guids as string[]) ?? []
      const resolved: Record<string, string | null> = {}
      for (const g of guids) resolved[g] = existing[g] ?? null
      return { status: 'ok', data: { resolved } }
    }
    if (cmd.type === 'import_unitypackage') {
      return {
        status: 'ok',
        data: { createdGuids: [GUID_A], overwrittenGuids: Object.keys(existing) }
      }
    }
    if (cmd.type === 'delete_guids') {
      const guids = (p.guids as string[]) ?? []
      seen.deleted.push(...guids)
      return { status: 'ok', data: { deleted: guids.map((g) => 'Assets/Would/Be/Deleted/' + g), failed: [] } }
    }
    return { status: 'ok', data: null }
  })
  return seen
}

beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'avca-ipc-'))
  /**
   * 运行时目录（备份/暂存/缩略图）指到本文件自己的临时目录。
   * 不做这一步会落在 `%TEMP%/A-uninitialized`（进程级共享），
   * 与并行跑的 `tests/import/coordinator.spec.ts` 互相删备份。
   */
  setAppPathsForTest(path.join(root, 'appdata'))
  project = path.join(root, 'shinano-Main2')
  fs.mkdirSync(path.join(project, 'ProjectSettings'), { recursive: true })
  fs.mkdirSync(path.join(project, 'Assets'), { recursive: true })
  fs.writeFileSync(
    path.join(project, 'ProjectSettings', 'ProjectVersion.txt'),
    'm_EditorVersion: 2022.3.22f1',
    'utf8'
  )
  /** 装一份桥接（内容不重要，只要 package.json 在，`isBridgeInstalled` 就为真） */
  const bridgeDir = path.join(project, 'Packages', BRIDGE_PACKAGE_NAME)
  fs.mkdirSync(path.join(bridgeDir, 'Editor'), { recursive: true })
  fs.writeFileSync(path.join(bridgeDir, 'package.json'), '{"name":"com.avca.bridge"}', 'utf8')
  fs.writeFileSync(path.join(bridgeDir, 'Editor', 'AVCABridge.cs'), '// bridge', 'utf8')
  fs.writeFileSync(path.join(bridgeDir, 'Editor', 'AVCA.Bridge.asmdef'), '{}', 'utf8')

  db = openDatabase(path.join(root, 'library.db'))
  projectId = upsertProject(db, { path: project, name: 'shinano-Main2', unityVersion: '2022.3.22f1' }).id

  manager = new BridgeManager()
  fake = new FakeUnity(project)
  fake.heartbeat()
  fake.start()
  R = makeRegistrar()
  /**
   * ⚠ **必须注入真的删除实现**。测试环境里 `electron` 是 stub，
   * `shell.trashItem` 是个既不动文件也不抛错的空函数 ——
   * 于是"卸载报成功但目录还在"会被静默放过（实测就是这么发现的）。
   * 生产走 `shell.trashItem`（回收站），这里用真 fs 才能验行为。
   *
   * `extractDisk` 同理：本机 `%TEMP%` 在 C 盘，而抽取根闸门要拒 C 盘。
   * 不换读数的话**每一条**成员导入用例都会停在 `err.extractOnSystemDrive`，
   * 而这台机器上没有一个"既不是库根又不带盘符"的可写位置。
   * 三条判据本身在 `extract-root.spec.ts` / `member-import.spec.ts` 用默认读数测。
   */
  api = registerBridgeIpc({
    db,
    manager,
    registrar: R.registrar,
    trashFn: (p) => fs.promises.rm(p, { recursive: true, force: true }),
    extractDisk: { driveOf: () => 'e', freeBytes: () => 50 * 1073741824 }
  })

  pkgPath = path.join(root, 'demo.unitypackage')
  await buildPackage(pkgPath, [
    { guid: GUID_A, unityPath: 'Assets/Demo/A.prefab' },
    { guid: GUID_B, unityPath: 'Assets/Demo/B.shader' }
  ])
})

afterEach(() => {
  api.dispose()
  manager.dispose()
  fake.stop()
  closeDatabase()
  /** 运行时目录已指到本文件自己的临时目录（见 beforeEach），随 root 一起清 */
  try {
    fs.rmSync(root, { recursive: true, force: true })
  } catch {
    /* 交给系统 */
  }
})

// ---------------------------------------------------------------- 用例

describe('通道注册', () => {
  it('M5-A + M5-B 的通道都注册上了（白名单漏一个，点下去就抛）', () => {
    const ch = R.channels()
    for (const c of [
      'unity:instances',
      'unity:status',
      'unity:set-target',
      'unity:install-bridge',
      'unity:uninstall-bridge',
      'unity:bridge-template-check',
      'unity:packages-of-asset',
      'unity:preflight',
      'unity:import-package',
      'unity:rollback-import',
      'unity:import-logs',
      'unity:cancel-batch',
      /** M5-B ⑤：抽取 → 确认 → 执行 → 反悔 → 整批撤 → 抽取目录占用/清理 */
      'unity:import-plan',
      'unity:import-commit',
      'unity:import-abandon',
      'unity:rollback-batch',
      'unity:extract-usage',
      'unity:extract-clean'
    ]) {
      expect(ch, `缺通道 ${c}`).toContain(c)
    }
  })

  it('重复注册会被假注册器抓到（说明 createRegistrar 的重复保护有意义）', () => {
    expect(() => registerBridgeIpc({ db, manager, registrar: R.registrar })).toThrow(/重复注册/)
  })
})

describe('状态与目标切换', () => {
  it('没选目标时 status 如实说"没有目标"，不假装正常', async () => {
    const st = await R.call<{ targetProjectId: string | null; running: boolean }>('unity:status')
    expect(st.targetProjectId).toBeNull()
    expect(st.running).toBe(false)
  })

  it('set-target 之后 status 报出真实运行状态与队列', async () => {
    const id = await R.call<string | null>('unity:set-target', projectId)
    expect(id).toBe(projectId)
    const st = await R.call<{ targetProjectId: string | null; running: boolean; bridgeReady: boolean; queue: unknown[] }>(
      'unity:status'
    )
    expect(st.targetProjectId).toBe(projectId)
    /** 心跳是刚写的，所以桥接应当就绪 */
    expect(st.bridgeReady).toBe(true)
    expect(st.running).toBe(true)
    expect(Array.isArray(st.queue)).toBe(true)
  })

  it('set-target 传一个库里没有的 id → 明确报错，不静默接受', async () => {
    await expect(R.call('unity:set-target', 'not-a-real-project')).rejects.toThrow(/没有这个工程/)
  })

  it('set-target 传 null 可以清掉目标', async () => {
    await R.call('unity:set-target', projectId)
    const cleared = await R.call<string | null>('unity:set-target', null)
    expect(cleared).toBeNull()
  })

  it('instances 能列出活着的心跳（真读文件，不是空数组）', async () => {
    const list = await R.call<Array<{ projectPath: string; pid: number }>>('unity:instances')
    expect(list).toHaveLength(1)
    expect(list[0].projectPath.toLowerCase()).toBe(project.toLowerCase())
    expect(list[0].pid).toBe(4242)
  })
})

describe('桥接模板与安装/卸载', () => {
  it('模板自检指向真模板目录', async () => {
    const r = await R.call<{ ok: boolean; root: string; missing: string[] }>('unity:bridge-template-check')
    expect(r.root).toContain('com.avca.bridge')
    /** dev 环境下指向仓库里的模板 */
    expect(r.missing).toEqual([])
  })

  it('装到一个没装的工程上，然后能卸掉', async () => {
    const other = path.join(root, 'Milfy-Main')
    fs.mkdirSync(other, { recursive: true })
    const otherId = upsertProject(db, { path: other, name: 'Milfy-Main' }).id
    await R.call('unity:set-target', otherId)

    const inst = await R.call<{ ok: boolean; copied: number; target: string; error: string | null }>(
      'unity:install-bridge'
    )
    expect(inst.ok).toBe(true)
    expect(inst.copied).toBeGreaterThan(0)
    expect(fs.existsSync(path.join(other, 'Packages', BRIDGE_PACKAGE_NAME, 'package.json'))).toBe(true)

    const un = await R.call<{ ok: boolean }>('unity:uninstall-bridge')
    expect(un.ok).toBe(true)
    /** 卸载后目录必须真的不在（这条以前会因为 trashFn 是空实现而假通过） */
    expect(fs.existsSync(path.join(other, 'Packages', BRIDGE_PACKAGE_NAME))).toBe(false)
  })

  it('没选目标时安装/卸载都明确报错，不静默', async () => {
    await expect(R.call('unity:install-bridge')).rejects.toThrow(/先选一个导入目标/)
    await expect(R.call('unity:uninstall-bridge')).rejects.toThrow(/先选一个导入目标/)
  })

  it('uninstall-bridge-all 把装着桥接的都清掉', async () => {
    const r = await R.call<{ uninstalled: string[]; failed: unknown[] }>('unity:uninstall-bridge-all')
    expect(r.uninstalled).toContain(project)
    expect(r.failed).toEqual([])
  })
})

/**
 * 找包与成员导入（M5-B ⑤）。
 *
 * 这里跑的是**真 `BridgeManager` + `FakeUnity`**，所以从 IPC 边界一路到文件信箱都是真的；
 * 主链路的分支细节（闸门、失败归因、半批）在 `tests/import/member-import.spec.ts` 里，
 * 那份用假桥接、能造出 Unity 造不出的场景。两份不重复：那份测逻辑，这份测接线。
 */
describe('找包（packagesOfAsset 判别联合）', () => {
  function insertAsset(id: string, libPath: string, name = 'Demo'): void {
    const now = Date.now()
    db.prepare(
      `INSERT INTO asset (id, name, raw_name, category, confidence, status, storage_mode, library_path, created_at, updated_at)
       VALUES (?, ?, ?, 'plugin', 0.9, 'classified', 'indexed', ?, ?, ?)`
    ).run(id, name, name, libPath, now, now)
  }

  it('散装 .unitypackage → kind=loose，路径能用，体积是量出来的', async () => {
    insertAsset('a1', pkgPath)
    const r = await R.call<{ kind: string; packages: Array<{ path: string | null; sizeBytes: number }> }>(
      'unity:packages-of-asset',
      'a1'
    )
    expect(r.kind).toBe('loose')
    expect(r.packages).toHaveLength(1)
    expect(r.packages[0].path).toBe(pkgPath)
    /** 老代码在这儿写死 0 —— 界面就永远显示 0 B */
    expect(r.packages[0].sizeBytes).toBe(fs.statSync(pkgPath).size)
  })

  it('目录里有包 → kind=loose，把包列出来', async () => {
    const dir = path.join(root, 'lib', '插件')
    fs.mkdirSync(dir, { recursive: true })
    const inner = path.join(dir, 'x.unitypackage')
    await buildPackage(inner, [{ guid: GUID_A, unityPath: 'Assets/X.prefab' }])
    insertAsset('a2', dir)
    const r = await R.call<{ kind: string; packages: Array<{ path: string | null }> }>(
      'unity:packages-of-asset',
      'a2'
    )
    expect(r.kind).toBe('loose')
    expect(r.packages.map((p) => p.path)).toContain(inner)
  })

  it('真压缩包 → kind=archive，成员列得出来但 path 是 null（还没抽）', async () => {
    const src = path.join(root, 'insrc')
    fs.mkdirSync(src, { recursive: true })
    await buildPackage(path.join(src, 'inner.unitypackage'), [
      { guid: GUID_A, unityPath: 'Assets/Inner.prefab' }
    ])
    const zip = path.join(root, 'lib2', 'real.zip')
    fs.mkdirSync(path.dirname(zip), { recursive: true })
    makeZip(src, zip, ['inner.unitypackage'])
    insertAsset('a3', zip)
    const r = await R.call<{ kind: string; packages: Array<{ path: string | null; relPath: string }> }>(
      'unity:packages-of-asset',
      'a3'
    )
    expect(r.kind).toBe('archive')
    expect(r.packages).toHaveLength(1)
    /** 没抽就没有路径。这里给 null 而不是给一个拼出来的假路径，是这一版的规矩 */
    expect(r.packages[0].path).toBeNull()
    expect(r.packages[0].relPath).toBe('inner.unitypackage')
  })

  it('名字叫压缩包、实际不是 → kind=empty，不再谎称"有包但抽不出"', async () => {
    const zip = path.join(root, 'lib3', 'fake.zip')
    fs.mkdirSync(path.dirname(zip), { recursive: true })
    fs.writeFileSync(zip, 'not really a zip', 'utf8')
    insertAsset('a5', zip)
    const r = await R.call<{ kind: string; reasonKey?: string; packages: unknown[] }>(
      'unity:packages-of-asset',
      'a5'
    )
    expect(r.kind).toBe('empty')
    expect(r.reasonKey).toBe('noPackage')
    expect(r.packages).toEqual([])
  })

  it('路径不存在 → missing；素材 id 不对 → noRow（都不抛）', async () => {
    insertAsset('a4', path.join(root, 'ghost.unitypackage'))
    expect(
      (await R.call<{ kind: string; reasonKey?: string }>('unity:packages-of-asset', 'a4')).reasonKey
    ).toBe('missing')
    const none = await R.call<{ kind: string; reasonKey?: string }>('unity:packages-of-asset', 'nope')
    expect(none.kind).toBe('empty')
    expect(none.reasonKey).toBe('noRow')
  })
})

describe('成员导入：IPC 一路跑到文件信箱（真 BridgeManager + FakeUnity）', () => {
  function insertAsset(id: string, libPath: string): void {
    const now = Date.now()
    db.prepare(
      `INSERT INTO asset (id, name, raw_name, category, confidence, status, storage_mode, library_path, created_at, updated_at)
       VALUES (?, ?, ?, 'plugin', 0.9, 'classified', 'indexed', ?, ?, ?)`
    ).run(id, path.basename(libPath), path.basename(libPath), libPath, now, now)
  }

  /** 库根与抽取目录：都指到本文件的临时目录里，绝不碰用户的 E:\\vrc\\A */
  beforeEach(() => {
    setSettings({ libraryRoot: path.join(root, 'libroot'), extractRoot: path.join(root, 'A__extract') })
  })

  it('列成员 → 抽 → 预扫描 → 确认 → 导入 → 记账，三列来源全落在 import_log', async () => {
    const libroot = path.join(root, 'libroot')
    fs.mkdirSync(libroot, { recursive: true })
    const src = path.join(root, 'b-src')
    fs.mkdirSync(src, { recursive: true })
    await buildPackage(path.join(src, 'P.unitypackage'), [{ guid: GUID_A, unityPath: 'Assets/P.prefab' }])
    const zip = path.join(libroot, 'batch.zip')
    makeZip(src, zip, ['P.unitypackage'])
    insertAsset('ab1', zip)
    await R.call('unity:set-target', projectId)
    wireFake()

    const listed = await R.call<{ kind: string; packages: Array<{ relPath: string }> }>(
      'unity:packages-of-asset',
      'ab1'
    )
    expect(listed.packages).toHaveLength(1)

    const plan = await R.call<PlanView>('unity:import-plan', {
      assetId: 'ab1',
      members: [listed.packages[0].relPath]
    })
    expect(plan.ok).toBe(true)
    expect(plan.items).toHaveLength(1)
    expect(plan.items[0].extracted).toBe(true)
    expect(plan.conflictPackages).toBe(0)
    /** 抽出来的副本此刻**应该**在抽取目录下 */
    expect(plan.totalBytes).toBeGreaterThan(0)
    expect(fs.existsSync(path.join(root, 'A__extract'))).toBe(true)

    const done = await R.call<BatchOutcome>('unity:import-commit', { batchId: plan.batchId, choice: 'continue' })
    expect(done.imported).toBe(1)
    expect(done.results[0].importId).toBeTruthy()

    const rows = db
      .prepare(`SELECT * FROM import_log WHERE batch_id = ?`)
      .all(plan.batchId) as Array<Record<string, unknown>>
    expect(rows).toHaveLength(1)
    expect(rows[0].container_asset_id).toBe('ab1')
    expect(rows[0].member_rel_path).toBe('P.unitypackage')
    expect(rows[0].origin_archive).toBe(zip)
    expect(rows[0].status).toBe('ok')
    /** 终态即删：抽取根下这个素材那一层不该还留着副本 */
    expect(sizeOfTree(path.join(root, 'A__extract'))).toBe(0)
    /** FakeUnity 真收到了导入命令（信箱那条链通着，不是只跑了本地一半） */
    expect(rows[0].created_guids_json).toContain(GUID_A)
  })

  it('抽出来之后改主意（abandon）→ 副本立刻没了，一条 import_log 都不留', async () => {
    const libroot = path.join(root, 'libroot')
    fs.mkdirSync(libroot, { recursive: true })
    const src = path.join(root, 'ab-src')
    fs.mkdirSync(src, { recursive: true })
    await buildPackage(path.join(src, 'Q.unitypackage'), [{ guid: GUID_A, unityPath: 'Assets/Q.prefab' }])
    const zip = path.join(libroot, 'abandon.zip')
    makeZip(src, zip, ['Q.unitypackage'])
    insertAsset('ab2', zip)
    await R.call('unity:set-target', projectId)
    wireFake()

    const listed = await R.call<{ packages: Array<{ relPath: string }> }>('unity:packages-of-asset', 'ab2')
    const plan = await R.call<PlanView>('unity:import-plan', { assetId: 'ab2', members: [listed.packages[0].relPath] })
    expect(plan.ok).toBe(true)
    expect(sizeOfTree(path.join(root, 'A__extract'))).toBeGreaterThan(0)

    const r = await R.call<{ released: number; failed: number }>('unity:import-abandon', plan.batchId)
    expect(r).toEqual({ released: 1, failed: 0 })
    expect(sizeOfTree(path.join(root, 'A__extract'))).toBe(0)
    expect(db.prepare(`SELECT COUNT(*) AS n FROM import_log`).get()).toEqual({ n: 0 })
  })

  it('没规划过的 batchId 来确认 → 说"这批不在了"，不假装成功', async () => {
    const r = await R.call<{ ok: boolean; reasonKey?: string }>('unity:import-commit', {
      batchId: '01NOTAREALBATCH'
    })
    expect(r.ok).toBe(false)
    expect(r.reasonKey).toBe('err.planGone')
  })

  it('抽取根设在库根里面 → 拒绝，而且一个字节都不落', async () => {
    const libroot = path.join(root, 'libroot')
    fs.mkdirSync(libroot, { recursive: true })
    const src = path.join(root, 'gate-src')
    fs.mkdirSync(src, { recursive: true })
    await buildPackage(path.join(src, 'G.unitypackage'), [{ guid: GUID_A, unityPath: 'Assets/G.prefab' }])
    const zip = path.join(libroot, 'gate.zip')
    makeZip(src, zip, ['G.unitypackage'])
    insertAsset('ab3', zip)
    await R.call('unity:set-target', projectId)
    wireFake()
    /** 用户（或一个配错的设置项）把抽取目录放进了库里 —— 这是红线 */
    setSettings({ extractRoot: path.join(libroot, 'A__extract') })

    const plan = await R.call<{ ok: boolean; reasonKey?: string }>('unity:import-plan', {
      assetId: 'ab3',
      members: ['G.unitypackage']
    })
    expect(plan.ok).toBe(false)
    expect(plan.reasonKey).toBe('err.extractInsideLibrary')
    expect(fs.existsSync(path.join(libroot, 'A__extract'))).toBe(false)
  })

  it('取消一批：登记意图，返回如实说明"当前这条会跑完"', async () => {
    const libroot = path.join(root, 'libroot')
    fs.mkdirSync(libroot, { recursive: true })
    const src = path.join(root, 'cancel-src')
    fs.mkdirSync(src, { recursive: true })
    await buildPackage(path.join(src, 'C.unitypackage'), [{ guid: GUID_A, unityPath: 'Assets/C.prefab' }])
    const zip = path.join(libroot, 'cancel.zip')
    makeZip(src, zip, ['C.unitypackage'])
    insertAsset('ab4', zip)
    await R.call('unity:set-target', projectId)
    wireFake()

    const listed = await R.call<{ packages: Array<{ relPath: string }> }>('unity:packages-of-asset', 'ab4')
    const plan = await R.call<PlanView>('unity:import-plan', { assetId: 'ab4', members: [listed.packages[0].relPath] })
    expect(await R.call('unity:cancel-batch', plan.batchId)).toEqual({ ok: true, willStopAfterCurrent: true })
    /** 取消之后再确认：一条都不发，全部记为未执行 */
    const done = await R.call<BatchOutcome>('unity:import-commit', { batchId: plan.batchId })
    expect(done.imported).toBe(0)
    expect(done.notRun).toBe(1)
    expect(done.stoppedReasonKey).toBe('err.importCancelled')
    /** 没导就不该有台账 */
    expect(db.prepare(`SELECT COUNT(*) AS n FROM import_log`).get()).toEqual({ n: 0 })
    /** 但副本必须收干净 */
    expect(sizeOfTree(path.join(root, 'A__extract'))).toBe(0)
  })

  it('设置 → 维护看得到抽取目录占用，清理能腾干净', async () => {
    const libroot = path.join(root, 'libroot')
    fs.mkdirSync(libroot, { recursive: true })
    const src = path.join(root, 'use-src')
    fs.mkdirSync(src, { recursive: true })
    await buildPackage(path.join(src, 'U.unitypackage'), [{ guid: GUID_A, unityPath: 'Assets/U.prefab' }])
    const zip = path.join(libroot, 'use.zip')
    makeZip(src, zip, ['U.unitypackage'])
    insertAsset('ab5', zip)
    await R.call('unity:set-target', projectId)
    wireFake()

    expect(await R.call('unity:extract-usage')).toEqual({ root: path.join(root, 'A__extract'), bytes: 0 })

    const listed = await R.call<{ packages: Array<{ relPath: string }> }>('unity:packages-of-asset', 'ab5')
    await R.call('unity:import-plan', { assetId: 'ab5', members: [listed.packages[0].relPath] })
    const used = await R.call<{ root: string; bytes: number }>('unity:extract-usage')
    expect(used.bytes).toBeGreaterThan(0)
    /** 但还没确认的那批受保护，清理不许把它端走 */
    const r = await R.call<{ ok: boolean; removed: number; kept: number }>('unity:extract-clean')
    expect(r.kept).toBe(1)
    expect(used.bytes).toBeGreaterThan(0)
  })

  it('批量撤销走 IPC：倒序逐条，Unity 真收到 delete_guids', async () => {
    const libroot = path.join(root, 'libroot')
    fs.mkdirSync(libroot, { recursive: true })
    const src = path.join(root, 'rb-src')
    for (const d of ['m', 'n']) {
      fs.mkdirSync(path.join(src, d), { recursive: true })
      await buildPackage(path.join(src, d, 'P.unitypackage'), [
        { guid: d === 'm' ? GUID_A : GUID_B, unityPath: `Assets/${d}/P.prefab` }
      ])
    }
    const zip = path.join(libroot, 'rollback.zip')
    makeZip(src, zip, ['m/P.unitypackage', 'n/P.unitypackage'])
    insertAsset('ab6', zip)
    await R.call('unity:set-target', projectId)
    const seen = wireFake()

    const listed = await R.call<{ packages: Array<{ relPath: string }> }>('unity:packages-of-asset', 'ab6')
    const plan = await R.call<PlanView>('unity:import-plan', {
      assetId: 'ab6',
      members: listed.packages.map((p) => p.relPath)
    })
    expect(plan.items).toHaveLength(2)
    const done = await R.call<BatchOutcome>('unity:import-commit', { batchId: plan.batchId, choice: 'continue' })
    expect(done.imported).toBe(2)

    const rb = await R.call<BatchRollbackOutcome>('unity:rollback-batch', plan.batchId)
    expect(rb.rolledBack).toBe(2)
    expect(rb.ok).toBe(true)
    /** 每条各发一次删除，删的都是那次的 createdGuids（白名单，不是"按 GUID 随便删"） */
    expect(seen.deleted).toHaveLength(2)
    expect(rb.details.every((d) => d.ok && d.deletedFiles === 1)).toBe(true)
  })

  it('一次最多 8 个：闸门在链路里，绕过界面也过不去', async () => {
    const libroot = path.join(root, 'libroot')
    fs.mkdirSync(libroot, { recursive: true })
    const src = path.join(root, 'cap-src')
    const rels: string[] = []
    for (let i = 0; i < 9; i++) {
      fs.mkdirSync(path.join(src, 'd' + i), { recursive: true })
      await buildPackage(path.join(src, 'd' + i, `P${i}.unitypackage`), [
        { guid: GUID_A, unityPath: `Assets/d${i}/P.prefab` }
      ])
      rels.push(`d${i}/P${i}.unitypackage`)
    }
    const zip = path.join(libroot, 'cap.zip')
    makeZip(src, zip, rels)
    insertAsset('ab7', zip)
    await R.call('unity:set-target', projectId)
    wireFake()

    const plan = await R.call<{ ok: boolean; reasonKey?: string; reasonParams?: Record<string, unknown> }>(
      'unity:import-plan',
      { assetId: 'ab7', members: rels }
    )
    expect(plan.ok).toBe(false)
    expect(plan.reasonKey).toBe('err.batchTooBig')
    expect(plan.reasonParams).toEqual({ count: 9, max: IMPORT_BATCH_MAX })
    expect(sizeOfTree(path.join(root, 'A__extract'))).toBe(0)
  })
})

describe('预扫描 → 导入 → 撤销（接真 BridgeManager + FakeUnity）', () => {
  async function setTarget(): Promise<void> {
    await R.call('unity:set-target', projectId)
  }

  it('全新建：预扫描 ok、无冲突，导入后 import_log 记下 createdGuids', async () => {
    wireFake()
    await setTarget()

    const pre = await R.call<PreflightView>('unity:preflight', { packagePath: pkgPath })
    expect(pre.ok).toBe(true)
    expect(pre.entryCount).toBe(2)
    expect(pre.conflictCount).toBe(0)
    expect(pre.fresh).toBe(2)

    const imp = await R.call<{ ok: boolean; importId: string; createdGuids: string[]; status: string }>(
      'unity:import-package',
      { packagePath: pkgPath, choice: 'continue' }
    )
    expect(imp.ok).toBe(true)
    expect(imp.status).toBe('ok')
    expect(imp.createdGuids).toContain(GUID_A)

    const row = db.prepare(`SELECT status, created_guids_json FROM import_log WHERE id = ?`).get(imp.importId) as {
      status: string
      created_guids_json: string
    }
    expect(row.status).toBe('ok')
    expect(JSON.parse(row.created_guids_json)).toContain(GUID_A)

    /** 导入成功要广播 data:changed，否则界面不会刷新 */
    expect(R.broadcasts.some((b) => b.event === 'data:changed')).toBe(true)
  })

  it('有冲突：预扫描把**具体文件路径**列出来（§5.1④）', async () => {
    wireFake({ [GUID_A]: 'Assets/Existing/A.prefab' })
    await setTarget()
    const pre = await R.call<PreflightView>('unity:preflight', { packagePath: pkgPath })
    expect(pre.conflictCount).toBe(1)
    expect(pre.conflicts[0].existingPath).toBe('Assets/Existing/A.prefab')
    expect(pre.conflicts[0].incomingPath).toBe('Assets/Demo/A.prefab')
    expect(pre.fresh).toBe(1)
  })

  it('导入时**重新跑预扫描**，不信任界面传来的（工程状态可能已经变了）', async () => {
    const seen = { resolveCalls: 0 }
    fake.onCommand((cmd) => {
      const p = (cmd.payload ?? {}) as Record<string, unknown>
      if (cmd.type === 'resolve_guids') {
        seen.resolveCalls++
        const guids = (p.guids as string[]) ?? []
        const resolved: Record<string, string | null> = {}
        for (const g of guids) resolved[g] = null
        return { status: 'ok', data: { resolved } }
      }
      if (cmd.type === 'import_unitypackage') return { status: 'ok', data: { createdGuids: [GUID_A], overwrittenGuids: [] } }
      return { status: 'ok', data: null }
    })
    await setTarget()
    await R.call('unity:preflight', { packagePath: pkgPath })
    const afterPre = seen.resolveCalls
    await R.call('unity:import-package', { packagePath: pkgPath, choice: 'continue' })
    /** 导入那一步又查了一次 GUID —— 这就是"不信任传入冲突列表"的证据 */
    expect(seen.resolveCalls).toBeGreaterThan(afterPre)
  })

  it('冲突 + 开备份：备份目录里有被覆盖的原件，撤销能还原', async () => {
    /** 工程里先放一个将被覆盖的文件 */
    const dir = path.join(project, 'Assets', 'Existing')
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'A.prefab'), 'ORIGINAL', 'utf8')

    wireFake({ [GUID_A]: 'Assets/Existing/A.prefab' })
    await setTarget()

    const imp = await R.call<{ ok: boolean; importId: string; backupDir: string | null }>('unity:import-package', {
      packagePath: pkgPath,
      choice: 'continue-with-backup',
      assetId: null
    })
    expect(imp.ok).toBe(true)
    expect(imp.backupDir).toBeTruthy()
    const manifest = JSON.parse(
      fs.readFileSync(path.join(imp.backupDir as string, 'manifest.json'), 'utf8')
    ) as { saved: Array<{ assetPath: string; file: string }> }
    expect(manifest.saved[0].assetPath).toBe('Assets/Existing/A.prefab')
    expect(fs.readFileSync(path.join(imp.backupDir as string, manifest.saved[0].file), 'utf8')).toBe('ORIGINAL')

    /** 模拟导入把它改掉了 */
    fs.writeFileSync(path.join(dir, 'A.prefab'), 'CLOBBERED', 'utf8')

    const rb = await R.call<{ ok: boolean; deletedFiles: string[]; restoredFiles: string[]; unrestorable: number }>(
      'unity:rollback-import',
      imp.importId
    )
    expect(rb.ok).toBe(true)
    expect(rb.restoredFiles).toEqual(['Assets/Existing/A.prefab'])
    expect(fs.readFileSync(path.join(dir, 'A.prefab'), 'utf8')).toBe('ORIGINAL')

    const after = db.prepare(`SELECT status FROM import_log WHERE id = ?`).get(imp.importId) as { status: string }
    expect(after.status).toBe('rolledback')
  })

  it('撤销只删白名单：发给 Unity 的 guids 与 allow 都必须等于本次 createdGuids', async () => {
    const dict: Record<string, unknown>[] = []
    fake.onCommand((cmd) => {
      const p = (cmd.payload ?? {}) as Record<string, unknown>
      if (cmd.type === 'resolve_guids') {
        const guids = (p.guids as string[]) ?? []
        const resolved: Record<string, string | null> = {}
        for (const g of guids) resolved[g] = null
        return { status: 'ok', data: { resolved } }
      }
      if (cmd.type === 'import_unitypackage') {
        /** 故意只报一个新建的，看撤销时会不会多发别的 */
        return { status: 'ok', data: { createdGuids: [GUID_A], overwrittenGuids: [] } }
      }
      if (cmd.type === 'delete_guids') {
        dict.push(p)
        return { status: 'ok', data: { deleted: [], failed: [] } }
      }
      return { status: 'ok', data: null }
    })
    await setTarget()
    const imp = await R.call<{ importId: string }>('unity:import-package', { packagePath: pkgPath, choice: 'continue' })
    await R.call('unity:rollback-import', imp.importId)

    expect(dict).toHaveLength(1)
    expect(dict[0].guids).toEqual([GUID_A])
    /** allow 必须等于 guids —— 给宽了就等于"按 GUID 随便删" */
    expect(dict[0].allow).toEqual([GUID_A])
    expect(dict[0].allow).toEqual(dict[0].guids)
  })

  it('Unity 没开着 → 预扫描明确说"桥接没有心跳"，不假装能导', async () => {
    wireFake()
    await setTarget()
    /** 删掉心跳 = Unity 关了 */
    fs.rmSync(path.join(bridgeDirOf(project), 'bridge.json'), { force: true })
    const pre = await R.call<PreflightView>('unity:preflight', { packagePath: pkgPath })
    expect(pre.ok).toBe(false)
    expect(pre.reasonKey).toBe('unity.errNoBridgeHeartbeat')
  })

  it('桥接被删掉 → 预扫描回 bridgeMissing（界面据此显示「桥接未安装 [立即安装]」）', async () => {
    wireFake()
    await setTarget()
    fs.rmSync(path.join(project, 'Packages', BRIDGE_PACKAGE_NAME), { recursive: true, force: true })
    const pre = await R.call<PreflightView>('unity:preflight', { packagePath: pkgPath })
    expect(pre.ok).toBe(false)
    expect(pre.bridgeMissing).toBe(true)
    expect(pre.reasonKey).toBe('unity.errBridgeMissing')
  })

  it('没选目标时预扫描明确报错，而不是抛', async () => {
    const pre = await R.call<PreflightView>('unity:preflight', { packagePath: pkgPath })
    expect(pre.ok).toBe(false)
    expect(pre.reasonKey).toBe('unity.errNoProject')
  })

  it('包路径为空 → 预扫描明确报"没给包路径"', async () => {
    await setTarget()
    const pre = await R.call<PreflightView>('unity:preflight', { packagePath: '' })
    expect(pre.ok).toBe(false)
    expect(pre.reason).toContain('没给包路径')
  })

  it('cancel-batch：没这批就如实说不在了，不再抛"M5-B 交付"', async () => {
    /**
     * M5-A 时这个通道是 `throw new Error('批量队列在 M5-B 交付')`。
     * M5-B 之后它是真功能了，但**取消不掉的批次要报错**，不能回一个 ok。
     */
    expect(await R.call('unity:cancel-batch', '01NOTAREALBATCH')).toEqual({
      ok: false,
      reasonKey: 'err.planGone'
    })
  })

  it('import-logs 能反查某个素材在哪些工程装过', async () => {
    wireFake()
    await setTarget()
    const now = Date.now()
    db.prepare(
      `INSERT INTO asset (id, name, raw_name, category, confidence, status, storage_mode, created_at, updated_at)
       VALUES ('asset-1','Demo','Demo','plugin',0.9,'classified','indexed',?,?)`
    ).run(now, now)
    await R.call('unity:import-package', { packagePath: pkgPath, choice: 'continue', assetId: 'asset-1' })
    const logs = await R.call<Array<{ project_id: string; status: string }>>('unity:import-logs', 'asset-1')
    expect(logs.length).toBe(1)
    expect(logs[0].project_id).toBe(projectId)
    expect(logs[0].status).toBe('ok')
  })
})
