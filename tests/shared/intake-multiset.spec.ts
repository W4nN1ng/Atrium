import { describe, expect, it } from 'vitest'
import {
  contentMultiset,
  deserializeContentKey,
  multisetDiff,
  multisetEqual,
  multisetIntersect,
  serializeContentKey
} from '../../src/shared/intake'

const a = { size: 148, crc32: 0x5dc370cd }
const b = { size: 4128506, crc32: 0x2b81c480 }

describe('intake content keys', () => {
  it('serializes full unsigned CRC32 and large safe file sizes without truncation', () => {
    const key = { size: 64 * 1024 ** 3, crc32: 0xffffffff }
    expect(serializeContentKey(key)).toBe('68719476736:ffffffff')
    expect(deserializeContentKey(serializeContentKey(key))).toEqual(key)
  })

  it('accepts an empty file as a real content key', () => {
    expect(deserializeContentKey('0:00000000')).toEqual({ size: 0, crc32: 0 })
  })

  it.each([-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])('rejects unsafe file size %s', (size) => {
    expect(() => serializeContentKey({ size, crc32: 0 })).toThrow()
  })

  it.each([-1, 0x100000000, 1.5, NaN])('rejects invalid CRC32 %s', (crc32) => {
    expect(() => serializeContentKey({ size: 1, crc32 })).toThrow()
  })

  it.each(['01:00000000', '1:FF000000', '1:0', '-1:00000000', '9007199254740992:00000000', '1:00000000:extra'])('rejects noncanonical serialized key %s', (value) => {
    expect(() => deserializeContentKey(value)).toThrow()
  })
})

describe('intake leaf multisets', () => {
  it('motchiri: different garbled names and wrapper paths do not change content equality', () => {
    const archive = { relPath: 'motchiri/_Éαû╛Åæ.url', key: a }
    const loose = { relPath: 'motchiri/motchiri/_愢柧彂.url', key: { ...a } }
    expect(multisetEqual(contentMultiset([archive.key]), contentMultiset([loose.key]))).toBe(true)
  })

  it('does not equate one occurrence with two copies of the same content', () => {
    const archive = contentMultiset([a, a])
    const directory = contentMultiset([a])
    expect(multisetEqual(archive, directory)).toBe(false)
    expect([...multisetIntersect(archive, directory)]).toEqual([[serializeContentKey(a), 1]])
    expect([...multisetDiff(archive, directory)]).toEqual([[serializeContentKey(a), 1]])
  })

  it('keeps missing leaf multiplicity while subtracting only actual coverage', () => {
    expect([...multisetDiff(contentMultiset([a, a, b]), contentMultiset([a]))]).toEqual([
      [serializeContentKey(a), 1], [serializeContentKey(b), 1]
    ])
  })

  it('same filename with different contents remains different', () => {
    expect(multisetEqual(contentMultiset([a]), contentMultiset([{ ...a, crc32: a.crc32 + 1 }]))).toBe(false)
    expect(multisetEqual(contentMultiset([a]), contentMultiset([{ ...a, size: a.size + 1 }]))).toBe(false)
  })

  it('canonical output is independent of discovery order', () => {
    const left = contentMultiset([a, b, a])
    const right = contentMultiset([b, a, a])
    expect([...left]).toEqual([...right])
    expect([...multisetIntersect(left, right)]).toEqual([...multisetIntersect(right, left)])
  })

  it('operations do not mutate their inputs or retain zero-count entries', () => {
    const left = new Map([[serializeContentKey(a), 2], [serializeContentKey(b), 0]])
    const right = contentMultiset([a, b])
    const snapshot = [...left]
    expect([...multisetDiff(left, right)]).toEqual([[serializeContentKey(a), 1]])
    expect([...left]).toEqual(snapshot)
    expect([...right]).toEqual([...contentMultiset([a, b])])
    expect(multisetEqual(left, contentMultiset([a, a]))).toBe(true)
  })

  it('handles empty and fully disjoint multisets', () => {
    expect(multisetEqual(contentMultiset([]), new Map())).toBe(true)
    expect(multisetIntersect(contentMultiset([a]), contentMultiset([b])).size).toBe(0)
    expect([...multisetDiff(contentMultiset([a]), contentMultiset([b]))]).toEqual([[serializeContentKey(a), 1]])
  })

  it.each([-1, 1.5, Infinity, Number.MAX_SAFE_INTEGER + 1])('rejects malformed occurrence count %s', (count) => {
    const invalid = new Map([[serializeContentKey(a), count]])
    expect(() => multisetDiff(invalid, new Map())).toThrow()
    expect(() => multisetIntersect(new Map(), invalid)).toThrow()
    expect(() => multisetEqual(new Map(), invalid)).toThrow()
  })
})
