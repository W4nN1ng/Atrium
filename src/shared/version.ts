/**
 * 版本号比较（纯函数，主进程 / 渲染进程 / 数据库层都要用，所以放 shared）。
 *
 * 单独拎出来是因为踩过一次：按字符串比 'v1.9' > 'v1.10'，
 * 结果"最新在最前"的列表把旧版本摆在上面（改动单 §2.3 专门点了这条）。
 */

/** 'v1.10.0-beta' → [1,10,0]；非数字段丢掉 */
export function versionParts(v: string | null | undefined): number[] {
  if (!v) return []
  return v
    .split(/[.\-_]/)
    .map((x) => parseInt(x, 10))
    .filter((x) => Number.isFinite(x))
}

export function compareVersion(a: string | null | undefined, b: string | null | undefined): number {
  const pa = versionParts(a)
  const pb = versionParts(b)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d) return d
  }
  // 数字段完全一样时用原文兜底（'1.0' 与 '1.0a' 这种），保证排序稳定
  return String(a ?? '').localeCompare(String(b ?? ''))
}

/** 降序：新的在前 */
export function compareVersionDesc(a: string | null | undefined, b: string | null | undefined): number {
  const d = compareVersion(b, a)
  if (d) return d
  return String(a ?? '').localeCompare(String(b ?? ''))
}

/** 没有版本号的排最后（有 v1.10 和"未知版本"时，先展示有号的） */
export function sortVersionsDesc<T>(items: T[], versionOf: (t: T) => string | null): T[] {
  return [...items].sort((x, y) => {
    const a = versionOf(x)
    const b = versionOf(y)
    if (!a && b) return 1
    if (a && !b) return -1
    return compareVersionDesc(a, b)
  })
}
