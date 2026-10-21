import { ulid } from '../../shared/ulid'
import { VpmError, type VpmErrorCode } from '../../shared/vpm/errors'
import { parseRepoJson, type ParsedRepo } from '../../shared/vpm/domain/repo'
import { assertHttpsUrl, type VpmHttpPort, type VpmJsonResponse } from './http'
import type { RepoRow, RepoStore, PackageVersionInput } from './repos'

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
  private readonly abortController = new AbortController()
  private readonly inFlight = new Map<string, Promise<RepoRefreshResult>>()
  private disposed = false

  constructor(options: ReposServiceOptions) {
    this.store = options.store
    this.http = options.http
    this.hasConsent = options.hasConsent
    this.now = options.now ?? Date.now
    this.concurrency = Math.min(4, Math.max(1, Math.trunc(options.concurrency ?? 2)))
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

  refreshRepo(id: string): Promise<RepoRefreshResult> {
    const running = this.inFlight.get(id)
    if (running) return running
    const promise = this.doRefresh(id).finally(() => this.inFlight.delete(id))
    this.inFlight.set(id, promise)
    return promise
  }

  async refreshAll(): Promise<RepoRefreshResult[]> {
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
      response = await this.http.getJson(repo.url, {
        etag: repo.etag,
        lastModified: repo.lastModified,
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
