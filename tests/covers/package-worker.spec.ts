import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { EventEmitter } from 'node:events'
import type { ChildProcess } from 'node:child_process'
import { setAppPathsForTest } from '../../src/main/services/paths'
import { PackagePreviewWorker, ensurePackagePreviewProject, findUnityEditor, PACKAGE_PREVIEW_MARKER } from '../../src/main/covers/packageWorker'
import { isUnityProject, scanProjectRoots, readVccManifest } from '../../src/main/project/api'

const mocked = vi.hoisted(() => ({ spawn: vi.fn() }))
vi.mock('node:child_process', async () => ({ ...await vi.importActual<object>('node:child_process'), spawn: mocked.spawn }))
vi.mock('electron', () => ({ app: {} }))
const success = { ok: true, status: 'ok' as const, data: { targets: [] }, error: null,
  stackTrace: null, elapsedMs: 0, retries: 0, commandId: 'test' }
class Editor extends EventEmitter {
  pid = 3000 + children.length
  exitCode: number | null = null
  signalCode: string | null = null
  kills = 0
  kill(): boolean { this.kills++; this.exit(); return true }
  exit(code = 0): void { if (this.exitCode !== null) return; this.exitCode = code; this.emit('exit', code, null) }
}
let root: string, app: string, project: string, editorPath: string, dependency: string | null
let worker: PackagePreviewWorker, children: Editor[], stages: string[], commands: string[]
let ready: boolean, acknowledgeShutdown: boolean
const A = 'a'.repeat(32), B = 'b'.repeat(32)
const shaderMeta = (guid: string): string => `fileFormatVersion: 2\nguid: ${guid}\nShaderImporter:\n  externalObjects: {}\n`
function dependencyFiles(files: Record<string, string | Buffer>): string {
  dependency = path.join(root, 'registered')
  const lil = path.join(dependency, 'Packages', 'jp.lilxyzw.liltoon')
  fs.mkdirSync(lil, { recursive: true })
  for (const [relative, value] of Object.entries(files)) {
    const file = path.join(lil, relative); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, value)
  }
  return lil
}
function heartbeat(p: string, pid: number): void {
  const dir = path.join(p, 'Temp', 'AVCABridge'); fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'bridge.json'), JSON.stringify({ protocolVersion: 1, bridgeVersion: '1.2.0',
    pid, projectPath: p, projectName: 'Preview', unityVersion: '2022.3.22f1', capabilities: ['object_preview','preview_candidates'],
    isPlaying: false, isCompiling: false, isUpdating: false, queueLength: 0, heartbeatUtc: Date.now() }))
  fs.utimesSync(path.join(dir, 'bridge.json'), new Date(Date.now()), new Date(Date.now()))
}
async function settle<T>(pending: Promise<T>, ms = 500): Promise<T> {
  const result = pending.then(value => ({ value }), error => ({ error }))
  await vi.advanceTimersByTimeAsync(ms)
  const outcome = await result
  if ('error' in outcome) throw outcome.error
  return outcome.value
}
beforeEach(() => {
  vi.useFakeTimers(); children = []; stages = []; commands = []; ready = true; acknowledgeShutdown = true
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'avca-package-worker-')))
  app = path.join(root, 'app'); setAppPathsForTest(app)
  project = path.join(app, 'cover-previews', 'one'); ensurePackagePreviewProject(project)
  editorPath = path.join(root, '2022.3.22f1', 'Editor', 'Unity.exe')
  fs.mkdirSync(path.dirname(editorPath), { recursive: true }); fs.writeFileSync(editorPath, '')
  dependency = null
  vi.stubEnv('APPDATA', path.join(root, 'roaming')); vi.stubEnv('LOCALAPPDATA', path.join(root, 'local'))
  vi.stubEnv('ProgramFiles', path.join(root, 'program')); vi.stubEnv('ProgramFiles(x86)', path.join(root, 'program-x86'))
  vi.spyOn(os, 'homedir').mockReturnValue(root)
  mocked.spawn.mockReset().mockImplementation((exe: string, args: string[], opts: { shell?: boolean; windowsHide?: boolean }) => {
    expect(exe).toBe(editorPath); expect(opts.shell).not.toBe(true); expect(opts.windowsHide).toBe(true)
    const p = args[args.indexOf('-projectPath') + 1]
    expect(args).toContain('-avcaPackagePreview'); expect(args).not.toContain('-nographics')
    expect(args[args.indexOf('-avcaPackagePreviewParentPid') + 1]).toBe(String(process.pid))
    const child = new Editor(); children.push(child)
    if (ready) setTimeout(() => heartbeat(p, child.pid), 50)
    const timer = setInterval(() => {
      if (acknowledgeShutdown && fs.existsSync(path.join(p, 'Temp', 'AVCABridge', 'package-worker-shutdown.json'))) child.exit()
      if (child.exitCode !== null) clearInterval(timer)
    }, 50)
    return child as unknown as ChildProcess
  })
  worker = new PackagePreviewWorker({ editorPath: () => editorPath, dependencyProject: () => dependency,
    manager: { execute: async (p, type, _payload, opts) => {
      expect(p).toBe(project); expect(opts?.signal).toBeDefined(); commands.push(type); return success
    } } })
})
afterEach(async () => {
  worker.dispose(); await vi.advanceTimersByTimeAsync(10_000); vi.useRealTimers()
  vi.restoreAllMocks(); vi.unstubAllEnvs(); fs.rmSync(root, { recursive: true, force: true })
})

describe('owned package preview editor', () => {
  it('reports absent editors without creating settings or spawning a process', async () => {
    fs.rmSync(editorPath); expect(findUnityEditor()).toEqual({ path: null, version: null })
    await expect(worker.start(project, new AbortController().signal, s => stages.push(s))).rejects.toThrow('covers.unityMissing')
    expect(fs.existsSync(path.join(project, 'ProjectSettings'))).toBe(false); expect(children).toHaveLength(0)
  })
  it('prefers the configured installation and finds the Unity Hub v2 install metadata', () => {
    const hub = path.join(root, 'roaming', 'UnityHub'); fs.mkdirSync(hub, { recursive: true })
    fs.writeFileSync(path.join(hub, 'editors-v2.json'), JSON.stringify({ schema_version: '2', data: [
      { version: '2022.3.22f1', location: [editorPath], manual: true } ] }))
    expect(findUnityEditor(editorPath)).toEqual({ path: editorPath, version: '2022.3.22f1' })
    expect(findUnityEditor(path.join(root, 'missing.exe'))).toEqual({ path: editorPath, version: '2022.3.22f1' })
  })
  it('rejects source projects, missing or forged ownership markers before any writes', async () => {
    const source = path.join(root, 'user'); fs.mkdirSync(source)
    expect(() => ensurePackagePreviewProject(source)).toThrow('covers.invalidRequest')
    await expect(worker.start(source, new AbortController().signal, () => {})).rejects.toThrow('covers.invalidRequest')
    fs.rmSync(path.join(project, PACKAGE_PREVIEW_MARKER))
    await expect(worker.start(project, new AbortController().signal, () => {})).rejects.toThrow('covers.invalidRequest')
    fs.writeFileSync(path.join(project, PACKAGE_PREVIEW_MARKER), JSON.stringify({ kind: 'atrium-package-preview', version: 1, projectPath: source }))
    await expect(worker.start(project, new AbortController().signal, () => {})).rejects.toThrow('covers.invalidRequest')
    expect(fs.readdirSync(source)).toEqual([]); expect(children).toHaveLength(0)
  })
  it('accepts a non-link app-home alias whose canonical root owns the project', async () => {
    const alias = path.join(root, 'app-alias'); fs.mkdirSync(alias)
    setAppPathsForTest(alias)
    const realpath = fs.realpathSync.bind(fs)
    vi.spyOn(fs, 'realpathSync').mockImplementation(((file: fs.PathLike, options?: unknown) =>
      String(file) === alias ? app : realpath(file, options as never)) as typeof fs.realpathSync)
    await settle(worker.start(project, new AbortController().signal, () => {}))
    expect(children).toHaveLength(1)
  })
  it('rejects links in prepared Assets rather than importing source scripts', async () => {
    fs.mkdirSync(path.join(project, 'Assets')); fs.mkdirSync(path.join(root, 'outside'))
    fs.symlinkSync(path.join(root, 'outside'), path.join(project, 'Assets', 'linked'), 'junction')
    await expect(worker.start(project, new AbortController().signal, () => {})).rejects.toThrow('covers.invalidRequest')
    expect(children).toHaveLength(0)
  })
  it('refuses supplied executable resources even in a marked project', async () => {
    fs.mkdirSync(path.join(project, 'Assets')); fs.writeFileSync(path.join(project, 'Assets', 'supplier.cs'), 'unsafe')
    await expect(worker.start(project, new AbortController().signal, () => {})).rejects.toThrow('covers.invalidRequest')
    expect(children).toHaveLength(0)
  })
  it('creates a trusted Built-in project and retains prepared render assets', async () => {
    fs.mkdirSync(path.join(project, 'Assets')); fs.writeFileSync(path.join(project, 'Assets', 'Prop.prefab'), 'model')
    await settle(worker.start(project, new AbortController().signal, s => stages.push(s)))
    expect(stages).toEqual(['starting','loading']); expect(children).toHaveLength(1)
    expect(fs.readFileSync(path.join(project, 'Assets', 'Prop.prefab'), 'utf8')).toBe('model')
    expect(fs.existsSync(path.join(project, 'Packages', 'com.avca.bridge', 'Editor', 'AVCAPackageWorker.cs'))).toBe(true)
    const manifest = JSON.parse(fs.readFileSync(path.join(project, 'Packages', 'manifest.json'), 'utf8'))
    expect(Object.keys(manifest.dependencies).some(key => /render-pipelines|vrchat|modular-avatar/.test(key))).toBe(false)
    await worker.execute(project, 'get_preview_candidates', { guids: [] }, new AbortController().signal)
    expect(commands).toEqual(['get_preview_candidates'])
  })
  it('copies lilToon rendering resources and matching metadata while excluding all supplier code', async () => {
    dependency = path.join(root, 'registered'); const lil = path.join(dependency, 'Packages', 'jp.lilxyzw.liltoon')
    fs.mkdirSync(path.join(lil, 'Editor'), { recursive: true }); fs.mkdirSync(path.join(lil, 'Shader'))
    const files = { 'package.json': '{"name":"jp.lilxyzw.liltoon","version":"2.3.4"}',
      'Shader/render.shader': 'Shader "lilToon" {}', 'Shader/render.shader.meta': shaderMeta(B),
      'Shader/include.hlsl': 'float4 colour;', 'Editor/exec.cs': 'danger', 'Editor/exec.cs.meta': 'guid: bad',
      'malware.dll': 'danger', 'plugin.asmdef': 'danger' }
    for (const [rel, value] of Object.entries(files)) fs.writeFileSync(path.join(lil, rel), value)
    await settle(worker.start(project, new AbortController().signal, () => {}))
    const out = path.join(project, 'Packages', 'jp.lilxyzw.liltoon')
    expect(fs.readFileSync(path.join(out, 'Shader', 'render.shader.meta'), 'utf8')).toBe(shaderMeta(B))
    expect(fs.readFileSync(path.join(out, 'Shader', 'include.hlsl'), 'utf8')).toBe('float4 colour;')
    expect(fs.existsSync(path.join(out, 'Editor', 'exec.cs'))).toBe(false)
    expect(fs.existsSync(path.join(out, 'Editor', 'exec.cs.meta'))).toBe(false)
    expect(fs.existsSync(path.join(out, 'malware.dll'))).toBe(false)
    expect(fs.readFileSync(path.join(lil, 'Editor', 'exec.cs'), 'utf8')).toBe('danger')
  })
  it.each(['different bytes', 'identical bytes'])('rejects source/dependency duplicate GUIDs before spawn, including %s', async variant => {
    const source = path.join(project, 'Assets', 'Source.shader'); fs.mkdirSync(path.dirname(source))
    fs.writeFileSync(source, 'Shader "Source" {}'); fs.writeFileSync(source + '.meta', shaderMeta(A))
    const supplied = variant === 'identical bytes' ? 'Shader "Source" {}' : 'Shader "Dependency" {}'
    const lil = dependencyFiles({ 'Shader/render.shader': supplied,
      'Shader/render.shader.meta': shaderMeta(variant === 'identical bytes' ? A : A.toUpperCase()) })
    await expect(settle(worker.start(project, new AbortController().signal, () => {}))).rejects.toThrow('covers.packageConflict')
    expect(children).toHaveLength(0)
    expect(fs.readFileSync(source, 'utf8')).toBe('Shader "Source" {}')
    expect(fs.readFileSync(source + '.meta', 'utf8')).toBe(shaderMeta(A))
    expect(fs.readFileSync(path.join(lil, 'Shader/render.shader'), 'utf8')).toBe(supplied)
  })
  it('rejects duplicate dependency GUIDs instead of letting Unity reassign one', async () => {
    dependencyFiles({ 'Shader/one.shader': 'one', 'Shader/one.shader.meta': shaderMeta(A),
      'Shader/two.shader': 'two', 'Shader/two.shader.meta': shaderMeta(A) })
    await expect(settle(worker.start(project, new AbortController().signal, () => {}))).rejects.toThrow('covers.packageConflict')
    expect(children).toHaveLength(0)
  })
  it.each([
    ['malformed GUID', 'fileFormatVersion: 2\nguid: short\nShaderImporter: {}'],
    ['duplicate GUID key', shaderMeta(A) + `guid: ${B}\n`],
    ['missing format', `guid: ${A}\nShaderImporter: {}`],
    ['executable importer', `fileFormatVersion: 2\nguid: ${A}\nPluginImporter: {}`],
    ['scripted importer', `fileFormatVersion: 2\nguid: ${A}\nScriptedImporter: {}`],
    ['indented executable importer', `fileFormatVersion: 2\nguid: ${A}\n  MonoImporter: {}`],
    ['folder metadata on a file', shaderMeta(A) + 'folderAsset: yes\n'],
    ['invalid UTF-8', Buffer.concat([Buffer.from(shaderMeta(A)), Buffer.from([0xff])])]
  ])('rejects %s in rendering dependency metadata before spawn', async (_name, metadata) => {
    dependencyFiles({ 'Shader/render.shader': 'Shader "Dependency" {}', 'Shader/render.shader.meta': metadata })
    await expect(settle(worker.start(project, new AbortController().signal, () => {}))).rejects.toThrow('covers.sourceUnreadable')
    expect(children).toHaveLength(0)
  })
  it('bounds dependency metadata before reading it', async () => {
    dependencyFiles({ 'Shader/render.shader': 'Shader "Dependency" {}',
      'Shader/render.shader.meta': shaderMeta(A) + ' '.repeat(1024 * 1024) })
    await expect(settle(worker.start(project, new AbortController().signal, () => {}))).rejects.toThrow('covers.inventoryLimited')
    expect(children).toHaveLength(0)
  })
  it('rejects orphan rendering metadata rather than copying a GUID without its asset', async () => {
    dependencyFiles({ 'Shader/missing.shader.meta': shaderMeta(A) })
    await expect(settle(worker.start(project, new AbortController().signal, () => {}))).rejects.toThrow('covers.sourceUnreadable')
    expect(children).toHaveLength(0)
  })
  it('rejects dependency metadata changes after validation instead of introducing a colliding GUID', async () => {
    const source = path.join(project, 'Assets', 'Source.shader'); fs.mkdirSync(path.dirname(source))
    fs.writeFileSync(source, 'Source'); fs.writeFileSync(source + '.meta', shaderMeta(A))
    const lil = dependencyFiles({ 'Shader/render.shader': 'Dependency', 'Shader/render.shader.meta': shaderMeta(B) })
    const copy = fs.copyFileSync.bind(fs)
    vi.spyOn(fs, 'copyFileSync').mockImplementation((from, to, flags) => {
      copy(from, to, flags)
      if (String(from) === path.join(lil, 'Shader', 'render.shader')) {
        fs.writeFileSync(path.join(lil, 'Shader', 'render.shader.meta'), shaderMeta(A))
      }
    })
    await expect(settle(worker.start(project, new AbortController().signal, () => {}))).rejects.toThrow('covers.sourceChanged')
    expect(children).toHaveLength(0)
  })
  it('does not reuse a heartbeat from an unrelated editor pid', async () => {
    ready = false; heartbeat(project, 42)
    const pending = worker.start(project, new AbortController().signal, () => {})
    await expect(settle(pending, 126_000)).rejects.toThrow('covers.unityStartTimeout')
    expect(children[0].exitCode).not.toBeNull()
  })
  it('records its held child lease before a startup heartbeat and retains the lease after exit', async () => {
    ready = false
    const mailbox = path.join(project, 'Temp', 'AVCABridge'); fs.mkdirSync(mailbox, { recursive: true })
    const lease = path.join(mailbox, 'package-worker-owner.json')
    fs.writeFileSync(lease, JSON.stringify({ pid: 42, projectPath: project, parentPid: 1 }))
    const abort = new AbortController()
    const pending = worker.start(project, abort.signal, () => {})
    const outcome = pending.then(() => null, error => error)
    await vi.advanceTimersByTimeAsync(20)
    expect(fs.existsSync(path.join(mailbox, 'bridge.json'))).toBe(false)
    expect(JSON.parse(fs.readFileSync(lease, 'utf8'))).toEqual({ pid: children[0].pid, projectPath: project, parentPid: process.pid })
    abort.abort(); await vi.advanceTimersByTimeAsync(10_000)
    expect((await outcome).message).toBe('covers.cancelled')
    expect(JSON.parse(fs.readFileSync(lease, 'utf8')).pid).toBe(children[0].pid)
  })
  it('stops its held child when the startup lease cannot be written', async () => {
    const write = fs.writeFileSync.bind(fs)
    vi.spyOn(fs, 'writeFileSync').mockImplementation((file, data, options) => {
      if (String(file).endsWith('package-worker-owner.json.tmp')) throw new Error('lease write failed')
      write(file, data, options)
    })
    await expect(settle(worker.start(project, new AbortController().signal, stage => stages.push(stage)))).rejects.toThrow('lease write failed')
    expect(children).toHaveLength(1); expect(children[0].exitCode).not.toBeNull()
    expect(stages).not.toContain('loading')
  })
  it('rejects early process exits promptly', async () => {
    ready = false
    const pending = worker.start(project, new AbortController().signal, () => {})
    await vi.advanceTimersByTimeAsync(20); children[0].exit(1)
    await expect(settle(pending)).rejects.toThrow('covers.unityStartFailed')
  })
  it('cancels startup and stops only its held child', async () => {
    ready = false; const abort = new AbortController()
    const pending = worker.start(project, abort.signal, () => {})
    await vi.advanceTimersByTimeAsync(20); abort.abort()
    await expect(settle(pending)).rejects.toThrow('covers.cancelled')
    expect(children).toHaveLength(1); expect(children[0].exitCode).not.toBeNull()
  })
  it('returns an active cancellation only after its held process has exited', async () => {
    ready = false; acknowledgeShutdown = false; const abort = new AbortController()
    let finished = false
    const pending = worker.start(project, abort.signal, () => {}).catch(error => { finished = true; throw error })
    const outcome = pending.then(() => null, error => error)
    await vi.advanceTimersByTimeAsync(20); abort.abort(); await vi.advanceTimersByTimeAsync(100)
    expect(finished).toBe(false); expect(children[0].exitCode).toBeNull()
    await vi.advanceTimersByTimeAsync(10_000)
    expect((await outcome).message).toBe('covers.cancelled'); expect(children[0].exitCode).not.toBeNull()
  })
  it('cancels a queued startup immediately without launching or replacing the current child', async () => {
    ready = false; const activeAbort = new AbortController(), queuedAbort = new AbortController()
    const first = worker.start(project, activeAbort.signal, () => {})
    const firstOutcome = first.then(() => null, error => error)
    await vi.advanceTimersByTimeAsync(20)
    const next = path.join(app, 'cover-previews', 'two'); ensurePackagePreviewProject(next)
    const queued = worker.start(next, queuedAbort.signal, () => {})
    queuedAbort.abort(); await expect(queued).rejects.toThrow('covers.cancelled')
    expect(children).toHaveLength(1); expect(children[0].exitCode).toBeNull()
    activeAbort.abort(); await vi.advanceTimersByTimeAsync(10_000); await firstOutcome
    expect(children).toHaveLength(1)
  })
  it('rejects injected packages and removes stale code from the trusted bridge before launching', async () => {
    const bridge = path.join(project, 'Packages', 'com.avca.bridge', 'Editor')
    fs.mkdirSync(bridge, { recursive: true }); fs.writeFileSync(path.join(bridge, 'Supplier.cs'), 'malicious')
    await settle(worker.start(project, new AbortController().signal, () => {}))
    expect(fs.existsSync(path.join(bridge, 'Supplier.cs'))).toBe(false)
    await settle(worker.stop())
    fs.mkdirSync(path.join(project, 'Packages', 'supplier-sdk')); fs.writeFileSync(path.join(project, 'Packages', 'supplier-sdk', 'code.cs'), 'malicious')
    await expect(worker.start(project, new AbortController().signal, () => {})).rejects.toThrow('covers.invalidRequest')
    expect(children).toHaveLength(1)
  })
  it('closes the old owned process before starting a different package project', async () => {
    await settle(worker.start(project, new AbortController().signal, () => {}))
    const next = path.join(app, 'cover-previews', 'two'); ensurePackagePreviewProject(next)
    await settle(worker.start(next, new AbortController().signal, () => {}))
    expect(children).toHaveLength(2); expect(children[0].exitCode).toBe(0); expect(children[1].exitCode).toBeNull()
    expect(fs.existsSync(project)).toBe(true)
  })
  it('uses child.kill after bounded graceful shutdown and never invokes a process-name terminator', async () => {
    await settle(worker.start(project, new AbortController().signal, () => {})); acknowledgeShutdown = false
    await settle(worker.stop(), 10_000)
    expect(children[0].kills).toBe(1); expect(children).toHaveLength(1)
    expect(fs.existsSync(path.join(project, PACKAGE_PREVIEW_MARKER))).toBe(true)
  })
  it('closes idle editors and rejects operations after disposal', async () => {
    await settle(worker.start(project, new AbortController().signal, () => {}))
    await vi.advanceTimersByTimeAsync(310_000); expect(children[0].exitCode).toBe(0)
    worker.dispose()
    await expect(worker.start(project, new AbortController().signal, () => {})).rejects.toThrow('covers.cancelled')
  })
  it('never discovers an internal project from scanning or VCC entries', async () => {
    await settle(worker.start(project, new AbortController().signal, () => {}))
    expect(isUnityProject(project)).toBe(false)
    expect(scanProjectRoots([app], 5)).toEqual([])
    const vcc = path.join(root, 'vcc.json'); fs.writeFileSync(vcc, JSON.stringify({ userProjects: [project] }))
    expect(readVccManifest(vcc).projects).toEqual([])
    const nested = path.join(project, 'Assets', 'nested-project', 'ProjectSettings')
    fs.mkdirSync(nested, { recursive: true }); fs.writeFileSync(path.join(nested, 'ProjectVersion.txt'), 'm_EditorVersion: 2022.3.22f1')
    expect(scanProjectRoots([project], 5)).toEqual([])
  })
})
