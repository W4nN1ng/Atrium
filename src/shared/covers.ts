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
export interface CoverCandidate extends PreviewTarget { memberPaths: string[] }
export interface CoverDiscovery { targets: CoverCandidate[]; warnings: string[]; truncated: boolean }
export interface CoverRecord {
  assetId: string
  coverImage: string
  previousImage: string | null
  source: 'unity' | 'image' | 'package'
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
  provider?: 'project' | 'package'
  dependencyProjectId?: string
}
export interface PackageCoverStatus { available: boolean; editorPath: string | null; version: string | null }
export interface PackageCoverProgress { stage: string; done?: number; total?: number }
export interface CoverStatus {
  record: CoverRecord | null
  bridge: 'offline' | 'upgrade' | 'busy' | 'ready'
  candidates: boolean
}
