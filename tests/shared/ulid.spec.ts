import { describe, it, expect } from 'vitest'
import { decodeTime, isValidUlid, ulid } from '../../src/shared/ulid'

describe('ULID', () => {
  it('26 位、字符集合法', () => {
    for (let i = 0; i < 200; i++) {
      const id = ulid()
      expect(id).toHaveLength(26)
      expect(isValidUlid(id)).toBe(true)
    }
    expect(isValidUlid('01J8XYZ')).toBe(false)
    expect(isValidUlid(''.padEnd(26, 'U'))).toBe(false) // U 不在 Crockford 字母表里
  })

  it('时间前缀可解回毫秒', () => {
    const t = 1759500000000
    const id = ulid(t)
    expect(decodeTime(id)).toBe(t)
  })

  it('同一毫秒内单调递增，所以按 id 排序就是按创建顺序排序', () => {
    const t = 1759500000000
    const ids: string[] = []
    for (let i = 0; i < 500; i++) ids.push(ulid(t))
    const sorted = [...ids].sort()
    expect(sorted).toEqual(ids)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('跨毫秒不重复', () => {
    const a = ulid(1759500000000)
    const b = ulid(1759500000001)
    expect(a).not.toBe(b)
    expect(a < b).toBe(true)
  })
})
