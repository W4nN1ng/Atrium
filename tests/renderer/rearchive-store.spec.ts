import { describe, it, expect, beforeEach, vi } from 'vitest'

/**
 * R4 ③ · 详情面板「保存」那条链的 store 层行为。
 *
 * 判据本体在 `shared/rearchiveDialog.ts`（另一份用例在管），这份管的是
 * **store 有没有照那份判据办事**：
 *  - 预览说不该搬 → 不发确认卡、直接只改记录、原因要说；
 *  - 预览说该搬 → 只弹卡，**一次文件都不动**（点「搬过去」才执行）；
 *  - 预览失败 → 什么都不改（连"只改记录"都不给）；
 *  - 「只改记录」走 `assets:reclassify`，不能偷偷改成走搬文件那条链路。
 */

type AnyFn = (...args: any[]) => any

interface Calls {
  plan: any[][]
  rearchive: any[][]
  reclassify: any[][]
}

let calls: Calls
/** 下一次 `rearchivePlan` 要回什么（每条用例自己摆） */
let nextPlan: any

function makeBridge() {
  calls = { plan: [], rearchive: [], reclassify: [] }
  const api = {
    rearchivePlan: vi.fn(async (...a: any[]) => {
      calls.plan.push(a)
      return nextPlan
    }),
    rearchive: vi.fn(async (input: any) => {
      calls.rearchive.push([input])
      return input.__fail
        ? { ok: false, reasonKey: 'err.rearchiveStale', reasonParams: { was: 'X', now: 'Y' } }
        : {
            ok: true,
            batchId: 'B1',
            journalId: 7,
            moved: nextPlan?.willMove ? 1 : 0,
            rewrites: nextPlan?.willMove ? 4 : 1,
            dbOnly: !nextPlan?.willMove,
            reasonKey: nextPlan?.willMove ? null : nextPlan.reasonKey,
            reasonParams: nextPlan?.willMove ? null : nextPlan.reasonParams,
            error: null,
            learned: { learnedTokens: 2, hint: null }
          }
    }),
    reclassify: vi.fn(async (...a: any[]) => {
      calls.reclassify.push(a)
      return { learnedTokens: 1, hint: null }
    })
  }
  return api
}

let api: ReturnType<typeof makeBridge>

beforeEach(async () => {
  api = makeBridge()
  nextPlan = { ok: false, reasonKey: 'err.assetGone' }
  /**
   * 真的要初始化 i18n：这份用例断的是"界面会显示出哪句话"，
   * 而 `rearchive.savedOnly` 那句里**嵌着**主进程给的原因（`{{reason}}`）。
   * 不 init 的话 `t()` 原样回 key，嵌套插值测不到 —— 那正是"原因被吞掉"最容易溜过去的地方。
   */
  const { initI18n } = await import('../../src/renderer/i18n')
  await initI18n('zh-CN')
  const stub: Record<string, any> = {
    assets: {
      list: async () => ({ cards: [], total: 0 }),
      stats: async () => ({ assets: 0, groups: 0, bytes: 0, missingBytes: 0, duplicateBytes: 0 }),
      categories: async () => null,
      detail: async () => null,
      ...api
    },
    collections: { list: async () => [], addAssets: async () => 0 },
    categories: { list: async () => null },
    settings: { get: async () => ({}), patch: async () => ({}), all: async () => ({}) },
    system: { info: async () => ({}), paths: async () => ({}) },
    ingest: { queue: async () => [], restoreQueue: async () => [] },
    unity: {
      status: async () => ({}),
      instances: async () => [],
      listProjects: async () => [],
      refreshProjects: async () => [],
      importLogs: async () => [],
      packagesOfAsset: async () => ({ kind: 'empty', packages: [], notes: null, reasonKey: null }),
      preflight: async () => ({})
    },
    journal: { list: async () => [], undoLast: async () => ({ ok: false, undone: 0, assetIds: [] }) },
    health: { scan: async () => ({}) },
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

const SAVE = { assetId: 'A1', category: 'accessory', subcategory: 'headwear', fromLabel: '材质', toLabel: '配饰 / 头饰' }

const WILL_MOVE = {
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
  batchId: 'B1'
}

const INDEXED = { ...WILL_MOVE, willMove: false, reasonKey: 'rearchive.reason.indexed', reasonParams: null, toDir: null, moves: [] }

describe('预览说不该搬', () => {
  it('不弹确认卡，直接只改记录，并把原因和「已保存」一起说', async () => {
    nextPlan = INDEXED
    const useUi = await store()
    await useUi.getState().saveCategory(SAVE)
    expect(useUi.getState().rearchive.open, '没什么可决定的就别弹卡').toBe(false)
    expect(calls.rearchive).toHaveLength(1)
    expect(calls.rearchive[0][0]).toEqual({ assetId: 'A1', category: 'accessory', subcategory: 'headwear', expectToDir: null })
    const texts = useUi.getState().toasts.map((t: any) => t.text)
    expect(texts.join(' |')).toMatch(/只登记不搬/)
  })

  it('预览失败 → 一次 rearchive 都不发、一次 reclassify 都不发', async () => {
    nextPlan = { ok: false, reasonKey: 'err.assetGone' }
    const useUi = await store()
    await useUi.getState().saveCategory(SAVE)
    expect(calls.rearchive).toHaveLength(0)
    expect(calls.reclassify).toHaveLength(0)
    expect(useUi.getState().rearchive.open).toBe(false)
    expect(useUi.getState().toasts.some((t: any) => t.tone === 'bad')).toBe(true)
  })

  it('主进程炸了（IPC 抛错）→ 状态清空、报错，不许留着 loading 转圈', async () => {
    nextPlan = null
    api.rearchivePlan.mockImplementationOnce(async () => {
      throw new Error('数据库忙')
    })
    const useUi = await store()
    await useUi.getState().saveCategory(SAVE)
    const s = useUi.getState().rearchive
    expect(s.open).toBe(false)
    expect(s.loading).toBe(false)
    expect(useUi.getState().toasts.some((t: any) => t.text.includes('数据库忙'))).toBe(true)
  })
})

describe('预览说该搬', () => {
  it('只弹卡，一次 rearchive 都不发 —— 动盘要等用户点头', async () => {
    nextPlan = WILL_MOVE
    const useUi = await store()
    await useUi.getState().saveCategory(SAVE)
    expect(useUi.getState().rearchive.open).toBe(true)
    expect(useUi.getState().rearchive.plan).toEqual(WILL_MOVE)
    expect(calls.rearchive).toHaveLength(0)
    expect(calls.reclassify).toHaveLength(0)
  })

  it('「搬过去」把预览给过的那个 toDir 原样带回（expectToDir 是防偷偷搬的唯一凭据）', async () => {
    nextPlan = WILL_MOVE
    const useUi = await store()
    await useUi.getState().saveCategory(SAVE)
    await useUi.getState().confirmRearchive()
    expect(calls.rearchive[0][0].expectToDir).toBe(WILL_MOVE.toDir)
    expect(useUi.getState().rearchive.open).toBe(false)
    const texts = useUi.getState().toasts.map((t: any) => t.text)
    expect(texts.join(' |')).toMatch(/已搬好：1 项文件、改写 4 条记录/)
  })

  it('主进程说计划过期 → 报错、不重试、不当成功', async () => {
    nextPlan = WILL_MOVE
    const useUi = await store()
    await useUi.getState().saveCategory(SAVE)
    api.rearchive.mockImplementationOnce(async (input: any) => {
      calls.rearchive.push([input])
      return { ok: false, reasonKey: 'err.rearchiveStale', reasonParams: { was: 'X', now: 'Y' } }
    })
    await useUi.getState().confirmRearchive()
    expect(useUi.getState().rearchive.open).toBe(false)
    expect(useUi.getState().toasts.some((t: any) => t.tone === 'bad' && /没敢照旧的搬/.test(t.text))).toBe(true)
  })

  it('「只改记录」走 reclassify，不碰搬文件那条链路', async () => {
    nextPlan = WILL_MOVE
    const useUi = await store()
    await useUi.getState().saveCategory(SAVE)
    await useUi.getState().rearchiveRecordOnly()
    expect(calls.reclassify).toEqual([['A1', 'accessory', 'headwear']])
    expect(calls.rearchive).toHaveLength(0)
    expect(useUi.getState().rearchive.open).toBe(false)
  })

  it('取消：什么都不发', async () => {
    nextPlan = WILL_MOVE
    const useUi = await store()
    await useUi.getState().saveCategory(SAVE)
    useUi.getState().closeRearchive()
    expect(useUi.getState().rearchive.open).toBe(false)
    expect(calls.rearchive).toHaveLength(0)
    expect(calls.reclassify).toHaveLength(0)
  })
})

describe('入口只有一处', () => {
  it('详情面板的「保存」调 saveCategory，不再直接调 reclassify', async () => {
    /**
     * 这一条管的是"两条入口分叉"：以前面板直接 `reclassify`，
     * 搬文件那条永远走不到；反过来如果面板留着旧调用，改了判据也不生效。
     */
    const fs = await import('node:fs')
    const path = await import('node:path')
    const src = fs.readFileSync(path.resolve(__dirname, '../../src/renderer/components/DetailPanel.tsx'), 'utf8')
    expect(src).toMatch(/saveCategory\(/)
    const code = src.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n')
    expect(code).not.toMatch(/void reclassify\(/)
  })

  it('store 里 saveCategory 不再自己判 willMove（判据只有 rearchiveDialogState 一处）', async () => {
    const fs = await import('node:fs')
    const path = await import('node:path')
    const raw = fs.readFileSync(path.resolve(__dirname, '../../src/renderer/stores/ui.ts'), 'utf8')
    const start = raw.indexOf('async saveCategory(')
    expect(start, '没找到 saveCategory，扫描规则失效了').toBeGreaterThan(-1)
    /** ⚠ 必须先剥注释：这条要钉的是"代码里没有第二份判据"，而注释里正是靠提这两个词来解释为什么不写 */
    const body = raw
      .slice(start, raw.indexOf('\n    },', start))
      .split('\n')
      .filter((l) => !/^\s*(\/\/|\*|\/\*|\/\*\*)/.test(l))
      .join('\n')
    expect(body).toMatch(/rearchiveDialogState\(/)
    expect(body).not.toMatch(/plan\.ok|\.willMove\b/)
  })
})
