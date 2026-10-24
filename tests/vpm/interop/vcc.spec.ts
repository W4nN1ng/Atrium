import { describe, expect, it } from 'vitest'
import { parseVccSettings } from '../../../src/main/vpm/interop/vcc'
import { exportTemplate, parseTemplateFile } from '../../../src/main/vpm/interop/templateIO'

describe('vcc settings (read-only, P7-D)', () => {
  it('reads repos, package folders and unity hints, deduping by value', () => {
    const parsed = parseVccSettings(
      JSON.stringify({
        userRepos: [
          { url: 'https://example.test/a.json', name: 'A' },
          { url: 'https://example.test/a.json', name: 'A again' },
          'https://example.test/b.json'
        ],
        userPackageFolders: ['E:\\Packages', 'E:\\Packages', 'E:\\Other'],
        lastUnityPath: 'E:\\unity\\2022.3.22f1\\Editor\\Unity.exe',
        unityArguments: ['-force-vulkan', '']
      })
    )
    expect(parsed.repos.map((repo) => repo.url)).toEqual([
      'https://example.test/a.json',
      'https://example.test/b.json'
    ])
    expect(parsed.packageFolders).toEqual(['E:\\Packages', 'E:\\Other'])
    expect(parsed.unityHint).toContain('Unity.exe')
    expect(parsed.unityArguments).toEqual(['-force-vulkan'])
    expect(parsed.skipped.map((item) => item.reason)).toContain('duplicate')
  })

  it('skips non-https and malformed entries instead of throwing', () => {
    const parsed = parseVccSettings(
      JSON.stringify({
        userRepos: [{ url: 'http://insecure.test/a.json' }, { url: 42 }, { name: 'no url' }],
        userPackageFolders: [123]
      })
    )
    expect(parsed.repos).toEqual([])
    expect(parsed.packageFolders).toEqual([])
    expect(parsed.skipped.length).toBeGreaterThanOrEqual(3)
  })

  it('flags a broken file without throwing', () => {
    expect(parseVccSettings('{ not json').parseError).toBe(true)
    expect(parseVccSettings('[]').parseError).toBe(true)
  })
})

describe('template import/export (P7-D)', () => {
  it('imports an Atrium template as-is', () => {
    const imported = parseTemplateFile({
      schemaVersion: 1,
      id: 'my-template',
      name: '我的模板',
      unity: { min: '2022.3', max: null, recommended: '2022.3.22f1' },
      dependencies: { 'com.vrchat.avatars': '3.5.0' },
      unitypackages: [{ path: 'a.unitypackage', name: 'a' }]
    })
    expect(imported.source).toBe('atrium')
    expect(imported.manifest.name).toBe('我的模板')
    expect(imported.manifest.dependencies['com.vrchat.avatars']).toBe('3.5.0')
    expect(imported.manifest.unitypackages).toHaveLength(1)
  })

  it('accepts a foreign template shape (packages as array or map)', () => {
    const fromArray = parseTemplateFile({
      name: 'ALCOM Template',
      unityVersion: '2022.3.22f1',
      packages: ['com.vrchat.avatars@3.5.0', { name: 'com.vrchat.worlds', version: '3.5.0' }],
      unityPackages: ['x.unitypackage'],
      extraField: true
    })
    expect(fromArray.source).toBe('foreign')
    expect(fromArray.manifest.dependencies).toEqual({
      'com.vrchat.avatars': '3.5.0',
      'com.vrchat.worlds': '3.5.0'
    })
    expect(fromArray.manifest.unity.min).toBe('2022.3.22f1')
    expect(fromArray.manifest.unitypackages).toEqual([{ path: 'x.unitypackage', name: null }])
    expect(fromArray.ignored).toContain('extraField')

    const fromMap = parseTemplateFile({
      name: 'Map style',
      packages: { 'com.example.a': '^1.0.0' }
    })
    expect(fromMap.manifest.dependencies).toEqual({ 'com.example.a': '^1.0.0' })
  })

  it('falls back to the file name, but rejects a non-object file', () => {
    // 没有 name 的模板用文件名兜底（导入时文件名是用户唯一看得见的信息）
    expect(parseTemplateFile({ dependencies: {} }, 'my-file').manifest.name).toBe('my-file')
    expect(() => parseTemplateFile('nope')).toThrow(
      expect.objectContaining({ code: 'vpmTemplateInvalid' })
    )
    expect(() => parseTemplateFile([1, 2])).toThrow(
      expect.objectContaining({ code: 'vpmTemplateInvalid' })
    )
  })

  it('exports a round-trippable Atrium template', () => {
    const manifest = parseTemplateFile({
      schemaVersion: 1,
      id: 'round-trip',
      name: 'Round trip',
      unity: { min: '2022.3', max: null, recommended: null },
      dependencies: { 'com.example.a': '1.0.0' },
      unitypackages: []
    }).manifest

    const text = exportTemplate(manifest)
    const back = parseTemplateFile(JSON.parse(text))
    expect(back.source).toBe('atrium')
    expect(back.manifest).toMatchObject({
      id: 'round-trip',
      name: 'Round trip',
      dependencies: { 'com.example.a': '1.0.0' }
    })
  })
})
