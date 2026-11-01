import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type { HealthReport } from '../../shared/types'
import type { ClosurePayload, LeafRef } from '../../shared/intake'
import { intakeBudget } from '../../shared/constants'
import { buildClosure } from '../intake/closure'
import { ExpandCache } from '../intake/expandCache'
import { fileIdentity } from '../intake/identity'
import { computeCoverage, type ClosureSource } from '../intake/match'
import { probeFile } from '../unpack/magic'

type Stray = HealthReport['strays'][number]
export interface StrayCoverageOptions {
  cacheNamespace?: string
  cacheRoot?: string // Dedicated OS-temp subtree for sandbox verification.
  extraBackendDirs?: string[]
  signal?: AbortSignal
}
export interface StrayCoverageResult { items: Stray[]; warnings: string[] }
const canonical = (p: string): string => { const value = path.resolve(p).replace(/\\/g, '/'); return process.platform === 'win32' ? value.toLowerCase() : value }
const ordinaryArchive = async (file: string): Promise<boolean> => path.extname(file).toLowerCase() !== '.unitypackage' && (await probeFile(file)).isArchive

/** A directory contributes only actual loose bytes, never its own archive members. */
async function looseClosure(item: Stray, opts: StrayCoverageOptions): Promise<ClosurePayload> {
  const leaves: LeafRef[] = [], unreadable: { path: string; reason: string }[] = []
  let visited = 0
  async function walk(file: string, rel: string, depth: number): Promise<void> {
    opts.signal?.throwIfAborted()
    if (++visited > 20000) throw new Error('loose-entry-budget')
    try {
      const st = await fs.promises.lstat(file)
      if (st.isSymbolicLink()) throw new Error('reparse-point-not-followed')
      if (st.isDirectory()) {
        if (depth > 32) throw new Error('loose-depth-budget')
        for (const child of (await fs.promises.readdir(file)).sort()) await walk(path.join(file, child), rel ? `${rel}/${child}` : child, depth + 1)
      } else if (st.isFile()) {
        if (await ordinaryArchive(file)) return
        const identity = await fileIdentity(file, opts.signal)
        leaves.push({ key: identity.key, blobId: identity.sha256, relPath: rel, localPath: file, chain: [], kind: /\.unitypackage$/i.test(rel) ? 'unitypackage' : 'file' })
      } else throw new Error('not-regular-file')
    } catch (error) {
      opts.signal?.throwIfAborted()
      unreadable.push({ path: rel, reason: error instanceof Error ? error.message : String(error) })
    }
  }
  try { await walk(item.path, item.isDir ? '' : path.basename(item.path), 0) }
  catch (error) { opts.signal?.throwIfAborted(); unreadable.push({ path: item.path, reason: String(error) }) }
  return { leaves, opaque: unreadable.length > 0, unreadable, warnings: unreadable.map(u => `${item.path}/${u.path}: ${u.reason}`) }
}

/** Pure report projection. Names only break ties; full content evidence decides coverage. */
export function projectStrayCoverage(items: Stray[], loose: ClosureSource[], archives: ClosureSource[]): StrayCoverageResult {
  const out = new Map(items.map(item => [canonical(item.path), { ...item }]))
  const warnings = [...loose, ...archives].flatMap(s => s.closure.warnings)
  for (const archive of archives) {
    if (archive.closure.opaque || !archive.closure.leaves.length) continue
    const evidence = computeCoverage(archive.closure, loose, { sourcePath: archive.sourcePath })
    if (evidence.coveredCount !== evidence.totalCount) continue
    // CRC/size collisions, missing full identities, or changed evidence must never hide an archive.
    const candidates = new Map(loose.map(s => [canonical(s.sourcePath), s]))
    const available = [...archive.closure.leaves]
    let verified = true
    for (const match of evidence.matches) {
      const targetIndex = available.findIndex(l => l.relPath === match.leafRelPath && l.key.size === match.key.size && l.key.crc32 === match.key.crc32)
      const target = available[targetIndex]
      if (targetIndex >= 0) available.splice(targetIndex, 1)
      const covering = candidates.get(canonical(match.coveringPath))?.closure.leaves.find(l => l.relPath === match.coveringRelPath && l.key.size === match.key.size && l.key.crc32 === match.key.crc32)
      if (!target?.blobId || target.blobId !== covering?.blobId) { verified = false; break }
    }
    if (!verified) { warnings.push(`${archive.sourcePath}: content-identity-not-verified; archive retained`); continue }
    const coveredBy = [...new Set(evidence.matches.map(m => canonical(m.coveringPath)))]
    if (coveredBy.some(key => !out.has(key))) continue
    const original = out.get(canonical(archive.sourcePath))
    if (!original) continue
    for (const key of coveredBy) {
      const representative = out.get(key)!
      representative.coveredArchives = [...(representative.coveredArchives ?? []), { path: original.path, sizeBytes: original.sizeBytes, evidence }]
    }
    out.delete(canonical(archive.sourcePath))
  }
  return { items: [...out.values()].sort((a, b) => b.sizeBytes - a.sizeBytes || a.path.localeCompare(b.path)), warnings: [...new Set(warnings)].sort() }
}

/** Reads source/library bytes only. Temporary container expansions use the isolated intake cache. */
export async function matchStrayContents(items: Stray[], opts: StrayCoverageOptions = {}): Promise<StrayCoverageResult> {
  const archiveItems: Stray[] = [], looseItems: Stray[] = [], warnings: string[] = []
  for (const item of items) {
    opts.signal?.throwIfAborted()
    try {
      const st = await fs.promises.lstat(item.path)
      if (st.isSymbolicLink()) { warnings.push(`${item.path}: reparse-point-not-followed`); continue }
      if (!item.isDir && await ordinaryArchive(item.path)) archiveItems.push(item)
      else looseItems.push(item)
    } catch (error) { warnings.push(`${item.path}: ${String(error)}`) }
  }
  if (!archiveItems.length || !looseItems.length) return { items, warnings }
  const cache = new ExpandCache({ namespace: opts.cacheNamespace, root: opts.cacheRoot }), ownerId = `health:${randomUUID()}`
  try {
    const loose: ClosureSource[] = []
    for (const item of looseItems) loose.push({ sourcePath: item.path, kind: item.isDir ? 'directory' : 'loose', closure: await looseClosure(item, opts) })
    const archives: ClosureSource[] = []
    for (const item of archiveItems) {
      const closure = await buildClosure(item.path, { ...intakeBudget(item.sizeBytes), cache, ownerId, signal: opts.signal, extraBackendDirs: opts.extraBackendDirs })
      archives.push({ sourcePath: item.path, kind: 'archive', closure })
    }
    const result = projectStrayCoverage(items, loose, archives)
    return { items: result.items, warnings: [...new Set([...warnings, ...result.warnings])].sort() }
  } finally { await cache.release(ownerId) }
}
