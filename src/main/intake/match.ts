import { contentMultiset, multisetEqual, serializeContentKey, type ClosurePayload, type LeafMatch, type LeafRef, type MatchEvidence, type SkipReason } from '../../shared/intake'

/** Views may overlap. Directory views include archive leaves, which are never loose evidence. */
export interface ClosureSource {
  sourcePath: string
  kind: 'directory' | 'archive' | 'loose'
  closure: ClosurePayload
  assetId?: string | null
}
export interface SelectionKeep {
  sourcePath: string
  kind: ClosureSource['kind']
  leaves: LeafRef[]
  opaque: boolean
}
interface ByteReview { requiresByteReview: boolean; reviewMatches: LeafMatch[] }
export interface SelectionSkip extends ByteReview {
  sourcePath: string
  scope: 'archive' | 'leaf'
  leaf: LeafRef | null
  reason: SkipReason
  evidence: MatchEvidence
  coveredBy: string[]
}
export interface SelectionExtract extends ByteReview {
  sourcePath: string
  leaves: LeafRef[]
  mode: 'all' | 'missing' | 'opaque'
  evidence: MatchEvidence
}
export interface SelectionResult {
  keep: SelectionKeep[]
  skip: SelectionSkip[]
  extract: SelectionExtract[]
  blocked: { sourcePath: string; path: string; reason: string }[]
  warnings: string[]
}

const cmp = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0
const slash = (value: string): string => value.replace(/\\/g, '/')
const cleanPath = (value: string): string => slash(value) === '/' ? '/' : slash(value).replace(/\/$/, '')
const pathId = (value: string): string => /^[a-z]:\//i.test(slash(value)) || slash(value).startsWith('//') ? cleanPath(value).toLowerCase() : cleanPath(value)
const base = (value: string): string => slash(value).split('/').pop() ?? ''
const parent = (value: string): string => { const index = cleanPath(value).lastIndexOf('/'); return index < 0 ? '' : cleanPath(value).slice(0, index) }
const depth = (value: string): number => slash(value).split('/').filter(Boolean).length
const stem = (value: string): string => base(value).replace(/\.(?:zip|rar|7z|unitypackage)$/i, '').toLowerCase()
const sortedUnique = (values: string[]): string[] => [...new Set(values)].sort(cmp)
function copyLeaf(leaf: LeafRef): LeafRef {
  serializeContentKey(leaf.key)
  return { key: { size: leaf.key.size, crc32: leaf.key.crc32 }, relPath: leaf.relPath,
    chain: leaf.chain.map(c => ({ sourcePath: c.sourcePath, memberPath: c.memberPath, format: c.format, key: { size: c.key.size, crc32: c.key.crc32 } })),
    localPath: leaf.localPath, ...(leaf.kind ? { kind: leaf.kind } : {}), ...(leaf.cacheKey ? { cacheKey: leaf.cacheKey } : {}) }
}
const leafCmp = (a: LeafRef, b: LeafRef): number => cmp(a.relPath, b.relPath) || cmp(serializeContentKey(a.key), serializeContentKey(b.key)) || cmp(JSON.stringify(a), JSON.stringify(b))
function copySource(source: ClosureSource): ClosureSource {
  if (!source.sourcePath || !['directory', 'archive', 'loose'].includes(source.kind)) throw new TypeError('Invalid closure source')
  return { sourcePath: cleanPath(source.sourcePath), kind: source.kind, assetId: source.assetId ?? null,
    closure: { leaves: source.closure.leaves.map(copyLeaf).sort(leafCmp), opaque: source.closure.opaque,
      warnings: sortedUnique(source.closure.warnings), unreadable: [...(source.closure.unreadable ?? [])].map(u => ({ ...u })).sort((a, b) => cmp(a.path, b.path) || cmp(a.reason, b.reason)) } }
}
function affinity(source: string, target: string): [number, number] {
  if (!target) return [1, 1]
  return [stem(source) === stem(target) ? 0 : 1,
    pathId(parent(source)) === pathId(parent(target)) || pathId(source) === pathId(parent(target)) ? 0 : 1]
}
function coverCmp(a: ClosureSource, b: ClosureSource, target: string): number {
  const x = affinity(a.sourcePath, target), y = affinity(b.sourcePath, target)
  return x[0] - y[0] || x[1] - y[1] || b.closure.leaves.length - a.closure.leaves.length || cmp(a.sourcePath, b.sourcePath)
}
function loosePath(source: ClosureSource, leaf: LeafRef): string {
  return cleanPath(leaf.localPath ?? (source.kind === 'loose' ? source.sourcePath : `${source.sourcePath}/${leaf.relPath}`))
}
interface Occurrence { source: ClosureSource; leaf: LeafRef; id: string }
interface Coverage { evidence: MatchEvidence; missing: LeafRef[]; assignments: (Occurrence | undefined)[] }

/** Full size/CRC counts are consumed per target, never globally between different containers. */
function coverage(target: ClosurePayload, candidates: readonly ClosureSource[], targetPath: string): Coverage {
  const leaves = target.leaves.map(copyLeaf).sort(leafCmp)
  const queues = new Map<string, { indices: number[]; used: number }>()
  leaves.forEach((leaf, index) => {
    const key = serializeContentKey(leaf.key), queue = queues.get(key) ?? { indices: [], used: 0 }
    queue.indices.push(index); queues.set(key, queue)
  })
  const assignments: (Occurrence | undefined)[] = Array.from({ length: leaves.length })
  const used = new Set<string>(), looseKeys = new Map<string, string>()
  const views = candidates.map(copySource).filter(s => !s.closure.opaque && pathId(s.sourcePath) !== pathId(targetPath))
    .map(source => {
      const seen = new Set<string>()
      const occurrences = source.closure.leaves.filter(l => l.kind !== 'opaque' && (source.kind === 'archive' || l.chain.length === 0)).map((leaf, index) => {
        const id = source.kind === 'archive' ? `archive:${pathId(source.sourcePath)}:${index}` : `loose:${pathId(loosePath(source, leaf))}`
        if (source.kind !== 'archive') {
          const key = serializeContentKey(leaf.key), prior = looseKeys.get(id)
          if (prior !== undefined && prior !== key) throw new Error(`Conflicting content for loose occurrence: ${id}`)
          looseKeys.set(id, key)
        }
        return { source, leaf, id }
      }).filter(o => { if (seen.has(o.id)) return false; seen.add(o.id); return true })
      return { source, occurrences }
    })
  function fits(occurrences: Occurrence[]): boolean {
    const counts = new Map<string, number>()
    for (const item of occurrences) if (!used.has(item.id)) {
      const key = serializeContentKey(item.leaf.key); counts.set(key, (counts.get(key) ?? 0) + 1)
    }
    return [...queues].every(([key, q]) => (counts.get(key) ?? 0) >= q.indices.length - q.used)
  }
  function allocate(occurrences: Occurrence[]): void {
    for (const item of occurrences) {
      const q = queues.get(serializeContentKey(item.leaf.key))
      if (!q || q.used === q.indices.length || used.has(item.id)) continue
      assignments[q.indices[q.used++]] = item; used.add(item.id)
    }
  }
  if (!target.opaque) for (const archiveTier of [false, true]) {
    const tier = views.filter(v => (v.source.kind === 'archive') === archiveTier).sort((a, b) => coverCmp(a.source, b.source, targetPath))
    const complete = tier.find(v => fits(v.occurrences))
    if (complete) { allocate(complete.occurrences); break }
    for (const view of tier) allocate(view.occurrences)
  }
  const matchedLeaves = [], missingLeaves = [], matches: LeafMatch[] = [], missing: LeafRef[] = []
  for (let i = 0; i < leaves.length; i++) {
    const leaf = leaves[i], hit = assignments[i]
    if (!hit) { missingLeaves.push({ ...leaf.key }); missing.push(leaf); continue }
    matchedLeaves.push({ ...leaf.key })
    matches.push({ key: { ...leaf.key }, coveringPath: hit.source.sourcePath, assetId: hit.source.assetId ?? null,
      coveringRelPath: hit.leaf.relPath, leafRelPath: leaf.relPath })
  }
  return { evidence: { coveredCount: matches.length, totalCount: leaves.length, matchedLeaves, missingLeaves, matches }, missing, assignments }
}

export function computeCoverage(containerClosure: ClosurePayload, dirClosures: readonly ClosureSource[], opts: { sourcePath?: string } = {}): MatchEvidence {
  return coverage(containerClosure, dirClosures, cleanPath(opts.sourcePath ?? '')).evidence
}
function review(source: ClosureSource, evidence: MatchEvidence): ByteReview {
  const bytes = source.closure.leaves.reduce((sum, leaf) => sum + leaf.key.size, 0)
  if (!Number.isSafeInteger(bytes)) throw new RangeError('Closure size exceeds safe integer range')
  const requiresByteReview = source.kind === 'archive' && bytes >= 1024 ** 3 && evidence.coveredCount > 0
  const count = requiresByteReview ? Math.min(evidence.matches.length, Math.max(5, Math.ceil(evidence.matches.length / 10))) : 0
  // Evenly spaced, deterministic picks; IO verification is a later planner/executor prerequisite.
  return { requiresByteReview, reviewMatches: Array.from({ length: count }, (_, i) => evidence.matches[Math.floor(i * evidence.matches.length / count)]) }
}
function equalKeys(a: ClosureSource, b: ClosureSource): boolean {
  return multisetEqual(contentMultiset(a.closure.leaves.map(l => l.key)), contentMultiset(b.closure.leaves.map(l => l.key)))
}
function mergeViews(views: ClosureSource[]): ClosureSource {
  const sorted = [...views].sort((a, b) => cmp(JSON.stringify(a), JSON.stringify(b))), first = sorted[0]
  if (sorted.some(s => s.kind !== first.kind || !equalKeys(s, first))) throw new Error(`Conflicting closure views: ${first.sourcePath}`)
  return { ...first, closure: { ...first.closure, opaque: sorted.some(s => s.closure.opaque),
    warnings: sortedUnique(sorted.flatMap(s => s.closure.warnings)),
    unreadable: [...new Map(sorted.flatMap(s => s.closure.unreadable ?? []).map(u => [JSON.stringify(u), u])).values()].sort((a, b) => cmp(a.path, b.path) || cmp(a.reason, b.reason)) } }
}
function stripWrapper(leaf: LeafRef, directory: string, archive: string): LeafRef {
  const prefix = `${cleanPath(archive).slice(cleanPath(directory).length + 1)}!/`
  if (!pathId(archive).startsWith(`${pathId(directory)}/`) || !leaf.relPath.startsWith(prefix)) return leaf
  return { ...leaf, relPath: leaf.relPath.slice(prefix.length), chain: leaf.chain.map(c => ({ ...c,
    memberPath: c.memberPath?.startsWith(prefix) ? c.memberPath.slice(prefix.length) : c.memberPath })) }
}

/** Pure, monotonic selection: only retained leaves enter the global evidence index. */
export function planSelection(allClosures: readonly ClosureSource[], opts: { scanRoot?: string } = {}): SelectionResult {
  const grouped = new Map<string, ClosureSource[]>()
  for (const source of allClosures.map(copySource)) {
    const id = pathId(source.sourcePath); grouped.set(id, [...(grouped.get(id) ?? []), source])
  }
  const sources = [...grouped.values()].map(mergeViews).sort((a, b) => cmp(a.sourcePath, b.sourcePath))
  const warnings = sources.flatMap(s => s.closure.warnings)
  const blocked = sources.flatMap(s => (s.closure.unreadable ?? []).map(u => ({ sourcePath: s.sourcePath, ...u })))
  const unresolved = sources.filter(s => s.kind !== 'archive' && s.closure.opaque && (s.kind === 'loose' || !s.closure.leaves.length))
  for (const source of unresolved) {
    if (!source.closure.unreadable?.length) blocked.push({ sourcePath: source.sourcePath, path: source.sourcePath, reason: 'opaque-source' })
  }
  const explicit = new Map(sources.filter(s => s.kind === 'archive').map(s => [pathId(s.sourcePath), s]))
  const derived = new Map<string, ClosureSource[]>()
  const physical = new Map<string, Occurrence[]>()
  for (const source of sources) {
    if (source.kind === 'archive') continue
    if (unresolved.includes(source)) continue
    const containers = new Map<string, LeafRef[]>()
    for (const leaf of source.closure.leaves) {
      const outer = leaf.chain[leaf.chain.length - 1]
      if (outer || leaf.kind === 'opaque') {
        const archive = cleanPath(outer?.sourcePath ?? leaf.localPath ?? `${source.sourcePath}/${leaf.relPath}`)
        const members = containers.get(archive) ?? []
        members.push(outer ? stripWrapper(leaf, source.sourcePath, archive) : leaf); containers.set(archive, members)
      } else {
        const id = pathId(loosePath(source, leaf)), occurrences = physical.get(id) ?? []
        occurrences.push({ source, leaf, id }); physical.set(id, occurrences)
      }
    }
    for (const [archive, leaves] of containers) {
      const id = pathId(archive)
      const derivedSource: ClosureSource = { sourcePath: archive, kind: 'archive', closure: { leaves: leaves.sort(leafCmp), opaque: leaves.some(l => l.kind === 'opaque'), warnings: source.closure.warnings } }
      derived.set(id, [...(derived.get(id) ?? []), derivedSource])
    }
  }
  const archives = new Map(explicit)
  for (const [id, views] of derived) {
    const view = mergeViews(views), given = explicit.get(id)
    if (given && !equalKeys(given, view)) throw new Error(`Conflicting closure views: ${given.sourcePath}`)
    archives.set(id, given ? { ...given, closure: { ...given.closure, opaque: given.closure.opaque || view.closure.opaque } } : view)
  }
  const loose: Occurrence[] = []
  for (const occurrences of physical.values()) {
    if (new Set(occurrences.map(o => serializeContentKey(o.leaf.key))).size !== 1) throw new Error(`Conflicting content for loose occurrence: ${occurrences[0].id}`)
    occurrences.sort((a, b) => Number(b.source.kind === 'loose') - Number(a.source.kind === 'loose') || depth(b.source.sourcePath) - depth(a.source.sourcePath) || cmp(a.source.sourcePath, b.source.sourcePath) || leafCmp(a.leaf, b.leaf))
    loose.push(occurrences[0])
  }
  const ownerCounts = new Map<string, number>()
  for (const item of loose) ownerCounts.set(item.source.sourcePath, (ownerCounts.get(item.source.sourcePath) ?? 0) + 1)
  const archiveList = [...archives.values()]
  const affinityCache = new Map<string, [number, number]>()
  const bestAffinity = (source: ClosureSource): [number, number] => {
    const known = affinityCache.get(source.sourcePath)
    if (known) return known
    let best: [number, number] = [1, 1]
    for (const archive of archiveList) {
      const candidate = affinity(source.sourcePath, archive.sourcePath)
      if (candidate[0] < best[0] || (candidate[0] === best[0] && candidate[1] < best[1])) best = candidate
      if (!best[0] && !best[1]) break
    }
    affinityCache.set(source.sourcePath, best); return best
  }
  const relativeDepth = (value: string): number => opts.scanRoot && pathId(value).startsWith(`${pathId(opts.scanRoot)}/`) ? depth(value.slice(cleanPath(opts.scanRoot).length + 1)) : depth(value)
  const namePenalty = (value: string): number => (base(value).match(/[\uFFFD\u2500-\u259f\x00-\x1f]/g) ?? []).length
  loose.sort((a, b) => {
    const x = bestAffinity(a.source), y = bestAffinity(b.source), pa = loosePath(a.source, a.leaf), pb = loosePath(b.source, b.leaf)
    return relativeDepth(pa) - relativeDepth(pb) || namePenalty(pa) - namePenalty(pb) || x[0] - y[0] || x[1] - y[1] ||
      (ownerCounts.get(b.source.sourcePath) ?? 0) - (ownerCounts.get(a.source.sourcePath) ?? 0) || cmp(pa, pb) || cmp(a.source.sourcePath, b.source.sourcePath)
  })
  const keep = new Map<string, SelectionKeep>(), skip: SelectionSkip[] = [], extract: SelectionExtract[] = []
  const pool = new Map<string, ClosureSource>(), index = new Map<string, Set<string>>()
  function retain(source: ClosureSource, leaves: LeafRef[], opaque: boolean): void {
    const prior = keep.get(source.sourcePath)
    keep.set(source.sourcePath, { sourcePath: source.sourcePath, kind: source.kind, leaves: [...(prior?.leaves ?? []), ...leaves].sort(leafCmp), opaque })
    if (opaque) return
    const entry: ClosureSource = { sourcePath: source.sourcePath, kind: source.kind, assetId: source.assetId ?? null,
      closure: { leaves: [...(pool.get(source.sourcePath)?.closure.leaves ?? []), ...leaves].sort(leafCmp), opaque: false, warnings: [] } }
    pool.set(source.sourcePath, entry)
    for (const leaf of leaves) {
      const key = serializeContentKey(leaf.key), paths = index.get(key) ?? new Set<string>(); paths.add(source.sourcePath); index.set(key, paths)
    }
  }
  const representatives = new Map<string, Occurrence>()
  for (const source of unresolved) { retain(source, source.closure.leaves, true); warnings.push(`${source.sourcePath}: opaque; retained without matching`) }
  for (const item of loose) {
    const key = serializeContentKey(item.leaf.key), prior = representatives.get(key)
    if (!prior) { representatives.set(key, item); retain(item.source, [item.leaf], false); continue }
    const result = coverage({ leaves: [item.leaf], opaque: false, warnings: [] }, [{ ...prior.source, closure: { leaves: [prior.leaf], opaque: false, warnings: [] } }], item.source.sourcePath === prior.source.sourcePath ? '' : item.source.sourcePath)
    skip.push({ sourcePath: item.source.sourcePath, scope: 'leaf', leaf: item.leaf, reason: 'identical-loose-copy', evidence: result.evidence,
      coveredBy: [prior.source.sourcePath], requiresByteReview: false, reviewMatches: [] })
  }
  archiveList.sort((a, b) => b.closure.leaves.length - a.closure.leaves.length || a.closure.warnings.length - b.closure.warnings.length || depth(a.sourcePath) - depth(b.sourcePath) || cmp(a.sourcePath, b.sourcePath))
  for (const archive of archiveList) {
    if (archive.closure.opaque) {
      retain(archive, archive.closure.leaves, true)
      const result = coverage(archive.closure, [], archive.sourcePath)
      extract.push({ sourcePath: archive.sourcePath, leaves: archive.closure.leaves, mode: 'opaque', evidence: result.evidence, requiresByteReview: false, reviewMatches: [] })
      warnings.push(`${archive.sourcePath}: opaque; retained without matching`); continue
    }
    const candidatePaths = new Set(archive.closure.leaves.flatMap(l => [...(index.get(serializeContentKey(l.key)) ?? [])]))
    const result = coverage(archive.closure, [...candidatePaths].sort(cmp).map(p => pool.get(p)!), archive.sourcePath)
    const evidence = result.evidence, byteReview = review(archive, evidence)
    if (byteReview.requiresByteReview) warnings.push(`${archive.sourcePath}: byte-review-required`)
    if (!result.missing.length) {
      const coveredBy = sortedUnique(evidence.matches.map(m => m.coveringPath))
      const previous = coveredBy.length === 1 ? pool.get(coveredBy[0]) : undefined
      const reason = previous?.kind === 'archive' && equalKeys(archive, previous) ? 'duplicate-of-kept-archive' : 'fully-covered'
      skip.push({ sourcePath: archive.sourcePath, scope: 'archive', leaf: null, reason, evidence, coveredBy, ...byteReview })
    } else {
      retain(archive, result.missing, false)
      extract.push({ sourcePath: archive.sourcePath, leaves: result.missing, mode: evidence.coveredCount ? 'missing' : 'all', evidence, ...byteReview })
    }
  }
  return { keep: [...keep.values()].sort((a, b) => cmp(a.sourcePath, b.sourcePath)),
    skip: skip.sort((a, b) => cmp(a.sourcePath, b.sourcePath) || cmp(a.scope, b.scope) || leafCmp(a.leaf ?? leafPlaceholder, b.leaf ?? leafPlaceholder)),
    extract: extract.sort((a, b) => cmp(a.sourcePath, b.sourcePath)),
    blocked: [...new Map(blocked.map(b => [JSON.stringify(b), b])).values()].sort((a, b) => cmp(a.sourcePath, b.sourcePath) || cmp(a.path, b.path) || cmp(a.reason, b.reason)), warnings: sortedUnique(warnings) }
}
const leafPlaceholder: LeafRef = { key: { size: 0, crc32: 0 }, relPath: '', chain: [], localPath: null }
