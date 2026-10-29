/** Normalized intake contracts. Paths describe provenance/placement, never content equality. */
export interface ContentKey { size: number; crc32: number }
export type BlobId = string // Lowercase, full SHA-256; assigned only after reading the bytes.
export type LeafMultiset = ReadonlyMap<string, number>

export interface Entry {
  sourcePath: string
  relPath: string
  kind: 'file' | 'directory' | 'unreadable' | 'reparse'
  size: number
  mtimeMs: number
  key: ContentKey | null
}

export interface Budget {
  maxDepth: number
  maxEntriesPerContainer: number
  maxTotalBytes: number
  maxFileBytes: number
}

export interface ContainerRef {
  sourcePath: string
  memberPath: string | null
  format: 'zip' | 'rar' | '7z'
  key: ContentKey
}

export interface LeafRef {
  key: ContentKey
  relPath: string
  chain: ContainerRef[] // Innermost container first; empty for loose files.
  localPath: string | null // Null while the member exists only in a trusted listing.
  kind?: 'file' | 'unitypackage' | 'opaque'
  cacheKey?: string // Container cache holding localPath; never a source filename.
}

export interface ClosurePayload {
  leaves: LeafRef[]
  opaque: boolean // At least one unresolved container/path; never use as complete coverage evidence.
  warnings: string[]
  cacheKeys?: string[]
  cacheOwnerId?: string
  unreadable?: { path: string; reason: string }[] // No fabricated content key for unreadable bytes.
}
export interface LeafMatch { key: ContentKey; coveringPath: string; assetId: string | null }
export interface MatchEvidence {
  coveredCount: number
  totalCount: number
  matchedLeaves: ContentKey[] // Repeated keys retain occurrence counts.
  missingLeaves: ContentKey[]
  matches: LeafMatch[]
}
export type SkipReason = 'fully-covered' | 'duplicate-of-kept-archive' | 'identical-loose-copy'

export interface CopyOp {
  id: string // Stable within a persisted plan, including before SHA-256 is known.
  sourcePath: string
  targetRelPath: string
  originalRelPath: string
  key: ContentKey
  blobId: BlobId | null
  idempotencyKey: string | null // Finalized after SHA-256, before publication.
  cacheKey: string | null
}

export interface PlannedUnit {
  id: string
  displayName: string
  assetId: string | null // No new asset for a wholly covered unit.
  existingAssetIds: string[]
  sources: string[]
  copyOps: CopyOp[]
  sidecars: CopyOp[]
  coverCandidates: string[]
}

export const INTAKE_PLAN_VERSION = 1
export interface IntakePlan {
  schemaVersion: typeof INTAKE_PLAN_VERSION
  id: string
  scanRoot: string
  libraryRoot: string
  units: PlannedUnit[]
  skips: { entry: string; reason: SkipReason; evidence: MatchEvidence; coveredBy: string[] }[]
  extracts: { source: string; members: string[] }[]
  cacheKeys: string[]
  warnings: string[]
  stats: { sourceFiles: number; archives: number; leafCount: number; dedupSavedBytes: number }
}

export type IntakePlanStatus = 'planned' | 'awaiting_confirm' | 'running' | 'cancelled' | 'failed' | 'completed' | 'duplicate'
export interface IntakeProgress {
  completedOps: Record<string, { blobId: BlobId; targetPath: string; idempotencyKey: string }>
  failedOps: Record<string, string>
  cacheKeys: string[] // Persist references before allowing cache cleanup.
}

export interface ContentBlob {
  blobId: BlobId
  key: ContentKey
  storagePath: string
  refCount: number // Number of live asset_blob_ref rows, never provenance rows.
}
export interface AssetBlobRef {
  id: string
  assetId: string
  blobId: BlobId
  relPath: string
  pathKey: string // Validated relative path, / separators and lowercase, for placement conflicts only.
}
export type SourceOccurrenceKind = 'loose' | 'archived-copy' | 'skipped-archive' | 'extracted'
export interface SourceOccurrence {
  id: string // Stable occurrence identity makes retries an upsert.
  assetId: string
  blobId: BlobId | null
  assetFileId: string | null
  planId: string | null
  sourcePath: string
  kind: SourceOccurrenceKind
  detail: {
    blobId?: BlobId // Immutable audit snapshot even after a blob record is collected.
    key?: ContentKey
    relPath?: string
    originalRelPath?: string
    chain?: ContainerRef[]
    reason?: SkipReason
    evidence?: MatchEvidence
  } | null
}

export function serializeContentKey(key: ContentKey): string {
  if (!Number.isSafeInteger(key.size) || key.size < 0) throw new RangeError('Invalid content size')
  if (!Number.isInteger(key.crc32) || key.crc32 < 0 || key.crc32 > 0xffffffff) throw new RangeError('Invalid CRC32')
  return `${key.size}:${key.crc32.toString(16).padStart(8, '0')}`
}

export function deserializeContentKey(value: string): ContentKey {
  const match = /^(0|[1-9]\d*):([0-9a-f]{8})$/.exec(value)
  if (!match) throw new TypeError('Invalid serialized content key')
  const key = { size: Number(match[1]), crc32: Number.parseInt(match[2], 16) }
  if (serializeContentKey(key) !== value) throw new TypeError('Noncanonical content key')
  return key
}

function normalizedCounts(input: LeafMultiset): Map<string, number> {
  const result = new Map<string, number>()
  for (const [key, count] of [...input].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) {
    deserializeContentKey(key)
    if (!Number.isSafeInteger(count) || count < 0) throw new RangeError('Invalid occurrence count')
    if (count > 0) result.set(key, count)
  }
  return result
}

export function contentMultiset(keys: readonly ContentKey[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const key of keys) {
    const serialized = serializeContentKey(key)
    counts.set(serialized, (counts.get(serialized) ?? 0) + 1)
  }
  return normalizedCounts(counts)
}

export function multisetIntersect(left: LeafMultiset, right: LeafMultiset): Map<string, number> {
  const a = normalizedCounts(left), b = normalizedCounts(right), result = new Map<string, number>()
  for (const [key, count] of a) {
    const covered = Math.min(count, b.get(key) ?? 0)
    if (covered > 0) result.set(key, covered)
  }
  return result
}

export function multisetDiff(left: LeafMultiset, right: LeafMultiset): Map<string, number> {
  const a = normalizedCounts(left), b = normalizedCounts(right), result = new Map<string, number>()
  for (const [key, count] of a) {
    const missing = count - (b.get(key) ?? 0)
    if (missing > 0) result.set(key, missing)
  }
  return result
}

export function multisetEqual(left: LeafMultiset, right: LeafMultiset): boolean {
  const a = normalizedCounts(left), b = normalizedCounts(right)
  return a.size === b.size && [...a].every(([key, count]) => b.get(key) === count)
}
