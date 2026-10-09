import { describe, it, expect, beforeEach, vi } from 'vitest'

/**
 * M6 ⑤ · 自动切换在 store 层的行为（假 `window.a`，不需要 DOM）。
 *
 * 这一份只盯三件事，全是"画面对不上但数据层没错"那一类：
 *  1. **切视图不许清空搜索框**（R-46/R-52，§9-14 点名的就是它）；
 *  2. 用户正忙时**不切**，但要把"没切"这件事留在横幅上（R-51，偏离规格原文的判据）；
 *  3. 「以后都这样」写的是 `rule_json.projectPaths`，而"换个集合"**不擅自改规则**。
 */

type AnyFn = (...args: any[]) => any

let updateCalls: any[][]
let settingsSet: any[][]
let collectionsNow: any[]

beforeEach(async () => {
  updateCalls = []
  settingsSet = []
  collectionsNow = [
    { id: 'C1', name: 'Shinano', icon: null, sort_order: 10, rule_json: '{"keywords":["shinano"]}', is_auto: 1, priority: 10 },
    { id: 'C2', name: 'Milfy', icon: null, sort_order: 20, rule_json: null, is_auto: 0, priority: 0 }
  ]
  const stub: Record<string, any> = {
    assets: {
      list: async () => ({ cards: [], total: 0 }),
      stats: async () => ({ assets: 0, groups: 0, bytes: 0, missingBytes: 0, duplicateBytes: 0, review: 0, bundles: 0, bundleItems: 0, inbox: 0, collections: 0, tags: 0, pendingConfirm: 0 }),
      on: () => undefined
    },
    collections: {
      list: async () => collectionsNow,
      update: (vi.fn(async (...a: any[]) => {
        updateCalls.push(a)
        return collectionsNow.find((c) => c.id === a[0]) ?? null
      }) as AnyFn),
      create: async () => collectionsNow[0],
      remove: async () => undefined,
      addAssets: async () => 0,
      removeAsset: async () => undefined,
      planBackfill: async () => ({ candidates: [], skipped: [], covered: 0, existing: [] }),
      applyBackfill: async () => ({ created: [], ignored: [], journalId: -1 })
    },
    categories: { list: async () => null },
    settings: {
      getAll: async () => ({}),
      set: (vi.fn(async (...a: any[]) => {
        settingsSet.push(a)
        return ({})
      }) as AnyFn),
      setMany: async () => ({}),
      reset: async () => ({})
    },
    system: { info: async () => ({}), paths: async () => ({}) },
    ingest: { queue: async () => [], restoreQueue: async () => [] },
    unity: {
      status: async () => ({}),
      instances: async () => [],
      listProjects: async () => [],
      refreshProjects: async () => [],
      importLogs: async () => [],
      preflight: async () => ({}),
      packagesOfAsset: async () => ({ kind: 'empty', packages: [], notes: null, reasonKey: null }),
      importPlan: async () => ({ ok: false, reasonKey: 'err.batchEmpty' }),
      importAbandon: async () => ({ released: 0, failed: 0, notStaged: true })
    },
    health: { scan: async () => ({}) },
    journal: { list: async () => [], undoLast: async () => ({ ok: true }) },
    on: () => undefined,
    off: () => undefined
  }
  ;(globalThis as any).window = (globalThis as any).window ?? {}
  ;(globalThis as any).window.a = stub
  vi.resetModules()
})

async function store() {
  const mod = await import('../../src/renderer/stores/ui')
  return mod.useUi
}

const event = (over: Record<string, unknown> = {}) => ({
  projectId: 'P1',
  projectPath: 'E:\\ALCOMprojects\\shinano-Main2',
  projectName: 'shinano-Main2',
  action: 'switch',
  reason: 'switched',
  collectionId: 'C1',
  collectionName: 'Shinano',
  candidates: [],
  at: 1000,
  ...over
})

describe('切视图', () => {
  it('命中集合 → nav 切到那个集合，横幅挂上事件', async () => {
    const useUi = await store()
    useUi.setState({ nav: 'all' })
    useUi.getState().handleAutoSwitch(event() as any)
    expect(useUi.getState().nav).toBe('col:C1')
    expect(useUi.getState().banner.event?.collectionName).toBe('Shinano')
  })

  it('R-52：搜索框里的字一个字都不许被清掉', async () => {
    const useUi = await store()
    useUi.setState({ search: 'liltoon' })
    useUi.getState().handleAutoSwitch(event() as any)
    expect(useUi.getState().search).toBe('liltoon')
    expect(useUi.getState().nav).toBe('col:C1')
  })

  it('用户正忙（成员面板开着）→ 不切视图，但横幅要说"该切、没打断"', async () => {
    const useUi = await store()
    useUi.setState((s: any) => ({ nav: 'all', memberPicker: { ...s.memberPicker, open: true } }))
    useUi.getState().handleAutoSwitch(event() as any)
    expect(useUi.getState().nav).toBe('all')
    expect(useUi.getState().banner.event?.reason).toBe('busy')
    expect(useUi.getState().banner.event?.action).toBe('skip')
  })

  it('正在拖文件进来 → 同样不打断', async () => {
    const useUi = await store()
    useUi.setState({ nav: 'all', dropActive: true })
    useUi.getState().handleAutoSwitch(event() as any)
    expect(useUi.getState().nav).toBe('all')
    expect(useUi.getState().banner.event?.reason).toBe('busy')
  })

  it('导入正在跑 → 不打断（这时候换列表会把"正在导哪个包"都看不清）', async () => {
    const useUi = await store()
    useUi.setState((s: any) => ({ nav: 'all', importFlow: { ...s.importFlow, busy: true } }))
    useUi.getState().handleAutoSwitch(event() as any)
    expect(useUi.getState().nav).toBe('all')
  })
})

describe('横幅的三个按钮', () => {
  it('「这次忽略」之后，同一工程的事件不再进横幅', async () => {
    const useUi = await store()
    useUi.getState().handleAutoSwitch(event() as any)
    useUi.getState().dismissBanner()
    expect(useUi.getState().banner.event).toBe(null)
    expect(useUi.getState().banner.ignoredProjects).toEqual(['P1'])
  })

  it('「固定」之后不再自动淡出（判据在 bannerState，这里只管状态）', async () => {
    const useUi = await store()
    useUi.getState().handleAutoSwitch(event() as any)
    useUi.getState().pinBanner()
    expect(useUi.getState().banner.pinned).toBe(true)
  })

  it('「换个集合」只切视图，**不改规则**（规格：选择后要先问，不能顺手写）', async () => {
    const useUi = await store()
    useUi.getState().handleAutoSwitch(event() as any)
    await useUi.getState().bannerChoose('C2')
    expect(useUi.getState().nav).toBe('col:C2')
    expect(updateCalls).toHaveLength(0)
  })

  it('「以后都这样」把工程路径写进 rule_json.projectPaths，原有 keywords 保留', async () => {
    const useUi = await store()
    useUi.getState().handleAutoSwitch(event() as any)
    await useUi.getState().bannerRemember()
    expect(updateCalls).toHaveLength(1)
    const [id, patch] = updateCalls[0]
    expect(id).toBe('C1')
    const rule = JSON.parse((patch as any).rule_json)
    expect(rule.keywords).toEqual(['shinano'])
    expect(rule.projectPaths).toEqual(['E:\\ALCOMprojects\\shinano-Main2'])
  })

  it('同一个工程记第二次不重复追加（点两下不该往规则里塞两条一样的）', async () => {
    const useUi = await store()
    useUi.getState().handleAutoSwitch(event() as any)
    await useUi.getState().bannerRemember()
    collectionsNow = [{ ...collectionsNow[0], rule_json: updateCalls[0][1].rule_json }]
    updateCalls.length = 0
    useUi.setState((s: any) => ({ collections: collectionsNow }))
    useUi.getState().handleAutoSwitch(event() as any)
    await useUi.getState().bannerRemember()
    const rule = JSON.parse(updateCalls[0][1].rule_json)
    expect(rule.projectPaths).toEqual(['E:\\ALCOMprojects\\shinano-Main2'])
  })
})

describe('Q3：那条"开机常驻托盘"的一次性提示', () => {
  it('发生过一次决策 → sawUnityStart 立起来（提示的前提）', async () => {
    const useUi = await store()
    expect(useUi.getState().banner.sawUnityStart).toBe(false)
    useUi.getState().handleAutoSwitch(event() as any)
    expect(useUi.getState().banner.sawUnityStart).toBe(true)
  })

  it('点"好" → 才写 autoLaunch=true，并记下"问过了"', async () => {
    const useUi = await store()
    await useUi.getState().answerAutoLaunch(true)
    expect(settingsSet.map((c) => c[0])).toEqual(['autoLaunch', 'autoLaunchAsked'])
    expect(settingsSet[0][1]).toBe(true)
    expect(settingsSet[1][1]).toBe(true)
  })

  it('点"不用了" → **一个字都不写 autoLaunch**，只记"问过了"', async () => {
    const useUi = await store()
    await useUi.getState().answerAutoLaunch(false)
    expect(settingsSet.map((c) => c[0])).toEqual(['autoLaunchAsked'])
  })
})

describe('接线', () => {
  it('bindEvents 订阅了 unity:auto-switch（不订阅的话这套逻辑永远跑不到界面）', async () => {
    /**
     * 读源码钉接线，不做"有条件地断言"—— 那种写法在订阅存在时什么都不测、
     * 不存在时又刚好测到，绿灯的含义会随代码变化，等于没测。
     */
    const fs = await import('node:fs')
    const src = fs.readFileSync('src/renderer/stores/ui.ts', 'utf8')
    expect(src).toContain("window.a.on('unity:auto-switch'")
    expect(src).toContain('get().handleAutoSwitch(e)')
  })

  it('App 把横幅挂上了顶层（挂在页面组件里的话，用户切页时事件就丢了）', async () => {
    const fs = await import('node:fs')
    const app = fs.readFileSync('src/renderer/App.tsx', 'utf8')
    expect(app).toContain('<ProjectBanner />')
  })

  it('主进程只在"要切/要弹"时才去碰窗口焦点，而且 wake 是注入的（不能静态 import window.ts）', async () => {
    const fs = await import('node:fs')
    const src = fs.readFileSync('src/main/project/api.ts', 'utf8')
    expect(src).toMatch(/if \(event\.action === 'switch' \|\| event\.action === 'wake-only'\) void opts\.wake\?\.\(\)/)
    /**
     * 这条断言挡的是一个很具体的坑：`window.ts` 顶层读 `app.isPackaged`，
     * node 测试环境里 `app` 是 undefined —— 静态 import 进来整个测试文件加载就炸
     * （实测 `tests/project/running-wiring.spec.ts` 就是这么红的）。
     */
    expect(src).not.toMatch(/from '\.\.\/window'/)
    const boot = fs.readFileSync('src/main/index.ts', 'utf8')
    expect(boot).toMatch(/wake: wakeForProject/)
    const win = fs.readFileSync('src/main/window.ts', 'utf8')
    /** 取消置顶必须在 finally 里：漏掉的话 A 永远压在 Unity 上面 */
    expect(win).toMatch(/finally \{[\s\S]*?setAlwaysOnTop\(false\)/)
  })
})
