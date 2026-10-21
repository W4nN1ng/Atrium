import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'
import { closeDatabase, openDatabase } from '../../src/main/db'
import { IpcInvoke } from '../../src/shared/ipc'
import { P, setAppPathsForTest } from '../../src/main/services/paths'
import {
  disableVpm,
  enableVpm,
  getVpmStatus,
  isSafeMode,
  registerVpmGateIpc,
  resetVpmGateForTest
} from '../../src/main/vpm/gate'
import { readVpmSettings, writeVpmSettings, defaultVpmSettings } from '../../src/main/vpm/config'

const electron = vi.hoisted(() => ({
  getVersion: vi.fn(() => '0.9.0'),
  getAppPath: vi.fn(() => 'E:\\Apps\\Atrium'),
  showOpenDialog: vi.fn()
}))

vi.mock('electron', () => ({
  app: {
    getVersion: electron.getVersion,
    getAppPath: electron.getAppPath
  },
  BrowserWindow: { getFocusedWindow: () => null },
  dialog: { showOpenDialog: electron.showOpenDialog }
}))

let root: string
let db: ReturnType<typeof openDatabase>
let handlers: Map<string, (...args: never[]) => unknown>
let libraryRoot: string | null
let knownProjects: string[]
let oldSystemDrive: string | undefined

function dataRoot(): string {
  return path.join(root, 'vpm-data')
}

beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'atrium-vpm-gate-')))
  setAppPathsForTest(root)
  db = openDatabase(P.db())
  libraryRoot = path.join(root, 'library')
  knownProjects = [path.join(root, 'project')]
  oldSystemDrive = process.env.SystemDrive
  process.env.SystemDrive = 'Z:'
  electron.getVersion.mockReturnValue('0.9.0')
  handlers = new Map()
  registerVpmGateIpc({
    ipc: {
      handle(channel, fn) {
        handlers.set(channel, fn as unknown as (...args: never[]) => unknown)
      }
    },
    getDb: () => db,
    getLibraryRoot: () => libraryRoot,
    getKnownProjectPaths: () => knownProjects,
    appInstallDirs: () => [path.join(root, 'app')],
    enableRuntime: false
  })
})

afterEach(() => {
  resetVpmGateForTest()
  if (db?.open) closeDatabase()
  if (oldSystemDrive === undefined) delete process.env.SystemDrive
  else process.env.SystemDrive = oldSystemDrive
  delete process.env.ATRIUM_SAFE_MODE
  fs.rmSync(root, { recursive: true, force: true })
})

function errorCode(error: unknown): string | undefined {
  return (error as { code?: string })?.code
}

describe('VPM gate (P0)', () => {
  it('reports a disabled shell by default and registers exactly the four IPC channels', () => {
    const status = getVpmStatus()
    expect(status).toMatchObject({
      enabled: false,
      safeMode: false,
      degraded: false,
      degradedCode: null,
      dataRoot: null,
      dataRootValid: false,
      networkConsentAt: null,
      configRecovered: false,
      appVersion: '0.9.0',
      rollbackSnapshot: null
    })
    expect([...handlers.keys()].sort()).toEqual(
      [IpcInvoke.Vpm.Status, IpcInvoke.Vpm.Enable, IpcInvoke.Vpm.Disable, IpcInvoke.Vpm.PickDataRoot].sort()
    )
    expect(typeof handlers.get(IpcInvoke.Vpm.Status)).toBe('function')
  })

  it('requires a data root and rejects C:/drive-root/relative paths', async () => {
    await expect(enableVpm({ dataRoot: '' })).rejects.toMatchObject({ code: 'vpmDataRootRequired' })
    await expect(enableVpm({ dataRoot: 'relative\\vpm' })).rejects.toMatchObject({ code: 'vpmDataRootInvalid' })
    await expect(enableVpm({ dataRoot: 'E:\\' })).rejects.toMatchObject({ code: 'vpmDataRootInvalid' })

    process.env.SystemDrive = 'C:'
    await expect(enableVpm({ dataRoot: path.join(root, 'vpm-data') })).rejects.toMatchObject({
      code: 'vpmDataRootOnSystemDrive'
    })
    expect(readVpmSettings().settings.enabled).toBe(false)
  })

  it('rejects a data root inside the library/project, and a path that is a file', async () => {
    await expect(enableVpm({ dataRoot: path.join(libraryRoot!, 'vpm') })).rejects.toMatchObject({
      code: 'vpmDataRootInsideLibrary'
    })
    await expect(enableVpm({ dataRoot: path.join(knownProjects[0], 'vpm') })).rejects.toMatchObject({
      code: 'vpmDataRootInsideProject'
    })

    const filePath = path.join(root, 'not-a-dir')
    fs.writeFileSync(filePath, 'file')
    await expect(enableVpm({ dataRoot: filePath })).rejects.toMatchObject({
      code: 'vpmDataRootNotWritable'
    })
    expect(getVpmStatus().enabled).toBe(false)
  })

  it('enables: creates data dirs, writes settings, and snapshots the core DB without touching its schema', async () => {
    const versionBefore = db.pragma('user_version', { simple: true })
    const tablesBefore = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all()

    const status = await enableVpm({ dataRoot: dataRoot() })

    expect(status.enabled).toBe(true)
    expect(status.safeMode).toBe(false)
    expect(status.dataRoot).toBe(dataRoot())
    expect(status.dataRootValid).toBe(true)
    expect(status.rollbackSnapshot).toBeTruthy()
    for (const name of ['cache', 'vault', 'backups', 'tmp']) {
      expect(fs.statSync(path.join(dataRoot(), name)).isDirectory()).toBe(true)
      expect(fs.readdirSync(path.join(dataRoot(), name))).toEqual([])
    }
    expect(fs.existsSync(path.join(P.vpm(), 'vpm.db'))).toBe(false)

    const read = readVpmSettings()
    expect(read.recovered).toBe(false)
    expect(read.settings.enabled).toBe(true)
    expect(fs.statSync(P.vpmSettings()).isFile()).toBe(true)

    const snapshot = read.settings.rollbackSnapshot!
    expect(snapshot.path).toContain(path.join(P.vpm(), 'backups'))
    expect(fs.statSync(snapshot.path).isFile()).toBe(true)
    expect(snapshot.sha256).toMatch(/^[a-f0-9]{64}$/)
    const copy = new Database(snapshot.path, { readonly: true, fileMustExist: true })
    try {
      expect(copy.pragma('integrity_check', { simple: true })).toBe('ok')
      expect(copy.pragma('user_version', { simple: true })).toBe(versionBefore)
    } finally {
      copy.close()
    }

    expect(db.pragma('user_version', { simple: true })).toBe(versionBefore)
    expect(db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all()).toEqual(tablesBefore)
  })

  it('keeps enabled=false and the previous settings when the snapshot fails', async () => {
    closeDatabase()
    await expect(enableVpm({ dataRoot: dataRoot() })).rejects.toMatchObject({ code: 'vpmSnapshotFailed' })
    expect(fs.existsSync(P.vpmSettings())).toBe(false)
    expect(getVpmStatus().enabled).toBe(false)
  })

  it('disables without deleting the data root, settings, or snapshot', async () => {
    const enabled = await enableVpm({ dataRoot: dataRoot() })
    const snapshotPath = enabled.rollbackSnapshot!.path
    const disabled = disableVpm()

    expect(disabled.enabled).toBe(false)
    expect(disableVpm().enabled).toBe(false)
    expect(fs.existsSync(P.vpmSettings())).toBe(true)
    expect(fs.existsSync(snapshotPath)).toBe(true)
    expect(fs.statSync(dataRoot()).isDirectory()).toBe(true)
    expect(readVpmSettings().settings).toMatchObject({ enabled: false, dataRoot: dataRoot() })
  })

  it('refuses to enable in safe mode but still reports a usable status', async () => {
    process.env.ATRIUM_SAFE_MODE = '1'
    expect(isSafeMode(['node', 'app'], process.env)).toBe(true)
    expect(getVpmStatus()).toMatchObject({ enabled: false, safeMode: true })
    await expect(enableVpm({ dataRoot: dataRoot() })).rejects.toMatchObject({ code: 'vpmSafeMode' })
    expect(fs.existsSync(P.vpmSettings())).toBe(false)
  })

  it('recognizes --safe-mode from argv without relying on the environment', () => {
    expect(isSafeMode(['node', 'app', '--safe-mode'], {})).toBe(true)
    expect(isSafeMode(['node', 'app'], {})).toBe(false)
  })

  it('surfaces configRecovered and quarantines a corrupt settings file', () => {
    fs.mkdirSync(P.vpm(), { recursive: true })
    fs.writeFileSync(P.vpmSettings(), '{bad json', 'utf8')
    const status = getVpmStatus()
    expect(status).toMatchObject({ enabled: false, configRecovered: true, degraded: false })
    expect(fs.readdirSync(P.vpm()).some((name) => name.startsWith('settings.json.corrupt-'))).toBe(true)
  })

  it('returns degraded instead of throwing when settings cannot be read', () => {
    fs.mkdirSync(P.vpm(), { recursive: true })
    // 目录冒充 settings.json：readFileSync 抛 EISDIR，状态必须降级而不是让主进程崩
    fs.mkdirSync(P.vpmSettings())
    const status = getVpmStatus()
    expect(status.degraded).toBe(true)
    expect(status.enabled).toBe(false)
  })

  it('exposes the status/enable handlers with code-based errors', async () => {
    const statusHandler = handlers.get(IpcInvoke.Vpm.Status)!
    expect(statusHandler()).toMatchObject({ enabled: false })
    const enableHandler = handlers.get(IpcInvoke.Vpm.Enable)!
    await expect(Promise.resolve(enableHandler({ dataRoot: '' } as never))).rejects.toMatchObject({
      code: 'vpmDataRootRequired'
    })
  })

  it('loads the runtime on enable in production mode', async () => {
    registerVpmGateIpc({
      ipc: {
        handle(channel, fn) {
          handlers.set(channel, fn as unknown as (...args: never[]) => unknown)
        }
      },
      getDb: () => db,
      getLibraryRoot: () => libraryRoot,
      getKnownProjectPaths: () => knownProjects,
      appInstallDirs: () => [path.join(root, 'app')],
      enableRuntime: true
    })

    const status = await enableVpm({ dataRoot: dataRoot() })
    expect(status).toMatchObject({ enabled: true, degraded: false, degradedCode: null })
    expect(fs.existsSync(P.vpmDb())).toBe(true)
  })
})
