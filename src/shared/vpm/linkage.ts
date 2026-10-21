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
