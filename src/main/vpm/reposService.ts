import { ulid } from '../../shared/ulid'
import { VpmError, type VpmErrorCode } from '../../shared/vpm/errors'
import { parseRepoJson, type ParsedRepo } from '../../shared/vpm/domain/repo'
import { assertHttpsUrl, type VpmHttpPort, type VpmJsonResponse } from './http'
import type { RepoRow, RepoStore, PackageVersionInput } from './repos'
import { repoScope, type SecretStore } from './secrets'

export const OFFICIAL_REPO_URL = 'https://packages.vrchat.com/official?download'
export const CURATED_REPO_URL = 'https://packages.vrchat.com/curated?download'

export interface RepoDto {
  id: string
  url: string
  name: string
  kind: string
  enabled: boolean
  sortOrder: number
  packageCount: number
  lastFetchAt: number | null
  lastSuccessAt: number | null
  lastErrorCode: string | null
}

export interface AddRepoInput {
  url: string
  name?: string
}

export type RepoRefreshStatus = 'updated' | 'not-modified' | 'error'

export interface RepoRefreshResult {
  repo: RepoDto
  status: RepoRefreshStatus
  packageCount: number
  errorCode: VpmErrorCode | null
}

export interface ReposServiceOptions {
  store: RepoStore
  http: VpmHttpPort
  hasConsent: () => boolean
  now?: () => number
  /** refreshAll 并发；默认 2，夹在 1..4。 */
  concurrency?: number
  /** 每仓库请求头（P7-B）；只有这里能拿到，头不进 DTO/日志。 */
  secrets?: Pick<SecretStore, 'get' | 'available' | 'set' | 'clear' | 'list'>
}

function toDto(row: RepoRow): RepoDto {
  return {
    id: row.id,
    url: row.url,
    name: row.name,
    kind: row.kind,
    enabled: row.enabled,
    sortOrder: row.sortOrder,
    packageCount: row.packageCount,
    lastFetchAt: row.lastFetchAt,
    lastSuccessAt: row.lastSuccessAt,
    lastErrorCode: row.lastErrorCode
  }
}

function errorCodeOf(error: unknown): VpmErrorCode {
  return error instanceof VpmError ? error.code : 'vpmInternal'
}

/** 去 fragment、去尾斜杠（根路径除外），保留 query；只接受 HTTPS。 */
export function normalizeRepoUrl(raw: string): string {
  const url = assertHttpsUrl(raw)
  if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, '')
  return url.href
}

function defaultName(url: string): string {
  try {
    return new URL(url).hostname.slice(0, 200) || 'Repository'
  } catch {
    return 'Repository'
  }
}

/**
 * 仓库用例：增删、刷新、种子、错误隔离。
 *
 * - 不直接读 SQL/发网络；依赖 RepoStore + VpmHttpPort；
 * - 304 只更新 fetch 元数据，不动包行；失败保留旧包行并记错误；
 * - 同仓库并发刷新去重；refreshAll 默认 2 并发；
 * - dispose 后中止 HTTP 且不再写库。
 */
export class ReposService {
  private readonly store: RepoStore
  private readonly http: VpmHttpPort
  private readonly hasConsent: () => boolean
  private readonly now: () => number
  private readonly concurrency: number
  private readonly secrets: ReposServiceOptions['secrets']
  private readonly abortController = new AbortController()
  private readonly inFlight = new Map<string, Promise<RepoRefreshResult>>()
  private disposed = false

  constructor(options: ReposServiceOptions) {
    this.store = options.store
    this.http = options.http
    this.hasConsent = options.hasConsent
    this.now = options.now ?? Date.now
    this.concurrency = Math.min(4, Math.max(1, Math.trunc(options.concurrency ?? 2)))
    this.secrets = options.secrets
  }

  listRepos(): RepoDto[] {
    return this.store.listRepos().map(toDto)
  }

  async seedIfEmpty(): Promise<void> {
    if (this.store.listRepos().length > 0) return
    if (!this.consent()) return
    this.store.upsertRepo({
      id: 'vrchat-official',
      url: OFFICIAL_REPO_URL,
      name: 'Official',
      kind: 'remote',
      enabled: true,
      sortOrder: 0
    })
    this.store.upsertRepo({
      id: 'vrchat-curated',
      url: CURATED_REPO_URL,
      name: 'Curated',
      kind: 'remote',
      enabled: true,
      sortOrder: 1
    })
  }

  async addRepo(input: AddRepoInput): Promise<RepoDto> {
    const url = normalizeRepoUrl(input?.url ?? '')
    if (this.store.getRepoByUrl(url)) throw new VpmError('vpmRepoConflict', { field: 'url' })
    const name = (input.name ?? '').trim().slice(0, 200) || defaultName(url)
    const repos = this.store.listRepos()
    const sortOrder = repos.length ? Math.max(...repos.map((repo) => repo.sortOrder)) + 1 : 0
    const created = this.store.upsertRepo({
      id: ulid(),
      url,
      name,
      kind: 'remote',
      enabled: true,
      sortOrder
    })

    if (!this.consent()) return toDto(created)
    const result = await this.refreshRepo(created.id)
    return result.repo
  }

  removeRepo(id: string): void {
    if (!this.store.removeRepo(id)) throw new VpmError('vpmRepoNotFound')
  }

  /**
   * 编辑仓库（P7-A）：名称 / URL / 启用状态。
   *
   * - URL 变更会清掉抓取状态并重新抓取；**旧包行按 repoId 保留到抓取成功**，
   *   失败时用户还能看到上一次的内容（缓存按 sha256 存，不受影响）。
   * - 内置仓库也允许改名/停用，但不允许改 URL（id 是固定的官方 id）。
   */
  async updateRepo(id: string, patch: { name?: string; url?: string; enabled?: boolean }): Promise<RepoDto> {
    const current = this.store.getRepo(id)
    if (!current) throw new VpmError('vpmRepoNotFound')

    let url = current.url
    let urlChanged = false
    if (patch.url !== undefined) {
      const next = normalizeRepoUrl(patch.url)
      if (next !== current.url) {
        const clash = this.store.getRepoByUrl(next)
        if (clash && clash.id !== id) throw new VpmError('vpmRepoConflict', { field: 'url' })
        url = next
        urlChanged = true
      }
    }
    const name =
      patch.name === undefined
        ? current.name
        : (patch.name.trim().slice(0, 200) || defaultName(url))
    const enabled = patch.enabled === undefined ? current.enabled : patch.enabled === true

    const saved = this.store.upsertRepo({
      id: current.id,
      url,
      name,
      kind: current.kind,
      enabled,
      sortOrder: current.sortOrder
    })
    if (urlChanged) {
      // 旧的包行先留着（抓取成功才会被替换）；状态改成"刚试过、还没成功过"。
      this.store.updateRepoFetchState(id, {
        lastFetchAt: this.now(),
        lastSuccessAt: null,
        lastErrorCode: null,
        etag: null,
        lastModified: null
      })
    }
    // 重新读一次：上面的 upsert 快照早于 fetch 状态更新。
    const fresh = this.store.getRepo(id) ?? saved
    if (!this.consent()) return toDto(fresh)
    if (urlChanged || (enabled && !current.enabled)) {
      const result = await this.refreshRepo(id)
      return result.repo
    }
    return toDto(fresh)
  }

  /** 按给定顺序重写 sortOrder（P7-A）；未列出的仓库排在后面，保持相对顺序。 */
  reorderRepos(ids: readonly string[]): RepoDto[] {
    const repos = this.store.listRepos()
    const byId = new Map(repos.map((repo) => [repo.id, repo]))
    const ordered: string[] = []
    for (const id of ids) {
      if (byId.has(id) && !ordered.includes(id)) ordered.push(id)
    }
    for (const repo of repos) if (!ordered.includes(repo.id)) ordered.push(repo.id)
    this.store.setSortOrders(ordered.map((id, index) => ({ id, sortOrder: index })))
    return this.listRepos()
  }

  /** 导出成我们自己的 JSON（只含 URL 与名称，不含抓取状态/密钥）。 */
  exportRepos(): string {
    const repos = this.store.listRepos().map((repo) => ({
      url: repo.url,
      name: repo.name,
      enabled: repo.enabled
    }))
    return `${JSON.stringify({ format: 'atrium.repos', version: 1, repos }, null, 2)}\n`
  }

  /**
   * 导入仓库列表（P7-A）。
   *
   * 支持两种输入：
   * - 纯 URL，一行一个（`#` 开头是注释）；
   * - 我们自己的 JSON（`{ repos: [{ url, name?, enabled? }] }`）。
   *
   * 已存在的 URL 跳过（不报错），非法 URL 单独返回，**不因为一条坏的就全失败**。
   */
  async importRepos(text: string): Promise<{
    added: RepoDto[]
    skipped: Array<{ url: string; reason: 'duplicate' | 'invalid' }>
  }> {
    const source = typeof text === 'string' ? text : ''
    if (source.length > 2 * 1024 * 1024) throw new VpmError('vpmRepoInvalid', { field: 'input' })
    const entries = parseRepoImport(source)
    const added: RepoDto[] = []
    const skipped: Array<{ url: string; reason: 'duplicate' | 'invalid' }> = []
    for (const entry of entries) {
      let url: string
      try {
        url = normalizeRepoUrl(entry.url)
      } catch {
        skipped.push({ url: entry.url, reason: 'invalid' })
        continue
      }
      if (this.store.getRepoByUrl(url)) {
        skipped.push({ url, reason: 'duplicate' })
        continue
      }
      try {
        added.push(await this.addRepo({ url, ...(entry.name ? { name: entry.name } : {}) }))
      } catch {
        skipped.push({ url, reason: 'invalid' })
      }
    }
    return { added, skipped }
  }

  refreshRepo(id: string): Promise<RepoRefreshResult> {
    const running = this.inFlight.get(id)
    if (running) return running
    const promise = this.doRefresh(id).finally(() => this.inFlight.delete(id))
    this.inFlight.set(id, promise)
    return promise
  }

  async refreshAll(
    onResult?: (result: RepoRefreshResult, index: number) => void
  ): Promise<RepoRefreshResult[]> {
    const repos = this.store.listRepos().filter((repo) => repo.enabled)
    const results: RepoRefreshResult[] = new Array(repos.length)
    let next = 0
    const worker = async (): Promise<void> => {
      while (true) {
        const index = next++
        if (index >= repos.length) return
        const repo = repos[index]
        try {
          results[index] = await this.refreshRepo(repo.id)
        } catch (error) {
          const current = this.store.getRepo(repo.id) ?? repo
          results[index] = {
            repo: toDto(current),
            status: 'error',
            packageCount: current.packageCount,
            errorCode: errorCodeOf(error)
          }
        }
        try {
          onResult?.(results[index], index)
        } catch {
          /* 进度回调失败不能影响刷新本身 */
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(this.concurrency, repos.length) }, worker))
    return results
  }

  dispose(): void {
    this.disposed = true
    this.abortController.abort()
    this.inFlight.clear()
  }

  private consent(): boolean {
    try {
      return this.hasConsent()
    } catch {
      return false
    }
  }

  private async doRefresh(id: string): Promise<RepoRefreshResult> {
    const repo = this.store.getRepo(id)
    if (!repo) throw new VpmError('vpmRepoNotFound')
    if (this.disposed) return this.errorResult(repo, 'vpmHttpAborted')
    if (!this.consent()) {
      this.recordError(repo, 'vpmNetworkNotConsented')
      return this.errorResult(this.store.getRepo(id) ?? repo, 'vpmNetworkNotConsented')
    }

    const startedAt = this.now()
    let response: VpmJsonResponse
    try {
      // 自定义头只在这里出现：不记日志、不进错误、不回渲染层。
      const headers = this.secrets?.get(repoScope(id)) ?? null
      response = await this.http.getJson(repo.url, {
        etag: repo.etag,
        lastModified: repo.lastModified,
        ...(headers ? { headers } : {}),
        signal: this.abortController.signal
      })
    } catch (error) {
      const code = errorCodeOf(error)
      this.recordError(repo, code)
      return this.errorResult(this.store.getRepo(id) ?? repo, code)
    }
    if (this.disposed) return this.errorResult(repo, 'vpmHttpAborted')

    if (response.status === 304) {
      this.store.updateRepoFetchState(repo.id, {
        etag: response.etag ?? repo.etag,
        lastModified: response.lastModified ?? repo.lastModified,
        lastFetchAt: startedAt,
        lastSuccessAt: startedAt,
        lastErrorCode: null
      })
      const current = this.store.getRepo(repo.id) ?? repo
      return { repo: toDto(current), status: 'not-modified', packageCount: current.packageCount, errorCode: null }
    }

    let parsed: ParsedRepo
    try {
      parsed = parseRepoJson(response.body)
    } catch (error) {
      const code = errorCodeOf(error)
      this.recordError(repo, code)
      return this.errorResult(this.store.getRepo(id) ?? repo, code)
    }
    if (this.disposed) return this.errorResult(repo, 'vpmHttpAborted')

    const packages: PackageVersionInput[] = parsed.packages.map((pkg) => ({
      name: pkg.name,
      version: pkg.version,
      displayName: pkg.displayName,
      description: pkg.description,
      authorJson: pkg.authorJson,
      keywordsJson: pkg.keywordsJson,
      aliasesJson: pkg.aliasesJson,
      unityMin: pkg.unityMin,
      zipUrl: pkg.zipUrl,
      zipSha256: pkg.zipSha256,
      zipSize: pkg.zipSize,
      yanked: pkg.yanked,
      yankedReason: pkg.yankedReason,
      hidden: pkg.hidden,
      deprecated: pkg.deprecated,
      manifestJson: pkg.manifestJson,
      fetchedAt: startedAt
    }))

    try {
      this.store.replaceRepoPackages(repo.id, packages)
    } catch (error) {
      const code = errorCodeOf(error)
      this.recordError(repo, code)
      return this.errorResult(this.store.getRepo(id) ?? repo, code)
    }
    if (this.disposed) return this.errorResult(repo, 'vpmHttpAborted')

    const latest = this.store.getRepo(repo.id) ?? repo
    if (parsed.name && parsed.name !== latest.name) {
      this.store.upsertRepo({
        id: latest.id,
        url: latest.url,
        name: parsed.name,
        kind: latest.kind,
        enabled: latest.enabled,
        sortOrder: latest.sortOrder
      })
    }
    this.store.updateRepoFetchState(repo.id, {
      etag: response.etag ?? repo.etag,
      lastModified: response.lastModified ?? repo.lastModified,
      lastFetchAt: startedAt,
      lastSuccessAt: startedAt,
      lastErrorCode: null
    })

    const current = this.store.getRepo(repo.id) ?? repo
    return { repo: toDto(current), status: 'updated', packageCount: current.packageCount, errorCode: null }
  }

  private recordError(repo: RepoRow, code: VpmErrorCode): void {
    if (this.disposed) return
    try {
      this.store.updateRepoFetchState(repo.id, {
        etag: repo.etag,
        lastModified: repo.lastModified,
        lastFetchAt: this.now(),
        lastSuccessAt: repo.lastSuccessAt,
        lastErrorCode: code
      })
    } catch {
      /* 记录错误本身失败不掩盖主错误；下一次刷新会重新记录 */
    }
  }

  private errorResult(repo: RepoRow, code: VpmErrorCode): RepoRefreshResult {
    return { repo: toDto(repo), status: 'error', packageCount: repo.packageCount, errorCode: code }
  }
}

/**
 * 解析导入文本（P7-A）：
 * - JSON：`{ repos: [{ url, name?, enabled? }] }`；
 * - 纯文本：一行一个 URL，`#` 开头是注释，忽略空行。
 * 解析不出来就返回空数组（调用方会当成"没有可导入的"）。
 */
export function parseRepoImport(text: string): Array<{ url: string; name?: string }> {
  const trimmed = text.trim()
  if (!trimmed) return []
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const parsed: unknown = JSON.parse(trimmed)
      const list = Array.isArray(parsed)
        ? parsed
        : parsed && typeof parsed === 'object' && Array.isArray((parsed as { repos?: unknown }).repos)
          ? (parsed as { repos: unknown[] }).repos
          : []
      const out: Array<{ url: string; name?: string }> = []
      for (const item of list) {
        if (typeof item === 'string') {
          out.push({ url: item })
          continue
        }
        if (!item || typeof item !== 'object') continue
        const record = item as { url?: unknown; name?: unknown }
        if (typeof record.url !== 'string') continue
        out.push({
          url: record.url,
          ...(typeof record.name === 'string' && record.name.trim()
            ? { name: record.name.trim().slice(0, 200) }
            : {})
        })
      }
      return out
    } catch {
      return []
    }
  }
  return trimmed
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .map((url) => ({ url }))
}
