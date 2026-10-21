import {
  normalizePackageId
} from './packageId'
import {
  parseVpmRange,
  satisfiesVpmRange,
  type VpmVersionRange
} from './range'
import {
  isUnityVersionCompatible,
  parseUnityVersion
} from './unityVersion'
import {
  compareParsedVersions,
  isPrereleaseVersion,
  parseVpmVersion,
  type VpmVersion
} from './version'

const DEFAULT_PROTECTED = ['com.avca.bridge']
const DEFAULT_MAX_UPDATES = 1_000

export interface ResolverRequest {
  kind: 'install' | 'upgrade' | 'downgrade' | 'reinstall' | 'remove'
  name: string
  /** install/upgrade 可用；downgrade 必须用 version。 */
  range?: string
  version?: string
}

export interface ResolverInstalled {
  name: string
  version: string
  dependencies?: Record<string, string>
  source?: 'embedded' | 'legacy' | 'unlisted'
}

export interface ResolverLocked {
  version: string
  dependencies?: Record<string, string>
}

export interface ResolverCatalogPackage {
  name: string
  version: string
  dependencies?: Record<string, string>
  unity?: string | null
  yanked?: boolean
  repoId?: string | null
  repoPriority?: number
  sha256?: string | null
  url?: string | null
  size?: number | null
}

export interface ResolverOptions {
  allowPrerelease?: boolean
  unityVersion?: string | null
  protectedPackages?: string[]
  legacyPackages?: string[]
  maxUpdates?: number
}

export interface ResolverInput {
  roots: Record<string, string>
  locked?: Record<string, ResolverLocked>
  installed?: ResolverInstalled[]
  catalog: ResolverCatalogPackage[]
  requests?: ResolverRequest[]
  options?: ResolverOptions
}

export interface ResolverRequirement {
  source: string
  range: string
}

export type ResolverCandidateSource = 'repo' | 'installed'

export interface ResolvedPackage {
  name: string
  version: string
  source: ResolverCandidateSource
  repoId: string | null
  dependencies: Record<string, string>
  unityMin: string | null
  yanked: boolean
  sha256: string | null
  url: string | null
  size: number | null
}

export type ResolverConflictReason =
  | 'noCandidate'
  | 'rangeConflict'
  | 'unityIncompatible'
  | 'hashConflict'
  | 'cycle'
  | 'protectedPackage'
  | 'legacyPackageConflict'
  | 'rangeInvalid'
  | 'invalidPackage'
  | 'transitiveRemove'
  | 'maxUpdates'

export interface ResolverConflict {
  name: string
  reason: ResolverConflictReason
  requirements: ResolverRequirement[]
}

export interface ResolverMissing {
  name: string
  requirements: ResolverRequirement[]
}

export type ResolverWarningCode =
  | 'yanked'
  | 'prerelease'
  | 'lockedPrerelease'
  | 'installedFallback'
  | 'missingHash'
  | 'unlisted'
  | 'reinstallNotInstalled'
  | 'invalidCatalogEntry'
  | 'maxUpdates'

export interface ResolverWarning {
  code: ResolverWarningCode
  name?: string
  version?: string
}

export interface ResolveResult {
  roots: Record<string, string>
  selected: ResolvedPackage[]
  requirements: Record<string, ResolverRequirement[]>
  conflicts: ResolverConflict[]
  missing: ResolverMissing[]
  warnings: ResolverWarning[]
  unused: string[]
  unlisted: string[]
  reinstall: string[]
  blocked: boolean
  updates: number
}

interface Candidate {
  name: string
  version: string
  parsedVersion: VpmVersion
  source: ResolverCandidateSource
  repoId: string | null
  priority: number
  dependencies: Record<string, string>
  unityMin: string | null
  yanked: boolean
  sha256: string | null
  url: string | null
  size: number | null
}

interface Constraint {
  range: string
  parsed: VpmVersionRange | null
}

interface ChoiceFailure {
  reason: ResolverConflictReason
}

type Choice = Candidate | ChoiceFailure

const isFailure = (choice: Choice): choice is ChoiceFailure => 'reason' in choice

function sortedRecord(value: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)))
}

function normalizeName(value: unknown): string | null {
  try {
    return normalizePackageId(value)
  } catch {
    return null
  }
}

function dependenciesOf(value: Record<string, string> | undefined): Record<string, string> {
  if (!value) return {}
  const out: Record<string, string> = {}
  for (const [name, range] of Object.entries(value)) {
    if (typeof range === 'string' && range.trim()) out[name] = range.trim()
  }
  return sortedRecord(out)
}

function sameRequirements(a: Candidate | undefined, b: Candidate): boolean {
  return !!a && a.version === b.version && a.source === b.source && a.repoId === b.repoId
}

function highest(candidates: Candidate[]): Candidate | null {
  if (!candidates.length) return null
  return [...candidates].sort((a, b) => {
    const compared = compareParsedVersions(a.parsedVersion, b.parsedVersion)
    if (compared !== 0) return -compared
    if (a.priority !== b.priority) return a.priority - b.priority
    return (a.repoId ?? '').localeCompare(b.repoId ?? '')
  })[0]
}

function requirementList(constraints: Map<string, Constraint>): ResolverRequirement[] {
  return [...constraints.entries()]
    .map(([source, value]) => ({ source, range: value.range }))
    .sort((a, b) => a.source.localeCompare(b.source) || a.range.localeCompare(b.range))
}

function dedupeWarnings(warnings: ResolverWarning[]): ResolverWarning[] {
  const seen = new Set<string>()
  const out: ResolverWarning[] = []
  for (const warning of warnings) {
    const key = `${warning.code}\0${warning.name ?? ''}\0${warning.version ?? ''}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(warning)
  }
  return out.sort((a, b) =>
    (a.code + '\0' + (a.name ?? '') + '\0' + (a.version ?? '')).localeCompare(
      b.code + '\0' + (b.name ?? '') + '\0' + (b.version ?? '')
    ))
}

/**
 * 确定性贪心解析器：约束表 + 工作队列 + 局部修复，不做全局回溯。
 *
 * - 根范围来自 manifest.dependencies；locked 是偏好，不是硬钉；
 * - 候选必须满足所有来源的范围、Unity 兼容、yanked/预发布/受保护/legacy 过滤；
 * - 同版本多仓库按 repoPriority 选择，不同 hash 直接冲突，不静默挑一个；
 * - 无法选出候选时保留 requirements 并 blocked，不把工程判成"装一半"。
 */
export function resolveVpmDependencies(input: ResolverInput): ResolveResult {
  const options = input.options ?? {}
  const allowPrerelease = options.allowPrerelease === true
  const maxUpdates = Math.max(1, Math.trunc(options.maxUpdates ?? DEFAULT_MAX_UPDATES))
  const unityVersion = options.unityVersion ?? null
  const unityValid = unityVersion === null || parseUnityVersion(unityVersion) !== null
  const protectedSet = new Set(
    [...DEFAULT_PROTECTED, ...(options.protectedPackages ?? [])]
      .map(normalizeName)
      .filter((name): name is string => !!name)
  )
  const legacySet = new Set(
    (options.legacyPackages ?? []).map(normalizeName).filter((name): name is string => !!name)
  )
  const warnings: ResolverWarning[] = []
  const selected = new Map<string, Candidate>()
  const constraints = new Map<string, Map<string, Constraint>>()
  const conflicts = new Map<string, ResolverConflict>()
  const missing = new Map<string, ResolverMissing>()
  /** 请求本身无效（如移除传递依赖）；不能被后续成功选版覆盖。 */
  const permanentConflicts = new Set<string>()
  const queue = new Set<string>()
  const roots = new Map<string, string>()
  const forceHighest = new Set<string>()
  const forceExact = new Map<string, string>()
  const forceReinstall = new Set<string>()
  const installedNames = new Set<string>()
  const unlistedNames = new Set<string>()

  const addConflict = (name: string, reason: ResolverConflictReason, requirements: ResolverRequirement[]): void => {
    if (!conflicts.has(name)) conflicts.set(name, { name, reason, requirements })
  }
  const addMissing = (name: string, requirements: ResolverRequirement[]): void => {
    if (!missing.has(name)) missing.set(name, { name, requirements })
  }
  const addConstraint = (name: string, source: string, range: string): void => {
    const normalizedRange = typeof range === 'string' ? range.trim() : ''
    let map = constraints.get(name)
    if (!map) {
      map = new Map()
      constraints.set(name, map)
    }
    const old = map.get(source)
    if (old?.range === normalizedRange) return
    let parsed: VpmVersionRange | null = null
    try {
      parsed = parseVpmRange(normalizedRange)
    } catch {
      parsed = null
    }
    map.set(source, { range: normalizedRange, parsed })
    queue.add(name)
  }
  const removeSource = (source: string): void => {
    for (const [name, map] of constraints) {
      if (!map.has(source)) continue
      map.delete(source)
      queue.add(name)
      if (!map.size) constraints.delete(name)
    }
  }
  const requirementsFor = (name: string): ResolverRequirement[] =>
    requirementList(constraints.get(name) ?? new Map())

  // 根依赖先把 manifest 里的范围放上；请求再修改根/偏好。
  for (const [rawName, rawRange] of Object.entries(input.roots ?? {})) {
    const name = normalizeName(rawName)
    if (!name) {
      addConflict(rawName, 'invalidPackage', [])
      continue
    }
    if (typeof rawRange !== 'string') {
      addConflict(name, 'rangeInvalid', [{ source: '', range: '' }])
      continue
    }
    roots.set(name, rawRange.trim())
    addConstraint(name, '', rawRange)
  }

  for (const request of input.requests ?? []) {
    const name = normalizeName(request.name)
    if (!name) {
      addConflict(String(request.name), 'invalidPackage', [])
      continue
    }
    if (request.kind === 'install') {
      const range = request.range?.trim() || '*'
      roots.set(name, range)
      addConstraint(name, '', range)
      forceHighest.add(name)
      continue
    }
    if (request.kind === 'upgrade') {
      const version = request.version?.trim()
      if (version) {
        if (roots.has(name)) {
          roots.set(name, `=${version}`)
          addConstraint(name, '', `=${version}`)
        }
        forceExact.set(name, version)
      } else {
        forceHighest.add(name)
      }
      continue
    }
    if (request.kind === 'downgrade') {
      const version = request.version?.trim()
      if (!version) {
        addConflict(name, 'rangeConflict', requirementsFor(name))
        permanentConflicts.add(name)
        continue
      }
      if (roots.has(name)) {
        roots.set(name, `=${version}`)
        addConstraint(name, '', `=${version}`)
      }
      forceExact.set(name, version)
      continue
    }
    if (request.kind === 'remove') {
      if (roots.delete(name)) {
        const root = constraints.get(name)
        root?.delete('')
        queue.add(name)
      } else {
        addConflict(name, 'transitiveRemove', requirementsFor(name))
        permanentConflicts.add(name)
      }
      continue
    }
    if (request.kind === 'reinstall') {
      forceReinstall.add(name)
    }
  }

  // 建候选索引；同版本跨仓库先做 hash 冲突判定，再按优先级取一条。
  const groups = new Map<string, Map<string, Candidate[]>>()
  const hashConflicts = new Set<string>()
  const pushCandidate = (candidate: Candidate): void => {
    let byVersion = groups.get(candidate.name)
    if (!byVersion) {
      byVersion = new Map()
      groups.set(candidate.name, byVersion)
    }
    const list = byVersion.get(candidate.version) ?? []
    list.push(candidate)
    byVersion.set(candidate.version, list)
  }

  for (const pkg of input.catalog ?? []) {
    const name = normalizeName(pkg.name)
    const version = parseVpmVersion(pkg.version)
    if (!name || !version) {
      warnings.push({ code: 'invalidCatalogEntry', name: pkg.name, version: pkg.version })
      continue
    }
    const repoId = typeof pkg.repoId === 'string' && pkg.repoId ? pkg.repoId : null
    const priority = typeof pkg.repoPriority === 'number' && Number.isFinite(pkg.repoPriority)
      ? pkg.repoPriority
      : 0
    pushCandidate({
      name,
      version: version.raw,
      parsedVersion: version,
      source: 'repo',
      repoId,
      priority,
      dependencies: dependenciesOf(pkg.dependencies),
      unityMin: typeof pkg.unity === 'string' && pkg.unity.trim() ? pkg.unity.trim() : null,
      yanked: pkg.yanked === true,
      sha256: typeof pkg.sha256 === 'string' && /^[a-f0-9]{64}$/i.test(pkg.sha256)
        ? pkg.sha256.toLowerCase()
        : null,
      url: typeof pkg.url === 'string' ? pkg.url : null,
      size: typeof pkg.size === 'number' && Number.isFinite(pkg.size) ? pkg.size : null
    })
  }

  for (const pkg of input.installed ?? []) {
    const name = normalizeName(pkg.name)
    const version = parseVpmVersion(pkg.version)
    if (!name || !version) {
      warnings.push({ code: 'invalidCatalogEntry', name: pkg.name, version: pkg.version })
      continue
    }
    installedNames.add(name)
    if (pkg.source === 'unlisted') unlistedNames.add(name)
    if (pkg.source === 'legacy') legacySet.add(name)
    pushCandidate({
      name,
      version: version.raw,
      parsedVersion: version,
      source: 'installed',
      repoId: null,
      priority: 0,
      dependencies: dependenciesOf(pkg.dependencies ?? input.locked?.[name]?.dependencies),
      unityMin: null,
      yanked: false,
      sha256: null,
      url: null,
      size: null
    })
  }

  const candidates = new Map<string, Candidate[]>()
  for (const [name, byVersion] of groups) {
    const out: Candidate[] = []
    for (const [version, list] of byVersion) {
      const repos = list
        .filter((candidate) => candidate.source === 'repo')
        .sort((a, b) => a.priority - b.priority || (a.repoId ?? '').localeCompare(b.repoId ?? ''))
      const installed = list.find((candidate) => candidate.source === 'installed')
      const activeRepos = repos.filter((candidate) => !candidate.yanked)
      const hashSource = activeRepos.length ? activeRepos : repos
      const hashes = new Set(hashSource.map((candidate) => candidate.sha256).filter((hash): hash is string => !!hash))
      if (hashes.size > 1) {
        hashConflicts.add(`${name}\0${version}`)
        continue
      }
      const repo = repos.find((candidate) => !candidate.yanked) ?? repos[0]
      const chosen = repo && !(repo.yanked && installed) ? repo : installed ?? repo
      if (chosen) out.push(chosen)
    }
    candidates.set(name, out.sort((a, b) => {
      const compared = compareParsedVersions(a.parsedVersion, b.parsedVersion)
      if (compared !== 0) return -compared
      return (a.repoId ?? '').localeCompare(b.repoId ?? '')
    }))
  }

  const choose = (name: string, current: Map<string, Constraint>): Choice => {
    if (protectedSet.has(name)) return { reason: 'protectedPackage' }
    if (legacySet.has(name)) return { reason: 'legacyPackageConflict' }
    const requirements = [...current.values()]
    if (requirements.some((constraint) => !constraint.parsed)) return { reason: 'rangeInvalid' }
    const list = candidates.get(name) ?? []
    if (!list.length) {
      return hashConflicts.has(`${name}\0${'*'}`) || [...hashConflicts].some((key) => key.startsWith(`${name}\0`))
        ? { reason: 'hashConflict' }
        : { reason: 'noCandidate' }
    }
    const accepts = (candidate: Candidate): boolean =>
      requirements.every((constraint) =>
        satisfiesVpmRange(candidate.parsedVersion, constraint.parsed as VpmVersionRange, {
          includePrerelease: allowPrerelease
        })
      )
    const ranged = list.filter(accepts)
    if (!ranged.length) return { reason: 'rangeConflict' }
    const unityOk = unityValid
      ? ranged.filter((candidate) =>
          !candidate.unityMin || !unityVersion || isUnityVersionCompatible(candidate.unityMin, unityVersion)
        )
      : ranged
    if (!unityOk.length) return { reason: 'unityIncompatible' }

    const locked = input.locked?.[name]
    const lockedCandidate = locked
      ? unityOk.find((candidate) => candidate.version === locked.version)
      : undefined
    const exactVersion = forceExact.get(name)
    const exact = exactVersion ? unityOk.find((candidate) => candidate.version === exactVersion) : undefined
    if (exactVersion && !exact) return { reason: 'rangeConflict' }
    if (exact) return exact.yanked ? { reason: 'noCandidate' } : exact
    if (forceReinstall.has(name)) {
      const installedVersion = input.installed?.find((item) => normalizeName(item.name) === name)?.version
      const same = installedVersion
        ? unityOk.find((candidate) => candidate.version === installedVersion)
        : lockedCandidate
      if (same) return same
      return { reason: 'noCandidate' }
    }
    if (!forceHighest.has(name) && lockedCandidate) return lockedCandidate

    const eligible = unityOk.filter((candidate) =>
      !candidate.yanked && (allowPrerelease || !isPrereleaseVersion(candidate.parsedVersion))
    )
    if (!eligible.length) {
      if (unityOk.some((candidate) => candidate.yanked)) return { reason: 'noCandidate' }
      return { reason: 'noCandidate' }
    }
    const stable = eligible.filter((candidate) => !isPrereleaseVersion(candidate.parsedVersion))
    return highest(stable.length ? stable : eligible) as Candidate
  }

  const reinstall: string[] = []
  if (forceReinstall.size) {
    for (const name of forceReinstall) reinstall.push(name)
  }

  let updates = 0
  const applyCandidate = (name: string, candidate: Candidate): void => {
    const current = selected.get(name)
    if (sameRequirements(current, candidate)) {
      if (!permanentConflicts.has(name)) conflicts.delete(name)
      missing.delete(name)
      return
    }
    removeSource(name)
    selected.set(name, candidate)
    if (!permanentConflicts.has(name)) conflicts.delete(name)
    missing.delete(name)
    updates++
    if (candidate.yanked) warnings.push({ code: 'yanked', name, version: candidate.version })
    if (isPrereleaseVersion(candidate.parsedVersion)) {
      warnings.push({ code: 'prerelease', name, version: candidate.version })
    }
    if (candidate.source === 'installed') warnings.push({ code: 'installedFallback', name, version: candidate.version })
    if (candidate.source === 'repo' && !candidate.sha256) {
      warnings.push({ code: 'missingHash', name, version: candidate.version })
    }
    for (const [dependency, range] of Object.entries(candidate.dependencies)) {
      const depName = normalizeName(dependency)
      if (!depName) {
        addConflict(dependency, 'invalidPackage', [{ source: name, range }])
        continue
      }
      addConstraint(depName, name, range)
    }
  }

  while (queue.size && updates < maxUpdates) {
    const name = [...queue].sort()[0]
    queue.delete(name)
    const current = constraints.get(name)
    if (!current?.size) {
      if (selected.delete(name)) {
        removeSource(name)
        updates++
      }
      conflicts.delete(name)
      missing.delete(name)
      continue
    }
    const choice = choose(name, current)
    if (isFailure(choice)) {
      if (selected.delete(name)) removeSource(name)
      const requirements = requirementsFor(name)
      if (choice.reason === 'noCandidate') {
        const list = candidates.get(name) ?? []
        if (!list.length) addMissing(name, requirements)
        else addConflict(name, choice.reason, requirements)
      } else {
        addConflict(name, choice.reason, requirements)
      }
      continue
    }
    applyCandidate(name, choice)
  }

  if (queue.size) {
    addConflict('*', 'maxUpdates', [])
    warnings.push({ code: 'maxUpdates' })
  }

  // 收敛后的最终依赖校验（防止轮数上限/依赖变化留下未满足项）。
  for (const candidate of selected.values()) {
    for (const [rawName, range] of Object.entries(candidate.dependencies)) {
      const name = normalizeName(rawName)
      if (!name) continue
      const dependency = selected.get(name)
      if (!dependency) {
        addMissing(name, [{ source: candidate.name, range }])
        continue
      }
      const parsedRange = (() => {
        try {
          return parseVpmRange(range)
        } catch {
          return null
        }
      })()
      if (!parsedRange || !satisfiesVpmRange(dependency.parsedVersion, parsedRange, { includePrerelease: allowPrerelease })) {
        addConflict(name, 'rangeConflict', [
          { source: candidate.name, range },
          ...requirementsFor(name)
        ])
      }
    }
  }

  // 简单环检测：只有选中包之间的依赖边才算。
  const visiting = new Set<string>()
  const visited = new Set<string>()
  const cycle = (name: string): boolean => {
    if (visiting.has(name)) return true
    if (visited.has(name)) return false
    visiting.add(name)
    const current = selected.get(name)
    for (const dependency of Object.keys(current?.dependencies ?? {})) {
      const normalized = normalizeName(dependency)
      if (normalized && selected.has(normalized) && cycle(normalized)) {
        visiting.delete(name)
        return true
      }
    }
    visiting.delete(name)
    visited.add(name)
    return false
  }
  for (const name of [...selected.keys()].sort()) {
    if (cycle(name)) addConflict(name, 'cycle', requirementsFor(name))
  }

  const selectedPackages = [...selected.values()]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map<ResolvedPackage>((candidate) => ({
      name: candidate.name,
      version: candidate.version,
      source: candidate.source,
      repoId: candidate.repoId,
      dependencies: sortedRecord(candidate.dependencies),
      unityMin: candidate.unityMin,
      yanked: candidate.yanked,
      sha256: candidate.sha256,
      url: candidate.url,
      size: candidate.size
    }))

  const unused = [...installedNames]
    .filter((name) =>
      !selected.has(name) &&
      !roots.has(name) &&
      !protectedSet.has(name) &&
      !legacySet.has(name) &&
      !unlistedNames.has(name)
    )
    .sort()

  const requirementMap: Record<string, ResolverRequirement[]> = {}
  for (const name of [...constraints.keys()].sort()) requirementMap[name] = requirementsFor(name)

  const warningList = dedupeWarnings([
    ...warnings,
    ...[...unlistedNames].sort().map((name) => ({ code: 'unlisted' as const, name }))
  ])
  const conflictList = [...conflicts.values()].sort((a, b) => a.name.localeCompare(b.name) || a.reason.localeCompare(b.reason))
  const missingList = [...missing.values()].sort((a, b) => a.name.localeCompare(b.name))

  return {
    roots: sortedRecord(Object.fromEntries(roots)),
    selected: selectedPackages,
    requirements: requirementMap,
    conflicts: conflictList,
    missing: missingList,
    warnings: warningList,
    unused,
    unlisted: [...unlistedNames].sort(),
    reinstall: reinstall.sort(),
    blocked: conflictList.length > 0 || missingList.length > 0,
    updates
  }
}
