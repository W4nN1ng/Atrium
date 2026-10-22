import { ulid } from '../../shared/ulid'
import { VpmError } from '../../shared/vpm/errors'
import { buildChangePlan, type ChangePlan } from '../../shared/vpm/domain/plan'
import type {
  ResolverInstalled,
  ResolverLocked,
  ResolverRequest
} from '../../shared/vpm/domain/resolver'
import type {
  VpmPlanDto,
  VpmPlanExplainDto,
  VpmPlanResolveInput
} from '../../shared/vpm/dto'
import type { ProjectSnapshot } from '../../shared/vpm/domain/project'
import type { CatalogService } from './catalog'
import type { ProjectsService } from './projects'

const DEFAULT_TTL_MS = 10 * 60_000
const PROTECTED_PACKAGE = 'com.avca.bridge'

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function stringMap(value: unknown): Record<string, string> {
  const record = asRecord(value)
  if (!record) return {}
  const out: Record<string, string> = {}
  for (const [name, range] of Object.entries(record)) {
    if (typeof range === 'string' && range.trim()) out[name] = range.trim()
  }
  return out
}

function lockedFrom(manifest: ProjectSnapshot['manifest']): Record<string, ResolverLocked> {
  const out: Record<string, ResolverLocked> = {}
  for (const [name, raw] of Object.entries(manifest.locked)) {
    const record = asRecord(raw)
    if (!record || typeof record.version !== 'string' || !record.version.trim()) continue
    out[name] = {
      version: record.version.trim(),
      dependencies: stringMap(record.dependencies)
    }
  }
  return out
}

function installedFrom(snapshot: ProjectSnapshot): ResolverInstalled[] {
  const out: ResolverInstalled[] = []
  for (const pkg of snapshot.packages) {
    if (pkg.source !== 'embedded' || !pkg.version) continue
    out.push({
      name: pkg.name,
      version: pkg.version,
      dependencies: pkg.vpmDependencies,
      ...(pkg.state === 'unlisted' ? { source: 'unlisted' as const } : {})
    })
  }
  return out
}

function legacyFrom(snapshot: ProjectSnapshot): string[] {
  const names = new Set<string>()
  for (const candidate of snapshot.legacy.candidates) if (candidate.name) names.add(candidate.name)
  for (const name of snapshot.manifest.legacyPackages) names.add(name)
  return [...names].sort()
}

export interface PlanServiceDeps {
  projects: ProjectsService
  catalog: CatalogService
  now?: () => number
  ttlMs?: number
}

interface CachedPlan {
  plan: ChangePlan
  expiresAt: number
  projectKey: string
}

/**
 * P3-D 计划应用服务：从工程快照 + 仓库目录组装纯计划，并保存 10 分钟内存缓存。
 * 不写工程、不下载；P4 只能按 planId 重新校验后应用。
 */
export class PlanService {
  private readonly cache = new Map<string, CachedPlan>()
  private readonly now: () => number
  private readonly ttlMs: number

  constructor(private readonly deps: PlanServiceDeps) {
    this.now = deps.now ?? Date.now
    this.ttlMs = Math.max(1_000, Math.trunc(deps.ttlMs ?? DEFAULT_TTL_MS))
  }

  resolve(input: VpmPlanResolveInput): VpmPlanDto {
    const detail = this.deps.projects.detail(input.projectKey)
    if (!detail?.snapshot) throw new VpmError('vpmProjectInvalid', { field: 'project' })
    const snapshot = detail.snapshot
    if (snapshot.manifest.hasManifest && !snapshot.manifest.valid) {
      throw new VpmError('vpmManifestInvalid', { field: 'manifest' })
    }
    const requests: ResolverRequest[] = (input.requests ?? []).map((request) => ({
      kind: request.kind,
      name: request.name,
      ...(request.range === undefined ? {} : { range: request.range }),
      ...(request.version === undefined ? {} : { version: request.version })
    }))
    const plan = buildChangePlan({
      projectKey: snapshot.projectKey,
      unityVersion: snapshot.unityVersion,
      manifestHashBefore: snapshot.manifestHash ?? '',
      roots: snapshot.manifest.dependencies,
      locked: lockedFrom(snapshot.manifest),
      installed: installedFrom(snapshot),
      catalog: this.deps.catalog.resolverCatalog(),
      requests,
      preset: input.preset,
      options: {
        allowPrerelease: input.allowPrerelease === true,
        protectedPackages: [PROTECTED_PACKAGE],
        legacyPackages: legacyFrom(snapshot)
      },
      freeBytes: typeof input.freeBytes === 'number' ? input.freeBytes : undefined
    })
    this.prune()
    const planId = ulid()
    this.cache.set(planId, { plan, expiresAt: this.now() + this.ttlMs, projectKey: snapshot.projectKey })
    return { planId, ...plan }
  }

  /**
   * 只按 planId 取回主进程缓存里的计划。
   *
   * P4-C 事务的唯一入口：不接受渲染层回传的计划内容，
   * 过期或不存在都拒绝，由调用方转成“请重新预览”。
   */
  get(planId: string): ChangePlan {
    const cached = this.cache.get(planId)
    if (!cached) throw new VpmError('vpmPlanNotFound')
    if (cached.expiresAt <= this.now()) {
      this.cache.delete(planId)
      throw new VpmError('vpmPlanExpired')
    }
    return cached.plan
  }

  explain(planId: string, name?: string | null): VpmPlanExplainDto {
    const plan = this.get(planId)
    this.prune()
    const filter = typeof name === 'string' && name.trim() ? name.trim() : null
    return {
      planId,
      name: filter,
      planHash: plan.planHash,
      changes: filter ? plan.changes.filter((item) => item.name === filter) : plan.changes,
      conflicts: filter ? plan.conflicts.filter((item) => item.name === filter) : plan.conflicts,
      missing: filter ? plan.missing.filter((item) => item.name === filter) : plan.missing,
      warnings: filter ? plan.warnings.filter((item) => item.name === filter) : plan.warnings
    }
  }

  dispose(): void {
    this.cache.clear()
  }

  private prune(): void {
    const now = this.now()
    for (const [id, cached] of this.cache) {
      if (cached.expiresAt <= now) this.cache.delete(id)
    }
  }
}
