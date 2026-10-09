import fs from 'node:fs'
import path from 'node:path'
import log from 'electron-log'
import { ulid } from '../../shared/ulid'
import type { Db } from '../db'
import { getProject } from '../db/repos/unity'
import { rollbackOrderOfBatch } from '../db/repos/journal'
import { IMPORT_BATCH_MAX as SHARED_BATCH_MAX } from '../../shared/memberPick'
import { extractMembers, NotAnArchiveError } from '../unpack/members'
import { probeFile } from '../unpack/magic'
import { BackendUnsupportedError, CorruptArchiveError, PasswordNeededError } from '../unpack/sevenZip'
import { ExtractRootError, allocMemberDir, assertExtractRootUsable, releaseMemberDir, type DiskFacts } from './extractRoot'
import {
  importUnitypackage,
  preflight,
  type BridgeLike,
  type ConflictChoice,
  type PreflightResult,
  type RollbackResult
} from './coordinator'
import type {
  BatchOutcome,
  BatchRollbackOutcome,
  CommitItemResult,
  FoundPackage,
  MemberFailure,
  PackageOrigin,
  PlanFailure
} from '../../shared/types'

export type {
  BatchOutcome,
  BatchRollbackOutcome,
  CommitItemResult,
  MemberFailure,
  PlanFailure
} from '../../shared/types'

/**
 * **成员导入主链路**（M5-B ⑤）：抽取 → 空间闸门 → 逐包预扫描 → 串行导入 → 记账 → 清理 → 撤销。
 *
 * 设计见 `docs/M5B-DESIGN.md`（§3.1–§3.9、§4 那张数据流图）。这里只写实现与它的口径，
 * 但有三条是**代码层面钉死的**，因为它们各自的代价都实测过：
 *
 * 1. **一次调用只干半件事**。`planMemberImport` 只抽只读，`commitMemberImport` 才动工程。
 *    中间那一步是用户看冲突清单、点"继续 / 继续并备份 / 取消"的时间
 *    （§3.4 要的"一张汇总卡片"，不是弹 8 次窗）。
 *    把两件事合成一个函数，用户就没有机会在覆盖发生前看见要覆盖什么。
 * 2. **抽出来的副本只到 `<extractRoot>/<assetId>/<seq>/`**，终态即删，
 *    而删除永远带 `extractRoot` 当闸门（`releaseMemberDir` 的第二参数）。
 *    目录型容器的成员**不复制**、直接指向库里原件 —— 那种路径传错一次就会删掉用户的素材。
 * 3. **失败不自动回滚**（§7-R2）。已经进工程的东西留着，逐条可撤；
 *    自动删用户工程文件比留着更危险。
 */

/**
 * 单批上限（设计 §3.4）。数值本身住在 `shared/memberPick.ts`，
 * 因为界面要按同一个数切批 —— 两边各写一个 8，改了另一边就是"界面切 8、链路拒 9"那种错乱。
 *
 * 这个数字没有实测支撑，是"一屏能看完 + 一批失败可控 + 和串行闸门不打架"折出来的，
 * 所以它**只是闸门，不是建议值**：87 个包就是 11 批，慢是事实，
 * 但"装得比它快"是更糟的选项（单次导入在 Play 模式下最坏排队 28 分钟）。
 * 闸门必须在链路里，不在界面里 —— 绕过界面的调用也得有闸门兜着。
 */
export const IMPORT_BATCH_MAX = SHARED_BATCH_MAX

/**
 * 这些预扫描失败是**工程侧**的（桥接没装、Unity 没开、GUID 查不动）。
 * 逐包失败（包坏了、解析不了）只挡那一包；工程侧失败挡整批 ——
 * 整批 8 个包各等一遍退避（最长 28 分钟）来告诉你"Unity 没开"是不可接受的。
 */
const PROJECT_LEVEL_REASONS = new Set([
  'unity.errNoProject',
  'unity.errBridgeMissing',
  'unity.errNoBridgeHeartbeat',
  'unity.errResolveFailed'
])

export interface PlanItem {
  /**
   * 这条来自**哪张卡**（用户点的那一张）。
   *
   * R4 ② 之前这个值是整批共享的 `plan.containerAssetId` —— 多选卡批量之后它必须是每条一份，
   * 否则第二张卡的导入记录会被记到第一张卡头上（`import_log.asset_id` 与 origin 三列都靠它）。
   */
  assetId: string
  /**
   * 容器内相对路径，同时**就是这条目的唯一标识**（`unity:import-plan` 按它认领成员）。
   * 这里曾另有一个 `key` 字段 = 同一个 relPath 的副本 —— 一个只会和它自己漂移的重复字段，
   * 删了（设计 §3.10 的 `origin.extracted` 是同类东西，也没保留）。
   */
  relPath: string
  /**
   * 来源三列之一，**照抄清单给的那一份**，不从 `relPath` 反推。
   *
   * 为什么不反推：单个 `.unitypackage` 文件的 `relPath` 就是它的文件名，
   * 拿它当"我是某个容器的第几个成员"去填 `import_log.member_rel_path`，
   * 库里 31 张散装包卡的导入记录就全被记成了"容器成员" ——
   * 实测这条真的会错（第一版就是这么写的），所以这里把"没有容器成员"这件事
   * 显式存成 null，而不是让读的人去猜。
   */
  memberRelPath: string | null
  originArchive: string | null
  /** 导入用的路径：抽出来的副本，或磁盘原件 */
  localPath: string
  /** A 自己建的临时目录；**null = 没抽过，谁也不许删**（目录型成员指向库里原件） */
  extractDir: string | null
  sizeBytes: number
  /** 抽取时多落地的条目数（后端模糊匹配的产物），只用来如实记日志 */
  unexpected: number
  preflight: PreflightResult
}

export interface MemberPlan {
  batchId: string
  /**
   * 这批来自哪几张卡（去重后按用户点的顺序）。
   *
   * 以前这里是单个 `containerAssetId` + `containerPath`：一批 = 一个容器。
   * R4 ② 的多选卡批量把前提改掉了 —— 留着单值字段，"这批的容器"就没有答案，
   * 而任何还按单值写的代码（比如清理临时副本时的 busy 判定）会认错人。
   */
  assetIds: string[]
  projectId: string
  projectPath: string
  extractRoot: string
  createdAt: number
  items: PlanItem[]
  blocked: MemberFailure[]
  /** 这批抽出来的总量，界面上"勾选 N 个 · 合计 X MB"用的 */
  totalBytes: number
  /** 闸门当时量到的可用字节（-1 = 量不到） */
  freeBytes: number
}

/** `{ok:true}` 带的是**内存里的计划**（含 localPath），`{ok:false}` 带的是界面能显示的失败 */
export type PlanOutcome = { ok: true; plan: MemberPlan } | PlanFailure

/**
 * 一张卡 + 从它里面认领出来的条目。
 *
 * 多选卡批量时会有好几条。`picks` 里每一条的 `origin` 是这张卡的清单给的，
 * 所以"成员相对路径 / 来源压缩包"天然是 per-卡 的，不会串。
 */
export interface PlanSource {
  assetId: string
  /** 这张卡对应的磁盘路径（目录 / 压缩包 / 单个 .unitypackage）。只进日志与报错，不参与拼路径 */
  path: string
  picks: FoundPackage[]
}

export interface PlanInput {
  /** 至少一条。一条 = M5-B 那种"一个容器勾几个成员"的老形状 */
  sources: PlanSource[]
  projectId: string
  extractRoot: string
  /** 库根：闸门之一（"抽取目录不许在库内"） */
  libraryRoot: string | null | undefined
  password?: string
  extraBackendDirs?: string[]
  maxBatch?: number
  /**
   * 闸门用的磁盘读数（`freeBytes` / `driveOf`）。默认是真盘。
   * 单测必须注入：临时目录在 C 盘，而"C 盘不去抽取"正是这道闸门要拒的事 ——
   * 不注入就只能测到"拒绝"那半边，正向链路（抽→导→清）测不了。
   */
  disk?: Partial<DiskFacts>
  signal?: AbortSignal
}

/** 把抽取/清单的异常归成设计 §3.7 那五类。一类一个 key，不许合成一句"抽取失败" */
async function classifyFailure(e: unknown, archivePath: string): Promise<{ reasonKey: string; detail: string | null }> {
  if (e instanceof PasswordNeededError) return { reasonKey: 'err.needPassword', detail: null }
  if (e instanceof BackendUnsupportedError) return { reasonKey: 'err.noBackend', detail: e.detail.slice(0, 200) }
  if (e instanceof NotAnArchiveError) return { reasonKey: 'err.notAnArchive', detail: e.why }
  if (e instanceof CorruptArchiveError) {
    /**
     * 分卷缺卷在后端报的就是"损坏"，但那是要用户去补文件，不是包坏了。
     * 判据用 magic 的 `splitVolume`（按文件名的分卷形状），不自己再发明一套正则。
     */
    try {
      if ((await probeFile(archivePath)).splitVolume) {
        return { reasonKey: 'err.volumeMissing', detail: path.basename(archivePath) }
      }
    } catch {
      /* 探不动就退回"损坏"这个说法 */
    }
    return { reasonKey: 'err.corrupt', detail: e.message.slice(0, 200) }
  }
  if (e instanceof ExtractRootError) return { reasonKey: e.key, detail: null }
  return { reasonKey: 'err.extractFailed', detail: e instanceof Error ? e.message.slice(0, 200) : String(e) }
}

/**
 * 抽取 + 预扫描，**不碰工程、不写库**。
 *
 * 顺序是有讲究的：闸门在任何一个字节落盘之前。
 * 先抽后量会变成"已经写了 600 MB 才告诉你盘不够"，那 600 MB 还得靠删除收拾。
 */
export async function planMemberImport(
  db: Db,
  bridge: BridgeLike,
  input: PlanInput
): Promise<PlanOutcome> {
  const project = getProject(db, input.projectId)
  if (!project) return { ok: false, reasonKey: 'unity.errNoProject' }

  /**
   * 摊平 + 去重。键是 `卡id:成员路径`，**不再只是成员路径** ——
   * 两张不同的卡里各有一个同名成员（`Avatar.unitypackage` 在两个 zip 里都有）时，
   * 按 relPath 去重会把第二张卡那一条悄悄吃掉：界面上勾了 5 个、实际只导 4 个。
   */
  const seen = new Set<string>()
  const flat: Array<{ pick: FoundPackage; source: PlanSource }> = []
  for (const src of input.sources ?? []) {
    for (const p of src.picks ?? []) {
      const k = `${src.assetId}:${p.relPath}`
      if (seen.has(k)) continue
      seen.add(k)
      flat.push({ pick: p, source: src })
    }
  }
  if (!flat.length) return { ok: false, reasonKey: 'err.batchEmpty' }
  const max = input.maxBatch ?? IMPORT_BATCH_MAX
  if (flat.length > max) {
    return { ok: false, reasonKey: 'err.batchTooBig', reasonParams: { count: flat.length, max } }
  }

  const needBytes = flat
    .filter((x) => x.pick.origin.originArchive !== null)
    .reduce((a, x) => a + (x.pick.sizeBytes > 0 ? x.pick.sizeBytes : 0), 0)

  /** 闸门①②：不在库内 / 不在 C 盘 / 空间够。整批不开始就在这里抛，一个字节都没落盘 */
  let freeBytes = -1
  try {
    freeBytes = assertExtractRootUsable(input.extractRoot, input.libraryRoot, needBytes, input.disk)
  } catch (e) {
    if (e instanceof ExtractRootError) return { ok: false, reasonKey: e.key, reasonParams: e.params }
    throw e
  }

  const plan: MemberPlan = {
    batchId: ulid(),
    assetIds: Array.from(new Set(input.sources.map((s) => s.assetId))),
    projectId: input.projectId,
    projectPath: project.path,
    extractRoot: input.extractRoot,
    createdAt: Date.now(),
    items: [],
    blocked: [],
    totalBytes: 0,
    freeBytes
  }

  /** 已经建过的临时目录。中途放弃时全要删 —— 但只删自己建的（见 extractDir 的注释） */
  const madeDirs: string[] = []
  const releaseAll = async (): Promise<void> => {
    for (const d of madeDirs) await releaseMemberDir(d, plan.extractRoot)
  }
  /**
   * 当场收掉某一条的目录，并从"还要收的清单"里摘掉。
   *
   * 为什么单独一份：这条链上有三处会"这一条不要了"（抽不出成员、抽取抛错、解析不了），
   * 每处自己写删除就会有人忘了摘 —— 留着不动的症状是 `releaseAll()` 再去删一个
   * 已经不存在的路径，然后界面上那句"有 N 个副本没删掉"变成假数字。
   */
  const drop = async (dir: string | null): Promise<void> => {
    if (!dir) return
    await releaseMemberDir(dir, plan.extractRoot)
    const at = madeDirs.indexOf(dir)
    if (at >= 0) madeDirs.splice(at, 1)
  }

  for (let i = 0; i < flat.length; i++) {
    if (input.signal?.aborted) {
      await releaseAll()
      return { ok: false, reasonKey: 'err.importCancelled' }
    }
    const pick = flat[i].pick
    /** 这条属于哪张卡（抽取目录按它分层，导入记录也按它记） */
    const source = flat[i].source
    const origin = pick.origin

    /** —— 落地 —— */
    let localPath: string | null = null
    let extractDir: string | null = null
    let unexpected = 0
    if (origin.originArchive) {
      /**
       * 点名抽取的成员路径**只用 `origin.memberRelPath`**，找不到就拒绝，
       * 不回退去用 `relPath` 猜。
       *
       * 这一条是被实测教训逼出来的：清单过期时（用户列完之后又重新摄取过这张卡），
       * 一个"看着像成员"的 pick 会带着**别的**成员的 memberRelPath 进来，
       * 于是 A 抽出**另一个包**导进工程 —— 拿错包导入比"导不进去"严重得多。
       * 现在两条路径不一致就是 `err.memberMissing`，界面上看得见。
       */
      if (!origin.memberRelPath || origin.memberRelPath !== pick.relPath) {
        plan.blocked.push({
          relPath: pick.relPath,
          reasonKey: 'err.memberMissing',
          detail: origin.memberRelPath ? `来源与清单不符：${origin.memberRelPath}` : null
        })
        continue
      }
      /** 压缩包成员：抽到 `<root>/<卡id>/<seq>/`，seq 用下标 —— 同名成员不会互相覆盖（§7-R5） */
      const dir = await allocMemberDir(plan.extractRoot, source.assetId, String(i))
      madeDirs.push(dir)
      /** 这一条不要了就走这里：当场收掉，别攒到 `releaseAll()` 去删已经不存在的壳 */
      const dropThis = async (): Promise<void> => {
        await drop(dir)
      }
      try {
        const res = await extractMembers(origin.originArchive, dir, [origin.memberRelPath], {
          password: input.password,
          extraBackendDirs: input.extraBackendDirs,
          signal: input.signal
        })
        if (!res.members.length) {
          plan.blocked.push({ relPath: pick.relPath, reasonKey: 'err.memberMissing', detail: null })
          await dropThis()
          continue
        }
        localPath = res.members[0].localPath
        extractDir = dir
        unexpected = res.unexpected.length
        if (unexpected) log.warn(`[import] ${pick.relPath} 多抽出 ${unexpected} 条（后端模糊匹配）`)
      } catch (e) {
        const k = await classifyFailure(e, origin.originArchive)
        plan.blocked.push({ relPath: pick.relPath, reasonKey: k.reasonKey, detail: k.detail })
        await dropThis()
        continue
      }
    } else {
      /**
       * 散装 / 目录型容器的成员：磁盘上就有，**不复制**。
       * 这里只确认它还在那儿 —— 用户可能在列完清单之后把文件挪走了。
       */
      const abs = pick.path
      if (!abs) {
        plan.blocked.push({ relPath: pick.relPath, reasonKey: 'err.memberMissing', detail: null })
        continue
      }
      try {
        fs.statSync(abs)
        localPath = abs
      } catch {
        plan.blocked.push({ relPath: pick.relPath, reasonKey: 'unity.errPackageMissing', detail: abs })
      }
    }
    if (!localPath) continue

    /** —— 预扫描（只读）—— */
    const pre = await preflight(db, bridge, plan.projectPath, localPath, input.projectId)
    if (!pre.ok) {
      const key = pre.reasonKey ?? 'unity.errParse'
      if (PROJECT_LEVEL_REASONS.has(key)) {
        /** 工程侧的问题：整批到此为止，并把已经抽出来的东西收干净 */
        await releaseAll()
        return {
          ok: false,
          reasonKey: key,
          reasonParams: pre.reason ? { reason: pre.reason } : undefined,
          detail: pre.parseError ?? pre.reason ?? null
        }
      }
      plan.blocked.push({ relPath: pick.relPath, reasonKey: key, detail: pre.parseError ?? pre.reason })
      /** 这一包解析不了，临时副本留着也没用 */
      if (extractDir) await releaseMemberDir(extractDir, plan.extractRoot)
      continue
    }

    plan.items.push({
      assetId: source.assetId,
      relPath: pick.relPath,
      memberRelPath: origin.memberRelPath,
      originArchive: origin.originArchive,
      localPath,
      extractDir,
      sizeBytes: pick.sizeBytes,
      unexpected,
      preflight: pre
    })
    plan.totalBytes += pick.sizeBytes > 0 ? pick.sizeBytes : 0
  }

  if (!plan.items.length) {
    await releaseAll()
    return {
      ok: false,
      reasonKey: 'err.nothingToImport',
      reasonParams: { blocked: plan.blocked.length },
      detail: plan.blocked.map((b) => `${b.relPath}: ${b.reasonKey}`).join(' | ').slice(0, 300)
    }
  }
  log.info(
    `[import] 预扫描完成：${plan.items.length} 个可导 / ${plan.blocked.length} 个挡住，` +
      `合计 ${(plan.totalBytes / 1048576).toFixed(1)} MB`
  )
  return { ok: true, plan }
}

export interface CommitInput {
  choice?: ConflictChoice
  backupOverwritten?: boolean
  trashFn?: (p: string) => Promise<void>
  /** 每包跑完一次（界面刷新进度条）。抛错不许影响主链 */
  onItem?: (r: CommitItemResult, index: number) => void
  /** 每条**之间**问一次。当前那条一定让 Unity 跑完 —— 中途打断会留半成品（§5.2） */
  shouldStop?: () => boolean
}

/**
 * `onItem` 是界面回调（进度条）。它抛错**不许**把整条导入链带停 ——
 * 包一层只记日志。这一条和 `notify` 的存在理由是同一个：
 * 进度显示坏了，最坏应该只是进度不准，不该让已经导进去的东西变成状态不明。
 */
function notify(cb: CommitInput['onItem'], r: CommitItemResult, i: number): void {
  if (!cb) return
  try {
    cb(r, i)
  } catch (e) {
    log.warn(`[import] 进度回调抛错：${e instanceof Error ? e.message : String(e)}`)
  }
}

/**
 * 串行执行已经预扫描过的那批。
 *
 * ⚠ **每条导入前重新跑一次 `preflight`**，用的是重跑的那份结果。
 * 理由不是"谨慎"：`backupOverwritten()` 拿 `pre.conflicts` 去**用户工程里**复制文件，
 * 计划阶段那份冲突表放了几分钟之后可能已经对不上 —— 对不上就会漏备份，
 * 漏了备份的被覆盖文件是**真找不回来**的（`rollbackImport` 只能报 `unrestorable`）。
 * 代价是每包多解析一次，而这批最多 8 个包。
 */
export async function commitMemberImport(
  db: Db,
  bridge: BridgeLike,
  plan: MemberPlan,
  input: CommitInput = {}
): Promise<BatchOutcome> {
  const out: BatchOutcome = {
    ok: false,
    batchId: plan.batchId,
    imported: 0,
    failed: 0,
    notRun: 0,
    blocked: plan.blocked,
    results: [],
    cleanupFailed: 0,
    stoppedReasonKey: null
  }

  for (let i = 0; i < plan.items.length; i++) {
    const item = plan.items[i]
    if (input.shouldStop?.()) {
      out.stoppedReasonKey = 'err.importCancelled'
      break
    }

    const fresh = await preflight(db, bridge, plan.projectPath, item.localPath, plan.projectId)
    if (!fresh.ok) {
      const key = fresh.reasonKey ?? 'unity.errParse'
      /**
       * 这一包导不成了，它的副本就没用了 —— **必须现在就删**。
       * 留给末尾那个"没跑到的条目"循环是不行的：那个循环从 `results.length` 开始数，
       * 而这一条已经进了 results，会被跳过（实测过这种"清理靠下游"的写法漏一个删一个）。
       */
      const cleanupFailed = item.extractDir
        ? !(await releaseMemberDir(item.extractDir, plan.extractRoot))
        : false
      if (cleanupFailed) out.cleanupFailed++
      const r: CommitItemResult = {
        relPath: item.relPath,
        ok: false,
        status: PROJECT_LEVEL_REASONS.has(key) ? 'failed' : 'blocked',
        importId: null,
        createdGuids: [],
        overwrittenGuids: [],
        error: fresh.reason,
        reasonKey: key,
        cleanupFailed
      }
      out.results.push(r)
      notify(input.onItem, r, i)
      if (PROJECT_LEVEL_REASONS.has(key)) {
        /** 工程不在线：剩下的别各等一遍退避 */
        out.stoppedReasonKey = key
        out.failed++
        break
      }
      out.blocked.push({ relPath: item.relPath, reasonKey: key, detail: fresh.parseError ?? fresh.reason })
      continue
    }

    const origin: PackageOrigin = {
      /** 每条记自己那张卡，不再用整批共享的容器 id（多选卡批量时那会记错人） */
      containerAssetId: item.assetId,
      originArchive: item.originArchive,
      /**
       * 用 `item.memberRelPath`（清单给的那一份），**不是** `item.relPath`。
       * 单个 .unitypackage 文件的 relPath 是它的文件名，而它的 `memberRelPath` 是 null ——
       * 拿 relPath 去填就会把 31 张散装卡全记成"某个容器的成员"。
       */
      memberRelPath: item.memberRelPath
    }
    const r0 = await importUnitypackage(db, bridge, plan.projectPath, item.localPath, plan.projectId, fresh, {
      assetId: item.assetId,
      batchId: plan.batchId,
      choice: input.choice ?? 'continue',
      backupOverwritten: input.backupOverwritten ?? true,
      trashFn: input.trashFn,
      origin
    })

    /** 终态到了才删副本（顺序反了会把"结果未知"变成"文件已消失"，再也对不上账） */
    let cleanupFailed = false
    if (item.extractDir) {
      cleanupFailed = !(await releaseMemberDir(item.extractDir, plan.extractRoot))
      if (cleanupFailed) out.cleanupFailed++
    }

    const r: CommitItemResult = {
      relPath: item.relPath,
      ok: r0.ok,
      status: r0.ok ? 'ok' : r0.status === 'cancelled' ? 'cancelled' : 'failed',
      importId: r0.importId,
      createdGuids: r0.createdGuids,
      overwrittenGuids: r0.overwrittenGuids,
      error: r0.error,
      reasonKey: r0.ok ? null : 'unity.errImportFailed',
      cleanupFailed
    }
    out.results.push(r)
    if (r0.ok) out.imported++
    else out.failed++
    notify(input.onItem, r, i)

    if (!r0.ok) {
      /**
       * Unity 侧退回了失败：停手，剩下的算"未执行"。
       * 继续发下去要么是把一个已经在报错的编辑器反复捶，
       * 要么是把"半批"变成"不知道哪几条进去了"的整批。
       */
      out.stoppedReasonKey = 'unity.errImportFailed'
      break
    }
  }

  /** 没跑到的条目也要收干净，否则一批里留三张临时副本在盘上等下次开机 */
  const ran = out.results.length
  for (let i = ran; i < plan.items.length; i++) {
    const item = plan.items[i]
    out.notRun++
    if (item.extractDir && !(await releaseMemberDir(item.extractDir, plan.extractRoot))) out.cleanupFailed++
  }

  out.ok = out.imported > 0 && out.failed === 0 && out.notRun === 0
  log.info(
    `[import] 批量导入 ${plan.batchId}：成功 ${out.imported} / 失败 ${out.failed} / 未执行 ${out.notRun}` +
      (out.cleanupFailed ? ` / 临时副本没删掉 ${out.cleanupFailed}` : '')
  )
  return out
}

/**
 * 放弃一批：只删自己抽出来的目录，不动库里的原件。
 * 界面取消、超时作废、程序退出前都走这一条。
 */
export async function abandonMemberPlan(plan: MemberPlan): Promise<{ released: number; failed: number }> {
  let released = 0
  let failed = 0
  for (const item of plan.items) {
    if (!item.extractDir) continue
    if (await releaseMemberDir(item.extractDir, plan.extractRoot)) released++
    else failed++
  }
  return { released, failed }
}

/**
 * 按 `batch_id` 整批撤销：**倒序**逐条，中途一条失败就停下（设计 §3.6）。
 *
 * 为什么倒序：同一批里后导入的那个可能覆盖了先导入的那个文件，
 * 正序撤会把后一次覆盖的内容又写回去。
 *
 * 为什么停下就停：继续闷着头撤，最后只能报一句"撤了 3 条、有 5 条状态不明"，
 * 而用户真正需要知道的是**卡在哪一条、为什么**。宁可少撤。
 *
 * ⚠ 临时副本不参与撤销 —— 那些文件在导入终态时就删了，撤销只依赖
 * `import_log.created_guids_json`（白名单）+ `backup_dir`（还原）。
 */
export async function rollbackMemberBatch(
  db: Db,
  batchId: string,
  /**
   * **注入**，而且就绑 `coordinator.rollbackImport` 的类型。
   * 为什么不在这儿自己写一遍删除逻辑：撤销只有一套口径（白名单 + `Assets/` 前缀 +
   * 从 backup_dir 还原），复制一份出来必然漂，而漂了的那份删的是**用户工程里的文件**。
   */
  rollbackOne: (projectPath: string, importId: string) => Promise<RollbackResult>
): Promise<BatchRollbackOutcome> {
  const out: BatchRollbackOutcome = {
    batchId,
    attempted: 0,
    rolledBack: 0,
    stoppedAt: null,
    details: [],
    ok: false
  }
  const rows = rollbackOrderOfBatch(db, batchId)

  for (const row of rows) {
    const project = getProject(db, row.project_id)
    if (!project) {
      out.stoppedAt = row.id
      out.details.push({
        importId: row.id,
        relPath: row.member_rel_path,
        ok: false,
        error: 'projectGone',
        deletedFiles: 0,
        restoredFiles: 0,
        unrestorable: 0
      })
      break
    }
    out.attempted++
    const r = await rollbackOne(project.path, row.id)
    out.details.push({
      importId: row.id,
      relPath: row.member_rel_path,
      ok: r.ok,
      error: r.error,
      deletedFiles: r.deletedFiles.length,
      restoredFiles: r.restoredFiles.length,
      unrestorable: r.unrestorable
    })
    if (!r.ok) {
      out.stoppedAt = row.id
      break
    }
    out.rolledBack++
  }
  out.ok = out.rolledBack === rows.length && rows.length > 0
  return out
}
