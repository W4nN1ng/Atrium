import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { openDatabase, closeDatabase, getDb } from '../../src/main/db'
import { P, setAppPathsForTest } from '../../src/main/services/paths'
import { defaultVpmSettings, writeVpmSettings } from '../../src/main/vpm/config'
import { defaultVpmDataRoot, enableVpm, getVpmStatus, registerVpmGateIpc, resetVpmGateForTest, startVpmRuntime } from '../../src/main/vpm/gate'
import { IpcEvent } from '../../src/shared/ipc'

const stubs = vi.hoisted(() => ({ appData: '', init: vi.fn(), dispose: vi.fn() }))
vi.mock('electron', () => ({app: {getPath: () => stubs.appData, getAppPath: () => '' , getVersion: () => '0.9.4'}, BrowserWindow: {}, dialog: {}, shell: {}}))
vi.mock('../../src/main/vpm/index', () => ({initVpm: stubs.init}))

let root: string
let systemDrive: string | undefined
let library: string
let broadcast: ReturnType<typeof vi.fn>

beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'atrium-startup-')))
  setAppPathsForTest(path.join(root, 'home'))
  openDatabase(P.db())
  stubs.appData = path.join(root, 'Roaming')
  fs.mkdirSync(stubs.appData)
  library = path.join(root, 'library')
  systemDrive = process.env.SystemDrive
  process.env.SystemDrive = path.parse(root).root.slice(0, 2)
  broadcast = vi.fn()
  stubs.init.mockReset().mockResolvedValue({dispose: stubs.dispose})
  stubs.dispose.mockReset()
  registerVpmGateIpc({ipc: {handle: () => {}}, getDb, getLibraryRoot: () => library,
    getKnownProjectPaths: () => [], appInstallDirs: () => [], broadcast})
})
afterEach(() => {
  resetVpmGateForTest(); closeDatabase()
  if(systemDrive === undefined) delete process.env.SystemDrive
  else process.env.SystemDrive = systemDrive
  delete process.env.ATRIUM_SAFE_MODE
  fs.rmSync(root, {recursive: true, force: true})
})

describe('automatic project startup', () => {
  it('enables a fresh install on the default system-drive path and starts the runtime', async () => {
    expect(getVpmStatus().enabled).toBe(false)
    await startVpmRuntime()
    expect(getVpmStatus()).toMatchObject({enabled: true, dataRootValid: true, degraded: false, dataRoot: defaultVpmDataRoot()})
    expect(stubs.init).toHaveBeenCalledTimes(1)
    expect(broadcast).toHaveBeenCalledWith(IpcEvent.VpmStatusChanged, expect.objectContaining({enabled: true, dataRootValid: true}))
    const snapshot = getVpmStatus().rollbackSnapshot!.path
    await startVpmRuntime()
    expect(stubs.init).toHaveBeenCalledTimes(1)
    expect(getVpmStatus().rollbackSnapshot!.path).toBe(snapshot)
  })

  it('also initializes an old disabled configuration as required by R20', async () => {
    writeVpmSettings(defaultVpmSettings())
    await startVpmRuntime()
    expect(getVpmStatus()).toMatchObject({enabled: true, dataRootValid: true})
  })

  it('never initializes or writes settings in safe mode', async () => {
    process.env.ATRIUM_SAFE_MODE = '1'
    await startVpmRuntime()
    expect(getVpmStatus()).toMatchObject({enabled: false, safeMode: true})
    expect(fs.existsSync(P.vpmSettings())).toBe(false)
    expect(stubs.init).not.toHaveBeenCalled()
  })

  it('retains an existing valid custom root and snapshot', async () => {
    process.env.SystemDrive = 'Z:'
    const custom = path.join(root, 'custom')
    const before = await enableVpm({dataRoot: custom})
    await startVpmRuntime()
    expect(getVpmStatus()).toMatchObject({dataRoot: custom, rollbackSnapshot: before.rollbackSnapshot})
  })

  it('does not trust an IPC systemDefault flag for arbitrary system-drive paths', async () => {
    await expect(enableVpm({dataRoot: path.join(root, 'arbitrary'), systemDefault: true})).rejects.toMatchObject({code: 'vpmDataRootOnSystemDrive'})
    expect(fs.existsSync(P.vpmSettings())).toBe(false)
  })

  it('accepts a default path whose parent is a junction, including after rereading settings', async () => {
    const real = path.join(root, 'real-roaming'); fs.mkdirSync(real)
    const alias = path.join(root, 'alias-roaming'); fs.symlinkSync(real, alias, 'junction')
    stubs.appData = alias
    const result = await enableVpm({dataRoot: defaultVpmDataRoot()})
    expect(result).toMatchObject({enabled: true, dataRootValid: true})
    expect(getVpmStatus().dataRootValid).toBe(true)
  })

  it('rejects a default junction pointing inside the material library', async () => {
    fs.mkdirSync(library)
    fs.symlinkSync(library, defaultVpmDataRoot(), 'junction')
    await expect(enableVpm({dataRoot: defaultVpmDataRoot(), systemDefault: true})).rejects.toMatchObject({code: 'vpmDataRootInsideLibrary'})
    expect(fs.existsSync(P.vpmSettings())).toBe(false)
  })

  it('reports a stored default root as invalid when it becomes a protected junction', async () => {
    const settings = {...defaultVpmSettings(), enabled: true, dataRoot: defaultVpmDataRoot()}
    writeVpmSettings(settings); fs.mkdirSync(library)
    fs.symlinkSync(library, defaultVpmDataRoot(), 'junction')
    expect(getVpmStatus().dataRootValid).toBe(false)
  })

  it('rejects a canonical default root when a library alias points to it', async () => {
    fs.mkdirSync(defaultVpmDataRoot(), {recursive: true})
    fs.symlinkSync(defaultVpmDataRoot(), library, 'junction')
    await expect(enableVpm({dataRoot: defaultVpmDataRoot()})).rejects.toMatchObject({code: 'vpmDataRootInsideLibrary'})
    expect(fs.existsSync(P.vpmSettings())).toBe(false)
  })
})
