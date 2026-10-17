import type { AssetFilter } from './types'
import type { CoverCandidate, CoverPreview } from './covers'

export interface CoverTaskRequest {
  scope: 'all' | 'ids' | 'filtered'
  assetIds?: string[]
  filter?: AssetFilter
}
export type CoverTaskState = 'queued' | 'running' | 'done' | 'review' | 'failed' | 'skipped' | 'cancelled' | 'restored'
export interface CoverTaskItem {
  assetId: string
  name: string
  state: CoverTaskState
  reason: string | null
  detail?: string | null
}
export interface CoverTask {
  id: string
  running: boolean
  cancelled: boolean
  items: CoverTaskItem[]
  canUndo: boolean
  updatedAt: number
}
export interface CoverTaskChoices {
  choices: Array<{ target: CoverCandidate; preview: CoverPreview | null; error: string | null }>
  total: number
  truncated: boolean
}
export interface CoverTaskUndoResult { restored: number; preserved: number }
