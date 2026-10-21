import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { closeVpmDb, openVpmDb, type VpmDb } from '../../../src/main/vpm/db'
import {
  UnityInstallStore,
  discoverUnityEditors,
  parseHubEditorRecords,
  parseInstallRoots,
  parseUnityArch,
  parseUnityVersion,
  type UnityDiscoveryOptions
} from '../../../src/main/vpm/unity'

let root: string
let db: VpmDb | null

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'atrium-vpm-unity-'))
  db = null
})

afterEach(() => {
  closeVpmDb(db)
  db = null
  fs.rmSync(root, { recursive: true, force: true })
})

function write(file: string, content = 'MZ'): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, content)
}

function editor(rootDir: string, version: string, arch = ''): string {
  const exe = path.join(rootDir, version, arch, 'Editor', 'Unity.exe')
  write(exe)
  return exe
}

function discoveryOptions(input: {
  appData?: string
  programFiles?: string[]
  extraRoots?: string[]
} = {}): UnityDiscoveryOptions {
  return {
    appDataDir: input.appData ?? path.join(root, 'AppData', 'Roaming'),
    programFiles: input.programFiles ?? [],
    localAppData: path.join(root, 'LocalAppData'),
    extraRoots: input.extraRoots ?? []
  }
}

function hubFiles(appData: string): string {
  return path.join(appData, 'UnityHub')
}

function writeHubJson(appData: string, name: string, value: unknown): void {
  write(path.join(hubFiles(appData), name), JSON.stringify(value))
}

async function openDb(): Promise<UnityInstallStore> {
  db = await openVpmDb({
    file: path.join(root, 'vpm', 'vpm.db'),
    backupsDir: path.join(root, 'backups')
  })
  return new UnityInstallStore(db)
}

describe('Unity editor discovery', () => {
  it('parses versions, architectures and defensive Hub shapes', () => {
    expect(parseUnityVersion('2022.3.22f1')).toBe('2022.3.22f1')
    expect(parseUnityVersion('Unity 6000.0.23f1')).toBe('6000.0.23f1')
    expect(parseUnityVersion('2022.3.22f1c1')).toBe('2022.3.22f1c1')
    expect(parseUnityVersion('not-a-version')).toBeNull()
    expect(parseUnityArch('x64')).toBe('x86_64')
    expect(parseUnityArch('arm64')).toBe('arm64')
    expect(parseUnityArch('mips')).toBeNull()

    const records = parseHubEditorRecords({
      editors: [
        { location: ['D:\\Unity\\2022.3.22f1\\Editor\\Unity.exe'], version: '2022.3.22f1' },
        { path: 'E:\\Unity\\6000.0.23f1\\Editor\\Unity.exe', versionWithRevision: '6000.0.23f1', revision: 'abc', architecture: 'arm64' }
      ]
    })
    expect(records).toHaveLength(2)
    expect(records[0]).toMatchObject({ version: '2022.3.22f1', arch: null })
    expect(records[1]).toMatchObject({ version: '6000.0.23f1', revision: 'abc', arch: 'arm64' })
  })

  it('reads a string/object/array of install roots', () => {
    expect(parseInstallRoots('D:\\Unity\\Editors')).toEqual(['D:\\Unity\\Editors'])
    expect(parseInstallRoots({ secondaryInstallPath: 'D:\\Unity' })).toEqual(['D:\\Unity'])
    expect(parseInstallRoots({ paths: ['D:\\A', { path: 'E:\\B' }] })).toEqual(['D:\\A', 'E:\\B'])
  })

  it('merges Hub metadata, default scans and custom roots by path', () => {
    const appData = path.join(root, 'AppData', 'Roaming')
    const programRoot = path.join(root, 'ProgramFiles')
    const secondaryRoot = path.join(root, 'Secondary')
    const settingsRoot = path.join(root, 'SettingsRoot')
    const defaultExe = editor(path.join(programRoot, 'Unity', 'Hub', 'Editor'), '2022.3.22f1')
    const secondaryExe = editor(secondaryRoot, '2021.3.16f1')
    const settingsExe = editor(settingsRoot, '2020.3.48f1')

    writeHubJson(appData, 'editors-v2.json', {
      editors: [
        { location: defaultExe, version: '2022.3.22f1', revision: 'rev-1', architecture: 'x86_64' },
        { location: defaultExe.toUpperCase(), version: '2022.3.22f1' }
      ]
    })
    writeHubJson(appData, 'secondaryInstallPath.json', { secondaryInstallPath: secondaryRoot })
    writeHubJson(appData, 'settings.json', { editorInstallPath: settingsRoot })

    const result = discoverUnityEditors(
      discoveryOptions({ appData, programFiles: [programRoot] })
    )

    expect(result.installs).toHaveLength(3)
    expect(result.installs.find((item) => item.path === defaultExe)).toMatchObject({
      source: 'hub',
      version: '2022.3.22f1',
      versionWithRevision: '2022.3.22f1 (rev-1)',
      arch: 'x86_64',
      missing: false
    })
    expect(result.installs.find((item) => item.path === secondaryExe)).toMatchObject({
      source: 'scan',
      version: '2021.3.16f1'
    })
    expect(result.installs.find((item) => item.path === settingsExe)).toMatchObject({
      source: 'scan',
      version: '2020.3.48f1'
    })
    expect(result.installs[0].version).toBe('2022.3.22f1')
  })

  it('keeps missing Hub entries and marks unknown version/arch', () => {
    const appData = path.join(root, 'AppData', 'Roaming')
    const missing = path.join(root, 'Missing', 'Editor', 'Unity.exe')
    writeHubJson(appData, 'editors-v2.json', {
      editors: [{ location: path.dirname(path.dirname(missing)), version: null }]
    })

    const result = discoverUnityEditors(discoveryOptions({ appData }))

    expect(result.installs).toHaveLength(1)
    expect(result.installs[0]).toMatchObject({
      path: missing,
      missing: true,
      version: null,
      versionUnknown: true,
      arch: 'x86_64',
      archInferred: true
    })
    expect(result.warnings.map((item) => item.code)).toContain('vpmUnityNotFound')
  })

  it('does not abort discovery when a Hub file is corrupt', () => {
    const appData = path.join(root, 'AppData', 'Roaming')
    const programRoot = path.join(root, 'ProgramFiles')
    const exe = editor(path.join(programRoot, 'Unity', 'Hub', 'Editor'), '2022.3.22f1')
    write(path.join(hubFiles(appData), 'editors-v2.json'), '{ bad json')

    const result = discoverUnityEditors(
      discoveryOptions({ appData, programFiles: [programRoot] })
    )

    expect(result.installs).toHaveLength(1)
    expect(result.installs[0].path).toBe(exe)
    expect(result.warnings.map((item) => item.code)).toContain('vpmUnityInvalid')
  })
})

describe('Unity install store', () => {
  it('persists, dedupes case-insensitively and marks stale rows missing', async () => {
    const store = await openDb()
    const exe = editor(path.join(root, 'Editors'), '2022.3.22f1')
    const discovered = discoverUnityEditors({
      appDataDir: path.join(root, 'Empty'),
      programFiles: [],
      localAppData: path.join(root, 'EmptyLocal'),
      extraRoots: [path.dirname(path.dirname(path.dirname(exe)))]
    })

    store.merge(discovered.installs)
    expect(store.list()).toHaveLength(1)

    const upper = exe.toUpperCase()
    const hub = {
      ...discovered.installs[0],
      path: upper,
      source: 'hub' as const
    }
    store.merge([hub])
    expect(store.list()).toHaveLength(1)
    expect(store.getByPath(upper)?.version).toBe('2022.3.22f1')

    store.merge([])
    expect(store.list()).toHaveLength(1)
    expect(store.list()[0].missing).toBe(true)
  })

  it('adds a manual editor, validates inputs and keeps manual source over Hub', async () => {
    const store = await openDb()
    const exe = editor(path.join(root, 'Editors'), '2022.3.22f1')
    store.merge([
      {
        id: 'hub-1',
        path: exe,
        version: '2022.3.22f1',
        versionWithRevision: '2022.3.22f1',
        source: 'hub',
        arch: 'x86_64',
        archInferred: false,
        versionUnknown: false,
        missing: false,
        lastSeenAt: 1
      }
    ])

    const manual = store.addManual({
      path: exe,
      version: '2022.3.23f1',
      revision: 'rev-2',
      arch: 'arm64'
    })
    expect(manual).toMatchObject({
      source: 'manual',
      version: '2022.3.23f1',
      versionWithRevision: '2022.3.23f1 (rev-2)',
      arch: 'arm64'
    })
    expect(store.list()).toHaveLength(1)

    const missing = path.join(root, 'Missing', 'Unity.exe')
    expect(() => store.addManual({ path: missing })).toThrowError(/vpmUnityNotFound|Unity/)
    const notUnity = path.join(root, 'NotUnity.exe')
    write(notUnity)
    expect(() => store.addManual({ path: notUnity })).toThrowError(/vpmUnityInvalid|Unity/)
    const noVersion = path.join(root, 'Custom', 'Unity.exe')
    write(noVersion)
    expect(() => store.addManual({ path: noVersion })).toThrowError(/vpmUnityVersionUnknown|version/)
  })

  it('sorts known versions newest first and unknown versions last', async () => {
    const store = await openDb()
    const exeA = editor(path.join(root, 'Editors'), '2021.3.16f1')
    const exeB = editor(path.join(root, 'Editors'), '2022.3.22f1')
    const exeC = editor(path.join(root, 'Editors'), 'Custom')
    const discovered = discoverUnityEditors({
      appDataDir: path.join(root, 'Empty'),
      programFiles: [],
      localAppData: path.join(root, 'EmptyLocal'),
      extraRoots: [path.join(root, 'Editors')]
    })
    store.merge(discovered.installs)

    expect(store.list().map((item) => item.path)).toEqual([exeB, exeA, exeC])
    expect(store.list()[2].versionUnknown).toBe(true)
  })
})
