import fs from 'node:fs'
import path from 'node:path'
import type { Db } from '../db'
import { getAsset } from '../db/repos/asset'
import { getProject } from '../db/repos/unity'
import type { BridgeExecResult, BridgeManager } from '../bridge/manager'
import { bridgeDirOf } from '../bridge/mailbox'
import { P } from '../services/paths'
import { ulid } from '../../shared/ulid'
import type { CoverCandidate, CoverDiscovery, CoverRequest, PackageCoverProgress, PackageCoverStatus, PreviewTarget } from '../../shared/covers'
import { preparePackageSources } from './packageSource'
import { PackagePreviewWorker, ensurePackagePreviewProject, findUnityEditor, PACKAGE_PREVIEW_MARKER } from './packageWorker'
import { readPreview } from './service'
import { assertCoverDependency } from './dependencySetup'

export interface PackageRendered {
  bytes: Buffer; width: number; height: number; rendererCount: number
  fingerprint: string; dependencyProjectId: string | null
}
export interface PackageCoverBackend {
  status(): PackageCoverStatus
  discover(assetId: string, requestId: string, dependencyProjectId: string | undefined, signal: AbortSignal,
    progress: (value: PackageCoverProgress) => void): Promise<CoverDiscovery>
  preview(request: CoverRequest, signal: AbortSignal, progress: (value: PackageCoverProgress) => void): Promise<PackageRendered>
  assertCurrent(assetId: string, fingerprint: string): void
  dispose(): void
}
interface Prepared {
  project: string; sourcePaths: string; dependencyId: string | null
  files: Array<{ path: string; size: number; mtimeMs: number }>
  fingerprint: string; candidates: Map<string, { external: CoverCandidate; internal: PreviewTarget }>
  warnings: string[]; truncated: boolean
}
interface Dependencies {
  db: Db; manager: Pick<BridgeManager, 'execute'>; editorPath: () => string
  worker?: Pick<PackagePreviewWorker, 'start' | 'execute' | 'stop' | 'dispose'>
  prepare?: typeof preparePackageSources
}
const cancelled = (): Error => new Error('covers.cancelled')
function bridgeFailure(result: BridgeExecResult): Error {
  const key = result.error?.match(/covers\.[A-Za-z]+/)?.[0] ?? 'covers.renderFailed'
  return new Error([key, result.error, result.stackTrace].filter(Boolean).join('\n').slice(0, 4000))
}

/** Package association is a GUID; no transient editor/process/project identity escapes this provider. */
export class PackageCoverProvider implements PackageCoverBackend {
  private readonly worker: Pick<PackagePreviewWorker, 'start' | 'execute' | 'stop' | 'dispose'>
  private readonly prepared = new Map<string, Prepared>()
  private readonly controllers = new Set<AbortController>()
  private readonly jobs = new Set<string>()
  private chain: Promise<unknown> = Promise.resolve()
  private disposed = false
  private cleanup: Promise<void> | null = null
  private dependencyPath: string | null = null

  constructor(private readonly deps: Dependencies) {
    this.worker = deps.worker ?? new PackagePreviewWorker({ manager: deps.manager, editorPath: deps.editorPath,
      dependencyProject: () => this.dependencyPath })
  }
  status(): PackageCoverStatus {
    const found = findUnityEditor(this.deps.editorPath())
    return { available: !!found.path, editorPath: found.path, version: found.version }
  }
  private sourcePaths(assetId: string): string {
    const asset = getAsset(this.deps.db, assetId)
    if (!asset) throw new Error('covers.assetMissing')
    return JSON.stringify([asset.library_path, asset.source_path, asset.parent_asset_id, asset.raw_name])
  }
  private current(assetId: string, prepared: Prepared): boolean {
    if (this.sourcePaths(assetId) !== prepared.sourcePaths) return false
    return prepared.files.every(file => {
      try {
        const stat = fs.lstatSync(file.path)
        return stat.isFile() && !stat.isSymbolicLink() && stat.size === file.size && stat.mtimeMs === file.mtimeMs
      } catch { return false }
    })
  }
  assertCurrent(assetId: string, fingerprint: string): void {
    const prepared = this.prepared.get(assetId)
    if (!prepared || prepared.fingerprint !== fingerprint || !this.current(assetId, prepared)) throw new Error('covers.sourceChanged')
  }
  private async operation<T>(signal: AbortSignal, progress: (value: PackageCoverProgress) => void,
    work: (signal: AbortSignal) => Promise<T>): Promise<T> {
    if (this.disposed || signal.aborted) throw cancelled()
    const controller = new AbortController()
    this.controllers.add(controller)
    const abort = (): void => controller.abort()
    signal.addEventListener('abort', abort, { once: true })
    let started = false
    const run = async (): Promise<T> => {
      started = true
      if (this.disposed || controller.signal.aborted) throw cancelled()
      return work(controller.signal)
    }
    const result = this.chain.then(run, run)
    this.chain = result.catch(() => undefined)
    progress({ stage: 'queued' })
    try {
      return await new Promise<T>((resolve, reject) => {
        const queuedAbort = (): void => { if (!started) reject(cancelled()) }
        controller.signal.addEventListener('abort', queuedAbort, { once: true })
        if (controller.signal.aborted) queuedAbort()
        void result.then(resolve, reject).finally(() => controller.signal.removeEventListener('abort', queuedAbort))
      })
    } finally {
      signal.removeEventListener('abort', abort); this.controllers.delete(controller)
    }
  }
  private async ensure(assetId: string, dependencyId: string | undefined, signal: AbortSignal,
    progress: (value: PackageCoverProgress) => void): Promise<Prepared> {
    this.pruneInactive()
    const sourcePaths = this.sourcePaths(assetId)
    const dependency = dependencyId ? getProject(this.deps.db, dependencyId) : null
    if (dependencyId && !dependency) throw new Error('covers.projectMissing')
    if (dependencyId) assertCoverDependency(this.deps.db, dependencyId)
    this.dependencyPath = dependency?.path ?? null
    const existing = this.prepared.get(assetId)
    if (existing && existing.dependencyId === (dependencyId || null) && this.current(assetId, existing)) {
      await this.worker.start(existing.project, signal, stage => progress({ stage }))
      return existing
    }
    if (existing) { await this.worker.stop(); this.removeOwned(existing.project); this.prepared.delete(assetId) }
    // Keep only a bounded in-process cache; source GUID associations can always be rebuilt after restart.
    while (this.prepared.size >= 3) {
      const oldest = this.prepared.entries().next().value!
      await this.worker.stop(); this.removeOwned(oldest[1].project); this.prepared.delete(oldest[0])
    }
    const project = path.join(P.root(), 'cover-previews', 'job-' + ulid().toLowerCase())
    ensurePackagePreviewProject(project)
    const canonical = fs.realpathSync(project)
    this.jobs.add(canonical)
    fs.mkdirSync(path.join(canonical, 'Assets'))
    try {
      progress({ stage: 'reading' })
      const source = await (this.deps.prepare ?? preparePackageSources)(this.deps.db, assetId, path.join(canonical, 'Assets'), signal,
        (done, total) => progress({ stage: 'reading', done, total }))
      if (signal.aborted || this.disposed) throw cancelled()
      if (this.sourcePaths(assetId) !== sourcePaths) throw new Error('covers.sourceChanged')
      const prepared: Prepared = { project: canonical, sourcePaths, dependencyId: dependencyId || null,
        files: source.sourceFiles ?? [], fingerprint: source.fingerprint, candidates: new Map(), warnings: source.warnings, truncated: false }
      if (!this.current(assetId, prepared)) throw new Error('covers.sourceChanged')
      await this.worker.start(canonical, signal, stage => progress({ stage }))
      if (signal.aborted || this.disposed) throw cancelled()
      progress({ stage: 'discovering' })
      for (let offset = 0; offset < source.guids.length; offset += 500) {
        const guids = source.guids.slice(offset, offset + 500)
        const response = await this.worker.execute(canonical, 'get_preview_candidates', { guids }, signal)
        if (signal.aborted || this.disposed) throw cancelled()
        if (!response.ok) throw bridgeFailure(response)
        const data = response.data as { targets?: unknown; truncated?: unknown }
        if (!Array.isArray(data?.targets) || data.targets.length > 50 || typeof data.truncated !== 'boolean') throw new Error('covers.invalidRequest')
        const allowed = new Set(guids)
        for (const raw of data.targets) {
          const target = raw as PreviewTarget
          const guid = target?.sourceGuid?.toLowerCase()
          if (!guid || !allowed.has(guid) || typeof target.id !== 'string' || target.id.length > 200 ||
            typeof target.name !== 'string' || target.name.length > 1000 || typeof target.path !== 'string' || target.path.length > 4000 ||
            !target.path.startsWith('Assets/') || target.isScene !== false || target.persistent !== true) throw new Error('covers.invalidRequest')
          if (prepared.candidates.has(guid)) continue
          if (prepared.candidates.size >= 50) { prepared.truncated = true; continue }
          const external: CoverCandidate = { ...target, id: 'package:' + guid, sourceGuid: guid, memberPaths: source.memberPaths[guid] ?? [] }
          prepared.candidates.set(guid, { external, internal: { ...target, sourceGuid: guid } })
        }
        prepared.truncated ||= data.truncated
        if (prepared.candidates.size >= 50) { prepared.truncated ||= offset + guids.length < source.guids.length; break }
      }
      if (!this.current(assetId, prepared)) throw new Error('covers.sourceChanged')
      this.prepared.set(assetId, prepared)
      return prepared
    } catch (error) {
      await this.worker.stop().catch(() => undefined)
      this.removeOwned(canonical)
      throw error
    }
  }
  discover(assetId: string, _requestId: string, dependencyProjectId: string | undefined, signal: AbortSignal,
    progress: (value: PackageCoverProgress) => void): Promise<CoverDiscovery> {
    return this.operation(signal, progress, async inner => {
      const prepared = await this.ensure(assetId, dependencyProjectId, inner, progress)
      if (inner.aborted) throw cancelled()
      return { targets: [...prepared.candidates.values()].map(value => structuredClone(value.external)),
        warnings: [...prepared.warnings], truncated: prepared.truncated }
    })
  }
  preview(request: CoverRequest, signal: AbortSignal, progress: (value: PackageCoverProgress) => void): Promise<PackageRendered> {
    return this.operation(signal, progress, async inner => {
      const prepared = await this.ensure(request.assetId, request.dependencyProjectId, inner, progress)
      const candidate = prepared.candidates.get(request.target.sourceGuid?.toLowerCase() ?? '')
      if (!candidate || request.target.id !== candidate.external.id) throw new Error('covers.targetMissing')
      progress({ stage: 'rendering' })
      const response = await this.worker.execute(prepared.project, 'render_preview', { targetId: candidate.internal.id, ...request.options }, inner)
      if (inner.aborted || this.disposed) throw cancelled()
      if (!response.ok) throw bridgeFailure(response)
      const data = response.data as { relativePath?: string; width?: number; height?: number; rendererCount?: number }
      if (!/^[A-Za-z0-9_-]{1,80}$/.test(response.commandId ?? '') || data.relativePath !== 'previews/' + response.commandId + '.png' ||
        data.width !== 640 || data.height !== 480 || !Number.isInteger(data.rendererCount) || data.rendererCount! < 1 || data.rendererCount! > 500) throw new Error('covers.invalidImage')
      const bridge = bridgeDirOf(prepared.project), file = path.join(bridge, data.relativePath)
      const bytes = readPreview(file, bridge)
      // readPreview proves the exact regular output file and canonical project boundary.
      fs.unlinkSync(file)
      this.assertCurrent(request.assetId, prepared.fingerprint)
      return { bytes, width: data.width, height: data.height, rendererCount: data.rendererCount!,
        fingerprint: prepared.fingerprint, dependencyProjectId: prepared.dependencyId }
    })
  }
  private hasLiveWorker(project: string): boolean {
    return ['package-worker-owner.json', 'bridge.json'].some(name => this.hasLivePid(project, name))
  }
  private hasLivePid(project: string, name: string): boolean {
    const file = path.join(bridgeDirOf(project), name)
    if (!fs.existsSync(file)) return false
    try {
      if (fs.lstatSync(file).isSymbolicLink() || fs.statSync(file).size > 4096) return true
      const heartbeat = JSON.parse(fs.readFileSync(file, 'utf8')) as { pid?: number; projectPath?: string }
      if (!Number.isInteger(heartbeat.pid) || heartbeat.pid! <= 0 || typeof heartbeat.projectPath !== 'string' ||
        path.resolve(heartbeat.projectPath).toLowerCase() !== path.resolve(project).toLowerCase()) return true
      try { process.kill(heartbeat.pid!, 0); return true } catch (error) {
        return (error as NodeJS.ErrnoException).code !== 'ESRCH'
      }
    } catch { return true }
  }
  private pruneInactive(): void {
    const cache = path.join(P.root(), 'cover-previews')
    try {
      if (fs.lstatSync(cache).isSymbolicLink()) return
      for (const entry of fs.readdirSync(cache, { withFileTypes: true })) {
        if (!entry.isDirectory() || entry.isSymbolicLink() || !/^job-[0-9a-z]{26}$/.test(entry.name)) continue
        const project = fs.realpathSync(path.join(cache, entry.name))
        if (!this.jobs.has(project)) this.removeOwned(project, true)
      }
    } catch { /* Cache absent or locked: preparation and future cleanup can proceed. */ }
  }
  private removeOwned(project: string, previousSession = false): void {
    if (!this.jobs.has(project) && !previousSession) return
    try {
      // Cleanup must never establish ownership of an unmarked directory.
      if (!fs.existsSync(path.join(project, PACKAGE_PREVIEW_MARKER))) return
      ensurePackagePreviewProject(project)
      const root = fs.realpathSync(path.join(P.root(), 'cover-previews'))
      const relative = path.relative(root, project)
      if (!relative || relative.startsWith('..') || path.isAbsolute(relative) || fs.lstatSync(project).isSymbolicLink()) return
      const noLinks = (directory: string): boolean => fs.readdirSync(directory, { withFileTypes: true }).every(entry => {
        if (entry.isSymbolicLink()) return false
        return !entry.isDirectory() || noLinks(path.join(directory, entry.name))
      })
      if (!noLinks(project) || this.hasLiveWorker(project)) return
      fs.rmSync(project, { recursive: true, force: true })
      this.jobs.delete(project)
    } catch { /* Unknown ownership or replaced cache is preserved. */ }
  }
  dispose(): Promise<void> {
    if (this.cleanup) return this.cleanup
    this.disposed = true
    for (const controller of this.controllers) controller.abort()
    this.cleanup = this.chain.then(async () => {
      // Do not delete imported files until the owned editor has released them.
      await this.worker.stop()
      for (const project of [...this.jobs]) this.removeOwned(project)
      this.prepared.clear()
    }).catch(() => undefined).finally(() => this.worker.dispose())
    return this.cleanup
  }
}
