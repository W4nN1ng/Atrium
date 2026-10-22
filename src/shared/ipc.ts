/** IPC 通道名。渲染进程只能调用这里列出的通道，preload 用白名单过滤。 */

export const IpcInvoke = {
  Covers: {
    PackageSetup: 'covers:package-setup',
    /**
     * 这个素材在磁盘上的根目录 —— 给「选择本地图片」的对话框当 `defaultPath`。
     * 没有它对话框会沿用上一次用过的目录，用户每次都得自己翻回去。
     */
    AssetRoot: 'covers:asset-root',
    PackageStatus: 'covers:package-status', DiscoverPackage: 'covers:discover-package', PackageProgress: 'covers:package-progress',
    Status: 'covers:status', Targets: 'covers:targets', Discover: 'covers:discover', Preview: 'covers:preview',
    Save: 'covers:save', Discard: 'covers:discard', Upload: 'covers:upload', Restore: 'covers:restore',
    StartBatch: 'covers:start-batch', BatchStatus: 'covers:batch-status', CancelBatch: 'covers:cancel-batch',
    StartTask: 'covers:start-task', TaskStatus: 'covers:task-status', TaskChoices: 'covers:task-choices',
    ApplyTaskChoice: 'covers:apply-task-choice', RetryTask: 'covers:retry-task', CancelTask: 'covers:cancel-task', UndoTask: 'covers:undo-task',
    UpgradeBridge: 'covers:upgrade-bridge'
  },
  System: {
    /** 截图时把窗口顶到最前；只在带着 --remote-debugging-port 起来时才注册 */
    NudgeFront: 'system:nudge-front',
    Info: 'system:info',
    Paths: 'system:paths',
    BackupDatabase: 'system:backup-database',
    /** M7 ③ · 首启向导第 ① 步：只读探测一个目录像不像已经有素材（判定在 shared/wizardState.ts） */
    ProbeDirectory: 'system:probe-directory',
    PickDirectory: 'system:pick-directory',
    PickFiles: 'system:pick-files',
    Reveal: 'system:reveal',
    Trash: 'system:trash',
    OpenExternal: 'system:open-external',
    WinMinimize: 'system:win-minimize',
    WinToggleMaximize: 'system:win-toggle-maximize',
    WinClose: 'system:win-close',
    WinIsMaximized: 'system:win-is-maximized',
    PathForFile: 'system:path-for-file',
    Restart: 'system:restart'
  },
  Settings: {
    GetAll: 'settings:get-all',
    Set: 'settings:set',
    SetMany: 'settings:set-many',
    Reset: 'settings:reset'
  },
  Categories: {
    List: 'categories:list',
    Save: 'categories:save'
  },
  /**
   * M7 ⑥ · 记住的加密包密码（`password_vault`）。
   * 三条都是**只出密文状态、不出明文**：list 不回密码，forget 只删一行。
   */
  Secrets: {
    Status: 'secrets:status',
    List: 'secrets:list',
    Forget: 'secrets:forget'
  },
  Assets: {
    List: 'assets:list',
    Get: 'assets:get',
    Detail: 'assets:detail',
    Patch: 'assets:patch',
    Rename: 'assets:rename',
    Trash: 'assets:trash',
    Stats: 'assets:stats',
    Groups: 'assets:groups',
    BackfillThumbs: 'assets:backfill-thumbs',
    Reclassify: 'assets:reclassify',
    /** R4 ③：改分类时"要不要把文件也搬过去"的只读预览 + 真搬 */
    RearchivePlan: 'assets:rearchive-plan',
    Rearchive: 'assets:rearchive',
    ResolvePending: 'assets:resolve-pending',
    Bundle: 'assets:bundle',
    Reparent: 'assets:reparent',
    DissolveBundle: 'assets:dissolve-bundle',
    /** §B5 同前缀建议合并：扫建议 / 执行合并 / 不再提示 */
    MergeSuggestions: 'assets:merge-suggestions',
    MergeApply: 'assets:merge-apply',
    MergeDismiss: 'assets:merge-dismiss',
    /** §B4 从库中学习模型名：扫候选 / 加进用户词典 */
    LearnScan: 'assets:learn-scan',
    LearnAdd: 'assets:learn-add'
  },
  Collections: {
    List: 'collections:list',
    Create: 'collections:create',
    Update: 'collections:update',
    Remove: 'collections:remove',
    AddAssets: 'collections:add-assets',
    RemoveAsset: 'collections:remove-asset',
    /** M6 ④：按库里出现过的模型补建集合 —— 先只读预览，再确认写库 */
    PlanBackfill: 'collections:plan-backfill',
    ApplyBackfill: 'collections:apply-backfill'
  },
  Journal: {
    List: 'journal:list',
    UndoLast: 'journal:undo-last'
  },
  Ingest: {
    FromPaths: 'ingest:from-paths',
    PickAndStart: 'ingest:pick-and-start',
    Cancel: 'ingest:cancel',
    Dismiss: 'ingest:dismiss',
    SubmitPassword: 'ingest:submit-password',
    /** M2 的手工分类桩：置信度暂存 0，等第 2 份的 classify() 接上 */
    CommitManual: 'ingest:commit-manual',
    /** 一键全部入库（改动单 §1） */
    CommitAll: 'ingest:commit-all',
    Queue: 'ingest:queue',
    /** 启动恢复：把上次没确认完的卡片重新入队（收件箱持久化） */
    RestoreQueue: 'ingest:restore-queue',
    /** 只读体检：持久化队列里还剩多少项、多少项文件已不存在 */
    QueueFile: 'ingest:queue-file'
  },
  Unity: {
    Instances: 'unity:instances',
    Status: 'unity:status',
    ListProjects: 'unity:list-projects',
    RefreshProjects: 'unity:refresh-projects',
    SetTarget: 'unity:set-target',
    Connection: 'unity:connection',
    ResolveTarget: 'unity:resolve-target',
    PrepareTarget: 'unity:prepare-target',
    CancelTargetPreparation: 'unity:cancel-target-preparation',
    RetryConnection: 'unity:retry-connection',
    /** 某个素材在哪些工程装过（只读 import_log） */
    ImportLogs: 'unity:import-logs',
    ImportHistory: 'unity:import-history',
    /** 桥接模板自检：缺文件时界面要能指出来，而不是点半天"安装"没反应 */
    BridgeTemplateCheck: 'unity:bridge-template-check',
    InstallBridge: 'unity:install-bridge',
    /**
     * R4 ⑦ · 记下用户对"要不要给这个工程装桥接"的回答。
     * 存的是 `setting` 键 `bridgeAsk:<projectId>`（裁定 Q7：不为这个动 schema）。
     */
    AnswerBridgeAsk: 'unity:answer-bridge-ask',
    /**
     * M7 Q10 · 「剩下这些都不再问」：给队列里除屏幕上这条之外每个工程各写一行 never。
     * 不引入全局静音标志 —— 判据继续只认 `bridgeAsk:<projectId>`。
     */
    BridgeAskNeverRest: 'unity:bridge-ask-never-rest',
    /**
     * R4 ⑦ · 看一眼主进程攒下的"还没送到界面"的桥接决定（**取走不清空**）。
     * 为什么要有这条：见 `src/main/bridge/askQueue.ts` 顶部 —— 广播是发后即忘的，
     * 而工程发现的第一轮在窗口装好之前就跑完了，事件会丢。
     * （"取走即清"是上一版的写法，一次整页刷新就把没答的工程吞掉了，见 BRIDGE.md §14.2。）
     */
    BridgeAskPending: 'unity:bridge-ask-pending',
    /** R4 ⑦ · 自动装装成了 → 把这条决定从主进程队列里摘掉（否则每次刷新界面都重装一遍） */
    BridgeAskDone: 'unity:bridge-ask-done',
    UninstallBridge: 'unity:uninstall-bridge',
    UninstallBridgeAll: 'unity:uninstall-bridge-all',
    /** 这张卡底下有什么能导的（`archive` = 成员还在压缩包里，要先抽） */
    PackagesOfAsset: 'unity:packages-of-asset',
    /** 单包预扫描：只读，把冲突的文件路径列给用户看（§5.1④） */
    Preflight: 'unity:preflight',
    ImportPackage: 'unity:import-package',
    /**
     * 容器成员：抽取 + 逐包预扫描，**只读不碰工程**。
     * 返回的 `batchId` 是内存里的待确认批次（设计 §3.4 的"一张汇总冲突卡片"）。
     */
    ImportPlan: 'unity:import-plan',
    /** 用户按下确认后才真正串行导入；每条一份 import_log，同一个 batch_id */
    ImportCommit: 'unity:import-commit',
    /** 反悔/关窗：只删 A 自己抽出来的副本 */
    ImportAbandon: 'unity:import-abandon',
    CancelBatch: 'unity:cancel-batch',
    /** 撤销一次导入（白名单删 + 从 backups/rollback 还原） */
    RollbackImport: 'unity:rollback-import',
    /** 整批撤销：按 batch_id 倒序逐条，一条失败就停下如实报 */
    RollbackBatch: 'unity:rollback-batch',
    /** 抽取目录现在占多少（设置 → 维护） */
    ExtractUsage: 'unity:extract-usage',
    ExtractClean: 'unity:extract-clean'
  },
  Health: {
    Scan: 'health:scan',
    RebuildIndex: 'health:rebuild-index',
    ScanRebundle: 'health:scan-rebundle',
    ApplyRebundle: 'health:apply-rebundle',
    /** #40：跨目录误并的归并组按目录拆开（只读预览 + 写库两步） */
    PlanRegroup: 'health:plan-regroup',
    ApplyRegroup: 'health:apply-regroup',
    /** 第 9 轮 ② · B4 存量重并：只读预览 / 落地（纯库操作，可 Ctrl+Z） */
    PlanRemerge: 'health:plan-remerge',
    ApplyRemerge: 'health:apply-remerge',
    /** 「重新分析」：先只读扫描给出影响条数，用户按下才写库（改动单 2 §交付 4） */
    PlanReanalyze: 'health:plan-reanalyze',
    ApplyReanalyze: 'health:apply-reanalyze',
    DropJunkRows: 'health:drop-junk-rows',
    DuplicateReport: 'health:duplicates',
    MarkMissing: 'health:mark-missing',
    UnmarkMissing: 'health:unmark-missing',
    DissolveOrphans: 'health:dissolve-orphans',
    TrashStrays: 'health:trash-strays',
    PruneThumbs: 'health:prune-thumbs'
  },
  Taxonomy: {
    LearningList: 'taxonomy:learning-list',
    LearningDelete: 'taxonomy:learning-delete',
    UserTerms: 'taxonomy:user-terms',
    TermAdd: 'taxonomy:term-add',
    TermRemove: 'taxonomy:term-remove',
    BuiltinCount: 'taxonomy:builtin-count'
  },
  Integration: {
    ShellMenuState: 'integration:shell-menu-state',
    ShellMenuInstall: 'integration:shell-menu-install',
    ShellMenuUninstall: 'integration:shell-menu-uninstall',
    WatcherState: 'integration:watcher-state'
  },
  /**
   * VPM 子系统（默认关闭）。P0 只有开关/数据根/状态；仓库、包、事务在后续阶段，
   * 通道名先集中在这里，preload 的白名单自动生成。
   */
  Vpm: {
    Status: 'vpm:status',
    Enable: 'vpm:enable',
    Disable: 'vpm:disable',
    PickDataRoot: 'vpm:pick-data-root',
    ReposList: 'vpm:repos-list',
    RepoAdd: 'vpm:repo-add',
    RepoRemove: 'vpm:repo-remove',
    RepoRefresh: 'vpm:repo-refresh',
    RepoRefreshAll: 'vpm:repo-refresh-all',
    NetworkConsent: 'vpm:network-consent',
    NetworkStatus: 'vpm:network-status',
    CatalogQuery: 'vpm:catalog-query',
    PackageDetail: 'vpm:package-detail',
    PackageVersions: 'vpm:package-versions',
    ProjectsList: 'vpm:projects-list',
    ProjectDetail: 'vpm:project-detail',
    ProjectAdd: 'vpm:project-add',
    ProjectRemove: 'vpm:project-remove',
    ProjectRescan: 'vpm:project-rescan',
    ProjectOpenFolder: 'vpm:project-open-folder',
    PlanResolve: 'vpm:plan-resolve',
    PlanExplain: 'vpm:plan-explain',
    PlanApply: 'vpm:plan-apply',
    OperationStatus: 'vpm:operation-status',
    OperationCancel: 'vpm:operation-cancel',
    OperationHistory: 'vpm:operation-history',
    OperationUndo: 'vpm:operation-undo',
    ProjectCatalog: 'vpm:project-catalog'
  }
} as const

export const IpcEvent = {
  IngestProgress: 'ingest:progress',
  /** 一键入库的总进度（正在入库 137/228） */
  IngestCommitProgress: 'ingest:commit-progress',
  /** 启动时收件箱被恢复了几项（上次没确认完的），界面要报一句 */
  IngestRestored: 'ingest:restored',
  DataChanged: 'data:changed',
  /** M5-A：工程的运行状态变了（开/关 Unity）。顶栏与工程页据此刷新 */
  ProjectRunningChanged: 'project:running-changed',
  UnityConnectionChanged: 'unity:connection-changed',
  /** M5-A：一条桥接命令的进度/终态（导入大包时界面靠它显示进度） */
  UnityImportProgress: 'unity:import-progress',
  /**
   * R4 ①：一批里**每跑完一条**报一次（`{batchId, index, ok, status, …}`）。
   *
   * 这条通道以前不存在，而 `commitMemberImport` 的 `onItem` 参数一直存在却没被传 ——
   * 于是"多选 5 个 → 串行执行 → **进度可见**"里那半句"进度可见"从来没有真的可见过。
   */
  UnityImportItem: 'unity:import-item',
  /**
   * M5-A：命令被 Unity 回了 `busy`、正在排队重投（§8-5 要求显示"已排队"）。
   * 没有这个事件的话，Play 模式下点导入，界面会一直显示"正在导入"几分钟不变。
   */
  UnityCommandBusy: 'unity:command-busy',
  /**
   * R4 ⑦ · **第一次发现某个工程**的边沿（`{projectId, projectPath, name, decision, detected}`）。
   *
   * 只在"这一轮真的插了一条新 project 行"时发一次，不是每 3 秒的状态广播 ——
   * 判据在 `shared/bridgeAsk.ts`，`decision` 已经是 `ask|auto|quiet`，
   * 界面只负责"弹三按钮窗"或"默默装完报一句"。
   */
  ProjectFirstSeen: 'project:first-seen',
  AutoSwitch: 'unity:auto-switch',
  SettingsChanged: 'settings:changed',
  Toast: 'ui:toast',
  VpmRepoProgress: 'vpm:repo-progress',
  VpmRepoDone: 'vpm:repo-done',
  VpmOperationStarted: 'vpm:operation-started',
  VpmOperationProgress: 'vpm:operation-progress',
  VpmOperationDone: 'vpm:operation-done'
} as const

/** 渲染进程允许订阅的事件通道 */
export const AllowedEvents: readonly string[] = Object.values(IpcEvent)

export type IpcInvokeChannel = typeof IpcInvoke
