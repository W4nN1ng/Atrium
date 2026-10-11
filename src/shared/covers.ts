export type PreviewDirection = 'auto' | 'scene' | 'front' | 'back' | 'left' | 'right' | 'top' | 'bottom'
export type PreviewBackground = 'dark' | 'light'
export interface PreviewOptions { direction: PreviewDirection; background: PreviewBackground }
export interface PreviewTarget {
  id: string
  name: string
  path: string
  persistent: boolean
  isScene: boolean
  sourceGuid: string | null
}
export interface CoverRecord {
  assetId: string
  coverImage: string
  previousImage: string | null
  source: 'unity' | 'image'
  projectId: string | null
  target: PreviewTarget | null
  options: PreviewOptions | null
}
export interface CoverPreview {
  id: string
  url: string
  width: number
  height: number
  rendererCount: number
}
export interface CoverBatchItem {
  assetId: string
  name: string
  state: 'queued' | 'running' | 'done' | 'failed' | 'skipped' | 'cancelled'
  reason: string | null
  detail?: string | null
}
export interface CoverBatch {
  id: string
  running: boolean
  cancelled: boolean
  items: CoverBatchItem[]
}
export interface CoverRequest {
  assetId: string; projectId: string; target: PreviewTarget; options: PreviewOptions; requestId: string
}
export interface CoverStatus {
  record: CoverRecord | null
  bridge: 'offline' | 'upgrade' | 'busy' | 'ready'
}
