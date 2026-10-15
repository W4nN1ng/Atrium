import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { spawn, type ChildProcess } from 'node:child_process'
import type { BridgeCommandType } from '../../shared/types'
import type { BridgeExecResult, BridgeManager } from '../bridge/manager'
import { readHeartbeat, writeJsonAtomic } from '../bridge/mailbox'
import { bridgeTemplateRoot, P } from '../services/paths'
import { decodeUtf8Strict } from '../unpack/encoding'

export const PACKAGE_PREVIEW_MARKER = '.atrium-cover-preview.json'
const KIND = 'atrium-package-preview'
const START_TIMEOUT_MS = 120_000
const STOP_TIMEOUT_MS = 5_000
const IDLE_MS = 300_000
const MAX_METADATA_BYTES = 1024 * 1024
const RENDER_EXTENSIONS = new Set(['.prefab', '.fbx', '.obj', '.mat', '.asset', '.png', '.jpg', '.jpeg',
  '.tga', '.bmp', '.gif', '.psd', '.exr', '.hdr', '.tif', '.tiff', '.dds', '.shader', '.hlsl', '.cginc',
  '.cg', '.glsl', '.compute', '.shadervariants', '.lilblock', '.lilinternal'])
const FORBIDDEN_EXTENSIONS = /\.(?:cs|dll|exe|com|bat|cmd|ps1|sh|asmdef|asmref|so|dylib|bundle|jar|py|js|vbs)(?:\.meta)?$/i

function cancelled(): Error { return new Error('covers.cancelled') }
function invalid(): Error { return new Error('covers.invalidRequest') }
function samePath(a: string, b: string): boolean {
  return path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase()
}
function inside(parent: string, child: string): boolean {
  const relative = path.relative(parent, child)
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative)
}
function noLinks(file: string): void {
  if (fs.lstatSync(file).isSymbolicLink()) throw invalid()
}

function previewLocation(projectPath: string, createRoot = false): { project: string; root: string } {
  const inputRoot = path.resolve(P.root())
  if (createRoot) fs.mkdirSync(inputRoot, { recursive: true })
  noLinks(inputRoot)
  const root = fs.realpathSync(inputRoot)
  const inputProject = path.resolve(projectPath)
  const inputBase = inside(path.join(inputRoot, 'cover-previews'), inputProject) ? inputRoot
    : inside(path.join(root, 'cover-previews'), inputProject) ? root : null
  if (!inputBase) throw invalid()
  // Windows may expose a non-reparse-point profile alias. Canonicalize it after explicit link checks.
  const relative = path.relative(inputBase, inputProject)
  let current = inputBase
  for (const piece of relative.split(path.sep)) {
    current = path.join(current, piece)
    if (fs.existsSync(current)) noLinks(current)
  }
  const project = path.resolve(root, relative)
  current = root
  for (const piece of relative.split(path.sep)) {
    current = path.join(current, piece)
    if (fs.existsSync(current)) noLinks(current)
  }
  return { project, root }
}

/** Only callers creating a new, empty job may establish ownership. Existing jobs require the exact marker. */
export function ensurePackagePreviewProject(projectPath: string): void {
  const { project } = previewLocation(projectPath, true)
  if (fs.existsSync(project)) {
    if (fs.existsSync(path.join(project, PACKAGE_PREVIEW_MARKER))) { validateOwned(project); return }
    if (fs.readdirSync(project).length !== 0) throw invalid()
  }
  fs.mkdirSync(project, { recursive: true })
  fs.writeFileSync(path.join(project, PACKAGE_PREVIEW_MARKER), JSON.stringify({
    kind: KIND, version: 1, projectPath: fs.realpathSync(project)
  }), { encoding: 'utf8', flag: 'wx' })
}

function validateOwned(projectPath: string): string {
  const { project, root } = previewLocation(projectPath)
  let cursor = project
  for (;;) {
    noLinks(cursor)
    if (samePath(cursor, root)) break
    const parent = path.dirname(cursor)
    if (parent === cursor) throw invalid()
    cursor = parent
  }
  if (!samePath(fs.realpathSync(project), project)) throw invalid()
  const markerPath = path.join(project, PACKAGE_PREVIEW_MARKER)
  try {
    noLinks(markerPath)
    if (fs.statSync(markerPath).size > 4096) throw invalid()
    const marker = JSON.parse(fs.readFileSync(markerPath, 'utf8')) as Record<string, unknown>
    if (marker.kind !== KIND || marker.version !== 1 || typeof marker.projectPath !== 'string'
      || !samePath(marker.projectPath, fs.realpathSync(project))) throw invalid()
  } catch { throw invalid() }
  return project
}

function walkFiles(dir: string, callback: (file: string, relative: string, directory: boolean) => void, prefix = ''): void {
  noLinks(dir)
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name), relative = path.join(prefix, entry.name)
    if (entry.isSymbolicLink()) throw invalid()
    callback(file, relative, entry.isDirectory())
    if (entry.isDirectory()) walkFiles(file, callback, relative)
    else if (!entry.isFile()) throw invalid()
  }
}

function editorCandidate(value: string, version?: string): { path: string; version: string | null } | null {
  let executable = path.resolve(value)
  if (path.basename(executable).toLowerCase() !== 'unity.exe') executable = path.join(executable, 'Editor', 'Unity.exe')
  const inferred = version ?? /(?:^|[\\/])(202\d\.\d+\.\d+[abfp]\d+)(?:[\\/]|$)/.exec(executable)?.[1] ?? null
  if (inferred && !inferred.startsWith('2022.3.')) return null
  try {
    if (fs.statSync(executable).isFile()) return { path: executable, version: inferred }
  } catch { /* Missing installs remain picker-ready. */ }
  return null
}

/** Local-only install discovery. Never starts Hub or installs/downloads an editor. */
export function findUnityEditor(configured?: string): { path: string | null; version: string | null } {
  if (configured?.trim()) {
    const candidate = editorCandidate(configured.trim())
    if (candidate) return candidate
  }
  const home = os.homedir()
  const hubs = [path.join(process.env.APPDATA ?? path.join(home, 'AppData', 'Roaming'), 'UnityHub'),
    path.join(process.env.LOCALAPPDATA ?? path.join(home, 'AppData', 'Local'), 'UnityHub')]
  const installRoots = [path.join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Unity Hub', 'Editor'),
    path.join(process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)', 'Unity Hub', 'Editor')]
  for (const hub of hubs) {
    for (const filename of ['editors-v2.json', 'editors.json', 'installations.json']) {
      try {
        const file = path.join(hub, filename)
        if (fs.statSync(file).size > 2 * 1024 * 1024) continue
        const raw: unknown = JSON.parse(fs.readFileSync(file, 'utf8'))
        const candidates: { path: string; version: string | null }[] = []
        const visit = (value: unknown, inheritedVersion?: string): void => {
          if (!value || typeof value !== 'object') return
          if (Array.isArray(value)) { value.forEach(item => visit(item, inheritedVersion)); return }
          const item = value as Record<string, unknown>
          const version = typeof item.version === 'string' ? item.version : inheritedVersion
          for (const key of ['location', 'path', 'installPath']) {
            const paths = typeof item[key] === 'string' ? [item[key]] : Array.isArray(item[key]) ? item[key] : []
            for (const p of paths as unknown[]) if (typeof p === 'string') {
              const candidate = editorCandidate(p, version)
              if (candidate && candidate.version?.startsWith('2022.3.')) candidates.push(candidate)
            }
          }
          for (const entry of Object.values(item)) visit(entry, version)
        }
        visit(raw)
        if (candidates.length) return candidates.sort((a, b) => (b.version ?? '').localeCompare(a.version ?? '', undefined, { numeric: true }))[0]
      } catch { /* Other discovery locations may still work. */ }
    }
    try {
      const secondary = JSON.parse(fs.readFileSync(path.join(hub, 'secondaryInstallPath.json'), 'utf8'))
      if (typeof secondary === 'string') installRoots.push(secondary)
    } catch { /* No secondary install location. */ }
  }
  for (const installRoot of installRoots) {
    try {
      const versions = fs.readdirSync(installRoot).filter(v => /^2022\.3\.\d+[abfp]\d+$/.test(v))
        .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
      for (const version of versions) {
        const candidate = editorCandidate(path.join(installRoot, version), version)
        if (candidate) return candidate
      }
    } catch { /* Hub is optional. */ }
  }
  return { path: null, version: null }
}

function copyTrustedTemplate(destination: string): void {
  const source = bridgeTemplateRoot()
  for (const required of ['package.json', 'Editor/AVCABridge.cs', 'Editor/AVCAPreview.cs', 'Editor/AVCAPackageWorker.cs', 'Editor/AVCA.Bridge.asmdef']) {
    if (!fs.existsSync(path.join(source, required))) throw new Error('covers.bridgeMissing')
  }
  walkFiles(source, (file, relative, directory) => {
    const target = path.join(destination, relative)
    if (directory) fs.mkdirSync(target, { recursive: true })
    else { fs.mkdirSync(path.dirname(target), { recursive: true }); fs.copyFileSync(file, target) }
  })
}

function boundedMetadata(file: string): Buffer {
  const descriptor = fs.openSync(file, 'r')
  try {
    const size = fs.fstatSync(descriptor).size
    if (size > MAX_METADATA_BYTES) throw new Error('covers.inventoryLimited')
    // Read one extra byte to detect growth without allocating or reading an unbounded file.
    const bytes = Buffer.alloc(size + 1)
    let length = 0
    while (length < bytes.length) {
      const read = fs.readSync(descriptor, bytes, length, bytes.length - length, null)
      if (!read) break
      length += read
    }
    if (length !== size || fs.fstatSync(descriptor).size !== size) throw new Error('covers.sourceChanged')
    return bytes.subarray(0, size)
  } finally { fs.closeSync(descriptor) }
}

function renderingMetadata(file: string, folder: boolean): { guid: string; hash: string } {
  const bytes = boundedMetadata(file)
  const text = decodeUtf8Strict(bytes)?.replace(/^\uFEFF/, '')
  const formats = text && [...text.matchAll(/^fileFormatVersion:\s*([^\r\n]*)/gm)]
  const guids = text && [...text.matchAll(/^guid:\s*([^\r\n]*)/gm)]
  if (!text || !formats || formats.length !== 1 || formats[0][1].trim() !== '2'
    || !guids || guids.length !== 1 || !/^[a-f0-9]{32}$/i.test(guids[0][1].trim())
    || /^\s*(?:PluginImporter|ScriptedImporter|MonoImporter):/m.test(text)
    || /^folderAsset:\s*yes\s*$/m.test(text) !== folder) throw new Error('covers.sourceUnreadable')
  return { guid: guids[0][1].trim().toLowerCase(), hash: createHash('sha256').update(bytes).digest('hex') }
}

function copyLilToon(sourceProject: string, project: string, signal: AbortSignal): void {
  const source = path.join(sourceProject, 'Packages', 'jp.lilxyzw.liltoon')
  if (!fs.existsSync(source)) throw new Error('covers.dependencyMissing')
  const destination = path.join(project, 'Packages', 'jp.lilxyzw.liltoon')
  const renderFile = (relative: string): boolean => RENDER_EXTENSIONS.has(path.extname(relative).toLowerCase())
  const seenGuids = new Set<string>()
  const addGuid = (guid: string): void => {
    // Reject all duplicate GUIDs, including byte-identical copies. Two locations must never compete in Unity's database.
    if (seenGuids.has(guid)) throw new Error('covers.packageConflict')
    seenGuids.add(guid)
  }
  walkFiles(path.join(project, 'Assets'), (file, relative, directory) => {
    if (signal.aborted) throw cancelled()
    if (directory || !relative.toLowerCase().endsWith('.meta')) return
    const resource = file.slice(0, -5)
    if (!fs.existsSync(resource)) throw new Error('covers.sourceUnreadable')
    addGuid(renderingMetadata(file, fs.lstatSync(resource).isDirectory()).guid)
  })
  const files: { file: string; relative: string; metadata: boolean; folder: boolean }[] = []
  const neededFolders = new Set<string>()
  walkFiles(source, (file, relative, directory) => {
    if (signal.aborted) throw cancelled()
    if (directory || FORBIDDEN_EXTENSIONS.test(relative) || relative.split(path.sep).some(p => /^plugins?$/i.test(p))) return
    const metadata = relative.toLowerCase().endsWith('.meta')
    const assetRelative = metadata ? relative.slice(0, -5) : relative
    const asset = path.join(source, assetRelative)
    const folderMeta = metadata && fs.existsSync(asset) && fs.lstatSync(asset).isDirectory()
    if (!renderFile(assetRelative) && !folderMeta) return
    if (metadata && !fs.existsSync(asset)) throw new Error('covers.sourceUnreadable')
    files.push({ file, relative, metadata, folder: folderMeta })
    if (!metadata) {
      let parent = path.dirname(relative)
      while (parent !== '.') { neededFolders.add(parent); parent = path.dirname(parent) }
    }
  })
  const retained = files.filter(file => !file.folder || neededFolders.has(file.relative.slice(0, -5)))
  const metadataHashes = new Map<string, string>()
  // Validate the complete GUID namespace and bounded, paired metadata before writing any dependency bytes.
  for (const file of retained) if (file.metadata) {
    const metadata = renderingMetadata(file.file, file.folder)
    addGuid(metadata.guid); metadataHashes.set(file.relative, metadata.hash)
  }
  for (const file of retained) {
    if (signal.aborted) throw cancelled()
    const target = path.join(destination, file.relative)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    if (file.metadata) {
      const bytes = boundedMetadata(file.file)
      if (createHash('sha256').update(bytes).digest('hex') !== metadataHashes.get(file.relative)) throw new Error('covers.sourceChanged')
      // Write the validated bytes themselves; never reopen mutable user metadata through copyFile.
      fs.writeFileSync(target, bytes)
    } else fs.copyFileSync(file.file, target)
  }
  fs.mkdirSync(destination, { recursive: true })
  // The supplier manifest may contain executable dependency hooks or registry dependencies.
  // An embedded, dependency-free rendering package retains the paths and GUIDs Unity shaders use.
  fs.writeFileSync(path.join(destination, 'package.json'), JSON.stringify({ name: 'jp.lilxyzw.liltoon', version: '0.0.0', unity: '2022.3' }))
}

interface OwnedEditor {
  child: ChildProcess
  project: string
  exited: boolean
  error: Error | null
  exit: Promise<void>
}
export class PackagePreviewWorker {
  private readonly options: { manager: Pick<BridgeManager, 'execute'>; editorPath: () => string; dependencyProject: () => string | null }
  private owned: OwnedEditor | null = null
  private chain: Promise<unknown> = Promise.resolve()
  private active: AbortController | null = null
  private idle: NodeJS.Timeout | null = null
  private disposed = false
  private generation = 0
  private readonly onExit = (): void => { this.owned?.child.kill() }

  constructor(options: { manager: Pick<BridgeManager, 'execute'>; editorPath: () => string; dependencyProject: () => string | null }) {
    this.options = options
    process.once('exit', this.onExit)
  }

  private enqueue<T>(signal: AbortSignal, operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const generation = this.generation
    let started = false
    const run = async (): Promise<T> => {
      started = true
      if (signal.aborted || this.disposed || generation !== this.generation) throw cancelled()
      this.clearIdle()
      const controller = new AbortController(); this.active = controller
      const abort = (): void => controller.abort()
      signal.addEventListener('abort', abort, { once: true })
      if (signal.aborted) controller.abort()
      try { return await operation(controller.signal) }
      finally {
        signal.removeEventListener('abort', abort)
        if (controller.signal.aborted) await this.stopOwned()
        if (this.active === controller) this.active = null
        this.armIdle()
      }
    }
    const next = this.chain.then(run, run)
    this.chain = next.catch(() => undefined)
    // A cancelled queued job returns immediately. Its queued operation checks the signal again before writing.
    return new Promise<T>((resolve, reject) => {
      const abort = (): void => { if (!started) reject(cancelled()) }
      signal.addEventListener('abort', abort, { once: true })
      if (signal.aborted) abort()
      void next.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort))
    })
  }

  start(projectPath: string, signal: AbortSignal, progress: (stage: 'starting' | 'loading') => void): Promise<void> {
    return this.enqueue(signal, inner => this.startOwned(path.resolve(projectPath), inner, progress))
  }

  private async startOwned(project: string, signal: AbortSignal, progress: (stage: 'starting' | 'loading') => void): Promise<void> {
    project = validateOwned(project)
    if (this.owned?.project === project && !this.owned.exited) return
    await this.stopOwned()
    if (signal.aborted) throw cancelled()
    const editor = findUnityEditor(this.options.editorPath())
    if (!editor.path) throw new Error('covers.unityMissing')
    const assets = path.join(project, 'Assets')
    if (fs.existsSync(assets)) walkFiles(assets, (_file, relative) => { if (FORBIDDEN_EXTENSIONS.test(relative)) throw invalid() })
    // Validate the complete existing tree before overwriting any owned settings or trusted bridge.
    walkFiles(project, () => {})
    const packages = path.join(project, 'Packages')
    if (fs.existsSync(packages)) {
      for (const entry of fs.readdirSync(packages)) {
        if (!['com.avca.bridge', 'com.avca.bridge.meta', 'jp.lilxyzw.liltoon', 'jp.lilxyzw.liltoon.meta',
          'manifest.json', 'packages-lock.json'].includes(entry)) throw invalid()
      }
    }
    fs.mkdirSync(assets, { recursive: true })
    fs.mkdirSync(path.join(project, 'ProjectSettings'), { recursive: true })
    fs.mkdirSync(path.join(project, 'Packages'), { recursive: true })
    fs.writeFileSync(path.join(project, 'ProjectSettings', 'ProjectVersion.txt'), `m_EditorVersion: ${editor.version ?? '2022.3.22f1'}\n`)
    fs.writeFileSync(path.join(project, 'Packages', 'manifest.json'), JSON.stringify({ dependencies: {
      'com.unity.modules.animation': '1.0.0', 'com.unity.modules.imgui': '1.0.0',
      'com.unity.modules.jsonserialize': '1.0.0', 'com.unity.modules.imageconversion': '1.0.0',
      'com.unity.modules.physics': '1.0.0', 'com.unity.modules.particlesystem': '1.0.0'
    } }, null, 2))
    for (const packageName of ['com.avca.bridge', 'jp.lilxyzw.liltoon']) {
      const target = path.resolve(packages, packageName)
      if (!inside(project, target)) throw invalid()
      // Only these validated, caller-owned dependency directories may be replaced. Never remove the job or Assets.
      fs.rmSync(target, { recursive: true, force: true })
    }
    copyTrustedTemplate(path.join(packages, 'com.avca.bridge'))
    const dependency = this.options.dependencyProject()
    if (dependency) copyLilToon(dependency, project, signal)
    if (signal.aborted) throw cancelled()
    const mailbox = path.join(project, 'Temp', 'AVCABridge')
    fs.mkdirSync(mailbox, { recursive: true })
    for (const file of ['bridge.json', 'package-worker-shutdown.json', 'package-worker-ready.json', 'package-worker-owner.json']) {
      fs.rmSync(path.join(mailbox, file), { force: true })
    }
    progress('starting')
    const child = spawn(editor.path, ['-batchmode', '-projectPath', project, '-avcaPackagePreview',
      '-avcaPackagePreviewParentPid', String(process.pid),
      '-executeMethod', 'AVCA.Bridge.AVCAPackageWorker.Start', '-logFile', path.join(project, 'Logs', 'package-preview.log')],
    { stdio: 'ignore', windowsHide: true, shell: false })
    let resolveExit!: () => void
    const owned: OwnedEditor = { child, project, exited: false, error: null, exit: new Promise(resolve => { resolveExit = resolve }) }
    const exited = (): void => { owned.exited = true; resolveExit() }
    child.once('exit', exited)
    child.once('error', error => { owned.error = error; exited() })
    this.owned = owned
    const started = Date.now()
    try {
      if (!Number.isSafeInteger(child.pid) || (child.pid ?? 0) <= 0) throw new Error('covers.unityStartFailed')
      // This durable lease exists before the first compilation heartbeat, so restarted cache cleanup can see our child.
      // Retain it after exit; only a subsequent startup replaces it, and cleanup proves its pid is dead before removal.
      writeJsonAtomic(path.join(mailbox, 'package-worker-owner.json'), { pid: child.pid, projectPath: project, parentPid: process.pid })
      for (;;) {
        if (signal.aborted) throw cancelled()
        if (owned.exited) throw new Error('covers.unityStartFailed')
        const probe = readHeartbeat(project), heartbeat = probe.heartbeat
        if (heartbeat && !probe.invalid && heartbeat.pid === child.pid
          && samePath(heartbeat.projectPath, project) && probe.seenAt >= started
          && !heartbeat.isCompiling && !heartbeat.isUpdating && !heartbeat.isPlaying) {
          progress('loading'); return
        }
        if (Date.now() - started >= START_TIMEOUT_MS) throw new Error('covers.unityStartTimeout')
        await this.pause(100, owned.exit, signal)
      }
    } catch (error) { await this.stopOwned(); throw error }
  }

  execute(projectPath: string, type: BridgeCommandType, payload: unknown, signal: AbortSignal): Promise<BridgeExecResult> {
    return this.enqueue(signal, async inner => {
      const project = validateOwned(projectPath)
      await this.startOwned(project, inner, () => {})
      if (!['get_preview_candidates', 'get_preview_targets', 'render_preview'].includes(type)) throw invalid()
      const result = await this.options.manager.execute(project, type, payload, { signal: inner, ackTimeoutMs: 30_000 })
      if (inner.aborted) throw cancelled()
      return result
    })
  }

  stop(): Promise<void> {
    this.generation++; this.active?.abort(); this.clearIdle()
    const next = this.chain.then(() => this.stopOwned(), () => this.stopOwned())
    this.chain = next.catch(() => undefined)
    return next
  }

  private async stopOwned(): Promise<void> {
    const owned = this.owned
    if (!owned) return
    if (!owned.exited) {
      try {
        validateOwned(owned.project)
        writeJsonAtomic(path.join(owned.project, 'Temp', 'AVCABridge', 'package-worker-shutdown.json'), { pid: owned.child.pid })
      } catch { /* A removed/replaced project must not gain a shutdown write. The child handle still belongs to us. */ }
      await this.pause(STOP_TIMEOUT_MS, owned.exit)
      if (!owned.exited) {
        owned.child.kill()
        await this.pause(STOP_TIMEOUT_MS, owned.exit)
        if (!owned.exited) throw new Error('covers.unityStopFailed')
      }
    }
    if (this.owned === owned) this.owned = null
  }

  private async pause(ms: number, exit: Promise<void>, signal?: AbortSignal): Promise<void> {
    await new Promise<void>(resolve => {
      const done = (): void => { clearTimeout(timer); signal?.removeEventListener('abort', done); resolve() }
      const timer = setTimeout(done, ms)
      signal?.addEventListener('abort', done, { once: true })
      if (signal?.aborted) done()
      void exit.then(done)
    })
  }
  private clearIdle(): void { if (this.idle) clearTimeout(this.idle); this.idle = null }
  private armIdle(): void {
    this.clearIdle()
    if (this.disposed || !this.owned) return
    this.idle = setTimeout(() => { void this.stop().catch(() => undefined) }, IDLE_MS)
    this.idle.unref?.()
  }
  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    void this.stop().catch(() => { this.owned?.child.kill() }).finally(() => process.removeListener('exit', this.onExit))
  }
}
