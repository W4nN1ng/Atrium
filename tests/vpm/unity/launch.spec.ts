import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { ChildProcess } from 'node:child_process'
import { UnityLaunchService, sanitizeArgs } from '../../../src/main/vpm/unity'
import type { UnityInstall } from '../../../src/main/vpm/unity'

let root: string
let projectPath: string

function install(overrides: Partial<UnityInstall> = {}): UnityInstall {
  return {
    id: 'hub:2022.3.22f1',
    path: path.join(root, 'Unity', '2022.3.22f1', 'Editor', 'Unity.exe'),
    version: '2022.3.22f1',
    versionWithRevision: null,
    source: 'hub',
    arch: 'x86_64',
    archInferred: false,
    versionUnknown: false,
    missing: false,
    lastSeenAt: 1,
    ...overrides
  }
}

function touchExe(target: string): string {
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, '')
  return target
}

function fakeChild(options: { throwOnSpawn?: boolean } = {}): ChildProcess {
  return {
    pid: 4242,
    unref: vi.fn(),
    once: vi.fn()
  } as unknown as ChildProcess
}

function codeOf(promise: Promise<unknown>): Promise<string | null> {
  return promise.then(
    () => null,
    (error: { code?: string }) => error.code ?? 'unknown'
  )
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'atrium-launch-'))
  projectPath = path.join(root, 'project')
  fs.mkdirSync(path.join(projectPath, 'ProjectSettings'), { recursive: true })
  fs.writeFileSync(
    path.join(projectPath, 'ProjectSettings', 'ProjectVersion.txt'),
    'm_EditorVersion: 2022.3.22f1\n'
  )
})

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true })
})

describe('resolveEditor', () => {
  it('matches by ProjectVersion base version and prefers the exact build', () => {
    const older = install({ id: 'hub:a', path: touchExe(path.join(root, 'a', 'Unity.exe')), version: '2022.3.10f1' })
    const exact = install({ path: touchExe(path.join(root, 'b', 'Unity.exe')) })
    const other = install({ id: 'hub:c', path: touchExe(path.join(root, 'c', 'Unity.exe')), version: '2021.3.0f1' })

    const service = new UnityLaunchService({ installs: () => [older, exact, other] })
    const resolved = service.resolveEditor(projectPath)
    expect(resolved.source).toBe('version')
    expect(resolved.install.version).toBe('2022.3.22f1')
  })

  it('uses the project stored exe before matching by version', () => {
    const stored = touchExe(path.join(root, 'stored', 'Unity.exe'))
    const service = new UnityLaunchService({
      installs: () => [install({ path: touchExe(path.join(root, 'hub', 'Unity.exe')) })],
      projectExePath: () => stored
    })
    const resolved = service.resolveEditor(projectPath)
    expect(resolved.source).toBe('project')
    expect(resolved.install.path).toBe(stored)
  })

  it('honours an explicit editor path without touching the version file', () => {
    const explicit = touchExe(path.join(root, 'custom', 'Unity.exe'))
    const service = new UnityLaunchService({ installs: () => [] })
    const resolved = service.resolveEditor(projectPath, explicit)
    expect(resolved.source).toBe('explicit')
    expect(resolved.install.path).toBe(explicit)
    expect(resolved.install.version).toBeNull()
  })

  it('reports vpmUnityNotFound instead of guessing another version', async () => {
    const service = new UnityLaunchService({
      installs: () => [install({ version: '2021.3.0f1', path: touchExe(path.join(root, 'x', 'Unity.exe')) })]
    })
    expect(() => service.resolveEditor(projectPath)).toThrow(
      expect.objectContaining({ code: 'vpmUnityNotFound' })
    )

    const missingVersion = path.join(root, 'no-version')
    fs.mkdirSync(missingVersion, { recursive: true })
    expect(() => service.resolveEditor(missingVersion)).toThrow(
      expect.objectContaining({ code: 'vpmUnityNotFound' })
    )
  })
})

describe('arguments', () => {
  it('builds an argv array and never a shell string', () => {
    const service = new UnityLaunchService({ installs: () => [] })
    expect(service.buildArgs('C:\\Demo', ['-batchmode'])).toEqual([
      '-projectPath',
      'C:\\Demo',
      '-batchmode'
    ])
  })

  it('rejects args that could change process semantics', () => {
    expect(() => sanitizeArgs(['ok'])).not.toThrow()
    expect(() => sanitizeArgs(['bad\narg'])).toThrow(expect.objectContaining({ code: 'vpmUnityLaunchFailed' }))
    expect(() => sanitizeArgs(['bad\0arg'])).toThrow(expect.objectContaining({ code: 'vpmUnityLaunchFailed' }))
    expect(() => sanitizeArgs([''])).toThrow(expect.objectContaining({ code: 'vpmUnityLaunchFailed' }))
    expect(() => sanitizeArgs([42 as unknown as string])).toThrow(
      expect.objectContaining({ code: 'vpmUnityLaunchFailed' })
    )
    expect(() => sanitizeArgs(Array.from({ length: 65 }, (_, i) => `-a${i}`))).toThrow(
      expect.objectContaining({ code: 'vpmUnityLaunchFailed' })
    )
  })
})

describe('launch', () => {
  it('binds the import target before spawning and detaches the process', async () => {
    const order: string[] = []
    const exe = touchExe(path.join(root, 'editor', 'Unity.exe'))
    const spawn = vi.fn(
      (_command: string, _args: readonly string[], _options: Record<string, unknown>) => {
        order.push('spawn')
        return fakeChild()
      }
    )
    const service = new UnityLaunchService({
      installs: () => [install({ path: exe })],
      spawn,
      exists: () => true
    })

    const result = await service.launch({
      projectPath,
      bindTarget: () => order.push('bind'),
      clearTarget: () => order.push('clear')
    })

    expect(order).toEqual(['bind', 'spawn'])
    expect(result).toMatchObject({ status: 'launched', exePath: exe, pid: 4242 })
    expect(result.args).toEqual(['-projectPath', projectPath])
    const options = spawn.mock.calls[0][2]
    expect(options).toMatchObject({ detached: true, stdio: 'ignore', shell: false, windowsHide: true })
    expect(options.cwd).toBe(projectPath)
  })

  it('does not spawn twice when the project is already running, but still binds it', async () => {
    const spawn = vi.fn(() => fakeChild())
    const service = new UnityLaunchService({
      installs: () => [install({ path: touchExe(path.join(root, 'editor', 'Unity.exe')) })],
      isRunning: () => true,
      spawn,
      exists: () => true
    })
    const bind = vi.fn()
    const result = await service.launch({ projectPath, bindTarget: bind })

    expect(result.status).toBe('alreadyRunning')
    expect(spawn).not.toHaveBeenCalled()
    expect(bind).toHaveBeenCalledWith(projectPath)
  })

  it('clears the binding when spawning throws', async () => {
    const clear = vi.fn()
    const service = new UnityLaunchService({
      installs: () => [install({ path: touchExe(path.join(root, 'editor', 'Unity.exe')) })],
      spawn: () => {
        throw new Error('spawn exploded')
      },
      exists: () => true
    })
    expect(
      await codeOf(service.launch({ projectPath, bindTarget: () => undefined, clearTarget: clear }))
    ).toBe('vpmUnityLaunchFailed')
    expect(clear).toHaveBeenCalledWith(projectPath)
  })

  it('refuses a project without ProjectVersion.txt', async () => {
    const bare = path.join(root, 'bare')
    fs.mkdirSync(bare, { recursive: true })
    const service = new UnityLaunchService({ installs: () => [install()] })
    expect(await codeOf(service.launch({ projectPath: bare }))).toBe('vpmProjectInvalid')
    expect(await codeOf(service.launch({ projectPath: path.join(root, 'missing') }))).toBe(
      'vpmProjectInvalid'
    )
  })
})

describe('hub launch and verification', () => {
  it('prefers the unityhub:// protocol when Hub is available', async () => {
    const exe = touchExe(path.join(root, 'editor', 'Unity.exe'))
    const opened: string[] = []
    const spawn = vi.fn(
      (_command: string, _args: readonly string[], _options: Record<string, unknown>) =>
        fakeChild()
    )
    const service = new UnityLaunchService({
      installs: () => [install({ path: exe })],
      spawn,
      openExternal: (url) => {
        opened.push(url)
      },
      hubPath: () => 'C:////Program Files\\Unity Hub\\Unity Hub.exe',
      exists: () => true
    })

    const result = await service.launch({ projectPath })

    expect(spawn).not.toHaveBeenCalled()
    expect(opened).toHaveLength(1)
    expect(opened[0].startsWith('unityhub://2022.3.22f1/')).toBe(true)
    expect(opened[0]).toContain(projectPath.replace(/\\/g, '/'))
    expect(result).toMatchObject({ status: 'launched', viaHub: true, verified: true })
  })

  it('falls back to the exe when custom args are present', async () => {
    const exe = touchExe(path.join(root, 'editor', 'Unity.exe'))
    const spawn = vi.fn(
      (_command: string, _args: readonly string[], _options: Record<string, unknown>) =>
        fakeChild()
    )
    const opened: string[] = []
    const service = new UnityLaunchService({
      installs: () => [install({ path: exe })],
      spawn,
      openExternal: (url) => {
        opened.push(url)
      },
      hubPath: () => 'hub.exe',
      exists: () => true
    })

    const result = await service.launch({ projectPath, extraArgs: ['-batchmode'] })
    expect(opened).toEqual([])
    expect(spawn).toHaveBeenCalledTimes(1)
    expect(result).toMatchObject({ status: 'launched', viaHub: false })
  })

  it('reports unverified and clears the binding when the project never opens', async () => {
    const exe = touchExe(path.join(root, 'editor', 'Unity.exe'))
    const clear = vi.fn()
    const service = new UnityLaunchService({
      installs: () => [install({ path: exe })],
      spawn: () => fakeChild(),
      exists: () => false,
      verifyTimeoutMs: 20,
      verifyIntervalMs: 5,
      sleep: async () => undefined
    })

    const result = await service.launch({
      projectPath,
      bindTarget: () => undefined,
      clearTarget: clear
    })
    expect(result).toMatchObject({ status: 'unverified', verified: false })
    expect(clear).toHaveBeenCalledWith(projectPath)
  })
})
