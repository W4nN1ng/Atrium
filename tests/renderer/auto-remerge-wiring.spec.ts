import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 第 9 轮 ⑥ · 「自动并完 + 事后告知」的**接线**。
 *
 * 判据在 `tests/shared/auto-remerge.spec.ts`，撤销靶子在 `tests/library/remerge.spec.ts`。
 * 这里只管一件事：**那条路有没有真的通**。本轮的教训本身就是这个 ——
 * ② 那次后端全通、界面上却要用户走四步，等于没做。
 */
const ROOT = path.resolve(__dirname, '../..')

function read(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8')
}

/** 断言 API 存在/顺序之前先剥注释（注释里也写着函数名和 key） */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split(/\r?\n/)
    .filter((l) => !/^\s*\/\//.test(l))
    .join('\n')
}

const store = stripComments(read('src/renderer/stores/ui.ts'))
const notice = stripComments(read('src/renderer/components/RemergeNotice.tsx'))
const app = stripComments(read('src/renderer/App.tsx'))
const undo = stripComments(read('src/main/library/undo.ts'))
const assets = stripComments(read('src/main/ipc/assets.ts'))
const preload = stripComments(read('src/preload/index.ts'))
const api = stripComments(read('src/shared/api.ts'))
const shared = stripComments(read('src/shared/autoRemerge.ts'))

describe('启动时自动跑那一次', () => {
  it('⭐ boot 末尾挂了它，而且不 await（不能让每个人开机都慢一下）', () => {
    expect(store).toContain('void get().maybeAutoRemerge()')
    expect(store).not.toMatch(/await\s+(s\.|get\(\)\.)maybeAutoRemerge/)
    const at = store.indexOf('void get().maybeAutoRemerge()')
    expect(at, '没挂在 boot 里 —— 挂在别处就等于没人开机走到').toBeGreaterThan(store.indexOf('async boot()'))
  })

  it('判据走 shared，store 里不自己写条件、也不填假值过闸', () => {
    expect(store).toContain('shouldProbeAutoRemerge({')
    expect(store).toContain('shouldApplyAutoRemerge(plan.clusters.length)')
    /**
     * 第一版为了过闸传了 `clusters: 1` 这种假值，那个参数就成摆设还骗人。
     * 判据拆成两步之后不允许再出现这种写法。
     */
    expect(store).not.toMatch(/clusters:\s*1\s*[,}]/)
  })

  it('⭐ 查成功就落时间戳，两条路都要落（否则每次开机全库跑一遍）', () => {
    const stamps = store.match(/autoRemergeRunAt: new Date\(\)\.toISOString\(\)/g) ?? []
    expect(stamps.length, '空库路径或合并路径上少了一次落时间戳').toBe(2)
  })

  it('⭐ 失败路径不落时间戳（一个偶发错误不该把这件事永久跳过）', () => {
    const at = store.indexOf('async maybeAutoRemerge()')
    const body = store.slice(at, store.indexOf('dismissRemergeNotice()', at))
    const catchAt = body.indexOf('catch {')
    expect(catchAt, 'maybeAutoRemerge 里没有静默的 catch').toBeGreaterThan(0)
    /** catch 之后到函数结尾，不该出现落时间戳那一句 */
    expect(body.slice(catchAt)).not.toContain('autoRemergeRunAt')
  })

  it('设置项有默认值也有类型（读了不认识的字段 = 每次都当没跑过）', () => {
    expect(read('src/shared/settingsDefaults.ts')).toContain('autoRemergeRunAt: null')
    expect(read('src/shared/types.ts')).toMatch(/autoRemergeRunAt:\s*string\s*\|\s*null/)
  })

  it('⭐ 那道刹车按库判（第 10 轮 #112：换了素材库根要能重新收拾一次）', () => {
    /** 判据本身在 shared 有用例，这里只钉"store 有没有用它" */
    expect(store).toContain('remergeAlreadyRun({ runAt: st.autoRemergeRunAt, runRoot: st.autoRemergeRunRoot }, st.libraryRoot)')
    /** 不许退回"只看时间戳"那个写法 —— 退回去就等于一脚刹车管所有库 */
    expect(store).not.toMatch(/alreadyRun:\s*!!st\.autoRemergeRunAt/)
  })

  it('⭐ 落时间戳的两条路都连带落库根（少一处 = 新库那次跑完还是"无名"，下次换库松不开）', () => {
    expect((store.match(/autoRemergeRunRoot: st\.libraryRoot/g) ?? []).length, '两处 patchSettings 都要带上库根').toBe(2)
    expect(read('src/shared/settingsDefaults.ts')).toContain('autoRemergeRunRoot: null')
    expect(read('src/shared/types.ts')).toMatch(/autoRemergeRunRoot:\s*string\s*\|\s*null/)
  })
})

describe('告知条本身', () => {
  it('⭐ 挂在 App 这一层，活得过切页', () => {
    expect(app).toContain("import { RemergeNotice } from './components/RemergeNotice'")
    expect(app).toContain('<RemergeNotice />')
  })

  it('告知内容带着那一批的 id（撤销的靶子）', () => {
    expect(store).toMatch(/remergeNotice:\s*\{[^}]*batchId:\s*r\.batchId/)
    expect(store).toMatch(/remergeNotice:\s*\{[^}]*moved:\s*r\.moved/)
    /** ⭐ 不许再写 batchId: '' —— 空靶子等于撤销没有靶子 */
    expect(store).not.toContain("batchId: ''")
  })

  it('组件里没有判断，只有映射：该说什么、列哪几行都问 shared', () => {
    expect(notice).toContain('noticeText(notice.clusters, notice.moved)')
    expect(notice).toContain('noticeLines(notice.items)')
    /** 自己排序/截断/比大小就是把判据搬回组件，那份 shared 的用例立刻管不到 */
    expect(notice).not.toMatch(/\bslice\s*\(/)
    expect(notice).not.toMatch(/Math\.max/)
    expect(notice).not.toMatch(/clusters\s*>\s*0/)
  })

  it('⭐ 不挡路：不定位悬浮、不抢焦点、展开时不自己收起', () => {
    expect(notice).not.toMatch(/className="[^"]*(fixed|absolute|z-\d)/)
    expect(notice).not.toContain('autoFocus')
    /** 用户正在读的时候不该被计时器收走 */
    expect(notice).toMatch(/if\s*\(!hasHead\s*\|\|\s*open\s*\|\|\s*hidden\)\s*return/)
  })

  it('撤销按钮打的是 undoRemerge（带靶子那条），不是键盘那个裸撤', () => {
    expect(notice).toContain('undo()')
    /** 组件拿的是 store 上那两个动作：名字一改，运行时就是 undefined，界面点了没反应 */
    expect(notice).toContain('useUi((s) => s.undoRemerge)')
    expect(notice).toContain('useUi((s) => s.dismissRemergeNotice)')
    expect(notice).toContain('onClick={dismiss}')
    expect(store).toContain('window.a.journal.undoLast(n.batchId)')
    /** 键盘 Ctrl+Z 的语义一点没变：还是不带参数 */
    expect(store).toContain('const r = await window.a.journal.undoLast()')
  })

  it('撤销失败就不关条子（撤没撤成是用户接下来要不要去查账的依据）', () => {
    const at = store.indexOf('async undoRemerge()')
    const body = store.slice(at, at + 1400)
    const okAt = body.indexOf('remergeNotice: null')
    const guardAt = body.indexOf('if (r.ok && r.undone > 0)')
    expect(guardAt, '没在成功分支里判断').toBeGreaterThan(-1)
    expect(okAt, '撤销没成功也把条子关了').toBeGreaterThan(guardAt)
  })
})

describe('撤销的靶子：从界面一路通到主进程', () => {
  it('⭐ 主进程那道闸：不是这一批就一行不动，而且排在真的动手之前', () => {
    expect(undo).toContain('deps.onlyBatchId && head.batch_id !== deps.onlyBatchId')
    const gate = undo.indexOf('deps.onlyBatchId && head.batch_id !== deps.onlyBatchId')
    const works = undo.indexOf('const rows = batchId')
    expect(gate, '闸不在 undoLast 里').toBeGreaterThan(-1)
    expect(works).toBeGreaterThan(gate)
    expect(undo.slice(gate, gate + 400)).toContain('undone: 0')
    expect(undo.slice(gate, gate + 400)).toContain("'toast.undoStale'")
  })

  it('通道两端都传这个 id（preload / api / handler 少一段就是渲染层调不到）', () => {
    expect(preload).toContain("invoke('journal:undo-last', batchId ?? null)")
    expect(api).toContain('undoLast(onlyBatchId?: string | null)')
    expect(assets).toContain('onlyBatchId: typeof batchId ===')
    /** 不带参数时必须还是 null：`??` 的坑（undefined 与 null 不同）在 journal 那边踩过 */
    expect(assets).not.toContain('onlyBatchId: batchId')
  })

  it('apply-remerge 把 batchId 报回来（两处 return 都要有，空结果也不能少字段）', () => {
    const at = assets.indexOf("ipc.handle('health:apply-remerge'")
    /** 取到下一个 handler 之前：中途的 `})` 多得很，按括号切一定会截断 */
    const body = assets.slice(at, assets.indexOf('ipc.handle(', at + 10))
    expect(body).toContain('batchId: r.batchId')
    expect(body).toContain("batchId: ''")
    expect(api).toMatch(/applyRemerge\(keys: string\[\]\)[^\n]*batchId: string/)
  })
})

describe('三语文案真的存在（漏一条界面就显示 key 名）', () => {
  /** shared 能发出的 key + 组件里写出来的 key，两边一起收 */
  const keys: string[] = []
  const collect = (src: string): void => {
    for (const m of src.matchAll(/'((?:remerge|toast)\.[A-Za-z0-9_.]+)'/g)) {
      if (!keys.includes(m[1])) keys.push(m[1])
    }
  }
  collect(shared)
  collect(notice)
  collect(store)

  it('扫得到 key（扫不到就是这条用例自己坏了）', () => {
    expect(keys.length, '一个 key 都没扫到').toBeGreaterThanOrEqual(6)
  })

  for (const loc of ['zh-CN', 'en', 'ja']) {
    it(`${loc} 三份里都有`, () => {
      const flat = new Set<string>()
      const data = JSON.parse(read(`src/renderer/i18n/${loc}.json`)) as Record<string, unknown>
      const walk = (o: Record<string, unknown>, p: string): void => {
        for (const [k, v] of Object.entries(o)) {
          const key = p ? `${p}.${k}` : k
          if (v && typeof v === 'object') walk(v as Record<string, unknown>, key)
          else flat.add(key)
        }
      }
      walk(data, '')
      const missing = keys.filter((k) => !flat.has(k))
      expect(missing, `${loc} 缺：${missing.join(', ')}`).toEqual([])
    })
  }
})
