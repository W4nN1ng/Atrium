import fs from 'node:fs'
import path from 'node:path'
import log from 'electron-log'
import type {
  ContainerNotes,
  EmptyReasonKey,
  FoundPackage,
  ImportLogRow,
  PackageOrigin,
  PackagesOfAssetResult
} from '../../shared/types'
import { GUID_BATCH_SIZE, IMPORT_BACKUP_KEEP } from '../../shared/constants'
import type { Db } from '../db'
import { rollbackBlockReason } from '../db/repos/importHistory'
import { readBackupManifest, type BackupSaved } from './backupManifest'
export { readBackupManifest, type BackupSaved, type BackupManifest } from './backupManifest'
import { appendJournal, insertImportLog, patchImportLog } from '../db/repos/journal'
import { getProject } from '../db/repos/unity'
import { recordImportName } from '../db/repos/uiPrefs'
import { isBridgeInstalled, isHeartbeatStale, readHeartbeat } from '../bridge/mailbox'
import { parseUnitypackage } from '../unpack/unitypackage'
import { listContainerMembers, sortableMembers, type ContainerListing, type ContainerMember } from './containerPackages'
import { P } from '../services/paths'

/**
 * 单包导入：预扫描 → 冲突确认 → 串行导入 → 记账 → 可撤销（第 3 份 §5.1 / §5.3）。
 *
 * ## 为什么独立于 `BridgeManager`
 *
 * 这里只依赖一个**极小的注入接口**（`BridgeLike`），不直接 import 管理器。两个理由：
 *  1. **可测**。单测能喂一个"照稿念"的假桥接，把"冲突扫描 → 备份 → 导入 → 撤销"
 *     整条链跑完，不需要 Unity、也不需要真文件信箱的时序。
 *  2. **职责干净**。`BridgeManager` 只负责"把命令送达并拿回结果"；
 *     "该不该导、导完记什么账、怎么退回去"是导入编排的事。
 *
 * ## 三条不能违反的约束
 *
 *  - **撤销只删白名单**（R-65 / §5.3）：`delete_guids` 的 `allow` 必须是**本次导入的
 *    createdGuids**，而且 Unity 侧还会再校验一遍路径在 `Assets/` 下。绝不提供
 *    "按 GUID 随便删"的接口。
 *  - **被覆盖的文件先备份再导**（§5.3 / R-66）：备份到
 *    `%APPDATA%/A/backups/rollback/<importId>/`，只保留最近 `IMPORT_BACKUP_KEEP` 次，
 *    清理走回收站（**永不永久删除**）。
 *  - **删要删对行**：`insertImportLog` 内部自己生成 id，调用方必须把它读回来用。
 */

/** 导入编排需要桥接提供的最小能力。真实现是 `BridgeManager`，测试里是假货 */
export interface BridgeLike {
  execute(
    projectPath: string,
    type: 'resolve_guids' | 'import_unitypackage' | 'delete_guids' | 'refresh',
    payload: unknown,
    opts?: { label?: string; watchdogMs?: number; ackTimeoutMs?: number; id?: string }
  ): Promise<{
    ok: boolean
    status: string
    data: unknown
    error: string | null
    stackTrace: string | null
    elapsedMs: number
    retries: number
    commandId: string
  }>
}

export type ConflictChoice = 'cancel' | 'continue' | 'continue-with-backup'

export interface ImportConflict {
  guid: string
  /** 这个 GUID 在工程里已经落在哪个资源路径 */
  existingPath: string
  /** 包里它本来该落在哪 */
  incomingPath: string
}

export interface PreflightResult {
  ok: boolean
  /** 不能导入的原因（i18n key + 参数；界面照惯例自己翻译） */
  reasonKey: string | null
  reason: string | null
  /** 「桥接未安装 [立即安装]」要用的标志 */
  bridgeMissing: boolean
  packagePath: string
  entryCount: number
  /** 包内全部 GUID（分批 resolve_guids 用） */
  guids: string[]
  /** guid → 包内路径 */
  paths: Map<string, string>
  conflicts: ImportConflict[]
  /** 包内新建的（工程里还没有） */
  fresh: number
  parseError: string | null
}

export interface ImportResult {
  ok: boolean
  importId: string
  status: ImportLogRow['status']
  createdGuids: string[]
  overwrittenGuids: string[]
  backupDir: string | null
  /**
   * 备份目录里**真的存下了几个文件**。0 表示"当时盘上就没有那份文件，没东西可备份" ——
   * 这和"备份失败"是两件事，界面上也不许混着说。
   * 真机踩过：冲突框说会覆盖 2 个，实际 `备份 0 个被覆盖文件`，
   * 而横幅照样写「被覆盖的文件已备份」—— 那是撒谎，撤销时用户才发现没退路。
   */
  backupSaved: number
  error: string | null
  stackTrace: string | null
  elapsedMs: number
  /** busy 退避了几次（排查"是不是一直在 Play 模式"用） */
  retries: number
}

export interface ImportOptions {
  /** 素材行 id（从库里点卡片导入时给）。M5-A 也允许只给一个磁盘路径 */
  assetId?: string | null
  batchId?: string | null
  choice?: ConflictChoice
  /** 被覆盖文件是否备份。默认 true；调用方通常传设置里的 `backupOverwritten` */
  backupOverwritten?: boolean
  /** 清理旧备份用（默认真送回收站；测试可注入假货） */
  trashFn?: (p: string) => Promise<void>
  /**
   * 成员来源（M5-B）。**只有从容器清单里来的包才传这个**，
   * 散装直导留空 —— `import_log` 那三列的口径是"容器成员才有，散装为 NULL"，
   * 把它填成别的东西会让反查（"这个容器在哪些工程装过"）读出假事实。
   */
  origin?: PackageOrigin | null
}

// ---------------------------------------------------------------- 预扫描

/** 按 `GUID_BATCH_SIZE`（2000）分批，规格 §3 / §5.1③ 明确要求 */
/**
 * 素材写入的活动上报（P4-F 注入）。
 *
 * 只上报"开始/结束"，**不改导入算法**：`begin()` 返回幂等释放函数，
 * 协调器在 `finally` 里调用，异常/取消都不会漏。
 */
export interface ImportActivityHook {
  begin(projectPath: string): () => void
}

let importActivityHook: ImportActivityHook | null = null

export function setImportActivityHook(hook: ImportActivityHook | null): void {
  importActivityHook = hook
}

export function chunk<T>(list: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size))
  return out
}

/**
 * 只读预扫描。**不改任何东西**，不改工程、不写库。
 *
 * 冲突的定义：包内某个 GUID 在工程里**已经有对应的资源路径** ——
 * `AssetDatabase.ImportPackage` 落在同一 GUID 上就是覆盖那个文件。
 * 所以 §5.1④ 要的是"具体文件路径"，界面把它列出来给用户看。
 *
 * ⚠ `.unitypackage` 通常**就在工程外**（那正是要导入它的原因），所以这里
 * **不能**拿 `assertInside(projectPath, packagePath)` 去卡它。R-91「导入前校验目标
 * 在目标工程目录内」约束的是**工程内的落点**（`import_files` 的 destFolder、
 * `delete_guids` 的路径前缀），那两处分别在导入命令与 Unity 侧双重校验。
 */
export async function preflight(
  db: Db,
  bridge: BridgeLike,
  projectPath: string,
  packagePath: string,
  projectId: string
): Promise<PreflightResult> {
  const base: PreflightResult = {
    ok: false,
    reasonKey: null,
    reason: null,
    bridgeMissing: false,
    packagePath,
    entryCount: 0,
    guids: [],
    paths: new Map(),
    conflicts: [],
    fresh: 0,
    parseError: null
  }

  if (!getProject(db, projectId)) {
    return { ...base, reasonKey: 'unity.errNoProject', reason: '库里没有这个工程的记录' }
  }
  if (!fs.existsSync(packagePath)) {
    return {
      ...base,
      reasonKey: 'unity.errPackageMissing',
      reason: '找不到这个 .unitypackage：' + packagePath
    }
  }
  if (!isBridgeInstalled(projectPath)) {
    return {
      ...base,
      bridgeMissing: true,
      reasonKey: 'unity.errBridgeMissing',
      reason: '这个工程还没装桥接'
    }
  }
  const probe = readHeartbeat(projectPath)
  if (!probe.heartbeat || probe.invalid || isHeartbeatStale(probe)) {
    return {
      ...base,
      reasonKey: 'unity.errNoBridgeHeartbeat',
      reason: '桥接没有心跳：这个工程没开着 Unity，或者桥接被禁用了'
    }
  }

  const parsed = await parseUnitypackage(packagePath, { scanRefs: false })
  if (!parsed.ok) {
    return {
      ...base,
      parseError: parsed.error ?? '解析失败',
      reasonKey: 'unity.errParse',
      reason: parsed.error ?? '解析失败'
    }
  }
  const paths = new Map<string, string>()
  for (const e of parsed.entries) paths.set(e.guid, e.unityPath)
  const guids = [...paths.keys()]

  /** 分批问工程里这些 GUID 已经存在不存在 */
  const conflicts: ImportConflict[] = []
  for (const batch of chunk(guids, GUID_BATCH_SIZE)) {
    const r = await bridge.execute(
      projectPath,
      'resolve_guids',
      { guids: batch },
      { label: `查询 ${batch.length} 个 GUID 是否已存在`, ackTimeoutMs: 20_000 }
    )
    if (!r.ok) {
      return {
        ...base,
        guids,
        paths,
        entryCount: parsed.entries.length,
        reasonKey: 'unity.errResolveFailed',
        reason: r.error ?? '查询工程 GUID 失败'
      }
    }
    const resolved = (r.data as { resolved?: Record<string, string | null> } | null)?.resolved ?? {}
    for (const [guid, existingPath] of Object.entries(resolved)) {
      if (existingPath) {
        conflicts.push({ guid, existingPath, incomingPath: paths.get(guid) ?? '' })
      }
    }
  }

  return {
    ok: true,
    reasonKey: null,
    reason: null,
    bridgeMissing: false,
    packagePath,
    entryCount: parsed.entries.length,
    guids,
    paths,
    conflicts,
    fresh: guids.length - conflicts.length,
    parseError: null
  }
}

// ---------------------------------------------------------------- 备份

/** 备份目录：`%APPDATA%/A/backups/rollback/<importId>/`（§5.3 / R-66） */
export function rollbackDirFor(importId: string): string {
  return path.join(P.rollback(), importId)
}


/**
 * 把"将被覆盖"的那些文件从**工程里**复制到备份目录。
 *
 * 为什么必须现在抓：Unity 侧没有"导出单个资源"的桥接命令，而覆盖一旦发生旧内容就没了，
 * 所以只能在 `ImportPackage` **之前**复制。
 * 复制而不是移动：这个文件此刻仍属于工程，移走会让 Unity 当场报资源丢失。
 */
export function backupOverwritten(
  projectPath: string,
  importId: string,
  conflicts: ImportConflict[]
): { dir: string; saved: BackupSaved[]; missing: string[] } {
  const dir = rollbackDirFor(importId)
  fs.mkdirSync(dir, { recursive: true })
  const saved: BackupSaved[] = []
  const missing: string[] = []

  for (const c of conflicts) {
    /** `Assets/...` → 工程内绝对路径 */
    const rel = c.existingPath.replace(/^Assets\//i, '')
    const abs = path.join(projectPath, 'Assets', rel)
    if (!fs.existsSync(abs)) {
      missing.push(c.existingPath)
      continue
    }
    /**
     * 备份用 guid 当文件名（唯一、不含非法字符），原路径写进 manifest，
     * 否则撤销时不知道往哪塞回去。
     */
    const target = path.join(dir, `${c.guid}${path.extname(abs)}`)
    try {
      fs.copyFileSync(abs, target)
      saved.push({ guid: c.guid, assetPath: c.existingPath, file: path.basename(target) })
    } catch (e) {
      missing.push(c.existingPath)
      log.warn(`[import] 备份失败：${abs} —— ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  if (saved.length || missing.length) {
    fs.writeFileSync(
      path.join(dir, 'manifest.json'),
      JSON.stringify({ projectPath, saved, missing }, null, 2),
      'utf8'
    )
  }
  return { dir, saved, missing }
}


/**
 * 只保留最近 `IMPORT_BACKUP_KEEP`（20）次导入的备份，超出**走回收站**（§5.3 / R-66）。
 *
 * ⚠ 绝不 `fs.rm -rf`。备份目录里是**用户工程里被覆盖的原文件** ——
 * 直接删掉等于把唯一的退路销毁了（00§五-5：删除一律走回收站）。
 *
 * `root` 可注入：默认是 `%APPDATA%/A/backups/rollback`（`P.rollback()`）。
 * 单测**必须**传自己的临时目录 —— 不传的话它会去数全进程共享的那个目录，
 * 而并行跑的别的测试也在往里写备份，于是"该删 5 个"变成"该删 N 个"。
 * 实测：单跑绿、全量跑红，就是这么来的。
 */
export async function pruneBackups(
  trashFn: (p: string) => Promise<void>,
  keep = IMPORT_BACKUP_KEEP,
  root = P.rollback()
): Promise<{ removed: number; failed: string[] }> {
  let entries: string[]
  try {
    entries = fs.readdirSync(root)
  } catch {
    return { removed: 0, failed: [] }
  }
  const withTime = entries
    .map((name) => {
      const full = path.join(root, name)
      try {
        return { full, name, at: fs.statSync(full).mtimeMs }
      } catch {
        return null
      }
    })
    .filter((x): x is { full: string; name: string; at: number } => !!x)
    .sort((a, b) => b.at - a.at)

  const failed: string[] = []
  let removed = 0
  for (const d of withTime.slice(keep)) {
    try {
      await trashFn(d.full)
      removed++
    } catch (e) {
      failed.push(d.name)
      log.warn(`[import] 清理旧备份失败：${d.full} —— ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  return { removed, failed }
}

// ---------------------------------------------------------------- 执行导入

/**
 * 执行导入。**串行**由 `BridgeManager` 保证（同一工程一条 promise 链）。
 *
 * 记账顺序（R-58：先落库再发命令）：先插一条 `status='queued'`，
 * 拿到 id 后 patch 成 `running`，终态到了才写 `ok`/`failed`。
 * 这样程序中途被杀，库里也留着一条"排过队但没结果"的记录，而不是什么都不留。
 */
export async function importUnitypackage(
  db: Db,
  bridge: BridgeLike,
  projectPath: string,
  packagePath: string,
  projectId: string,
  pre: PreflightResult,
  opts: ImportOptions = {}
): Promise<ImportResult> {
  // 导入期间这个工程不能被包事务/备份等维护写碰；结束（含异常/取消）立刻释放。
  const release = importActivityHook?.begin(projectPath) ?? null
  try {
    return await importUnitypackageInner(db, bridge, projectPath, packagePath, projectId, pre, opts)
  } finally {
    release?.()
  }
}

async function importUnitypackageInner(
  db: Db,
  bridge: BridgeLike,
  projectPath: string,
  packagePath: string,
  projectId: string,
  pre: PreflightResult,
  opts: ImportOptions = {}
): Promise<ImportResult> {
  const startedAt = Date.now()
  const choice = opts.choice ?? 'continue'
  const wantBackup = opts.backupOverwritten ?? true
  const assetId = opts.assetId ?? null
  /**
   * 容器成员才填那三列（见 `ImportOptions.origin` 的注释）。
   * `memberRelPath` 是"从容器清单里来"的判据 —— 散装直导时它是 null，三列全留 NULL，
   * 与 V5 迁移注释里"老行 NULL = 散装直导"的口径一致。
   */
  const container = opts.origin?.memberRelPath ? opts.origin : null

  const row = insertImportLog(db, {
    projectId,
    assetId,
    batchId: opts.batchId ?? null,
    unitypackagePath: packagePath,
    containerAssetId: container?.containerAssetId ?? null,
    memberRelPath: container?.memberRelPath ?? null,
    originArchive: container?.originArchive ?? null,
    status: 'queued',
    kind: 'import',
    message: choice === 'continue-with-backup' ? '导入前会备份被覆盖的文件' : '直接导入'
  })
  /** `insertImportLog` 内部自己生成 id，必须读回来用 —— 另生成一个会 patch 到不存在的行 */
  const importId = row.id

  patchImportLog(db, importId, { status: 'running', started_at: startedAt })

  let backupDir: string | null = null
  let backupSaved = 0
  try {
    const shouldBackup =
      pre.conflicts.length > 0 &&
      (choice === 'continue-with-backup' || (choice !== 'cancel' && wantBackup))
    if (shouldBackup) {
      const b = backupOverwritten(projectPath, importId, pre.conflicts)
      backupDir = b.dir
      backupSaved = b.saved.length
      patchImportLog(db, importId, {
        backup_dir: backupDir,
        message:
          `导入前备份了 ${b.saved.length} 个将被覆盖的文件` +
          (b.missing.length ? `（${b.missing.length} 个没找到，未能备份）` : '')
      })
      log.info(`[import] 备份 ${b.saved.length} 个被覆盖文件 → ${backupDir}`)
    }

    const r = await bridge.execute(
      projectPath,
      'import_unitypackage',
      {
        path: packagePath,
        /** 让桥接能用包内 GUID 列表做前后差集算 createdGuids（§6.3） */
        guids: pre.guids,
        backupOverwritten: !!backupDir
      },
      { label: `导入 ${path.basename(packagePath)}`, watchdogMs: 10 * 60_000, ackTimeoutMs: 30_000 }
    )

    const data = (r.data ?? {}) as { createdGuids?: string[]; overwrittenGuids?: string[] }
    const createdGuids = data.createdGuids ?? []
    const overwrittenGuids = data.overwrittenGuids ?? []
    /** §2.4 口径映射：桥接结果用 `error`，import_log 用 `failed` */
    const status: ImportLogRow['status'] = r.ok
      ? 'ok'
      : r.status === 'cancelled'
        ? 'cancelled'
        : 'failed'

    patchImportLog(db, importId, {
      status,
      created_guids_json: JSON.stringify(createdGuids),
      overwritten_json: JSON.stringify(overwrittenGuids),
      finished_at: Date.now(),
      message: r.error
    })

    if (r.ok) {
      appendJournal(
        db,
        {
          op: 'import',
          importLogId: importId,
          projectId,
          /**
           * **不带 `assetIds`**（设计 §3.6）。这不是洁癖：`undoLast` 会把同批次每行的
           * `payload.assetIds` 攒进 `touchedAssets`，整批撤完就 `deleteAssetRow` ——
           * 而导入根本不属于"文件操作那一批"，一次 Ctrl+Z 绝不该把用户点的那张卡从库里删掉。
           * "这次导的是哪张卡"由 `import_log.asset_id` / `container_asset_id` 记，那边才是台账。
           */
          label: `导入 ${path.basename(packagePath)} 到 ${path.basename(projectPath)}`
        },
        { batchId: opts.batchId ?? importId }
      )
      /**
       * 「导进去以后在 Unity 里叫什么」——用户反馈里最烦的一件事：
       * 素材叫"糖果"，进工程以后变成 `Assets/shinano Candy/`，回头分不清哪个文件夹是谁。
       * 名字取**这个包真实落盘路径的一级目录**（`pre.paths` 在预检时已整包解析），
       * 不是从素材名猜。失败/取消不会走到这里；名字为空（纯代码包）也不记。
       */
      try {
        recordImportName(db, {
          assetId,
          projectId,
          unityPaths: pre.paths.values(),
          packagePath
        })
      } catch (e) {
        /** 记历史失败绝不能把一次**已经成功了**的导入判成失败 */
        log.warn('[import] 记导入名字失败：' + (e instanceof Error ? e.message : String(e)))
      }
    }

    await pruneBackups(opts.trashFn ?? defaultTrash).catch(() => undefined)

    return {
      ok: r.ok,
      importId,
      status,
      createdGuids,
      overwrittenGuids,
      backupDir,
      backupSaved,
      error: r.error,
      stackTrace: r.stackTrace,
      elapsedMs: r.elapsedMs,
      retries: r.retries
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    patchImportLog(db, importId, { status: 'failed', finished_at: Date.now(), message: msg })
    return {
      ok: false,
      importId,
      status: 'failed',
      createdGuids: [],
      overwrittenGuids: [],
      backupDir,
      backupSaved,
      error: msg,
      stackTrace: null,
      elapsedMs: Date.now() - startedAt,
      retries: 0
    }
  }
}

// ---------------------------------------------------------------- 撤销导入

export interface RollbackResult {
  ok: boolean
  importId: string
  deletedFiles: string[]
  restoredFiles: string[]
  /** 有 `overwritten` 但没开备份 → 内容找不回来了，必须如实告诉用户 */
  unrestorable: number
  /**
   * 白名单里**桥接没删掉**的那些路径（`delete_guids` 的 `failed`）。
   * 以前这个数组被直接丢掉：桥接回 `{deleted:[],failed:[…]}` 时，
   * 界面只会显示"删除 0 个新建资源"，看起来像"本来就没建东西"，
   * 而真相是"有一个资源没删掉"。
   */
  failedToDelete?: string[]
  error: string | null
}

/**
 * 撤销一次导入（§5.3）：
 *  1. `delete_guids(createdGuids)` —— **只删本次新建的**（白名单）
 *  2. `backup_dir` 存在 → 把备份复制回原位
 *  3. 不存在但有 `overwritten` → 告诉用户"有 N 个文件被覆盖，没开备份，无法还原内容"
 *  4. `import_log.status = 'rolledback'` + 写 journal（op = `import_rollback`）
 *
 * ⚠ 顺序必须是**先删后还原**：反过来的话，刚还原的那个文件可能正好落在
 * `createdGuids` 对应的路径上，随后的删除会把刚救回来的内容一起带走。
 */
export async function rollbackImport(
  db: Db,
  bridge: BridgeLike,
  projectPath: string,
  importId: string
): Promise<RollbackResult> {
  // 撤销也是一次素材写入：同样要挡住维护写。
  const release = importActivityHook?.begin(projectPath) ?? null
  try {
    return await rollbackImportInner(db, bridge, projectPath, importId)
  } finally {
    release?.()
  }
}

async function rollbackImportInner(
  db: Db,
  bridge: BridgeLike,
  projectPath: string,
  importId: string
): Promise<RollbackResult> {
  const logRow = db.prepare(`SELECT * FROM import_log WHERE id = ?`).get(importId) as
    | ImportLogRow
    | undefined
  if (!logRow) {
    return {
      ok: false,
      importId,
      deletedFiles: [],
      restoredFiles: [],
      unrestorable: 0,
      error: '找不到这条导入记录'
    }
  }
  if (logRow.status !== 'ok') {
    return {
      ok: false,
      importId,
      deletedFiles: [],
      restoredFiles: [],
      unrestorable: 0,
      /**
       * `running` 单独说一句：它现在也可能是"正在撤销"（撤销会先把行占住，见下面的原子抢权），
       * 原文那句"只有成功的导入才能撤销"会让人以为撤销坏了。
       */
      error:
        logRow.status === 'running'
          ? '这条导入还在进行中（或正在撤销），先等它结束'
          : `这条导入的状态是 ${logRow.status}，只有成功的导入才能撤销`
    }
  }

  const blocked = rollbackBlockReason(db, importId)
  if (blocked) return { ok: false, importId, deletedFiles: [], restoredFiles: [], unrestorable: 0, error: `i18n:${blocked}` }

  const created = safeJsonArray(logRow.created_guids_json)
  const overwritten = safeJsonArray(logRow.overwritten_json)
  const deletedFiles: string[] = []
  const restoredFiles: string[] = []
  const failedToDelete: string[] = []

  const probe = readHeartbeat(projectPath)
  if (!probe.heartbeat || probe.invalid || isHeartbeatStale(probe)) {
    return {
      ok: false,
      importId,
      deletedFiles,
      restoredFiles,
      unrestorable: 0,
      error: 'Unity 没开着（桥接没有心跳）。撤销导入要删掉工程里新建的资源，必须让 Unity 在线'
    }
  }

  /**
   * **抢这一行的撤销权**：原子地把 `ok` 改成 `running`，改不动就停手。
   *
   * 真机抓到的事故形状（2026-10-07，沙盒 + 真 Unity）：界面上「整批退回」被点了两次
   * （活体脚本自己双击的，人手快双击也一样），两次都读到 `status='ok'`，
   * 于是同一批资源删了两遍 —— 桥接第一遍回 `{deleted:[路径]}`、第二遍回
   * `{deleted:[],failed:[同一个路径]}`，**后写的那次把 message 覆盖成
   * 「撤销：删除 0 个新建资源」**。数字看着像"本来就没建东西"，用户以为撤销没生效。
   *
   * 撤销失败要把状态放回 `ok`（见下面的 `releaseClaim`），否则这一行会永远卡在
   * `running`，既撤不掉也撤第二次 —— 和 M5-B 记的"撤销失败不许写 undone=1"是同一条纪律。
   */
  const claim = db.prepare(`UPDATE import_log SET status = 'running' WHERE id = ? AND status = 'ok'`).run(importId)
  if (Number(claim.changes) === 0) {
    return {
      ok: false,
      importId,
      deletedFiles,
      restoredFiles,
      unrestorable: 0,
      error: '这条导入正在撤销，或者已经撤过了 —— 先等上一次结束'
    }
  }
  const releaseClaim = (msg: string): void => {
    patchImportLog(db, importId, { status: 'ok', message: msg })
  }

  /** 1. 只删白名单里的。`allow` 就是 createdGuids —— 桥接侧还会再校验路径在 Assets/ 下 */
  if (created.length) {
    const r = await bridge.execute(
      projectPath,
      'delete_guids',
      { guids: created, allow: created },
      { label: `撤销导入：删除 ${created.length} 个新建资源`, watchdogMs: 5 * 60_000 }
    )
    if (!r.ok) {
      releaseClaim(`撤销没做成：${r.error ?? '删除新建资源失败'}`)
      return {
        ok: false,
        importId,
        deletedFiles,
        restoredFiles,
        unrestorable: 0,
        error: r.error ?? '删除新建资源失败'
      }
    }
    const data = (r.data ?? {}) as { deleted?: string[]; failed?: string[] }
    deletedFiles.push(...(data.deleted ?? []))
    /** 桥接说"这个我没能删掉"以前是被丢掉的 → 界面只剩"删除 0 个"，看不出有东西留在工程里 */
    failedToDelete.push(...(data.failed ?? []))
  }

  /** 2. 还原被覆盖的文件 */
  let unrestorable = 0
  /** 备份里有、但复制回去这一步失败的：内容同样没救回来，必须计入"没还原"，不许只写进日志 */
  let restoreFailed = 0
  if (logRow.backup_dir) {
    const manifest = readBackupManifest(logRow.backup_dir)
    if (manifest) {
      for (const s of manifest.saved) {
        const rel = s.assetPath.replace(/^Assets\//i, '')
        const dest = path.join(projectPath, 'Assets', rel)
        try {
          fs.mkdirSync(path.dirname(dest), { recursive: true })
          fs.copyFileSync(path.join(logRow.backup_dir, s.file), dest)
          restoredFiles.push(s.assetPath)
        } catch (e) {
          restoreFailed++
          log.warn(`[import] 还原失败：${dest} —— ${e instanceof Error ? e.message : String(e)}`)
        }
      }
      await bridge.execute(projectPath, 'refresh', {}, { label: '还原后刷新资源库' })
    }
    /** manifest 里的 missing 是"当时就没找到"的，同样算不可还原 */
    const saved = new Set(manifest?.saved.map(s => s.guid.toLowerCase()) ?? [])
    unrestorable = Math.max(manifest?.missing.length ?? 0,
      overwritten.filter(g => !saved.has(g.toLowerCase())).length) + restoreFailed
  } else if (overwritten.length) {
    unrestorable = overwritten.length
  }

  const complete = unrestorable === 0 && failedToDelete.length === 0
  patchImportLog(db, importId, {
    status: complete ? 'rolledback' : 'rollbackpartial',
    finished_at: Date.now(),
    message:
      `撤销：删除 ${deletedFiles.length} 个新建资源、还原 ${restoredFiles.length} 个被覆盖文件` +
      (failedToDelete.length ? `；有 ${failedToDelete.length} 个没能删掉，工程里可能还留着` : '') +
      (unrestorable ? `；另有 ${unrestorable} 个被覆盖文件内容找不回来（当时没开备份或还原失败）` : '')
  })
  appendJournal(
    db,
    {
      op: 'import_rollback',
      importLogId: importId,
      projectId: logRow.project_id,
      /** 同上：**撤销记录更不带 `assetIds`**。这条记录描述的是"从工程里退回资源"，
       * 与库里的素材卡无关；带上就会让一次 Ctrl+Z 有机会删掉用户的卡片。 */
      label: `撤销导入（${path.basename(logRow.unitypackage_path ?? importId)}）`
    },
    { batchId: importId }
  )

  return { ok: complete, importId, deletedFiles, restoredFiles, unrestorable, failedToDelete,
    error: complete ? null : 'i18n:importHistory.partialWarning' }
}

function safeJsonArray(json: string | null): string[] {
  if (!json) return []
  try {
    const v = JSON.parse(json) as unknown
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

/**
 * 默认的"删除"实现。正式路径**不会**走到这里 —— 调用方必须注入 `shell.trashItem`。
 * 留成 `rm` 只是让测试与没有 electron 的环境能跑；
 * 注意它只被 `pruneBackups` 用（清理**旧的备份副本**），从不用来删用户的库文件。
 */
async function defaultTrash(p: string): Promise<void> {
  await fs.promises.rm(p, { recursive: true, force: true })
}

// ---------------------------------------------------------------- 找包

/**
 * `PackageOrigin` / `FoundPackage` / `PackagesOfAssetResult` 这几个类型是**主进程与
 * 渲染进程共用的同一份**，定义在 `shared/types.ts`（M5-B 那节的注释写了为什么）。
 * 这里 re-export 是给既有引用路径（`from './coordinator'`）留的。
 */
export type {
  PackageOrigin,
  FoundPackage,
  ContainerNotes,
  EmptyReasonKey,
  PackagesOfAssetResult
} from '../../shared/types'

/** 一个容器"没列全 / 看不动"的那些实话 → 界面按 key 出文案（P0-4：不许静默少列） */
function notesOf(list: ContainerListing): ContainerNotes {
  return {
    cappedDepth: list.capped.depth,
    cappedCount: list.capped.count,
    blocked: list.blocked.map((b) => ({ relPath: b.relPath, key: b.key, detail: b.detail ?? null })),
    needsPassword: list.needsPassword,
    scannedEntries: list.scannedEntries,
    backend: list.backend
  }
}

/** 空结果的统一出口（`packages: []` 是类型要求的字面量空数组） */
function emptyResult(reasonKey: EmptyReasonKey, notes: ContainerNotes | null): PackagesOfAssetResult {
  return { kind: 'empty', reasonKey, packages: [], notes }
}

/**
 * 这张卡底下有什么**能拿来导入**的东西。
 *
 * 三条口径：
 *  - **先看磁盘事实再看名字**：`Texture_Package.zip` 这类"名字叫 .zip 的目录"走目录分支（P0-3）。
 *    这条判断本身在 `listContainerMembers` 里，这里不再重复一遍 —— 同一个规则写两遍一定会漂。
 *  - **压缩包只列不抽**：抽取是用户勾了之后 `memberImport.planMemberImport` 的事。
 *  - **上限撞线要说出来**：`notes` 里的 `capped*` / `blocked` 是给界面的（P0-4）。
 */
export async function packagesOfAsset(
  db: Db,
  assetId: string,
  opts: { password?: string; extraBackendDirs?: string[] } = {}
): Promise<PackagesOfAssetResult> {
  const row = db
    .prepare(`SELECT library_path AS l, source_path AS s FROM asset WHERE id = ?`)
    .get(assetId) as { l: string | null; s: string | null } | undefined
  if (!row) return emptyResult('noRow', null)
  const p = row.l ?? row.s
  if (!p) return emptyResult('noPath', null)

  /**
   * 先看磁盘事实。单个 `.unitypackage` 文件**不是容器**，必须在这里就报出来：
   * `listContainerMembers` 会按 magic bytes 认出它是 gzip 而把它当压缩包列，
   * 列出来的是 tar 里的 GUID 目录 —— 一个 `.unitypackage` 成员都看不见，
   * 于是"库里 31 张散装包卡"全被判成"没有可导的包"。
   */
  const st = statOf(p)
  if (!st) return emptyResult('missing', null)
  if (st.isFile() && /\.unitypackage$/i.test(p)) {
    /**
     * 单个 `.unitypackage` 文件本身**不是容器**，所以 `memberRelPath` 是 null。
     * 这一条不是形式主义：`member_rel_path` 非空就是"容器成员"的判据
     * （见 `ImportOptions.origin` 与 V5 迁移注释 —— "散装直导那三列留 NULL"）。
     * 把它填成文件名，库里 31 张散装包卡的导入记录就全变成"某容器的成员"，
     * 反查"这张卡在哪些工程装过"跟着一起说假话。
     */
    return {
      kind: 'loose',
      packages: [
        {
          path: p,
          relPath: path.basename(p),
          sizeBytes: st.size,
          origin: { containerAssetId: assetId, originArchive: null, memberRelPath: null }
        }
      ],
      notes: null
    }
  }

  const list = await listContainerMembers(p, opts)
  const notes = notesOf(list)
  const originOf = (m: ContainerMember): PackageOrigin => ({
    containerAssetId: assetId,
    originArchive: m.originArchive,
    memberRelPath: m.relPath
  })

  if (!list.members.length) {
    /** 路径在、但没有能导的包。"要密码""列不出来"这些原因在 notes.blocked 里 */
    return emptyResult('noPackage', notes)
  }
  const packages: FoundPackage[] = sortableMembers(list).map((m) => ({
    path: m.absPath,
    relPath: m.relPath,
    sizeBytes: m.sizeBytes,
    origin: originOf(m)
  }))
  return { kind: list.isArchive ? 'archive' : 'loose', packages, notes }
}

function statOf(p: string): fs.Stats | null {
  try {
    return fs.statSync(p)
  } catch {
    return null
  }
}
