import type { IngestItemState } from '../../shared/api'

/**
 * 收件箱持久化的**策略**（纯函数，不碰 electron / fs，方便直接测）。
 *
 * 为什么单独一个文件：摄取那条链路 import 了 `electron`，测试面刻意不碰它
 * （全仓没有一个 `vi.mock('electron')`）。把"哪些阶段要落盘"这件事抽出来，
 * 就能在不 mock electron 的前提下把它测死 —— 而这个策略正是最容易写错的地方。
 */

/**
 * "在等人处理"的阶段 —— 必须写进持久化队列，否则重启后这些卡片凭空消失。
 *
 *  - `awaiting_confirm`：指纹跑完、等用户确认分类（这是最主要的一类）
 *  - `duplicate`：撞了查重，等用户选"仍然导入 / 跳过"
 *  - `failed`：失败卡片。**故意也持久化** —— 用户可能正看着报错信息决定要不要修，
 *    重启后连"哪些失败了"都看不到就得重新拖一遍。恢复后 worker 会重跑，
 *    失败原因还会再现（确定性），所以恢复它不会骗人。
 */
export const STAGE_PENDING = new Set<IngestItemState['stage']>(['awaiting_confirm', 'duplicate', 'failed'])

/**
 * 已经有结论的阶段 —— 从持久化队列里划掉。
 *
 * `done`：已入库；`cancelled`：用户自己取消的。
 * 注意 `cancelled` 也算终态：用户点了取消，重启后不该再冒出来。
 */
export const STAGE_TERMINAL = new Set<IngestItemState['stage']>(['done', 'cancelled'])

export interface QueueAction {
  op: 'add' | 'remove' | 'none'
  /** 只在落盘时用得上：归一化后的源路径 */
  path: string
}

/**
 * 阶段变化时该对持久化队列做什么。
 *
 * ⚠ **只在阶段真的变了的时候调用**：`update()` 在指纹进度里会被每几毫秒调一次，
 * 无条件写盘会把磁盘打满。调用方负责比对新旧阶段（`job.persistedStage`）。
 */
export function queueActionFor(stage: IngestItemState['stage'], sourcePath: string): QueueAction {
  if (STAGE_PENDING.has(stage)) return { op: 'add', path: sourcePath }
  if (STAGE_TERMINAL.has(stage)) return { op: 'remove', path: sourcePath }
  /**
   * 其余（queued / hashing / detecting / extracting / fingerprinting / classifying / committing）
   * 是"正在跑"的中间态：它们**不**落盘。
   *
   * 理由是重启语义：进程被杀时正在跑的任务，恢复它等于从 `queued` 重跑一遍
   * ——而它本来就会重新跑完并落到 `awaiting_confirm`（那时才落盘）。
   * 如果在这里也 add，队列文件里会长期躺着一堆"跑到一半"的路径，
   * 启动时全被重新入队，看着像凭空多了一批任务。
   */
  return { op: 'none', path: sourcePath }
}
