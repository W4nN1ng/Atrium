import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { createHash } from 'node:crypto'
import { Transform, Writable, type Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import * as tar from 'tar'
import yauzl from 'yauzl'
import type { Db } from '../db'
import { getAsset } from '../db/repos/asset'
import { collectCoverSources } from './inventory'
import { normalizeForCompare, safeJoin } from '../security/paths'
import { decodeZipName, decodeUtf8Strict, normalizeEntryPath } from '../unpack/encoding'
import { isJunkRelPath } from '../../shared/junk'

const MAX_INPUT = 512 * 1024 * 1024
const MAX_EXPANDED = 2 * 1024 * 1024 * 1024
const MAX_PACKAGES = 32
const MAX_ENTRIES = 20_000
const MAX_GUIDS = 10_000
const MAX_PATH = 4096
const MAX_META = 1024 * 1024
const MAX_DEPTH = 8
const HEAD_BYTES = 256
const READ_MS = 45_000
const MARKER = '.atrium-cover-preview.json'
const ALLOWED = new Set(['.prefab', '.fbx', '.obj', '.dae', '.mat', '.png', '.jpg', '.jpeg', '.tga',
  '.psd', '.psb', '.bmp', '.gif', '.tif', '.tiff', '.exr', '.hdr', '.dds', '.ktx', '.ktx2',
  '.shader', '.hlsl', '.cginc', '.hlslinc', '.glslinc', '.compute', '.shadergraph', '.shadersubgraph', '.asset'])
const ASSET_CLASSES = new Set([21, 28, 43, 84, 89, 117, 187, 188])
type Stamp = { path: string; size: number; mtimeMs: number }
interface Part { hash: string; size: number; head: Buffer; text?: Buffer; classes: number[]; hasScript: boolean }
interface Resource { guid: string; unityPath?: string; asset?: Part; meta?: Part }
interface PackageSource { file: string; memberPath: string | null; zipEntry?: yauzl.Entry; resources?: Map<string, Resource>; hash?: string }
interface State {
  signal: AbortSignal
  inputBytes: number
  expandedBytes: number
  entries: number
  packages: number
  sources: Map<string, Stamp>
  ownership: Map<string, Set<string>>
  resources: Map<string, { resource: Resource; source: PackageSource }>
  paths: Map<string, string>
  provenance: Map<string, Set<string>>
  warnings: Set<string>
  destination: string
  files: Set<string>
  directories: Set<string>
  writtenGuids: Set<string>
  done: number
  progress?: (done: number, total: number) => void
}
function fail(code = 'covers.sourceUnreadable'): never { throw new Error(code) }
function check(state: State): void {
  if (state.signal.aborted) throw state.signal.reason instanceof Error ? state.signal.reason : new Error('covers.cancelled')
}
function count(state: State, key: 'inputBytes' | 'expandedBytes' | 'entries' | 'packages', amount: number, max: number): void {
  check(state)
  state[key] += amount
  if (state[key] > max) fail('covers.inventoryLimited')
}
function identity(member: string | null): string { return member === null ? '' : member.toLowerCase() }

/** Check every existing component: realpath alone would follow a junction before detecting it. */
async function noLinks(file: string, code = 'covers.sourceUnreadable'): Promise<void> {
  let current = path.resolve(file)
  for (;;) {
    const stat = await fs.promises.lstat(current)
    if (stat.isSymbolicLink()) fail(code)
    const parent = path.dirname(current)
    if (parent === current) return
    current = parent
  }
}
async function ownedDestination(destination: string): Promise<string> {
  try {
    if (!path.isAbsolute(destination) || path.basename(destination) !== 'Assets') fail('covers.previewOwnership')
    await noLinks(destination, 'covers.previewOwnership')
    const canonical = await fs.promises.realpath(destination)
    const parent = path.dirname(canonical), marker = path.join(parent, MARKER)
    await noLinks(marker, 'covers.previewOwnership')
    const stat = await fs.promises.lstat(marker)
    if (!stat.isFile() || stat.size > 16 * 1024) fail('covers.previewOwnership')
    const parsed = JSON.parse(await fs.promises.readFile(marker, 'utf8')) as Record<string, unknown>
    if (parsed.kind !== 'atrium-package-preview' || parsed.version !== 1 || typeof parsed.projectPath !== 'string' ||
      normalizeForCompare(parsed.projectPath) !== normalizeForCompare(parent) ||
      !(await fs.promises.lstat(canonical)).isDirectory() || (await fs.promises.readdir(canonical)).length) fail('covers.previewOwnership')
    return canonical
  } catch { fail('covers.previewOwnership') }
}
function resourcePath(raw: Buffer): string {
  const text = decodeUtf8Strict(raw)?.replace(/^\uFEFF/, '').trim().replace(/\\/g, '/')
  if (!text || Buffer.byteLength(text) > MAX_PATH || !text.startsWith('Assets/') || !safeJoin(process.cwd(), text)) fail()
  const parts = text.split('/')
  if (parts.length - 1 > MAX_DEPTH) fail('covers.inventoryLimited')
  if (parts.some(part => !part || part === '.' || /[ .]$/.test(part) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) fail()
  return text
}
function validMetadata(resource: Resource): void {
  const meta = resource.meta?.text && decodeUtf8Strict(resource.meta.text)
  if (!meta || !/^fileFormatVersion:\s*2\s*$/m.test(meta)) fail()
  const guids = [...meta.matchAll(/^guid:\s*([a-f0-9]{32})\s*$/gmi)]
  if (guids.length !== 1 || guids[0][1].toLowerCase() !== resource.guid ||
    /^(PluginImporter|ScriptedImporter|MonoImporter):/m.test(meta)) fail()
}
function renderResource(resource: Resource): boolean {
  const ext = path.posix.extname(resource.unityPath!).toLowerCase()
  if (!ALLOWED.has(ext)) return false
  // Renaming executable code does not make it a rendering resource.
  const head = resource.asset!.head
  if (head.subarray(0, 2).toString('ascii') === 'MZ' || head.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46])) ||
    ['feedface', 'feedfacf', 'cefaedfe', 'cffaedfe', 'cafebabe'].includes(head.subarray(0, 4).toString('hex'))) return false
  if (ext !== '.asset') return true
  if (head.subarray(0, 5).toString('ascii') !== '%YAML') return false
  return resource.asset!.classes.length > 0 && resource.asset!.classes.every(id => ASSET_CLASSES.has(id)) && !resource.asset!.hasScript
}
async function sourceStamp(state: State, file: string): Promise<void> {
  check(state)
  await noLinks(file)
  const stat = await fs.promises.lstat(file)
  if (!stat.isFile()) fail()
  if (stat.size > MAX_INPUT) fail('covers.inventoryLimited')
  const prior = state.sources.get(file)
  if (prior && (prior.size !== stat.size || prior.mtimeMs !== stat.mtimeMs)) fail('covers.sourceChanged')
  state.sources.set(file, { path: file, size: stat.size, mtimeMs: stat.mtimeMs })
}
async function verifySources(state: State): Promise<void> {
  for (const file of state.sources.keys()) {
    try { await sourceStamp(state, file) } catch (error) {
      if (state.signal.aborted) throw error
      fail('covers.sourceChanged')
    }
  }
}
function openZip(file: string): Promise<yauzl.ZipFile> {
  return new Promise((resolve, reject) => yauzl.open(file, {
    lazyEntries: true, decodeStrings: false, autoClose: false, validateEntrySizes: true
  }, (error, zip) => error || !zip ? reject(new Error('covers.sourceUnreadable')) : resolve(zip)))
}
function zipName(entry: yauzl.Entry): string {
  const raw = entry.fileName as unknown as Buffer
  if (raw.length > MAX_PATH) fail('covers.inventoryLimited')
  const name = normalizeEntryPath(decodeZipName(raw, (entry.generalPurposeBitFlag & 0x800) !== 0).name)
  if (Buffer.byteLength(name) > MAX_PATH) fail('covers.inventoryLimited')
  if (!safeJoin(process.cwd(), name)) fail()
  if (name.split('/').filter(Boolean).length > MAX_DEPTH) fail('covers.inventoryLimited')
  return name
}
async function listZip(state: State, file: string): Promise<PackageSource[]> {
  await sourceStamp(state, file)
  const zip = await openZip(file), result: PackageSource[] = []
  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (error?: unknown): void => {
      if (settled) return
      settled = true; state.signal.removeEventListener('abort', abort)
      zip.close()
      if (error) reject(error); else resolve(result)
    }
    const abort = (): void => finish(state.signal.reason)
    state.signal.addEventListener('abort', abort, { once: true })
    zip.on('error', () => finish(new Error('covers.sourceUnreadable')))
    zip.on('end', () => finish())
    zip.on('entry', (entry: yauzl.Entry) => {
      try {
        count(state, 'entries', 1, MAX_ENTRIES)
        const name = zipName(entry)
        if (/\.unitypackage$/i.test(name) && state.ownership.has(identity(name))) {
          if (((entry.externalFileAttributes >>> 16) & 0xf000) === 0xa000) fail()
          if (entry.isEncrypted()) fail('covers.sourceEncrypted')
          if (entry.uncompressedSize > MAX_INPUT) fail('covers.inventoryLimited')
          count(state, 'packages', 1, MAX_PACKAGES)
          result.push({ file, memberPath: name, zipEntry: entry })
        }
        zip.readEntry()
      } catch (error) { finish(error) }
    })
    if (state.signal.aborted) abort(); else zip.readEntry()
  })
}
async function findPackages(state: State, file: string): Promise<PackageSource[]> {
  let stat: fs.Stats
  try { stat = await fs.promises.lstat(file) } catch { return [] }
  if (stat.isSymbolicLink()) fail()
  await noLinks(file)
  if (stat.isFile()) {
    if (/\.unitypackage$/i.test(file)) {
      if (!state.ownership.has('')) return []
      await sourceStamp(state, file); count(state, 'packages', 1, MAX_PACKAGES)
      return [{ file, memberPath: null }]
    }
    if (/\.zip$/i.test(file)) return listZip(state, file)
    return []
  }
  if (!stat.isDirectory()) return []
  const result: PackageSource[] = []
  const walk = async (dir: string, depth: number): Promise<void> => {
    for await (const entry of await fs.promises.opendir(dir)) {
      count(state, 'entries', 1, MAX_ENTRIES)
      if (entry.isSymbolicLink()) continue
      const full = path.join(dir, entry.name), rel = normalizeEntryPath(path.relative(file, full))
      if (isJunkRelPath(rel)) continue
      if (entry.isDirectory()) {
        if (depth + 1 >= MAX_DEPTH) fail('covers.inventoryLimited')
        await walk(full, depth + 1)
      } else if (entry.isFile() && /\.unitypackage$/i.test(rel) && state.ownership.has(identity(rel))) {
        await sourceStamp(state, full); count(state, 'packages', 1, MAX_PACKAGES)
        result.push({ file: full, memberPath: rel })
      }
    }
  }
  await walk(file, 0)
  return result
}

async function readPart(entry: tar.ReadEntry, state: State, textLimit?: number, output?: string, signal = state.signal): Promise<Part> {
  const expectedSize = entry.size ?? 0
  if (expectedSize > MAX_EXPANDED) fail('covers.inventoryLimited')
  if (textLimit && expectedSize > textLimit) fail('covers.inventoryLimited')
  const digest = createHash('sha256'), text: Buffer[] = [], head: Buffer[] = []
  const classes = new Set<number>()
  let size = 0, headSize = 0, tail = '', hasScript = false
  const measure = new Transform({ transform(chunk: Buffer, _encoding, callback) {
    try {
      check(state); size += chunk.length; digest.update(chunk)
      if (headSize < HEAD_BYTES) { const prefix = chunk.subarray(0, HEAD_BYTES - headSize); head.push(prefix); headSize += prefix.length }
      // Scan declarations across every chunk, including classes beyond the retained prefix.
      const declarations = tail + chunk.toString('utf8')
      for (const match of declarations.matchAll(/^--- !u!(\d+)\s/gm)) {
        // Eight allowed types plus one rejecting type suffice, regardless of body size.
        if (classes.size <= ASSET_CLASSES.size) classes.add(Number(match[1]))
      }
      if (/\bm_Script\s*:/.test(declarations)) hasScript = true
      tail = declarations.slice(-128)
      if (textLimit) { if (size > textLimit) fail('covers.inventoryLimited'); text.push(chunk) }
      callback(null, chunk)
    } catch (error) { callback(error as Error) }
  } })
  const sink = output ? fs.createWriteStream(output, { flags: 'wx' }) : new Writable({ write(_chunk, _encoding, callback) { callback() } })
  if (output) sink.once('open', () => state.files.add(output))
  await pipeline(entry, measure, sink, { signal })
  if (size !== expectedSize) fail()
  return { hash: digest.digest('hex'), size, head: Buffer.concat(head), classes: [...classes], hasScript,
    ...(textLimit ? { text: Buffer.concat(text) } : {}) }
}
async function outputFile(state: State, unityPath: string): Promise<string> {
  check(state)
  await noLinks(state.destination, 'covers.previewOwnership')
  const relative = unityPath.slice('Assets/'.length), output = safeJoin(state.destination, relative)
  if (!output) fail()
  let current = state.destination
  for (const segment of relative.split('/').slice(0, -1)) {
    current = path.join(current, segment)
    try {
      const stat = await fs.promises.lstat(current)
      if (!stat.isDirectory() || stat.isSymbolicLink() || !state.directories.has(current)) fail('covers.previewOwnership')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      await fs.promises.mkdir(current); state.directories.add(current)
    }
  }
  return output
}
async function packageInput(source: PackageSource): Promise<{ input: Readable; close: () => void }> {
  if (!source.zipEntry) { const input = fs.createReadStream(source.file); return { input, close: () => input.destroy() } }
  const zip = await openZip(source.file)
  try {
    const input = await new Promise<Readable>((resolve, reject) => zip.openReadStream(source.zipEntry!,
      (error, stream) => error || !stream ? reject(new Error('covers.sourceUnreadable')) : resolve(stream)))
    return { input, close: () => { input.destroy(); zip.close() } }
  } catch (error) { zip.close(); throw error }
}
async function readPackage(state: State, source: PackageSource, copying: boolean): Promise<Map<string, Resource>> {
  check(state); await sourceStamp(state, source.file)
  const { input, close } = await packageInput(source), gunzip = zlib.createGunzip()
  const controller = new AbortController()
  const abort = (): void => controller.abort(state.signal.reason)
  state.signal.addEventListener('abort', abort, { once: true })
  if (state.signal.aborted) abort()
  const resources = new Map<string, Resource>(), digest = createHash('sha256')
  const pending = new Set<Promise<void>>()
  let consumer: Promise<void> = Promise.resolve()
  let packageBytes = 0, expandedBytes = 0, packageEntries = 0, failure: unknown
  const measureInput = new Transform({ transform(chunk: Buffer, _encoding, callback) {
    try {
      check(state); packageBytes += chunk.length; digest.update(chunk)
      if (copying) { if (packageBytes > MAX_INPUT) fail('covers.inventoryLimited') }
      else count(state, 'inputBytes', chunk.length, MAX_INPUT)
      callback(null, chunk)
    } catch (error) { callback(error as Error) }
  } })
  const measureExpanded = new Transform({ transform(chunk: Buffer, _encoding, callback) {
    try {
      check(state); expandedBytes += chunk.length
      if (copying) { if (expandedBytes > MAX_EXPANDED) fail('covers.inventoryLimited') }
      else count(state, 'expandedBytes', chunk.length, MAX_EXPANDED)
      callback(null, chunk)
    } catch (error) { callback(error as Error) }
  } })
  const parser = new tar.Parse({ strict: true, maxMetaEntrySize: MAX_PATH, onentry(entry: tar.ReadEntry): void {
    // Small tar entries can finish reading before their asynchronous output closes.
    // Consume them serially to bound streams/listeners and coordinate shared directories.
    const work = consumer.then(async (): Promise<void> => {
      if (failure) throw failure
      check(state)
      if (copying) { if (++packageEntries > MAX_ENTRIES) fail('covers.inventoryLimited') }
      else count(state, 'entries', 1, MAX_ENTRIES)
      if (Buffer.byteLength(entry.path) > MAX_PATH) fail('covers.inventoryLimited')
      if (String(entry.type) === 'Directory' && /^(?:\.\/)*\.?$/.test(entry.path)) { entry.resume(); return }
      if (!safeJoin(process.cwd(), entry.path)) fail()
      const parts = entry.path.replace(/\\/g, '/').split('/').filter(part => part && part !== '.')
      if (['Link', 'SymbolicLink'].includes(String(entry.type))) fail()
      if (String(entry.type) === 'Directory') { entry.resume(); return }
      if (!['File', 'OldFile'].includes(String(entry.type))) fail()
      if (parts.length !== 2 || !/^[a-f0-9]{32}$/i.test(parts[0].trim())) { entry.resume(); return }
      const guid = parts[0].trim().toLowerCase(), leaf = parts[1]
      if (!['asset', 'asset.meta', 'pathname'].includes(leaf)) { entry.resume(); return }
      if (!resources.has(guid) && resources.size >= MAX_GUIDS) fail('covers.inventoryLimited')
      const resource = resources.get(guid) ?? { guid }; resources.set(guid, resource)
      const expected = source.resources?.get(guid)
      const chosen = state.resources.get(guid)
      let output: string | undefined
      if (copying && leaf === 'asset' && expected && chosen?.source === source && !state.writtenGuids.has(guid)) {
        state.writtenGuids.add(guid)
        output = await outputFile(state, expected.unityPath!)
      }
      const part = await readPart(entry, state, leaf === 'pathname' ? MAX_PATH : leaf === 'asset.meta' ? MAX_META : undefined, output, controller.signal)
      if (leaf === 'pathname') {
        const value = resourcePath(part.text!)
        if (resource.unityPath && value !== resource.unityPath) fail('covers.packageConflict')
        resource.unityPath = value
      } else {
        const key = leaf === 'asset' ? 'asset' : 'meta'
        if (resource[key] && part.hash !== resource[key]!.hash) fail('covers.packageConflict')
        resource[key] = part
      }
      if (output) {
        const metaPath = output + '.meta'
        const handle = await fs.promises.open(metaPath, 'wx')
        state.files.add(metaPath)
        try { await handle.writeFile(expected!.meta!.text!) } finally { await handle.close() }
        state.done++; state.progress?.(state.done, state.resources.size); check(state)
      }
    })
    consumer = work.catch(() => undefined)
    pending.add(work)
    void work.catch(error => {
      failure ??= error
      ;(parser as unknown as { abort: (error: Error) => void }).abort(error instanceof Error ? error : new Error('covers.sourceUnreadable'))
    }).finally(() => pending.delete(work))
  } } as tar.ParseOptions & { maxMetaEntrySize: number })
  try {
    // tar.Parse's writable finish can precede entry consumers; await both sides.
    const ended = new Promise<void>((resolve, reject) => {
      parser.on('end', resolve); (parser as unknown as NodeJS.EventEmitter).on('error', reject)
    })
    await Promise.all([pipeline(input, measureInput, gunzip, measureExpanded, parser, { signal: controller.signal }), ended])
    await Promise.all(pending)
    if (failure) throw failure
    check(state)
    const hash = digest.digest('hex')
    if (copying && source.hash !== hash) fail('covers.sourceChanged')
    if (!copying) source.hash = hash
    await sourceStamp(state, source.file)
    return resources
  } catch (error) {
    failure ??= error
    // An upstream read/gzip error can leave the current tar entry incomplete.
    // Abort its consumer before awaiting cleanup, retaining the original failure.
    controller.abort(failure)
    check(state)
    throw failure
  } finally {
    close(); await Promise.allSettled(pending)
    state.signal.removeEventListener('abort', abort)
  }
}
function register(state: State, source: PackageSource): void {
  const owned = state.ownership.get(identity(source.memberPath))!
  for (const resource of source.resources!.values()) {
    if (!resource.unityPath) fail()
    if (!owned.has(resource.guid)) continue
    if (/^folderAsset:\s*yes\s*$/m.test(resource.meta?.text?.toString('utf8') ?? '')) {
      validMetadata(resource)
      continue
    }
    if (!ALLOWED.has(path.posix.extname(resource.unityPath).toLowerCase())) {
      state.warnings.add('covers.packageResourcesExcluded')
      continue
    }
    if (!resource.asset || !resource.meta) fail()
    if (!renderResource(resource)) {
      state.warnings.add(path.posix.extname(resource.unityPath).toLowerCase() === '.asset'
        ? 'covers.packageAssetUnsupported' : 'covers.packageResourcesExcluded')
      continue
    }
    validMetadata(resource)
    const previous = state.resources.get(resource.guid)?.resource
    const pathKey = resource.unityPath.normalize('NFC').toLowerCase(), pathGuid = state.paths.get(pathKey)
    if (pathGuid && pathGuid !== resource.guid) fail('covers.packageConflict')
    if (previous && (previous.unityPath !== resource.unityPath || previous.asset!.hash !== resource.asset.hash ||
      previous.meta!.hash !== resource.meta.hash)) fail('covers.packageConflict')
    if (!previous) {
      if (state.resources.size >= MAX_GUIDS) fail('covers.inventoryLimited')
      state.resources.set(resource.guid, { resource, source }); state.paths.set(pathKey, resource.guid)
    }
    const provenance = state.provenance.get(resource.guid) ?? new Set<string>()
    if (source.memberPath) provenance.add(source.memberPath)
    state.provenance.set(resource.guid, provenance)
  }
}
async function cleanup(state: State): Promise<void> {
  // Never recursively remove a caller directory. Only paths this invocation created qualify.
  for (const file of [...state.files].reverse()) {
    try { await noLinks(path.dirname(file), 'covers.previewOwnership'); await fs.promises.unlink(file) } catch { /* The caller may have removed its owned project. */ }
  }
  for (const dir of [...state.directories].sort((a, b) => b.length - a.length)) {
    try { await noLinks(dir, 'covers.previewOwnership'); await fs.promises.rmdir(dir) } catch { /* Preserve unknown or newly populated directories. */ }
  }
}

/**
 * Prepare only render resources proven to belong to the selected inventory card.
 * Two streaming passes let pathname appear after asset without ever spooling supplier code.
 */
export async function preparePackageSources(
  db: Db, assetId: string, destination: string, signal?: AbortSignal,
  progress?: (done: number, total: number) => void
): Promise<{ guids: string[]; memberPaths: Record<string, string[]>; warnings: string[]; fingerprint: string; sourceFiles?: Stamp[] }> {
  const controller = new AbortController()
  const abort = (): void => controller.abort(new Error('covers.cancelled'))
  signal?.addEventListener('abort', abort, { once: true })
  if (signal?.aborted) abort()
  const timer = setTimeout(() => controller.abort(new Error('covers.inventoryLimited')), READ_MS)
  const state: State = { signal: controller.signal, inputBytes: 0, expandedBytes: 0, entries: 0, packages: 0,
    sources: new Map(), ownership: new Map(), resources: new Map(), paths: new Map(), provenance: new Map(), warnings: new Set(),
    destination: '', files: new Set(), directories: new Set(), writtenGuids: new Set(), done: 0, progress }
  try {
    check(state); state.destination = await ownedDestination(destination)
    const asset = getAsset(db, assetId)
    if (!asset) fail('covers.assetMissing')
    const inventory = await collectCoverSources(db, assetId, '', state.signal)
    check(state)
    if (inventory.truncated) fail('covers.inventoryLimited')
    if (!inventory.sources.length) fail(inventory.warnings.includes('covers.sourceUnavailable') ? 'covers.sourceUnavailable' : 'covers.sourceUnreadable')
    inventory.warnings.forEach(warning => state.warnings.add(warning))
    for (const source of inventory.sources) {
      const key = identity(source.memberPath), guids = state.ownership.get(key) ?? new Set<string>()
      guids.add(source.guid); state.ownership.set(key, guids)
    }
    let packages: PackageSource[] = []
    for (const file of [...new Set([asset.library_path, asset.source_path].filter((value): value is string => !!value))]) {
      packages = await findPackages(state, path.resolve(file))
      if (packages.length) break
    }
    if (!packages.length) fail('covers.sourceUnavailable')
    for (const source of packages) { source.resources = await readPackage(state, source, false); register(state, source) }
    if (!state.resources.size) fail('covers.sourceUnreadable')
    const guids = [...state.resources.keys()].sort()
    const memberPaths: Record<string, string[]> = {}
    const fingerprint = createHash('sha256')
    for (const guid of guids) {
      const resource = state.resources.get(guid)!.resource
      memberPaths[guid] = [...state.provenance.get(guid)!].sort()
      fingerprint.update(JSON.stringify([guid, resource.unityPath, resource.asset!.hash, resource.meta!.hash, memberPaths[guid]]) + '\n')
    }
    state.progress?.(0, guids.length); check(state)
    state.entries = 0
    for (const source of packages) await readPackage(state, source, true)
    await verifySources(state); check(state)
    return { guids, memberPaths, warnings: [...state.warnings].sort(), fingerprint: fingerprint.digest('hex'),
      sourceFiles: [...state.sources.values()].sort((a, b) => a.path.localeCompare(b.path)) }
  } catch (error) {
    await cleanup(state)
    check(state)
    if (error instanceof Error && error.message.startsWith('covers.')) throw error
    throw new Error('covers.sourceUnreadable')
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort) }
}
