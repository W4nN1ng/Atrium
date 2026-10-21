import { describe, expect, it } from 'vitest'
import {
  isSameOrInside,
  normalizeVpmDataRoot,
  validateVpmDataRoot
} from '../../src/shared/vpm/dataRoot'
import type { VpmDataRootContext } from '../../src/shared/vpm/types'

const base: VpmDataRootContext = {
  platform: 'win32',
  systemDrive: 'C:',
  libraryRoot: 'E:\\Library',
  knownProjectPaths: ['E:\\UnityProjects\\Avatar'],
  appInstallDirs: ['E:\\Apps\\Atrium']
}

function codeOf(input: unknown, context: VpmDataRootContext = base): string {
  const result = validateVpmDataRoot(input, context)
  return result.ok ? 'ok' : result.code
}

describe('VPM data root validation', () => {
  it('accepts a non-system absolute directory and normalizes separators/trailing slash', () => {
    const result = validateVpmDataRoot('E:/AtriumVPM/data//', base)
    expect(result).toMatchObject({ ok: true, normalized: 'E:\\AtriumVPM\\data', warnings: [] })
    expect(normalizeVpmDataRoot('E:/AtriumVPM/data//', 'win32')).toBe('E:\\AtriumVPM\\data')
  })

  it.each([
    ['empty', '', 'vpmDataRootRequired'],
    ['whitespace', '   ', 'vpmDataRootRequired'],
    ['non-string', 42, 'vpmDataRootRequired'],
    ['relative', 'AtriumVPM', 'vpmDataRootInvalid'],
    ['drive-relative', 'E:AtriumVPM', 'vpmDataRootInvalid'],
    ['drive root', 'E:\\', 'vpmDataRootInvalid'],
    ['dot-dot escape', 'E:\\AtriumVPM\\..\\Other', 'vpmDataRootInvalid'],
    ['bad character', 'E:\\Atrium< VPM', 'vpmDataRootInvalid'],
    ['alternate stream', 'E:\\AtriumVPM:secret', 'vpmDataRootInvalid'],
    ['reserved name', 'E:\\AtriumVPM\\CON', 'vpmDataRootInvalid'],
    ['trailing dot', 'E:\\AtriumVPM.', 'vpmDataRootInvalid']
  ])('rejects %s', (_label, input, code) => {
    expect(codeOf(input)).toBe(code)
  })

  it('rejects the system drive without hard-coding C:', () => {
    expect(codeOf('C:\\AtriumVPM')).toBe('vpmDataRootOnSystemDrive')
    expect(codeOf('D:\\AtriumVPM', { ...base, systemDrive: 'D:' })).toBe('vpmDataRootOnSystemDrive')
    expect(codeOf('E:\\AtriumVPM')).toBe('ok')
  })

  it('rejects paths inside the library, a known project, and the app install dir', () => {
    expect(codeOf('E:\\Library\\VPM')).toBe('vpmDataRootInsideLibrary')
    expect(codeOf('E:\\UnityProjects\\Avatar\\VPM')).toBe('vpmDataRootInsideProject')
    expect(codeOf('E:\\Apps\\Atrium\\VPM')).toBe('vpmDataRootInsideApp')
  })

  it('does not mistake a sibling with the same prefix for an inside path', () => {
    expect(isSameOrInside('E:\\Library', 'E:\\Library2\\VPM', 'win32')).toBe(false)
    expect(codeOf('E:\\Library2\\VPM')).toBe('ok')
    expect(codeOf('E:\\UnityProjects\\Avatar2\\VPM')).toBe('ok')
  })

  it('rejects an overlong path', () => {
    expect(codeOf('E:\\' + 'a'.repeat(250))).toBe('vpmDataRootInvalid')
  })

  it('allows UNC/removable/non-NTFS with explicit warnings', () => {
    const unc = validateVpmDataRoot('\\\\server\\share\\AtriumVPM', base)
    expect(unc.ok).toBe(true)
    if (unc.ok) expect(unc.warnings).toContain('vpmDataRootUnc')

    const removable = validateVpmDataRoot('E:\\AtriumVPM', { ...base, removable: true })
    expect(removable.ok).toBe(true)
    if (removable.ok) expect(removable.warnings).toContain('vpmDataRootRemovable')

    const fat = validateVpmDataRoot('E:\\AtriumVPM', { ...base, fsType: 'FAT32' })
    expect(fat.ok).toBe(true)
    if (fat.ok) expect(fat.warnings).toContain('vpmDataRootNonNtfs')
  })

  it('handles Chinese paths and case-insensitive system-drive comparison', () => {
    expect(codeOf('E:\\素材\\AtriumVPM')).toBe('ok')
    expect(codeOf('c:\\AtriumVPM')).toBe('vpmDataRootOnSystemDrive')
  })
})
