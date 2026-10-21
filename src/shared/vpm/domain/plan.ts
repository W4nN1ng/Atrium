import { sha256Hex } from './hash'
import {
  resolveVpmDependencies,
  type ResolverCatalogPackage,
  type ResolverConflictReason,
  type ResolverInstalled,
  type ResolverLocked,
  type ResolverOptions,
  type ResolverRequest,
  type ResolverRequirement,
  type ResolverWarning
} from './resolver'
import { compareParsedVersions, parseVpmVersion } from './version'

export type ChangePlanAction = 'install' | 'upgrade' | 'downgrade' | 'reinstall' | 'remove' | 'keep'
export type ChangePlanReason = 'root' | 'dependency' | 'unused' | 'locked' | 'reinstall'
export type ChangePlanConflictReason = ResolverConflictReason | 'missingHash' | 'missingSource'

export interface ChangePlanRequest extends ResolverRequest {}

export interface ChangePlanInput {
  projectKey: string
  unityVersion: string | null
  manifestHashBefore: string
  roots: Record<string, string>
  locked?: Record<string, ResolverLocked>
  installed?: ResolverInstalled[]
  catalog: ResolverCatalogPackage[]
  requests?: ChangePlanRequest[]
  preset?: 'upgradeAll'
  options?: ResolverOptions
  freeBytes?: number
}

export interface ChangePlanChange {
  name: string
  action: ChangePlanAction
  from: string | null
  to: string | null
  isMajor: boolean
  reason: ChangePlanReason
  requested: boolean
  requiredBy: ResolverRequirement[]
  repoId: string | null
  risk: string[]
}

export interface ChangePlanDownload {
  name: string
  version: string
  source: 'repo'
  repoId: string | null
  url: string
  sha256: string
  size: number | null
}

export interface ChangePlanConflict {
  name: string
  reason: ChangePlanConflictReason
  requirements: ResolverRequirement[]
  selected: string | null
}

export interface ChangePlanMissing {
  name: string
  requirements: ResolverRequirement[]
}

export interface ChangePlanFinalPackage {
  name: string
  version: string
  source: 'repo' | 'installed'
  repoId: string | null
}

export interface ChangePlanDisk {
  downloadBytes: number
  installBytes: number
  freeBytes: number | null
}

export interface ChangePlan {
  projectKey: string
  unityVersion: string | null
  manifestHashBefore: string
  preset: 'upgradeAll' | null
  /** 计划完成后的 manifest.dependencies；upgradeAll 不改根。 */
  roots: Record<string, string>
  blocked: boolean
  changes: ChangePlanChange[]
  finalPackages: ChangePlanFinalPackage[]
  conflicts: ChangePlanConflict[]
  missing: ChangePlanMissing[]
  warnings: ResolverWarning[]
  downloads: ChangePlanDownload[]
  disk: ChangePlanDisk
  requiresUnityClosed: true
  /** 计划内容（除本字段）的稳定 hash，供 P4 预检/幂等使用。 */
  planHash: string
}

const PROTECTED_FALLBACK = 'com.avca.bridge'

function normalize(value: string): string {
  return value.trim().toLowerCase()
}

function isProtected(name: string, options: ResolverOptions | undefined): boolean {
  const protectedNames = new Set(
    [PROTECTED_FALLBACK, ...(options?.protectedPackages ?? [])].map(normalize)
  )
  return protectedNames.has(normalize(name))
}

function isLegacy(name: string, options: ResolverOptions | undefined): boolean {
  return new Set((options?.legacyPackages ?? []).map(normalize)).has(normalize(name))
}

function isUnlisted(name: string, installed: ResolverInstalled[]): boolean {
  return installed.some((item) => normalize(item.name) === normalize(name) && item.source === 'unlisted')
}

function upgradeAllRequests(input: ChangePlanInput): ChangePlanRequest[] {
  const protectedNames = new Set(
    [PROTECTED_FALLBACK, ...(input.options?.protectedPackages ?? [])].map(normalize)
  )
  const legacy = new Set((input.options?.legacyPackages ?? []).map(normalize))
  const unlisted = new Set(
    (input.installed ?? [])
      .filter((item) => item.source === 'unlisted')
      .map((item) => normalize(item.name))
  )
  const roots = new Set(Object.keys(input.roots ?? {}).map(normalize))
  const candidates = new Set<string>()
  for (const name of roots) candidates.add(name)
  for (const name of Object.keys(input.locked ?? {})) candidates.add(normalize(name))
  return [...candidates]
    .filter((name) => name && !protectedNames.has(name) && !legacy.has(name) && !unlisted.has(name))
    .sort()
    .map((name) => ({ kind: 'upgrade' as const, name }))
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, canonical(item)])
    )
  }
  return value
}

function sortedRoots(roots: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(roots ?? {}).sort(([a], [b]) => a.localeCompare(b))
  )
}

function stableRequirements(requirements: ResolverRequirement[] | undefined): ResolverRequirement[] {
  return [...(requirements ?? [])]
    .map((item) => ({ source: item.source, range: item.range }))
    .sort((a, b) => a.source.localeCompare(b.source) || a.range.localeCompare(b.range))
}

function majorChanged(from: string | null, to: string | null): boolean {
  if (!from || !to) return false
  const a = parseVpmVersion(from)
  const b = parseVpmVersion(to)
  return !!a && !!b && a.major !== b.major
}

function riskOf(selected: { yanked: boolean; parsedVersion: ReturnType<typeof parseVpmVersion> }, missingHash: boolean): string[] {
  const risk: string[] = []
  if (selected.yanked) risk.push('yanked')
  if (selected.parsedVersion?.prerelease.length) risk.push('prerelease')
  if (missingHash) risk.push('missingHash')
  return risk
}

/**
 * 把解析结果转成只读变更计划。
 *
 * - 安装/升级/降级/重装/移除/保持都有 from/to/原因和 requiredBy；
 * - unused 只来自 resolver 的 mark-and-sweep，unlisted/protected/legacy 不进入 remove；
 * - upgradeAll 只发 upgrade 请求，不把传递依赖提升为根；
 * - 远端包缺 URL/hash 会 blocked 且不产生 download；
 * - planHash 对同一输入稳定，供 P4 预检/幂等。
 */
export function buildChangePlan(input: ChangePlanInput): ChangePlan {
  const requests = input.preset === 'upgradeAll'
    ? upgradeAllRequests(input)
    : [...(input.requests ?? [])]
  const resolverRoots = input.preset === 'upgradeAll'
    ? Object.fromEntries(
        Object.entries(input.roots ?? {}).filter(([name]) =>
          !isProtected(name, input.options) &&
          !isLegacy(name, input.options) &&
          !isUnlisted(name, input.installed ?? [])
        )
      )
    : input.roots
  const resolver = resolveVpmDependencies({
    roots: resolverRoots,
    locked: input.locked,
    installed: input.installed,
    catalog: input.catalog,
    requests,
    options: {
      ...input.options,
      unityVersion: input.unityVersion
    }
  })

  const installed = new Map(
    (input.installed ?? [])
      .map((item) => [normalize(item.name), item] as const)
      .sort(([a], [b]) => a.localeCompare(b))
  )
  const requestedNames = new Set(requests.map((request) => normalize(request.name)))
  const conflicts: ChangePlanConflict[] = resolver.conflicts.map((conflict) => ({
    name: conflict.name,
    reason: conflict.reason,
    requirements: stableRequirements(conflict.requirements),
    selected: null
  }))
  const missing = resolver.missing.map((entry) => ({
    name: entry.name,
    requirements: stableRequirements(entry.requirements)
  }))
  const changes: ChangePlanChange[] = []
  const downloads: ChangePlanDownload[] = []
  const blockedNames = new Set([
    ...conflicts.map((item) => normalize(item.name)),
    ...missing.map((item) => normalize(item.name))
  ])

  for (const selected of resolver.selected) {
    const normalized = normalize(selected.name)
    const previous = installed.get(normalized)
    const requiredBy = stableRequirements(resolver.requirements[selected.name])
    const isRoot = Object.prototype.hasOwnProperty.call(input.roots ?? {}, selected.name) ||
      Object.keys(input.roots ?? {}).some((name) => normalize(name) === normalized) ||
      requests.some((request) => request.kind === 'install' && normalize(request.name) === normalized)
    const requested = requestedNames.has(normalized)
    const forceReinstall = requested && requests.some(
      (request) => normalize(request.name) === normalized && request.kind === 'reinstall'
    )
    let action: ChangePlanAction
    if (!previous) action = 'install'
    else if (previous.version === selected.version) action = forceReinstall ? 'reinstall' : 'keep'
    else {
      const before = parseVpmVersion(previous.version)
      const after = parseVpmVersion(selected.version)
      action = before && after && compareParsedVersions(after, before) > 0 ? 'upgrade' : 'downgrade'
    }
    let reason: ChangePlanReason = isRoot ? 'root' : 'dependency'
    if (action === 'keep' && input.locked?.[selected.name]?.version === selected.version) reason = 'locked'
    if (action === 'reinstall') reason = 'reinstall'
    const url = selected.url
    const sha256 = selected.sha256
    const missingHash = selected.source === 'repo' && !sha256
    const missingSource = selected.source === 'repo' && !url

    if (action !== 'keep' && selected.source === 'repo') {
      if (missingHash) {
        conflicts.push({
          name: selected.name,
          reason: 'missingHash',
          requirements: requiredBy,
          selected: selected.version
        })
      } else if (missingSource) {
        conflicts.push({
          name: selected.name,
          reason: 'missingSource',
          requirements: requiredBy,
          selected: selected.version
        })
      } else if (url && sha256) {
        downloads.push({
          name: selected.name,
          version: selected.version,
          source: 'repo',
          repoId: selected.repoId,
          url,
          sha256,
          size: selected.size
        })
      }
    } else if (action === 'reinstall' && selected.source === 'installed') {
      conflicts.push({
        name: selected.name,
        reason: 'missingSource',
        requirements: requiredBy,
        selected: selected.version
      })
    }

    changes.push({
      name: selected.name,
      action,
      from: previous?.version ?? null,
      to: selected.version,
      isMajor: action === 'upgrade' || action === 'downgrade'
        ? majorChanged(previous?.version ?? null, selected.version)
        : false,
      reason,
      requested,
      requiredBy,
      repoId: selected.repoId,
      risk: riskOf({ yanked: selected.yanked, parsedVersion: parseVpmVersion(selected.version) }, missingHash)
    })
  }

  for (const name of resolver.unused) {
    const normalized = normalize(name)
    if (blockedNames.has(normalized)) continue
    if (isProtected(name, input.options) || isLegacy(name, input.options)) continue
    if (isUnlisted(name, input.installed ?? [])) continue
    const previous = installed.get(normalized)
    if (!previous) continue
    changes.push({
      name: previous.name,
      action: 'remove',
      from: previous.version,
      to: null,
      isMajor: false,
      reason: 'unused',
      requested: false,
      requiredBy: [],
      repoId: null,
      risk: []
    })
  }

  const allBlocked = resolver.blocked ||
    conflicts.some((item) => item.reason === 'missingHash' || item.reason === 'missingSource')
  const downloadBytes = downloads.reduce((sum, item) => sum + (item.size ?? 0), 0)
  const finalPackages = resolver.selected.map<ChangePlanFinalPackage>((item) => ({
    name: item.name,
    version: item.version,
    source: item.source,
    repoId: item.repoId
  }))
  changes.sort((a, b) => a.name.localeCompare(b.name) || a.action.localeCompare(b.action))
  conflicts.sort((a, b) => a.name.localeCompare(b.name) || a.reason.localeCompare(b.reason))
  missing.sort((a, b) => a.name.localeCompare(b.name))
  downloads.sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version))

  const finalRoots = input.preset === 'upgradeAll'
    ? sortedRoots(input.roots)
    : sortedRoots(resolver.roots)
  const base = {
    projectKey: input.projectKey,
    unityVersion: input.unityVersion,
    manifestHashBefore: input.manifestHashBefore,
    preset: input.preset ?? null,
    roots: finalRoots,
    blocked: allBlocked,
    changes,
    finalPackages,
    conflicts,
    missing,
    warnings: [...resolver.warnings].sort((a, b) =>
      (a.code + '\0' + (a.name ?? '') + '\0' + (a.version ?? '')).localeCompare(
        b.code + '\0' + (b.name ?? '') + '\0' + (b.version ?? '')
      )),
    downloads,
    disk: {
      downloadBytes,
      installBytes: downloadBytes,
      freeBytes: typeof input.freeBytes === 'number' ? input.freeBytes : null
    },
    requiresUnityClosed: true as const
  }
  return { ...base, planHash: sha256Hex(JSON.stringify(canonical(base))) }
}
