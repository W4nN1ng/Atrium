import { app, dialog, shell } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { Worker } from 'node:worker_threads'
import log from 'electron-log'
import type { BundlePreview, ClassifiedUnitView, IngestItemState } from '../../shared/api'
import type { AssetUnit, ClassificationResult, ContentType, SourcePlatform } from '../../shared/types'
import { ulid } from '../../shared/ulid'
import { cleanDisplayName } from '../../shared/naming'
import { TaskQueue } from '../lib/queue'
import { findSplitSiblings, type ProbeResult } from '../unpack/magic'
import { findAssetByHash } from '../db/repos/asset'
import { getDb } from '../db'
import { P, bundledBinDir, resourceRoot } from '../services/paths'
import {
  addToInboxQueue,
  describeInboxQueue,
  readInboxQueue,
  removeFromInboxQueue
} from '../services/inboxQueue'
import { getSettings, libraryRootOrThrow } from '../services/settings'
import { recallArchivePassword, rememberArchivePassword } from '../services/secrets'
import { learningMap } from '../classify/learning'
import { confidenceTone } from '../classify/engine'
import { reindexAsset } from '../search'
import { dirNames, loadCategories } from '../services/categories'
import { resolveDirNames } from '../library/dirAliases'
import { commitAsset, commitBundleAsset, type CommitDeps, type CommitUnit } from '../library/commit'
import { backfillThumbs, ensureThumb } from '../library/thumbs'
import { checkIngestPath, type RejectedPath } from '../security/paths'
import { ensureDir } from '../library/fsx'
import { on, EV_UNDONE } from '../lib/events'
import type { IpcRegistrar } from '../ipc/types'
import type { WorkerMessage, WorkerResult } from './worker'
import { containerInfoOf, type ContainerInfo } from './container'
import { queueActionFor, STAGE_TERMINAL } from './queuePolicy'
import { pruneExtractRoot, resolveExtractRoot } from '../import/extractRoot'

export interface IngestApi {
  enqueue(paths: string[]): Promise<{ accepted: string[]; rejected: RejectedPath[] }>
  queue(): IngestItemState[]
  /** 启动时把上次没确认完的卡片捞回来（重跑 worker，见实现处注释） */
  restoreQueue(opts?: { limit?: number; delayMs?: number }): Promise<{
    recovered: number
    missing: string[]
    skipped: number
  }>
  dispose(): void
}

interface Job {
  item: IngestItemState
  worker: Worker | null
  result: WorkerResult | null
  password: string | null
  /**
   * M7 ⑥ · 这一轮已经试过"用记住的密码"了。
   * 没这个标志的话：记住的密码是错的 → worker 又报 need-password → 我们又拿同一条去试 → **死循环**。
   */
  vaultTried: boolean
  cancelled: boolean
  paused: boolean
  staging: string | null
  /** 这次提交属于哪个 journal 批次；撤销时按它把卡片退回收件箱 */
  commitBatch?: string
  /** 上一次已写进收件箱清单的阶段：只在阶段变化时落盘，避免指纹进度把磁盘刷满 */
  persistedStage?: IngestItemState['stage']
}

const CONCURRENCY = 2

/** 从来源 URL 反推平台（入库要存 source_platform，M4 的检索要用） */
function platformOfUrl(url: string | null | undefined): SourcePlatform {
  if (!url) return null
  if (/booth\.pm/i.test(url)) return 'booth'
  if (/github\.com/i.test(url)) return 'github'
  if (/gumroad\.com/i.test(url)) return 'gumroad'
  if (/afdian\.(net|com)/i.test(url)) return 'afdian'
  return 'other'
}

/** 界面文案只给 key + 参数；这里给分类用的目录链（§1.2 权重 2.5） */
function dirChainOf(sourcePath: string, libraryRoot: string | null): string[] {
  const out: string[] = []
  let cur = path.dirname(path.win32.normalize(sourcePath))
  const stop = libraryRoot ? path.win32.normalize(libraryRoot).toLowerCase() : null
  for (let i = 0; i < 4; i++) {
    const base = path.basename(cur)
    if (!base) break
    if (stop && cur.toLowerCase() === stop) break
    // 盘符根（"E:"）和用户主目录名不当语料
    if (/^[a-z]:$/i.test(base) || /(^|\\)users?$/i.test(cur)) break
    out.unshift(base)
    const parent = path.dirname(cur)
    if (parent === cur) break
    cur = parent
  }
  return out
}

/** worker_threads 读不了 asar 里的文件，打包后要指到 unpacked 目录 */
function workerEntry(): string {
  const file = path.join(__dirname, 'worker.js')
  if (app.isPackaged) return file.replace('app.asar', 'app.asar.unpacked')
  return file
}

function contentTypeOf(probe: ProbeResult): ContentType {
  switch (probe.format) {
    case 'png':
    case 'jpeg':
    case 'gif':
    case 'bmp':
    case 'webp':
      return 'texture'
    case 'psd':
      return 'texture'
    case 'pdf':
    case 'html':
    case 'text':
      return 'reference'
    case 'exe':
      return 'tool'
    default:
      return 'unknown'
  }
}

function kindOf(probe: ProbeResult, isDir: boolean): CommitUnit['kind'] {
  if (probe.subtype === 'unitypackage-gzip') return 'unitypackage'
  if (isDir) return 'folder'
  if (probe.isArchive) return 'archive'
  if (['png', 'jpeg', 'gif', 'bmp', 'webp', 'psd'].includes(probe.format)) return 'image'
  if (['pdf', 'html', 'text'].includes(probe.format)) return 'doc'
  if (probe.format === 'exe') return 'exe'
  return 'loose_files'
}

/** 分类结果 → 界面要的那份视图（重复那一支也要用，所以抽出来） */
/** 合集预览：收件箱那张卡要能列出子项和每个子项的版本数（改动单 §3） */
function bundlePreviewOf(cls: ClassificationResult | null | undefined): BundlePreview | undefined {
  const tree = cls?.tree
  if (!tree || !tree.items.length) return undefined
  return {
    name: tree.name,
    totalBytes: tree.totalBytes,
    items: tree.items.map((it) => ({
      name: it.name,
      category: it.unit.category,
      subcategory: it.unit.subcategory,
      confidence: it.unit.confidence,
      versions: it.versions.length,
      topVersion: it.versions[0]?.version ?? null
    }))
  }
}

function toUnitViews(cls: ClassificationResult | null | undefined): ClassifiedUnitView[] {
  return (cls?.units ?? []).map((u) => ({
    name: u.name,
    category: u.category,
    subcategory: u.subcategory,
    confidence: u.confidence,
    tone: confidenceTone(u.confidence),
    reasonParts: u.reasonParts ?? [],
    reason: u.reason,
    tags: u.tags,
    targetAvatars: u.targetAvatars,
    version: u.version,
    author: u.author,
    localeTag: u.localeTag,
    sourceItemId: u.sourceItemId,
    sourceItemIdConfidence: u.sourceItemIdConfidence,
    bundleRef: u.bundleRef
  }))
}

export function startIngest(registrar: IpcRegistrar): IngestApi {
  const jobs = new Map<string, Job>()
  const queue = new TaskQueue({ concurrency: CONCURRENCY })
  let disposed = false
  void pruneStaging()
  /**
   * 抽取根目录同理（M5-B）：任务表不跨重启，开机时那里剩下来的必是上次没清干净的
   * 临时副本。它默认在**素材所在那个盘**（不是 C），所以就算漏清也不会写爆系统盘，
   * 但界面上一句"抽取目录还压着 N MB"得有依据 —— 先清，量不到就算了。
   */
  void pruneExtractAtStartup()

  /** runJob 自己把失败写进 job.item，这里只兜住"根本没跑到写状态那一步"的意外，避免 unhandled rejection */
  function schedule(job: Job): void {
    queue.add(() => runJob(job)).catch((e: unknown) => {
      log.error('ingest 任务异常', job.item.jobId, e)
      update(job.item.jobId, {
        stage: 'failed',
        error: e instanceof Error ? e.message : String(e),
        messageKey: 'ingest.failed',
        message: '摄取任务异常'
      })
    })
  }

  const snapshot = (): IngestItemState[] => Array.from(jobs.values()).map((j) => ({ ...j.item }))

  /** 批量入库时置为 true：只发进度事件，不逐条重发整份队列快照 */
  let quiet = false
  let flushTimer: NodeJS.Timeout | null = null

  const push = (): void => {
    if (disposed) return
    if (quiet) {
      if (!flushTimer) {
        flushTimer = setTimeout(() => {
          flushTimer = null
          if (!disposed) registrar.broadcast('ingest:progress', snapshot())
        }, 400)
      }
      return
    }
    registrar.broadcast('ingest:progress', snapshot())
  }

  function update(id: string, patch: Partial<IngestItemState>): void {
    const j = jobs.get(id)
    if (!j) return
    j.item = { ...j.item, ...patch }
    /**
     * 收件箱持久化：**只在阶段真的变了**的时候写一次盘。
     * `update` 在指纹进度里会被高频调用（每几毫秒一次），无条件写会把磁盘打满。
     */
    if (patch.stage && patch.stage !== j.persistedStage) {
      j.persistedStage = patch.stage
      persistStage(j)
    }
    push()
  }

  /**
   * 把"等人处理"的任务写进队列清单，终态则移出去。
   * 策略本身在 `queuePolicy.ts`（纯函数，单测在那儿）。这里只负责落盘，
   * 且**吞掉所有异常** —— 收件箱持久化是兜底，它坏了不能让摄取流程跟着坏。
   */
  function persistStage(job: Job): void {
    const action = queueActionFor(job.item.stage, job.item.sourcePath)
    if (action.op === 'none') return
    try {
      const file = P.inboxQueue()
      if (action.op === 'add') addToInboxQueue(file, action.path)
      else removeFromInboxQueue(file, action.path)
    } catch (e) {
      log.warn('收件箱队列写入失败：' + (e instanceof Error ? e.message : String(e)))
    }
  }

  function stageDirFor(assetId: string): string {
    return path.join(P.staging(), assetId)
  }

  /**
   * 任务没走到提交就结束了（取消 / worker 崩 / 丢弃卡片）→ 暂存目录没人要了，删掉。
   * 开了自动解压时这里是整份解压内容，几百 MB 起步，而它在系统盘上。
   * 提交过的任务里这份已经被搬进库或送去 hold，这里就是空操作。
   */
  async function dropStaging(job: Job): Promise<void> {
    const dir = job.staging
    if (!dir) return
    job.staging = null
    try {
      await fs.promises.rm(dir, { recursive: true, force: true })
    } catch (e) {
      log.warn('暂存目录没删掉：' + dir + ' —— ' + (e instanceof Error ? e.message : String(e)))
    }
  }

  /**
   * 开机清扫：暂存目录只对"内存里正在跑的任务"有意义，任务表是内存态、不跨重启，
   * 所以启动时它下面剩的全是垃圾（上次崩了、或直接关掉程序留下的）。
   */
  async function pruneStaging(): Promise<void> {
    const root = P.staging()
    let names: string[] = []
    try {
      names = await fs.promises.readdir(root)
    } catch {
      return
    }
    for (const n of names) {
      try {
        await fs.promises.rm(path.join(root, n), { recursive: true, force: true })
      } catch {
        /* 删不掉下次开机再试 */
      }
    }
    if (names.length) log.info(`清扫暂存目录：${names.length} 项`)
  }

  /**
   * 开机清扫抽取根目录（M5-B）。
   * 走 `resolveExtractRoot` 同一个推导，免得开机清的是 A 目录、导入时写的却是另一个地方。
   * 推导不出来（没设库根、或者设置里填了个非法位置）就当没这回事 —— 开机阶段不该弹窗。
   */
  async function pruneExtractAtStartup(): Promise<void> {
    const s = getSettings()
    try {
      const r = await pruneExtractRoot(resolveExtractRoot(s.extractRoot, s.libraryRoot))
      if (r.removed || r.kept) {
        log.info(
          `清扫抽取目录：删 ${r.removed} 项、${(r.bytes / 1048576).toFixed(0)} MB` + (r.kept ? `，${r.kept} 项删不掉留给下次` : '')
        )
      }
    } catch {
      /* 没库根 / 配置非法：开机阶段不打扰用户 */
    }
  }

  async function runJob(job: Job): Promise<void> {
    const { item } = job
    if (job.cancelled) return
    const s = getSettings()
    const assetId = ulid()
    const stagingPath = stageDirFor(assetId)
    job.item.assetId = assetId
    job.staging = stagingPath

    let worker: Worker
    try {
      await ensureDir(P.staging())
      worker = new Worker(workerEntry())
    } catch (e) {
      update(item.jobId, { stage: 'failed', error: e instanceof Error ? e.message : String(e), message: '起不动 worker' })
      return
    }
    job.worker = worker

    worker.on('message', async (msg: WorkerMessage) => {
      if (msg.type === 'progress') {
        update(item.jobId, {
          stage: msg.stage as IngestItemState['stage'],
          progress: msg.progress,
          messageKey: msg.messageKey,
          messageParams: msg.messageParams,
          message: msg.message ?? ''
        })
        return
      }
      if (msg.type === 'need-password') {
        /**
         * M7 ⑥ · 先看看这台机器是不是**已经记住过**这个包的密码。
         *
         * 只在第一次撞见要密码时试（`vaultTried`）：记住的那条是错的 → worker 又报
         * `need-password` → 再拿同一条去试就是死循环。第二次直接问人。
         */
        if (!job.vaultTried) {
          job.vaultTried = true
          const saved = recallArchivePassword(getDb(), job.item.sourcePath)
          if (saved) {
            log.info(`[vault] 用记住的密码重试「${item.name ?? item.sourcePath}」`)
            job.password = saved
            update(item.jobId, { stage: 'queued', needsPassword: false, messageKey: 'ingest.requeued', message: '用记住的密码重试' })
            await worker.terminate().catch(() => undefined)
            job.worker = null
            schedule(job)
            return
          }
        }
        update(item.jobId, {
          stage: 'awaiting_confirm',
          needsPassword: true,
          messageKey: 'ingest.needPassword',
          message: '这个包要密码',
          progress: 0.4
        })
        await worker.terminate().catch(() => undefined)
        job.worker = null
        return
      }
      if (msg.type === 'error') {
        // code 是 i18n key（ingest.corruptArchive 等），message 是后端原文，只进日志和详情
        update(item.jobId, {
          stage: 'failed',
          error: msg.message,
          messageKey: msg.code,
          message: msg.message,
          progress: 0
        })
        await worker.terminate().catch(() => undefined)
        job.worker = null
        await dropStaging(job)
        return
      }
      if (msg.type === 'done') {
        job.result = msg.result
        await worker.terminate().catch(() => undefined)
        job.worker = null
        if (job.cancelled) return

        // 查重：完全相同的指纹先问一句，不静默合并也不静默丢
        const dup = findAssetByHash(getDb(), msg.result.hash)
        if (dup) {
          const dupUnits = toUnitViews(msg.result.classification)
          update(item.jobId, {
            stage: 'duplicate',
            units: dupUnits,
            bundleName: msg.result.classification?.bundle?.name ?? null,
            duplicateOf: { assetId: dup.id, path: dup.library_path ?? dup.source_path, name: dup.name },
            detectedKind: msg.result.probe.label,
            messageKey: 'ingest.duplicateFound',
            message: `已存在：${dup.name}`,
            progress: 1
          })
          return
        }

        const cls = msg.result.classification
        const units = toUnitViews(cls)

        update(item.jobId, {
          stage: 'awaiting_confirm',
          progress: 1,
          detectedKind: msg.result.probe.label,
          detectedFormat: msg.result.probe.format,
          stagingPath: msg.result.stagingPath ?? undefined,
          entriesPreview: msg.result.entries.slice(0, 12).map((e) => e.path),
          entryCount: msg.result.entryCount,
          bytes: msg.result.sizeBytes,
          warnings: msg.result.warnings,
          units,
          bundleName: cls?.bundle?.name ?? null,
          bundle: bundlePreviewOf(cls),
          messageKey: msg.result.warnings.length ? 'ingest.readyWithWarning' : 'ingest.ready',
          message: '指纹完成，等你确认分类'
        })

        /**
         * §5.3 Step 5：置信度到线就直接归档（设置里 autoArchive 可关）。
         * 拆包成多项时**不自动入库** —— 一次动一堆目录，出错太难解释，交回人看。
         */
        const top = cls?.units[0]
        if (s.autoArchive && top && units.length === 1 && top.confidence >= s.confidenceAuto) {
          log.info(`自动归档：${top.name} → ${top.category}/${top.subcategory ?? '-'}（${top.confidence.toFixed(2)}）`)
          try {
            await commit(job, { name: '', category: '', subcategory: null })
          } catch (e) {
            log.error('自动归档失败：' + (e instanceof Error ? e.message : String(e)))
            update(item.jobId, { messageKey: 'ingest.autoArchiveFailed', message: e instanceof Error ? e.message : String(e) })
          }
        }
      }
    })

    worker.on('error', (e) => {
      log.error('[ingest] worker 崩了：' + e.message)
      update(item.jobId, { stage: 'failed', error: e.message, message: e.message })
    })

    worker.postMessage({
      type: 'job',
      jobId: item.jobId,
      sourcePath: item.sourcePath,
      stagingPath,
      extract: s.autoExtract,
      password: job.password ?? undefined,
      backendDirs: [bundledBinDir()],
      // 分类要在 worker 里跑（§12 坑 8：不占主线程），词典/分类表/已学规则都从这边传过去
      resourceRoot: resourceRoot(),
      userLexicon: P.userLexicon(),
      classify: true,
      dirChain: dirChainOf(item.sourcePath, s.libraryRoot),
      learning: Array.from(learningMap(getDb()).entries())
    })
  }

  /**
   * 引擎给的那份分类结果 → CommitUnit。
   *
   * 手工确认和「一键全部入库」共用这一个函数 —— 这种映射写两遍必然漂：
   * 漂了就会出现"单张卡确认的信息比批量入库多"或者反过来，很难查。
   */
  function unitFromModel(
    model: AssetUnit | undefined,
    over: { name?: string; category?: string; subcategory?: string | null; rawName?: string; sizeBytes?: number },
    job: Job,
    res: WorkerResult,
    s: ReturnType<typeof getSettings>,
    isDir: boolean,
    batch: boolean,
    /**
     * §A2/§A3 的容器分析结果（主体 / 附属 / 该叫什么名字）。
     * 合集的**子项**不传 —— 那一份是整个容器的清单，套到子项上会把
     * 全部附属资源重复挂到每一个子项下面。
     */
    container?: ContainerInfo | null
  ): CommitUnit {
    const guess = cleanDisplayName((over.name ?? '').trim() || path.basename(job.item.sourcePath))
    const userEditedName = (over.name ?? '').trim() !== '' && (over.name ?? '').trim() !== model?.name
    const confidence = model?.confidence ?? 0
    /**
     * §A3 取名优先级：主体文件名 → 主体所在目录 → 容器目录名 → 原名。
     * 用户手改过的名字永远最大；引擎给的 model.name 排最后兜底 ——
     * 真库的 `d6b99874-… base resized` 就是这么来的（引擎拿了个 UUID 文件名当素材名）。
     */
    const a3 = container?.name ?? null
    return {
      name: userEditedName ? guess.name : a3 || model?.name || guess.name,
      rawName: over.rawName ?? path.basename(job.item.sourcePath),
      category: over.category || model?.category || 'other',
      /** 只有用户没动一级时才沿用模型给的二级，否则会配出 模型/outfit 这种不存在的组合 */
      subcategory:
        over.subcategory ??
        (model && (over.category || model.category) === model.category ? model.subcategory : null) ??
        null,
      confidence,
      /**
       * 低置信度**不再阻塞入库**（改动单 §1.3）：一律算已分类，
       * 用 needs_review 记下来，事后在「待复核」里捞。
       */
      status: 'classified',
      kind: kindOf(res.probe, isDir),
      contentType: model?.contentType ?? contentTypeOf(res.probe),
      version: model?.version ?? container?.version ?? guess.version,
      author: model?.author ?? null,
      localeTag: model?.localeTag ?? null,
      sourceUrl: model?.sourceUrl ?? null,
      sourcePlatform: model?.sourceUrl ? platformOfUrl(model.sourceUrl) : null,
      sourceItemId: model?.sourceItemId ?? null,
      sourceItemIdConfidence: model?.sourceItemIdConfidence ?? null,
      tags: model?.tags ?? [],
      targetAvatars: model?.targetAvatars ?? [],
      groupKey: s.groupingEnabled ? model?.groupKey ?? null : null,
      bundleRef: s.bundleSplitEnabled ? model?.bundleRef ?? res.classification?.bundle?.name ?? null : null,
      bundleName: s.bundleSplitEnabled ? res.classification?.bundle?.name ?? null : null,
      reason: model?.reason || 'M2 手工分类（未走自动分类）',
      hash: res.hash,
      sizeBytes: over.sizeBytes ?? res.sizeBytes,
      needsReview: batch && confidence < s.confidenceAuto,
      variantRaw: model?.variantRaw ?? null,
      attachments: container?.attachments ?? []
    }
  }

  /** 入库收尾：状态、广播、检索索引、封面。批量与单件走同一条 */
  function finishCommit(job: Job, primaryId: string, allIds: string[], batchId: string, skipThumb = false): void {
    job.commitBatch = batchId
    update(job.item.jobId, {
      stage: 'done',
      assetId: primaryId,
      progress: 1,
      messageKey: 'ingest.committed',
      message: '已入库'
    })
    // 入库后立刻同步检索索引与别名，不然新素材要等到重启才搜得到
    for (const id of allIds) {
      try {
        reindexAsset(getDb(), id)
      } catch (e) {
        log.warn('检索索引同步失败：' + id + ' —— ' + (e instanceof Error ? e.message : String(e)))
      }
    }
    // 顺手把封面也做了：这时候文件刚落地、目录还热着，比下次启动再扫一遍便宜。
    // 但一键入库 228 项时不能每张都开一次解码 —— 那会把批处理拖成分钟级，
    // 批量走完后端统一 backfillThumbs 一次。
    if (skipThumb) return
    void ensureThumb(getDb(), primaryId, { packages: true })
      .then((t) => {
        if (t.ok) registrar.broadcast('data:changed', { reason: 'thumb', id: primaryId })
      })
      .catch((e: unknown) => log.warn('封面生成失败：' + (e instanceof Error ? e.message : String(e))))
  }

  async function commit(
    job: Job,
    input: { name?: string; category: string; subcategory: string | null; password?: string },
    opts: { move?: boolean; batchId?: string; batch?: boolean } = {}
  ): Promise<string> {
    const s = getSettings()
    const res = job.result
    if (!res) throw new Error('这个任务还没有指纹结果')
    /**
     * "没库根不许往库里写"这句口径**只在 `libraryRootOrThrow()` 那一处**（M7 ②）。
     * 以前这里自己写了一句 `if (!s.libraryRoot) throw …`，文案还和函数里那句不一样
     * （「还没」vs「尚未」），而函数本身全仓零调用 —— 等于口径散在调用点上、闸门其实是死的。
     */
    const libraryRoot = libraryRootOrThrow()
    const assetId = job.item.assetId ?? ulid()
    const cfg = loadCategories()
    // 他的库里已经有 衣服/插件/贴图 这种自建目录名，别再建一套并行的 服装/…
    const names = new Map(
      Object.entries(resolveDirNames(libraryRoot, Object.fromEntries(dirNames(cfg, s.libraryLocale)), cfg).names)
    )
    const isDir = fs.statSync(job.item.sourcePath).isDirectory()
    const model = res.classification?.units[0]
    const batch = !!opts.batch
    const batchId = opts.batchId ?? job.item.jobId
    /**
     * move=false → 强制走索引模式：只登记分类，一个文件都不搬。
     * 这是「全部入库」那个安全阀的默认档 —— 24 GB 的库被一键 shuffle 到新目录，
     * 出半点错都没法收拾，所以默认不许动盘。
     */
    const willMove = opts.move ?? s.storageMode === 'archived'
    const deps: CommitDeps = {
      db: getDb(),
      libraryRoot,
      names,
      template: s.dirTemplate,
      storageMode: willMove ? s.storageMode : 'indexed',
      autoExtract: s.autoExtract,
      holdDir: P.trashHold(),
      appVersion: app.getVersion()
    }

    /**
     * §A2/§A3：整个容器的清单只分析一次，主体/附属/名字都从这一份来。
     * 合集子项**不**套它（见 unitFromModel 的注释）—— 那会把全部附属资源
     * 重复挂到每一个子项下面。
     */
    const info = containerInfoOf(res, [model?.name ?? null, path.basename(job.item.sourcePath)])

    /**
     * 合集：整包登记成三级（合集 → 子项 → 版本），**永远不动磁盘**（改动单 §7.1）。
     * 里面 17 件东西各搬各的目录，一旦中途出错就是半个库散在两地。
     */
    const tree = s.bundleSplitEnabled ? res.classification?.tree : undefined
    if (tree && tree.items.length) {
      const r = commitBundleAsset(deps, {
        bundle: unitFromModel(model, input, job, res, s, isDir, batch, info),
        rootPath: job.item.sourcePath,
        assetId,
        batchId,
        reviewThreshold: s.confidenceAuto,
        containerKind: tree.containerKind ?? 'collection',
        items: tree.items.map((it) => ({
          /**
           * 子项的体积必须是**它自己那几份版本之和**。
           * 早先这里没传 sizeBytes，unitFromModel 一路回退到 res.sizeBytes =
           * 整个容器的体积，于是 17 个子项各背一遍整包大小，合集那一行再把它加 17 遍 ——
           * 真库的「初音的VRC小店」因此报成 869 GB（库一共才 25 GB）。
           */
          unit: unitFromModel(
            it.unit,
            { name: it.unit.name, sizeBytes: it.versions.reduce((a, v) => a + (v.sizeBytes ?? 0), 0) || undefined },
            job,
            res,
            s,
            false,
            batch
          ),
          relPath: it.relPath,
          versions: it.versions
        }))
      })
      registrar.broadcast('data:changed', { reason: 'ingest-commit', id: r.bundleAssetId })
      finishCommit(job, r.bundleAssetId, r.createdIds, batchId, batch)
      return r.bundleAssetId
    }

    const unit = unitFromModel(model, input, job, res, s, isDir, batch, info)
    const r = await commitAsset(deps, {
      unit,
      stagingPath: res.stagingPath,
      sourcePath: job.item.sourcePath,
      assetId,
      batchId
    })
    // 跨盘复制留下的源文件：worker 里调不了 shell.trashItem，这里送回收站
    for (const p of r.pendingTrash) {
      try {
        await shell.trashItem(p)
      } catch (e) {
        log.warn('送回收站失败：' + p + ' ' + (e instanceof Error ? e.message : String(e)))
      }
    }
    registrar.broadcast('data:changed', { reason: 'ingest-commit', id: r.assetId })
    finishCommit(job, r.assetId, [r.assetId], batchId, batch)
    return r.assetId
  }

  /** 同一个源路径是否已经有一个"还没了结"的任务（排队中/等人处理），用来防重复入队 */
  function activeJobFor(sourcePath: string): Job | null {
    const key = path.win32.normalize(sourcePath).toLowerCase()
    for (const j of jobs.values()) {
      if (STAGE_TERMINAL.has(j.item.stage)) continue
      if (path.win32.normalize(j.item.sourcePath).toLowerCase() === key) return j
    }
    return null
  }

  function addJob(sourcePath: string): Job {
    const jobId = ulid()
    const job: Job = {
      item: {
        jobId,
        sourcePath,
        name: path.basename(sourcePath),
        stage: 'queued',
        progress: 0,
        messageKey: 'ingest.queued',
        message: '已登记，等待摄取'
      },
      worker: null,
      result: null,
      password: null,
      vaultTried: false,
      cancelled: false,
      paused: false,
      staging: null,
      persistedStage: 'queued'
    }
    jobs.set(jobId, job)
    return job
  }

  async function enqueue(
    paths: string[]
  ): Promise<{ accepted: string[]; rejected: RejectedPath[] }> {
    const s = getSettings()
    const accepted: string[] = []
    const rejected: RejectedPath[] = []
    for (const raw of paths) {
      if (typeof raw !== 'string' || !raw.trim()) {
        rejected.push({
          path: String(raw),
          code: 'err.notStringPath',
          params: { path: String(raw) },
          reason: '不是有效路径'
        })
        continue
      }
      const p = path.win32.normalize(raw.trim())
      /**
       * 已登记素材的目录要一起交给校验器：
       * 库根下面的东西不再一刀切拒掉，否则"收编旧库 / 重新登记游离文件"永远 0 条通过。
       */
      const registered = getDb()
        .prepare(`SELECT library_path AS p, source_path AS q FROM asset`)
        .all() as Array<{ p: string | null; q: string | null }>
      const check = checkIngestPath(p, {
        libraryRoot: s.libraryRoot,
        ownDirs: [P.staging(), P.backups(), P.thumbs()],
        registeredDirs: registered.flatMap((r) => [r.p, r.q].filter((x): x is string => !!x))
      })
      if (!check.ok) {
        rejected.push({
          path: p,
          code: check.code,
          params: check.params,
          reason: check.reason ?? '拒绝'
        })
        continue
      }
      // 分卷只跑首卷，其余卷留在原地当同伴
      const group = findSplitSiblings(p)
      if (group[0] && path.resolve(group[0]) !== path.resolve(p)) {
        rejected.push({
          path: p,
          code: 'err.splitContinuation',
          params: { path: path.basename(group[0]) },
          reason: `这是分卷的续卷，已改为处理首卷 ${group[0]}`
        })
        /**
         * 已经有一个还没了结的任务在处理这个文件就不要再排一个。
         * 启动恢复走的也是 `enqueue`，没有这道闸门时"恢复"会把队列里的项再加一遍。
         */
        if (activeJobFor(group[0])) continue
        const head = addJob(group[0])
        accepted.push(group[0])
        schedule(head)
        push()
        continue
      }
      if (activeJobFor(p)) continue
      const job = addJob(p)
      accepted.push(p)
      schedule(job)
    }
    push()
    return { accepted, rejected }
  }

  registrar.ipc.handle('ingest:queue', (): IngestItemState[] => snapshot())

  registrar.ipc.handle('ingest:from-paths', (paths: unknown) => {
    if (!Array.isArray(paths)) throw new Error('路径列表无效')
    return enqueue(paths.filter((p): p is string => typeof p === 'string'))
  })

  // 标题由渲染进程传（主进程没有 i18next，不许硬编码界面文案）；没传就用系统默认标题。
  registrar.ipc.handle('ingest:pick-and-start', async (title: unknown) => {
    const r = await dialog.showOpenDialog({
      title: typeof title === 'string' && title.trim() ? title : undefined,
      properties: ['openFile', 'openDirectory', 'multiSelections']
    })
    if (!r.canceled && r.filePaths.length) await enqueue(r.filePaths)
  })

  registrar.ipc.handle('ingest:commit-manual', (input: unknown) => {
    if (!input || typeof input !== 'object') throw new Error('参数无效')
    const i = input as { jobId: string; name?: string; category: string; subcategory: string | null; password?: string }
    const job = jobs.get(i.jobId)
    if (!job) throw new Error('任务不存在或已清理')
    if (i.password) job.password = i.password
    return commit(job, { name: i.name, category: i.category, subcategory: i.subcategory ?? null, password: i.password })
  })

  /**
   * M7 ⑥ · 用户给了密码（`remember` 时顺手存进密码库）。
   *
   * 返回值是给界面看的那三种出口：`stored` / `unavailable`（这台机器存不了，**密码没用明文存**）/
   * `failed`。界面上必须把 `unavailable` 说出来，不能让人以为"勾了记住了"。
   */
  registrar.ipc.handle('ingest:submit-password', async (jobId: unknown, password: unknown, remember: unknown) => {
    if (typeof jobId !== 'string' || typeof password !== 'string') throw new Error('参数无效')
    const job = jobs.get(jobId)
    if (!job) throw new Error('任务不存在')
    job.password = password
    /** 用户重新给了密码 → 允许再试一次记住的那条（不然第一次撞错就再也不用了） */
    job.vaultTried = false
    let vault: 'stored' | 'unavailable' | 'failed' | 'skipped' = 'skipped'
    if (remember === true) vault = rememberArchivePassword(getDb(), job.item.sourcePath, password)
    update(jobId, { needsPassword: false, stage: 'queued', messageKey: 'ingest.requeued', message: '带密码重新处理' })
    schedule(job)
    return { ok: true, vault }
  })

  /**
   * 「全部入库」—— 一键把收件箱里所有待确认项按引擎给的第一选择登记入库。
   *
   * 三条硬约束（改动单 §1.5 / §7.3）：
   *  - 低置信度不阻塞，但标 needs_review，事后在「待复核」里能整批捞出来；
   *  - 整批共用一个 journal batchId，Ctrl+Z 一次撤掉全部，卡片退回收件箱；
   *  - 会动磁盘时必须由调用方显式说 move=true（界面那侧先弹三选二次确认）。
   */
  registrar.ipc.handle(
    'ingest:commit-all',
    async (input: unknown) => {
      const i = (input ?? {}) as { jobIds?: string[]; move?: boolean }
      const s = getSettings()
      /** 同 `commit()`：闸门只认 `libraryRootOrThrow()` 那一处（M7 ②） */
      libraryRootOrThrow()
      const want = Array.isArray(i.jobIds) && i.jobIds.length ? new Set(i.jobIds) : null
      const targets = Array.from(jobs.values()).filter(
        (j) => j.item.stage === 'awaiting_confirm' && j.result && (!want || want.has(j.item.jobId))
      )
      const total = targets.length
      const batchId = ulid()
      const summary = {
        total,
        committed: 0,
        review: 0,
        bundles: 0,
        moved: !!i.move,
        failed: [] as Array<{ jobId: string; name: string; messageKey: string; message: string }>
      }
      if (!total) return summary

      quiet = true
      let lastEmit = 0
      try {
        for (const job of targets) {
          const conf = job.result?.classification?.units[0]?.confidence ?? 0
          const isBundle = !!job.result?.classification?.tree
          try {
            await commit(job, { category: '', subcategory: null }, { move: i.move, batchId, batch: true })
            summary.committed++
            if (isBundle) summary.bundles++
            if (conf < s.confidenceAuto) summary.review++
          } catch (e) {
            const message = e instanceof Error ? e.message : String(e)
            summary.failed.push({ jobId: job.item.jobId, name: job.item.name, messageKey: 'ingest.commitOneFailed', message })
            log.warn('一键入库单项失败：' + job.item.sourcePath + ' —— ' + message)
          }
          const now = Date.now()
          if (now - lastEmit > 120) {
            lastEmit = now
            registrar.broadcast('ingest:commit-progress', { done: summary.committed + summary.failed.length, total })
          }
        }
      } finally {
        quiet = false
        if (flushTimer) {
          clearTimeout(flushTimer)
          flushTimer = null
        }
        registrar.broadcast('ingest:commit-progress', { done: summary.committed + summary.failed.length, total })
        registrar.broadcast('ingest:progress', snapshot())
      }
      batchIds.add(batchId)
      log.info(
        `一键入库：${summary.committed}/${total} 成功（其中 ${summary.review} 项标待复核、${summary.bundles} 个合集），失败 ${summary.failed.length}，${i.move ? '已移动文件' : '未移动文件'}`
      )
      // 批量补封面：一次扫，比 228 次各开一次解码便宜得多
      void backfillThumbs(getDb(), 400, { packages: false })
        .then((r) => {
          if (r.made) registrar.broadcast('data:changed', { reason: 'thumb-backfill', made: r.made })
        })
        .catch((e: unknown) => log.warn('批量补封面失败：' + (e instanceof Error ? e.message : String(e))))
      registrar.broadcast('data:changed', { reason: 'ingest-commit-all' })
      return summary
    }
  )

  /**
   * 撤销回来了 → 卡片退回收件箱。
   * 不做这件事的话，"撤销一次全部入库"只删了库记录，收件箱是空的，
   * 用户那 228 项看着就像被弄丢了一样。
   */
  const batchIds = new Set<string>()
  on(EV_UNDONE, (payload) => {
    const p = (payload ?? {}) as { batchId?: string | null; assetIds?: string[] }
    const ids = new Set(p.assetIds ?? [])
    let reopened = 0
    for (const job of jobs.values()) {
      const mine = (p.batchId && job.commitBatch === p.batchId) || (!!job.item.assetId && ids.has(job.item.assetId))
      if (!mine || job.item.stage !== 'done') continue
      job.commitBatch = undefined
      update(job.item.jobId, {
        stage: 'awaiting_confirm',
        assetId: undefined,
        progress: 1,
        messageKey: 'ingest.reopened',
        message: '已撤销，回到待确认'
      })
      reopened++
    }
    if (reopened) {
      log.info(`撤销后退回收件箱：${reopened} 项`)
      registrar.broadcast('data:changed', { reason: 'ingest-reopen' })
    }
  })

  registrar.ipc.handle('ingest:cancel', (jobId?: unknown) => {
    const ids = typeof jobId === 'string' ? [jobId] : Array.from(jobs.keys())
    for (const id of ids) {
      const j = jobs.get(id)
      if (!j) continue
      j.cancelled = true
      void j.worker?.terminate().catch(() => undefined)
      j.worker = null
      update(id, { stage: 'cancelled', messageKey: 'inbox.stage.cancelled', message: '已取消' })
      void dropStaging(j)
    }
  })

  // 卡片丢弃 = 这活儿不要了。worker 先停再删，不然会边写边被删。
  // 已提交的任务这里删的是空目录（内容早被 commit 搬走或送去 hold 了）。
  registrar.ipc.handle('ingest:dismiss', (jobId?: unknown) => {
    const gone = typeof jobId === 'string' ? [jobs.get(jobId)].filter((j): j is Job => !!j) : Array.from(jobs.values())
    if (typeof jobId === 'string') jobs.delete(jobId)
    else jobs.clear()
    for (const j of gone) {
      j.cancelled = true
      void j.worker?.terminate().catch(() => undefined)
      j.worker = null
      void dropStaging(j)
      /**
       * 丢弃 = 用户明确说"这活儿不要了"，**必须**从持久化队列里划掉。
       * 否则下次启动 `restoreQueue()` 会把它原样捞回来 —— 用户丢掉的东西自己爬回队列，
       * 是最让人恼火的一类 bug。
       */
      try {
        removeFromInboxQueue(P.inboxQueue(), j.item.sourcePath)
      } catch (e) {
        log.warn('丢弃卡片后队列未清理：' + (e instanceof Error ? e.message : String(e)))
      }
    }
    push()
  })

  /**
   * 启动时把上次没确认完的卡片捞回来。
   *
   * **重新入队而不是存 worker 结果**：worker 结果是 `(源路径, 设置, 词典)` 的确定性产物，
   * 而 staging 目录本来就不跨重启（`pruneStaging()` 启动即清），所以解压必须重做。
   * 走这条路等于白捡"用户点重试"已有的全部正确性，且不用新增表、不碰真库。
   *
   * 逐条错开入队：一次把几百个包砸进 TaskQueue 会让启动瞬间满负荷，
   * 而且用户是看着队列一个个回来的，"一次性冒出来"反而像个 bug。
   */
  async function restoreQueue(
    opts: { limit?: number; delayMs?: number } = {}
  ): Promise<{ recovered: number; missing: string[]; skipped: number }> {
    const limit = opts.limit ?? 200
    const delayMs = opts.delayMs ?? 300
    const file = P.inboxQueue()
    const items = readInboxQueue(file)
    const missing: string[] = []
    let skipped = 0
    const todo: string[] = []

    for (const it of items) {
      if (todo.length >= limit) break
      /** 源文件已经没了（被删/被移走）→ 从队列里剔除，别留一张点不开的卡 */
      try {
        fs.statSync(it.path)
      } catch {
        missing.push(it.path)
        removeFromInboxQueue(file, it.path)
        continue
      }
      /** 这个文件已经在队列里跑着了（比如两处同时恢复）→ 跳过 */
      if (activeJobFor(it.path)) {
        skipped++
        continue
      }
      todo.push(it.path)
    }

    for (let i = 0; i < todo.length; i++) {
      try {
        await enqueue([todo[i]])
      } catch (e) {
        log.warn('恢复收件箱项失败：' + todo[i] + ' —— ' + (e instanceof Error ? e.message : String(e)))
      }
      if (delayMs > 0 && i < todo.length - 1) await new Promise((r) => setTimeout(r, delayMs))
    }

    if (todo.length || missing.length) {
      log.info(`收件箱恢复：捞回 ${todo.length} 项、跳过 ${skipped} 项、剔除已不存在 ${missing.length} 项`)
    }
    return { recovered: todo.length, missing, skipped }
  }

  registrar.ipc.handle('ingest:restore-queue', () => restoreQueue())
  /** 只读体检：还剩多少在等我确认（设置页/排障用） */
  registrar.ipc.handle('ingest:queue-file', () => describeInboxQueue(P.inboxQueue()))

  return {
    enqueue,
    queue: snapshot,
    restoreQueue,
    dispose: () => {
      disposed = true
      for (const j of jobs.values()) {
        j.cancelled = true
        void j.worker?.terminate().catch(() => undefined)
      }
      jobs.clear()
    }
  }
}
