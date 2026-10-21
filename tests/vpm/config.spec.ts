import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { P, setAppPathsForTest } from '../../src/main/services/paths'
import {
  defaultVpmSettings,
  grantNetworkConsent,
  isNetworkEnabled,
  isValidVpmSettings,
  readNetworkConsent,
  readVpmSettings,
  revokeNetworkConsent,
  setNetworkEnabled,
  writeVpmSettings
} from '../../src/main/vpm/config'
import type { VpmSettingsFile } from '../../src/shared/vpm/types'

let root: string

beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'atrium-vpm-config-')))
  setAppPathsForTest(root)
})

afterEach(() => {
  vi.restoreAllMocks()
  fs.rmSync(root, { recursive: true, force: true })
})

function corruptFiles(): string[] {
  if (!fs.existsSync(P.vpm())) return []
  return fs.readdirSync(P.vpm()).filter((name) => name.startsWith('settings.json.corrupt-'))
}

describe('VPM settings file', () => {
  it('defaults to disabled without creating the vpm directory', () => {
    const read = readVpmSettings()
    expect(read.recovered).toBe(false)
    expect(read.settings).toEqual(defaultVpmSettings())
    expect(read.settings.enabled).toBe(false)
    expect(read.settings.networkEnabled).toBe(true)
    expect(read.settings.dataRoot).toBeNull()
    expect(fs.existsSync(P.vpm())).toBe(false)
  })

  it('round-trips a valid file through an atomic write and leaves no temp file', () => {
    const next: VpmSettingsFile = {
      ...defaultVpmSettings(),
      enabled: true,
      dataRoot: 'E:\\AtriumVPM',
      allowPrerelease: true,
      hiddenPackageIds: ['com.example.hidden'],
      rollbackSnapshot: {
        path: 'E:\\app\\vpm\\backups\\pre-vpm-1.db',
        sha256: 'a'.repeat(64),
        createdAt: '2026-10-21T05:00:00.000Z'
      }
    }
    writeVpmSettings(next)
    expect(readVpmSettings()).toMatchObject({ recovered: false, settings: next })
    expect(fs.readdirSync(P.vpm()).filter((name) => name.endsWith('.tmp'))).toEqual([])
  })

  it('quarantines corrupt JSON instead of deleting or overwriting it', () => {
    fs.mkdirSync(P.vpm(), { recursive: true })
    fs.writeFileSync(P.vpmSettings(), '{"enabled": ', 'utf8')
    const read = readVpmSettings()
    expect(read.recovered).toBe(true)
    expect(read.settings).toEqual(defaultVpmSettings())
    expect(fs.existsSync(P.vpmSettings())).toBe(false)
    const backups = corruptFiles()
    expect(backups).toHaveLength(1)
    expect(fs.readFileSync(path.join(P.vpm(), backups[0]), 'utf8')).toBe('{"enabled": ')
  })

  it.each([
    ['wrong schema', { ...defaultVpmSettings(), schemaVersion: 2 }],
    ['negative quota', { ...defaultVpmSettings(), cacheQuotaGb: 0 }],
    ['wrong enabled type', { ...defaultVpmSettings(), enabled: 'yes' }],
    ['bad hidden package', { ...defaultVpmSettings(), hiddenPackageIds: [42] }],
    ['bad snapshot hash', {
      ...defaultVpmSettings(),
      rollbackSnapshot: { path: 'E:\\a.db', sha256: 'nope', createdAt: '2026-10-21T00:00:00.000Z' }
    }],
    ['relative data root', { ...defaultVpmSettings(), dataRoot: 'relative\\vpm' }]
  ])('treats invalid fields as corruption: %s', (_label, value) => {
    fs.mkdirSync(P.vpm(), { recursive: true })
    fs.writeFileSync(P.vpmSettings(), JSON.stringify(value), 'utf8')
    const read = readVpmSettings()
    expect(read.recovered).toBe(true)
    expect(read.settings).toEqual(defaultVpmSettings())
    expect(corruptFiles()).toHaveLength(1)
  })

  it('keeps the previous file intact when publishing the temp file fails', () => {
    writeVpmSettings({ ...defaultVpmSettings(), cacheQuotaGb: 11 })
    const before = fs.readFileSync(P.vpmSettings(), 'utf8')
    vi.spyOn(fs, 'renameSync').mockImplementationOnce(() => {
      const error = new Error('locked') as NodeJS.ErrnoException
      error.code = 'EPERM'
      throw error
    })

    expect(() => writeVpmSettings({ ...defaultVpmSettings(), cacheQuotaGb: 12 })).toThrow(
      'i18n:vpm.errors.vpmInternal'
    )
    expect(fs.readFileSync(P.vpmSettings(), 'utf8')).toBe(before)
    expect(fs.readdirSync(P.vpm()).filter((name) => name.endsWith('.tmp'))).toEqual([])
  })

  it('refuses to write structurally invalid settings', () => {
    expect(isValidVpmSettings({ ...defaultVpmSettings(), checkUpdates: 'no' })).toBe(false)
    expect(() => writeVpmSettings({ ...defaultVpmSettings(), checkUpdates: 'no' } as never)).toThrow(
      'i18n:vpm.errors.vpmInternal'
    )
  })
})

describe('VPM network consent', () => {
  it('defaults network on and reads legacy files without the field as on', () => {
    expect(isNetworkEnabled()).toBe(true)
    fs.mkdirSync(P.vpm(), { recursive: true })
    const legacy = { ...defaultVpmSettings() } as Record<string, unknown>
    delete legacy.networkEnabled
    fs.writeFileSync(P.vpmSettings(), JSON.stringify(legacy), 'utf8')
    expect(readVpmSettings().settings.networkEnabled).toBe(true)
    expect(isNetworkEnabled()).toBe(true)
  })

  it('toggles network without touching the data root or repository settings', () => {
    writeVpmSettings({ ...defaultVpmSettings(), enabled: true, dataRoot: 'E:\\AtriumVPM' })
    expect(setNetworkEnabled(false)).toBe(false)
    expect(isNetworkEnabled()).toBe(false)
    expect(readVpmSettings().settings).toMatchObject({
      enabled: true,
      dataRoot: 'E:\\AtriumVPM',
      networkEnabled: false
    })
    expect(setNetworkEnabled(true)).toBe(true)
    expect(isNetworkEnabled()).toBe(true)
    expect(readVpmSettings().settings.networkConsentAt).toBeTruthy()
  })

  it('is null by default and round-trips without touching other settings', () => {
    expect(readNetworkConsent()).toBeNull()

    writeVpmSettings({
      ...defaultVpmSettings(),
      enabled: true,
      dataRoot: 'E:\\AtriumVPM',
      allowPrerelease: true
    })
    const at = new Date('2026-10-21T08:00:00.000Z')
    expect(grantNetworkConsent(at)).toBe(at.toISOString())
    expect(readNetworkConsent()).toBe(at.toISOString())
    expect(readVpmSettings().settings).toMatchObject({
      enabled: true,
      dataRoot: 'E:\\AtriumVPM',
      allowPrerelease: true,
      networkConsentAt: at.toISOString()
    })

    revokeNetworkConsent()
    expect(readNetworkConsent()).toBeNull()
    expect(readVpmSettings().settings).toMatchObject({
      enabled: true,
      dataRoot: 'E:\\AtriumVPM',
      allowPrerelease: true,
      networkConsentAt: null
    })
  })

  it('can grant consent on a fresh profile without enabling VPM', () => {
    grantNetworkConsent(new Date('2026-10-21T08:01:00.000Z'))
    expect(readVpmSettings().settings).toMatchObject({
      enabled: false,
      dataRoot: null,
      networkConsentAt: '2026-10-21T08:01:00.000Z'
    })
  })
})
