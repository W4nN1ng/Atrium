import { describe, expect, it } from 'vitest'
import type { VpmTemplateDto } from '../../src/shared/vpm/dto'
import {
  dependenciesText,
  parseDependenciesText,
  templateBaseCandidates
} from '../../src/renderer/vpm/components/settings/TemplateEditorPanel'

function template(id: string, overrides: Partial<VpmTemplateDto> = {}): VpmTemplateDto {
  return {
    id,
    name: id,
    description: null,
    source: id.startsWith('builtin.') ? 'builtin' : 'user',
    base: null,
    unity: { min: '2022.3', max: null, recommended: null },
    dependencies: {},
    unitypackages: [],
    favorite: false,
    visible: true,
    lastUsedAt: null,
    builtin: id.startsWith('builtin.'),
    broken: false,
    issues: [],
    ...overrides
  }
}

describe('template editor helpers (P8-F)', () => {
  it('parses dependency lines with comments, blank lines and ranges containing spaces', () => {
    const parsed = parseDependenciesText(
      [
        '# comment',
        '',
        'Com.Example.Dep   ^1.0.0',
        'com.example.other >= 1.2.0 < 2.0.0',
        '  # another'
      ].join('\r\n')
    )
    expect(parsed.issues).toEqual([])
    expect(parsed.dependencies).toEqual({
      'com.example.dep': '^1.0.0',
      'com.example.other': '>= 1.2.0 < 2.0.0'
    })
    expect(dependenciesText(parsed.dependencies)).toBe(
      'com.example.dep ^1.0.0\ncom.example.other >= 1.2.0 < 2.0.0'
    )
  })

  it('reports malformed, invalid-name, invalid-range and duplicate lines', () => {
    expect(parseDependenciesText('no-range').issues).toEqual([{ kind: 'line', line: 1 }])
    expect(parseDependenciesText('..bad ^1.0.0').issues[0]).toMatchObject({
      kind: 'name',
      line: 1
    })
    expect(parseDependenciesText('com.example.dep wat').issues[0]).toMatchObject({
      kind: 'range',
      line: 1
    })
    expect(
      parseDependenciesText('com.example.dep ^1\ncom.example.dep ^2').issues[0]
    ).toMatchObject({ kind: 'duplicate', line: 2, name: 'com.example.dep' })
  })

  it('excludes self and descendants from base choices, and skips hidden/broken entries', () => {
    const entries = [
      template('builtin.blank'),
      template('root'),
      template('child', { base: 'root' }),
      template('grandchild', { base: 'child' }),
      template('sibling'),
      template('hidden', { visible: false }),
      template('broken', { broken: true })
    ]
    const choices = templateBaseCandidates(entries, 'root').map((item) => item.id)
    expect(choices).toEqual(['builtin.blank', 'sibling'])
    expect(templateBaseCandidates(entries, null).map((item) => item.id)).toEqual([
      'builtin.blank',
      'root',
      'child',
      'grandchild',
      'sibling'
    ])
  })
})
