import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { closeDatabase, openDatabase, type Db } from '../../src/main/db'
import { upsertProject } from '../../src/main/db/repos/unity'
import { insertImportLog, patchImportLog } from '../../src/main/db/repos/journal'
import {
  ProjectActivityRegistry,
  createLegacyGuard,
  createProjectActivityPort,
  normalizeProjectPath
} from '../../src/main/project/activity'
import {
  importUnitypackage,
  rollbackImport,
  setImportActivityHook,
  type BridgeLike,
  type PreflightResult
} from '../../src/main/import/coordinator'

const GUID_A = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const GUID_B = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'

function codeOf(fn: () => unknown): string | null {
  try {
    fn()
    return null
  } catch (error) {
    return (error as { code?: string }).code ?? null
  }
}

function meta(guid: string): string {
  return `fileFormatVersion: 2\nguid: ${guid}\n`
}

describe('ProjectActivityRegistry', () => {
  it('normalizes paths so the same project always maps to one key', () => {
    const a = normalizeProjectPath('C:\\Demo\\Project\\')
    const b = normalizeProjectPath('c:/demo/project')
    expect(a).toBe(b)
    expect(normalizeProjectPath('C:\\')).toBe('c:\\')
  })

  it('gives exactly one maintenance lease per project and releases idempotently', () => {
    const registry = new ProjectActivityRegistry()
    const lease = registry.acquireMaintenance('C:\\Demo', 'install')
    expect(registry.state('C:\\Demo').maintenance).toBe('install')

    expect(codeOf(() => registry.acquireMaintenance('C:\\Demo', 'backup'))).toBe('vpmProjectBusy')

    lease.release()
    lease.release()
    expect(registry.state('C:\\Demo').maintenance).toBeNull()

    const again = registry.acquireMaintenance('C:\\Demo', 'backup')
    expect(registry.state('C:\\Demo').maintenance).toBe('backup')
    again.release()
  })

  it('releases the lease even when the caller throws', () => {
    const registry = new ProjectActivityRegistry()
    expect(() => {
      const lease = registry.acquireMaintenance('C:\\Demo', 'install')
      try {
        throw new Error('boom')
      } finally {
        lease.release()
      }
    }).toThrow('boom')
    expect(registry.state('C:\\Demo').maintenance).toBeNull()
  })

  it('counts nested imports and releases them one by one', () => {
    const registry = new ProjectActivityRegistry()
    const outer = registry.beginImport('C:\\Demo')
    const inner = registry.beginImport('C:\\Demo')
    expect(registry.state('C:\\Demo').importing).toBe(true)

    inner()
    inner()
    expect(registry.state('C:\\Demo').importing).toBe(true)

    outer()
    expect(registry.state('C:\\Demo').importing).toBe(false)
  })

  it('refuses maintenance while an import is running', () => {
    const registry = new ProjectActivityRegistry()
    const release = registry.beginImport('C:\\Demo')
    try {
      expect(codeOf(() => registry.acquireMaintenance('C:\\Demo', 'install'))).toBe(
        'vpmProjectImporting'
      )
    } finally {
      release()
    }
    const lease = registry.acquireMaintenance('C:\\Demo', 'install')
    lease.release()
  })

  it('refuses maintenance while Unity runs, and fails closed if the probe throws', () => {
    let running = true
    const registry = new ProjectActivityRegistry({ isUnityRunning: () => running })
    expect(codeOf(() => registry.acquireMaintenance('C:\\Demo', 'install'))).toBe('vpmUnityRunning')
    running = false
    registry.acquireMaintenance('C:\\Demo', 'install').release()

    const broken = new ProjectActivityRegistry({
      isUnityRunning: () => {
        throw new Error('probe down')
      }
    })
    expect(codeOf(() => broken.acquireMaintenance('C:\\Demo', 'install'))).toBe('vpmUnityRunning')
  })

  it('keeps different projects independent', () => {
    const registry = new ProjectActivityRegistry()
    const a = registry.acquireMaintenance('C:\\A', 'install')
    const b = registry.acquireMaintenance('C:\\B', 'backup')
    expect(registry.state('C:\\A').maintenance).toBe('install')
    expect(registry.state('C:\\B').maintenance).toBe('backup')
    a.release()
    expect(registry.state('C:\\A').maintenance).toBeNull()
    expect(registry.state('C:\\B').maintenance).toBe('backup')
    b.release()
  })

  it('exposes the port shape and clears state', () => {
    const registry = new ProjectActivityRegistry()
    const port = createProjectActivityPort(registry)
    const lease = port.acquireMaintenance('C:\\Demo', 'install')
    expect(port.state('C:\\Demo')).toEqual({
      unityRunning: false,
      importing: false,
      maintenance: 'install'
    })
    expect(registry.diagnose()).toHaveLength(1)
    lease.release()
    registry.beginImport('C:\\Demo')()
    registry.clear()
    expect(port.state('C:\\Demo').maintenance).toBeNull()
  })
})

describe('legacy guard (import_log)', () => {
  let root: string
  let db: Db
  let projectPath: string

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'atrium-activity-'))
    db = openDatabase(path.join(root, 'library.db'))
    projectPath = path.join(root, 'project')
    fs.mkdirSync(path.join(projectPath, 'Assets', 'OldThing'), { recursive: true })
    const project = upsertProject(db, { name: 'Demo', path: projectPath })
    const row = insertImportLog(db, { projectId: project.id, status: 'ok' })
    patchImportLog(db, row.id, {
      created_guids_json: JSON.stringify([GUID_A]),
      overwritten_json: JSON.stringify([GUID_B])
    })
  })

  afterEach(() => {
    closeDatabase()
    fs.rmSync(root, { recursive: true, force: true })
  })

  function writeAsset(name: string, guid: string | null): string {
    const file = path.join(projectPath, 'Assets', 'OldThing', name)
    fs.writeFileSync(file, 'x')
    if (guid) fs.writeFileSync(`${file}.meta`, meta(guid))
    return file
  }

  it('protects assets whose guid was created or overwritten by an import', () => {
    writeAsset('created.prefab', GUID_A)
    writeAsset('overwritten.prefab', GUID_B)
    writeAsset('unknown.prefab', 'cccccccccccccccccccccccccccccccc')
    writeAsset('no-meta.prefab', null)

    const guard = createLegacyGuard(() => db)
    expect(guard.isProtected(projectPath, 'Assets/OldThing/created.prefab')).toBe(true)
    expect(guard.isProtected(projectPath, 'Assets/OldThing/overwritten.prefab')).toBe(true)
    expect(guard.isProtected(projectPath, 'Assets/OldThing/unknown.prefab')).toBe(false)
    expect(guard.isProtected(projectPath, 'Assets/OldThing/no-meta.prefab')).toBe(false)
  })

  it('refreshes the cached guid set when primed', () => {
    writeAsset('late.prefab', 'dddddddddddddddddddddddddddddddd')
    const guard = createLegacyGuard(() => db)
    expect(guard.isProtected(projectPath, 'Assets/OldThing/late.prefab')).toBe(false)

    const project = upsertProject(db, { name: 'Demo', path: projectPath })
    const row = insertImportLog(db, { projectId: project.id, status: 'ok' })
    patchImportLog(db, row.id, {
      created_guids_json: JSON.stringify(['dddddddddddddddddddddddddddddddd']),
      overwritten_json: '[]'
    })
    expect(guard.isProtected(projectPath, 'Assets/OldThing/late.prefab')).toBe(false)
    guard.prime?.(projectPath)
    expect(guard.isProtected(projectPath, 'Assets/OldThing/late.prefab')).toBe(true)
  })

  it('fails closed on unsafe paths', () => {
    const guard = createLegacyGuard(() => db)
    expect(guard.isProtected(projectPath, '../outside.txt')).toBe(true)
    expect(guard.isProtected(projectPath, '')).toBe(true)
  })
})

describe('import activity hook', () => {
  let root: string
  let db: Db
  let projectPath: string
  let projectId: string
  let registry: ProjectActivityRegistry

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'atrium-import-hook-'))
    db = openDatabase(path.join(root, 'library.db'))
    projectPath = path.join(root, 'project')
    fs.mkdirSync(path.join(projectPath, 'Assets'), { recursive: true })
    fs.writeFileSync(path.join(projectPath, 'Assets', 'keep.txt'), 'x')
    projectId = upsertProject(db, { name: 'Demo', path: projectPath }).id
    registry = new ProjectActivityRegistry()
    setImportActivityHook({ begin: (path) => registry.beginImport(path) })
  })

  afterEach(() => {
    setImportActivityHook(null)
    closeDatabase()
    fs.rmSync(root, { recursive: true, force: true })
  })

  const failingBridge: BridgeLike = {
    execute: async () => {
      throw new Error('bridge down')
    }
  } as unknown as BridgeLike

  const pre = {
    ok: true,
    reasonKey: null,
    reason: null,
    bridgeMissing: false,
    packagePath: 'pkg.unitypackage',
    entryCount: 0,
    guids: [],
    paths: new Map(),
    conflicts: []
  } as unknown as PreflightResult

  it('marks the project as importing while the import runs and releases afterwards', async () => {
    let seenDuringImport = false
    const bridge = {
      execute: async () => {
        seenDuringImport = registry.state(projectPath).importing
        throw new Error('bridge down')
      }
    } as unknown as BridgeLike

    const result = await importUnitypackage(
      db,
      bridge,
      projectPath,
      'pkg.unitypackage',
      projectId,
      pre
    )

    expect(result.status).toBe('failed')
    expect(seenDuringImport).toBe(true)
    expect(registry.state(projectPath).importing).toBe(false)
  })

  it('releases the import mark when the package cannot be read at all', async () => {
    await importUnitypackage(db, failingBridge, projectPath, 'missing.unitypackage', projectId, pre)
    expect(registry.state(projectPath).importing).toBe(false)
  })

  it('reports undo as an import too', async () => {
    await rollbackImport(db, failingBridge, projectPath, 'no-such-import')
    expect(registry.state(projectPath).importing).toBe(false)
  })
})
