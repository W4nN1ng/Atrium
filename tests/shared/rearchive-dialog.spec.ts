import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { rearchiveDialogState, type RearchivePending } from '../../src/shared/rearchiveDialog'
import type { RearchiveOutcome, RearchivePlan } from '../../src/shared/types'

/**
 * R4 ③ · 改分类搬文件那张确认卡的判据。
 *
 * 这个仓库渲染层零 DOM 测试，所以"该不该给『搬过去』这个按钮"这类决定必须住在纯函数里，
 * 才有地方钉住。这里最要紧的是三条：
 *  1. 默认键盘落点永远是取消 —— 这是这一轮唯一动素材磁盘的操作，回车不能搬 25 GB；
 *  2. 预览失败时**连『只改记录』都不给**（当前路径都没确认，让用户点确认等于替他决定）；
 *  3. 这个函数能吐出去的每一个 i18n key，三语词典里必须都有 ——
 *     漏一条的表现是界面上直接显示 `rearchive.reason.indexed` 这种 key 名。
 */

const ROOT = path.resolve(__dirname, '../..')
const LOCALES = ['zh-CN', 'en', 'ja'] as const

function keysOf(loc: string): Set<string> {
  const raw = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/renderer/i18n', `${loc}.json`), 'utf8')) as Record<string, unknown>
  const out = new Set<string>()
  const walk = (o: unknown, p: string): void => {
    if (!o || typeof o !== 'object') return
    for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
      const key = p ? `${p}.${k}` : k
      if (v && typeof v === 'object') walk(v, key)
      else out.add(key)
    }
  }
  walk(raw, '')
  return out
}

const pending: RearchivePending = {
  assetId: 'A1',
  category: 'accessory',
  subcategory: 'headwear',
  fromLabel: '材质 / 材质球',
  toLabel: '配饰 / 头饰'
}

function plan(over: Partial<RearchivePlan> = {}): RearchivePlan {
  return {
    ok: true,
    assetId: 'A1',
    category: 'accessory',
    subcategory: 'headwear',
    fromDir: 'E:\\vrc\\A\\材质\\球\\东西',
    toDir: 'E:\\vrc\\A\\配饰\\头饰\\东西',
    moves: [{ from: 'E:\\vrc\\A\\材质\\球\\东西', to: 'E:\\vrc\\A\\配饰\\头饰\\东西', taken: false, isDirectory: true, bytes: 2048, fileCount: 3 }],
    rewrites: [],
    fileCount: 3,
    bytes: 2048,
    willMove: true,
    reasonKey: null,
    reasonParams: null,
    batchId: 'B1',
    ...over
  }
}

describe('该给哪几个按钮', () => {
  it('没计划 / 没待定项 → 什么都不显示', () => {
    expect(rearchiveDialogState(null, null).show).toBe(false)
    expect(rearchiveDialogState(pending, null).show).toBe(false)
  })

  it('预览失败 → 连「只改记录」都不给', () => {
    const f: RearchiveOutcome = { ok: false, reasonKey: 'err.assetGone' }
    const s = rearchiveDialogState(pending, f)
    expect(s.show).toBe(true)
    expect(s.canMove).toBe(false)
    expect(s.canRecordOnly, '路径都没确认，不能在信息不全时让用户点确认').toBe(false)
    expect(s.notes.map((n) => n.key)).toEqual(['err.assetGone'])
  })

  it('说不该搬 → 只给「只改记录」，并把原因摆在第一行', () => {
    const s = rearchiveDialogState(pending, plan({ willMove: false, reasonKey: 'rearchive.reason.indexed', toDir: null, moves: [] }))
    expect(s.canMove).toBe(false)
    expect(s.canRecordOnly).toBe(true)
    expect(s.willMove).toBe(false)
    expect(s.notes).toEqual([{ key: 'rearchive.reason.indexed' }])
  })

  it('说该搬 → 「搬过去」和「只改记录」都给（用户能不能拒绝搬，是这一张卡存在的意义）', () => {
    const s = rearchiveDialogState(pending, plan())
    expect(s.canMove).toBe(true)
    expect(s.canRecordOnly).toBe(true)
    expect(s.willMove).toBe(true)
    expect(s.fromDir).toContain('材质')
    expect(s.toDir).toContain('配饰')
    expect(s.fileCount).toBe(3)
    expect(s.bytes).toBe(2048)
  })

  it('键盘默认项恒为取消：回车 / ESC 不许触发搬文件', () => {
    expect(rearchiveDialogState(pending, plan()).defaultKey).toBe('cancel')
    expect(rearchiveDialogState(pending, plan({ moves: [{ ...plan().moves[0], taken: true }] })).defaultKey).toBe('cancel')
    expect(rearchiveDialogState(pending, { ok: false, reasonKey: 'err.badArgs' }).defaultKey).toBe('cancel')
  })
})

describe('要替用户提前说清的三件事', () => {
  it('目标位置撞名 → 明说会改名，并把最终目录写出来', () => {
    const s = rearchiveDialogState(pending, plan({ toDir: 'E:\\vrc\\A\\配饰\\头饰\\东西 (2)', moves: [{ ...plan().moves[0], taken: true, to: 'E:\\vrc\\A\\配饰\\头饰\\东西 (2)' }] }))
    const taken = s.notes.find((n) => n.key === 'rearchive.note.taken')
    expect(taken?.params).toEqual({ toDir: 'E:\\vrc\\A\\配饰\\头饰\\东西 (2)' })
  })

  it('父目录之外还有子项要单独搬 → 报的是"另有几条"，不是总条数', () => {
    const extra = plan().moves[0]
    const s = rearchiveDialogState(pending, plan({ moves: [extra, extra, extra] }))
    expect(s.moveCount).toBe(3)
    expect(s.notes.find((n) => n.key === 'rearchive.note.extraMoves')?.params).toEqual({ count: 2 })
  })

  it('附属跟着改路径 → 按**记录条数**报，同一行改三个字段只算一条', () => {
    const s = rearchiveDialogState(
      pending,
      plan({
        rewrites: [
          { assetId: 'A1', field: 'library_path', from: 'x', to: 'y' },
          { assetId: 'K1', field: 'library_path', from: 'x', to: 'y' },
          { assetId: 'K1', field: 'cover_image', from: 'x', to: 'y' },
          { assetId: 'K2', field: 'source_path', from: 'x', to: 'y' }
        ]
      })
    )
    expect(s.rewriteCount).toBe(2)
    expect(s.notes.find((n) => n.key === 'rearchive.note.rewrites')?.params).toEqual({ count: 2 })
  })

  it('reasonParams 里的非字符串值会转成能进 t() 的类型（界面上不许出现 [object Object]）', () => {
    const s = rearchiveDialogState(
      pending,
      plan({ willMove: false, reasonKey: 'rearchive.reason.missing', reasonParams: { path: 'E:\\没了', count: 2, who: { a: 1 } } as Record<string, unknown>, toDir: null, moves: [] })
    )
    expect(s.reasonParams).toEqual({ path: 'E:\\没了', count: 2, who: '[object Object]' })
    expect(s.notes[0].params).toEqual(s.reasonParams)
  })
})

describe('i18n 兜底', () => {
  const EMITTED = [
    'rearchive.reason.noRoot',
    'rearchive.reason.indexed',
    'rearchive.reason.missing',
    'rearchive.reason.outside',
    'rearchive.reason.samePlace',
    'rearchive.note.taken',
    'rearchive.note.extraMoves',
    'rearchive.note.rewrites',
    'rearchive.title',
    'rearchive.now',
    'rearchive.target',
    'rearchive.size',
    'rearchive.undoHint',
    'rearchive.recordOnlyHint',
    'rearchive.movedDone',
    'rearchive.savedOnly',
    'rearchive.leftAlone',
    'rearchive.planning',
    'rearchive.moveIt',
    'rearchive.moving',
    'rearchive.recordOnly',
    'rearchive.unknownPath',
    'toast.undoRearchived',
    'err.rearchiveStale',
    'err.assetGone',
    'err.badArgs',
    'err.badCategory',
    'err.badSubcategory'
  ]

  it('这张卡能吐出来的每一个 key，三语词典里都有', () => {
    for (const loc of LOCALES) {
      const set = keysOf(loc)
      const missing = EMITTED.filter((k) => !set.has(k))
      expect(missing, `${loc} 缺：${missing.join(', ')}`).toEqual([])
    }
  })

  it('主进程 reasonKey 的取值范围没有超出上面那份清单', () => {
    /**
     * 源码扫描：`planRearchive` 里每写一个 `reasonKey: '…'`，界面就得能翻译它。
     * 光靠上面那份手写清单，加原因的人不会想起来回这里补 —— 这条把它绑住。
     */
    const src = fs.readFileSync(path.join(ROOT, 'src/main/library/rearchive.ts'), 'utf8')
    const found = [...src.matchAll(/reasonKey:\s*'(rearchive\.reason\.[A-Za-z0-9_.]+)'/g)].map((m) => m[1])
    expect(found.length, '一条原因都没扫到，说明扫描规则失效了').toBeGreaterThanOrEqual(5)
    for (const k of new Set(found)) {
      expect(EMITTED, `清单里没有这条原因：${k}（界面上会直接显示 key 名）`).toContain(k)
    }
  })

  it('组件里没有自己拼的判断（判据只有 rearchiveDialogState 一处）', () => {
    const src = fs.readFileSync(path.join(ROOT, 'src/renderer/components/RearchiveDialog.tsx'), 'utf8')
    expect(src).toMatch(/rearchiveDialogState\(/)
    /** 组件里不许出现 `plan.willMove` 这类二次判断：判据有两份实现迟早和主进程说不一样 */
    expect(src).not.toMatch(/\.willMove\s*[=!]=/)
    expect(src).not.toMatch(/plan\.ok/)
  })
})
