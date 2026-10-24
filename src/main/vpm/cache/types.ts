export interface VpmCacheOptions {
  /** 已经由 gate 校验过的非 C 数据根；cache 只负责确认自己没跑出去。 */
  dataRoot: string
  /** 默认 `<dataRoot>/cache`；必须是 dataRoot 的严格子目录。 */
  cacheRoot?: string
}

export interface VpmCacheEntry {
  path: string
  size: number
  sha256: string
}

export interface VpmCacheCommitInput {
  /** HTTP 下载写出的临时文件，必须在本 cache 的 tmp/ 下。 */
  tempPath: string
  /** HTTP 流式写盘时算出的 SHA-256。 */
  sha256: string
  size: number
  /** 仓库元数据里的期望 hash；不匹配则拒绝并删除临时文件。 */
  expectedSha256?: string | null
}

/** `vpm_cache_entry` 的一行；缓存文件丢了可以重建，行不是真相。 */
export interface VpmCacheEntryRow {
  sha256: string
  size: number
  path: string
  sourceHost: string | null
  lastUsedAt: number
}

export interface VpmCacheEntryInput {
  sha256: string
  size: number
  path: string
  sourceHost?: string | null
}

/** 一次包准备请求；sha256 必填，无 hash 的包不能进入安装。 */
export interface VpmPackageCacheRequest {
  url: string
  sha256: string
  /** 仓库里的 zip_size；有就做大小校验。 */
  size?: number | null
  headers?: Record<string, string>
  signal?: AbortSignal
  onProgress?: (progress: VpmPackageDownloadProgress) => void
}

export interface VpmPackageDownloadProgress {
  downloaded: number
  total: number | null
  /** 1 起算；重试时递增。 */
  attempt: number
}

export interface VpmCachedPackage {
  sha256: string
  size: number
  path: string
  /** true = 命中并完整校验过缓存；false = 本次下载。 */
  reused: boolean
}

export interface VpmCacheUsage {
  bytes: number
  files: number
  quotaBytes: number
}

export interface VpmCacheEviction {
  sha256: string
  size: number
  path: string
}
