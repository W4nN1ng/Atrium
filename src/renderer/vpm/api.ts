import type { VpmDataRootPick, VpmStatus } from '../../shared/vpm/types'

/**
 * 渲染进程访问 VPM 的唯一入口。
 *
 * 只做类型化转发，不放业务规则：
 * - 数据根校验、快照、开关状态都由主进程决定；
 * - 组件/hook 不要直接摸 `window.a.vpm`，后续换传输/加错误包装只改这里；
 * - 新增通道时在这里补方法，并同步 `shared/vpm/dto` 与 preload。
 */
export const vpmApi = {
  status(): Promise<VpmStatus> {
    return window.a.vpm.status()
  },
  enable(dataRoot: string): Promise<VpmStatus> {
    return window.a.vpm.enable(dataRoot)
  },
  disable(): Promise<VpmStatus> {
    return window.a.vpm.disable()
  },
  pickDataRoot(): Promise<VpmDataRootPick> {
    return window.a.vpm.pickDataRoot()
  }
}
