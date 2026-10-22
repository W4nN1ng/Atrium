import { describe, expect, it } from 'vitest'
import {
  TEMPLATE_SCHEMA_VERSION,
  compareUnity,
  intersectUnityRange,
  isValidTemplateId,
  mergeTemplate,
  normalizeAttachmentPath,
  parseTemplateManifest,
  rangesOverlap,
  resolveTemplate,
  serializeTemplateManifest,
  type TemplateManifest
} from '../../../src/shared/vpm/domain/template'

function manifest(overrides: Partial<TemplateManifest> = {}): TemplateManifest {
  return {
    schemaVersion: TEMPLATE_SCHEMA_VERSION,
    id: 'user.demo',
    name: 'Demo',
    description: null,
    base: null,
    unity: { min: '2022.3', max: null, recommended: '2022.3.22f1' },
    dependencies: {},
    unitypackages: [],
    settings: {},
    extra: {},
    ...overrides
  }
}

function raw(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 1,
    id: 'user.demo',
    name: 'Demo',
    description: null,
    base: null,
    unity: { min: '2022.3', max: null, recommended: '2022.3.22f1' },
    dependencies: {},
    unitypackages: [],
    settings: {},
    ...overrides
  }
}

describe('template manifest parsing', () => {
  it('accepts a complete manifest and keeps unknown fields', () => {
    const parsed = parseTemplateManifest(
      raw({
        dependencies: { 'com.vrchat.avatars': '>=3.0.0 <4.0.0' },
        unitypackages: [{ path: 'files/a.unitypackage', name: 'a' }],
        settings: { theme: 'dark' },
        futureField: { keep: true }
      })
    )
    expect(parsed.ok).toBe(true)
    expect(parsed.manifest?.dependencies).toEqual({ 'com.vrchat.avatars': '>=3.0.0 <4.0.0' })
    expect(parsed.manifest?.unitypackages).toEqual([{ path: 'files/a.unitypackage', name: 'a' }])
    expect(parsed.manifest?.extra).toEqual({ futureField: { keep: true } })

    const text = serializeTemplateManifest(parsed.manifest as TemplateManifest)
    const round = parseTemplateManifest(JSON.parse(text))
    expect(round.ok).toBe(true)
    expect(round.manifest?.extra).toEqual({ futureField: { keep: true } })
  })

  it('rejects unknown schema versions instead of guessing', () => {
    const parsed = parseTemplateManifest(raw({ schemaVersion: 2 }))
    expect(parsed.ok).toBe(false)
    expect(parsed.issues.map((item) => item.code)).toContain('schemaVersion')
  })

  it('rejects bad ids, empty names and self-referencing base', () => {
    expect(parseTemplateManifest(raw({ id: 'a b' })).issues.map((i) => i.code)).toContain('id')
    expect(parseTemplateManifest(raw({ id: '-leading' })).issues.map((i) => i.code)).toContain('id')
    expect(parseTemplateManifest(raw({ name: '   ' })).issues.map((i) => i.code)).toContain('name')
    expect(parseTemplateManifest(raw({ base: 'user.demo' })).issues.map((i) => i.code)).toContain('cycle')
  })

  it('rejects invalid dependency names and ranges', () => {
    const badName = parseTemplateManifest(raw({ dependencies: { 'bad name': '1.0.0' } }))
    expect(badName.issues.map((i) => i.code)).toContain('dependency')
    const badRange = parseTemplateManifest(raw({ dependencies: { 'com.example.a': 'not-a-range' } }))
    expect(badRange.issues.map((i) => i.code)).toContain('dependency')
  })

  it('rejects unity ranges where max < min', () => {
    const parsed = parseTemplateManifest(raw({ unity: { min: '2022.3', max: '2021.3', recommended: null } }))
    expect(parsed.issues.map((i) => i.code)).toContain('unityRange')
  })

  it('only accepts attachment paths under files/', () => {
    expect(normalizeAttachmentPath('files/a.unitypackage')).toBe('files/a.unitypackage')
    for (const bad of ['a.unitypackage', '/files/a', 'C:/files/a', 'files/../a', 'files\\a', 'files//a', 'assets/a']) {
      expect(normalizeAttachmentPath(bad), bad).toBeNull()
    }
    const duplicate = parseTemplateManifest(
      raw({
        unitypackages: [
          { path: 'files/a.unitypackage' },
          { path: 'files/A.unitypackage' }
        ]
      })
    )
    expect(duplicate.issues.map((i) => i.code)).toContain('attachment')
  })

  it('rejects more than 32 attachments', () => {
    const many = Array.from({ length: 33 }, (_, index) => ({ path: `files/${index}.unitypackage` }))
    const parsed = parseTemplateManifest(raw({ unitypackages: many }))
    expect(parsed.issues.map((i) => i.code)).toContain('attachment')
  })
})

describe('unity range helpers', () => {
  it('compares versions by numeric segments', () => {
    expect(compareUnity('2022.3.22f1', '2022.3')).toBe(1)
    expect(compareUnity('2022.3', '2022.3.0')).toBe(0)
    expect(compareUnity('2021.3', '2022.3')).toBe(-1)
  })

  it('intersects ranges and reports empty intersections', () => {
    expect(
      intersectUnityRange(
        { min: '2022.3', max: '2023.1', recommended: null },
        { min: '2022.3.10', max: null, recommended: '2022.3.22f1' }
      )
    ).toEqual({ min: '2022.3.10', max: '2023.1', recommended: '2022.3.22f1' })
    expect(
      intersectUnityRange(
        { min: '2023.1', max: null, recommended: null },
        { min: '2022.3', max: '2022.4', recommended: null }
      )
    ).toBeNull()
  })
})

describe('template inheritance', () => {
  it('merges dependencies, attachments, settings and unity ranges', () => {
    const base = manifest({
      id: 'base',
      unity: { min: '2022.3', max: null, recommended: '2022.3.22f1' },
      dependencies: { 'com.a': '^1.0.0', 'com.b': '^1.0.0' },
      unitypackages: [{ path: 'files/base.unitypackage', name: null }],
      settings: { a: 1, b: 1 }
    })
    const child = manifest({
      id: 'child',
      base: 'base',
      unity: { min: '2022.3.10', max: '2023.1', recommended: null },
      dependencies: { 'com.b': '^2.0.0' },
      unitypackages: [{ path: 'files/child.unitypackage', name: 'child' }],
      settings: { b: 2 }
    })
    const merged = mergeTemplate(base, child)
    expect(merged).not.toBeNull()
    expect(merged?.dependencies).toEqual({ 'com.a': '^1.0.0', 'com.b': '^2.0.0' })
    expect(merged?.unitypackages.map((item) => item.path)).toEqual([
      'files/base.unitypackage',
      'files/child.unitypackage'
    ])
    expect(merged?.settings).toEqual({ a: 1, b: 2 })
    expect(merged?.unity).toEqual({ min: '2022.3.10', max: '2023.1', recommended: '2022.3.22f1' })
  })

  it('returns null when the unity ranges do not intersect', () => {
    const merged = mergeTemplate(
      manifest({ unity: { min: '2023.1', max: null, recommended: null } }),
      manifest({ unity: { min: '2022.3', max: '2022.4', recommended: null } })
    )
    expect(merged).toBeNull()
  })

  it('resolves a chain and reports cycles, missing bases and depth', () => {
    const table = new Map<string, TemplateManifest>([
      ['base', manifest({ id: 'base' })],
      ['mid', manifest({ id: 'mid', base: 'base' })],
      ['top', manifest({ id: 'top', base: 'mid' })]
    ])
    const lookup = (id: string): TemplateManifest | null => table.get(id) ?? null

    const ok = resolveTemplate('top', lookup)
    expect(ok.ok).toBe(true)
    if (ok.ok) expect(ok.resolution.chain).toEqual(['top', 'mid', 'base'])

    const cycleTable = new Map<string, TemplateManifest>([
      ['a', manifest({ id: 'a', base: 'b' })],
      ['b', manifest({ id: 'b', base: 'a' })]
    ])
    const cycle = resolveTemplate('a', (id) => cycleTable.get(id) ?? null)
    expect(cycle.ok).toBe(false)
    if (!cycle.ok) expect(cycle.issues.map((item) => item.code)).toContain('cycle')

    const missing = resolveTemplate('nope', lookup)
    expect(missing.ok).toBe(false)
    if (!missing.ok) expect(missing.issues.map((item) => item.code)).toContain('missingBase')

    const deep = new Map<string, TemplateManifest>()
    for (let index = 0; index <= 9; index++) {
      deep.set(`t${index}`, manifest({ id: `t${index}`, base: index === 0 ? null : `t${index - 1}` }))
    }
    const tooDeep = resolveTemplate('t9', (id) => deep.get(id) ?? null)
    expect(tooDeep.ok).toBe(false)
    if (!tooDeep.ok) expect(tooDeep.issues.map((item) => item.code)).toContain('depth')
  })

  it('only claims overlap when it can prove it', () => {
    expect(rangesOverlap('=1.2.3', '^1.0.0')).toBe(true)
    expect(rangesOverlap('=2.0.0', '^1.0.0')).toBe(false)
    expect(rangesOverlap('^1.0.0', '>=1.5.0 <2.0.0')).toBe(true)
  })
})

describe('template ids', () => {
  it('accepts builtin and user ids, rejects unsafe ones', () => {
    expect(isValidTemplateId('builtin.blank')).toBe(true)
    expect(isValidTemplateId('user.01arz3ndek')).toBe(true)
    expect(isValidTemplateId('../escape')).toBe(false)
    expect(isValidTemplateId('')).toBe(false)
    expect(isValidTemplateId('-bad')).toBe(false)
    // ULID 是大写，模板 id 必须接受
    expect(isValidTemplateId('01ARZ3NDEKTSV4RRFFQ69G5FAV')).toBe(true)
  })
})
