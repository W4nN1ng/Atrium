import { VpmError } from '../errors'

const MAX_VERSION_LENGTH = 200
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/

export interface VpmVersion {
  major: number
  minor: number
  patch: number
  /** 字符串保留原始数字标识；比较时数字段按数值长度/字典序处理，避免大整数精度问题。 */
  prerelease: string[]
  build: string[]
  raw: string
}

function numeric(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0
}

function validPrerelease(parts: string[]): boolean {
  return parts.every((part) => {
    if (!part || !/^[0-9A-Za-z-]+$/.test(part)) return false
    if (/^\d+$/.test(part) && part.length > 1 && part.startsWith('0')) return false
    return true
  })
}

/**
 * 严格 SemVer 2.0 解析。部分版本、`v` 前缀、前导零都不接受；
 * 排序用的旧 `compareVpmVersions` 另有宽容降级。
 */
export function parseVpmVersion(input: unknown): VpmVersion | null {
  if (typeof input !== 'string') return null
  const raw = input.trim()
  if (!raw || raw.length > MAX_VERSION_LENGTH) return null
  const match = SEMVER.exec(raw)
  if (!match) return null
  const major = Number(match[1])
  const minor = Number(match[2])
  const patch = Number(match[3])
  if (!numeric(major) || !numeric(minor) || !numeric(patch)) return null
  const prerelease = match[4] ? match[4].split('.') : []
  const build = match[5] ? match[5].split('.') : []
  if (prerelease.length && !validPrerelease(prerelease)) return null
  if (build.length && !build.every((part) => part && /^[0-9A-Za-z-]+$/.test(part))) return null
  return { major, minor, patch, prerelease, build, raw }
}

export function parseVpmVersionOrThrow(input: unknown): VpmVersion {
  const parsed = parseVpmVersion(input)
  if (!parsed) throw new VpmError('vpmVersionInvalid')
  return parsed
}

export function formatVpmVersion(version: VpmVersion): string {
  return `${version.major}.${version.minor}.${version.patch}` +
    (version.prerelease.length ? `-${version.prerelease.join('.')}` : '') +
    (version.build.length ? `+${version.build.join('.')}` : '')
}

function compareNumericIdentifier(a: string, b: string): number {
  if (a.length !== b.length) return a.length < b.length ? -1 : 1
  return a < b ? -1 : a > b ? 1 : 0
}

function comparePrerelease(a: string[], b: string[]): number {
  const length = Math.max(a.length, b.length)
  for (let index = 0; index < length; index++) {
    const left = a[index]
    const right = b[index]
    if (left === undefined) return -1
    if (right === undefined) return 1
    if (left === right) continue
    const leftNumeric = /^\d+$/.test(left)
    const rightNumeric = /^\d+$/.test(right)
    if (leftNumeric && rightNumeric) return compareNumericIdentifier(left, right)
    if (leftNumeric) return -1
    if (rightNumeric) return 1
    return left < right ? -1 : 1
  }
  return 0
}

/** 严格 SemVer 优先级；build 元数据不参与。 */
export function compareParsedVersions(a: VpmVersion, b: VpmVersion): number {
  if (a.major !== b.major) return a.major < b.major ? -1 : 1
  if (a.minor !== b.minor) return a.minor < b.minor ? -1 : 1
  if (a.patch !== b.patch) return a.patch < b.patch ? -1 : 1
  if (!a.prerelease.length && !b.prerelease.length) return 0
  if (!a.prerelease.length) return 1
  if (!b.prerelease.length) return -1
  return comparePrerelease(a.prerelease, b.prerelease)
}

interface LegacyParts {
  main: number[]
  pre: string[]
  hasPre: boolean
}

function legacyParse(value: string): LegacyParts {
  const normalized = String(value ?? '').trim().replace(/^v/i, '')
  const withoutBuild = normalized.split('+', 1)[0]
  const dash = withoutBuild.indexOf('-')
  const core = dash >= 0 ? withoutBuild.slice(0, dash) : withoutBuild
  const pre = dash >= 0 ? withoutBuild.slice(dash + 1) : ''
  const main = core.split('.').map((part) => {
    const match = /^\d+/.exec(part)
    return match ? Number(match[0]) : 0
  })
  return { main, pre: pre ? pre.split('.') : [], hasPre: pre.length > 0 }
}

function compareMain(a: number[], b: number[]): number {
  const length = Math.max(a.length, b.length)
  for (let index = 0; index < length; index++) {
    const left = a[index] ?? 0
    const right = b[index] ?? 0
    if (left !== right) return left < right ? -1 : 1
  }
  return 0
}

function legacyCompare(a: string, b: string): number {
  const left = legacyParse(a)
  const right = legacyParse(b)
  const main = compareMain(left.main, right.main)
  if (main !== 0) return main
  if (left.hasPre !== right.hasPre) return left.hasPre ? -1 : 1
  if (!left.hasPre) return 0
  return comparePrerelease(left.pre, right.pre)
}

/**
 * 目录/UI 排序用的兼容入口：合法 SemVer 走严格比较；历史坏值/部分版本
 * （如 `1.0`、`v1.2.3`）退回旧数字前缀比较，保证目录不会因一条坏版本报错。
 * 新解析器应使用 `parseVpmVersion`/`parseVpmVersionOrThrow`。
 */
export function compareVpmVersions(a: string, b: string): number {
  const left = parseVpmVersion(a)
  const right = parseVpmVersion(b)
  if (left && right) return compareParsedVersions(left, right)
  return legacyCompare(a, b)
}

export function isPrereleaseVersion(version: VpmVersion): boolean {
  return version.prerelease.length > 0
}

export function isStableVersion(version: VpmVersion): boolean {
  return version.prerelease.length === 0
}
