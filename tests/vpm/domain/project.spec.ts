import { describe, expect, it } from 'vitest'
import { sha256Hex } from '../../../src/shared/vpm/domain/hash'
import {
  PROTECTED_PROJECT_PACKAGE,
  normalizeProjectPath,
  parseProjectPackageJson,
  parseProjectVersion,
  parseVpmManifest,
  projectKeyOf,
  projectSlugOf,
  readProjectSnapshot,
  type ProjectFsEntry,
  type ProjectReaderPort
} from '../../../src/shared/vpm/domain/project'

interface MemoryOptions {
  symlinks?: string[]
  throwOn?: string[]
}

function normalize(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
}

function memoryPort(files: Record<string, string>, options: MemoryOptions = {}): ProjectReaderPort {
  const fileMap = new Map<string, string>()
  const dirs = new Set<string>()
  const symlinks = new Set((options.symlinks ?? []).map(normalize))
  const throwOn = new Set((options.throwOn ?? []).map(normalize))

  for (const [raw, text] of Object.entries(files)) {
    const key = normalize(raw)
    fileMap.set(key, text)
    const parts = key.split('/')
    for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join('/'))
  }
  for (const link of symlinks) {
    const parts = link.split('/')
    for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join('/'))
  }

  const check = (rel: string): string => {
    const key = normalize(rel)
    if (throwOn.has(key)) throw new Error('denied')
    return key
  }

  return {
    read(rel) {
      const key = check(rel)
      const text = fileMap.get(key)
      return text === undefined ? null : { text, mtime: 100 }
    },
    list(rel) {
      const key = check(rel)
      const prefix = key ? `${key}/` : ''
      const found = new Map<string, ProjectFsEntry>()
      for (const path of [...fileMap.keys(), ...dirs, ...symlinks]) {
        if (!path.startsWith(prefix) || path === key) continue
        const rest = path.slice(prefix.length)
        const name = rest.split('/')[0]
        if (!name) continue
        const isLeaf = !rest.includes('/')
        if (isLeaf && fileMap.has(path)) found.set(name, { name, kind: 'file', symlink: false })
        else if (isLeaf && symlinks.has(path)) found.set(name, { name, kind: 'dir', symlink: true })
        else if (dirs.has(path)) found.set(name, { name, kind: 'dir', symlink: false })
      }
      return [...found.values()]
    },
    stat(rel) {
      const key = check(rel)
      if (fileMap.has(key)) return { name: key.split('/').pop() ?? key, kind: 'file', symlink: false }
      if (symlinks.has(key)) return { name: key.split('/').pop() ?? key, kind: 'dir', symlink: true }
      if (dirs.has(key)) return { name: key.split('/').pop() ?? key, kind: 'dir', symlink: false }
      return null
    }
  }
}

const versionFile = 'm_EditorVersion: 2022.3.22f1\r\nm_EditorVersionWithRevision: 2022.3.22f1 (abc123)\r\n'
const manifest = JSON.stringify({
  dependencies: {
    'com.vrchat.avatars': '3.7.0',
    'com.old.pkg': '1.0.0',
    'com.missing.pkg': '2.0.0',
    'com.avca.bridge': '1.0.0'
  },
  locked: { 'com.vrchat.avatars': { version: '3.7.0' } },
  legacyFolders: { 'com.folder.pkg': 'LegacyFolder' },
  legacyFiles: { 'com.file.pkg': 'LegacyFile.cs' },
  legacyPackages: ['com.package.id'],
  customUnknown: { keep: true }
})

function normalFiles(): Record<string, string> {
  return {
    'ProjectSettings/ProjectVersion.txt': versionFile,
    'ProjectSettings/ProjectSettings.asset': 'productGUID: 0123456789abcdef0123456789abcdef\n',
    'Packages/vpm-manifest.json': `\uFEFF${manifest}`,
    'Packages/com.vrchat.avatars/package.json': JSON.stringify({
      name: 'com.vrchat.avatars',
      version: '3.7.0',
      unity: '2022.3',
      vpmDependencies: { 'com.vrchat.base': '3.7.0' }
    }),
    'Packages/com.old.pkg/package.json': JSON.stringify({ name: 'com.old.pkg', version: '0.9.0' }),
    'Packages/com.local.pkg/package.json': JSON.stringify({ name: 'com.local.pkg', version: '0.1.0' }),
    'Packages/com.local.pkg-copy/package.json': JSON.stringify({ name: 'com.local.pkg', version: '0.1.0' }),
    'Packages/com.avca.bridge/package.json': JSON.stringify({ name: 'com.avca.bridge', version: '1.2.0' }),
    'Packages/com.no-manifest/readme.txt': 'skip',
    'Assets/LegacyPkg/package.json': JSON.stringify({ name: 'com.legacy.pkg', version: '1.0.0' }),
    'Assets/LegacyFolder/old.txt': 'x',
    'Assets/LegacyFile.cs': 'x',
    'Assets/Library/package.json': JSON.stringify({ name: 'com.ignored.pkg', version: '1.0.0' })
  }
}

function snapshot(files = normalFiles(), options: MemoryOptions = {}, limits = {}) {
  return readProjectSnapshot(memoryPort(files, options), 'C:/Projects/MyProject', limits)
}

describe('project identity', () => {
  it('has a known-good pure SHA-256 vector', () => {
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  })

  it('normalizes Windows paths and derives a stable key/slug', () => {
    expect(normalizeProjectPath('C:/Projects/MyProject/')).toBe('C:\\Projects\\MyProject')
    expect(projectKeyOf('C:\\Projects\\MyProject')).toBe('c:\\projects\\myproject')
    expect(projectSlugOf('C:/Projects/MyProject')).toBe(projectSlugOf('C:\\PROJECTS\\MYPROJECT'))
    expect(projectSlugOf('C:/Projects/MyProject')).toMatch(/^myproject-[0-9a-f]{8}$/)
    expect(() => normalizeProjectPath('relative\\project')).toThrowError(/vpmProjectInvalid/)
    expect(() => normalizeProjectPath('C:relative')).toThrowError(/vpmProjectInvalid/)
  })

  it('parses ProjectVersion.txt with revision and rejects a bad version', () => {
    expect(parseProjectVersion(versionFile)).toEqual({
      version: '2022.3.22f1',
      revision: 'abc123',
      versionWithRevision: '2022.3.22f1 (abc123)'
    })
    expect(() => parseProjectVersion('m_EditorVersion: nope')).toThrowError(/vpmProjectInvalid/)
  })
})

describe('manifest and package parsing', () => {
  it('preserves unknown manifest fields and normalizes legacy lists', () => {
    const parsed = parseVpmManifest(`\uFEFF${manifest}`)
    expect(parsed).toMatchObject({
      hasManifest: true,
      valid: true,
      dependencies: {
        'com.vrchat.avatars': '3.7.0',
        'com.old.pkg': '1.0.0',
        'com.missing.pkg': '2.0.0',
        'com.avca.bridge': '1.0.0'
      },
      legacyFolders: [{ packageId: 'com.folder.pkg', path: 'LegacyFolder' }],
      legacyFiles: [{ packageId: 'com.file.pkg', path: 'LegacyFile.cs' }],
      legacyPackages: ['com.package.id']
    })
    expect(parsed.data?.customUnknown).toEqual({ keep: true })
    expect(parseVpmManifest('{bad').valid).toBe(false)
    expect(parseVpmManifest(null)).toMatchObject({ hasManifest: false, valid: true })
  })

  it('parses package.json and rejects path-like names', () => {
    expect(parseProjectPackageJson('{"name":"com.example.pkg","version":"1.2.3"}')).toMatchObject({
      name: 'com.example.pkg',
      version: '1.2.3'
    })
    expect(() => parseProjectPackageJson('{"name":"../evil","version":"1.0.0"}')).toThrowError(/vpmProjectInvalid/)
  })
})

describe('project snapshot', () => {
  it('reads version, manifest, packages, protected/missing/mismatch states and fingerprint', () => {
    const result = snapshot(normalFiles(), { symlinks: ['Packages/linked.pkg'] })
    expect(result).toMatchObject({
      readOnly: true,
      projectKey: 'c:\\projects\\myproject',
      projectPath: 'C:\\Projects\\MyProject',
      name: 'MyProject',
      unityVersion: '2022.3.22f1',
      unityRevision: 'abc123',
      productGuid: '0123456789abcdef0123456789abcdef'
    })
    expect(result.manifestHash).toMatch(/^[0-9a-f]{64}$/)
    expect(result.manifestMtime).toBe(100)
    const states = Object.fromEntries(result.packages.map((pkg) => [pkg.name, pkg]))
    expect(states['com.vrchat.avatars']).toMatchObject({ version: '3.7.0', state: 'installed' })
    expect(states['com.old.pkg']).toMatchObject({ version: '0.9.0', manifestVersion: '1.0.0', state: 'mismatch' })
    expect(states['com.local.pkg']).toMatchObject({ state: 'unlisted' })
    expect(states['com.missing.pkg']).toMatchObject({ state: 'missing', missing: true })
    expect(states[PROTECTED_PROJECT_PACKAGE]).toMatchObject({ state: 'protected' })
    expect(result.warnings.map((item) => item.code)).toContain('vpmProjectSymlinkSkipped')
    expect(result.warnings.map((item) => item.code)).toContain('vpmProjectDuplicatePackage')
  })

  it('reports partial results when Packages is unreadable instead of throwing', () => {
    const result = snapshot(normalFiles(), { throwOn: ['Packages'] })
    expect(result.packages.map((pkg) => pkg.name)).toEqual(expect.arrayContaining(['com.missing.pkg']))
    expect(result.warnings.map((item) => item.code)).toContain('vpmProjectPackagesUnreadable')
  })

  it('reports legacy package.json/folder/file/package candidates and ignores Library', () => {
    const result = snapshot()
    expect(result.legacy.readOnly).toBe(true)
    expect(result.legacy.candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'com.legacy.pkg', match: 'packageJson', confidence: 'high' }),
        expect.objectContaining({ name: 'com.folder.pkg', match: 'legacyFolder', confidence: 'high' }),
        expect.objectContaining({ name: 'com.file.pkg', match: 'legacyFile', confidence: 'high' }),
        expect.objectContaining({ name: 'com.package.id', match: 'legacyPackage', confidence: 'medium' })
      ])
    )
    expect(result.legacy.candidates.some((item) => item.name === 'com.ignored.pkg')).toBe(false)
    expect(result.legacy.candidates.every((item) => item.risk === 'backupRequired')).toBe(true)
  })

  it('truncates legacy scans at the configured limit', () => {
    const result = snapshot(normalFiles(), {}, { maxLegacyEntries: 1 })
    expect(result.legacy.truncated).toBe(true)
    expect(result.warnings.map((item) => item.code)).toContain('vpmProjectScanTruncated')
  })

  it('changes the fingerprint when manifest or package.json changes', () => {
    const first = snapshot()
    const changedManifest = { ...normalFiles(), 'Packages/vpm-manifest.json': manifest.replace('3.7.0', '3.8.0') }
    const changedPackage = { ...normalFiles(), 'Packages/com.old.pkg/package.json': '{"name":"com.old.pkg","version":"0.9.1"}' }
    expect(snapshot(changedManifest).fingerprint).not.toBe(first.fingerprint)
    expect(snapshot(changedPackage).fingerprint).not.toBe(first.fingerprint)
  })

  it('rejects a non-project path and a missing version file', () => {
    expect(() => readProjectSnapshot(memoryPort({}), 'C:\\Projects\\Nope')).toThrowError(/vpmProjectInvalid/)
    expect(() => readProjectSnapshot(memoryPort({}), 'relative')).toThrowError(/vpmProjectInvalid/)
  })

  it('keeps packages readable when vpm-manifest.json is invalid', () => {
    const files = { ...normalFiles(), 'Packages/vpm-manifest.json': '{bad manifest' }
    const result = snapshot(files)
    expect(result.manifest.valid).toBe(false)
    expect(result.warnings.map((item) => item.code)).toContain('vpmManifestInvalid')
    expect(result.packages.some((pkg) => pkg.name === 'com.local.pkg')).toBe(true)
  })

  it('skips invalid package.json without losing the project snapshot', () => {
    const files = {
      ...normalFiles(),
      'Packages/broken/package.json': '{not json'
    }
    const result = snapshot(files)
    expect(result.packages.some((pkg) => pkg.name === 'broken')).toBe(false)
    expect(result.warnings.map((item) => item.code)).toContain('vpmProjectPackageInvalid')
  })
})
