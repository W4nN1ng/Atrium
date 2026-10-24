import type { Readable } from 'node:stream'

/** 一次传输的原始请求；onRedirect 由客户端提供，transport 必须逐跳调用它。 */
export interface VpmHttpTransportRequest {
  url: string
  headers: Record<string, string>
  signal: AbortSignal
  /**
   * 收到 3xx 时调用。返回 = 继续跟随；抛错 = 停止并让请求失败。
   * Electron 适配器必须在 redirect 事件里同步调用 followRedirect 或 abort。
   */
  onRedirect?: (info: VpmRedirectInfo) => void
}

export interface VpmRedirectInfo {
  status: number
  /** 绝对 URL；transport 负责提供，客户端再校验协议/来源。 */
  url: string
  headers: Record<string, string[]>
}

export interface VpmHttpTransportResponse {
  status: number
  headers: Record<string, string | string[] | undefined>
  body: Readable
}

export interface VpmHttpTransport {
  request(input: VpmHttpTransportRequest): Promise<VpmHttpTransportResponse>
}

export interface VpmHttpLimits {
  maxJsonBytes: number
  maxDownloadBytes: number
  connectTimeoutMs: number
  idleTimeoutMs: number
  totalTimeoutMs: number
  maxRedirects: number
}

export interface VpmJsonRequest {
  etag?: string | null
  lastModified?: string | null
  /** P7 会用到；当前只做安全校验，不允许 Cookie/Host 等。 */
  headers?: Record<string, string>
  signal?: AbortSignal
}

export interface VpmJsonResponse {
  status: 200 | 304
  body?: unknown
  etag?: string
  lastModified?: string
  finalUrl: string
}

export interface VpmDownloadRequest {
  headers?: Record<string, string>
  signal?: AbortSignal
  /** 每收到一块数据调用；调用方负责节流（cache 的进度事件 ≥100ms）。 */
  onProgress?: (progress: VpmDownloadProgress) => void
}

export interface VpmDownloadProgress {
  downloaded: number
  /** Content-Length；服务器没给就是 null。 */
  total: number | null
}

export interface VpmDownloadResult {
  size: number
  sha256: string
  contentType?: string
  finalUrl: string
}

/** VPM 唯一网络端口；其他模块只能依赖这个接口。 */
export interface VpmHttpPort {
  getJson(url: string, opts?: VpmJsonRequest): Promise<VpmJsonResponse>
  downloadToFile(url: string, destPath: string, opts?: VpmDownloadRequest): Promise<VpmDownloadResult>
}

export interface VpmHttpClientOptions {
  transport: VpmHttpTransport
  /** 硬门：返回 false 时不建立任何连接。默认 false（fail closed）。 */
  isNetworkAllowed?: () => boolean
  userAgent: string
  limits?: Partial<VpmHttpLimits>
}

export const DEFAULT_VPM_HTTP_LIMITS: VpmHttpLimits = {
  maxJsonBytes: 16 * 1024 * 1024,
  maxDownloadBytes: 4 * 1024 * 1024 * 1024,
  connectTimeoutMs: 15_000,
  idleTimeoutMs: 60_000,
  totalTimeoutMs: 30 * 60_000,
  maxRedirects: 5
}
