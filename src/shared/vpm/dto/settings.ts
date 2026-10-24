import type { VpmErrorCode } from '../errors'

/**
 * 设置页需要的 VPM 偏好。
 *
 * 只出这些字段：数据根/开关/快照在 `VpmStatus` 里，不在这里重复。
 */
export interface VpmPreferencesDto {
  allowPrerelease: boolean
  hiddenPackageIds: string[]
  cacheQuotaGb: number
  vaultQuotaGb: number
  defaultUnityArgs: string
  checkUpdates: boolean
  networkEnabled: boolean
}

/** 局部更新：只接受白名单字段，未传的保持原值。 */
export interface VpmPreferencesPatch {
  allowPrerelease?: boolean
  hiddenPackageIds?: string[]
  cacheQuotaGb?: number
  vaultQuotaGb?: number
  defaultUnityArgs?: string
  checkUpdates?: boolean
}

export type VpmUpdateStatus = 'update' | 'current' | 'unknown'

export interface VpmUpdateAssetDto {
  name: string
  size: number
  /** 从发布正文里解析出来的 SHA-256；解析不到就是 null（此时不允许直接安装）。 */
  sha256: string | null
}

export interface VpmUpdateCheckDto {
  status: VpmUpdateStatus
  currentVersion: string
  latestVersion: string | null
  publishedAt: string | null
  /** 纯文本摘要，已截断；不是 HTML。 */
  notes: string | null
  releaseUrl: string | null
  installer: VpmUpdateAssetDto | null
  /** 失败原因；成功为 null。 */
  errorCode: VpmErrorCode | null
  checkedAt: string
  /** 命中 1 小时缓存时为 true（界面可显示"刚刚查过"）。 */
  cached: boolean
}

export type VpmUpdateDownloadStatus = 'ready' | 'hash-mismatch' | 'failed' | 'cancelled'

export interface VpmUpdateDownloadDto {
  status: VpmUpdateDownloadStatus
  path: string | null
  version: string | null
  /** hash 不匹配时带上实际值，方便用户自己核对。 */
  actualSha256: string | null
  errorCode: VpmErrorCode | null
}

/** 本地投放目录里的安装包（P9-E：不依赖 GitHub 也能更新）。 */
export interface VpmLocalBuildDto {
  name: string
  path: string
  size: number
  /** 文件修改时间（毫秒）。 */
  mtime: number
  /** 文件名里的版本；解析不出来是 null。 */
  version: string | null
}

export interface VpmLocalBuildsDto {
  /** 投放目录（`<数据根>/updates`）；界面上"打开这个文件夹"用。 */
  dir: string
  builds: VpmLocalBuildDto[]
}
