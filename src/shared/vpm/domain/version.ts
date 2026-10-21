/**
 * 目录排序用的最小 SemVer 比较器。
 *
 * P1-D 只需要“哪个版本更新”；P3-A 会在此基础上补严格解析/范围。
 * 这里不抛错：非法段按 0/普通字符串处理，保证目录排序不会因为一个坏版本炸掉。
 */
interface VersionParts {
  main: number[]
  pre: string[]
  hasPre: boolean
}

function parse(value: string): VersionParts {
  const normalized = String(value ?? '').trim().replace(/^v/i, '')
  const withoutBuild = normalized.split('+', 1)[0]
  const dash = withoutBuild.indexOf('-')
  const core = dash >= 0 ? withoutBuild.slice(0, dash) : withoutBuild
  const pre = dash >= 0 ? withoutBuild.slice(dash + 1) : ''
  const main = core.split('.').map((part) => {
    const match = /^\d+/.exec(part)
    return match ? Number(match[0]) : 0
  })
  return {
    main,
    pre: pre ? pre.split('.') : [],
    hasPre: pre.length > 0
  }
}

function compareMain(a: number[], b: number[]): number {
  const len = Math.max(a.length, b.length)
  for (let i = 0; i < len; i++) {
    const left = a[i] ?? 0
    const right = b[i] ?? 0
    if (left !== right) return left < right ? -1 : 1
  }
  return 0
}

function isNumeric(value: string): boolean {
  return /^\d+$/.test(value)
}

function comparePre(a: string[], b: string[]): number {
  const len = Math.max(a.length, b.length)
  for (let i = 0; i < len; i++) {
    const left = a[i]
    const right = b[i]
    if (left === undefined) return -1
    if (right === undefined) return 1
    if (left === right) continue
    const leftNumeric = isNumeric(left)
    const rightNumeric = isNumeric(right)
    if (leftNumeric && rightNumeric) return Number(left) < Number(right) ? -1 : 1
    if (leftNumeric) return -1
    if (rightNumeric) return 1
    return left < right ? -1 : 1
  }
  return 0
}

/** a<b → 负数；a>b → 正数；相等 → 0。build 元数据不参与比较。 */
export function compareVpmVersions(a: string, b: string): number {
  const left = parse(a)
  const right = parse(b)
  const main = compareMain(left.main, right.main)
  if (main !== 0) return main
  if (left.hasPre !== right.hasPre) return left.hasPre ? -1 : 1
  if (!left.hasPre) return 0
  return comparePre(left.pre, right.pre)
}
