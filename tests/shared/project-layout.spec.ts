import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  EMPTY_PROJECT_LAYOUT,
  applyProjectLayout,
  arrangeKeys,
  dropKey,
  normalizeProjectLayout,
  togglePinned,
  type ProjectLayout
} from '../../src/shared/projectLayout'

const KEYS = ['A', 'B', 'C', 'D']
const layout = (order: string[], pinned: string[] = []): ProjectLayout => ({ order, pinned })

describe('项目列表顺序与 📌（R4 用户反馈）', () => {
  it('没设置过时保持库里原顺序', () => {
    expect(arrangeKeys(KEYS, EMPTY_PROJECT_LAYOUT)).toEqual(KEYS)
  })

  it('拖过的顺序说了算，没拖过的按原顺序补在后面', () => {
    expect(arrangeKeys(KEYS, layout(['C', 'A']))).toEqual(['C', 'A', 'B', 'D'])
  })

  it('固定项永远排在最上面，即使 order 里它在后面', () => {
    const l = layout(['A', 'B', 'C', 'D'], ['D'])
    expect(arrangeKeys(KEYS, l)).toEqual(['D', 'A', 'B', 'C'])
  })

  it('新工程（layout 里没有）不会插到固定项前面', () => {
    const l = layout(['A', 'B'], ['B'])
    expect(arrangeKeys(['A', 'B', 'NEW'], l)).toEqual(['B', 'A', 'NEW'])
  })

  it('layout 里已删除的旧 key 被忽略，不会把列表弄丢', () => {
    const l = layout(['GONE', 'B', 'A'], ['GONE'])
    expect(arrangeKeys(KEYS, l)).toEqual(['B', 'A', 'C', 'D'])
  })

  it('脏数据（字符串/数字/空）当成没设置过', () => {
    expect(normalizeProjectLayout(null)).toEqual(EMPTY_PROJECT_LAYOUT)
    expect(normalizeProjectLayout({ order: 'x', pinned: 3 })).toEqual(EMPTY_PROJECT_LAYOUT)
    expect(normalizeProjectLayout({ order: ['A', 1, 'A'], pinned: ['A'] })).toEqual({ order: ['A'], pinned: ['A'] })
  })

  it('把 D 拖到最前面（没固定任何东西时就是纯换位）', () => {
    const next = dropKey(KEYS, EMPTY_PROJECT_LAYOUT, 'D', 'A', 'before')
    expect(arrangeKeys(KEYS, next)).toEqual(['D', 'A', 'B', 'C'])
  })

  it('放到某行下面', () => {
    const next = dropKey(KEYS, EMPTY_PROJECT_LAYOUT, 'A', 'B', 'after')
    expect(arrangeKeys(KEYS, next)).toEqual(['B', 'A', 'C', 'D'])
  })

  it('拖到原位不产生垃圾顺序', () => {
    const next = dropKey(KEYS, EMPTY_PROJECT_LAYOUT, 'B', 'B', 'before')
    expect(next).toEqual(EMPTY_PROJECT_LAYOUT)
  })

  it('未固定的东西拖不进固定区（落点被夹回未固定区顶部）', () => {
    const l = layout(['A', 'B', 'C', 'D'], ['A'])
    const next = dropKey(KEYS, l, 'D', 'A', 'before')
    expect(arrangeKeys(KEYS, next)).toEqual(['A', 'D', 'B', 'C'])
  })

  it('固定项也拖不出固定区（落点被夹在固定区内）', () => {
    const l = layout(['A', 'B', 'C', 'D'], ['A', 'B'])
    const next = dropKey(KEYS, l, 'A', 'D', 'after')
    expect(arrangeKeys(KEYS, next)).toEqual(['B', 'A', 'C', 'D'])
  })

  it('📌 钉住时进固定区末尾；一个都没钉时就是第一位', () => {
    const pinnedAll = togglePinned(KEYS, EMPTY_PROJECT_LAYOUT, 'C')
    expect(pinnedAll.pinned).toEqual(['C'])
    expect(arrangeKeys(KEYS, pinnedAll)).toEqual(['C', 'A', 'B', 'D'])

    const l = layout(['A', 'B', 'C', 'D'], ['A'])
    const next = togglePinned(KEYS, l, 'C')
    expect(arrangeKeys(KEYS, next)).toEqual(['A', 'C', 'B', 'D'])
  })

  it('取消固定后回到未固定区顶部，位置不会跑到最末', () => {
    const l = layout(['A', 'B', 'C', 'D'], ['A'])
    const next = togglePinned(KEYS, l, 'A')
    expect(next.pinned).toEqual([])
    expect(arrangeKeys(KEYS, next)).toEqual(['A', 'B', 'C', 'D'])
  })

  it('同一个 key 拖来拖去不会重复出现', () => {
    let l: ProjectLayout = EMPTY_PROJECT_LAYOUT
    l = dropKey(KEYS, l, 'D', 'A', 'before')
    l = dropKey(KEYS, l, 'D', 'B', 'after')
    l = dropKey(KEYS, l, 'D', 'C', 'before')
    const arranged = arrangeKeys(KEYS, l)
    expect(arranged.sort()).toEqual([...KEYS].sort())
    expect(new Set(arranged).size).toBe(4)
  })

  it('applyProjectLayout 按 key 排真实对象，不认识的 key 不丢对象', () => {
    const items = [{ key: 'B', n: 1 }, { key: 'A', n: 2 }]
    expect(applyProjectLayout(items, (item) => item.key, layout(['A'])).map((i) => i.key)).toEqual(['A', 'B'])
  })
})

describe('i18n：新增的三条项目列表文案三语齐全', () => {
  const ROOT = path.resolve(__dirname, '../..')
  const keys = ['dragHint', 'pin', 'unpin']
  for (const loc of ['zh-CN', 'en', 'ja'] as const) {
    it(`${loc} 有这 ${keys.length} 条`, () => {
      const json = JSON.parse(fs.readFileSync(path.join(ROOT, `src/renderer/i18n/${loc}.json`), 'utf8')) as {
        vpm: { projects: Record<string, unknown> }
      }
      for (const key of keys) {
        expect(typeof json.vpm.projects[key], `${loc}.vpm.projects.${key}`).toBe('string')
        expect((json.vpm.projects[key] as string).length, `${loc}.vpm.projects.${key} 不能为空`).toBeGreaterThan(0)
      }
    })
  }
})
