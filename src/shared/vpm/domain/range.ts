import { VpmError } from '../errors'
import {
  compareParsedVersions,
  parseVpmVersion,
  type VpmVersion
} from './version'

const MAX_RANGE_LENGTH = 500
const MAX_SETS = 16
const MAX_COMPARATORS = 32

export type VpmComparatorOperator = '=' | '>' | '>=' | '<' | '<='

export interface VpmComparator {
  operator: VpmComparatorOperator
  version: VpmVersion
}

export interface VpmComparatorSet {
  comparators: VpmComparator[]
}

export interface VpmVersionRange {
  raw: string
  sets: VpmComparatorSet[]
}

export interface RangeSatisfyOptions {
  /** 解析器明确允许预发布时使用；默认遵循 SemVer 的预发布规则。 */
  includePrerelease?: boolean
}

interface PartialVersion {
  major: number
  minor: number | null
  patch: number | null
  prerelease: string[]
  build: string[]
  wildcard: boolean
  raw: string
}

function invalid(field = 'range'): VpmError {
  return new VpmError('vpmRangeInvalid', { field })
}

function makeVersion(major: number, minor: number, patch: number, prerelease: string[] = []): VpmVersion {
  return {
    major,
    minor,
    patch,
    prerelease,
    build: [],
    raw: `${major}.${minor}.${patch}${prerelease.length ? `-${prerelease.join('.')}` : ''}`
  }
}

function parsePartial(text: string): PartialVersion {
  if (!text || text.length > 200) throw invalid()
  const buildSplit = text.split('+')
  if (buildSplit.length > 2) throw invalid()
  const build = buildSplit[1] ? buildSplit[1].split('.') : []
  if (build.length && !build.every((part) => part && /^[0-9A-Za-z-]+$/.test(part))) throw invalid()
  const dash = buildSplit[0].indexOf('-')
  const core = dash >= 0 ? buildSplit[0].slice(0, dash) : buildSplit[0]
  const prerelease = dash >= 0 ? buildSplit[0].slice(dash + 1).split('.') : []
  if (prerelease.length && !prerelease.every((part) =>
    part && /^[0-9A-Za-z-]+$/.test(part) && !(/^\d+$/.test(part) && part.length > 1 && part.startsWith('0'))
  )) throw invalid()

  const parts = core.split('.')
  if (!parts.length || parts.length > 3) throw invalid()
  let wildcard = false
  const numbers: Array<number | null> = [null, null, null]
  for (let index = 0; index < parts.length; index++) {
    const part = parts[index]
    if (part === '*' || part.toLowerCase() === 'x') {
      wildcard = true
      continue
    }
    if (wildcard || !/^(0|[1-9]\d*)$/.test(part)) throw invalid()
    const value = Number(part)
    if (!Number.isSafeInteger(value)) throw invalid()
    numbers[index] = value
  }
  if (numbers[0] === null) throw invalid()
  if ((wildcard || numbers[2] === null) && (prerelease.length || build.length)) throw invalid()
  return {
    major: numbers[0],
    minor: numbers[1],
    patch: numbers[2],
    prerelease,
    build,
    wildcard,
    raw: text
  }
}

function lower(partial: PartialVersion): VpmVersion {
  return makeVersion(partial.major, partial.minor ?? 0, partial.patch ?? 0, partial.prerelease)
}

function nextMinor(partial: PartialVersion): VpmVersion {
  return makeVersion(partial.major, (partial.minor ?? 0) + 1, 0)
}

function nextPatch(partial: PartialVersion): VpmVersion {
  return makeVersion(partial.major, partial.minor ?? 0, (partial.patch ?? 0) + 1)
}

function upper(partial: PartialVersion): VpmVersion {
  if (partial.minor === null) return makeVersion(partial.major + 1, 0, 0)
  if (partial.patch === null) return nextMinor(partial)
  return nextPatch(partial)
}

function caretUpper(partial: PartialVersion): VpmVersion {
  if (partial.major > 0 || partial.minor === null) return makeVersion(partial.major + 1, 0, 0)
  if (partial.minor > 0 || partial.patch === null) return makeVersion(0, partial.minor + 1, 0)
  return makeVersion(0, 0, (partial.patch ?? 0) + 1)
}

function tildeUpper(partial: PartialVersion): VpmVersion {
  return partial.minor === null ? makeVersion(partial.major + 1, 0, 0) : nextMinor(partial)
}

function comparator(operator: VpmComparatorOperator, version: VpmVersion): VpmComparator {
  return { operator, version }
}

function parseToken(token: string): VpmComparator[] {
  if (token === '*' || token.toLowerCase() === 'x') return []
  const match = /^(\^|~|>=|<=|>|<|=)?(.+)$/.exec(token)
  if (!match) throw invalid()
  const operator = match[1] ?? '='
  const partial = parsePartial(match[2])
  if (operator === '^') {
    return [comparator('>=', lower(partial)), comparator('<', caretUpper(partial))]
  }
  if (operator === '~') {
    return [comparator('>=', lower(partial)), comparator('<', tildeUpper(partial))]
  }
  if (operator === '=') {
    if (partial.minor === null || partial.patch === null) {
      return [comparator('>=', lower(partial)), comparator('<', upper(partial))]
    }
    return [comparator('=', lower(partial))]
  }
  if (operator === '>=') return [comparator('>=', lower(partial))]
  if (operator === '>') {
    return [partial.patch === null
      ? comparator('>=', upper(partial))
      : comparator('>', lower(partial))]
  }
  if (operator === '<') return [comparator('<', lower(partial))]
  if (operator === '<=') {
    return [partial.patch === null
      ? comparator('<', upper(partial))
      : comparator('<=', lower(partial))]
  }
  throw invalid()
}

function parseHyphenSet(text: string): VpmComparator[] | null {
  const match = /^(\S+)\s+-\s+(\S+)$/.exec(text)
  if (!match) return null
  const from = parsePartial(match[1])
  const to = parsePartial(match[2])
  const out: VpmComparator[] = [comparator('>=', lower(from))]
  if (to.minor === null || to.patch === null || to.wildcard) {
    out.push(comparator('<', upper(to)))
  } else {
    out.push(comparator('<=', lower(to)))
  }
  return out
}

function parseSet(text: string): VpmComparatorSet {
  const trimmed = text.trim()
  if (!trimmed) throw invalid()
  // `>= 1.2.3` 与 `>=1.2.3` 等价；不把连字符范围里的 ` - ` 当运算符。
  const normalized = trimmed.replace(/(\^|~|>=|<=|>|<|=)\s+/g, '$1')
  const hyphen = parseHyphenSet(trimmed)
  if (hyphen) {
    if (hyphen.length > MAX_COMPARATORS) throw invalid()
    return { comparators: hyphen }
  }
  const comparators: VpmComparator[] = []
  for (const token of normalized.split(/\s+/)) {
    comparators.push(...parseToken(token))
    if (comparators.length > MAX_COMPARATORS) throw invalid()
  }
  return { comparators }
}

/**
 * 支持：精确、=、^、~、>= <= > <、x/* 通配、空格 AND、`||` OR、连字符。
 * 不支持 `~>`、`!=`、逗号分隔；非法输入抛 `vpmRangeInvalid`。
 */
export function parseVpmRange(input: unknown): VpmVersionRange {
  if (typeof input !== 'string') throw invalid()
  const raw = input.trim()
  if (!raw || raw.length > MAX_RANGE_LENGTH) throw invalid()
  const pieces = raw.split('||')
  if (pieces.length > MAX_SETS) throw invalid()
  const sets = pieces.map(parseSet)
  if (!sets.length) throw invalid()
  return { raw, sets }
}

export function tryParseVpmRange(input: unknown): VpmVersionRange | null {
  try {
    return parseVpmRange(input)
  } catch {
    return null
  }
}

function inSet(version: VpmVersion, set: VpmComparatorSet): boolean {
  return set.comparators.every(({ operator, version: boundary }) => {
    const compared = compareParsedVersions(version, boundary)
    if (operator === '=') return compared === 0
    if (operator === '>') return compared > 0
    if (operator === '>=') return compared >= 0
    if (operator === '<') return compared < 0
    return compared <= 0
  })
}

function prereleaseAllowed(version: VpmVersion, set: VpmComparatorSet): boolean {
  if (!version.prerelease.length) return true
  return set.comparators.some(({ version: boundary }) =>
    boundary.prerelease.length > 0 &&
    boundary.major === version.major &&
    boundary.minor === version.minor &&
    boundary.patch === version.patch
  )
}

export function satisfiesVpmRange(
  version: string | VpmVersion,
  range: string | VpmVersionRange,
  options: RangeSatisfyOptions = {}
): boolean {
  const parsedVersion = typeof version === 'string' ? parseVpmVersion(version) : version
  if (!parsedVersion) return false
  const parsedRange = typeof range === 'string' ? parseVpmRange(range) : range
  for (const set of parsedRange.sets) {
    if (!inSet(parsedVersion, set)) continue
    if (options.includePrerelease || prereleaseAllowed(parsedVersion, set)) return true
  }
  return false
}

/** 单版本精确范围（只有一个 `=` 比较器）时返回该版本，便于请求/锁定判断。 */
export function exactVpmRangeVersion(range: string | VpmVersionRange): VpmVersion | null {
  const parsed = typeof range === 'string' ? parseVpmRange(range) : range
  if (parsed.sets.length !== 1 || parsed.sets[0].comparators.length !== 1) return null
  const only = parsed.sets[0].comparators[0]
  return only.operator === '=' ? only.version : null
}
