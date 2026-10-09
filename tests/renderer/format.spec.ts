import { describe, expect, it } from 'vitest'
import { humanBytes, humanNumber, intlLocale } from '../../src/renderer/lib/format'
import type { LocaleKey } from '../../src/shared/types'

const LOCALES: LocaleKey[] = ['zh-CN', 'en', 'ja']

describe('humanBytes', () => {
  it('小于 1KB 不能炸（Intl 的单位名是 byte，写成 bytes 会抛 RangeError）', () => {
    for (const loc of LOCALES) {
      for (const n of [0, 1, 270, 1023]) {
        expect(() => humanBytes(n, loc), `${loc} / ${n}`).not.toThrow()
        expect(humanBytes(n, loc).length, '要有内容，不能空').toBeGreaterThan(0)
      }
    }
    expect(humanBytes(270, 'zh-CN')).toContain('270')
  })

  it('各档位都出得来，且带单位', () => {
    expect(humanBytes(366800, 'en')).toMatch(/358\.2\s?kB/)
    expect(humanBytes(7200000, 'en')).toMatch(/6\.9\s?MB/)
    expect(humanBytes(5 * 1024 ** 3, 'en')).toMatch(/5\s?GB/)
    expect(humanBytes(3 * 1024 ** 4, 'en')).toMatch(/3\s?TB/)
  })

  it('脏输入走占位符而不是 NaN', () => {
    for (const loc of LOCALES) {
      expect(humanBytes(null, loc)).toBe('—')
      expect(humanBytes(undefined, loc)).toBe('—')
      expect(humanBytes(Number.NaN, loc)).toBe('—')
      expect(humanBytes(Number.POSITIVE_INFINITY, loc)).toBe('—')
      expect(humanBytes(-5, loc)).not.toContain('NaN')
    }
  })

  it('locale 映射到真的 BCP47 标签', () => {
    expect(intlLocale('zh-CN')).toBe('zh-CN')
    expect(intlLocale('en')).toBe('en-US')
    expect(intlLocale('ja')).toBe('ja-JP')
  })

  it('humanNumber 不抛', () => {
    expect(() => humanNumber(12345, 'zh-CN')).not.toThrow()
  })
})
