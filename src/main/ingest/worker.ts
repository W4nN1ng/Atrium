/**
 * 摄取 worker：哈希、格式探测、列目录、解压这些重活全在这里，主线程不参与
 * （第 1 份 §12 坑 8：不要在主线程做解压/哈希/解析，会卡死 UI）。
 *
 * 编译产物是 out/main/worker.js；打包后 worker_threads 读不了 asar 里的文件，
 * 所以 electron-builder.yml 里把它 asarUnpack 出去了。
 */
import { parentPort } from 'node:worker_threads'
import fs from 'node:fs'
import path from 'node:path'
import { probeFile, type ProbeResult } from '../unpack/magic'
import { listZip, extractZip } from '../unpack/unzip'
import { extractMembers } from '../unpack/members'
import { listArchive, extractArchive, PasswordNeededError, type ArchiveEntry } from '../unpack/sevenZip'
import { hashSampled, hashTree } from '../library/hash'
import { ensureDir, listTree } from '../library/fsx'
import { isJunkRelPath } from '../../shared/junk'
import type { WarnInfo } from '../../shared/api'
import type { CategoryConfig, ClassificationResult, IngestResult } from '../../shared/types'
import { classify, type LearningRow } from '../classify/engine'
import { loadLexicon, type Lexicon } from '../classify/lexicon'
import { extractMetadata, type SourceFile, type SourceReader } from '../fingerprint/metadata'
import { readZipEntryText } from '../unpack/unzip'
import { parseUnitypackage } from '../unpack/unitypackage'
import type { PackageParseResult } from '../../shared/types'
import fsMod from 'node:fs'

/** worker 里缓存一份词典 + 分类表：每个任务都读一遍磁盘就白干了（§9 性能） */
let lexCache: { root: string; user: string; lex: Lexicon } | null = null
let catCache: { root: string; cfg: CategoryConfig } | null = null

function lexiconFor(root: string, userFile?: string): Lexicon {
  const user = userFile ?? path.join(root, 'lexicon', 'lexicon.user.json')
  if (lexCache?.root === root && lexCache.user === user) return lexCache.lex
  const lex = loadLexicon({ builtin: path.join(root, 'lexicon', 'lexicon.json'), user })
  lexCache = { root, user, lex }
  return lex
}

function categoriesFor(root: string): CategoryConfig {
  if (catCache?.root === root) return catCache.cfg
  const cfg = JSON.parse(fsMod.readFileSync(path.join(root, 'lexicon', 'categories.json'), 'utf8')) as CategoryConfig
  catCache = { root, cfg }
  return cfg
}

/**
 * 元数据抽取用的"来源读取器"。
 * 默认不自动解压，所以 zip 里的 readme / .url 走按需单读；
 * 7z / rar 暂时只按名字抽（没做单读），readText 返回 null，元数据少一点但不卡流程。
 */
function makeReader(job: WorkerJob, entries: Array<{ path: string; size: number; isDir: boolean }>, staged: string | null): SourceReader {
  const files: SourceFile[] = entries.map((e) => ({ relPath: e.path, size: e.size, isDir: e.isDir }))
  const isZip = staged === null && /\.zip$/i.test(job.sourcePath)
  return {
    files: () => files,
    async readText(rel: string, maxBytes = 64 * 1024): Promise<string | null> {
      if (staged) {
        const abs = path.join(staged, rel)
        try {
          const st = fsMod.statSync(abs)
          if (st.isDirectory() || st.size > maxBytes) return null
          return fsMod.readFileSync(abs).subarray(0, maxBytes).toString('utf8')
        } catch {
          return null
        }
      }
      if (isZip) return readZipEntryText(job.sourcePath, rel, maxBytes)
      return null
    }
  }
}

/**
 * 包内套 .unitypackage 的情况：只把那几个内层包抽出来解析。
 *
 * §1.1 表格第 4 行要求"含 *.unitypackage → 递归解析该包后再判定"。
 * 不这么做的话 Grimoir_SHINANO_V1.0.zip 里明明写着 Assets/.../服/... ，
 * 引擎却只能看文件名，判成 other/0%（实测踩过）。
 * 只解内层那几个包（≤5 个、单个 ≤300MB），解到 dig 子目录，**读完立刻删**
 * —— 实测不删的话暂存目录会一路涨，而它在系统盘上。
 */
const DIG_LIMIT = 5
const DIG_LIMIT_STAGED = 12
const DIG_MAX_BYTES = 300 * 1024 * 1024

/** 删临时目录：删不掉也不该把分类流程搞崩，所以只吞异常不写日志（worker 里没 logger） */
async function removeTreeQuietly(dir: string): Promise<void> {
  try {
    await fs.promises.rm(dir, { recursive: true, force: true })
  } catch {
    /* 正被占用就留给下次启动的清扫 */
  }
}

/** 一次内层包解析出来的工程路径倒进语料 */
function pushUnityPaths(r: PackageParseResult, out: string[]): void {
  for (const e of r.entries) out.push(e.unityPath)
  if (r.hasEditorScript) out.push('Editor/dig.cs')
  if (r.hasShader) out.push('dig.shader')
}

/**
 * 已经解压过（设置里"自动解压"开着）：内层 .unitypackage 就在暂存目录里，
 * 直接读文件，省掉二次解压。
 *
 * 这条分支是补漏：以前只在"没解压"时挖包，结果一开自动解压，
 * 束縛チャイナFULLSET.zip 那种"zip 里装 1 个 unitypackage"的东西反而判成 other/0%
 * —— 解压只是把包挪到磁盘上，包里的 Assets/ 路径还得靠解析才看得见（实测踩过）。
 */
export async function digStagedUnitypackages(
  staged: string,
  files: Array<{ relPath: string; size: number }>
): Promise<{ extraPaths: string[]; parsed: number; failed: number }> {
  const targets = files
    .filter((f) => /\.unitypackage$/i.test(f.relPath) && f.size > 0 && f.size <= DIG_MAX_BYTES)
    .slice(0, DIG_LIMIT_STAGED)
  if (!targets.length) return { extraPaths: [], parsed: 0, failed: 0 }

  const extraPaths: string[] = []
  let parsed = 0
  let failed = 0
  for (const t of targets) {
    try {
      const r = await parseUnitypackage(path.join(staged, t.relPath), { scanRefs: false, maxEntries: 1200 })
      if (!r.ok) {
        failed++
        continue
      }
      parsed++
      pushUnityPaths(r, extraPaths)
    } catch {
      failed++
    }
  }
  return { extraPaths, parsed, failed }
}

/**
 * 从**没解压**的压缩包里挖内层包。
 *
 * ⚠ 导出只为让回归用例能直接打这条路径（P0-1 那个 bug 的全部症状就是
 * "函数跑完了、一条都没解析、也不报错"，从外面看整条摄取一切正常）。
 * 生产调用点只有一个：下面 `run()` 里的 `digUnitypackages(job, entries)`。
 */
export async function digUnitypackages(
  job: WorkerJob,
  entries: Array<{ path: string; size: number; isDir: boolean }>
): Promise<{ extraPaths: string[]; parsed: number; failed: number }> {
  const targets = entries
    .filter((e) => !e.isDir && /\.unitypackage$/i.test(e.path) && e.size > 0 && e.size <= DIG_MAX_BYTES)
    .slice(0, DIG_LIMIT)
  if (!targets.length) return { extraPaths: [], parsed: 0, failed: 0 }

  const dest = path.join(job.stagingPath, '_dig')
  const extraPaths: string[] = []
  let parsed = 0
  let failed = 0
  /**
   * 走共用的 `extractMembers`，**用它回报的 localPath**，不再自己拼路径。
   *
   * 旧写法是 `path.join(dest, path.basename(t.path))`，而抽取那一侧
   * （`extractZip` / `extractArchive`）是按**完整相对路径**落盘的 ——
   * 于是"包里还套了一层目录"这种真库最常见的形状（`TS_MaterialPack_1/TS_MaterialPack_1.unitypackage`）
   * 永远找不到文件，`existsSync` 为假就 `continue`，**一条日志都不留**。
   * 真库实测受影响 22 / 68 个内层包（32%）：分类时看不见内层包的资产路径，
   * 判分就退化成只看文件名。这条属于"实现了但从来没生效"那一类。
   */
  let landed: Awaited<ReturnType<typeof extractMembers>> | null = null
  try {
    await ensureDir(dest)
    landed = await extractMembers(job.sourcePath, dest, targets.map((t) => t.path), {
      password: job.password,
      extraBackendDirs: job.backendDirs
    })
  } catch {
    // 解不出来就别拖慢主流程，元数据少一层是一层
    await removeTreeQuietly(dest)
    return { extraPaths: [], parsed: 0, failed: targets.length }
  }

  for (const m of landed.members) {
    try {
      const r = await parseUnitypackage(m.localPath, { scanRefs: false, maxEntries: 1200 })
      if (!r.ok) {
        failed++
        continue
      }
      parsed++
      pushUnityPaths(r, extraPaths)
    } catch {
      failed++
    }
  }
  /**
   * 请求了但没落地的（后端通配没匹配上、名字被别的东西占住）也要算进 failed。
   * 不记就等于回到"静默少解析"，只是换了个地方少。
   */
  failed += landed.missing.length
  // 内层包抽出来只为读它的资产清单，读完就是垃圾。
  // 不删的话每个含 unitypackage 的包都在 C 盘留一份副本（实测 5 个任务 = 182 MB），
  // 真库一次收编几百项会把用户的系统盘写满 —— 分类信号已经进 extraPaths 了，这里可以安心删。
  await removeTreeQuietly(dest)
  return { extraPaths, parsed, failed }
}

/** 跑分类：任何一步出问题都不许把整条摄取带崩 */
async function runClassification(job: WorkerJob, entries: Array<{ path: string; size: number; isDir: boolean }>, staged: string | null, hash: string, sizeBytes: number, extraPaths: string[] = []): Promise<ClassificationResult | null> {
  try {
    const allEntries = extraPaths.length
      ? entries.concat(extraPaths.map((p) => ({ path: p, size: 0, isDir: false })))
      : entries
    const metadata = await extractMetadata({
      fileName: path.basename(job.sourcePath),
      dirChain: job.dirChain ?? [],
      reader: makeReader(job, allEntries, staged)
    })
    const ingest: IngestResult = {
      assetId: job.jobId,
      rawName: path.basename(job.sourcePath),
      sourceDirChain: job.dirChain ?? [],
      stagingPath: staged ?? job.stagingPath,
      sourceArchivePath: job.sourcePath,
      detectedKind: 'archive',
      detectedFormat: path.extname(job.sourcePath).replace('.', '').toLowerCase() || 'unknown',
      entries: allEntries.map((e) => ({ relPath: e.path, size: e.size, ext: (e.path.split('.').pop() ?? '').toLowerCase(), isDir: e.isDir })),
      metadata,
      usedPassword: job.password,
      nestedDepth: 1,
      totalBytes: sizeBytes,
      warnings: []
    }
    const learning = new Map(job.learning ?? [])
    return classify(ingest, { lex: lexiconFor(job.resourceRoot, job.userLexicon), categories: categoriesFor(job.resourceRoot), learning })
  } catch {
    return null
  }
}

export interface WorkerJob {
  type: 'job'
  jobId: string
  sourcePath: string
  /** 本任务的暂存目录（在 staging 下，绝不直接解压到库目录） */
  stagingPath: string
  extract: boolean
  password?: string
  backendDirs: string[]
  /** 词典 / 分类表所在目录（worker 拿不到 app 路径，主进程传进来） */
  resourceRoot: string
  /** learning 表序列化过来的"用户已学规则" */
  learning?: Array<[string, LearningRow[]]>
  /** 原始路径的目录链，语料权重 2.5（§1.2） */
  dirChain?: string[]
  /** 用户词典（`%APPDATA%\A\lexicon.user.json`）；打包后 resources 只读，所以单独传 */
  userLexicon?: string
  /** 关掉就只出指纹不分类（设置里"自动分类"关着时） */
  classify?: boolean
}

export type WorkerMessage =
  | {
      type: 'progress'
      jobId: string
      stage: string
      progress: number
      /** 界面文案只给 key + 参数（第 1 份 F11）；message 是日志兜底原文 */
      messageKey?: string
      messageParams?: Record<string, string | number>
      message?: string
    }
  | { type: 'need-password'; jobId: string; sourcePath: string }
  | { type: 'done'; jobId: string; result: WorkerResult }
  | { type: 'error'; jobId: string; code: string; message: string }

export interface WorkerResult {
  hash: string
  sizeBytes: number
  probe: ProbeResult
  entries: ArchiveEntry[]
  entryCount: number
  contentBytes: number
  /** 解压后落在磁盘上的清单（未开自动解压时为空） */
  looseFiles: Array<{ relPath: string; size: number; ext: string; isDir: boolean }>
  stagingPath: string | null
  warnings: WarnInfo[]
  /** M3 分类结果；设置里关掉自动分类时为 null */
  classification: ClassificationResult | null
}

const MAX_LIST_ENTRIES = 5000

/**
 * §A1 垃圾过滤（压缩包内层清单这一路）。
 * `listTree` 已经管住了目录型素材和解压后的暂存目录，但**不解压**时（默认设置就是不解压）
 * 清单是从 zip/7z 里直接读的，`__MACOSX/` 的碎片会原样进来 —— 实测能把介绍图当成素材本体，
 * 硬规则还会把 `.DS_Store` 认成"插件/动作类"。所以在读完清单的当场就过一遍。
 */
function dropJunk<T>(list: T[], pick: (x: T) => string): T[] {
  return list.filter((e) => !isJunkRelPath(pick(e)))
}

function post(msg: WorkerMessage): void {
  parentPort?.postMessage(msg)
}

function progress(
  jobId: string,
  stage: string,
  pct: number,
  messageKey: string,
  message: string,
  messageParams?: Record<string, string | number>
): void {
  post({ type: 'progress', jobId, stage, progress: pct, messageKey, messageParams, message })
}

async function handle(job: WorkerJob): Promise<void> {
  const warnings: WarnInfo[] = []
  let stat: fs.Stats
  try {
    stat = await fs.promises.stat(job.sourcePath)
  } catch (e) {
    post({ type: 'error', jobId: job.jobId, code: 'err.statFailed', message: e instanceof Error ? e.message : String(e) })
    return
  }

  // ---------------------------------------------------------------- 文件夹
  if (stat.isDirectory()) {
    progress(job.jobId, 'hashing', 0.1, 'ingest.msg.hashingTree', '算目录指纹')
    const t = await hashTree(job.sourcePath)
    progress(job.jobId, 'fingerprinting', 0.6, 'ingest.msg.listingTree', '列目录')
    const loose = await listTree(job.sourcePath, MAX_LIST_ENTRIES)
    const dirClassify = job.classify === false ? null : await runClassification(job, loose.map((x) => ({ path: x.relPath, size: x.size, isDir: x.isDir })), job.sourcePath, t.hash, t.bytes)
    post({
      type: 'done',
      jobId: job.jobId,
      result: {
        classification: dirClassify,
        hash: t.hash,
        sizeBytes: t.bytes,
        probe: {
          format: 'unknown',
          subtype: 'folder',
          isArchive: false,
          splitVolume: false,
          extMismatch: false,
          label: 'Folder'
        },
        entries: loose.slice(0, MAX_LIST_ENTRIES).map((f) => ({ path: f.relPath, size: f.size, isDir: f.isDir, encrypted: false })),
        entryCount: loose.length,
        contentBytes: t.bytes,
        looseFiles: loose,
        stagingPath: null,
        warnings
      }
    })
    return
  }

  // ---------------------------------------------------------------- 单文件
  progress(job.jobId, 'hashing', 0.15, 'ingest.msg.hashing', '算指纹')
  const hash = await hashSampled(job.sourcePath)

  progress(job.jobId, 'detecting', 0.3, 'ingest.msg.probing', '识别真实格式')
  const probe = await probeFile(job.sourcePath)
  if (probe.extMismatch)
    warnings.push({
      key: 'ingest.warn.extMismatch',
      params: { name: path.basename(job.sourcePath), label: probe.label },
      message: `扩展名与真实内容不符：${path.basename(job.sourcePath)} 实际是 ${probe.label}`
    })
  if (probe.splitVolume)
    warnings.push({ key: 'ingest.warn.splitVolume', message: '这是分卷压缩包，需要同组其它卷在旁边' })

  let entries: ArchiveEntry[] = []
  let contentBytes = stat.size
  let stagingPath: string | null = null
  let loose: WorkerResult['looseFiles'] = []

  const isZip = probe.format === 'zip'
  const isUnityPackage = probe.subtype === 'unitypackage-gzip'

  if (probe.isArchive && !isUnityPackage) {
    progress(job.jobId, 'extracting', 0.4, 'ingest.msg.listingEntries', '列包内清单')
    try {
      entries = isZip
        ? (await listZip(job.sourcePath)).entries
        : (await listArchive(job.sourcePath, { extraBackendDirs: job.backendDirs, password: job.password })).entries
      entries = dropJunk(entries, (e) => e.path)
    } catch (e) {
      if (e instanceof PasswordNeededError) {
        post({ type: 'need-password', jobId: job.jobId, sourcePath: job.sourcePath })
        return
      }
      post({ type: 'error', jobId: job.jobId, code: 'ingest.corruptArchive', message: e instanceof Error ? e.message : String(e) })
      return
    }
    contentBytes = entries.reduce((a, x) => a + (x.isDir ? 0 : x.size), 0)

    if (job.extract) {
      await ensureDir(job.stagingPath)
      stagingPath = job.stagingPath
      progress(job.jobId, 'extracting', 0.45, 'ingest.msg.extracting', '解压')
      const onProgress = (percent: number, current: string): void => {
        progress(
          job.jobId,
          'extracting',
          0.45 + Math.min(0.45, percent * 0.45),
          'ingest.msg.extractingFile',
          current,
          { file: current }
        )
      }
      try {
        if (isZip) await extractZip(job.sourcePath, job.stagingPath, { password: job.password, onProgress })
        else
          await extractArchive(job.sourcePath, job.stagingPath, {
            password: job.password,
            extraBackendDirs: job.backendDirs,
            onProgress
          })
      } catch (e) {
        if (e instanceof PasswordNeededError) {
          post({ type: 'need-password', jobId: job.jobId, sourcePath: job.sourcePath })
          return
        }
        post({ type: 'error', jobId: job.jobId, code: 'ingest.corruptArchive', message: e instanceof Error ? e.message : String(e) })
        return
      }
      loose = await listTree(job.stagingPath, MAX_LIST_ENTRIES)
    } else {
      warnings.push({
        key: 'ingest.warn.notExtracted',
        message: '未解压（设置里"自动解压"关着）：只登记原件与包内清单'
      })
    }
  } else {
    // 单文件素材（.unitypackage / .png / .psd / .exe …）
    entries = [{ path: path.basename(job.sourcePath), size: stat.size, isDir: false, encrypted: false }]
  }

  /** 内层 unitypackage：解没解压都要读内容（§1.1 第 4 行） */
  let extraPaths: string[] = []
  if (job.classify !== false) {
    progress(job.jobId, 'fingerprinting', 0.7, 'ingest.msg.diggingPackage', '读取内层 unitypackage')
    const dug = stagingPath
      ? await digStagedUnitypackages(stagingPath, loose.map((f) => ({ relPath: f.relPath, size: f.size })))
      : await digUnitypackages(job, entries)
    extraPaths = dug.extraPaths
    if (dug.parsed) {
      warnings.push({
        key: 'ingest.warn.dugUnitypackages',
        params: { count: dug.parsed, files: dug.extraPaths.length },
        message: `解析了 ${dug.parsed} 个内层 unitypackage，读出 ${dug.extraPaths.length} 条工程路径`
      })
    }
  }

  const classification =
    job.classify === false
      ? null
      : await runClassification(
          job,
          entries.length ? entries : loose.map((x) => ({ path: x.relPath, size: x.size, isDir: x.isDir })),
          stagingPath,
          hash,
          contentBytes,
          extraPaths
        )

  post({
    type: 'done',
    jobId: job.jobId,
    result: {
      hash,
      sizeBytes: stat.size,
      probe,
      entries: entries.slice(0, MAX_LIST_ENTRIES),
      entryCount: entries.length,
      contentBytes,
      looseFiles: loose,
      stagingPath,
      warnings,
      classification
    }
  })
}

parentPort?.on('message', (msg: WorkerJob) => {
  if (msg && msg.type === 'job') {
    void handle(msg).catch((e) => {
      post({ type: 'error', jobId: msg.jobId, code: 'ingest.workerCrash', message: e instanceof Error ? e.stack ?? e.message : String(e) })
    })
  }
})
