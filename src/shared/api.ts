import type { HealthReport,
  AppSettings,
  AssetCard,
  AssetFilter,
  AssetRow,
  AssetStatus,
  BridgeFirstSeenEvent,
  CancelBatchResult,
  CategoryConfig,
  CollectionRow,
  CommitResult,
  DetailInfo,
  LearnedCorrection,
  ExtractCleanOutcome,
  ExtractUsage,
  ImportPackageResult,
  ImportHistoryPage,
  ImportHistoryQuery,
  JournalRow,
  LocaleKey,
  ModelBackfillPlan,
  ModelBackfillResult,
  PackagesOfAssetResult,
  PlanResult,
  PreflightView,
  ProjectInfo,
  RememberedEntry,
  ReasonPart,
  RearchiveFailure,
  RearchiveOutcome,
  RearchiveResult,
  RollbackBatchResult,
  RollbackResult,
  UnityInstance,
  UnityStatus,
  VariantDim,
  VariantRow
} from './types'
import type { DirectoryProbe } from './wizardState'
import type { CoverBatch, CoverDiscovery, CoverPreview, CoverRecord, CoverRequest, CoverStatus, PreviewTarget, PackageCoverStatus, PackageCoverProgress, PackageCoverSetup } from './covers'

export interface AppInfo {
  name: string
  version: string
  electron: string
  node: string
  chrome: string
  platform: string
  locale: string
  /** 单实例锁是否由本进程持有 */
  isPrimary: boolean
}

export interface PathInfo {
  libraryRoot: string | null
  appData: string
  dbPath: string
  staging: string
  thumbs: string
  backups: string
  logs: string
  resourceRoot: string
  /** 库根是否可访问（拔盘/改盘符检测，第 1 份 §7 可靠性） */
  libraryAccessible: boolean
  libraryProblem: string | null
}

export interface IngestItemState {
  jobId: string
  sourcePath: string
  name: string
  stage: 'queued' | 'hashing' | 'detecting' | 'extracting' | 'fingerprinting' | 'classifying' | 'awaiting_confirm' | 'committing' | 'done' | 'failed' | 'cancelled' | 'duplicate'
  progress: number
  /** 界面文案：主进程只给 i18n key + 参数，message 是给人看日志用的兜底原文（第 1 份 F11 不许硬编码） */
  messageKey?: string
  messageParams?: Record<string, string | number>
  message: string
  error?: string
  assetId?: string
  /** 查重命中时给出已有素材位置 */
  duplicateOf?: { assetId: string; path: string | null; name: string }
  /**
   * 识别为合集时带这份预览：收件箱里它是**一张卡**（改动单 §3），
   * 卡片上内联展开子项（最多 5 行 + "还有 N 项"），不再拆成一堆卡片。
   */
  bundle?: BundlePreview
  /** M2 手工分类桩需要的候选 */
  detectedKind?: string
  detectedFormat?: string
  stagingPath?: string
  entriesPreview?: string[]
  entryCount?: number
  warnings?: WarnInfo[]
  needsPassword?: boolean
  bytes?: number
  /** M3：分类引擎给的建议（一个包可能拆成多项） */
  units?: ClassifiedUnitView[]
  /** 合集名（拆包时父级合集） */
  bundleName?: string | null
}

/**
 * 主进程 / worker 往界面回提示只给 i18n key + 参数（第 1 份 F11）。
 * message 是给人看日志的兜底原文，界面不许直接显示它。
 */
export interface WarnInfo {
  key: string
  params?: Record<string, string | number>
  message?: string
}

/** 分类结果里界面要用的那部分 */
export interface ClassifiedUnitView {
  name: string
  category: string
  subcategory: string | null
  confidence: number
  /** 绿 / 黄 / 红，主进程算好，省得前端各写一套阈值 */
  tone: 'ok' | 'warn' | 'bad'
  reasonParts: ReasonPart[]
  reason: string
  tags: string[]
  targetAvatars: string[]
  version: string | null
  author: string | null
  localeTag: string | null
  sourceItemId: string | null
  sourceItemIdConfidence: number
  bundleRef: string | null
}

export interface GroupSummary {
  groupId: string
  key: string
  name: string
  category: string
  subcategory: string | null
  /** 组内素材份数：卡片上"N 变体"徽章看这个，不是 variant 行数 */
  variantCount: number
  /** 成员之间到底在哪些维度上不同（avatar / version / locale / install_method …） */
  dims: VariantDim[]
  assetIds: string[]
}

export interface Stats {
  /** 顶层素材数（不含合集，也不含合集里的子项） */
  assets: number
  groups: number
  /** 合集卡数 */
  bundles: number
  /** 合集里的子项总数 */
  bundleItems: number
  /**
   * @deprecated 老状态位；低置信度现在也直接算已分类，不再阻塞入库。
   * （"待复核"那一列已于 2026-10-15 随功能一起删除）
   */
  pendingConfirm: number
  inbox: number
  collections: number
  tags: number
  totalBytes: number
  dbBytes: number
}

export interface RejectedPath {
  path: string
  /** i18n key，渲染进程优先用它出文案 */
  code?: string
  params?: Record<string, string | number>
  /** 兜底原文，只用于日志和 key 缺失时 */
  reason: string
}

export interface UndoResult {
  ok: boolean
  journalId?: number
  batchId?: string | null
  op?: string
  undone: number
  messageKey?: string
  messageParams?: Record<string, string | number>
  message?: string
  error?: string
}

export interface ListResult {
  cards: AssetCard[]
  total: number
  offset: number
}

/** preload 暴露给渲染进程的唯一入口：window.a */
export interface AApi {
  covers: {
    packageStatus(): Promise<PackageCoverStatus>
    packageSetup(assetId: string): Promise<PackageCoverSetup>
    /**
     * 这个素材在磁盘上的根目录（目录本身；素材是单个文件时给它的父目录）。
     * 路径不在盘上或没有路径时回 `null`。
     */
    assetRoot(assetId: string): Promise<string | null>
    discoverPackage(assetId: string, requestId: string, dependencyProjectId?: string): Promise<CoverDiscovery>
    packageProgress(requestId: string): Promise<PackageCoverProgress | null>
    status(assetId: string, projectId: string): Promise<CoverStatus>
    targets(projectId: string, query: string): Promise<PreviewTarget[]>
    discover(assetId: string, projectId: string, requestId: string): Promise<CoverDiscovery>
    preview(request: CoverRequest): Promise<CoverPreview>
    save(assetId: string, previewId: string): Promise<CoverRecord>
    discard(previewId: string): Promise<void>
    upload(assetId: string, file: string): Promise<CoverRecord>
    restore(assetId: string): Promise<void>
    startBatch(assetIds: string[]): Promise<CoverBatch>
    batchStatus(batchId: string): Promise<CoverBatch>
    cancelBatch(batchId: string): Promise<void>
    upgradeBridge(projectId: string): Promise<{ ok: boolean }>
  }
  system: {
    /**
     * 截图前把主窗口顶到最前（Chromium 不在前台就不绘制，captureScreenshot 会一直等帧）。
     * 主进程只在带着 `--remote-debugging-port` 起来时注册这个通道，正常使用时它不存在。
     */
    nudgeFront(on: boolean): Promise<boolean>
    info(): Promise<AppInfo>
    paths(): Promise<PathInfo>
    backupDatabase(title?: string): Promise<{ cancelled: boolean; path: string | null; bytes: number }>
    /**
     * M7 ③ · 只读探测一个目录（首启向导第 ① 步）。
     * 主进程那边有封顶（深度 3 / 访问 8000 条 / 数到 500 个就停），
     * 所以 `capped=true` 时界面要写"500+"而不是把封顶值当精确值报出去。
     */
    probeDirectory(path: string): Promise<DirectoryProbe>
    pickDirectory(opts?: { title?: string; defaultPath?: string }): Promise<string | null>
    /**
     * 选文件。
     *
     * `defaultPath` 是**目录**，决定对话框打开时停在哪 —— 不传就沿用系统上一次用过的目录
     * （那种"打开到上一个素材的文件夹"就是这么来的）。
     * `buttonLabel` 默认仍是摄取流程的措辞，非摄取调用方应自己传合适的词。
     */
    pickFiles(opts?: {
      title?: string
      filters?: { name: string; extensions: string[] }[]
      multiple?: boolean
      defaultPath?: string
      buttonLabel?: string
    }): Promise<string[]>
    reveal(path: string): Promise<void>
    trash(paths: string[]): Promise<{ ok: string[]; failed: { path: string; error: string }[] }>
    openExternal(url: string): Promise<void>
    minimize(): Promise<void>
    toggleMaximize(): Promise<void>
    close(): Promise<void>
    isMaximized(): Promise<boolean>
    /** Electron 32+ 移除了 File.path，拖放必须用 webUtils 取绝对路径（在 preload 里就地解析，不绕主进程） */
    pathForFile(file: unknown): string
    restart(): Promise<void>
  }
  settings: {
    getAll(): Promise<AppSettings>
    set<K extends keyof AppSettings>(key: K, value: AppSettings[K]): Promise<AppSettings>
    setMany(patch: Partial<AppSettings>): Promise<AppSettings>
    reset(): Promise<AppSettings>
  }
  categories: {
    list(): Promise<CategoryConfig>
    /**
     * 保存整张分类表（R4 ④ 起界面真的能改它了：口语同义词）。
     * 通道早就有，但一直没人接 —— 设置页改完看着存下了、重启又变回去，
     * 就是这种"IPC 有、preload 没包、界面没调"的三段断。
     */
    save(cfg: CategoryConfig): Promise<CategoryConfig>
  }
  /**
   * M7 ⑥ · 记住的加密包密码（`password_vault`，密文）。
   * 这三条**永远不会把明文递回渲染层** —— 列表只给"能不能解开"，解密只发生在主进程内部。
   */
  secrets: {
    /** 这台机器现在能不能加密（false = 勾了"记住"也不会存） */
    status(): Promise<{ available: boolean }>
    list(): Promise<RememberedEntry[]>
    forget(id: number): Promise<{ ok: boolean }>
  }
  assets: {
    list(filter: AssetFilter): Promise<ListResult>
    get(id: string): Promise<AssetRow | null>
    detail(id: string): Promise<DetailInfo | null>
    patch(id: string, patch: Partial<Omit<AssetRow, 'id' | 'created_at' | 'updated_at'>>): Promise<AssetRow | null>
    rename(id: string, name: string): Promise<AssetRow | null>
    trash(ids: string[]): Promise<{ trashed: string[]; failed: { id: string; error: string }[] }>
    stats(): Promise<Stats>
    groups(): Promise<GroupSummary[]>
    /** 用户修正分类 → 喂给 learning 表（第 2 份 §5.4）。**只改记录、不碰磁盘** */
    reclassify(id: string, category: string, subcategory: string | null): Promise<LearnedCorrection>
    resolvePending(id: string, accept: boolean): Promise<AssetRow | null>
    /**
     * R4 ③ · 改分类时"要不要把文件也搬过去"：**只读预览**，一个字节都不写。
     * `willMove=false` 时 `reasonKey` 一定有值（索引模式 / 不在库根下 / 本来就在对的地方）。
     */
    rearchivePlan(id: string, category: string, subcategory: string | null): Promise<RearchiveOutcome>
    /**
     * 真的搬。必须带着预览给过的 `expectToDir`：主进程会重算一遍计划，
     * 算出来的目标和用户看到的不一样就拒绝执行（`err.rearchiveStale`）——
     * 拿一份没给用户看过的计划去动盘，等于偷偷搬。
     */
    rearchive(input: {
      assetId: string
      category: string
      subcategory: string | null
      expectToDir: string | null
    }): Promise<RearchiveResult | RearchiveFailure>
    /** 合集详情：合集 + 子项 + 每个子项的版本 */
    bundle(id: string): Promise<BundleView | null>
    /** 改挂父级：「从合集中拆出」传 null */
    reparent(ids: string[], parentId: string | null): Promise<{ moved: number }>
    dissolveBundle(id: string): Promise<{ released: number }>
    /**
     * §B5 同前缀建议合并。**只建议，不自动并** ——
     * `TwinkleSpica Mint/Plum/Chocolate` 是配色还是不同产品，程序分不出来，得用户点头。
     */
    mergeSuggestions(): Promise<MergeSuggestionView[]>
    mergeApply(input: { assetIds: string[]; name: string; category?: string | null; subcategory?: string | null }): Promise<{
      containerId: string
      moved: number
      batchId: string
    }>
    mergeDismiss(head: string): Promise<{ dismissed: number }>
    /** §B4 从库中学习模型名：扫出反复出现、词典还不认的候选 */
    learnScan(): Promise<LearnCandidate[]>
    learnAdd(tokens: string[]): Promise<{ added: number }>
    /** 补一批封面（维护页按钮用；启动时也会自动跑一小批） */
    backfillThumbs(budget?: number): Promise<{ checked: number; made: number }>
  }
  collections: {
    list(): Promise<CollectionRow[]>
    create(input: { name: string; icon?: string; rule?: unknown; isAuto?: boolean }): Promise<CollectionRow>
    update(id: string, patch: Partial<CollectionRow>): Promise<CollectionRow | null>
    remove(id: string): Promise<void>
    addAssets(collectionId: string, assetIds: string[]): Promise<number>
    removeAsset(collectionId: string, assetId: string): Promise<void>
    /** M6 ④：只读预览"按库里出现过的模型补建集合"会建哪几个、各覆盖多少条 */
    planBackfill(): Promise<ModelBackfillPlan>
    /** 确认后才写；只认刚才预览里出现过的名字，且整批可 Ctrl+Z */
    applyBackfill(names: string[]): Promise<ModelBackfillResult>
  }
  journal: {
    list(limit?: number): Promise<JournalRow[]>
    /**
     * 撤销最新那一批（Ctrl+Z 的语义）。
     * 第 9 轮 ⑥ 起可以带 `onlyBatchId`：带了就**只可能**撤那一批 ——
     * 最新那一批不是它时一行都不动，回报 `toast.undoStale`。告知条上的撤销走这条。
     */
    undoLast(onlyBatchId?: string | null): Promise<UndoResult>
  }
  ingest: {
    fromPaths(paths: string[]): Promise<{ accepted: string[]; rejected: RejectedPath[] }>
    pickAndStart(title?: string): Promise<void>
    cancel(jobId?: string): Promise<void>
    dismiss(jobId?: string): Promise<void>
    queue(): Promise<IngestItemState[]>
    /**
     * 收件箱持久化：把上次没确认完的卡片重新入队。
     * 启动时主进程会自动调一次；这里也给界面一个手动入口（设置 → 维护）。
     */
    restoreQueue(): Promise<{ recovered: number; missing: string[]; skipped: number }>
    /** 只读体检：持久化队列里有几项、其中几项文件已经不存在 */
    queueFile(): Promise<{ total: number; missing: number; paths: string[] }>
    /**
     * M7 ⑥ · 给一个要密码的包提交密码。
     * `remember` 为真时顺手存进密码库；返回的 `vault` 是三态出口，
     * `unavailable` 必须让界面说出来（**这台机器存不了，密码没有被明文保存**）。
     */
    submitPassword(
      jobId: string,
      password: string,
      remember?: boolean
    ): Promise<{ ok: boolean; vault: 'stored' | 'unavailable' | 'failed' | 'skipped' }>
    commitManual(input: {
      jobId: string
      name?: string
      category: string
      subcategory: string | null
      password?: string
    }): Promise<{ assetId: string }>
    /**
     * 一键全部入库。jobIds 由界面按当前筛选算好传进来（主进程不知道用户在看哪个筛选）。
     * move=false → 只登记分类、一个文件都不搬。
     */
    commitAll(input: { jobIds: string[]; move: boolean }): Promise<CommitAllSummary>
  }
  unity: {
    instances(): Promise<UnityInstance[]>
    status(): Promise<
      UnityStatus & {
        targetProjectId: string | null
        targetProjectPath: string | null
        queue: Array<{ id: string; type: string; label: string; enqueuedAt: number }>
      }
    >
    listProjects(): Promise<import('./types').ProjectInfo[]>
    refreshProjects(): Promise<import('./types').ProjectInfo[]>
    /** 顶栏工程切换器：选中的工程就是导入目标 */
    setTarget(projectId: string | null): Promise<string | null>
    /** 某个素材在哪些工程装过（只读 import_log；GUID 反查是 M5-B 的活） */
    importHistory(query?: ImportHistoryQuery): Promise<ImportHistoryPage>
    importLogs(assetId: string): Promise<
      Array<{ id: string; project_id: string; status: string; finished_at: number | null; message: string | null }>
    >
    /** 桥接模板自检（缺文件时界面要能指出来） */
    bridgeTemplateCheck(): Promise<{ ok: boolean; root: string; missing: string[] }>
    installBridge(projectId?: string): Promise<{
      ok: boolean
      projectPath: string
      target: string
      copied: number
      alreadyInstalled: boolean
      error: string | null
      missingTemplateFiles: string[]
    }>
    /**
     * R4 ⑦ · 回答"要不要给这个工程装桥接"。
     * `install-once` 不写答案（下次第一次发现还会问）；`always` = **这个工程**以后自动装；
     * `never` = 这个工程别再问了。判据与措辞见 `shared/bridgeAsk.ts`。
     */
    answerBridgeAsk(
      projectId: string,
      choice: 'install-once' | 'always' | 'never' | 'later'
    ): Promise<{ ok: boolean; saved: 'always' | 'never' | null; error?: string }>
    /**
     * M7 Q10 · 「剩下这些都不再问」。
     * 给主进程队列里除 `exceptProjectId`（屏幕上正在答的那条）之外每个工程各写一行 never，
     * 返回写了几条。**没有"全局静音"这种开关**，判据继续只认 per-project 那一行。
     */
    bridgeAskNeverRest(exceptProjectId: string): Promise<{ ok: boolean; answered: number }>
    /**
     * R4 ⑦ · **看一眼**主进程攒下来的桥接决定（取走**不**清空）。界面启动时调一次。
     *
     * 为什么不能只靠 `project:first-seen` 广播：主进程第一轮工程发现是同步跑完的，
     * 那时窗口还没建、渲染层的 `on(...)` 还没绑上，广播会丢
     * （见 `src/main/bridge/askQueue.ts`）。漏了这条就等于 ⑦ 在首次安装时不生效。
     */
    pendingBridgeAsk(): Promise<BridgeFirstSeenEvent[]>
    /**
     * R4 ⑦ · 自动装**装成了**，把这条决定从主进程队列里摘掉。
     * 不清的话每次刷新界面都会拿同一条去重装一遍（`installBridge` 会回"本来就装着"，
     * 但那是白跑一趟 + 一句没用的提示）。
     */
    bridgeAskDone(projectId: string): Promise<{ ok: boolean; error?: string }>
    /** 卸载走回收站，不永久删除 */
    uninstallBridge(projectId?: string): Promise<{
      ok: boolean
      projectPath: string
      target: string
      notInstalled: boolean
      error: string | null
    }>
    uninstallBridgeAll(): Promise<{
      ok: boolean
      uninstalled: string[]
      failed: Array<{ projectPath: string; error: string }>
      skipped: number
    }>
    /**
     * 这张卡底下有什么能导的东西。返回**判别联合**（M5-B ⑤）：
     *  - `loose` —— 磁盘上就有，`path` 可直接给 Unity
     *  - `archive` —— 成员还在压缩包里，`path` 是 null，要先 `importPlan` 抽
     *  - `empty` —— 没有能导的包，`reasonKey` + `notes` 说清为什么
     */
    packagesOfAsset(assetId: string): Promise<PackagesOfAssetResult>
    /** 只读预扫描：算冲突、列出将被覆盖的**具体文件路径**（§5.1④） */
    preflight(input: { packagePath: string; projectId?: string }): Promise<PreflightView>
    /** 真正导入单包。choice 决定覆盖怎么处理（§5.1④ 三选一） */
    importPackage(input: {
      packagePath: string
      projectId?: string
      assetId?: string | null
      choice?: 'cancel' | 'continue' | 'continue-with-backup'
    }): Promise<ImportPackageResult>
    /**
     * 容器成员：**抽取 + 逐包预扫描**，只读，不动工程。
     * 成功返回的 `batchId` 是主进程内存里的待确认批次，`items` 是每包的冲突表 ——
     * 界面据此弹**一张**汇总卡片（不是弹 N 次窗），用户点确认后交给 `importCommit`。
     *
     * 两种入参形状（R4 ②）：
     *  - `{assetId, members[]}`：一张卡 + 它里面的几个成员（M5-B 那条路，行为不变）；
     *  - `{items:[{assetId, members[]}]}`：**多选卡批量**，每张卡各点名自己要导的包。
     *    主进程逐张重新列清单再按 relPath 认领，一张卡清单过期不会连累别的卡。
     */
    importPlan(input: {
      assetId?: string
      members?: string[]
      items?: Array<{ assetId: string; members: string[] }>
      projectId?: string
      password?: string
    }): Promise<PlanResult>
    /** 确认后才真正串行导入：每条一份 import_log，同一个 batch_id */
    importCommit(input: { batchId: string; choice?: 'cancel' | 'continue' | 'continue-with-backup' }): Promise<CommitResult>
    /** 反悔/关窗：只删 A 自己抽出来的副本，库里的原件不动 */
    importAbandon(batchId: string): Promise<{ released: number; failed: number; notStaged?: boolean }>
    /**
     * 取消一批：当前那一条**让 Unity 做完**（中途打断会留半成品），后面的不再发。
     * 返回 true 只表示"意图已登记"，不表示已经停了。
     */
    cancelBatch(batchId: string): Promise<CancelBatchResult>
    /** 撤销一次导入（只删本次新建的 + 从 backups/rollback 还原被覆盖的） */
    rollbackImport(logId: string): Promise<RollbackResult>
    /** 整批撤销：按 batch_id **倒序**逐条，一条失败就停下如实报（§3.6） */
    rollbackBatch(batchId: string): Promise<RollbackBatchResult>
    /** 抽取目录现在占多少（设置 → 维护）。null = 现在没有可用的抽取根 */
    extractUsage(): Promise<ExtractUsage>
    extractClean(): Promise<ExtractCleanOutcome>
  }
  health: {
    /** 「重新整理合集」的只读预览（改动单 §5） */
    scanRebundle(): Promise<RebundleGroup[]>
    /**
     * 「重新分析」的只读扫描。**界面必须在用户按下之前**就把影响条数显示出来，
     * 这是交付要求里点名的一条，不许做成"点了才知道改了多少"。
     */
    planReanalyze(): Promise<ReanalyzePlanView>
    applyReanalyze(ids?: string[]): Promise<{ updated: number; batchId: string }>
    dropJunkRows(ids: string[]): Promise<{ deleted: number; batchId: string }>
    /** dirs 给空数组 = 处理预览里的全部 */
    applyRebundle(dirs: string[]): Promise<{ bundles: number; moved: number; versions: number }>
    /**
     * #40 存量清理的只读预览：跨目录误并的归并组（同目录的兄弟才该归并）。
     * `kept` = 同一产品的 zip 与已解压副本，按裁定 #16 保持归并，故意没动。
     */
    planRegroup(): Promise<RegroupPlanView>
    /** keys 给空数组 = 拆开预览里的全部；给 groupKey 就只拆那几个组。纯库操作，可 Ctrl+Z */
    applyRegroup(keys: string[]): Promise<{ groups: number; moved: number; createdGroups: number }>
    /** 第 9 轮 ② · B4 存量重并的只读预览（一行都不改） */
    planRemerge(): Promise<RemergePlanView>
    /** keys 给空数组 = 处理预览里的全部；给了 groupKey 只并那几簇。纯库操作，可 Ctrl+Z */
    applyRemerge(keys: string[]): Promise<{ moved: number; droppedGroups: number; keyOnly: number; clusters: number; batchId: string }>
    /** 只读扫描：僵尸 / 重复 / 相似 / 游离 / 大文件 / 孤儿变体；under = 只扫这一棵子树 */
    scan(opts?: { under?: string | null }): Promise<HealthReport>
    /** 从 .avca.json 侧车补回丢掉的库记录 + 重建内存检索索引 */
    rebuildIndex(): Promise<{ rebuilt: number; skipped: number; docs: number; errors: string[] }>
    markMissing(ids: string[]): Promise<{ marked: number }>
    unmarkMissing(ids: string[]): Promise<{ restored: number }>
    dissolveOrphans(): Promise<{ dissolved: number; assetsFreed: number }>
    /** 把勾选的游离项送回收站（只允许库根下面的） */
    trashStrays(paths: string[]): Promise<{ trashed: string[]; failed: { path: string; error: string }[] }>
    pruneThumbs(): Promise<{ removed: number; kept: number }>
    duplicateReport(): Promise<{ implemented: boolean; duplicates: HealthReport['duplicates']; similar: HealthReport['similar'] }>
  }
  taxonomy: {
    /** 用户改分类改出来的规则（第 2 份 §5.4 的学习表） */
    learningList(): Promise<Array<{ id: number; token: string; category: string; subcategory: string | null; weight: number; hits: number }>>
    learningDelete(id: number): Promise<Array<{ id: number; token: string; category: string; subcategory: string | null; weight: number; hits: number }>>
    /** 用户自己加的词典词条（%APPDATA%\A\lexicon.user.json） */
    userTerms(): Promise<Array<{ term: string; cat: string | null; sub: string | null; dim: string; w: number }>>
    termAdd(input: { term: string; cat: string; sub?: string | null }): Promise<Array<{ term: string; cat: string | null; sub: string | null; dim: string; w: number }>>
    termRemove(term: string): Promise<Array<{ term: string; cat: string | null; sub: string | null; dim: string; w: number }>>
    builtinCount(): Promise<number>
  }
  integration: {
    shellMenuState(): Promise<{ installed: boolean; target: string | null; current: string }>
    /** label 是界面文字，由渲染进程翻译好传进来 */
    shellMenuInstall(label: string): Promise<ShellMenuResult>
    shellMenuUninstall(): Promise<ShellMenuResult>
    watcherState(): Promise<{ watching: string[]; shellTarget: string }>
  }
  on(event: string, cb: (...args: unknown[]) => void): () => void
}

/** 「重新整理合集」的一组预览 */
export interface RebundleGroup {
  dir: string
  bundleName: string
  assetIds: string[]
  items: Array<{ name: string; groupKey: string; assetIds: string[]; primaryId: string }>
  from: number
  to: number
  why: string
}

/**
 * #40 存量清理的预览（只读扫描结果）。
 * 「归并的前提是同一父容器（同目录）」—— 这一份列出违反它的组和处置。
 */
export interface RegroupPlanView {
  scanned: number
  /** 会被按目录拆开的组 */
  groups: Array<{
    groupId: string
    groupKey: string
    groupName: string
    category: string
    before: string[]
    dirs: string[]
    clusters: Array<{ dirKey: string | null; assetIds: string[]; names: string[] }>
  }>
  /** 同一产品的 zip 与已解压副本 —— 按裁定 #16 保持归并，故意没动 */
  kept: Array<{ groupKey: string; groupName: string; dirs: string[]; reason: string }>
  affected: number
}

/**
 * 第 9 轮 ② · B4 存量重并的只读预览（`library/remerge.ts`）。
 *
 * 每一簇 = "按现在的键规则，这几张卡本来就该是一张"。`rows` 只给前若干条够看清楚，
 * `fromKey → toKey` 是这一轮唯一能证明"为什么并得对"的证据 —— 光给个数字没人敢点。
 */
export interface RemergePlanView {
  scanned: number
  /** 被 §B2 安全保护 3 挡住的处数（同目录 ≥3 个不同前缀塌成同一个键）—— 不许瞒着不说 */
  skippedAmbiguous: number
  clusters: Array<{
    groupKey: string
    name: string
    /** true = 这一簇没有现成的组可复用，要新建一个 */
    newGroup: boolean
    moved: number
    droppedGroups: number
    rows: Array<{ name: string; fromKey: string | null; toKey: string }>
  }>
}

/** 「重新分析」只读扫描给界面看的那份摘要（明细只给前 50 条，够看清楚要改什么就行） */export interface ReanalyzePlanView {
  scanned: number
  affected: number
  renamed: number
  uuidNamed: number
  /** 附属资源降级的行数（旧规则把介绍图登记成了独立素材） */
  demoted: number
  demotePreview: Array<{ id: string; name: string; kind: string; host: string }>
  /** 现在的新规则认定本不该存在的记录（磁盘文件不动，只出库） */
  junk: Array<{ id: string; name: string; path: string | null }>
  preview: Array<{
    id: string
    name: string
    fields: string[]
    fromName: string
    toName: string
    fromVersion: string | null
    toVersion: string | null
  }>
}

/** 收件箱用的合集预览（子项 + 每个子项的版本数） */
export interface BundlePreview {
  name: string
  items: Array<{
    name: string
    category: string
    subcategory: string | null
    confidence: number
    versions: number
    /** 最新版本号，版本数 >1 时显示 */
    topVersion: string | null
  }>
  totalBytes: number
}

/** 合集详情视图（三级模型的前端形状） */
/** §B5 一条合并建议 */
export interface MergeSuggestionView {
  /** 共同首词，界面上显示成「TwinkleSpica」 */
  head: string
  assetIds: string[]
  names: string[]
  /** 它们共同所在目录的名字（只是 basename，不暴露整条路径） */
  dirLabel: string | null
}

/** §B4 一个疑似模型名 */
export interface LearnCandidate {
  token: string
  /** 出现次数 */
  hits: number
  /** 在哪个系列下出现的（`ATTITUDE The Royal Bunny`），没有就 null */
  series: string | null
  /** 同系列下一共扫出几个候选名 —— 用来说明"这一组是一批模型" */
  seriesSize: number
}

export interface BundleView {
  bundle: import('./types').AssetRow
  /** 子项 + 它的版本行 + 它自己的附属资源 */
  items: Array<{
    item: import('./types').AssetRow
    versions: import('./types').AssetRow[]
    attachments: import('./types').AssetRow[]
  }>
  /** 挂在容器自己下面的附属资源（`名流/ATTITUDE The Royal Bunny.jpg` 就是整个系列的封面） */
  attachments: import('./types').AssetRow[]
}

/** 一键入库的结果：界面要按这个出 Toast，不许把失败吞了说"成功" */
export interface CommitAllSummary {
  total: number
  committed: number
  /** 登记成合集（三级）的那几项 */
  bundles: number
  /** 这批是否动了磁盘 */
  moved: boolean
  failed: Array<{ jobId: string; name: string; messageKey: string; message: string }>
}

/** 右键菜单登记结果：只回 key，文案在渲染进程出 */
export interface ShellMenuResult {
  ok: boolean
  messageKey: string
  detail?: string
}

export type { LocaleKey, AssetStatus }
