/**
 * 项目列表的顺序与固定（R4 之后的用户反馈）。
 *
 * 铁律两条：
 *  1. **固定的永远排在最上面**，未固定的按用户拖的顺序排在后面；
 *     新扫描出来的工程落在未固定区末尾，不会插到固定项前面。
 *  2. **拖拽只在同一组内生效**（固定 ↔ 固定、未固定 ↔ 未固定）。
 *     跨组要用户自己按 📌 —— 否则"拖到第二位"和"固定"会互相打架，
 *     用户拖完发现位置跳回去了。钉住/取消钉住由 `togglePinned` 负责，
 *     固定时进固定区末尾，取消时回未固定区顶部。
 *
 * 为什么是纯函数：拖拽顺序这种东西，靠手点很难验全（尤其"库里有已删除的旧 id"
 * 这种脏数据）。放在 shared 里能直接单测，渲染层只负责画。
 */

export interface ProjectLayout {
  /** 用户拖出来的顺序（含已不在列表里的旧 key，读取时过滤掉） */
  order: string[]
  /** 被 📌 钉住的 key 集合 */
  pinned: string[]
}

export const EMPTY_PROJECT_LAYOUT: ProjectLayout = { order: [], pinned: [] }

/**
 * 项目行内部拖拽的 `dataTransfer` 类型标记。
 *
 * 必须存在：窗口任意位置都挂着"拖文件进来即自动分类"的全屏接收层
 * （`components/DropOverlay.tsx`）。没有这个标记时，拖动项目行会**点亮那层遮罩**
 * （"松手即自动分类"），松手还会被当成一次空文件拖放 —— 用户看到的就是"拖不动、还串台了"。
 * 带上这个 MIME，全局那一层就能认出"这是应用内部的拖动，别接管"。
 */
export const PROJECT_DRAG_MIME = 'application/x-atrium-project'

/** 脏数据不崩：形状不对就当没设置过（旧版本、手改库都可能给别的形状） */
export function normalizeProjectLayout(raw: unknown): ProjectLayout {
  if (!raw || typeof raw !== 'object') return { ...EMPTY_PROJECT_LAYOUT }
  const obj = raw as { order?: unknown; pinned?: unknown }
  const order = Array.isArray(obj.order) ? obj.order.filter((k): k is string => typeof k === 'string') : []
  const pinned = Array.isArray(obj.pinned) ? obj.pinned.filter((k): k is string => typeof k === 'string') : []
  return { order: uniq(order), pinned: uniq(pinned) }
}

function uniq(list: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const item of list) {
    if (seen.has(item)) continue
    seen.add(item)
    out.push(item)
  }
  return out
}

/**
 * 按 layout 排出一屏实际顺序。
 * `keys` 是当前库里的工程（顺序即默认顺序）；layout 里不认识的 key 自动忽略，
 * layout 里没有的 key 按 `keys` 原顺序补在各自分区末尾。
 */
export function arrangeKeys(keys: string[], layout: ProjectLayout): string[] {
  const seen = new Set<string>()
  const known: string[] = []
  for (const key of keys) {
    if (seen.has(key)) continue
    seen.add(key)
    known.push(key)
  }
  const rank = new Map<string, number>()
  layout.order.forEach((key, index) => rank.set(key, index))
  const pinnedSet = new Set(layout.pinned)
  const rankOf = (key: string): number => rank.get(key) ?? Number.MAX_SAFE_INTEGER
  // Array.prototype.sort 现在是稳定的：rank 相同（都没排过）就保持 `known` 的原始顺序
  const pinned = known.filter((key) => pinnedSet.has(key)).sort((a, b) => rankOf(a) - rankOf(b))
  const rest = known.filter((key) => !pinnedSet.has(key)).sort((a, b) => rankOf(a) - rankOf(b))
  return [...pinned, ...rest]
}

/** 当前被钉住且真在列表里的数量 —— 拖拽夹取范围要用 */
export function pinnedCountOf(keys: string[], layout: ProjectLayout): number {
  const pinnedSet = new Set(layout.pinned)
  return new Set(keys.filter((key) => pinnedSet.has(key))).size
}

/**
 * 把 `drag` 拖到 `over` 的前/后。
 *
 * 越界的落点会被**夹回自己的分区**：拖的不是固定项，就不可能落进固定区。
 * 这样"拖到底还是被弹回去"不会发生 —— 落点本身就被夹住了，指示线画在哪就停在哪。
 */
export function dropKey(
  keys: string[],
  layout: ProjectLayout,
  drag: string,
  over: string,
  position: 'before' | 'after'
): ProjectLayout {
  const arranged = arrangeKeys(keys, layout)
  if (drag === over) return layout
  if (!arranged.includes(drag) || !arranged.includes(over)) return layout

  const pinnedSet = new Set(layout.pinned)
  const dragPinned = pinnedSet.has(drag)
  const pinnedCount = arranged.filter((key) => pinnedSet.has(key)).length
  const rest = arranged.filter((key) => key !== drag)
  let index = rest.indexOf(over)
  if (index < 0) return layout
  if (position === 'after') index += 1

  /**
   * 夹取范围：
   *  - 拖的是固定项：插入位 0…pinnedCount-1（`rest` 里已经有 pinnedCount-1 个固定项）
   *  - 拖的不是：插入位 pinnedCount…rest.length
   */
  const lower = dragPinned ? 0 : pinnedCount
  const upper = dragPinned ? Math.max(0, pinnedCount - 1) : rest.length
  index = Math.min(Math.max(index, lower), upper)
  rest.splice(index, 0, drag)
  return { order: rest, pinned: layout.pinned.slice() }
}

/**
 * 点一下 📌：
 *  - 未固定 → 进固定区**末尾**（固定区为空时就是第一位，也就是"钉到最上面"）
 *  - 已固定 → 回未固定区**顶部**（就在固定区下面，位置不会跑到很后面）
 */
export function togglePinned(keys: string[], layout: ProjectLayout, key: string): ProjectLayout {
  const arranged = arrangeKeys(keys, layout)
  if (!arranged.includes(key)) return layout
  const pinnedSet = new Set(layout.pinned)
  const rest = arranged.filter((item) => item !== key)

  if (pinnedSet.has(key)) {
    pinnedSet.delete(key)
    const nextPinnedCount = rest.filter((item) => pinnedSet.has(item)).length
    rest.splice(nextPinnedCount, 0, key)
  } else {
    pinnedSet.add(key)
    const nextPinnedCount = rest.filter((item) => pinnedSet.has(item)).length
    rest.splice(nextPinnedCount, 0, key)
  }
  // pinned 数组本身不参与排序（排序只看 order），但保持和 order 一致便于阅读/排查
  const pinned = rest.filter((item) => pinnedSet.has(item))
  return { order: rest, pinned }
}

/** 实际渲染用：把工程列表按 layout 排好 */
export function applyProjectLayout<T>(items: T[], keyOf: (item: T) => string, layout: ProjectLayout): T[] {
  const byKey = new Map<string, T>()
  for (const item of items) {
    const key = keyOf(item)
    if (!byKey.has(key)) byKey.set(key, item)
  }
  return arrangeKeys([...byKey.keys()], layout)
    .map((key) => byKey.get(key))
    .filter((item): item is T => item !== undefined)
}
