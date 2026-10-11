import { describe, it, expect, beforeEach, vi } from 'vitest'

/**
 * R4 ② · 多选卡批量导入的 **store 层**行为。
 *
 * 和 `member-picker-store.spec.ts` 同一套路：本仓库渲染层零 DOM 测试，
 * 所以值得测的是那几条状态转移与"替不替用户做决定"的口径，不是画法。
 *
 * 这份文件最要紧的是第 2、9 两条：
 *  - 一张卡里有好几个成员时**不替他挑**（跳过的张数要如实报出来）；
 *  - 一张都不能直导时**不许打开面板**，更不能偷偷导第一个。
 * 这两条都是"看起来更省事、实际是拿用户工程当试验田"的方向。
 */

type AnyFn = (...args: any[]) => any

/** 每张假卡：可直导 / 只有一个成员要抽 / 好几个成员得先选 */
const CARDS: Record<string, { kind: string; packages: Array<{ rel: string; path: string | null }> }> = {
  LOOSE1: { kind: 'loose', packages: [{ rel: 'one.unitypackage', path: 'E:\\lib\\one.unitypackage' }] },
  LOOSE2: { kind: 'loose', packages: [{ rel: 'two.unitypackage', path: 'E:\\lib\\two.unitypackage' }] },
  ONEMEMBER: { kind: 'archive', packages: [{ rel: 'inner/three.unitypackage', path: null }] },
  MANYMEMBER: { kind: 'archive', packages: [{ rel: 'a.unitypackage', path: null }, { rel: 'b.unitypackage', path: null }] },
  EMPTY: { kind: 'empty', packages: [] }
}

interface Calls {
  packagesOfAsset: any[][]
  importPlan: any[][]
  importCommit: any[][]
  importAbandon: any[][]
}

let calls: Calls
let planSeq = 0
/** 最近一次 importPlan 给出的条目：commit 的 mock 要照它回结果，不然"账本"是空的 */
let lastPlanRelPaths: string[] = []

function makeBridge() {
  calls = { packagesOfAsset: [], importPlan: [], importCommit: [], importAbandon: [] }
  const api = {
    packagesOfAsset: vi.fn(async (assetId: any) => {
      calls.packagesOfAsset.push([assetId])
      const c = CARDS[String(assetId)] ?? CARDS.LOOSE1
      return {
        kind: c.kind,
        packages: c.packages.map((p) => ({
          path: p.path,
          relPath: p.rel,
          sizeBytes: 1024,
          origin: { containerAssetId: String(assetId), originArchive: p.path ? null : 'E:\\lib\\card.zip', memberRelPath: p.path ? null : p.rel }
        })),
        notes: null,
        reasonKey: c.kind === 'empty' ? 'err.noPackage' : null
      }
    }),
    importPlan: vi.fn(async (input: any) => {
      calls.importPlan.push([input])
      planSeq += 1
      const items = (input?.items ?? []).map((x: any) => ({
        relPath: x.members[0],
        sizeBytes: 1024,
        originArchive: null,
        extracted: false,
        entryCount: 1,
        fresh: 1,
        conflictCount: 0,
        conflicts: []
      }))
      lastPlanRelPaths = items.map((i: any) => i.relPath)
      return {
        ok: true,
        batchId: 'BATCH-' + planSeq,
        items,
        blocked: [],
        totalBytes: 1024 * items.length,
        freeBytes: 50 * 1073741824,
        conflictPackages: 0,
        conflictEntries: 0,
        batchMax: 8
      }
    }),
    importCommit: vi.fn(async (...a: any[]) => {
      calls.importCommit.push(a)
      return {
        ok: true,
        batchId: 'BATCH-' + planSeq,
        imported: lastPlanRelPaths.length,
        failed: 0,
        notRun: 0,
        blocked: [],
        /** 账本要照最近那份计划回，否则"收尾以账本为准"这条路径测不到东西 */
        results: lastPlanRelPaths.map((relPath) => ({
          relPath,
          ok: true,
          status: 'ok',
          importId: 'IL-' + relPath,
          createdGuids: ['g1'],
          overwrittenGuids: [],
          error: null,
          reasonKey: null,
          cleanupFailed: false
        })),
        cleanupFailed: 0,
        stoppedReasonKey: null
      }
    }),
    importAbandon: vi.fn(async (...a: any[]) => {
      calls.importAbandon.push(a)
      return { released: 1, failed: 0 }
    })
  }
  return api
}

let api: ReturnType<typeof makeBridge>

beforeEach(async () => {
  api = makeBridge()
  planSeq = 0
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
      ...api,
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
  vi.resetModules()
})

async function store() {
  const mod = await import('../../src/renderer/stores/ui')
  return mod.useUi
}

async function readyWith(selection: string[], target: string | null = 'P1') {
  const useUi = await store()
  useUi.setState({ unity: { ...useUi.getState().unity, targetProjectId: target }, selection })
  return useUi
}

describe('能直导的卡', () => {
  it('三张可直导的卡 → 一次 importPlan，入参是 items[]（每张卡点名自己要导的那个包）', async () => {
    const useUi = await readyWith(['LOOSE1', 'LOOSE2', 'ONEMEMBER'])
    await useUi.getState().importSelected()
    expect(calls.importPlan).toHaveLength(1)
    const input = calls.importPlan[0][0]
    expect(input.projectId).toBe('P1')
    expect(input.items).toEqual([
      { assetId: 'LOOSE1', members: ['one.unitypackage'] },
      { assetId: 'LOOSE2', members: ['two.unitypackage'] },
      { assetId: 'ONEMEMBER', members: ['inner/three.unitypackage'] }
    ])
    const b = useUi.getState().batchImport
    expect(b.open).toBe(true)
    expect(b.skipped).toBe(0)
    expect(b.plan?.items).toHaveLength(3)
  })

  it('只有一个成员的容器也算"可直导"（没有"选哪个"这回事），但它要先抽', async () => {
    const useUi = await readyWith(['ONEMEMBER'])
    await useUi.getState().importSelected()
    expect(calls.importPlan).toHaveLength(1)
    expect(calls.importPlan[0][0].items[0].members).toEqual(['inner/three.unitypackage'])
  })
})

describe('不替用户做决定', () => {
  it('好几个成员的容器 → 跳过那张卡，并把跳过数留在状态里给界面说', async () => {
    const useUi = await readyWith(['LOOSE1', 'MANYMEMBER'])
    await useUi.getState().importSelected()
    const input = calls.importPlan[0][0]
    expect(input.items.map((x: any) => x.assetId)).toEqual(['LOOSE1'])
    expect(useUi.getState().batchImport.skipped).toBe(1)
    /** 没替他挑，就绝不能把那张卡的第一个包塞进去 */
    expect(JSON.stringify(input)).not.toContain('a.unitypackage')
  })

  it('一张都不能直导 → 面板不开、一次 importPlan 都不发', async () => {
    const useUi = await readyWith(['MANYMEMBER', 'EMPTY'])
    await useUi.getState().importSelected()
    expect(calls.importPlan).toHaveLength(0)
    expect(useUi.getState().batchImport.open).toBe(false)
    expect(useUi.getState().toasts.some((x: any) => x.tone === 'warn')).toBe(true)
  })

  it('没选导入目标 → 不开面板（以前会一路走到主进程才报"没有工程"）', async () => {
    const useUi = await readyWith(['LOOSE1'], null)
    await useUi.getState().importSelected()
    expect(calls.importPlan).toHaveLength(0)
    expect(useUi.getState().batchImport.open).toBe(false)
  })
})

describe('分批', () => {
  it('9 张卡 → 第一批 8 张，剩下 1 张排在 queue 里，一次只抽一批', async () => {
    const ids = Array.from({ length: 9 }, (_, i) => 'C' + i)
    /** 让第 2..9 号都落到 LOOSE1 那张假卡上（同一份清单，不同的卡 id） */
    for (let i = 1; i < ids.length; i++) CARDS[ids[i]] = CARDS.LOOSE1
    const useUi = await readyWith(ids)
    await useUi.getState().importSelected()
    expect(calls.importPlan[0][0].items).toHaveLength(8)
    expect(useUi.getState().batchImport.queue).toHaveLength(1)
    expect(useUi.getState().batchImport.queue[0]).toHaveLength(1)

    await useUi.getState().nextBatch()
    expect(calls.importPlan).toHaveLength(2)
    expect(calls.importPlan[1][0].items).toHaveLength(1)
    expect(useUi.getState().batchImport.queue).toHaveLength(0)
  })

  it('「就导到这儿」：剩下的批次不再抽不再导，当前已抽的退回', async () => {
    const ids = Array.from({ length: 9 }, (_, i) => 'D' + i)
    for (const id of ids) CARDS[id] = CARDS.LOOSE1
    const useUi = await readyWith(ids)
    await useUi.getState().importSelected()
    const batchId = useUi.getState().batchImport.plan?.batchId
    useUi.getState().stopBatches()
    expect(useUi.getState().batchImport.queue).toHaveLength(0)
    expect(useUi.getState().batchImport.plan).toBe(null)
    expect(calls.importAbandon).toEqual([[batchId]])
    /** 停下之后不该再规划第二批 */
    expect(calls.importPlan).toHaveLength(1)
  })
})

describe('确认与收尾', () => {
  it('点"取消" → 退回副本、面板留着（回到能再点一次的形状），一次 commit 都不发', async () => {
    const useUi = await readyWith(['LOOSE1'])
    await useUi.getState().importSelected()
    const batchId = useUi.getState().batchImport.plan?.batchId
    await useUi.getState().decideBatchPlan('cancel')
    expect(calls.importAbandon).toEqual([[batchId]])
    expect(calls.importCommit).toHaveLength(0)
    expect(useUi.getState().batchImport.plan).toBe(null)
  })

  it('点"继续并备份" → 用这一批的 batchId 提交，并把进度队列收尾', async () => {
    const useUi = await readyWith(['LOOSE1', 'LOOSE2'])
    await useUi.getState().importSelected()
    const batchId = useUi.getState().batchImport.plan?.batchId
    await useUi.getState().decideBatchPlan('continue-with-backup')
    expect(calls.importCommit[0][0]).toEqual({ batchId, choice: 'continue-with-backup' })
    expect(useUi.getState().batchImport.outcome).toBeTruthy()
    /** 收尾之后不许有还在"进行中"的条目（事件丢了也要以账本为准） */
    expect(useUi.getState().importFlow.queue.running).toBe(false)
  })

  it('抽好之后进度队列就铺上了，跑完每条都有终态（§8-4 的"进度可见"）', async () => {
    /**
     * 这一条是沙盒活体逼出来的：批量那条路以前**从没铺过队列**，
     * 结果卡上只有"成功 5 个"那一句、逐条的行是空的 —— 截图上看得清清楚楚。
     */
    const useUi = await readyWith(['LOOSE1', 'LOOSE2', 'ONEMEMBER'])
    await useUi.getState().importSelected()
    const seeded = useUi.getState().importFlow.queue
    expect(seeded.items.map((i) => i.label)).toEqual(['one.unitypackage', 'two.unitypackage', 'inner/three.unitypackage'])
    expect(seeded.items.every((i) => i.status === 'queued')).toBe(true)
    expect(seeded.running).toBe(false)

    await useUi.getState().decideBatchPlan('continue')
    const q = useUi.getState().importFlow.queue
    expect(q.running).toBe(false)
    expect(q.items.map((i) => i.status)).toEqual(['ok', 'ok', 'ok'])
    expect(q.items.every((i) => i.progress === 100)).toBe(true)
  })

  it('直接关窗 = 这批不要了：已抽的副本当场退回，进度队列复位', async () => {
    const useUi = await readyWith(['LOOSE1'])
    await useUi.getState().importSelected()
    const batchId = useUi.getState().batchImport.plan?.batchId
    useUi.getState().closeBatchImport()
    expect(calls.importAbandon).toEqual([[batchId]])
    expect(useUi.getState().batchImport.open).toBe(false)
    expect(useUi.getState().importFlow.queue.items).toEqual([])
  })

  it('面板开着时再点一次批量 → 不重开一批（两批并行会把撤销顺序搅乱）', async () => {
    const useUi = await readyWith(['LOOSE1', 'LOOSE2'])
    await useUi.getState().importSelected()
    await useUi.getState().importSelected()
    expect(calls.importPlan).toHaveLength(1)
  })
})

describe('接线', () => {
  it('a stopped batch explains the newer overlapping import in the current language', async () => {
    const useUi = await readyWith([])
    const { initI18n } = await import('../../src/renderer/i18n')
    await initI18n('zh-CN')
    window.a.unity.rollbackBatch = vi.fn(async () => ({ batchId: 'old', attempted: 1, rolledBack: 0,
      stoppedAt: 'old-import', ok: false, details: [{ importId: 'old-import', relPath: 'old.unitypackage',
        ok: false, error: 'i18n:importHistory.newerOverlap', deletedFiles: 0, restoredFiles: 0, unrestorable: 0 }] }))
    useUi.setState(s => ({ batchImport: { ...s.batchImport, outcome: { ok: true, batchId: 'old', imported: 1,
      failed: 0, notRun: 0, blocked: [], results: [], cleanupFailed: 0, stoppedReasonKey: null } } }))
    await useUi.getState().rollbackBatchOutcome()
    expect(useUi.getState().toasts.some(x => x.text.includes('后来的导入修改了同一资源'))).toBe(true)
    expect(useUi.getState().toasts.some(x => x.text.includes('i18n:'))).toBe(false)
  })
  it('面板挂在 App 上（发起方是网格/快捷键，它们卸载了面板得还在）', async () => {
    const fs = await import('node:fs')
    const app = fs.readFileSync('src/renderer/App.tsx', 'utf8')
    expect(app).toContain('<BatchImportDialog />')
  })

  it('Enter 多选走批量、单选走老路（以前框三张按回车只进去第一张）', async () => {
    const fs = await import('node:fs')
    const app = fs.readFileSync('src/renderer/App.tsx', 'utf8')
    expect(app).toContain('if (sel.length > 1) void useUi.getState().importSelected()')
    expect(app).toContain('else if (sel.length === 1) void useUi.getState().importAsset(sel[0])')
  })

  it('主进程的 import-plan 真的认 items[] 这种入参（不认的话界面这套形状就是空谈）', async () => {
    const fs = await import('node:fs')
    const src = fs.readFileSync('src/main/bridge/ipc.ts', 'utf8')
    expect(src).toMatch(/i\.items\) && i\.items\.length/)
    expect(src).toMatch(/sources\.push\(\{ assetId: r\.assetId/)
  })

  it('界面用的"要不要替用户挑"判据与主链路是同一个函数（两处各写一遍必漂）', async () => {
    const fs = await import('node:fs')
    const src = fs.readFileSync('src/renderer/stores/ui.ts', 'utf8')
    expect(src).toContain('cardImportChoice(')
    const shared = fs.readFileSync('src/shared/memberPick.ts', 'utf8')
    expect(shared).toMatch(/export function cardImportChoice/)
  })
})

/** 让 TS 知道这个文件里的 mock 函数形状够用，避免 AnyFn 变成未使用告警 */
void (null as unknown as AnyFn)
