import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { VPM_ERROR_CODES, VPM_WARNING_CODES } from '../../src/shared/vpm/errors'

const ROOT = path.resolve(__dirname, '../..')
const LOCALES = ['zh-CN', 'en', 'ja'] as const

function load(locale: string): Record<string, unknown> {
  return JSON.parse(
    fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'i18n', `${locale}.json`), 'utf8')
  ) as Record<string, unknown>
}

function at(root: Record<string, unknown>, dotted: string): unknown {
  let node: unknown = root
  for (const part of dotted.split('.')) {
    if (!node || typeof node !== 'object') return undefined
    node = (node as Record<string, unknown>)[part]
  }
  return node
}

describe('VPM error/warning i18n coverage', () => {
  it('defines every machine code in all three locales', () => {
    for (const locale of LOCALES) {
      const data = load(locale)
      for (const code of VPM_ERROR_CODES) {
        const value = at(data, `vpm.errors.${code}`)
        expect(typeof value, `${locale} missing vpm.errors.${code}`).toBe('string')
        expect(String(value).trim().length, `${locale} empty vpm.errors.${code}`).toBeGreaterThan(0)
      }
      for (const code of VPM_WARNING_CODES) {
        const value = at(data, `vpm.warnings.${code}`)
        expect(typeof value, `${locale} missing vpm.warnings.${code}`).toBe('string')
        expect(String(value).trim().length, `${locale} empty vpm.warnings.${code}`).toBeGreaterThan(0)
      }
    }
  })

  it('has no duplicate codes and no accidental extras under vpm.errors', () => {
    expect(new Set(VPM_ERROR_CODES).size).toBe(VPM_ERROR_CODES.length)
    expect(new Set(VPM_WARNING_CODES).size).toBe(VPM_WARNING_CODES.length)
    const errors = at(load('zh-CN'), 'vpm.errors') as Record<string, unknown>
    expect(Object.keys(errors).sort()).toEqual([...VPM_ERROR_CODES].sort())
  })

  it('keeps the user-facing strings free of future-promise wording', () => {
    for (const locale of LOCALES) {
      const raw = JSON.stringify(at(load(locale), 'vpm'))
      expect(raw).not.toMatch(/将在|敬请期待|Coming in|coming soon|TODO/)
    }
  })
})
