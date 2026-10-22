import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { closeVpmDb, openVpmDb, type VpmDb } from '../../../src/main/vpm/db'
import { ProjectBackupService, readZipEntries, safeZipPath } from '../../../src/main/vpm/backup'
import type { ProjectsService } from '../../../src/main/vpm/projects'

let root: string
let dataRoot: string
let projectPath: string
let db: VpmDb
let service: ProjectBackupService
let addExisting: ReturnType<typeof vi.fn>

const PROJECT_KEY = 'c:\\demo'

function writeTree(base: string, files: Record<string, string>): void {
  for (const [relative, content] of Object.entries(files)) {
    const absolute = path.join(base, ...relative.split('/'))
    fs.mkdirSync(path.dirname(absolute), { recursive: true })
    fs.writeFileSync(absolute, content)
  }
}

function codeOf(promise: Promise<unknown>): Promise<string | null> {
  return promise.then(
    () => null,
    (error: { code?: string }) => error.code ?? 'unknown'
  )
}

beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'atrium-backup-'))
  dataRoot = path.join(root, 'data')
  projectPath = path.join(root, 'project')
  fs.mkdirSync(dataRoot)
  writeTree(projectPath, {
    'Assets/A.prefab': 'prefab',
    // 大段重复内容：让 store 与 normal 的差异明显（小文件反而可能 deflate 更大）
    'Assets/big.txt': 'x'.repeat(20_000),
    'Assets/sub/B.mat': 'mat',
    'ProjectSettings/ProjectVersion.txt': 'm_EditorVersion: 2022.3.22f1\n',
    'Packages/manifest.json': '{}',
    'Packages/vpm-manifest.json': '{"dependencies":{},"locked":{}}',
    'Logs/Editor.log': 'should be excluded'
  })
  db = await openVpmDb({ file: path.join(root, 'vpm.db'), backupsDir: path.join(root, 'backups') })
  addExisting = vi.fn()
  service = new ProjectBackupService({
    db,
    dataRoot,
    projects: {
      get: (key: string) =>
        key === PROJECT_KEY
          ? { projectKey: PROJECT_KEY, name: 'Demo', path: projectPath, running: false, unityVersion: '2022.3.22f1' }
          : null,
      addExisting
    } as unknown as ProjectsService,
    now: () => 1_700_000_000_000
  })
})

afterEach(() => {
  closeVpmDb(db)
  fs.rmSync(root, { recursive: true, force: true })
})

describe('create backup', () => {
  it('writes a readable zip under the data root and records it', async () => {
    const record = await service.create({ projectKey: PROJECT_KEY })

    expect(record.status).toBe('ok')
    expect(record.filePath.startsWith(path.join(dataRoot, 'backups'))).toBe(true)
    expect(record.filePath.endsWith('.zip')).toBe(true)
    expect(record.size).toBeGreaterThan(0)
    expect(record.sha256).toMatch(/^[0-9a-f]{64}$/)
    expect(fs.existsSync(record.filePath)).toBe(true)
    // 不留 .part
    expect(fs.existsSync(`${record.filePath}.part`)).toBe(false)

    const entries = await readZipEntries(record.filePath)
    const names = entries.map((entry) => entry.name)
    expect(names).toContain('Assets/A.prefab')
    expect(names).toContain('Assets/sub/B.mat')
    expect(names).toContain('ProjectSettings/ProjectVersion.txt')
    expect(names.some((name) => name.startsWith('Logs/'))).toBe(false)

    const list = service.list(PROJECT_KEY)
    expect(list).toHaveLength(1)
    expect(list[0].id).toBe(record.id)
    expect(list[0].packageCount).toBeGreaterThan(0)
  })

  it('honours compression levels instead of pretending', async () => {
    const store = await service.create({
      projectKey: PROJECT_KEY,
      compression: 'store',
      targetPath: path.join(root, 'store.zip')
    })
    const normal = await service.create({
      projectKey: PROJECT_KEY,
      compression: 'normal',
      targetPath: path.join(root, 'normal.zip')
    })
    expect(store.size).toBeGreaterThan(0)
    expect(normal.size).toBeGreaterThan(0)
    // 同样的内容：normal 必须真的压缩过，比 store 小
    expect(store.size as number).toBeGreaterThan(normal.size as number)
  })

  it('records a cancelled run and leaves no partial file', async () => {
    const controller = new AbortController()
    controller.abort()
    const target = path.join(root, 'cancelled.zip')
    expect(
      await codeOf(service.create({ projectKey: PROJECT_KEY, targetPath: target, signal: controller.signal }))
    ).toBe('vpmCollectCancelled')
    expect(fs.existsSync(target)).toBe(false)
    expect(fs.existsSync(`${target}.part`)).toBe(false)

    const list = service.list(PROJECT_KEY)
    expect(list[0].status).toBe('cancelled')
    expect(list[0].errorCode).toBe('vpmCollectCancelled')
  })

  it('records a failed run instead of claiming success', async () => {
    const target = path.join(root, 'bad\0dir', 'x.zip')
    expect(await codeOf(service.create({ projectKey: PROJECT_KEY, targetPath: target }))).not.toBeNull()
    const list = service.list(PROJECT_KEY)
    expect(list[0].status).toBe('failed')
  })

  it('refuses unknown projects and running Unity unless allowed', async () => {
    expect(await codeOf(service.create({ projectKey: 'c:\\other' }))).toBe('vpmProjectInvalid')

    const running = new ProjectBackupService({
      db,
      dataRoot,
      projects: {
        get: () => ({ projectKey: PROJECT_KEY, name: 'Demo', path: projectPath, running: true })
      } as unknown as ProjectsService,
      now: () => 1_700_000_000_000
    })
    expect(await codeOf(running.create({ projectKey: PROJECT_KEY }))).toBe('vpmUnityRunning')
  })
})

describe('restore backup', () => {
  it('extracts into a new directory and registers the project', async () => {
    const record = await service.create({ projectKey: PROJECT_KEY })
    const target = path.join(root, 'restored')

    const result = await service.restore({ backupId: record.id, targetDir: target })
    expect(result.files).toBeGreaterThan(0)
    expect(fs.readFileSync(path.join(target, 'Assets', 'A.prefab'), 'utf8')).toBe('prefab')
    expect(addExisting).toHaveBeenCalledWith(target)
    expect(result.installed).toBe('none')
  })

  it('never overwrites an existing directory', async () => {
    const record = await service.create({ projectKey: PROJECT_KEY })
    const target = path.join(root, 'restored')
    fs.mkdirSync(target)
    fs.writeFileSync(path.join(target, 'keep.txt'), 'mine')

    expect(await codeOf(service.restore({ backupId: record.id, targetDir: target }))).toBe(
      'vpmBackupConflict'
    )
    expect(fs.readFileSync(path.join(target, 'keep.txt'), 'utf8')).toBe('mine')
  })

  it('rejects an unknown or incomplete backup', async () => {
    expect(await codeOf(service.restore({ backupId: 'nope', targetDir: path.join(root, 'x') }))).toBe(
      'vpmBackupInvalid'
    )
  })

  it('runs the installer when asked', async () => {
    const record = await service.create({ projectKey: PROJECT_KEY })
    const withInstaller = new ProjectBackupService({
      db,
      dataRoot,
      projects: { get: () => null, addExisting } as unknown as ProjectsService,
      installer: async () => 'installed',
      now: () => 1_700_000_000_000
    })
    const result = await withInstaller.restore({
      backupId: record.id,
      targetDir: path.join(root, 'restored-install'),
      installPackages: true
    })
    expect(result.installed).toBe('installed')
  })
})

describe('zip path safety', () => {
  it('accepts normal relative paths and rejects escapes', () => {
    expect(safeZipPath('Assets/A.prefab')).toBe('Assets/A.prefab')
    expect(safeZipPath('Assets//A.prefab')).toBe('Assets/A.prefab')
    expect(safeZipPath('../evil.txt')).toBeNull()
    expect(safeZipPath('Assets/../../evil.txt')).toBeNull()
    expect(safeZipPath('/abs/evil.txt')).toBeNull()
    expect(safeZipPath('C:/evil.txt')).toBeNull()
    expect(safeZipPath('Assets\\evil.txt')).toBeNull()
    expect(safeZipPath('')).toBeNull()
  })
})
