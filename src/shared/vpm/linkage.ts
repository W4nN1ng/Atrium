/**
 * VPM 与核心工程/导入目标之间的窄端口。
 *
 * P2-E 只定义目标部分；P4-F 会补 activity/维护租约。VPM 不得直接 import
 * 核心 project/bridge/import 模块，主进程把实现注入 gate。
 */
export interface ProjectTargetRef {
  projectId: string
  path: string
  /** 可能仍是 closed/installing/connecting；表示目标已绑定但还没就绪。 */
  phase: string
}

export interface ProjectLinkagePort {
  currentTarget(): ProjectTargetRef | null
  /** Atrium 启动工程前调用；允许工程尚未运行。 */
  bindLaunchTarget(projectId: string): void
  /** 启动失败/取消/工程关闭后清除；只清自己绑的那一个。 */
  clearLaunchTarget(projectId: string): void
}

/** 维护动作的种类；只用于错误参数与日志，不参与鉴权。 */
export type MaintenanceKind =
  | 'install'
  | 'undo'
  | 'backup'
  | 'copy'
  | 'migrate'
  | 'unity-version'
  | 'create-project'
  | 'trash-project'

/** 一个工程当前的活动快照。`maintenance` 为 null 表示没有维护写。 */
export interface ProjectActivitySnapshot {
  unityRunning: boolean
  importing: boolean
  maintenance: MaintenanceKind | null
}

/**
 * 维护租约。`release()` 必须幂等；事务/备份/迁移都要在 `finally` 里释放。
 */
export interface MaintenanceLease {
  readonly projectPath: string
  readonly kind: MaintenanceKind
  release(): void
}

/**
 * 工程活动闸门（核心实现，VPM 只消费）。
 *
 * 身份是**归一化的工程路径**（与 VPM 的 projectKey 同源），不是数据库 project id ——
 * 因为导入/桥接上报的也是路径，用 id 反而要额外查一次表。
 */
export interface ProjectActivityPort {
  state(projectPath: string): ProjectActivitySnapshot
  /**
   * 申请独占维护租约。拿不到时抛 `vpmProjectBusy` / `vpmProjectImporting` /
   * `vpmUnityRunning`，参数里带原因；**不排队**（排到用户不知道更糟）。
   */
  acquireMaintenance(projectPath: string, kind: MaintenanceKind): MaintenanceLease
}

/**
 * 旧 Assets 清理的保护集合。
 *
 * 机械规则：工程内相对路径的 `.meta` guid 出现在 `import_log`（导入过/被覆盖过）→ 不能动。
 */
export interface LegacyGuardPort {
  /**
   * 一次清理开始前调用：让实现刷新缓存（`import_log` 可能刚变过）。
   * 可选——不实现就是"每次现查"。
   */
  prime?(projectPath: string): void
  isProtected(projectPath: string, relativePath: string): boolean
}
