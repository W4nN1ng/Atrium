import { describe, it, expect, beforeEach, vi } from 'vitest'

/**
 * 成员选择面板的 **store 层**行为（M5-B ⑥）。
 *
 * ## 为什么这份测试值得写
 *
 * 本仓库渲染层零 DOM 测试（vitest 是 `environment:'node'`，没装 jsdom），
 * 所以面板最容易出事的**不是画法**，而是那几条状态转移：
 *  - 关面板要不要把已抽好的副本退回去（不退就是磁盘上留一地别人看得见的临时文件）；
 *  - 一批跑完 `queue` 有没有正确缩短（缩短错了会重复导同一批）；
 *  - `picked` 是不是按**用户点的顺序**存（分批顺序按它切，排序了就变成"我以为先导的是第一个"落空）；
 *  - 闸门拒绝时 `reasonKey` 有没有传到界面（传不到界面只能说"失败了"）。
 * 这些全都在 store 里，用假 `window.a` 就能真跑 —— 不需要 Electron，也不需要 Unity。
 *
 * ## 为什么能直接 import store
 *
 * `stores/ui.ts` 只依赖 zustand + i18next + `window.a`（preload 注入的那层）。
 * 前两个在 node 环境下能用，第三个在这里换成一个记调用次数的假货。
 * 假 `window.a` 的返回值形状**照 shared 类型给**，字段名错了 tsc 会红，
 * 不靠"跑起来再说"。
 */

type AnyFn = (...args: any[]) => any

interface Calls {
  packagesOfAsset: any[][]
  importPlan: any[][]
  importCommit: any[][]
  importAbandon: any[][]
  rollbackBatch: any[][]
}

function makeBridge(results: Partial<Record<string, any>> = {}) {
  const calls: Calls = { packagesOfAsset: [], importPlan: [], importCommit: [], importAbandon: [], rollbackBatch: [] }
  const api = {
    packagesOfAsset: vi.fn(async (...a: any[]) => {
      calls.packagesOfAsset.push(a)
      return (
        results.packages ?? {
          kind: 'archive',
          packages: [
            { path: null, relPath: 'shinano_a.unitypackage', sizeBytes: 5 * 1024 * 1024, origin: { containerAssetId: 'C1', originArchive: 'D:\\lib\\c.zip', memberRelPath: 'shinano_a.unitypackage' } },
            { path: null, relPath: 'other_b.unitypackage', sizeBytes: 5 * 1024 * 1024, origin: { containerAssetId: 'C1', originArchive: 'D:\\lib\\c.zip', memberRelPath: 'other_b.unitypackage' } }
          ],
          notes: { cappedDepth: 0, cappedCount: 0, blocked: [], needsPassword: false, scannedEntries: 2, backend: 'yauzl' }
        }
      )
    }),
    importPlan: vi.fn(async (...a: any[]) => {
      calls.importPlan.push(a)
      return (
        results.plan ?? {
          ok: true,
          batchId: 'BATCH-1',
          items: [{ relPath: 'shinano_a.unitypackage', sizeBytes: 5 * 1024 * 1024, originArchive: 'D:\\lib\\c.zip', extracted: true, entryCount: 3, fresh: 3, conflictCount: 1, conflicts: [{ guid: 'g1', existingPath: 'Assets/Old.prefab', incomingPath: 'Assets/New.prefab' }] }],
          blocked: [],
          totalBytes: 5 * 1024 * 1024,
          freeBytes: 50 * 1073741824,
          conflictPackages: 1,
          conflictEntries: 1,
          batchMax: 8
        }
      )
    }),
    importCommit: vi.fn(async (...a: any[]) => {
      calls.importCommit.push(a)
      return (
        results.commit ?? {
          ok: true,
          batchId: 'BATCH-1',
          imported: 1,
          failed: 0,
          notRun: 0,
          blocked: [],
          results: [{ relPath: 'shinano_a.unitypackage', ok: true, status: 'ok', importId: 'IL1', createdGuids: ['g1'], overwrittenGuids: [], error: null, reasonKey: null, cleanupFailed: false }],
          cleanupFailed: 0,
          stoppedReasonKey: null
        }
      )
    }),
    importAbandon: vi.fn(async (...a: any[]) => {
      calls.importAbandon.push(a)
      return { released: 1, failed: 0 }
    }),
    rollbackBatch: vi.fn(async (...a: any[]) => {
      calls.rollbackBatch.push(a)
      return (
        results.rollback ?? {
          batchId: 'BATCH-1',
          attempted: 1,
          rolledBack: 1,
          stoppedAt: null,
          details: [{ importId: 'IL1', relPath: 'shinano_a.unitypackage', ok: true, error: null, deletedFiles: 1, restoredFiles: 0, unrestorable: 0 }],
          ok: true
        }
      )
    })
  }
  return { api, calls }
}

let calls: Calls
let bridge: ReturnType<typeof makeBridge>

beforeEach(async () => {
  bridge = makeBridge()
  calls = bridge.calls
  const stub: Record<string, any> = {
    assets: {
      list: async () => ({ cards: [], total: 0 }),
      stats: async () => ({ assets: 0, groups: 0, bytes: 0, missingBytes: 0, duplicateBytes: 0 }),
      categories: async () => null,
      on: () => undefined
    },
    collections: { list: async () => [], addAssets: async () => 0 },
    categories: { list: async () => null },
    settings: { get: async () => ({}), patch: async () => ({}), all: async () => ({}) },
    system: { info: async () => ({}), paths: async () => ({}) },
    ingest: { queue: async () => [], restoreQueue: async () => [] },
    unity: {
      ...bridge.api,
      status: async () => ({}),
      instances: async () => [],
      listProjects: async () => [],
      refreshProjects: async () => [],
      importLogs: async () => [],
      preflight: async () => ({})
    },
    health: { scan: async () => ({}) },
    on: () => undefined,
    off: () => undefined
  }
  ;(globalThis as any).window = (globalThis as any).window ?? {}
  ;(globalThis as any).window.a = stub
  // 让 store 里的 refreshMeta 不至于炸
  vi.resetModules()
})

async function store() {
  const mod = await import('../../src/renderer/stores/ui')
  return mod.useUi
}

describe('打开面板：清单 + 预勾', () => {
  it('列清单用的是 packagesOfAsset，且传的是这张卡的 id', async () => {
    const useUi = await store()
    await useUi.getState().openMemberPicker('C1')
    expect(calls.packagesOfAsset).toEqual([['C1']])
    const p = useUi.getState().memberPicker
    expect(p.open).toBe(true)
    expect(p.packages).toHaveLength(2)
  })

  it('预勾只勾名字匹配上的那一个，并把依据留在 reasons 里', async () => {
    const useUi = await store()
    useUi.setState((s: any) => ({
      projects: [{ id: 'P1', name: 'shinano-Main2', path: 'D:\\p', unityVersion: null, running: true, detectedBy: [], bridgeVersion: null }],
      unity: { ...s.unity, targetProjectId: 'P1' }
    }))
    await useUi.getState().openMemberPicker('C1')
    const p = useUi.getState().memberPicker
    expect(p.picked).toEqual(['shinano_a.unitypackage'])
    expect(p.reasons['shinano_a.unitypackage']).toEqual({ reasonKey: 'pickByProject', matched: 'shinano' })
    /** 没命中的那个不许被顺手勾上 */
    expect(p.reasons['other_b.unitypackage']).toBeUndefined()
  })

  it('一个都没命中时谁都不勾，但也不是"太宽"（界面说的话不一样）', async () => {
    const useUi = await store()
    useUi.setState({ projects: [], unity: { ...(useUi.getState() as any).unity, targetProjectId: null } } as any)
    await useUi.getState().openMemberPicker('C1')
    const p = useUi.getState().memberPicker
    expect(p.picked).toEqual([])
    expect(p.tooBroad).toBe(null)
  })
})

describe('勾选与快捷动作', () => {
  it('picked 保留**用户点的顺序**（分批按它切，排序了就会导错第一个）', async () => {
    const useUi = await store()
    await useUi.getState().openMemberPicker('C1')
    useUi.getState().clearMemberPicks()
    useUi.getState().toggleMemberPick('other_b.unitypackage')
    useUi.getState().toggleMemberPick('shinano_a.unitypackage')
    expect(useUi.getState().memberPicker.picked).toEqual(['other_b.unitypackage', 'shinano_a.unitypackage'])
    /** 再点一次是取消，不是加第二遍 */
    useUi.getState().toggleMemberPick('other_b.unitypackage')
    expect(useUi.getState().memberPicker.picked).toEqual(['shinano_a.unitypackage'])
  })

  it('[只勾 < 100 MB] 按字节数筛，不猜哪些算小', async () => {
    const useUi = await store()
    await useUi.getState().openMemberPicker('C1')
    useUi.getState().clearMemberPicks()
    useUi.getState().pickMembersUnder(100 * 1024 * 1024)
    expect(useUi.getState().memberPicker.picked).toEqual(['shinano_a.unitypackage', 'other_b.unitypackage'])
    useUi.getState().clearMemberPicks()
    useUi.getState().pickMembersUnder(1 * 1024 * 1024)
    expect(useUi.getState().memberPicker.picked).toEqual([])
  })
})

describe('分批走链路', () => {
  it('一次只规划一批，batchId 与冲突表都留在面板状态里', async () => {
    const useUi = await store()
    await useUi.getState().openMemberPicker('C1')
    useUi.getState().setMemberPicks(['shinano_a.unitypackage', 'other_b.unitypackage'])
    await useUi.getState().runMemberBatches()
    expect(calls.importPlan).toHaveLength(1)
    expect(calls.importPlan[0][0]).toEqual({ assetId: 'C1', members: ['shinano_a.unitypackage', 'other_b.unitypackage'] })
    const p = useUi.getState().memberPicker
    expect(p.plan?.batchId).toBe('BATCH-1')
    expect(p.running).toBe(false)
  })

  it('勾了 9 个 → 第一批 8 个、第二批 1 个，跑完一批才规划下一批', async () => {
    const big = Array.from({ length: 9 }, (_, i) => ({
      path: null,
      relPath: `m${i}.unitypackage`,
      sizeBytes: 1024,
      origin: { containerAssetId: 'C1', originArchive: 'D:\\lib\\c.zip', memberRelPath: `m${i}.unitypackage` }
    }))
    bridge = makeBridge({
      packages: { kind: 'archive', packages: big, notes: { cappedDepth: 0, cappedCount: 0, blocked: [], needsPassword: false, scannedEntries: 9, backend: 'yauzl' } }
    })
    ;(globalThis as any).window.a.unity.importPlan = bridge.api.importPlan
    ;(globalThis as any).window.a.unity.importCommit = bridge.api.importCommit
    ;(globalThis as any).window.a.unity.importAbandon = bridge.api.importAbandon
    ;(globalThis as any).window.a.unity.packagesOfAsset = bridge.api.packagesOfAsset
    const useUi = await store()
    await useUi.getState().openMemberPicker('C1')
    useUi.getState().setMemberPicks(big.map((b) => b.relPath))
    await useUi.getState().runMemberBatches()
    /** 只有第一批被抽了 —— 第二批还没抽，磁盘上不会同时躺着 9 份副本 */
    expect(bridge.calls.importPlan).toHaveLength(1)
    expect(bridge.calls.importPlan[0][0].members).toHaveLength(8)
    expect(useUi.getState().memberPicker.queue).toEqual([['m8.unitypackage']])

    await useUi.getState().decideMemberPlan('continue-with-backup')
    expect(bridge.calls.importCommit).toHaveLength(1)
    expect(useUi.getState().memberPicker.outcome?.imported).toBe(1)
    /**
     * R4 ① · 进度队列：按下确认时按 `PlanView.items` 铺出来，收尾以 `results` 为准。
     *
     * 这里**故意不发** `unity:import-item` 事件（mock 的 `window.a.on` 是空转），
     * 于是那条会一直挂在 `running` 上 —— 收尾如果不按账本校正，它就会被落成 `unknown`。
     * 这条断言因此同时验了两件事：队列铺得对，以及"直播丢了也以账本为准"。
     */
    const q = useUi.getState().importFlow.queue
    expect(q.batchId).toBe('BATCH-1')
    expect(q.items.map((i) => [i.label, i.status])).toEqual([['shinano_a.unitypackage', 'ok']])
    expect(q.running).toBe(false)
    /** 提交完这一批就该没有"在途计划"了，副本由主进程按条删 */
    expect(useUi.getState().memberPicker.plan).toBe(null)

    await useUi.getState().nextMemberBatch()
    expect(bridge.calls.importPlan).toHaveLength(2)
    expect(bridge.calls.importPlan[1][0].members).toEqual(['m8.unitypackage'])
    expect(useUi.getState().memberPicker.queue).toEqual([])
  })

  it('闸门拒绝时把 reasonKey 原样带进界面（不能糊成"失败了"）', async () => {
    bridge = makeBridge({ plan: { ok: false, reasonKey: 'err.extractNoSpace', reasonParams: { freeGB: 1, needGB: 2 }, detail: null } })
    ;(globalThis as any).window.a.unity.importPlan = bridge.api.importPlan
    ;(globalThis as any).window.a.unity.packagesOfAsset = bridge.api.packagesOfAsset
    const useUi = await store()
    await useUi.getState().openMemberPicker('C1')
    useUi.getState().setMemberPicks(['shinano_a.unitypackage'])
    await useUi.getState().runMemberBatches()
    const p = useUi.getState().memberPicker
    expect(p.plan).toBe(null)
    expect(p.reasonKey).toBe('err.extractNoSpace')
    expect(p.reasonParams).toEqual({ freeGB: 1, needGB: 2 })
  })
})

describe('反悔与退回', () => {
  it('抽好了还没确认就关面板 → 必须把这批副本退回去', async () => {
    const useUi = await store()
    await useUi.getState().openMemberPicker('C1')
    useUi.getState().setMemberPicks(['shinano_a.unitypackage'])
    await useUi.getState().runMemberBatches()
    expect(useUi.getState().memberPicker.plan?.batchId).toBe('BATCH-1')
    useUi.getState().closeMemberPicker()
    expect(calls.importAbandon).toEqual([['BATCH-1']])
    expect(useUi.getState().memberPicker.open).toBe(false)
  })

  it('汇总卡片上点"取消" → 退副本、回到勾选那一步，面板不关', async () => {
    const useUi = await store()
    await useUi.getState().openMemberPicker('C1')
    useUi.getState().setMemberPicks(['shinano_a.unitypackage'])
    await useUi.getState().runMemberBatches()
    await useUi.getState().decideMemberPlan('cancel')
    expect(calls.importAbandon).toEqual([['BATCH-1']])
    expect(calls.importCommit).toHaveLength(0)
    const p = useUi.getState().memberPicker
    expect(p.plan).toBe(null)
    expect(p.open).toBe(true)
    expect(p.packages).toHaveLength(2)
  })

  it('"就导到这儿"：剩下的批次不再抽不再导，已抽的退回去', async () => {
    const useUi = await store()
    await useUi.getState().openMemberPicker('C1')
    useUi.getState().setMemberPicks(['shinano_a.unitypackage'])
    await useUi.getState().runMemberBatches()
    useUi.setState((s: any) => ({ memberPicker: { ...s.memberPicker, queue: [['other_b.unitypackage']] } }))
    useUi.getState().stopMemberBatches()
    expect(calls.importAbandon).toEqual([['BATCH-1']])
    const p = useUi.getState().memberPicker
    expect(p.queue).toEqual([])
    expect(p.plan).toBe(null)
    /** 停的是这批，不是整个面板 —— 清单还在，用户可以重新勾 */
    expect(p.packages).toHaveLength(2)
  })

  it('整批退回走 rollback-batch，且报"停在哪一条"而不是悄悄少撤', async () => {
    bridge = makeBridge({
      rollback: {
        batchId: 'BATCH-1',
        attempted: 2,
        rolledBack: 1,
        stoppedAt: 'IL2',
        details: [
          { importId: 'IL2', relPath: 'b', ok: true, error: null, deletedFiles: 2, restoredFiles: 0, unrestorable: 0 },
          { importId: 'IL1', relPath: 'a', ok: false, error: 'Unity 没开', deletedFiles: 0, restoredFiles: 0, unrestorable: 0 }
        ],
        ok: false
      }
    })
    ;(globalThis as any).window.a.unity.rollbackBatch = bridge.api.rollbackBatch
    ;(globalThis as any).window.a.unity.importPlan = bridge.api.importPlan
    ;(globalThis as any).window.a.unity.importCommit = bridge.api.importCommit
    ;(globalThis as any).window.a.unity.packagesOfAsset = bridge.api.packagesOfAsset
    const useUi = await store()
    await useUi.getState().openMemberPicker('C1')
    useUi.getState().setMemberPicks(['shinano_a.unitypackage'])
    await useUi.getState().runMemberBatches()
    await useUi.getState().decideMemberPlan('continue')
    expect(useUi.getState().memberPicker.outcome).toBeTruthy()
    await useUi.getState().rollbackMemberOutcome()
    expect(bridge.calls.rollbackBatch).toEqual([['BATCH-1']])
    /** 有一条没撤成就不能报"都退回去了" —— 界面要拿这条分支的文案 */
    const toasts = useUi.getState().toasts
    expect(toasts.some((x: any) => x.tone === 'warn')).toBe(true)
  })
})

describe('R4 ① · 进度事件的接线（"实现了"不等于"生效了"）', () => {
  it('bindEvents 真的订阅了逐条进度与命令级进度（不订阅就还是那行不动的"正在导入"）', async () => {
    const fs = await import('node:fs')
    const src = fs.readFileSync('src/renderer/stores/ui.ts', 'utf8')
    expect(src).toContain("window.a.on('unity:import-item'")
    expect(src).toContain("window.a.on('unity:import-progress'")
    /** 组件必须走纯函数拿渲染态，不许自己判断状态 */
    const view = fs.readFileSync('src/renderer/components/ImportFlow.tsx', 'utf8')
    expect(view).toContain('importQueueRenderState(')
  })

  it('主进程把 onItem 传给了 commitMemberImport（这个参数从 M5-B 就在，一直没被传过）', async () => {
    const fs = await import('node:fs')
    const src = fs.readFileSync('src/main/bridge/ipc.ts', 'utf8')
    expect(src).toMatch(/onItem:\s*\(r,\s*idx\)\s*=>/)
    expect(src).toMatch(/broadcast\('unity:import-item'/)
  })
})
