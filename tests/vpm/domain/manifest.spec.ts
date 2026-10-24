import { describe, expect, it } from 'vitest'
import { buildManifest } from '../../../src/shared/vpm/domain/manifest'

describe('buildManifest', () => {
  it('writes sorted dependencies, exact locked versions and preserves unknown fields', () => {
    const built = buildManifest({
      before: {
        dependencies: { 'com.b': '1.0.0' },
        locked: { 'com.b': { version: '1.0.0', dependencies: {} } },
        legacyFolders: { 'com.old': 'Assets/Old' },
        custom: { nested: [1, 2, 3] }
      },
      roots: { 'com.z': '*', 'com.a': '^2.0.0' },
      finalPackages: [
        { name: 'com.z', version: '3.1.0' },
        { name: 'com.a', version: '2.0.5' }
      ],
      dependenciesOf: { 'com.z': { 'com.a': '^2.0.0' } }
    })

    expect(built.dependencies).toEqual({ 'com.a': '^2.0.0', 'com.z': '*' })
    // com.b 不在最终集合里，也没有被显式移除：保留旧条目（受保护/旧式/unlisted 包靠这条不被抹掉）。
    expect(Object.keys(built.locked)).toEqual(['com.a', 'com.b', 'com.z'])
    expect(built.locked['com.z']).toEqual({ version: '3.1.0', dependencies: { 'com.a': '^2.0.0' } })
    expect(built.locked['com.a']).toEqual({ version: '2.0.5', dependencies: {} })

    const data = JSON.parse(built.text) as Record<string, unknown>
    expect(data.custom).toEqual({ nested: [1, 2, 3] })
    expect(data.legacyFolders).toEqual({ 'com.old': 'Assets/Old' })
    expect(data.dependencies).toEqual({ 'com.a': '^2.0.0', 'com.z': '*' })
  })

  it('drops removed packages and keeps locked entries outside the final set', () => {
    const built = buildManifest({
      before: {
        locked: {
          'com.removed': { version: '1.0.0', dependencies: {} },
          'com.avca.bridge': { version: '1.2.0', dependencies: {} }
        }
      },
      roots: {},
      finalPackages: [],
      removed: ['com.removed']
    })

    expect(Object.keys(built.locked)).toEqual(['com.avca.bridge'])
    expect(built.locked['com.avca.bridge'].version).toBe('1.2.0')
  })

  it('is stable for the same input and changes when the plan changes', () => {
    const input = {
      before: { dependencies: {}, locked: {} },
      roots: { 'com.a': '*' },
      finalPackages: [{ name: 'com.a', version: '1.0.0' }]
    }
    const first = buildManifest(input)
    const second = buildManifest(input)
    expect(first.text).toBe(second.text)
    expect(first.hash).toBe(second.hash)

    const changed = buildManifest({
      ...input,
      finalPackages: [{ name: 'com.a', version: '1.0.1' }]
    })
    expect(changed.hash).not.toBe(first.hash)
  })

  it('falls back to the previous locked dependencies when none are supplied', () => {
    const built = buildManifest({
      before: {
        locked: { 'com.a': { version: '1.0.0', dependencies: { 'com.b': '^1.0.0' } } }
      },
      roots: { 'com.a': '1.0.0' },
      finalPackages: [{ name: 'com.a', version: '1.0.0' }]
    })
    expect(built.locked['com.a'].dependencies).toEqual({ 'com.b': '^1.0.0' })
  })

  it('ignores malformed names and ranges instead of writing them', () => {
    const built = buildManifest({
      before: null,
      roots: { 'com.a': '   ', 'bad/name': '1.0.0', 'com.b': '1.0.0' },
      finalPackages: [
        { name: 'com.c', version: '' },
        { name: 'com.d', version: '1.0.0' }
      ],
      dependenciesOf: { 'com.d': { 'bad dep': '1.0.0', 'com.e': '^2.0.0' } }
    })
    expect(built.dependencies).toEqual({ 'com.b': '1.0.0' })
    expect(Object.keys(built.locked)).toEqual(['com.d'])
    expect(built.locked['com.d'].dependencies).toEqual({ 'com.e': '^2.0.0' })
  })
})
