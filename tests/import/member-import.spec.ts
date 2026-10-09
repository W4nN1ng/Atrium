import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { openDatabase, closeDatabase, type Db } from '../../src/main/db'
import { upsertProject } from '../../src/main/db/repos/unity'
import { listImportLogs, lastRevertible } from '../../src/main/db/repos/journal'
import { setAppPathsForTest } from '../../src/main/services/paths'
import { bridgeDirOf, writeJsonAtomic } from '../../src/main/bridge/mailbox'
import { BRIDGE_PROTOCOL_VERSION, type BridgeHeartbeat } from '../../src/shared/types'
import {
  IMPORT_BATCH_MAX,
  abandonMemberPlan,
  commitMemberImport,
  planMemberImport,
  rollbackMemberBatch,
  type MemberPlan
} from '../../src/main/import/memberImport'
import {
  packagesOfAsset,
  rollbackImport,
  type BridgeLike,
  type FoundPackage
} from '../../src/main/import/coordinator'
import type { ImportLogRow } from '../../src/shared/types'
import { buildPackageWithGuids, makeZip } from '../helpers/containers'

/**
 * **成员导入主链路**（M5-B ⑤）。
 *
 * 这份测试盯的不是"函数返回的数对不对"，而是四件真会伤到人的事：
 *
 * 1. **闸门在落盘之前**。空间不够 / 抽取根在库内 / 在 C 盘 → 一个字节都不许写下去。
 *    拦在之后 = 已经往盘上摊了几百 MB，还得靠删除收拾（而删除会失败）。
 * 2. **绝不删用户的东西**。目录型容器的成员 `extractDir` 是 null，它的路径就是
 *    **素材库里的原件**。这条用"导完之后原件还在、内容一字节没变"来钉。
 * 3. **一包一条 import_log、同一个 batch_id，V5 三列来源填对**。
 *    填错的话反查与撤销都没有依据 —— 事后那个临时路径已经不存在了。
 * 4. **失败要停下、不许自动回滚**（§7-R2）。已经进工程的东西留着比删掉安全。
 *
 * 桥接用假货（照稿念），Unity 侧的真实行为不在这里验 ——
 * 那是 `docs/M5B-DESIGN.md` §6-E 组"必须真 Unity"的清单，**未验证**。
 */

const GB = 1073741824
const GUID_A = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const GUID_B = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'

let tmp: string
let db: Db
let projectId: string
let project: string
let library: string
let extractRoot: string

interface FakeCall {
  type: string
  payload: Record<string, unknown>
}

/**
 * 桥接假件。`answers` 按命令类型给回复；用 getter 的可以给每条命令不同答案
 * （"第一次成功、第二次失败"那两条用例靠的就是这个）。
 */
function fakeBridge(answers: Record<string, unknown> = {}): {
  bridge: BridgeLike
  calls: FakeCall[]
} {
  const calls: FakeCall[] = []
  const bridge: BridgeLike = {
    async execute(projectPath, type, payload, opts) {
      calls.push({ type, payload: (payload ?? {}) as Record<string, unknown> })
      const a = answers[type]
      if (a instanceof Error) throw a
      const base = {
        ok: true,
        status: 'ok',
        data: null,
        error: null,
        stackTrace: null,
        elapsedMs: 1,
        retries: 0,
        commandId: 'cmd'
      }
      void projectPath
      void opts
      if (a && typeof a === 'object') return { ...base, ...(a as object) } as typeof base
      return base
    }
  }
  return { bridge, calls }
}

/** 预扫描要的默认答案：工程里啥都没有 → 全是新建 */
const NO_CONFLICT = {
  resolve_guids: { ok: true, data: { resolved: {} } },
  import_unitypackage: { ok: true, data: { createdGuids: [GUID_A], overwrittenGuids: [] } },
  delete_guids: { ok: true, data: { deleted: [], failed: [] } },
  refresh: { ok: true, data: null }
}

async function insertAsset(id: string, libPath: string): Promise<void> {
  const now = Date.now()
  db
    .prepare(
      `INSERT INTO asset (id, name, raw_name, category, confidence, status, storage_mode, library_path, created_at, updated_at)
       VALUES (?, ?, ?, 'plugin', 0.9, 'classified', 'indexed', ?, ?, ?)`
    )
    .run(id, path.basename(libPath), path.basename(libPath), libPath, now, now)
}

function rowsOf(batchId: string): ImportLogRow[] {
  return listImportLogs(db, undefined, 500).filter((r) => r.batch_id === batchId)
}

/**
 * 抽取根下还剩**哪几个文件**。
 * 清没清干净要看文件，不能看目录 —— `releaseMemberDir` 按设计只删自己那一层 `<seq>`，
 * `<assetId>` 那层留着空壳（它可能被同素材的另一条共用），
 * 所以 `existsSync(<root>/CARDM)` 这种断言永远为真，抓不到任何东西。
 */
function leftoverFiles(): string[] {
  if (!fs.existsSync(extractRoot)) return []
  const out: string[] = []
  const walk = (dir: string): void => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name)
      if (e.isDirectory()) walk(full)
      else out.push(path.relative(extractRoot, full))
    }
  }
  walk(extractRoot)
  return out
}

/** 抽取根下某个素材还剩几层 `<seq>` 目录 */
function seqDirsOf(assetId: string): string[] {
  const dir = path.join(extractRoot, assetId)
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name)
}

function planInput(picks: FoundPackage[], over: Record<string, unknown> = {}) {
  /**
   * R4 ② 之后 `PlanInput` 收的是 `sources[]`（一批可以来自好几张卡）。
   * 这里保留 `containerAssetId` / `containerPath` 两个旧写法当覆盖项，
   * 让下面那二十来个用例不必各自改一遍 —— 但**只翻译成一条 source**，
   * 多卡的样子另有专门的用例（「多选卡批量」那一组）。
   */
  const { containerAssetId, containerPath, ...rest } = over as {
    containerAssetId?: string
    containerPath?: string
  }
  return {
    projectId,
    /**
     * 默认用**清单里那张卡**的 id。
     * 写成固定 'CARD1' 的时候，下面一堆
     * `expect(fs.existsSync(path.join(extractRoot, 'CARDM'))).toBe(false)`
     * 断的是"一个从来没被创建过的路径"—— 永远真，永远抓不到 bug（假绿）。
     * 目录归哪个素材管，得跟着清单走。
     */
    sources: [
      {
        assetId: String(containerAssetId ?? picks[0]?.origin.containerAssetId ?? 'CARD1'),
        path: String(containerPath ?? picks[0]?.origin.originArchive ?? picks[0]?.path ?? library),
        picks
      }
    ],
    extractRoot,
    libraryRoot: library,
    /**
     * 注入**磁盘读数**（不是规则）：本机的临时目录在 C 盘，而"C 盘不去抽取"正是
     * 这道闸门要拒的事 —— 不给注入，"抽→导→清"这条正向链就在离线用例里跑不起来。
     * 闸门本身（三条规则）在下面的「闸门」组和 `extract-root.spec.ts` 里单测，
     * 那几组用的是默认读数 + 假路径字符串。
     */
    disk: { freeBytes: () => 50 * GB, driveOf: () => 'e' },
    ...rest
  }
}

/** 造一个"外层 zip 里装着 N 个真 .unitypackage"的卡，返回它的成员清单 */
async function archiveCard(
  assetId: string,
  fileBase: string,
  packages: Array<{ rel: string; guid: string; unityPath: string }>
): Promise<FoundPackage[]> {
  const src = path.join(tmp, 'src-' + fileBase.replace(/[^a-z0-9]/gi, '_'))
  for (const p of packages) {
    const full = path.join(src, p.rel)
    await buildPackageWithGuids(full, [{ guid: p.guid, unityPath: p.unityPath }])
  }
  const zip = path.join(library, fileBase + '.zip')
  makeZip(src, zip, packages.map((p) => p.rel))
  await insertAsset(assetId, zip)
  const listed = await packagesOfAsset(db, assetId)
  expect(listed.kind).toBe('archive')
  return listed.packages
}

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'avca-m5b-'))
  /** 备份/暂存这些运行时目录指到本文件自己的临时目录，别和并行跑的 spec 共用 */
  setAppPathsForTest(path.join(tmp, 'appdata'))
  project = path.join(tmp, 'projects', 'shinano-Main2')
  library = path.join(tmp, 'vrc', 'A')
  /** 抽取根 = 库根的兄弟目录（默认推导就是这个形状） */
  extractRoot = path.join(tmp, 'vrc', 'A__extract')
  fs.mkdirSync(path.join(project, 'Assets'), { recursive: true })
  /** 装一份桥接（只要 package.json 在，isBridgeInstalled 就为真） */
  const bridgeDir = path.join(project, 'Packages', 'com.avca.bridge', 'Editor')
  fs.mkdirSync(bridgeDir, { recursive: true })
  fs.writeFileSync(path.join(project, 'Packages', 'com.avca.bridge', 'package.json'), '{"name":"com.avca.bridge"}', 'utf8')
  fs.writeFileSync(path.join(bridgeDir, 'AVCABridge.cs'), '// bridge', 'utf8')
  fs.writeFileSync(path.join(bridgeDir, 'AVCA.Bridge.asmdef'), '{}', 'utf8')
  fs.mkdirSync(library, { recursive: true })
  /**
   * 心跳必须写。`preflight` 第一件事就是查 `Temp/AVCABridge/bridge.json` 新不新
   * （§4.3：Unity 没开就不许导），没心跳的话**每一条**用例都会以
   * `unity.errNoBridgeHeartbeat` 停在计划阶段 —— 而那是工程侧的失败，整批直接退。
   */
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

  db = openDatabase(path.join(tmp, 'library.db'))
  projectId = upsertProject(db, { path: project, name: 'shinano-Main2', unityVersion: '2022.3.22f1' }).id
})

afterEach(() => {
  closeDatabase()
  try {
    fs.rmSync(tmp, { recursive: true, force: true })
  } catch {
    /* 交给系统 */
  }
})

describe('主链路：列清单 → 抽 → 预扫描 → 导入 → 记账 → 清副本', () => {
  /**
   * 真库里 68/77 张压缩包卡就是这个形状：
   * 外层一个压缩包，里面**一层同名目录**装着唯一一个 .unitypackage。
   * 老代码按 basename 找落点，这 22/68 个"包在子目录里"的从来没被读到过（P0-1）。
   */
  it('压缩包型容器（成员在子目录里）走通，V5 三列记全，副本删干净', async () => {
    const picks = await archiveCard('CARD1', 'card', [
      { rel: 'prodA/A.unitypackage', guid: GUID_A, unityPath: 'Assets/Demo/A.prefab' }
    ])
    expect(picks).toHaveLength(1)
    /** 还没抽：路径必须是 null，不能放一个"看起来像"的假路径 */
    expect(picks[0].path).toBeNull()
    expect(picks[0].relPath).toBe('prodA/A.unitypackage')

    const zip = path.join(library, 'card.zip')
    const { bridge, calls } = fakeBridge(NO_CONFLICT)
    const out = await planMemberImport(db, bridge, planInput(picks, { containerPath: zip }))
    expect(out.ok).toBe(true)
    if (!out.ok) return
    const plan = out.plan
    /** 落盘的只有那一个成员 */
    expect(fs.existsSync(plan.items[0].localPath)).toBe(true)
    expect(path.normalize(plan.items[0].localPath).startsWith(path.normalize(extractRoot))).toBe(true)
    expect(plan.items[0].extractDir).not.toBeNull()
    expect(plan.items[0].preflight.entryCount).toBe(1)
    /** 计划阶段一个导入命令都没发（只读） */
    expect(calls.map((c) => c.type)).toEqual(['resolve_guids'])

    const done = await commitMemberImport(db, bridge, plan, { trashFn: async () => undefined })
    expect(done.imported).toBe(1)
    expect(done.failed).toBe(0)
    expect(done.notRun).toBe(0)
    expect(done.cleanupFailed).toBe(0)
    /** 终态之后临时目录必须没了 */
    expect(fs.existsSync(plan.items[0].extractDir as string)).toBe(false)

    const importCall = calls.find((c) => c.type === 'import_unitypackage')
    expect(importCall?.payload.path).toBe(plan.items[0].localPath)

    const rows = rowsOf(plan.batchId)
    expect(rows).toHaveLength(1)
    expect(rows[0].status).toBe('ok')
    expect(rows[0].kind).toBe('import')
    /** V5 三列：事后唯一能说出"这是从哪个容器的哪个成员来的"的东西 */
    expect(rows[0].container_asset_id).toBe('CARD1')
    expect(rows[0].member_rel_path).toBe('prodA/A.unitypackage')
    expect(rows[0].origin_archive).toBe(zip)
    /** unitypackage_path 指的是那份已经不存在的副本 —— 历史事实，不承诺存活 */
    expect(rows[0].unitypackage_path).toBe(plan.items[0].localPath)
    expect(fs.existsSync(rows[0].unitypackage_path as string)).toBe(false)
    /** asset_id 也要是用户点的那张卡，"这张卡导入过"才查得到 */
    expect(rows[0].asset_id).toBe('CARD1')
  })

  it('散装单包：V5 三列留 NULL（"散装直导"与"容器成员"是两种事实，不许混填）', async () => {
    const pkg = path.join(library, 'loose-direct.unitypackage')
    await buildPackageWithGuids(pkg, [{ guid: GUID_A, unityPath: 'Assets/Demo/A.prefab' }])
    await insertAsset('CARD2', pkg)

    const listed = await packagesOfAsset(db, 'CARD2')
    expect(listed.kind).toBe('loose')
    expect(listed.packages[0].path).toBe(pkg)

    const { bridge } = fakeBridge(NO_CONFLICT)
    const out = await planMemberImport(db, bridge, planInput(listed.packages))
    expect(out.ok).toBe(true)
    if (!out.ok) return
    /** 磁盘上就有的东西**不复制** —— 复制一份再导，删的时候就有机会删错 */
    expect(out.plan.items[0].extractDir).toBeNull()
    expect(out.plan.items[0].localPath).toBe(pkg)

    const done = await commitMemberImport(db, bridge, out.plan, { trashFn: async () => undefined })
    expect(done.imported).toBe(1)
    const row = rowsOf(out.plan.batchId)[0]
    expect(row.container_asset_id).toBeNull()
    expect(row.member_rel_path).toBeNull()
    expect(row.origin_archive).toBeNull()
    expect(fs.existsSync(pkg)).toBe(true)
  })

  it('目录型容器导完之后，库里那个 .unitypackage 必须一字节都没变', async () => {
    const dir = path.join(library, '合集')
    fs.mkdirSync(dir, { recursive: true })
    const pkg = path.join(dir, 'B.unitypackage')
    await buildPackageWithGuids(pkg, [{ guid: GUID_B, unityPath: 'Assets/Demo/B.prefab' }])
    const before = fs.readFileSync(pkg)
    await insertAsset('CARD3', dir)

    const listed = await packagesOfAsset(db, 'CARD3')
    expect(listed.kind).toBe('loose')
    const { bridge } = fakeBridge(NO_CONFLICT)
    const out = await planMemberImport(db, bridge, planInput(listed.packages))
    expect(out.ok).toBe(true)
    if (!out.ok) return
    const done = await commitMemberImport(db, bridge, out.plan, { trashFn: async () => undefined })
    expect(done.imported).toBe(1)
    /**
     * ⚠ 这就是 `releaseMemberDir(dir, mustBeUnder)` 那道闸门存在的理由：
     * 目录型成员的路径就在库里，一旦哪天把 `localPath` 当 `extractDir` 传进去，
     * 症状是"导入报成功、素材卡还在、文件没了"。
     */
    expect(fs.existsSync(pkg), '把库里的原件删了 —— 抽取根闸门失效').toBe(true)
    expect(fs.readFileSync(pkg)).toEqual(before)
    /** 没抽东西就不该在抽取根下留目录 */
    expect(fs.existsSync(path.join(extractRoot, 'CARD3'))).toBe(false)
    expect(done.cleanupFailed).toBe(0)
  })
})

describe('闸门：不够就不开工，而且是在写盘之前', () => {
  async function oneMemberCard(): Promise<FoundPackage[]> {
    return archiveCard('CARDZ', 'gate', [{ rel: 'A.unitypackage', guid: GUID_A, unityPath: 'Assets/A.prefab' }])
  }

  it('空间不够 → 整批不开始，抽取根一个字节都没写', async () => {
    const picks = await oneMemberCard()
    const { bridge, calls } = fakeBridge(NO_CONFLICT)
    /** 用假路径 + 真盘符读数：闸门在写盘之前就退了，所以那个路径根本不会被创建 */
    const out = await planMemberImport(db, bridge, {
      ...planInput(picks, {
        extractRoot: 'D:\\scratch\\A__extract',
        disk: { freeBytes: () => 1 * GB }
      })
    })
    expect(out.ok).toBe(false)
    if (out.ok) return
    expect(out.reasonKey).toBe('err.extractNoSpace')
    /** 参数是给界面显示"剩多少、要多少"的，不能只回一句"空间不足" */
    expect(out.reasonParams?.freeGB).toBe(1)
    expect(typeof out.reasonParams?.needGB).toBe('number')
    expect(fs.existsSync(extractRoot), '闸门在落盘之后才拦 —— 已经摊下去了').toBe(false)
    expect(calls).toEqual([])
  })

  it('抽取根落在库内 → 拒绝，且不在库里建任何目录', async () => {
    const picks = await oneMemberCard()
    const { bridge } = fakeBridge(NO_CONFLICT)
    const out = await planMemberImport(db, bridge, planInput(picks, {
      /** 库内在库内 —— 这条判据排在盘符之前，所以 C 盘的临时库根照样能测 */
      extractRoot: path.join(library, 'A__extract'),
      disk: {}
    }))
    expect(out.ok).toBe(false)
    if (out.ok) return
    expect(out.reasonKey).toBe('err.extractInsideLibrary')
    expect(fs.existsSync(path.join(library, 'A__extract'))).toBe(false)
  })

  it('抽取根落在 C 盘 → 拒绝', async () => {
    const picks = await oneMemberCard()
    const { bridge } = fakeBridge(NO_CONFLICT)
    const out = await planMemberImport(db, bridge, planInput(picks, {
      extractRoot: 'C:\\Temp\\A__extract',
      disk: {}
    }))
    expect(out.ok).toBe(false)
    if (out.ok) return
    expect(out.reasonKey).toBe('err.extractOnSystemDrive')
    expect(fs.existsSync(extractRoot)).toBe(false)
  })

  it('`\\\\?\\C:\\` 这种写法落到主链路上也一样拒（闸门没有第二套口径）', async () => {
    const picks = await oneMemberCard()
    const { bridge } = fakeBridge(NO_CONFLICT)
    const out = await planMemberImport(db, bridge, planInput(picks, {
      extractRoot: '\\\\?\\C:\\Temp\\A__extract',
      disk: {}
    }))
    expect(out.ok).toBe(false)
    if (out.ok) return
    expect(out.reasonKey).toBe('err.extractOnSystemDrive')
  })

  it('超过 IMPORT_BATCH_MAX → 不开始（闸门在链路里，不在界面里）', async () => {
    const picks = await oneMemberCard()
    const fat: FoundPackage[] = []
    for (let i = 0; i < IMPORT_BATCH_MAX + 1; i++) fat.push({ ...picks[0], relPath: `batch-${i}.unitypackage` })
    const { bridge, calls } = fakeBridge(NO_CONFLICT)
    const out = await planMemberImport(db, bridge, planInput(fat))
    expect(out.ok).toBe(false)
    if (out.ok) return
    expect(out.reasonKey).toBe('err.batchTooBig')
    expect(out.reasonParams).toEqual({ count: IMPORT_BATCH_MAX + 1, max: IMPORT_BATCH_MAX })
    expect(calls).toEqual([])
    expect(fs.existsSync(extractRoot)).toBe(false)
  })

  it('空勾选 → 不开始（也不许当成"全部"）', async () => {
    const { bridge, calls } = fakeBridge(NO_CONFLICT)
    const out = await planMemberImport(db, bridge, planInput([]))
    expect(out.ok).toBe(false)
    if (out.ok) return
    expect(out.reasonKey).toBe('err.batchEmpty')
    expect(calls).toEqual([])
  })

  it('界面重复回传同一条成员 → 只算一份', async () => {
    const picks = await oneMemberCard()
    const { bridge } = fakeBridge(NO_CONFLICT)
    const out = await planMemberImport(db, bridge, planInput([picks[0], { ...picks[0] }]))
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.plan.items).toHaveLength(1)
    expect(await abandonMemberPlan(out.plan)).toEqual({ released: 1, failed: 0 })
  })
})

describe('失败归因：一类一个 key，不许合成一句"抽取失败"', () => {
  it('名字叫压缩包、magic bytes 不认 → 列不出成员，而不是谎报"包坏了"', async () => {
    const zip = path.join(library, 'bad.zip')
    fs.mkdirSync(path.dirname(zip), { recursive: true })
    fs.writeFileSync(zip, '这不是一个真的压缩包')
    await insertAsset('CARDB', zip)
    const listed = await packagesOfAsset(db, 'CARDB')
    /** 清单阶段就没有成员（列不出来），计划阶段收到空勾选 */
    expect(listed.packages).toEqual([])
    expect(listed.kind).toBe('empty')
    const { bridge } = fakeBridge(NO_CONFLICT)
    const out = await planMemberImport(db, bridge, planInput(listed.packages))
    expect(out.ok).toBe(false)
    if (out.ok) return
    /**
     * 关键是**不能**报成 `err.corrupt` —— 那个说法会把用户支去重新下载，
     * 而这个文件本来就不是压缩包（真库里就有 2 个这种"名字叫 .zip 的目录"）。
     */
    expect(out.reasonKey).not.toBe('err.corrupt')
    expect(out.reasonKey).toBe('err.batchEmpty')
  })

  it('清单过期（来源与清单对不上）→ 拒绝抽那一条，绝不"抽个看着像的"顶上', async () => {
    const picks = await archiveCard('CARDM', 'mixed', [
      { rel: 'good.unitypackage', guid: GUID_A, unityPath: 'Assets/A.prefab' }
    ])
    /**
     * 界面回传的 `relPath` 指向一条已经不存在的成员，而 `origin.memberRelPath`
     * 还是**上一个成员**的路径（用户列完清单又重新摄取过这张卡才会这样）。
     * 以前这里写的是 `origin.memberRelPath ?? pick.relPath` —— 于是 A 抽出**上一个成员**
     * 导进工程，用户以为导的是他点的那个。拿错包导入比导不进去严重得多。
     */
    const stale: FoundPackage = {
      ...picks[0],
      relPath: '已经不在这个包里的.unitypackage'
    }
    const { bridge } = fakeBridge(NO_CONFLICT)
    const out = await planMemberImport(db, bridge, planInput([picks[0], stale]))
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.plan.items).toHaveLength(1)
    expect(out.plan.blocked).toHaveLength(1)
    expect(out.plan.blocked[0].reasonKey).toBe('err.memberMissing')
    /** blocked 只挡那一条，不挡整批 —— 用户要的是"12 个能导、1 个要密码" */
    const done = await commitMemberImport(db, bridge, out.plan, { trashFn: async () => undefined })
    expect(done.imported).toBe(1)
    /** 挡掉的那条与导完的那条都不该在抽取根下留文件 */
    expect(leftoverFiles()).toEqual([])
  })

  it('包里有个假的 .unitypackage → 抽得出来、解析不了，只挡那一条', async () => {
    /**
     * 真库里这种"名字叫 .unitypackage 其实不是"的东西不少（收编时按扩展名登记的）。
     * 它抽得出来，`parseUnitypackage` 才会退 —— 那是**一包**的事，
     * 不能因为它把整批判死；而它那一份副本已经落盘了，必须当场收掉。
     */
    const src = path.join(tmp, 'fake-src')
    fs.mkdirSync(src, { recursive: true })
    fs.writeFileSync(path.join(src, 'fakeso.unitypackage'), 'this is not a unitypackage at all')
    await buildPackageWithGuids(path.join(src, 'real.unitypackage'), [
      { guid: GUID_A, unityPath: 'Assets/A.prefab' }
    ])
    const zip = path.join(library, 'fake.zip')
    makeZip(src, zip, ['fakeso.unitypackage', 'real.unitypackage'])
    await insertAsset('CARDFAKE', zip)
    const picks = (await packagesOfAsset(db, 'CARDFAKE')).packages
    expect(picks).toHaveLength(2)

    const { bridge } = fakeBridge(NO_CONFLICT)
    const out = await planMemberImport(db, bridge, planInput(picks))
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.plan.items).toHaveLength(1)
    expect(out.plan.blocked).toHaveLength(1)
    expect(out.plan.blocked[0].reasonKey).toBe('unity.errParse')
    /** 解析不了那一条的 `<seq>` 目录不该留在盘上等启动 prune */
    expect(seqDirsOf('CARDFAKE')).toHaveLength(1)
    expect(leftoverFiles()).toHaveLength(1)
    await abandonMemberPlan(out.plan)
  })

  it('成员真的不在了（重新摄取过）→ 抽不出东西，那条的目录当场收回', async () => {
    /**
     * 和上面那条的区别要紧：这里 `relPath` 与 `origin.memberRelPath` **是一致的**
     * （清单过期之前它们本来就是同一条），只是包里没有那个成员了。
     * 于是走的不是"来源不符"闸门，而是 `extractMembers` 返回空 ——
     * 那一条路径上分配的 `<seq>` 目录必须自己收掉，
     * 不然一次失败批量就在抽取根下留一排空壳，而界面上"清理失败 N 个"是假的。
     */
    const picks = await archiveCard('CARDGONE', 'gone', [
      { rel: 'here.unitypackage', guid: GUID_A, unityPath: 'Assets/A.prefab' }
    ])
    const ghost: FoundPackage = {
      ...picks[0],
      relPath: 'used-to-be-here.unitypackage',
      origin: {
        containerAssetId: 'CARDGONE',
        originArchive: picks[0].origin.originArchive,
        memberRelPath: 'used-to-be-here.unitypackage'
      }
    }
    const { bridge } = fakeBridge(NO_CONFLICT)
    const out = await planMemberImport(db, bridge, planInput([picks[0], ghost]))
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.plan.items).toHaveLength(1)
    expect(out.plan.blocked).toEqual([
      { relPath: 'used-to-be-here.unitypackage', reasonKey: 'err.memberMissing', detail: null }
    ])
    /** `<seq>` = 1 是那条鬼成员用的 —— 它不该留在盘上 */
    expect(fs.existsSync(path.join(extractRoot, 'CARDGONE', '1'))).toBe(false)
    expect(fs.existsSync(path.join(extractRoot, 'CARDGONE', '0'))).toBe(true)
    await abandonMemberPlan(out.plan)
  })

  it('工程侧不在线 → 整批不规划，且已经抽出来的副本立刻收干净', async () => {
    const picks = await archiveCard('CARDH', 'hb', [
      { rel: 'A.unitypackage', guid: GUID_A, unityPath: 'Assets/A.prefab' }
    ])
    /** 把桥接目录删掉 → 预扫描直接报 errBridgeMissing（工程侧，不是包侧） */
    fs.rmSync(path.join(project, 'Packages', 'com.avca.bridge'), { recursive: true, force: true })
    const { bridge } = fakeBridge(NO_CONFLICT)
    const out = await planMemberImport(db, bridge, planInput(picks))
    expect(out.ok).toBe(false)
    if (out.ok) return
    expect(out.reasonKey).toBe('unity.errBridgeMissing')
    /** 工程侧失败：抽到一半的那个 `<seq>` 目录必须当场删掉，不能留给启动 prune */
    expect(fs.existsSync(path.join(extractRoot, 'CARDH', '0'))).toBe(false)
  })

  it('包解析不了（只挡那一包）→ blocked 里是 unity.errParse，不是整批失败', async () => {
    const picks = await archiveCard('CARDP', 'parse', [
      { rel: '好.unitypackage', guid: GUID_A, unityPath: 'Assets/A.prefab' }
    ])
    /** 第二条来自同一个包，但路径指向一个不是 unitypackage 的东西 */
    const fake: FoundPackage = {
      ...picks[0],
      relPath: 'A.unitypackage',
      path: path.join(library, '假装是包.txt'),
      origin: { containerAssetId: 'CARDP', originArchive: null, memberRelPath: null }
    }
    fs.writeFileSync(fake.path as string, 'plain text, not a unitypackage')
    const { bridge } = fakeBridge(NO_CONFLICT)
    const out = await planMemberImport(db, bridge, planInput([picks[0], fake]))
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.plan.items).toHaveLength(1)
    expect(out.plan.blocked.some((b) => b.reasonKey === 'unity.errParse')).toBe(true)
    await abandonMemberPlan(out.plan)
  })
})

describe('串行与半批：失败停下、不自动回滚、剩余记为未执行', () => {
  /**
   * 一张装着两个成员的压缩包卡，走一遍规划。
   * `fake` 可以传进来 —— 要数"预扫描到底重跑了几次"的用例必须让**计划与导入共用一个假件**，
   * 各造各的话两边的调用记录是分开的，那种断言数出来的数没有意义。
   */
  async function twoMembers(fake?: { bridge: BridgeLike; calls: FakeCall[] }): Promise<MemberPlan> {
    const picks = await archiveCard('CARD2M', 'two', [
      { rel: 'x/X.unitypackage', guid: GUID_A, unityPath: 'Assets/X.prefab' },
      { rel: 'y/Y.unitypackage', guid: GUID_B, unityPath: 'Assets/Y.prefab' }
    ])
    const use = fake ?? fakeBridge(NO_CONFLICT)
    const out = await planMemberImport(db, use.bridge, planInput(picks))
    if (!out.ok) throw new Error('规划失败：' + out.reasonKey)
    return out.plan
  }

  it('第 1 条 Unity 退回失败 → 停手，第 2 条记为未执行，不发 delete_guids', async () => {
    const plan = await twoMembers()
    const { bridge, calls } = fakeBridge({
      ...NO_CONFLICT,
      import_unitypackage: { ok: false, status: 'error', error: 'Unity 报错了' }
    })
    const done = await commitMemberImport(db, bridge, plan, { trashFn: async () => undefined })
    expect(done.imported).toBe(0)
    expect(done.failed).toBe(1)
    expect(done.notRun).toBe(1)
    expect(done.stoppedReasonKey).toBe('unity.errImportFailed')
    /** 只发了一条导入命令 —— 没在一个报错的编辑器上继续捶 */
    expect(calls.filter((c) => c.type === 'import_unitypackage')).toHaveLength(1)
    /** 没有 delete_guids：不自动回滚（§7-R2，自动删用户工程文件比留着更危险） */
    expect(calls.filter((c) => c.type === 'delete_guids')).toHaveLength(0)
    /** 只有一条 import_log：压根没执行的那条不编造记录 */
    const rows = rowsOf(plan.batchId)
    expect(rows).toHaveLength(1)
    expect(rows[0].status).toBe('failed')
    /** 没跑到的那条的副本也要收干净 */
    expect(fs.existsSync(path.join(extractRoot, 'CARD2M', '1'))).toBe(false)
  })

  it('第 2 条失败 → 第 1 条留在工程里，两条记录都在，撤销如实报"卡在第几条"', async () => {
    const plan = await twoMembers()
    let n = 0
    const { bridge, calls } = fakeBridge({
      ...NO_CONFLICT,
      get import_unitypackage() {
        n++
        return n === 1
          ? { ok: true, data: { createdGuids: [GUID_A], overwrittenGuids: [] } }
          : { ok: false, status: 'error', error: '第二个包坏了' }
      }
    })
    const done = await commitMemberImport(db, bridge, plan, { trashFn: async () => undefined })
    expect(done.imported).toBe(1)
    expect(done.failed).toBe(1)
    expect(done.notRun).toBe(0)
    /** 停下来要说为什么停：界面拿它拼"第 2 条失败，已停手，后面没有未执行的" */
    expect(done.stoppedReasonKey).toBe('unity.errImportFailed')
    const rows = rowsOf(plan.batchId)
    expect(rows).toHaveLength(2)
    expect(rows.map((r) => r.status).sort()).toEqual(['failed', 'ok'])
    /** 每条各一份 import_log（不是"一批一份"） */
    expect(new Set(rows.map((r) => r.id))).toHaveLength(2)
    expect(done.results.find((r) => r.ok)?.createdGuids).toEqual([GUID_A])
    /** 两条的成员路径不同，各自能说出自己是谁 */
    expect(new Set(rows.map((r) => r.member_rel_path))).toEqual(new Set(['x/X.unitypackage', 'y/Y.unitypackage']))

    /** 倒序撤销：第一条要撤的是"最后成功的那条"，而 failed 的那条不参与撤销 */
    const okRow = rows.find((r) => r.status === 'ok')
    const seen: string[] = []
    const rb = await rollbackMemberBatch(db, plan.batchId, async (_p, importId) => {
      seen.push(importId)
      return {
        ok: importId === okRow?.id,
        importId,
        deletedFiles: importId === okRow?.id ? ['Assets/X.prefab'] : [],
        restoredFiles: [],
        unrestorable: 0,
        error: importId === okRow?.id ? null : '不该被撤到'
      }
    })
    expect(seen).toEqual([okRow?.id])
    expect(rb.rolledBack).toBe(1)
    expect(rb.attempted).toBe(1)
    /** rows.length 是"能撤的行"的总数（failed 那条被过滤掉了），所以撤完就是 ok */
    expect(rb.ok).toBe(true)
    expect(calls.filter((c) => c.type === 'delete_guids')).toHaveLength(0)
  })

  it('整批成功 → 倒序撤销：后导入的那条先撤', async () => {
    const plan = await twoMembers()
    const { bridge } = fakeBridge(NO_CONFLICT)
    const done = await commitMemberImport(db, bridge, plan, { trashFn: async () => undefined })
    expect(done.imported).toBe(2)
    /**
     * 期望顺序从 `done.results` 推，不自己写死 'y 在前 x 在后'。
     * 成员进计划的顺序是**体积降序**（`sortableMembers`），两个包谁大 1 字节由 gzip 决定 ——
     * 写死顺序等于断言压缩结果，而且真反了实现也可能被测成绿。
     */
    const commitOrder = done.results.map((r) => r.relPath)
    expect(commitOrder).toHaveLength(2)

    const seen: string[] = []
    const rb = await rollbackMemberBatch(db, plan.batchId, async (_p, importId) => {
      const row = rowsOf(plan.batchId).find((r) => r.id === importId)
      seen.push(row?.member_rel_path ?? '?')
      return { ok: true, importId, deletedFiles: ['Assets/X.prefab'], restoredFiles: [], unrestorable: 0, error: null }
    })
    expect(rb.rolledBack).toBe(2)
    expect(rb.ok).toBe(true)
    /** ⚠ 这一条抓的是"正序撤"：第一个被撤的必须是最后进工程的那个 */
    expect(seen).toEqual([...commitOrder].reverse())
  })

  it('撤销只碰 status=ok 的行，且 import/import_rollback 都不许带 assetIds', async () => {
    const plan = await twoMembers()
    const { bridge } = fakeBridge(NO_CONFLICT)
    await commitMemberImport(db, bridge, plan, { trashFn: async () => undefined })
    const rows = rowsOf(plan.batchId)
    await rollbackMemberBatch(db, plan.batchId, async (_p, importId) => ({
      ok: true,
      importId,
      deletedFiles: [],
      restoredFiles: [],
      unrestorable: 0,
      error: null
    }))
    const journals = db
      .prepare(`SELECT op, payload_json FROM journal WHERE op IN ('import','import_rollback')`)
      .all() as Array<{ op: string; payload_json: string }>
    expect(journals.length).toBeGreaterThan(0)
    for (const j of journals) {
      const p = JSON.parse(j.payload_json) as { assetIds?: string[] }
      /**
       * `undoLast` 会把同批每行的 `payload.assetIds` 攒起来，整批撤完 `deleteAssetRow`。
       * 一次 Ctrl+Z 绝不该把用户点的那张卡从库里删掉 —— 台账在 import_log 里。
       */
      expect(p.assetIds ?? [], `${j.op} 的 journal 里不许带 assetIds`).toEqual([])
    }
    /**
     * 这里**不断言 status 翻成 rolledback** —— 撤的动作是注入的桩，
     * 真翻状态的是 `coordinator.rollbackImport`（那边有自己的用例）。
     * 桩能证明的只有"哪些行被交去撤了、顺序对不对"。
     */
    /** 撤销不删库里的素材卡（用户点的那张卡必须还在） */
    expect(db.prepare(`SELECT COUNT(*) AS n FROM asset WHERE id = 'CARD2M'`).get()).toEqual({ n: 1 })
  })

  it('Ctrl+Z 不会撞上 import 行（撞上了就是按一次什么都没撤、还把行标成 failed）', async () => {
    /**
     * 顺序要紧：先留一条**真正该被 Ctrl+Z 撤**的文件操作，再导包。
     * 因为 import 那两条 journal 是这批里最后写的，`undoLast` 从最新一条找起 ——
     * 找得到谁，全看 `lastRevertible` 的白名单里有没有 'import'。
     */
    db.prepare(
      `INSERT INTO journal (op, payload_json, undone, status, created_at) VALUES ('rename','{"from":"a","to":"b"}',0,'done',?)`
    ).run(Date.now())
    const plan = await twoMembers()
    const { bridge } = fakeBridge(NO_CONFLICT)
    await commitMemberImport(db, bridge, plan, { trashFn: async () => undefined })

    /** 真的那个：跳过 import，落在 rename 上 */
    expect(lastRevertible(db)?.op).toBe('rename')
    /** 旧的白名单（带 import）复现一遍 —— 它现在会挑中 import 行 */
    const naive = db
      .prepare(
        `SELECT op FROM journal WHERE undone = 0 AND status = 'done'
         AND op IN ('move','copy','extract','mkdir','rename','trash','import','register','reparent','reanalyze')
         ORDER BY id DESC LIMIT 1`
      )
      .get() as { op: string }
    expect(naive.op).toBe('import')
    /**
     * 为什么这条值得留：`undoOne` 碰到 import 只会抛"将在 M5 交付"，
     * 而 `markUndone(带 error)` 会把那行标成 failed 并**整次撤销中止** ——
     * 症状就是"按 Ctrl+Z 没反应"，而且导一次包就坏一次，
     * 批量导入留 N 条 import 行时还要坏 N 次。
     */
    const src = fs.readFileSync(path.resolve(__dirname, '../../src/main/db/repos/journal.ts'), 'utf8')
    const body = src.slice(src.indexOf('export function lastRevertible'), src.indexOf('export function markUndone'))
    expect(/'import'/.test(body), 'lastRevertible 的白名单里不能出现 import').toBe(false)
  })

  it('整批撤销接**真的** rollbackImport：只撤 ok 的行，两条都撤干净', async () => {
    const plan = await twoMembers()
    const { bridge, calls } = fakeBridge(NO_CONFLICT)
    const done = await commitMemberImport(db, bridge, plan, { trashFn: async () => undefined })
    expect(done.imported).toBe(2)

    /**
     * 上面那组用例传的是桩，桩只证明"哪些行被交出去了"。
     * 这一条接 `coordinator.rollbackImport` 本体（桥接仍是照稿念的假货），
     * 于是"撤销写不写 journal、状态翻不翻、删的是不是白名单"这几件事也一并被串到了。
     */
    const rb = await rollbackMemberBatch(db, plan.batchId, (projectPath, importId) =>
      rollbackImport(db, bridge, projectPath, importId)
    )
    expect(rb.rolledBack).toBe(2)
    expect(rb.ok).toBe(true)
    /** 撤销走的是白名单删除：每条各发一次 delete_guids，allow 就是那次的 createdGuids */
    const dels = calls.filter((c) => c.type === 'delete_guids')
    expect(dels).toHaveLength(2)
    for (const d of dels) {
      const p = d.payload as { guids: string[]; allow: string[] }
      expect(p.allow).toEqual(p.guids)
      expect(p.guids).toEqual([GUID_A])
    }
    expect(rowsOf(plan.batchId).every((r) => r.status === 'rolledback')).toBe(true)
    /** 撤销记录也不带 assetIds（同一个理由：Ctrl+Z 不许删用户的卡） */
    const rbJournals = db
      .prepare(`SELECT payload_json FROM journal WHERE op = 'import_rollback'`)
      .all() as Array<{ payload_json: string }>
    expect(rbJournals.length).toBe(2)
    for (const j of rbJournals) {
      expect((JSON.parse(j.payload_json) as { assetIds?: string[] }).assetIds ?? []).toEqual([])
    }
    /** 用户点的那张卡必须还在库里 */
    expect(db.prepare(`SELECT COUNT(*) AS n FROM asset WHERE id = 'CARD2M'`).get()).toEqual({ n: 1 })
  })

  it('取消：当前这条跑完，后面的不再发（§5.2）', async () => {
    const plan = await twoMembers()
    let stop = false
    const { bridge, calls } = fakeBridge(NO_CONFLICT)
    const done = await commitMemberImport(db, bridge, plan, {
      trashFn: async () => undefined,
      shouldStop: () => stop,
      onItem: () => {
        stop = true
      }
    })
    expect(done.imported).toBe(1)
    expect(done.notRun).toBe(1)
    expect(done.stoppedReasonKey).toBe('err.importCancelled')
    expect(calls.filter((c) => c.type === 'import_unitypackage')).toHaveLength(1)
  })

  it('进度回调抛错不许把导入链带停', async () => {
    const plan = await twoMembers()
    const { bridge } = fakeBridge(NO_CONFLICT)
    const done = await commitMemberImport(db, bridge, plan, {
      trashFn: async () => undefined,
      onItem: () => {
        throw new Error('界面画挂了')
      }
    })
    expect(done.imported).toBe(2)
  })

  it('导入前重新预扫描：备份用的是当下的冲突表，不是计划那次算的', async () => {
    const existing = path.join(project, 'Assets', 'Existing')
    fs.mkdirSync(existing, { recursive: true })
    fs.writeFileSync(path.join(existing, 'A.prefab'), 'ORIGINAL', 'utf8')
    /**
     * 计划与导入**共用这个假件**。各造各的假件时 `calls` 是两份，
     * "预扫描重跑了几次"这种断言数出来的是假数（第一版就是这么假绿过去的）。
     */
    const fake = fakeBridge({
      ...NO_CONFLICT,
      /** 计划时"工程里没有"，用户按下确认时已经有人往同一个 GUID 放了东西 */
      resolve_guids: { ok: true, data: { resolved: { [GUID_A]: 'Assets/Existing/A.prefab' } } },
      import_unitypackage: { ok: true, data: { createdGuids: [], overwrittenGuids: [GUID_A] } }
    })
    const plan = await twoMembers(fake)
    const afterPlan = fake.calls.filter((c) => c.type === 'resolve_guids').length
    expect(afterPlan, '计划阶段每个成员各问一次 GUID').toBe(2)
    const done = await commitMemberImport(db, fake.bridge, plan, {
      choice: 'continue-with-backup',
      backupOverwritten: true,
      trashFn: async () => undefined
    })
    expect(done.imported).toBe(2)
    /** 确认阶段又各问了一遍 —— 备份拿的是这份新冲突表，不是 plan 里那份旧的 */
    expect(fake.calls.filter((c) => c.type === 'resolve_guids').length).toBe(afterPlan + 2)
    const rows = rowsOf(plan.batchId)
    const withBackup = rows.find((r) => r.backup_dir)
    expect(withBackup, '有冲突却没备份 = 用的还是计划那次那份旧冲突表').toBeTruthy()
    const manifest = JSON.parse(
      fs.readFileSync(path.join(withBackup?.backup_dir as string, 'manifest.json'), 'utf8')
    ) as { saved: Array<{ assetPath: string; file: string }> }
    expect(manifest.saved[0].assetPath).toBe('Assets/Existing/A.prefab')
    /** 备份的**内容**是当下那份 ORIGINAL，不是空文件 */
    expect(fs.readFileSync(path.join(withBackup?.backup_dir as string, manifest.saved[0].file), 'utf8')).toBe(
      'ORIGINAL'
    )
  })
})

describe('清理与同名成员', () => {
  it('abandon 只删自己抽的；抽取根下的目录随之清空', async () => {
    const picks = await archiveCard('CARDA', 'abandon', [
      { rel: 'A.unitypackage', guid: GUID_A, unityPath: 'Assets/A.prefab' }
    ])
    const { bridge } = fakeBridge(NO_CONFLICT)
    const out = await planMemberImport(db, bridge, planInput(picks))
    expect(out.ok).toBe(true)
    if (!out.ok) return
    const dir = out.plan.items[0].extractDir as string
    expect(fs.existsSync(dir)).toBe(true)

    expect(await abandonMemberPlan(out.plan)).toEqual({ released: 1, failed: 0 })
    expect(fs.existsSync(dir)).toBe(false)
    expect(fs.existsSync(extractRoot)).toBe(true)
    /**
     * 剩下的是**空壳目录**，不是副本 —— `releaseMemberDir` 按设计只删自己那一层 `<seq>`。
     * 所以这里数文件，不数目录（断 `existsSync(<root>/CARDA)` 永远是 true，抓不到东西）。
     */
    expect(leftoverFiles()).toEqual([])
  })

  it('同名成员在不同目录 → 用 seq 目录隔开，两份都活着、各是各的', async () => {
    const picks = await archiveCard('CARDN', 'samename', [
      { rel: 'p/PSD.unitypackage', guid: GUID_A, unityPath: 'Assets/p/PSD.prefab' },
      { rel: 'q/PSD.unitypackage', guid: GUID_B, unityPath: 'Assets/q/PSD.prefab' }
    ])
    expect(picks).toHaveLength(2)
    expect(new Set(picks.map((p) => path.basename(p.relPath)))).toEqual(new Set(['PSD.unitypackage']))

    const { bridge } = fakeBridge(NO_CONFLICT)
    const out = await planMemberImport(db, bridge, planInput(picks))
    expect(out.ok).toBe(true)
    if (!out.ok) return
    const items = out.plan.items
    expect(items).toHaveLength(2)
    /** 挤在同一个目录里就会互相覆盖：落点由 seq 目录隔开 */
    expect(items[0].localPath).not.toBe(items[1].localPath)
    expect(fs.existsSync(items[0].localPath)).toBe(true)
    expect(fs.existsSync(items[1].localPath)).toBe(true)
    /**
     * 各条对各自的来源，**不假设谁排前面**。
     * `packagesOfAsset` 出来的顺序是"体积降序"，而两个同名包谁大 1 字节
     * 由 gzip 决定 —— 断言顺序就是断言压缩结果，换台机器会红得莫名其妙。
     */
    const byRel = new Map(items.map((i) => [i.relPath, i]))
    expect([...byRel.keys()].sort()).toEqual(['p/PSD.unitypackage', 'q/PSD.unitypackage'])
    /** 内容各自独立：按 basename 猜就会两个都拿到同一个文件 */
    expect(fs.readFileSync(byRel.get('p/PSD.unitypackage')!.localPath)).not.toEqual(
      fs.readFileSync(byRel.get('q/PSD.unitypackage')!.localPath)
    )
    const done = await commitMemberImport(db, bridge, out.plan, { trashFn: async () => undefined })
    expect(done.imported).toBe(2)
    const rows = rowsOf(out.plan.batchId)
    expect(new Set(rows.map((r) => r.member_rel_path))).toEqual(new Set(['p/PSD.unitypackage', 'q/PSD.unitypackage']))
  })

  it('一个容器里 8 个成员（正好卡在 IMPORT_BATCH_MAX）全部走通', async () => {
    const eight = []
    for (let i = 0; i < IMPORT_BATCH_MAX; i++) {
      eight.push({ rel: `d${i}/P${i}.unitypackage`, guid: GUID_A, unityPath: `Assets/P${i}.prefab` })
    }
    const picks = await archiveCard('CARDE', 'eight', eight)
    expect(picks).toHaveLength(IMPORT_BATCH_MAX)
    const { bridge } = fakeBridge(NO_CONFLICT)
    const out = await planMemberImport(db, bridge, planInput(picks))
    expect(out.ok).toBe(true)
    if (!out.ok) return
    const done = await commitMemberImport(db, bridge, out.plan, { trashFn: async () => undefined })
    expect(done.imported).toBe(IMPORT_BATCH_MAX)
    expect(rowsOf(out.plan.batchId)).toHaveLength(IMPORT_BATCH_MAX)
    /** 一批 N 条记录 = 同一个 batch_id 串起来，界面才说得出"这批" */
    expect(new Set(rowsOf(out.plan.batchId).map((r) => r.batch_id))).toEqual(new Set([out.plan.batchId]))
    /** 抽完导完，抽取根下这个素材的目录应该没内容了 */
    expect(fs.existsSync(path.join(extractRoot, 'CARDE', '0'))).toBe(false)
  })
})

// ================================================================ R4 ② 多选卡批量

/**
 * 一批不再只来自一个容器：用户框选 5 张卡一键导入（规格 §8-4）。
 *
 * 这一组用例钉的是**记账形状**，不是"能不能跑通"：
 *  1. 每条 import_log 要记自己那张卡 —— 整批共享一个 `containerAssetId` 的旧写法
 *     会把第二张卡导的东西记到第一张卡头上，事后反查（R4 ⑥）就是假答案；
 *  2. 去重键必须是 `卡id:成员路径` —— 两个 zip 里各有一个 `A.unitypackage` 时，
 *     只按 relPath 去重会吃掉一条，表现是"勾了 5 个只导了 4 个"；
 *  3. 闸门看的是**合起来**的条数，不是每张卡各自 8。
 */
describe('R4 ② · 多选卡批量（一批来自好几张卡）', () => {
  const zipOf = (fileBase: string): string => path.join(library, fileBase + '.zip')

  it('两张卡各一个成员 → 一条批两条，import_log 各自记自己那张卡（不许串台）', async () => {
    const a = await archiveCard('CARD-A', 'carda', [{ rel: 'A.unitypackage', guid: GUID_A, unityPath: 'Assets/A/a.prefab' }])
    const b = await archiveCard('CARDB', 'cardb', [{ rel: 'B.unitypackage', guid: GUID_B, unityPath: 'Assets/B/b.prefab' }])
    const { bridge, calls } = fakeBridge(NO_CONFLICT)

    const out = await planMemberImport(
      db,
      bridge,
      planInput(a, {
        sources: [
          { assetId: 'CARD-A', path: zipOf('carda'), picks: a },
          { assetId: 'CARDB', path: zipOf('cardb'), picks: b }
        ]
      })
    )
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.plan.items).toHaveLength(2)
    /** 一批涉及哪几张卡：清理临时副本时的 busy 判定要用它，只记第一张会把另一张的副本当垃圾删了 */
    expect(out.plan.assetIds).toEqual(['CARD-A', 'CARDB'])

    const done = await commitMemberImport(db, bridge, out.plan, { trashFn: async () => undefined })
    expect(done.imported).toBe(2)

    const rows = rowsOf(out.plan.batchId)
    expect(rows).toHaveLength(2)
    expect(rows.map((r) => r.container_asset_id).sort()).toEqual(['CARD-A', 'CARDB'])
    expect(rows.map((r) => r.asset_id).sort()).toEqual(['CARD-A', 'CARDB'])
    /** 成员相对路径各归各的容器，不许因为两条都叫 "x.unitypackage" 就并成一个 */
    expect(rows.map((r) => r.member_rel_path).sort()).toEqual(['A.unitypackage', 'B.unitypackage'])
  })

  it('两张卡里成员同名 → 两条都算数（去重键是 卡id:成员路径，光按 relPath 会吃掉一条）', async () => {
    const a = await archiveCard('CARD-A2', 'carda2', [{ rel: 'Same.unitypackage', guid: GUID_A, unityPath: 'Assets/Same/a.prefab' }])
    const b = await archiveCard('CARDB2', 'cardb2', [{ rel: 'Same.unitypackage', guid: GUID_B, unityPath: 'Assets/Same/b.prefab' }])
    /** 清单给出来的两条 relPath 是一模一样的 —— 这正是旧去重键会出事的地方 */
    expect(a[0].relPath).toBe(b[0].relPath)
    const { bridge } = fakeBridge(NO_CONFLICT)

    const out = await planMemberImport(
      db,
      bridge,
      planInput(a, {
        sources: [
          { assetId: 'CARD-A2', path: zipOf('carda2'), picks: a },
          { assetId: 'CARDB2', path: zipOf('cardb2'), picks: b }
        ]
      })
    )
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.plan.items).toHaveLength(2)
    expect(out.plan.items.map((i) => i.assetId)).toEqual(['CARD-A2', 'CARDB2'])
    /** 同一批里两条同名成员的临时目录不能是同一个路径，否则后抽的盖掉先抽的 */
    expect(out.plan.items[0].extractDir).not.toBe(out.plan.items[1].extractDir)
  })

  it('跨卡合起来超过 8 条 → 整批不开始，抽取根一个字节都没写', async () => {
    const many = Array.from({ length: 8 }, (_, i) => ({
      rel: `p${i}.unitypackage`,
      guid: `0000000000000000e00000000000000${i}`,
      unityPath: `Assets/P${i}/p${i}.prefab`
    }))
    const a = await archiveCard('CARD-M1', 'cardm1', many)
    const b = await archiveCard('CARD-M2', 'cardm2', [
      { rel: 'last.unitypackage', guid: GUID_A, unityPath: 'Assets/Last/last.prefab' }
    ])
    const { bridge } = fakeBridge(NO_CONFLICT)
    const out = await planMemberImport(
      db,
      bridge,
      planInput(a, {
        sources: [
          { assetId: 'CARD-M1', path: zipOf('cardm1'), picks: a },
          { assetId: 'CARD-M2', path: zipOf('cardm2'), picks: b }
        ]
      })
    )
    expect(out.ok).toBe(false)
    if (out.ok) return
    expect(out.reasonKey).toBe('err.batchTooBig')
    expect(out.reasonParams).toEqual({ count: 9, max: 8 })
    /** 闸门在落盘之前：整棵抽取根都没被建出来 */
    expect(fs.existsSync(extractRoot)).toBe(false)
  })

  it('逐条进度按串行顺序回调，index 与 relPath 都对得上（界面那条队列靠它）', async () => {
    const a = await archiveCard('CARD-P1', 'cardp1', [{ rel: 'one.unitypackage', guid: GUID_A, unityPath: 'Assets/One/one.prefab' }])
    const b = await archiveCard('CARD-P2', 'cardp2', [{ rel: 'two.unitypackage', guid: GUID_B, unityPath: 'Assets/Two/two.prefab' }])
    const { bridge } = fakeBridge(NO_CONFLICT)
    const out = await planMemberImport(
      db,
      bridge,
      planInput(a, {
        sources: [
          { assetId: 'CARD-P1', path: zipOf('cardp1'), picks: a },
          { assetId: 'CARD-P2', path: zipOf('cardp2'), picks: b }
        ]
      })
    )
    expect(out.ok).toBe(true)
    if (!out.ok) return
    const seen: Array<{ i: number; rel: string; ok: boolean }> = []
    const done = await commitMemberImport(db, bridge, out.plan, {
      trashFn: async () => undefined,
      onItem: (r, i) => seen.push({ i, rel: r.relPath, ok: r.ok })
    })
    expect(seen).toEqual([
      { i: 0, rel: 'one.unitypackage', ok: true },
      { i: 1, rel: 'two.unitypackage', ok: true }
    ])
    expect(done.imported).toBe(2)
  })
})
