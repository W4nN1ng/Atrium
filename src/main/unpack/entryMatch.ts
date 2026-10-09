import { normalizeEntryPath } from './encoding'

/**
 * 压缩包成员路径的匹配口径 —— **只此一份**，谁都不许再自己写一遍。
 *
 * 为什么要单独一个模块：`unzip.ts`（zip 的 only 过滤）和 `members.ts`（定点抽取）
 * 判的是同一件事"这条条目是不是用户要的那条"。两处各写一份就一定漂，
 * 而漂了的后果是**多解出用户没勾的文件**（项目里已经有一次"同一规则两份实现"
 * 漂开的历史：groupKey 没剥 UUID，那次是真库测出来才发现的）。
 * 所以这个文件被两边 import，而它自己不 import 任何解压后端，不会成环。
 *
 * ⚠ 这里是本次修的实际语义变化：
 * 旧写法 `name.startsWith(wanted)` 是**前缀匹配** ——
 * 勾 `A.pack` 会把 `A.package.unitypackage`、`A.pack/…` 全顺带解出来。
 * 真库里内层包大量是"一层同名目录 + 一个包"的形状，前缀匹配正好踩在最坏情况上：
 * 抽一个 653 MB 的包，可能顺手多抽出几十 MB 谁都没要的东西，
 * 而这些临时副本落在盘上（C 盘只剩十几 GB）。
 * 现在只有两种情况算命中：**整条相等**，或者它是**目录前缀**（`dir/` 底下的一切）。
 */
export function memberMatches(actual: string, wanted: string): boolean {
  const a = normalizeEntryPath(actual).toLowerCase()
  const b = normalizeEntryPath(wanted).toLowerCase()
  if (!b) return false
  return a === b || a.startsWith(b.endsWith('/') ? b : b + '/')
}

/** 这个成员是不是"目录条目本身"（列表里带着它只是为了显示层级） */
export function isDirEntry(relPath: string, isDir: boolean): boolean {
  return isDir || /\/$/.test(relPath)
}

/** 在给定清单里找出所有命中 wanteds 的条目（保留原始顺序） */
export function filterMembers<T extends { path: string; isDir?: boolean }>(
  entries: T[],
  wanteds: string[]
): T[] {
  return entries.filter((e) => !isDirEntry(e.path, !!e.isDir) && wanteds.some((w) => memberMatches(e.path, w)))
}
