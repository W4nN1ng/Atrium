import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { openDatabase, closeDatabase, type Db } from '../../src/main/db'
import { upsertProject, getProjectByPath, autoSwitchAtOf, markAutoSwitched } from '../../src/main/db/repos/unity'
import {
  createAutoSwitcher,
  decideAutoSwitch,
  type AutoSwitchDeps
} from '../../src/main/project/autoSwitch'
import { AUTO_SWITCH_COOLDOWN_MS, WAKE_TOPMOST_MS } from '../../src/shared/constants'
import type { MatchOutcome, MatchableCollection, ProjectFingerprint } from '../../src/shared/projectMatch'
import type { AutoSwitchEvent } from '../../src/shared/types'

/**
 * M6 ③ · 自动切换的决策与执行。
 *
 * 这一份用例的存在意义主要是两件事（都是他自己点出来的隐患）：
 *
 *  1. **隐患 B**：`last_auto_switch_at` 只在"真的切了"时写。
 *     按"每次检测都写"实现的话，一次 skip 就把后面 5 分钟内的真实切换全吞掉 ——
 *     和 M5-A 那个 Tick 死锁同类（副作用改变了后续守卫的判断条件）。
 *     所以有一条专门的用例：「一次 skip 之后，紧接着的真实 hit 仍能切换」。
 *  2. **`autoSwitchBehavior` 是死设置**（从 M1 起有默认值、有类型，全仓库没人读）。
 *     所以三档各来一条，并额外读源码钉住"设置项确实被读"。
 */

const fp = (dirName: string): ProjectFingerprint => ({
  dirName,
  topFolders: [],
  installedPackages: [],
  avatarDescriptors: []
})
const hit = (id: string, name: string, keyword = 'shinano'): MatchOutcome => ({
  kind: 'hit',
  evidence: { collectionId: id, collectionName: name, via: 'keyword', keyword, hits: 2, priority: 0 }
})
const none: MatchOutcome = { kind: 'none', tried: 1, dropped: [] }
const twoWay: MatchOutcome = {
  kind: 'ambiguous',
  evidence: [
    { collectionId: 'a', collectionName: 'Shinano A', via: 'keyword', keyword: 'shinano', hits: 1, priority: 0 },
    { collectionId: 'b', collectionName: 'Shinano B', via: 'keyword', keyword: 'SHINANO', hits: 1, priority: 0 }
  ]
}

describe('decideAutoSwitch 决策表', () => {
  const base = { cooldownMs: AUTO_SWITCH_COOLDOWN_MS, now: 1_000_000, lastAutoSwitchAt: null }

  it('never → 直接 skip，连匹配结果都不看', () => {
    const d = decideAutoSwitch({ ...base, behavior: 'never', outcome: hit('a', 'A') })
    expect(d).toEqual({ action: 'skip', reason: 'never' })
  })

  it('唯一命中 → switch，并把证据带出去（横幅要写"凭什么"）', () => {
    const d = decideAutoSwitch({ ...base, behavior: 'when_matched', outcome: hit('a', 'Shinano') })
    expect(d.action).toBe('switch')
    if (d.action === 'switch') {
      expect(d.collectionId).toBe('a')
      expect(d.evidence.keyword).toBe('shinano')
    }
  })

  it('平手 → skip，但候选名单在结果里（Q1 的留痕）', () => {
    const d = decideAutoSwitch({ ...base, behavior: 'when_matched', outcome: twoWay })
    expect(d.action).toBe('skip')
    if (d.action === 'skip') {
      expect(d.reason).toBe('ambiguous')
      expect(d.names).toBe('Shinano A、Shinano B')
      expect(d.evidence).toHaveLength(2)
    }
  })

  it('没命中：when_matched 安静，always 才要求弹窗', () => {
    expect(decideAutoSwitch({ ...base, behavior: 'when_matched', outcome: none })).toEqual({
      action: 'skip',
      reason: 'none'
    })
    expect(decideAutoSwitch({ ...base, behavior: 'always', outcome: none })).toEqual({
      action: 'wake-only',
      reason: 'no-match-always'
    })
  })

  it('冷却：差 1 毫秒都算冷却中，过线就放行', () => {
    const last = 1_000_000
    const inCooldown = decideAutoSwitch({
      behavior: 'when_matched',
      cooldownMs: AUTO_SWITCH_COOLDOWN_MS,
      now: last + AUTO_SWITCH_COOLDOWN_MS - 1,
      lastAutoSwitchAt: last,
      outcome: hit('a', 'A')
    })
    expect(inCooldown.action === 'skip' && inCooldown.reason).toBe('cooldown')
    const expired = decideAutoSwitch({
      behavior: 'when_matched',
      cooldownMs: AUTO_SWITCH_COOLDOWN_MS,
      now: last + AUTO_SWITCH_COOLDOWN_MS,
      lastAutoSwitchAt: last,
      outcome: hit('a', 'A')
    })
    expect(expired.action).toBe('switch')
  })

  it('从没切过（NULL）不受冷却影响 —— 别把 null 当 0 用', () => {
    const d = decideAutoSwitch({
      behavior: 'when_matched',
      cooldownMs: AUTO_SWITCH_COOLDOWN_MS,
      now: 10,
      lastAutoSwitchAt: null,
      outcome: hit('a', 'A')
    })
    expect(d.action).toBe('switch')
  })
})

describe('createAutoSwitcher 的副作用纪律', () => {
  const started = { id: 'P1', path: 'E:\\ALCOMprojects\\shinano-Main2', name: 'shinano-Main2' }

  function harness(over: Partial<AutoSwitchDeps> = {}): {
    deps: AutoSwitchDeps
    calls: { fingerprint: number; markSwitched: number; notify: AutoSwitchEvent[]; behavior: number; order: string[] }
  } {
    const calls = { fingerprint: 0, markSwitched: 0, notify: [] as AutoSwitchEvent[], behavior: 0, order: [] as string[] }
    const deps: AutoSwitchDeps = {
      behavior: () => {
        calls.behavior++
        return 'when_matched'
      },
      lastAutoSwitchAt: () => null,
      markSwitched: () => {
        calls.markSwitched++
        calls.order.push('markSwitched')
      },
      fingerprint: async () => {
        calls.fingerprint++
        return fp('shinano-Main2')
      },
      collections: (): MatchableCollection[] => [{ id: 'c1', name: 'Shinano', rule: { keywords: ['shinano'] } }],
      knownProjects: () => [fp('shinano-Main2')],
      notify: (e) => {
        calls.notify.push(e)
        calls.order.push('notify')
      },
      now: () => 5_000,
      ...over
    }
    return { deps, calls }
  }

  it('真切换 → 写冷却 + 通知界面，顺序是"先写库再通知"', async () => {
    const { deps, calls } = harness()
    const d = await createAutoSwitcher(deps).onProjectStarted(started)
    expect(d.action).toBe('switch')
    expect(calls.markSwitched).toBe(1)
    expect(calls.notify[0].action).toBe('switch')
    expect(calls.notify[0].collectionId).toBe('c1')
    /**
     * 顺序也得钉住 —— 上面三行只证明"两件都发生了"，反了照样绿
     * （`verify-red-m6` 的 C7 第一次就是这么暴露的）。
     * 反过来的症状：界面已经切了，冷却却没写上，于是 5 分钟内再打开一次同一个工程又切一回。
     */
    expect(calls.order).toEqual(['markSwitched', 'notify'])
  })

  it('**skip 一律不写冷却**（四种 skip 全测）', async () => {
    for (const over of [
      { behavior: () => 'never' as const },
      { lastAutoSwitchAt: () => 4_900 },
      { collections: (): MatchableCollection[] => [] }
    ]) {
      const { deps, calls } = harness(over)
      await createAutoSwitcher(deps).onProjectStarted(started)
      expect(calls.markSwitched, JSON.stringify(Object.keys(over))).toBe(0)
    }
    /** 平手也不写 */
    const amb = harness({ collections: () => [
      { id: 'a', name: 'Shinano A', rule: { keywords: ['shinano'] } },
      { id: 'b', name: 'Shinano B', rule: { keywords: ['SHINANO'] } }
    ] })
    const d = await createAutoSwitcher(amb.deps).onProjectStarted(started)
    expect(d.action === 'skip' && d.reason).toBe('ambiguous')
    expect(amb.calls.markSwitched).toBe(0)
    /** 留痕要发到界面：候选名单进 candidates */
    expect(amb.calls.notify[0].candidates).toEqual(['Shinano A', 'Shinano B'])
  })

  it('一次 skip 之后，紧接着的真实命中**仍然能切**（隐患 B 的那条断言）', async () => {
    let stored: number | null = null
    const { deps } = harness({
      lastAutoSwitchAt: () => stored,
      markSwitched: (_id, at) => {
        stored = at
      },
      /** 第一轮没匹配上（集合表还是空的），第二轮才命中 */
      collections: (() => {
        let n = 0
        return (): MatchableCollection[] => {
          n++
          return n === 1 ? [] : [{ id: 'c1', name: 'Shinano', rule: { keywords: ['shinano'] } }]
        }
      })()
    })
    const sw = createAutoSwitcher(deps)
    const first = await sw.onProjectStarted(started)
    expect(first.action === 'skip' && first.reason).toBe('none')
    expect(stored).toBe(null)
    /** 同一分钟内再来一次（冷却窗口内），但因为上一次没写时间戳，这次照样切 */
    const second = await sw.onProjectStarted(started)
    expect(second.action).toBe('switch')
    expect(stored).toBe(5_000)
  })

  it('never 这一档连盘都不读（设置说"从不"就不该有任何副作用）', async () => {
    const { deps, calls } = harness({ behavior: () => 'never' as const })
    await createAutoSwitcher(deps).onProjectStarted(started)
    expect(calls.fingerprint).toBe(0)
    expect(calls.notify[0].reason).toBe('never')
  })

  it('三档行为开关**每轮都重新读**（不许启动时快照一次）', async () => {
    let mode: 'always' | 'when_matched' | 'never' = 'never'
    const { deps, calls } = harness({
      behavior: () => {
        calls.behavior++
        return mode
      }
    })
    const sw = createAutoSwitcher(deps)
    await sw.onProjectStarted(started)
    expect(calls.behavior, 'never 这一档也要真的去读设置（读一次存住就是死设置的复发）').toBeGreaterThan(0)
    mode = 'when_matched'
    const d = await sw.onProjectStarted(started)
    expect(d.action).toBe('switch')
    mode = 'always'
    const d2 = await sw.onProjectStarted(started)
    /** always + 集合命中 → 仍然是 switch（"每次都弹"管的是没命中时弹不弹，不是强行切） */
    expect(d2.action).toBe('switch')
    const sw3 = createAutoSwitcher(
      harness({ behavior: () => 'always' as const, collections: () => [] }).deps
    )
    const d3 = await sw3.onProjectStarted(started)
    expect(d3.action).toBe('wake-only')
  })

  it('采指纹抛错不许冒出来（这条链挂在每 3 秒的轮询上）', async () => {
    const { deps, calls } = harness({
      fingerprint: async () => {
        throw new Error('盘拔了')
      }
    })
    const d = await createAutoSwitcher(deps).onProjectStarted(started)
    expect(d.action).toBe('skip')
    expect(calls.markSwitched).toBe(0)
    expect(calls.notify).toHaveLength(0)
  })
})

describe('冷却时间戳落库（V6 那一列）', () => {
  let root: string
  let db: Db

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'avca-autoswitch-'))
    db = openDatabase(path.join(root, 'library.db'))
    upsertProject(db, { path: 'E:\\ALCOMprojects\\shinano-Main2', name: 'shinano-Main2' })
  })
  afterEach(() => {
    closeDatabase()
    fs.rmSync(root, { recursive: true, force: true })
  })

  it('从没切过 → NULL；写完之后读回来是同一个数', () => {
    const row = getProjectByPath(db, 'E:\\ALCOMprojects\\shinano-Main2')
    expect(row).not.toBeNull()
    expect(autoSwitchAtOf(db, row!.id)).toBe(null)
    markAutoSwitched(db, row!.id, 123456)
    expect(autoSwitchAtOf(db, row!.id)).toBe(123456)
  })

  it('库里没有这个工程时读成 NULL、写不炸', () => {
    expect(autoSwitchAtOf(db, 'ghost')).toBe(null)
    expect(() => markAutoSwitched(db, 'ghost', 1)).not.toThrow()
  })

  it('写冷却不许动 is_running（同一行别的列被顺手抹掉是这一类改动的常见病）', () => {
    upsertProject(db, { path: 'E:\\ALCOMprojects\\shinano-Main2', name: 'shinano-Main2', isRunning: true })
    const row = getProjectByPath(db, 'E:\\ALCOMprojects\\shinano-Main2')
    markAutoSwitched(db, row!.id, 999)
    expect(getProjectByPath(db, 'E:\\ALCOMprojects\\shinano-Main2')?.is_running).toBe(1)
  })
})

describe('接线（"实现了"不等于"生效了"）', () => {
  const read = (rel: string): string => fs.readFileSync(path.resolve(process.cwd(), rel), 'utf8')

  it('工程发现真的在"未运行→运行中"的边沿上调用了 onProjectStarted', () => {
    const src = read('src/main/project/api.ts')
    expect(src).toContain('onProjectStarted(')
    expect(src).toMatch(/if \(!c\.running\) continue/)
  })

  it('autoSwitchBehavior 真的被读（这个设置从 M1 起就是个死字段）', () => {
    const src = read('src/main/project/api.ts')
    expect(src).toMatch(/getSettings\(\)\.autoSwitchBehavior/)
    const all = ['src/main/project/api.ts', 'src/main/project/autoSwitch.ts']
      .map(read)
      .join('\n')
    expect(all).toContain('autoSwitchBehavior')
  })

  it('广播用的通道名在 preload 白名单里（不在的话运行时直接抛"通道不在白名单"）', () => {
    const ipc = read('src/shared/ipc.ts')
    expect(ipc).toContain("'unity:auto-switch'")
    const src = read('src/main/project/api.ts')
    expect(src).toMatch(/broadcast\('unity:auto-switch'/)
  })

  it('启动时把桥接管理器传给了指纹采集（lazy，不是启动时抓引用）', () => {
    const src = read('src/main/index.ts')
    expect(src).toMatch(/bridgeForFingerprint: \(\) => bridge/)
  })

  /**
   * 上面那些用例全都按常量写（`last + AUTO_SWITCH_COOLDOWN_MS - 1` 这种），
   * 于是**把 5 分钟改成 5 毫秒，一条用例都不会红** —— 而规格 §4.3 写死的是 5 分钟。
   * 这两条钉的是数字本身，不是逻辑。
   */
  it('冷却时长就是规格那 5 分钟（常量改了逻辑用例照样绿，所以数字得单独钉）', () => {
    expect(AUTO_SWITCH_COOLDOWN_MS).toBe(5 * 60 * 1000)
  })

  it('托盘唤醒置顶 1.2 秒（Q6 裁定值：规格原文只说"短暂闪烁"，没给时长）', () => {
    expect(WAKE_TOPMOST_MS).toBe(1200)
  })
})
