import path from 'node:path'
import { createHash } from 'node:crypto'
import { INTAKE_PLAN_VERSION, serializeContentKey, type ContentKey, type CopyOp, type LeafRef, type PlanReview, type PlannedOccurrence, type PreparedIntakePlan, type PreparedUnit } from '../../shared/intake'
import type { AssetUnit, FileEntry, IngestResult } from '../../shared/types'
import { classify, type ClassifyDeps } from '../classify/engine'
import { splitContainer } from '../fingerprint/primary'
import { isForbiddenLibraryRoot, isForbiddenTarget, safeJoin } from '../security/paths'
import { planSelection, type ClosureSource } from './match'

export interface LibraryBlob { blobId: string; key: ContentKey; storagePath: string; refs: { assetId: string; relPath: string }[] }
export interface PlannerIndex {
  libraryRoot: string
  sources: ClosureSource[]
  classifyDeps: ClassifyDeps
  existingTargetPaths?: readonly string[] // Relative library paths, supplied by inventory; no fs calls here.
  sourceFileCount?: number
}
interface LogicalFile { logical: string; leaf: LeafRef; sourcePath: string; member: string; ordinal: number; archive: boolean }
interface Group { sourcePath: string; members: LogicalFile[]; opaque: boolean }
const cmp = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0
const slash = (s: string): string => s.replace(/\\/g, '/')
const canonical = (s: string): string => slash(path.resolve(s)).replace(/\/$/, '')
const idPath = (s: string): string => canonical(s).toLowerCase()
const uniq = (values: string[]): string[] => [...new Set(values)].sort(cmp)
const hash = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const shaPattern = /^[a-f0-9]{64}$/
const basename = (s: string): string => slash(s).split('/').pop() ?? ''
const stripExt = (s: string): string => s.replace(/\.[^.\/]+$/, '')
const image = (s: string): boolean => /\.(png|jpe?g|webp|gif|bmp)$/i.test(s)
const under = (root: string, file: string): boolean => idPath(file) === idPath(root) || idPath(file).startsWith(`${idPath(root)}/`)
const rel = (root: string, file: string): string => slash(path.relative(root, file))
const keyOf = (leaf: LeafRef): string => serializeContentKey(leaf.key)
const fileCmp = (a: LogicalFile, b: LogicalFile): number => cmp(a.logical, b.logical) || cmp(keyOf(a.leaf), keyOf(b.leaf)) || cmp(a.sourcePath, b.sourcePath) || a.ordinal - b.ordinal
function segment(raw: string): string {
  let value = raw.replace(/[<>:"|?*\x00-\x1f]/g, '_').replace(/[. ]+$/, '_')
  if (!value || value === '.' || value === '..') value = '_'
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(value) || value.toLowerCase() === '.atrium') value = '_' + value
  if (value.length > 100) { const ext = path.extname(value).slice(0, 15); value = value.slice(0, 75) + '~' + hash(raw).slice(0, 8) + ext }
  return value
}
function numbered(name: string, n: number): string { const ext = path.extname(name); return `${name.slice(0, name.length - ext.length)} (${n})${ext}` }
function expandMember(value: string): string {
  const frames = slash(value).split('!/')
  return frames.map((frame, i) => i === frames.length - 1 ? frame : frame.split('/').map((part, j, parts) => j === parts.length - 1 ? stripExt(part) : part).join('/')).join('/')
}
function fileEntry(relPath: string, size: number): FileEntry { return { relPath, size, ext: path.extname(relPath).toLowerCase(), isDir: false } }
function ingest(name: string, root: string, entries: FileEntry[], tempId: string, warnings: string[], sourceDirChain: string[] = []): IngestResult {
  return { assetId: tempId, rawName: name, sourceDirChain, stagingPath: root, detectedKind: 'folder', detectedFormat: 'dir', entries,
    metadata: { urls: [], boothItemId: null, boothItemIdConfidence: 0, sourcePlatform: null, version: null, localeTag: null, author: null, readmeText: '', previewImages: entries.filter(e => image(e.relPath)).map(e => e.relPath) },
    totalBytes: entries.reduce((n, e) => n + e.size, 0), nestedDepth: 0, warnings }
}
function libraryIndex(blobs: readonly LibraryBlob[], root: string): Map<string, LibraryBlob[]> {
  const byId = new Map<string, LibraryBlob>(), keys = new Map<string, LibraryBlob[]>()
  for (const blob of [...blobs].sort((a, b) => cmp(a.blobId, b.blobId))) {
    serializeContentKey(blob.key)
    if (!shaPattern.test(blob.blobId) || !under(root, blob.storagePath)) throw new Error('Invalid library blob index')
    const prior = byId.get(blob.blobId)
    if (prior && (serializeContentKey(prior.key) !== serializeContentKey(blob.key) || idPath(prior.storagePath) !== idPath(blob.storagePath))) throw new Error('Conflicting library blob identity')
    const refs = [...(prior?.refs ?? []), ...blob.refs].map(r => { if (!r.assetId) throw new Error('Invalid blob asset reference'); return { assetId: r.assetId, relPath: r.relPath } })
    byId.set(blob.blobId, { blobId: blob.blobId, key: { ...blob.key }, storagePath: canonical(blob.storagePath), refs: [...new Map(refs.map(r => [JSON.stringify(r), r])).values()].sort((a, b) => cmp(a.assetId, b.assetId) || cmp(a.relPath, b.relPath)) })
  }
  for (const blob of byId.values()) { const key = serializeContentKey(blob.key); keys.set(key, [...(keys.get(key) ?? []), blob]) }
  return keys
}

/** Planning is memory-only. Saving its JSON is an explicit, separate short DB operation. */
export function buildIntakePlan(scanRoot: string, closureIndex: PlannerIndex, libraryBlobIndex: readonly LibraryBlob[]): PreparedIntakePlan {
  const root = canonical(scanRoot), libraryRoot = canonical(closureIndex.libraryRoot)
  if (!path.isAbsolute(scanRoot) || !path.isAbsolute(closureIndex.libraryRoot) || isForbiddenTarget(libraryRoot) || isForbiddenLibraryRoot(libraryRoot)) throw new Error('Unsafe library root')
  if (under(root, libraryRoot) || under(libraryRoot, root)) throw new Error('Source/library overlap')
  const sources = closureIndex.sources.map(s => ({ ...s, closure: { ...s.closure, leaves: [...s.closure.leaves].sort((a, b) => cmp(a.relPath, b.relPath) || cmp(keyOf(a), keyOf(b)) || cmp(a.localPath ?? '', b.localPath ?? '') || cmp(a.blobId ?? '', b.blobId ?? '')) } })).sort((a, b) => cmp(canonical(a.sourcePath), canonical(b.sourcePath)))
  const selection = planSelection(sources, { scanRoot: root })
  const identitySets = new Map<string, Set<string>>()
  for (const source of sources) for (const leaf of source.closure.leaves) if (leaf.blobId) { const identities = identitySets.get(keyOf(leaf)) ?? new Set<string>(); identities.add(leaf.blobId); identitySets.set(keyOf(leaf), identities) }
  const collisions = new Set([...identitySets].filter(([, ids]) => ids.size > 1).map(([key]) => key))
  const trustedSkips = selection.skip.filter(s => !s.evidence.matchedLeaves.some(k => collisions.has(serializeContentKey(k))))
  const warnings = [...selection.warnings], blocked = selection.blocked.map(b => ({ ...b }))
  const blobs = libraryIndex(libraryBlobIndex, libraryRoot), reviews: PlanReview[] = []
  for (const decision of [...selection.skip, ...selection.extract]) if (decision.requiresByteReview) reviews.push({
    id: `review-${hash([decision.sourcePath, decision.reviewMatches])}`, kind: 'coverage', sourcePath: decision.sourcePath, state: 'pending', matches: decision.reviewMatches, candidateBlobIds: [] })
  const rootIsFile = sources.some(s => idPath(s.sourcePath) === idPath(root) && s.kind !== 'directory')
  const rootName = rootIsFile ? stripExt(basename(root)) : basename(root)
  const groups = new Map<string, Group>(), loose = new Map<string, LogicalFile>()
  const validateLeaf = (leaf: LeafRef): void => {
    serializeContentKey(leaf.key)
    if (leaf.blobId !== undefined && !shaPattern.test(leaf.blobId)) throw new Error('Invalid leaf SHA-256')
  }
  for (const source of sources.filter(s => s.kind === 'archive')) {
    groups.set(idPath(source.sourcePath), { sourcePath: canonical(source.sourcePath), opaque: source.closure.opaque, members: source.closure.leaves.map((leaf, ordinal) => {
      validateLeaf(leaf); return { logical: '', leaf, sourcePath: canonical(source.sourcePath), member: leaf.relPath, ordinal, archive: true }
    }) })
  }
  for (const source of sources.filter(s => s.kind !== 'archive')) {
    const derived = new Map<string, LogicalFile[]>()
    for (const [ordinal, leaf] of source.closure.leaves.entries()) {
      validateLeaf(leaf)
      const outer = leaf.chain[leaf.chain.length - 1]
      if (outer || leaf.kind === 'opaque') {
        const archivePath = canonical(outer?.sourcePath ?? leaf.localPath ?? path.join(source.sourcePath, leaf.relPath))
        const prefix = `${rel(source.sourcePath, archivePath)}!/`
        const member = leaf.relPath.startsWith(prefix) ? leaf.relPath.slice(prefix.length) : leaf.relPath
        const items = derived.get(archivePath) ?? []; items.push({ logical: '', leaf, sourcePath: archivePath, member, ordinal, archive: true }); derived.set(archivePath, items)
      } else {
        const physical = canonical(leaf.localPath ?? (source.kind === 'loose' ? source.sourcePath : path.join(source.sourcePath, leaf.relPath)))
        if (!under(root, physical)) throw new Error('Loose source is outside scan root')
        const item = { logical: rootIsFile ? basename(physical) : rel(root, physical), leaf, sourcePath: physical, member: leaf.relPath, ordinal, archive: false }
        const prior = loose.get(idPath(physical))
        if (prior && keyOf(prior.leaf) !== keyOf(leaf)) throw new Error('Conflicting loose source')
        if (!prior) loose.set(idPath(physical), item)
      }
    }
    for (const [archivePath, members] of derived) if (!groups.has(idPath(archivePath))) groups.set(idPath(archivePath), { sourcePath: archivePath, members, opaque: members.some(m => m.leaf.kind === 'opaque') })
  }
  const originals = [...loose.values()]
  const tree: LogicalFile[] = [...loose.values()]
  const extracts: PreparedIntakePlan['extracts'] = []
  const skipped = new Set(trustedSkips.filter(s => s.scope === 'archive').map(s => idPath(s.sourcePath)))
  const placementIdentity = (leaf: LeafRef): string => `${keyOf(leaf)}:${leaf.blobId ?? 'unverified'}`
  const selectedGroups = [...groups.values()].sort((a, b) => b.members.length - a.members.length || cmp(a.sourcePath, b.sourcePath))
  for (const group of selectedGroups) {
    if (!under(root, group.sourcePath) && idPath(root) !== idPath(group.sourcePath)) throw new Error('Archive source is outside scan root')
    const members = [...group.members].sort((a, b) => cmp(a.member, b.member) || cmp(keyOf(a.leaf), keyOf(b.leaf)) || cmp(a.leaf.localPath ?? '', b.leaf.localPath ?? ''))
    originals.push(...members)
    if (skipped.has(idPath(group.sourcePath))) continue
    const prefix = idPath(group.sourcePath) === idPath(root) ? '' : stripExt(rel(root, group.sourcePath))
    const available = new Map<string, number>()
    for (const item of tree) if (!prefix || item.logical.startsWith(prefix + '/')) available.set(placementIdentity(item.leaf), (available.get(placementIdentity(item.leaf)) ?? 0) + 1)
    const consumed = new Map<string, number>(), added: string[] = []
    for (const item of members) {
      const key = placementIdentity(item.leaf), used = consumed.get(key) ?? 0
      consumed.set(key, used + 1)
      if (!group.opaque && used < (available.get(key) ?? 0)) continue
      const rawContainer = item.leaf.kind === 'opaque' && item.leaf.chain.length === 0
      const logical = rawContainer ? (rootIsFile ? basename(group.sourcePath) : rel(root, group.sourcePath)) : [prefix, expandMember(item.member)].filter(Boolean).join('/')
      tree.push({ ...item, logical }); if (!rawContainer) added.push(item.member)
    }
    if (added.length) extracts.push({ source: group.sourcePath, members: added.sort(cmp) })
  }
  tree.sort(fileCmp)
  const sourceDirChain = slash(path.dirname(root)).split('/').filter(s => s && !/^[a-z]:$/i.test(s)).slice(-4)
  const partition = classify(ingest(rootName, libraryRoot, tree.map(f => fileEntry(f.logical, f.leaf.key.size)), `partition-${hash(root)}`, warnings, sourceDirChain), closureIndex.classifyDeps)
  const rawUnits = partition.units.length > 1 ? [...partition.units].sort((a, b) => cmp(a.sourceRelPath ?? '', b.sourceRelPath ?? '') || cmp(a.name, b.name)) : [partition.units[0]]
  const assignments = rawUnits.map(unit => ({ unit, prefix: partition.units.length > 1 ? slash(unit.sourceRelPath ?? '') : '', files: [] as LogicalFile[], sidecars: new Set<LogicalFile>() }))
  for (const file of tree) {
    const owned = assignments.filter(a => !a.prefix || file.logical === a.prefix || file.logical.startsWith(a.prefix + '/')).sort((a, b) => b.prefix.length - a.prefix.length)
    if (owned.length) {
      const owner = owned[0]; owner.files.push(file)
      if (image(file.logical) && !file.logical.includes('/')) owner.sidecars.add(file)
      continue
    }
    if (image(file.logical)) {
      const stem = stripExt(basename(file.logical)).toLowerCase()
      const related = assignments.filter(a => { const name = stripExt(basename(a.prefix || a.unit.name)).toLowerCase(); return name.length > 1 && (stem.includes(name) || name.includes(stem)) })
      for (const owner of related.length ? related : assignments) { owner.files.push(file); owner.sidecars.add(file) }
    } else if (assignments[0]) { assignments[0].files.push(file); warnings.push(`${file.logical}: unassigned-file-preserved`) }
  }
  const occupiedRoots = new Set((closureIndex.existingTargetPaths ?? []).map(p => slash(p).split('/')[0].toLowerCase()))
  const units: PreparedUnit[] = []
  const placements: { file: LogicalFile; unit: PreparedUnit; op: CopyOp; refs: string[] }[] = []
  for (const assignment of assignments) {
    if (!assignment.files.length) continue
    const displayName = assignment.prefix ? (assignment.files.some(f => f.logical === assignment.prefix) ? stripExt(basename(assignment.prefix)) : basename(assignment.prefix)) : rootName
    let unitRoot = segment(displayName), rootCounter = 1
    while (occupiedRoots.has(unitRoot.toLowerCase())) unitRoot = numbered(segment(displayName), ++rootCounter)
    occupiedRoots.add(unitRoot.toLowerCase())
    let contentPrefix = assignment.prefix && assignment.files.some(f => f.logical.startsWith(assignment.prefix + '/')) ? assignment.prefix + '/' : ''
    const localName = (file: LogicalFile): string => file.logical.startsWith(contentPrefix) ? file.logical.slice(contentPrefix.length) : basename(file.logical)
    // Only collapse a repeated, empty naming shell. Sidecars at that level prevent collapse.
    while (assignment.files.length && assignment.files.every(f => localName(f).startsWith(displayName + '/'))) contentPrefix += displayName + '/'
    const unitId = `unit-${hash([root, assignment.prefix, assignment.files.map(f => [f.logical, f.leaf.key, f.leaf.blobId ?? null])])}`
    const dirs = new Map<string, string>(), occupied = new Map<string, Set<string>>()
    const reserve = (parent: string, name: string): string => {
      const names = occupied.get(parent.toLowerCase()) ?? new Set<string>(); let candidate = segment(name), n = 1
      while (names.has(candidate.toLowerCase())) candidate = numbered(segment(name), ++n)
      names.add(candidate.toLowerCase()); occupied.set(parent.toLowerCase(), names); return candidate
    }
    const partsOf = (file: LogicalFile): string[] => slash(localName(file)).split('/').filter(Boolean)
    const directories = uniq(assignment.files.flatMap(file => { const parts = partsOf(file); return parts.slice(0, -1).map((_p, i) => parts.slice(0, i + 1).join('/')) })).sort((a, b) => a.split('/').length - b.split('/').length || cmp(a, b))
    for (const directory of directories) {
      const parts = directory.split('/'), parentKey = parts.slice(0, -1).join('/'), placedParent = dirs.get(parentKey) ?? ''
      dirs.set(directory, [placedParent, reserve(placedParent, parts[parts.length - 1])].filter(Boolean).join('/'))
    }
    const members = [...assignment.files].sort(fileCmp).map(file => {
      const parts = partsOf(file), parentRaw = parts.slice(0, -1).join('/'), placedParent = dirs.get(parentRaw) ?? ''
      const member = [placedParent, reserve(placedParent, parts[parts.length - 1] ?? '_')].filter(Boolean).join('/')
      return { file, member }
    })
    const maxRootLength = 259 - libraryRoot.length - 2 - Math.max(...members.map(m => m.member.length))
    if (maxRootLength >= 10 && unitRoot.length > maxRootLength) {
      const shortened = `${unitRoot.slice(0, maxRootLength - 9)}~${hash(displayName).slice(0, 8)}`
      unitRoot = shortened; let count = 1
      while (occupiedRoots.has(unitRoot.toLowerCase())) unitRoot = numbered(shortened, ++count)
      occupiedRoots.add(unitRoot.toLowerCase()); warnings.push(`${displayName}: unit-name-shortened`)
    }
    const unit: PreparedUnit = { id: unitId, displayName, assetId: unitId, existingAssetIds: [], sources: [], copyOps: [], sidecars: [], coverCandidates: [], disposition: 'new',
      relativeRoot: unitRoot, libraryPath: canonical(path.join(libraryRoot, unitRoot)), normalizedEntries: [], classification: { units: [] }, primaryKind: null }
    for (const { file, member } of members) {
      const targetRelPath = `${unitRoot}/${member}`, target = safeJoin(libraryRoot, targetRelPath)
      if (!target || target.length >= 260) { blocked.push({ sourcePath: file.sourcePath, path: file.member, reason: 'target-path-too-long-or-unsafe' }); unit.disposition = 'blocked'; continue }
      if (member !== localName(file) || unitRoot !== displayName) warnings.push(`${file.member}: renamed to ${targetRelPath}`)
      const candidates = blobs.get(keyOf(file.leaf)) ?? [], known = file.leaf.blobId
      const existing = known ? candidates.find(b => b.blobId === known) : undefined
      if (!known && candidates.length) reviews.push({ id: `review-${hash([unitId, file.member, keyOf(file.leaf)])}`, kind: 'library-identity', sourcePath: file.sourcePath, state: 'pending', matches: [], candidateBlobIds: candidates.map(b => b.blobId) })
      const refs = uniq(existing?.refs.map(r => r.assetId) ?? [])
      const op: CopyOp = { id: `copy-${hash([unitId, targetRelPath, file.sourcePath, file.member, file.ordinal, file.leaf.key])}`, sourcePath: file.leaf.localPath ?? file.sourcePath,
        targetRelPath, originalRelPath: file.member, key: { ...file.leaf.key }, blobId: known ?? null,
        idempotencyKey: known ? hash([canonical(target), known]) : null, cacheKey: file.leaf.cacheKey ?? null,
        action: existing ? 'reuse' : 'copy', libraryBlobPath: existing?.storagePath ?? null, chain: file.leaf.chain }
      if (!existing && !file.leaf.localPath && file.leaf.chain.length) { blocked.push({ sourcePath: file.sourcePath, path: file.member, reason: 'member-not-materialized' }); unit.disposition = 'blocked' }
      ;(assignment.sidecars.has(file) ? unit.sidecars : unit.copyOps).push(op)
      unit.normalizedEntries.push(fileEntry(member, op.key.size)); if (image(member)) unit.coverCandidates.push(targetRelPath)
      unit.sources.push(file.sourcePath); unit.existingAssetIds.push(...refs); placements.push({ file, unit, op, refs })
    }
    const ops = [...unit.copyOps, ...unit.sidecars]
    unit.existingAssetIds = uniq(unit.existingAssetIds); unit.sources = uniq(unit.sources); unit.coverCandidates = uniq(unit.coverCandidates)
    if (unit.disposition !== 'blocked') {
      if (ops.length && ops.every(o => o.action === 'reuse') && placements.filter(p => p.unit === unit).every(p => p.refs.length)) { unit.disposition = 'duplicate'; unit.assetId = null }
      else if (ops.some(o => o.action === 'reuse')) unit.disposition = 'merge'
    }
    unit.normalizedEntries.sort((a, b) => cmp(a.relPath, b.relPath))
    unit.classification = classify(ingest(displayName, unit.libraryPath, unit.normalizedEntries, unitId, warnings, sourceDirChain), closureIndex.classifyDeps)
    unit.primaryKind = splitContainer(unit.normalizedEntries).primaryKind
    units.push(unit)
  }
  const physicalOwners = new Map<string, CopyOp>()
  const preferredLoose = new Set(selection.keep.filter(s => s.kind !== 'archive').flatMap(s => s.leaves.map(l => idPath(l.localPath ?? (s.kind === 'loose' ? s.sourcePath : path.join(s.sourcePath, l.relPath))))))
  for (const placed of [...placements].sort((a, b) => Number(preferredLoose.has(idPath(b.file.leaf.localPath ?? b.file.sourcePath))) - Number(preferredLoose.has(idPath(a.file.leaf.localPath ?? a.file.sourcePath))) || Number(a.file.archive) - Number(b.file.archive) || cmp(a.op.targetRelPath, b.op.targetRelPath))) {
    const op = placed.op
    if (op.action !== 'copy' || !op.blobId) continue
    const owner = physicalOwners.get(op.blobId)
    if (owner) { op.action = 'reuse'; op.reuseFromOpId = owner.id; op.sourcePath = owner.sourcePath }
    else physicalOwners.set(op.blobId, op)
  }
  const physicalExtracts = extracts.map(extract => {
    const counts = new Map<string, number>()
    for (const placed of placements) if (placed.file.archive && idPath(placed.file.sourcePath) === idPath(extract.source) && placed.op.action === 'copy') counts.set(placed.file.member, (counts.get(placed.file.member) ?? 0) + 1)
    return { source: extract.source, members: extract.members.filter(member => { const left = counts.get(member) ?? 0; if (!left) return false; counts.set(member, left - 1); return true }) }
  }).filter(extract => extract.members.length)
  const occurrences: PlannedOccurrence[] = []
  const sameOrigin = (a: LogicalFile, b: LogicalFile): boolean => a.sourcePath === b.sourcePath && a.member === b.member && a.ordinal === b.ordinal && keyOf(a.leaf) === keyOf(b.leaf)
  for (const original of originals.sort(fileCmp)) {
    const direct = placements.filter(p => sameOrigin(p.file, original) || (!original.archive && p.file.sourcePath === original.sourcePath && keyOf(p.file.leaf) === keyOf(original.leaf)))
    const matching = direct.length ? direct : placements.filter(p => keyOf(p.file.leaf) === keyOf(original.leaf)).sort((a, b) => cmp(a.unit.id, b.unit.id) || cmp(a.op.id, b.op.id)).slice(0, 1)
    for (const placed of matching.length ? matching : [null]) {
      occurrences.push({ id: `occ-${hash([original.sourcePath, original.member, original.ordinal, original.leaf.key, placed?.unit.id ?? null])}`, unitId: placed?.unit.id ?? null,
        copyOpId: placed?.op.id ?? null, sourcePath: original.sourcePath, relPath: original.member, localPath: original.leaf.localPath,
        key: { ...original.leaf.key }, blobId: original.leaf.blobId ?? null, chain: original.leaf.chain,
        kind: original.archive && !(original.leaf.kind === 'opaque' && !original.leaf.chain.length) ? (skipped.has(idPath(original.sourcePath)) ? 'skipped-archive' : placed && placed.op.action === 'copy' && sameOrigin(placed.file, original) ? 'extracted' : 'archived-copy') : 'loose', existingAssetIds: placed?.refs ?? [] })
      if (placed) placed.unit.sources = uniq([...placed.unit.sources, original.sourcePath])
    }
  }
  const allKnown = new Map<string, Set<string>>()
  for (const original of originals) if (original.leaf.blobId) { const set = allKnown.get(keyOf(original.leaf)) ?? new Set<string>(); set.add(original.leaf.blobId); allKnown.set(keyOf(original.leaf), set) }
  for (const [key, identities] of allKnown) if (identities.size > 1) reviews.push({ id: `review-${hash(['collision', key, [...identities].sort(cmp)])}`, kind: 'content-collision', sourcePath: root, state: 'pending', matches: [], candidateBlobIds: [...identities].sort(cmp) })
  const cacheKeys = uniq(sources.flatMap(s => [...(s.closure.cacheKeys ?? []), ...s.closure.leaves.flatMap(l => l.cacheKey ? [l.cacheKey] : [])]))
  if (cacheKeys.some(k => !shaPattern.test(k))) throw new Error('Invalid cache reference')
  const uniquePhysical = new Map(placements.filter(p => p.op.action === 'copy').map(p => [p.op.blobId ?? p.op.id, p.op.key.size]))
  const totalOriginalBytes = originals.reduce((n, o) => n + o.leaf.key.size, 0), plannedPhysicalBytes = [...uniquePhysical.values()].reduce((n, s) => n + s, 0)
  const plan: PreparedIntakePlan = { schemaVersion: INTAKE_PLAN_VERSION, id: '', scanRoot: root, libraryRoot,
    units: units.sort((a, b) => cmp(a.relativeRoot, b.relativeRoot)),
    skips: trustedSkips.map(s => ({ entry: s.scope === 'leaf' ? s.leaf?.localPath ?? `${s.sourcePath}/${s.leaf?.relPath ?? ''}` : s.sourcePath, reason: s.reason, evidence: s.evidence, coveredBy: s.coveredBy, scope: s.scope, requiresByteReview: s.requiresByteReview, reviewMatches: s.reviewMatches })),
    extracts: physicalExtracts.sort((a, b) => cmp(a.source, b.source)), cacheKeys, warnings: uniq(warnings),
    stats: { sourceFiles: closureIndex.sourceFileCount ?? loose.size + groups.size, archives: groups.size, leafCount: placements.length, dedupSavedBytes: Math.max(0, totalOriginalBytes - plannedPhysicalBytes) },
    occurrences: occurrences.sort((a, b) => cmp(a.id, b.id)), reviews: [...new Map(reviews.map(r => [r.id, r])).values()].sort((a, b) => cmp(a.id, b.id)),
    blocked: [...new Map(blocked.map(b => [JSON.stringify(b), b])).values()].sort((a, b) => cmp(a.sourcePath, b.sourcePath) || cmp(a.path, b.path) || cmp(a.reason, b.reason)) }
  plan.id = `plan-${hash(plan)}`
  return plan
}
