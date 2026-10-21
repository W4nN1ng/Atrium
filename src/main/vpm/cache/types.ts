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
