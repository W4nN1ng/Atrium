import type { IpcRegistrar } from './types'

/**
 * 占位通道。
 *
 * ## 现在这里**什么都没有**了，这是好事
 *
 * 这个文件以前的职责是"把还没做的 M5/M6 通道摆好，返回值如实写未实现——
 * 绝不返回假的成功状态"。M5-A 落地后：
 *
 * | 原占位通道 | 现在由谁注册 |
 * |---|---|
 * | `unity:instances` | `bridge/ipc.ts`（真读心跳，不再永远返回 `[]`） |
 * | `unity:status` | `bridge/ipc.ts`（真读状态 + 队列长度） |
 * | `unity:set-target` | `bridge/ipc.ts`（顶栏切换器的导入目标） |
 * | `unity:install-bridge` | `bridge/ipc.ts` → `bridge/installer.ts` |
 * | `unity:import` | `bridge/ipc.ts` → `import/coordinator.ts`（拆成 preflight + import-package 两步） |
 * | `unity:cancel-batch` | `bridge/ipc.ts`（M5-A 单包导入，如实说明批量队列在 M5-B） |
 * | `unity:rollback` | `bridge/ipc.ts` → `import/coordinator.ts` 的 `rollbackImport` |
 *
 * 保留这个函数（而不是删掉调用点）是因为后面还会有新的里程碑要占位，
 * 而且**"这里没有抛未实现的假成功"这件事本身值得留个说明** ——
 * 下一任看到空文件会以为漏了，看到这段注释才知道是刻意清空的。
 */
export function registerStubs(_registrar: IpcRegistrar): void {
  /** 目前没有任何需要占位的通道。 */
}
