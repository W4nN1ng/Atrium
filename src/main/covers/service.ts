import fs from 'node:fs'
import path from 'node:path'
import type { Db } from '../db'
import { getAsset } from '../db/repos/asset'
import { getProject } from '../db/repos/unity'
import { getCover, restoreCover, saveCover } from '../db/repos/covers'
import { bridgeDirOf, readHeartbeat } from '../bridge/mailbox'
import type { BridgeManager, BridgeExecResult } from '../bridge/manager'
import { BRIDGE_STALE_MS } from '../../shared/constants'
import { ulid } from '../../shared/ulid'
import type { CoverBatch, CoverPreview, CoverRecord, CoverRequest, CoverStatus, PreviewOptions, PreviewTarget } from '../../shared/covers'
import { thumbPathFor, writeThumbFromBuffer, type ThumbResult } from '../library/thumbs'
import { COVER_NONE, THUMB_MAX_SOURCE_BYTES, thumbKeyFromCover } from '../library/thumbRules'
import { compareVersion } from '../../shared/version'
import type { BridgeHeartbeat } from '../../shared/types'
import type { CoverCandidate, CoverDiscovery } from '../../shared/covers'
import { collectCoverSources } from './inventory'
import type { PackageCoverBackend } from './packageProvider'
import type { PackageCoverStatus, PackageCoverProgress } from '../../shared/covers'

const TTL = 10 * 60_000
const MAX_BYTES = 8 * 1024 * 1024
const directions = new Set(['auto', 'scene', 'front', 'back', 'left', 'right', 'top', 'bottom'])
interface Staged {
  request: CoverRequest; key: string; expires: number; original: string | null
  packageFingerprint?: string
  dependencyProjectId?: string | null
}
interface Dependencies {
  db: Db; manager: Pick<BridgeManager, 'execute'>
  writeImage?: (bytes: Buffer, key: string) => ThumbResult
  changed?: (assetId: string) => void
  packageProvider?: PackageCoverBackend
}

export class CoverService {
  private readonly staged = new Map<string, Staged>()
  private readonly pending = new Map<string, AbortController>()
  private readonly batches = new Map<string, CoverBatch>()
  private readonly batchControllers = new Map<string, AbortController>()
  private disposed = false
  private readonly packageProgresses = new Map<string, PackageCoverProgress>()
  constructor(private readonly deps: Dependencies) {}

  packageStatus(): PackageCoverStatus {
    return this.deps.packageProvider?.status() ?? { available: false, editorPath: null, version: null }
  }
  packageProgress(requestId: string): PackageCoverProgress | null {
    const progress = this.packageProgresses.get(requestId)
    return progress ? { ...progress } : null
  }
  private progress(requestId: string, value: PackageCoverProgress): void {
    if (this.packageProgresses.size >= 50 && !this.packageProgresses.has(requestId)) {
      for (const id of this.packageProgresses.keys()) if (!this.pending.has(id)) { this.packageProgresses.delete(id); break }
    }
    this.packageProgresses.set(requestId, { ...value })
  }
  async discoverPackage(assetId: string, requestId: string, dependencyProjectId?: string): Promise<CoverDiscovery> {
    if (this.disposed) throw new Error('covers.cancelled')
    if (typeof assetId !== 'string' || typeof requestId !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(requestId) ||
      this.pending.has(requestId) || this.staged.has(requestId) ||
      (dependencyProjectId !== undefined && typeof dependencyProjectId !== 'string')) throw new Error('covers.invalidRequest')
    if (!getAsset(this.deps.db, assetId)) throw new Error('covers.assetMissing')
    const provider = this.deps.packageProvider
    if (!provider) throw new Error('covers.packageEditorMissing')
    const controller = new AbortController()
    this.pending.set(requestId, controller); this.progress(requestId, { stage: 'reading' })
    try {
      const result = await provider.discover(assetId, requestId, dependencyProjectId, controller.signal, value => {
        if (!controller.signal.aborted) this.progress(requestId, value)
      })
      if (controller.signal.aborted || this.disposed) throw new Error('covers.cancelled')
      if (!Array.isArray(result.targets) || result.targets.length > 50 || !Array.isArray(result.warnings)) throw new Error('covers.invalidRequest')
      const targets = result.targets.map(value => {
        validatePackageTarget(value)
        if (!Array.isArray(value.memberPaths) || value.memberPaths.some(member => typeof member !== 'string' || member.length > 4000)) throw new Error('covers.invalidRequest')
        return { ...validateTarget(value), memberPaths: [...value.memberPaths] }
      })
      this.progress(requestId, { stage: 'ready' }); return { ...result, targets }
    } catch (error) {
      this.progress(requestId, { stage: controller.signal.aborted ? 'cancelled' : 'failed' }); throw error
    } finally { this.pending.delete(requestId) }
  }

  status(assetId: string, projectId: string): CoverStatus {
    const project = getProject(this.deps.db, projectId)
    const probe = project ? readHeartbeat(project.path) : null
    const alive = !!probe?.heartbeat && !probe.invalid && Date.now() - probe.seenAt <= BRIDGE_STALE_MS
    const hb = probe?.heartbeat
    return {
      record: getCover(this.deps.db, assetId),
      candidates: alive && supportsCandidates(hb),
      bridge: !alive ? 'offline' : !supportsPreview(hb) ? 'upgrade' :
        hb.isPlaying || hb.isCompiling || hb.isUpdating ? 'busy' : 'ready'
    }
  }

  private project(projectId: string, candidates = false): string {
    const project = getProject(this.deps.db, projectId)
    if (!project) throw new Error('covers.projectMissing')
    const probe = readHeartbeat(project.path)
    if (!probe.heartbeat || probe.invalid || Date.now() - probe.seenAt > BRIDGE_STALE_MS) throw new Error('covers.offline')
    if (!supportsPreview(probe.heartbeat) || (candidates && !supportsCandidates(probe.heartbeat))) throw new Error('covers.bridgeUpgrade')
    if (probe.heartbeat.isPlaying || probe.heartbeat.isCompiling || probe.heartbeat.isUpdating) throw new Error('covers.unityBusy')
    return project.path
  }

  async targets(projectId: string, query: string): Promise<PreviewTarget[]> {
    if (typeof query !== 'string' || query.length > 100) throw new Error('covers.invalidRequest')
    const result = await this.deps.manager.execute(this.project(projectId), 'get_preview_targets', { query })
    if (!result.ok) throw bridgeError(result)
    const targets = (result.data as { targets?: unknown })?.targets
    if (!Array.isArray(targets) || targets.length > 50) throw new Error('covers.invalidRequest')
    return targets.map(validateTarget)
  }

  async discover(assetId: string, projectId: string, requestId: string): Promise<CoverDiscovery> {
    this.expire()
    if (this.disposed) throw new Error('covers.cancelled')
    if (typeof assetId !== 'string' || typeof projectId !== 'string' || typeof requestId !== 'string' ||
      !/^[A-Za-z0-9_-]{1,80}$/.test(requestId) || this.pending.has(requestId) || this.staged.has(requestId)) throw new Error('covers.invalidRequest')
    if (!getAsset(this.deps.db, assetId)) throw new Error('covers.assetMissing')
    const projectPath = this.project(projectId, true)
    const controller = new AbortController()
    this.pending.set(requestId, controller)
    const checkCancelled = (): void => { if (controller.signal.aborted || this.disposed) throw new Error('covers.cancelled') }
    try {
      const inventory = await collectCoverSources(this.deps.db, assetId, projectId, controller.signal)
      checkCancelled()
      const provenance = new Map<string, Set<string>>()
      for (const source of inventory.sources) {
        const guid = source.guid.toLowerCase()
        if (!/^[a-f0-9]{32}$/.test(guid)) continue
        if (!provenance.has(guid)) provenance.set(guid, new Set())
        if (source.memberPath) provenance.get(guid)!.add(source.memberPath)
      }
      const guids = [...provenance.keys()]
      const targets: CoverCandidate[] = []
      const seen = new Set<string>()
      let truncated = inventory.truncated
      for (let offset = 0; offset < guids.length; offset += 500) {
        checkCancelled()
        const batch = guids.slice(offset, offset + 500)
        const result = await this.deps.manager.execute(projectPath, 'get_preview_candidates', { guids: batch }, {
          id: 'cover-find-' + requestId + '-' + (offset / 500), signal: controller.signal,
          ackTimeoutMs: 30_000, label: 'Find cover items'
        })
        checkCancelled()
        if (!result.ok) throw bridgeError(result)
        const data = result.data as { targets?: unknown; truncated?: unknown }
        if (!Array.isArray(data?.targets) || data.targets.length > 50 || typeof data.truncated !== 'boolean') throw new Error('covers.invalidRequest')
        const requested = new Set(batch)
        for (const value of data.targets) {
          const candidate = validateTarget(value)
          const guid = candidate.sourceGuid?.toLowerCase()
          if (!guid || !requested.has(guid) || candidate.isScene || !candidate.persistent) throw new Error('covers.invalidRequest')
          if (seen.has(candidate.id)) continue
          seen.add(candidate.id)
          if (targets.length >= 50) { truncated = true; continue }
          targets.push({ ...candidate, sourceGuid: guid, memberPaths: [...provenance.get(guid)!].sort() })
        }
        truncated ||= data.truncated
        if (targets.length >= 50) {
          truncated ||= offset + batch.length < guids.length
          break
        }
      }
      return { targets, warnings: [...new Set(inventory.warnings)], truncated }
    } finally { this.pending.delete(requestId) }
  }

  async preview(request: CoverRequest): Promise<CoverPreview> {
    this.expire()
    if (this.disposed) throw new Error('covers.cancelled')
    const { requestId, assetId, projectId } = request
    if (typeof requestId !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(requestId) || this.pending.has(requestId) || this.staged.has(requestId)) throw new Error('covers.invalidRequest')
    if (request.provider !== undefined && !['project', 'package'].includes(request.provider)) throw new Error('covers.invalidRequest')
    validateTarget(request.target); validateOptions(request.options)
    const asset = getAsset(this.deps.db, assetId)
    if (!asset) throw new Error('covers.assetMissing')
    if (request.provider === 'package') return this.previewPackage(request)
    const projectPath = this.project(projectId)
    const controller = new AbortController()
    this.pending.set(requestId, controller)
    const commandId = 'cover-' + requestId
    const output = path.join(bridgeDirOf(projectPath), 'previews', commandId + '.png')
    // A duplicate request must never consume an earlier capture.
    if (fs.existsSync(output)) { this.pending.delete(requestId); throw new Error('covers.invalidRequest') }
    try {
      const result = await this.deps.manager.execute(projectPath, 'render_preview', {
        targetId: request.target.id, ...request.options
      }, { id: commandId, signal: controller.signal, ackTimeoutMs: 30_000, label: 'Object preview' })
      if (controller.signal.aborted || this.disposed) throw new Error('covers.cancelled')
      if (!result.ok) throw bridgeError(result)
      const data = result.data as { relativePath?: string; width?: number; height?: number; rendererCount?: number }
      if (data?.relativePath !== 'previews/' + commandId + '.png' || data.width !== 640 || data.height !== 480 ||
          !Number.isInteger(data.rendererCount) || data.rendererCount! < 1 || data.rendererCount! > 500) throw new Error('covers.invalidImage')
      const bytes = readPreview(output, bridgeDirOf(projectPath))
      const key = 'preview-' + ulid().toLowerCase()
      const written = (this.deps.writeImage ?? writeThumbFromBuffer)(bytes, key)
      if (!written.ok || !written.url) throw new Error('covers.invalidImage\n' + (written.why ?? ''))
      this.staged.set(requestId, { request: structuredClone(request), key, expires: Date.now() + TTL, original: asset.cover_image })
      return { id: requestId, url: written.url, width: data.width, height: data.height, rendererCount: data.rendererCount! }
    } finally {
      this.pending.delete(requestId)
      // Only clean the exact regular file we validated; never follow a directory link.
      try { if (safePreviewFile(output, bridgeDirOf(projectPath))) fs.rmSync(output, { force: true }) } catch { /* Temp will be cleared by Unity */ }
    }
  }

  private async previewPackage(request: CoverRequest): Promise<CoverPreview> {
    validatePackageTarget(request.target)
    if (request.options.direction === 'scene') throw new Error('covers.invalidRequest')
    const provider = this.deps.packageProvider
    if (!provider) throw new Error('covers.packageEditorMissing')
    const asset = getAsset(this.deps.db, request.assetId)!
    const controller = new AbortController()
    this.pending.set(request.requestId, controller); this.progress(request.requestId, { stage: 'rendering' })
    try {
      const result = await provider.preview(request, controller.signal, value => {
        if (!controller.signal.aborted) this.progress(request.requestId, value)
      })
      if (controller.signal.aborted || this.disposed) throw new Error('covers.cancelled')
      if (result.width !== 640 || result.height !== 480 || !Number.isInteger(result.rendererCount) || result.rendererCount < 1 || result.rendererCount > 500 ||
        !validPng(result.bytes) || typeof result.fingerprint !== 'string' || !result.fingerprint) throw new Error('covers.invalidImage')
      const key = 'preview-' + ulid().toLowerCase()
      const written = (this.deps.writeImage ?? writeThumbFromBuffer)(result.bytes, key)
      if (!written.ok || !written.url) throw new Error('covers.invalidImage\n' + (written.why ?? ''))
      this.staged.set(request.requestId, { request: structuredClone(request), key, expires: Date.now() + TTL, original: asset.cover_image,
        packageFingerprint: result.fingerprint, dependencyProjectId: result.dependencyProjectId ?? null })
      this.progress(request.requestId, { stage: 'ready' })
      return { id: request.requestId, url: written.url, width: result.width, height: result.height, rendererCount: result.rendererCount }
    } catch (error) {
      this.progress(request.requestId, { stage: controller.signal.aborted ? 'cancelled' : 'failed' }); throw error
    } finally { this.pending.delete(request.requestId) }
  }

  save(assetId: string, previewId: string): CoverRecord {
    this.expire()
    const stage = this.staged.get(previewId)
    if (!stage || stage.request.assetId !== assetId) throw new Error('covers.previewExpired')
    const asset = getAsset(this.deps.db, assetId)
    if (!asset) throw new Error('covers.assetMissing')
    if (asset.cover_image !== stage.original) throw new Error('covers.changed')
    if (stage.packageFingerprint) this.deps.packageProvider!.assertCurrent(assetId, stage.packageFingerprint)
    const key = 'cover-' + ulid().toLowerCase()
    fs.copyFileSync(thumbPathFor(stage.key), thumbPathFor(key), fs.constants.COPYFILE_EXCL)
    try {
      saveCover(this.deps.db, { assetId, coverImage: 'athumb://' + key + '.jpg', source: stage.packageFingerprint ? 'package' : 'unity',
        projectId: stage.packageFingerprint ? stage.dependencyProjectId ?? null : stage.request.projectId,
        target: stage.request.target, options: stage.request.options }, this.originalImage(assetId))
    } catch (e) { fs.rmSync(thumbPathFor(key), { force: true }); throw e }
    this.discard(previewId)
    this.deps.changed?.(assetId)
    return getCover(this.deps.db, assetId)!
  }

  upload(assetId: string, file: string): CoverRecord {
    if (!getAsset(this.deps.db, assetId)) throw new Error('covers.assetMissing')
    const stat = fs.statSync(file)
    if (!stat.isFile() || stat.size > MAX_BYTES) throw new Error('covers.invalidImage')
    const key = 'cover-' + ulid().toLowerCase()
    const result = (this.deps.writeImage ?? writeThumbFromBuffer)(fs.readFileSync(file), key)
    if (!result.ok || !result.url) throw new Error('covers.invalidImage\n' + (result.why ?? ''))
    try { saveCover(this.deps.db, { assetId, coverImage: result.url, source: 'image', projectId: null, target: null, options: null }, this.originalImage(assetId)) }
    catch (e) { fs.rmSync(thumbPathFor(key), { force: true }); throw e }
    this.deps.changed?.(assetId)
    return getCover(this.deps.db, assetId)!
  }

  private originalImage(assetId: string): string | null {
    const previous = getCover(this.deps.db, assetId)
    if (previous) return previous.previousImage
    const original = getAsset(this.deps.db, assetId)?.cover_image ?? null
    if (!original || original === COVER_NONE || thumbKeyFromCover(original)) return original
    // Older cards can point directly into a library directory. Cache their
    // original before overriding it, so moving/undoing that directory is safe.
    try {
      const stat = fs.statSync(original)
      if (!stat.isFile() || stat.size > THUMB_MAX_SOURCE_BYTES) throw new Error('Original cover is not a supported image file (48 MB maximum)')
      const result = (this.deps.writeImage ?? writeThumbFromBuffer)(fs.readFileSync(original), 'original-' + ulid().toLowerCase())
      if (!result.ok || !result.url) throw new Error(result.why ?? 'Original image could not be cached')
      return result.url
    } catch (e) {
      throw new Error(('covers.originalPreserveFailed\n' + (e instanceof Error ? e.message : String(e))).slice(0, 4000))
    }
  }

  restore(assetId: string): void {
    if (!getAsset(this.deps.db, assetId)) throw new Error('covers.assetMissing')
    restoreCover(this.deps.db, assetId)
    this.deps.changed?.(assetId)
  }

  discard(previewId: string): void {
    this.pending.get(previewId)?.abort()
    this.packageProgresses.delete(previewId)
    const stage = this.staged.get(previewId)
    if (stage) { try { fs.rmSync(thumbPathFor(stage.key), { force: true }) } catch { /* prune later */ }; this.staged.delete(previewId) }
  }

  startBatch(assetIds: string[]): CoverBatch {
    if (this.disposed || !Array.isArray(assetIds) || assetIds.length < 1 || assetIds.length > 500 || assetIds.some(id => typeof id !== 'string')) throw new Error('covers.invalidRequest')
    if ([...this.batches.values()].some(batch => batch.running)) throw new Error('covers.batchBusy')
    // Retain a small bounded history; returned values are copies, never mutable shared state.
    if (this.batches.size >= 10) this.batches.delete(this.batches.keys().next().value!)
    const records = [...new Set(assetIds)].map(id => ({ assetId: id, record: getCover(this.deps.db, id) }))
    const batch: CoverBatch = { id: ulid(), running: true, cancelled: false,
      items: records.map(({ assetId }) => ({ assetId, name: getAsset(this.deps.db, assetId)?.name ?? assetId, state: 'queued', reason: null })) }
    const controller = new AbortController()
    this.batches.set(batch.id, batch); this.batchControllers.set(batch.id, controller)
    void this.runBatch(batch, records, controller).finally(() => { batch.running = false; this.batchControllers.delete(batch.id) })
    return structuredClone(batch)
  }

  private async runBatch(batch: CoverBatch, records: Array<{ assetId: string; record: CoverRecord | null }>, controller: AbortController): Promise<void> {
    for (let i = 0; i < records.length; i++) {
      const item = batch.items[i]; const { record, assetId } = records[i]
      if (controller.signal.aborted || this.disposed) { item.state = 'cancelled'; item.reason = 'covers.cancelled'; continue }
      if (!record || (record.source !== 'unity' && record.source !== 'package') ||
        (record.source === 'unity' && !record.projectId) || !record.target?.persistent || !record.options) {
        item.state = 'skipped'; item.reason = record?.source === 'image' ? 'covers.manualSkipped' : 'covers.unlinkedSkipped'; continue
      }
      item.state = 'running'
      const requestId = ulid().toLowerCase()
      const abort = (): void => this.discard(requestId)
      controller.signal.addEventListener('abort', abort, { once: true })
      try {
        if (getAsset(this.deps.db, assetId)?.cover_image !== record.coverImage) throw new Error('covers.changed')
        await this.preview({ assetId, projectId: record.source === 'package' ? '' : record.projectId!,
          provider: record.source === 'package' ? 'package' : 'project', dependencyProjectId: record.source === 'package' ? record.projectId ?? undefined : undefined,
          target: record.target, options: record.options, requestId })
        if (controller.signal.aborted) throw new Error('covers.cancelled')
        if (getCover(this.deps.db, assetId)?.coverImage !== record.coverImage) throw new Error('covers.changed')
        this.save(assetId, requestId); item.state = 'done'
      } catch (e) {
        item.state = controller.signal.aborted ? 'cancelled' : 'failed'
        item.reason = errorKey(e instanceof Error ? e.message : null)
        item.detail = (e instanceof Error ? e.message : String(e)).slice(0, 4000)
      }
      finally { controller.signal.removeEventListener('abort', abort); this.discard(requestId) }
    }
  }

  batchStatus(id: string): CoverBatch {
    const batch = this.batches.get(id)
    if (!batch) throw new Error('covers.invalidRequest')
    return structuredClone(batch)
  }
  cancelBatch(id: string): void {
    const batch = this.batches.get(id)
    if (!batch) return
    batch.cancelled = true; this.batchControllers.get(id)?.abort()
  }
  private expire(): void { for (const [id, stage] of this.staged) if (stage.expires < Date.now()) this.discard(id) }
  dispose(): void {
    this.disposed = true
    for (const controller of this.pending.values()) controller.abort()
    for (const controller of this.batchControllers.values()) controller.abort()
    for (const id of this.staged.keys()) this.discard(id)
    this.deps.packageProvider?.dispose()
    this.packageProgresses.clear()
  }
}

function errorKey(error: string | null): string { return error?.match(/covers\.[A-Za-z]+/)?.[0] ?? 'covers.renderFailed' }
function supportsPreview(heartbeat: BridgeHeartbeat | null | undefined): heartbeat is BridgeHeartbeat {
  // 1.1.0 advertises previews, but cannot frame blendshape-only props reliably.
  return !!heartbeat?.capabilities?.includes('object_preview') && compareVersion(heartbeat.bridgeVersion, '1.1.1') >= 0
}
function supportsCandidates(heartbeat: BridgeHeartbeat | null | undefined): boolean {
  return !!heartbeat?.capabilities?.includes('preview_candidates') && compareVersion(heartbeat.bridgeVersion, '1.2.0') >= 0
}
function bridgeError(result: BridgeExecResult): Error {
  return new Error([errorKey(result.error), result.error, result.stackTrace].filter(Boolean).join('\n').slice(0, 4000))
}
function validateOptions(options: PreviewOptions): void {
  if (!options || !directions.has(options.direction) || !['dark', 'light'].includes(options.background)) throw new Error('covers.invalidRequest')
}
function validateTarget(value: unknown): PreviewTarget {
  const t = value as PreviewTarget
  if (!t || typeof t.id !== 'string' || t.id.length < 1 || t.id.length > 200 || typeof t.name !== 'string' || t.name.length > 1000 ||
      typeof t.path !== 'string' || t.path.length > 4000 || typeof t.persistent !== 'boolean' || typeof t.isScene !== 'boolean' ||
      (t.sourceGuid !== null && (typeof t.sourceGuid !== 'string' || !/^[a-f0-9]{32}$/i.test(t.sourceGuid)))) throw new Error('covers.invalidRequest')
  return { id: t.id, name: t.name, path: t.path, persistent: t.persistent, isScene: t.isScene, sourceGuid: t.sourceGuid }
}
function validatePackageTarget(value: unknown): PreviewTarget {
  const target = validateTarget(value)
  if (!target.sourceGuid || target.id !== 'package:' + target.sourceGuid.toLowerCase() || target.isScene || !target.persistent) throw new Error('covers.invalidRequest')
  return target
}
function safePreviewFile(file: string, root: string): boolean {
  const stat = fs.lstatSync(file)
  if (!stat.isFile() || stat.isSymbolicLink()) return false
  const realRoot = fs.realpathSync(root)
  const real = fs.realpathSync(file)
  // Both the bridge root and previews directory must reside inside this project.
  const realProject = fs.realpathSync(path.dirname(path.dirname(root)))
  return real === path.join(realRoot, 'previews', path.basename(file)) && realRoot === path.join(realProject, 'Temp', 'AVCABridge')
}
export function readPreview(file: string, root: string): Buffer {
  try {
    if (!safePreviewFile(file, root)) throw new Error()
    const stat = fs.statSync(file)
    if (stat.size < 24 || stat.size > MAX_BYTES) throw new Error()
    const bytes = fs.readFileSync(file)
    if (!validPng(bytes)) throw new Error()
    return bytes
  } catch { throw new Error('covers.invalidImage') }
}
function validPng(bytes: Buffer): boolean {
  return Buffer.isBuffer(bytes) && bytes.length >= 24 && bytes.length <= MAX_BYTES &&
    bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) &&
    bytes.toString('ascii', 12, 16) === 'IHDR' && bytes.readUInt32BE(16) === 640 && bytes.readUInt32BE(20) === 480
}
