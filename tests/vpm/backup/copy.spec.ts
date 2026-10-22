import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { ProjectCopyService } from '../../../src/main/vpm/backup'
import {
  UnityVersionService,
  readProjectVersionFile,
  renderProjectVersionFile
} from '../../../src/main/vpm/unity'
import type { ProjectsService } from '../../../src/main/vpm/projects'
import type { UnityInstall } from '../../../src/main/vpm/unity'

let root: string
let source: string
let addExisting: ReturnType<typeof vi.fn>

const KEY = 'c:\\demo'

function project(pathValue: string, running = false) {
  return { projectKey: KEY, name: 'Demo', path: pathValue, running, unityVersion: '2022.3.22f1' }
}

function codeOf(promise: Promise<unknown>): Promise<string | null> {
  return promise.then(
    () => null,
    (error: { code?: string }) => error.code ?? 'unknown'
  )
}

function install(version: string): UnityInstall {
  return {
    id: `hub:${version}`,
    path: path.join(root, 'Unity', version, 'Unity.exe'),
    version,
    versionWithRevision: null,
    source: 'hub',
    arch: 'x86_64',
    archInferred: false,
    versionUnknown: false,
    missing: false,
    lastSeenAt: 1
  }
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'atrium-copy-'))
  source = path.join(root, 'source')
  fs.mkdirSync(path.join(source, 'Assets'), { recursive: true })
  fs.mkdirSync(path.join(source, 'ProjectSettings'), { recursive: true })
  fs.mkdirSync(path.join(source, 'Logs'), { recursive: true })
  fs.writeFileSync(path.join(source, 'Assets', 'A.prefab'), 'a')
  fs.writeFileSync(path.join(source, 'Logs', 'Editor.log'), 'log')
  fs.writeFileSync(
    path.join(source, 'ProjectSettings', 'ProjectVersion.txt'),
    'm_EditorVersion: 2022.3.22f1\n'
  )
  addExisting = vi.fn()
})

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true })
})

describe('copy project', () => {
  function service(running = false): ProjectCopyService {
    return new ProjectCopyService({
      projects: { get: () => project(source, running), addExisting } as unknown as ProjectsService
    })
  }

  it('copies files with the documented exclusions and registers the copy', async () => {
    const target = path.join(root, 'copy')
    const result = await service().copy({ sourceKey: KEY, targetDir: target })

    expect(result.files).toBeGreaterThan(0)
    expect(fs.readFileSync(path.join(target, 'Assets', 'A.prefab'), 'utf8')).toBe('a')
    expect(fs.existsSync(path.join(target, 'Logs'))).toBe(false)
    expect(addExisting).toHaveBeenCalledWith(target)
    // 不留临时目录
    expect(fs.readdirSync(root).filter((name) => name.startsWith('.atrium-copy'))).toEqual([])
  })

  it('refuses an existing target and a target inside the source', async () => {
    const target = path.join(root, 'copy')
    fs.mkdirSync(target)
    expect(await codeOf(service().copy({ sourceKey: KEY, targetDir: target }))).toBe('vpmCopyConflict')

    expect(
      await codeOf(service().copy({ sourceKey: KEY, targetDir: path.join(source, 'nested') }))
    ).toBe('vpmCopyConflict')
  })

  it('refuses to copy while Unity is running', async () => {
    expect(
      await codeOf(service(true).copy({ sourceKey: KEY, targetDir: path.join(root, 'copy') }))
    ).toBe('vpmUnityRunning')
  })

  it('cancels without leaving a target or a temp folder behind', async () => {
    const controller = new AbortController()
    controller.abort()
    const target = path.join(root, 'copy')
    expect(
      await codeOf(service().copy({ sourceKey: KEY, targetDir: target, signal: controller.signal }))
    ).toBe('vpmCollectCancelled')
    expect(fs.existsSync(target)).toBe(false)
  })
})

describe('unity version file', () => {
  it('reads and renders the version file', () => {
    expect(readProjectVersionFile(source)).toEqual({ version: '2022.3.22f1', revision: null })
    expect(renderProjectVersionFile('2022.3.22f1', 'abc123')).toBe(
      'm_EditorVersion: 2022.3.22f1\nm_EditorVersionWithRevision: 2022.3.22f1 (abc123)\n'
    )
    expect(readProjectVersionFile(path.join(root, 'nope'))).toBeNull()
  })

  it('writes the new version, backs up first and flags downgrades', async () => {
    const backupCreate = vi.fn(async () => ({ id: 'backup-1' }))
    const service = new UnityVersionService({
      projects: { get: () => project(source) } as unknown as ProjectsService,
      installs: () => [install('2021.3.0f1')],
      backup: { create: backupCreate }
    })

    const result = await service.change({ projectKey: KEY, unityVersion: '2021.3.0f1' })
    expect(result.downgrade).toBe(true)
    expect(result.backupId).toBe('backup-1')
    expect(result.backupSkipped).toBe(false)
    expect(readProjectVersionFile(source)?.version).toBe('2021.3.0f1')
    expect(backupCreate).toHaveBeenCalledTimes(1)
  })

  it('skips the backup when asked and says so', async () => {
    const backupCreate = vi.fn(async () => ({ id: 'backup-1' }))
    const service = new UnityVersionService({
      projects: { get: () => project(source) } as unknown as ProjectsService,
      installs: () => [install('2022.3.22f1')],
      backup: { create: backupCreate }
    })
    const result = await service.change({ projectKey: KEY, unityVersion: '2022.3.22f1', backupFirst: false })
    expect(result.backupSkipped).toBe(true)
    expect(result.backupId).toBeNull()
    expect(backupCreate).not.toHaveBeenCalled()
  })

  it('refuses while Unity runs, unknown versions and uninstalled editors', async () => {
    const running = new UnityVersionService({
      projects: { get: () => project(source, true) } as unknown as ProjectsService,
      installs: () => [install('2022.3.22f1')]
    })
    expect(await codeOf(running.change({ projectKey: KEY, unityVersion: '2022.3.22f1' }))).toBe(
      'vpmUnityRunning'
    )

    const noEditor = new UnityVersionService({
      projects: { get: () => project(source) } as unknown as ProjectsService,
      installs: () => []
    })
    expect(await codeOf(noEditor.change({ projectKey: KEY, unityVersion: '2022.3.22f1' }))).toBe(
      'vpmUnityNotFound'
    )
    expect(await codeOf(noEditor.change({ projectKey: KEY, unityVersion: 'bad' }))).toBe(
      'vpmUnityVersionInvalid'
    )
  })

  it('restores the previous version file when writing fails', async () => {
    const service = new UnityVersionService({
      projects: { get: () => project(source) } as unknown as ProjectsService,
      installs: () => [install('2021.3.0f1')],
      backupFirst: undefined,
      writeFile: () => {
        throw new Error('disk full')
      }
    } as never)

    expect(await codeOf(service.change({ projectKey: KEY, unityVersion: '2021.3.0f1', backupFirst: false }))).toBe(
      'vpmUnityVersionChangeFailed'
    )
    expect(readProjectVersionFile(source)?.version).toBe('2022.3.22f1')
  })
})
