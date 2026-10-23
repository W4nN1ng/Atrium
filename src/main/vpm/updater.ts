import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { compareVpmVersions, parseVpmVersion } from '../../shared/vpm/domain/version'
import { VpmError, type VpmErrorCode } from '../../shared/vpm/errors'
import type { VpmHttpPort } from './http'

/** 只认这一个仓库的最新 release；不带 token，匿名调用。 */
const RELEASES_LATEST = 'https://api.github.com/repos/W4nN1ng/Atrium/releases/latest'
/** 结果缓存 1 小时：用户连点"检查更新"不重复打 GitHub。 */
const CACHE_TTL_MS = 60 * 60 * 1000
const MAX_NOTES = 1200
const INSTALLER_PREFIX = 'Atrium-Setup-'
const MAX_RELEASE_BYTES = 2 * 1024 * 1024

export interface UpdateAsset {
  name: string
  size: number
  sha256: string | null
}

export interface UpdateCheckResult {
  status: 'update' | 'current' | 'unknown'
  currentVersion: string
  latestVersion: string | null
  publishedAt: string | null
  notes: string | null
  releaseUrl: string | null
  installer: UpdateAsset | null
  errorCode: VpmErrorCode | null
  checkedAt: string
  cached: boolean
}

export interface UpdateDownloadResult {
  status: 'ready' | 'hash-mismatch' | 'failed' | 'cancelled'
  path: string | null
  version: string | null
  actualSha256: string | null
  errorCode: VpmErrorCode | null
}

export interface UpdaterOptions {
  http: VpmHttpPort
  /** 当前应用版本（`app.getVersion()`）。 */
  currentVersion: string
  /** 下载目录；默认 `<数据根>/updates`。 */
  downloadDir: string
  now?: () => number
  /** 下载/安装前确认没有任务在跑；返回原因字符串表示被挡住。 */
  isBusy?: () => string | null
}

function stripV(value: string): string {
  return value.trim().replace(/^[vV]/, '')
}

/** 只有严格更高才提示更新；版本解析不了就当"不知道"。 */
export function isNewerVersion(latest: string, current: string): boolean {
  const a = parseVpmVersion(stripV(latest))
  const b = parseVpmVersion(stripV(current))
  if (!a || !b) return false
  return compareVpmVersions(stripV(latest), stripV(current)) > 0
}

/**
 * 从发布正文里找某个资产的 SHA-256。
 *
 * 发布正文是人写的，分隔符五花八门（`：`/`—`/`–`/`:`/空格/反引号/换行），
 * 所以这里**不用**"资产名 + 分隔符 + hash"这种正则：分隔符里常常夹着
 * `SHA-256` 字样，而 `A` 本身就是十六进制字符，一条 `[^0-9a-f]` 就断在那儿了
 * （曾经真踩过：`Atrium-Setup-0.9.1.exe\nSHA-256：<hash>` 解析成 null）。
 *
 * 做法：定位资产名，在它前后各 160 个字符的窗口里找一个**独立的** 64 位十六进制串。
 * 找不到就返回 null —— **不允许**在没有 hash 的情况下直接装。
 */
export function hashFromNotes(notes: string, assetName: string): string | null {
  if (!notes || !assetName) return null
  const HASH = /(?:^|[^0-9A-Fa-f])([0-9A-Fa-f]{64})(?![0-9A-Fa-f])/
  const at = notes.toLowerCase().indexOf(assetName.toLowerCase())
  if (at < 0) return null
  const after = notes.slice(at + assetName.length, at + assetName.length + 160)
  const forward = HASH.exec(after)
  if (forward) return forward[1].toLowerCase()
  const before = notes.slice(Math.max(0, at - 160), at)
  const backward = HASH.exec(before)
  return backward ? backward[1].toLowerCase() : null
}

function text(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null
  return trimmed.length > max ? `${trimmed.slice(0, max)}…` : trimmed
}

function httpsUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && url.hostname ? url.href : null
  } catch {
    return null
  }
}

function errorCodeOf(error: unknown): VpmErrorCode {
  if (error instanceof VpmError) return error.code
  return 'vpmUpdateCheckFailed'
}

/**
 * 手动更新检查（P8-C）。
 *
 * 边界（写死在代码里，别在 UI 里放宽）：
 * - 只在用户点按钮时联网，不在启动时自动检查；
 * - 结果缓存 1 小时；
 * - 下载后必须核对 SHA-256；不匹配就删掉临时文件；
 * - 从不静默运行安装器，必须由用户再点一次。
 */
export class UpdaterService {
  private cache: UpdateCheckResult | null = null
  /** check 时记下的原始 tag 与资产下载地址；下载要用它们，不能自己拼。 */
  private release: { tag: string; installerUrl: string | null } | null = null
  private readonly now: () => number

  constructor(private readonly options: UpdaterOptions) {
    this.now = options.now ?? Date.now
  }

  /** 手动检查；`force` 忽略 1 小时缓存。 */
  async check(force = false): Promise<UpdateCheckResult> {
    const cached = this.cache
    if (!force && cached && this.now() - Date.parse(cached.checkedAt) < CACHE_TTL_MS) {
      return { ...cached, cached: true }
    }

    const checkedAt = new Date(this.now()).toISOString()
    const base: UpdateCheckResult = {
      status: 'unknown',
      currentVersion: this.options.currentVersion,
      latestVersion: null,
      publishedAt: null,
      notes: null,
      releaseUrl: null,
      installer: null,
      errorCode: null,
      checkedAt,
      cached: false
    }

    let body: unknown
    try {
      const response = await this.options.http.getJson(RELEASES_LATEST, {
        headers: { Accept: 'application/vnd.github+json' }
      })
      body = response.status === 200 ? response.body : null
    } catch (error) {
      // 网络问题不缓存：用户换个网络再点一次应该真的重试。
      return { ...base, errorCode: errorCodeOf(error) }
    }

    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return { ...base, errorCode: 'vpmUpdateCheckFailed' }
    }
    const release = body as Record<string, unknown>
    const tag = text(release.tag_name, 64)
    if (!tag) return { ...base, errorCode: 'vpmUpdateCheckFailed' }

    const latestVersion = stripV(tag)
    const notes = text(release.body, MAX_NOTES)
    const assets = Array.isArray(release.assets) ? release.assets : []
    let installer: UpdateAsset | null = null
    let installerUrl: string | null = null
    for (const raw of assets) {
      if (!raw || typeof raw !== 'object') continue
      const asset = raw as Record<string, unknown>
      const name = text(asset.name, 200)
      if (!name || !name.startsWith(INSTALLER_PREFIX) || !name.toLowerCase().endsWith('.exe')) continue
      installer = {
        name,
        size: typeof asset.size === 'number' && asset.size >= 0 ? asset.size : 0,
        sha256: notes ? hashFromNotes(notes, name) : null
      }
      installerUrl = httpsUrl(asset.browser_download_url)
      break
    }
    this.release = { tag, installerUrl }

    const result: UpdateCheckResult = {
      ...base,
      status: isNewerVersion(latestVersion, this.options.currentVersion) ? 'update' : 'current',
      latestVersion,
      publishedAt: text(release.published_at, 64),
      notes,
      releaseUrl: httpsUrl(release.html_url),
      installer
    }
    this.cache = result
    return result
  }

  /** 下载安装包到 `<数据根>/updates`，边下边算 hash，不匹配就删。 */
  async download(signal?: AbortSignal): Promise<UpdateDownloadResult> {
    const info = await this.check(false)
    const releaseUrl = this.release?.installerUrl ?? null
    if (info.status !== 'update' || !info.installer || !info.latestVersion || !releaseUrl) {
      return {
        status: 'failed',
        path: null,
        version: info.latestVersion,
        actualSha256: null,
        errorCode: info.errorCode ?? 'vpmUpdateCheckFailed'
      }
    }
    const busy = this.options.isBusy?.() ?? null
    if (busy) {
      return { status: 'failed', path: null, version: info.latestVersion, actualSha256: null, errorCode: null }
    }

    const downloadUrl = releaseUrl

    const dir = this.options.downloadDir
    const dest = path.join(dir, info.installer.name)
    try {
      fs.mkdirSync(dir, { recursive: true })
      fs.rmSync(dest, { force: true })
    } catch {
      return {
        status: 'failed',
        path: null,
        version: info.latestVersion,
        actualSha256: null,
        errorCode: 'vpmCacheWriteFailed'
      }
    }

    let actual: string
    try {
      const result = await this.options.http.downloadToFile(
        downloadUrl,
        dest,
        signal ? { signal } : {}
      )
      actual = result.sha256
    } catch (error) {
      fs.rmSync(dest, { force: true })
      const code = errorCodeOf(error)
      return {
        status: code === 'vpmHttpAborted' ? 'cancelled' : 'failed',
        path: null,
        version: info.latestVersion,
        actualSha256: null,
        errorCode: code
      }
    }

    const expected = info.installer.sha256
    if (!expected) {
      // 没有 hash 就不认这个文件：删掉，让用户走"打开 Release 页面"手动下载。
      fs.rmSync(dest, { force: true })
      return {
        status: 'failed',
        path: null,
        version: info.latestVersion,
        actualSha256: actual,
        errorCode: 'vpmUpdateHashMismatch'
      }
    }
    if (expected !== actual) {
      fs.rmSync(dest, { force: true })
      return {
        status: 'hash-mismatch',
        path: null,
        version: info.latestVersion,
        actualSha256: actual,
        errorCode: 'vpmUpdateHashMismatch'
      }
    }
    return { status: 'ready', path: dest, version: info.latestVersion, actualSha256: actual, errorCode: null }
  }

  /**
   * 运行安装器（用户显式点了"运行安装包"之后才会走到这里）。
   *
   * 只允许运行 `<下载目录>/Atrium-Setup-*.exe`：不接受渲染层传任意路径，
   * 免得这条通道变成"随便执行一个 exe"。
   */
  runInstaller(filePath: string): { ok: boolean; errorCode: VpmErrorCode | null } {
    const resolved = path.resolve(filePath)
    const dir = path.resolve(this.options.downloadDir)
    const name = path.basename(resolved)
    if (
      path.dirname(resolved) !== dir ||
      !name.startsWith(INSTALLER_PREFIX) ||
      !name.toLowerCase().endsWith('.exe') ||
      !fs.existsSync(resolved)
    ) {
      return { ok: false, errorCode: 'vpmUpdateInstallFailed' }
    }
    try {
      const child = spawn(resolved, [], {
        detached: true,
        stdio: 'ignore',
        // 安装器是 GUI：必须让窗口正常显示（和 Unity 一样的坑）。
        windowsHide: false,
        shell: false
      })
      child.unref()
      return { ok: true, errorCode: null }
    } catch {
      return { ok: false, errorCode: 'vpmUpdateInstallFailed' }
    }
  }

  /** 测试用：丢掉缓存。 */
  reset(): void {
    this.cache = null
    this.release = null
  }

  /** 只读：release JSON 的体积上限，供 UI 说明文案用。 */
  static readonly maxReleaseBytes = MAX_RELEASE_BYTES
}
