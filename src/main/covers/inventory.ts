import type { Db } from '../db'
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import type { Readable } from 'node:stream'
import * as tar from 'tar'
import yauzl from 'yauzl'
import { getAsset } from '../db/repos/asset'
import { normalizeForCompare, safeJoin } from '../security/paths'
import { decodeZipName, normalizeEntryPath } from '../unpack/encoding'
import { probeFile } from '../unpack/magic'
import { memberMatches } from '../unpack/entryMatch'
import { isJunkRelPath } from '../../shared/junk'
import type { AssetRow } from '../../shared/types'

export interface CoverSource { guid: string; memberPath: string | null }
export interface CoverSourceInventory { sources: CoverSource[]; warnings: string[]; truncated: boolean }

const MAX_SOURCES = 10_000
const MAX_MEMBERS = 32
const MAX_SCAN_ENTRIES = 20_000
const MAX_LOGS = 200
const MAX_JSON_BYTES = 1024 * 1024
const MAX_PACKAGE_BYTES = 512 * 1024 * 1024
const MAX_EXPANDED_BYTES = 2 * 1024 * 1024 * 1024
const MAX_PATH_BYTES = 4096
const MAX_DEPTH = 8
const SCAN_MS = 45_000
const PACKAGE_RE = /\.unitypackage$/i
const ARCHIVE_RE = /\.(zip|rar|7z|tar|gz|tgz|bz2|xz|zst)$/i
const RENDERABLE_RE = /\.(prefab|fbx|obj|blend)$/i

interface Scan {
  sources: Map<string, CoverSource>
  renderable: Set<string>
  warnings: Set<string>
  truncated: boolean
  entries: number
  members: number
  packageBytes: number
  expandedBytes: number
  successfulPackages: number
  recordedSource: string | null
  deadline: number
  signal?: AbortSignal
}
interface CardScope {
  owners: Set<string>
  ancestors: Set<string>
  ancestorPaths: Set<string>
  identities: Array<{ raw: string; contextual: string[] }>
}
function sourceIdentity(file: string): string {
  try { return normalizeForCompare(fs.realpathSync(file)) } catch { return normalizeForCompare(path.resolve(file)) }
}
/** Only selected descendants are versions/items; parents and their siblings never own their cache. */
function cardScope(db: Db, asset: AssetRow, scan: Scan): CardScope {
  const ancestors: AssetRow[] = []
  let parent = asset.parent_asset_id
  const visited = new Set([asset.id])
  while (parent && ancestors.length < MAX_DEPTH) {
    if (visited.has(parent)) { limit(scan); break }
    visited.add(parent)
    const row = getAsset(db, parent)
    if (!row) break
    ancestors.push(row); parent = row.parent_asset_id
  }
  if (parent && ancestors.length >= MAX_DEPTH) limit(scan)
  const scope: CardScope = { owners: new Set(), ancestors: new Set(ancestors.map(row => row.id)),
    ancestorPaths: new Set(ancestors.flatMap(row => [row.library_path, row.source_path])
      .filter((file): file is string => !!file).map(sourceIdentity)), identities: [] }
  const visit = (row: AssetRow, contexts: string[], depth: number): void => {
    if (scope.owners.size >= MAX_LOGS || depth >= MAX_DEPTH) { limit(scan); return }
    if (scope.owners.has(row.id)) { limit(scan); return }
    scope.owners.add(row.id)
    const children = db.prepare(`SELECT * FROM asset WHERE parent_asset_id = ? AND attachment_kind IS NULL LIMIT ?`)
      .all(row.id, MAX_LOGS + 1) as AssetRow[]
    if (children.length > MAX_LOGS) limit(scan)
    if (children.length) {
      for (const child of children.slice(0, MAX_LOGS)) visit(child, [...contexts, row.raw_name], depth + 1)
    } else {
      const raw = normalizeEntryPath(row.raw_name)
      const contextual = contexts.map(normalizeEntryPath).filter(name => name && !ARCHIVE_RE.test(name) && !PACKAGE_RE.test(name))
      scope.identities.push({ raw, contextual: contextual.length ? [contextual.join('/') + '/' + raw] : [] })
    }
  }
  visit(asset, ancestors.slice().reverse().filter(row => row.parent_asset_id !== null).map(row => row.raw_name), 0)
  return scope
}
/** Full paths/directory boundaries first; stored basenames require a complete, unique metadata match. */
function scopedMembers(scan: Scan, scope: CardScope, members: string[]): Set<string> | null {
  const selected = new Set<string>()
  const normalized = (value: string): string => normalizeEntryPath(value).toLowerCase()
  for (const identity of scope.identities) {
    const raw = normalized(identity.raw)
    if (!raw || raw.length > MAX_PATH_BYTES || !safeJoin(process.cwd(), raw)) { scan.warnings.add('covers.sourceUnreadable'); return null }
    const isPackage = PACKAGE_RE.test(raw)
    let hits: string[] = []
    // Only an explicitly stored relative path proves a location. Paths built
    // from parent basenames must be unique across the complete ZIP listing,
    // including the root match and matches below another directory.
    if (raw.includes('/')) {
      hits = members.filter(member => isPackage ? normalized(member) === raw : memberMatches(member, raw))
    } else {
      for (const value of identity.contextual) {
        const context = normalized(value)
        if (isPackage) {
          const matches = members.filter(member => normalized(member) === context || normalized(member).endsWith('/' + context))
          if (matches.length > 1) { scan.warnings.add('covers.sourceUnreadable'); return null }
          if (matches.length === 1) { hits = matches; break }
        } else {
          const prefixes = new Set<string>()
          const contextParts = context.split('/')
          for (const member of members) {
            const parts = normalized(member).split('/')
            for (let i = 0; i + contextParts.length < parts.length; i++) {
              if (parts.slice(i, i + contextParts.length).join('/') === context) prefixes.add(parts.slice(0, i + contextParts.length).join('/'))
            }
          }
          if (prefixes.size > 1) { scan.warnings.add('covers.sourceUnreadable'); return null }
          if (prefixes.size === 1) { hits = members.filter(member => memberMatches(normalized(member), [...prefixes][0])); break }
        }
      }
      if (!hits.length && isPackage) hits = members.filter(member => normalized(member).split('/').pop() === raw)
      else if (!hits.length) {
        const prefixes = new Set<string>()
        for (const member of members) {
          const parts = normalized(member).split('/')
          for (let i = 0; i < parts.length - 1; i++) if (parts[i] === raw) prefixes.add(parts.slice(0, i + 1).join('/'))
        }
        if (prefixes.size === 1) hits = members.filter(member => memberMatches(member, [...prefixes][0]))
      }
    }
    if (!hits.length || (isPackage && hits.length !== 1)) { scan.warnings.add('covers.sourceUnreadable'); return null }
    for (const hit of hits) selected.add(normalized(hit))
  }
  return selected
}
function ownedMemberIdentity(scope: CardScope, member: string): boolean {
  const actual = normalizeEntryPath(member).toLowerCase()
  return scope.identities.some(identity => {
    const raw = normalizeEntryPath(identity.raw).toLowerCase()
    if (!raw || !safeJoin(process.cwd(), raw)) return false
    if (raw.includes('/')) return PACKAGE_RE.test(raw) ? actual === raw : memberMatches(actual, raw)
    if (PACKAGE_RE.test(raw)) {
      if (actual === raw) return true
      if (identity.contextual.length) return identity.contextual.some(context => actual === context.toLowerCase() || actual.endsWith('/' + context.toLowerCase()))
      return actual.split('/').pop() === raw
    }
    return memberMatches(actual, raw)
  })
}
function limit(scan: Scan): void { scan.truncated = true; scan.warnings.add('covers.inventoryLimited') }
function check(scan: Scan): boolean {
  if (scan.signal?.aborted) throw new Error('covers.cancelled')
  if (Date.now() < scan.deadline && scan.entries <= MAX_SCAN_ENTRIES &&
      scan.packageBytes <= MAX_PACKAGE_BYTES && scan.expandedBytes <= MAX_EXPANDED_BYTES) return true
  limit(scan); return false
}
function guid(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const value = raw.trim().toLowerCase()
  return /^[a-f0-9]{32}$/.test(value) ? value : null
}
function add(scan: Scan, raw: unknown, memberPath: string | null, renderable = false): void {
  const value = guid(raw)
  if (!value) return
  if (renderable) scan.renderable.add(value)
  const key = value + '\n' + (memberPath ?? '')
  if (scan.sources.has(key)) return
  if (scan.sources.size >= MAX_SOURCES) { limit(scan); return }
  scan.sources.set(key, { guid: value, memberPath })
}
function importGuids(scan: Scan, json: string | null): unknown[] {
  if (!json) return []
  if (json.length > MAX_JSON_BYTES) { limit(scan); return [] }
  try {
    const values: unknown = JSON.parse(json)
    if (!Array.isArray(values)) throw new Error()
    if (values.length > MAX_SOURCES) limit(scan)
    return values.slice(0, MAX_SOURCES)
  } catch { scan.warnings.add('covers.sourceUnreadable'); return [] }
}

/**
 * Read original source metadata only. Import GUID facts remain usable when their
 * temporary extracted package has disappeared; unitypackage_path is never opened.
 * ZIP/package streams are bounded and never extract or install project contents.
 */
export async function collectCoverSources(
  db: Db, assetId: string, projectId: string, signal?: AbortSignal
): Promise<CoverSourceInventory> {
  if (signal?.aborted) throw new Error('covers.cancelled')
  const asset = getAsset(db, assetId)
  if (!asset) throw new Error('covers.assetMissing')
  const scan: Scan = { sources: new Map(), renderable: new Set(), warnings: new Set(), truncated: false,
    entries: 0, members: 0, packageBytes: 0, expandedBytes: 0, successfulPackages: 0,
    recordedSource: asset.source_path ? normalizeForCompare(path.resolve(asset.source_path)) : null,
    deadline: Date.now() + SCAN_MS, signal }
  const scope = cardScope(db, asset, scan)
  const relevantIds = [...new Set([...scope.owners, ...scope.ancestors])]
  const placeholders = relevantIds.map(() => '?').join(',')
  const logs = db.prepare(`SELECT asset_id, container_asset_id, member_rel_path,
      substr(created_guids_json, 1, ?) AS created_guids_json,
      substr(overwritten_json, 1, ?) AS overwritten_json
    FROM import_log WHERE project_id = ? AND kind = 'import' AND status = 'ok'
      AND (asset_id IN (${placeholders}) OR container_asset_id IN (${placeholders})) ORDER BY rowid DESC LIMIT ?`)
    .all(MAX_JSON_BYTES + 1, MAX_JSON_BYTES + 1, projectId, ...relevantIds, ...relevantIds, MAX_LOGS + 1) as
    Array<{ asset_id: string | null; container_asset_id: string | null; member_rel_path: string | null;
      created_guids_json: string | null; overwritten_json: string | null }>
  if (logs.length > MAX_LOGS) limit(scan)
  // Cached rows have no member column. Recover archive provenance before merging
  // this fallback, and prioritize model/prefab GUIDs over textures and scripts.
  const owners = [...scope.owners]
  const cached = db.prepare(`SELECT guid, unity_path FROM package_entry WHERE asset_id IN (${owners.map(() => '?').join(',')})
    ORDER BY CASE WHEN entry_kind IN ('prefab', 'fbx') THEN 0 ELSE 1 END, id LIMIT ?`)
    .all(...owners, MAX_SOURCES + 1) as Array<{ guid: string; unity_path: string }>
  if (cached.length > MAX_SOURCES) limit(scan)
  for (const row of cached) if (RENDERABLE_RE.test(row.unity_path)) {
    const value = guid(row.guid); if (value) scan.renderable.add(value)
  }

  let restricted = [asset.library_path, asset.source_path].some(file => !!file && ARCHIVE_RE.test(file) && scope.ancestorPaths.has(sourceIdentity(file)))
  const selectedMembers = new Set<string>()
  let scopeMetadataAvailable = false
  let foundSource = false
  for (const file of [...new Set([asset.library_path, asset.source_path].filter((p): p is string => !!p))]) {
    if (!check(scan)) break
    let stat: fs.Stats
    try { stat = await fs.promises.lstat(file) } catch { scan.warnings.add('covers.sourceUnavailable'); continue }
    if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile())) {
      scan.warnings.add('covers.sourceUnavailable'); continue
    }
    foundSource = true
    const successfulBefore = scan.successfulPackages
    if (stat.isDirectory()) await walkDirectory(scan, file, file, 0)
    else if (PACKAGE_RE.test(file)) await readPackageFile(scan, file, null)
    else {
      const format = await probeFile(file)
      if (!check(scan)) break
      if (format.format === 'zip' && scope.ancestorPaths.has(sourceIdentity(file))) {
        restricted = true
        const members: string[] = []
        const complete = await readZip(scan, file, undefined, members)
        if (!check(scan)) { scan.warnings.add('covers.sourceUnreadable'); break }
        if (!complete) { scan.warnings.add('covers.sourceUnreadable'); continue }
        scopeMetadataAvailable = true
        const selected = scopedMembers(scan, scope, members)
        if (selected) {
          for (const member of selected) selectedMembers.add(member)
          await readZip(scan, file, selected)
        }
      } else if (format.format === 'zip') await readZip(scan, file)
      else scan.warnings.add('covers.sourceUnsupported')
    }
    // Archived directories can contain only their original ZIP. A directory
    // existing does not mean that package metadata has actually been read.
    if (scan.successfulPackages > successfulBefore) break
  }
  check(scan)
  for (const row of logs.slice(0, MAX_LOGS)) {
    const owned = row.asset_id !== null ? scope.owners.has(row.asset_id) : !!row.container_asset_id && scope.owners.has(row.container_asset_id)
    const ancestral = restricted && !!row.container_asset_id && scope.ancestors.has(row.container_asset_id) &&
      (row.asset_id === null || scope.ancestors.has(row.asset_id))
    if (!owned && !ancestral) continue
    let member: string | null = null
    if (row.member_rel_path) {
      member = normalizeEntryPath(row.member_rel_path)
      if (!safeJoin(process.cwd(), member)) { scan.warnings.add('covers.sourceUnreadable'); continue }
      const provenOwnedFallback = owned && row.asset_id !== null && !scopeMetadataAvailable && ownedMemberIdentity(scope, member)
      if (restricted && !selectedMembers.has(member.toLowerCase()) && !provenOwnedFallback) {
        if (owned) scan.warnings.add('covers.sourceUnreadable')
        continue
      }
    } else if (ancestral) continue
    for (const value of [...importGuids(scan, row.created_guids_json), ...importGuids(scan, row.overwritten_json)]) add(scan, value, member)
  }
  const recovered = new Set([...scan.sources.values()].filter(s => s.memberPath !== null).map(s => s.guid))
  for (const row of cached.slice(0, MAX_SOURCES)) {
    const value = guid(row.guid)
    if (value && !recovered.has(value)) add(scan, value, null, RENDERABLE_RE.test(row.unity_path))
  }
  if (!foundSource && !scan.sources.size) scan.warnings.add('covers.sourceUnavailable')
  const sources = [...scan.sources.values()].sort((a, b) => Number(scan.renderable.has(b.guid)) - Number(scan.renderable.has(a.guid)))
  return { sources, warnings: [...scan.warnings], truncated: scan.truncated }
}

async function walkDirectory(scan: Scan, root: string, dir: string, depth: number): Promise<void> {
  if (!check(scan)) return
  let entries: fs.Dir
  try { entries = await fs.promises.opendir(dir) } catch { scan.warnings.add('covers.sourceUnreadable'); return }
  for await (const entry of entries) {
    if (!check(scan)) return
    if (++scan.entries > MAX_SCAN_ENTRIES) { limit(scan); return }
    if (entry.isSymbolicLink()) continue
    const rel = normalizeEntryPath(path.relative(root, path.join(dir, entry.name)))
    if (isJunkRelPath(rel)) continue
    const full = safeJoin(root, rel)
    if (!full) { scan.warnings.add('covers.sourceUnreadable'); continue }
    if (entry.isDirectory()) {
      if (depth + 1 >= MAX_DEPTH) { limit(scan); continue }
      await walkDirectory(scan, root, full, depth + 1)
    } else if (entry.isFile() && PACKAGE_RE.test(rel)) {
      if (scan.members >= MAX_MEMBERS) { limit(scan); return }
      await readPackageFile(scan, full, rel)
    } else if (entry.isFile() && ARCHIVE_RE.test(rel) && normalizeForCompare(path.resolve(full)) !== scan.recordedSource) {
      scan.warnings.add('covers.sourceUnsupported')
    }
  }
}

async function readPackageFile(scan: Scan, file: string, memberPath: string | null): Promise<void> {
  if (!check(scan)) return
  let stat: fs.Stats
  try { stat = await fs.promises.lstat(file) } catch { scan.warnings.add('covers.sourceUnavailable'); return }
  if (!stat.isFile() || stat.isSymbolicLink()) { scan.warnings.add('covers.sourceUnavailable'); return }
  if (stat.size > MAX_PACKAGE_BYTES || scan.members >= MAX_MEMBERS) { limit(scan); return }
  scan.members++
  const result = await readPackage(scan, fs.createReadStream(file))
  for (const [value, renderable] of result) add(scan, value, memberPath, renderable)
}

/** Only pathname text is buffered; large asset bodies pass through and are discarded. */
function readPackage(scan: Scan, input: Readable): Promise<Map<string, boolean>> {
  return new Promise((resolve, reject) => {
    const result = new Map<string, boolean>()
    const gunzip = zlib.createGunzip()
    let settled = false
    let timer: NodeJS.Timeout | undefined
    const finish = (failure?: 'unreadable' | 'limited' | 'cancelled'): void => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      scan.signal?.removeEventListener('abort', abort)
      input.unpipe(gunzip); gunzip.unpipe(parser)
      input.destroy(); gunzip.destroy()
      if (failure) (parser as unknown as { abort(error: Error): void }).abort(new Error('Source scan stopped'))
      if (failure === 'cancelled') { reject(new Error('covers.cancelled')); return }
      if (failure === 'limited') limit(scan)
      if (failure === 'unreadable') { scan.warnings.add('covers.sourceUnreadable'); result.clear() }
      if (result.size) scan.successfulPackages++
      resolve(result)
    }
    const abort = (): void => finish('cancelled')
    const parser = new tar.Parse({
      strict: false,
      maxMetaEntrySize: MAX_PATH_BYTES,
      onentry(entry: tar.ReadEntry): void {
        if (settled) { entry.resume(); return }
        if (++scan.entries > MAX_SCAN_ENTRIES) { entry.resume(); finish('limited'); return }
        const parts = normalizeEntryPath(entry.path).split('/').filter(s => s && s !== '.')
        const owner = guid(parts[0])
        if (!owner || parts.length !== 2 || parts[1] !== 'pathname' || !['File', 'OldFile'].includes(String(entry.type))) {
          entry.resume(); return
        }
        if ((entry.size ?? 0) > MAX_PATH_BYTES) { scan.warnings.add('covers.sourceUnreadable'); entry.resume(); return }
        let text = '', bytes = 0
        entry.on('data', (chunk: Buffer) => {
          bytes += chunk.length
          if (bytes <= MAX_PATH_BYTES) text += chunk.toString('utf8')
        })
        entry.on('end', () => {
          if (settled) return
          const unityPath = text.replace(/^\uFEFF/, '').trim().replace(/\\/g, '/')
          if (bytes > MAX_PATH_BYTES || !/^Assets\//.test(unityPath) || !safeJoin(process.cwd(), unityPath)) return
          if (!result.has(owner) && result.size >= MAX_SOURCES) { finish('limited'); return }
          result.set(owner, RENDERABLE_RE.test(unityPath))
        })
        entry.resume()
      }
    } as tar.ParseOptions & { maxMetaEntrySize: number })
    const events = parser as unknown as NodeJS.EventEmitter
    events.on('error', () => finish('unreadable'))
    events.on('warn', (code: string) => { if (code === 'TAR_BAD_ARCHIVE') finish('unreadable') })
    parser.on('end', () => finish(result.size ? undefined : 'unreadable'))
    input.on('error', () => finish('unreadable'))
    gunzip.on('error', () => finish('unreadable'))
    input.on('data', (chunk: Buffer) => {
      scan.packageBytes += chunk.length
      if (scan.packageBytes > MAX_PACKAGE_BYTES) finish('limited')
    })
    gunzip.on('data', (chunk: Buffer) => {
      scan.expandedBytes += chunk.length
      if (scan.expandedBytes > MAX_EXPANDED_BYTES) finish('limited')
    })
    scan.signal?.addEventListener('abort', abort, { once: true })
    if (scan.signal?.aborted) { abort(); return }
    timer = setTimeout(() => finish('limited'), Math.max(1, scan.deadline - Date.now()))
    input.pipe(gunzip).pipe(parser)
  })
}

/** ZIP uses existing filename decoding/safety rules, with lazy entries and no extraction. */
function readZip(scan: Scan, file: string, selected?: Set<string>, listing?: string[]): Promise<boolean> {
  return new Promise((resolve, reject) => {
    let zip: yauzl.ZipFile | undefined
    let active: Readable | undefined
    let settled = false
    let completeListing = true
    const finish = (cancelled = false, complete = false): void => {
      if (settled) return
      settled = true; clearTimeout(timer)
      scan.signal?.removeEventListener('abort', abort)
      active?.destroy()
      try { zip?.close() } catch { /* A damaged ZIP may have closed already. */ }
      if (cancelled) reject(new Error('covers.cancelled')); else resolve(complete)
    }
    const abort = (): void => finish(true)
    const timer = setTimeout(() => { limit(scan); finish() }, Math.max(1, scan.deadline - Date.now()))
    scan.signal?.addEventListener('abort', abort, { once: true })
    if (scan.signal?.aborted) { abort(); return }
    yauzl.open(file, { lazyEntries: true, decodeStrings: false, autoClose: false, validateEntrySizes: true }, (error, opened) => {
      if (settled) { opened?.close(); return }
      if (error || !opened) { scan.warnings.add('covers.sourceUnreadable'); finish(); return }
      zip = opened
      zip.on('error', () => { scan.warnings.add('covers.sourceUnreadable'); finish() })
      zip.on('end', () => finish(false, completeListing))
      zip.on('entry', (entry: yauzl.Entry) => {
        if (settled) return
        if (++scan.entries > MAX_SCAN_ENTRIES) { limit(scan); finish(); return }
        const raw = entry.fileName as unknown as Buffer
        if (raw.length > MAX_PATH_BYTES) {
          completeListing = false; scan.warnings.add('covers.sourceUnreadable'); opened.readEntry(); return
        }
        const name = normalizeEntryPath(decodeZipName(raw, (entry.generalPurposeBitFlag & 0x800) !== 0).name)
        if (Buffer.byteLength(name, 'utf8') > MAX_PATH_BYTES) {
          completeListing = false; scan.warnings.add('covers.sourceUnreadable'); opened.readEntry(); return
        }
        if (/\/$/.test(name) || isJunkRelPath(name)) { opened.readEntry(); return }
        if (!PACKAGE_RE.test(name)) {
          if (!selected && !listing && ARCHIVE_RE.test(name)) scan.warnings.add('covers.sourceUnsupported')
          opened.readEntry(); return
        }
        if (!safeJoin(process.cwd(), name)) {
          completeListing = false; scan.warnings.add('covers.sourceUnreadable'); opened.readEntry(); return
        }
        if (listing) { listing.push(name); opened.readEntry(); return }
        if (selected && !selected.has(name.toLowerCase())) { opened.readEntry(); return }
        if (entry.isEncrypted()) { scan.warnings.add('covers.sourceEncrypted'); opened.readEntry(); return }
        if (scan.members >= MAX_MEMBERS) { limit(scan); finish(); return }
        if (entry.uncompressedSize > MAX_PACKAGE_BYTES) { limit(scan); opened.readEntry(); return }
        scan.members++
        opened.openReadStream(entry, (streamError, stream) => {
          if (settled) { stream?.destroy(); return }
          if (streamError || !stream) { scan.warnings.add('covers.sourceUnreadable'); opened.readEntry(); return }
          active = stream
          void readPackage(scan, stream).then(result => {
            active = undefined
            if (settled) return
            for (const [value, renderable] of result) add(scan, value, name, renderable)
            if (!check(scan) || scan.entries > MAX_SCAN_ENTRIES || scan.packageBytes > MAX_PACKAGE_BYTES || scan.expandedBytes > MAX_EXPANDED_BYTES) finish()
            else opened.readEntry()
          }).catch(error => {
            if (settled) return
            if (scan.signal?.aborted || (error instanceof Error && error.message === 'covers.cancelled')) finish(true)
            else { scan.warnings.add('covers.sourceUnreadable'); finish() }
          })
        })
      })
      opened.readEntry()
    })
  })
}
