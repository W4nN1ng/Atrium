/**
 * 工程页"导入目标"徽标的纯逻辑（P5-E）。
 *
 * 目标状态只有一份：核心连接快照里的 `targetProjectId` / `targetPending`。
 * 这里不保存任何状态，只把三元组翻译成"要不要显示徽标、显示哪一个"。
 */

export interface TargetBadgeInput {
  coreId: string | null
  running: boolean
}

export type TargetBadgeKey = 'isTarget' | 'targetWaiting'

export interface TargetBadge {
  key: TargetBadgeKey
  tone: 'accent' | 'warn'
}

/**
 * - 不是当前目标 → `null`（不显示）
 * - 是目标但还在启动/连接中 → `targetWaiting`（warn，文案说明双击素材会等它）
 * - 是目标且已就绪 → `isTarget`（accent）
 */
export function targetBadge(
  item: TargetBadgeInput,
  targetProjectId: string | null,
  targetPending: boolean
): TargetBadge | null {
  if (!item.coreId || !targetProjectId || item.coreId !== targetProjectId) return null
  if (targetPending) return { key: 'targetWaiting', tone: 'warn' }
  return { key: 'isTarget', tone: 'accent' }
}
