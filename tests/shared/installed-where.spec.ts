import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { installedWhereState } from '../../src/shared/installedWhere'
import type { InstalledWhereRow } from '../../src/shared/types'

/**
 * R4 ⑥ · 「在哪些工程装过」的界面判据。
 *
 * 最要紧的是第一条：**空列表不许整块消失**。日志里没有记录有两种意思
 * （真没导过 / 是用户自己在 Unity 里手动导的），界面上必须区分得开，
 * 否则用户读到的是"A 说我没装过"，而 A 其实什么都不知道。
 */

const row = (over: Partial<InstalledWhereRow> = {}): InstalledWhereRow => ({
  projectId: 'P1',
  name: 'Alpha',
  at: 1700000000000,
  packages: 1,
  created: 3,
  overwritten: 0,
  rolledBack: 0,
  known: true,
  ...over
})

describe('installedWhereState', () => {
  const s = installedWhereState(
    [
      row(),
      /** 第二行故意做成"老数据"的样子：时间没写、GUID 数没写、但退回过一次 */
      row({ projectId: 'P2', name: 'Beta', at: 0, packages: 2, created: 0, rolledBack: 1 })
    ],
    'P2'
  )

  it('空列表照样画，并给出那句"日志里没有记录"', () => {
    const e = installedWhereState([], null)
    expect(e.show).toBe(true)
    expect(e.count).toBe(0)
    expect(e.emptyKey).toBe('installed.empty')
    /** 口径说明在空的时候**更**要在：这时候用户最容易把"没记录"读成"没装过" */
    expect(e.noteKeys.map((n) => n.key)).toContain('installed.noteLogOnly')
  })

  it('rows 缺失（详情还没加载完 / 老版本主进程没这个字段）→ 也不许抛，按空处理', () => {
    expect(installedWhereState(null, null).lines).toEqual([])
    expect(installedWhereState(undefined, 'P1').emptyKey).toBe('installed.empty')
  })

  it('当前目标工程要标出来（反查列表里"我现在这个工程在不在"是第一问）', () => {
    expect(s.lines.find((l) => l.projectId === 'P2')?.isCurrent).toBe(true)
    expect(s.lines.find((l) => l.projectId === 'P1')?.isCurrent).toBe(false)
    /** 没选目标时谁都不许被标成当前 */
    expect(installedWhereState([row()], null).lines[0].isCurrent).toBe(false)
  })

  it('时间 0 → hasTime=false（界面据此写"时间未知"，不许显示成 1970/1/1）', () => {
    expect(s.lines.find((l) => l.projectId === 'P2')?.hasTime).toBe(false)
    expect(s.lines.find((l) => l.projectId === 'P1')?.hasTime).toBe(true)
  })

  it('包数永远说；新建 0 就不说；覆盖 0 就不说；退回过的次数必须说', () => {
    const keys = s.lines.find((l) => l.projectId === 'P2')?.chips.map((c) => c.key) ?? []
    expect(keys).toEqual(['installed.packages', 'installed.rolledBack'])
    const full = installedWhereState([row({ created: 5, overwritten: 2, rolledBack: 3 })], null)
    expect(full.lines[0].chips.map((c) => c.key)).toEqual([
      'installed.packages',
      'installed.created',
      'installed.overwritten',
      'installed.rolledBack'
    ])
    expect(full.lines[0].chips[1].params).toEqual({ count: 5 })
  })

  it('count 数的是"真装过的"工程数：只被退回过的不算进标题，但行要留着', () => {
    const s2 = installedWhereState([row(), row({ projectId: 'P3', name: 'Gamma', packages: 0, created: 0, rolledBack: 4 })], null)
    expect(s2.count).toBe(1)
    expect(s2.lines).toHaveLength(2)
    /** 「0 个包」不写，那行直接读成「退回过 4 次」 */
    expect(s2.lines[1].chips.map((c) => c.key)).toEqual(['installed.rolledBack'])
    expect(s2.lines[0].chips.map((c) => c.key)).toContain('installed.packages')
  })

  it('工程已从清单里消失 → ghostKey 要有，界面上不许显示成一个空名字的行', () => {
    const g = installedWhereState([row({ known: false, name: '' })], null)
    expect(g.ghostKey).toBe('installed.ghost')
    expect(installedWhereState([row()], null).ghostKey).toBe(null)
  })

  it('count 数的是列出来的工程数（标题那句"在哪些工程装过（N）"用它）', () => {
    expect(s.count).toBe(2)
  })
})

describe('文案 key 三语齐全', () => {
  const ROOT = path.resolve(__dirname, '../..')
  const flat = (o: unknown, p = ''): string[] => {
    if (!o || typeof o !== 'object') return [p]
    return Object.entries(o as Record<string, unknown>).flatMap(([k, v]) => flat(v, p ? p + '.' + k : k))
  }
  const KEYS = [
    'installed.title',
    'installed.empty',
    'installed.current',
    'installed.timeUnknown',
    'installed.ghost',
    'installed.packages',
    'installed.created',
    'installed.overwritten',
    'installed.rolledBack',
    'installed.noteLogOnly'
  ]

  it('三语都有，且 `title` 带 count 占位符', () => {
    for (const loc of ['zh-CN', 'en', 'ja']) {
      const j = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/renderer/i18n', `${loc}.json`), 'utf8')) as Record<string, unknown>
      const set = new Set(flat(j))
      const missing = KEYS.filter((k) => !set.has(k))
      expect(missing, `${loc} 缺：${missing.join(', ')}`).toEqual([])
      expect((j.installed as { title: string }).title).toMatch(/\{\{count\}\}/)
    }
  })

  it('口径那句必须真的说了"手动 Import 查不到"这层限制（不许写成含糊的"仅供参考"）', () => {
    const zh = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/renderer/i18n/zh-CN.json'), 'utf8')) as {
      installed: { noteLogOnly: string }
    }
    expect(zh.installed.noteLogOnly).toMatch(/手动/)
    expect(zh.installed.noteLogOnly).toMatch(/查不到/)
  })

  it('判据这边**永远**要给出口径那一句（noteKeys 不许为空，两种入参都要给）', () => {
    /**
     * 这条是 `tools/verify-red-r4.cjs` 的 I2 逼出来的：原来只钉了"词典里有这句话"
     * 和"DetailPanel 渲染了 noteKeys"，而**判据这边把 noteKeys 清空**（比如哪天有人
     * 改成"只在有行时才说一句"）居然一条都不红 —— 那正是要防的那种半瞎状态：
     * 词典在、组件在，屏幕上却什么都没有。
     */
    expect(installedWhereState([], null).noteKeys.map((k) => k.key)).toContain('installed.noteLogOnly')
    expect(installedWhereState([row()], null).noteKeys.map((k) => k.key)).toContain('installed.noteLogOnly')
    /** rows 缺失（详情还没加载完）也要给 —— 界面那块本来就是空着等数据的 */
    expect(installedWhereState(undefined, null).noteKeys.length).toBeGreaterThan(0)
  })

  it('详情面板真的把口径渲染出来了（判据在纯函数里，但"界面上看得见"要有人钉）', () => {
    const src = fs.readFileSync(path.join(ROOT, 'src/renderer/components/DetailPanel.tsx'), 'utf8')
    expect(src).toMatch(/installedWhereState\(/)
    /** 不许只渲染行、不渲染 noteKeys —— 那正是"看起来像完整答案"的那个错法 */
    expect(src).toMatch(/where\.noteKeys/)
  })
})
