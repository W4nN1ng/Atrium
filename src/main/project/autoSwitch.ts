/**
 * M6 ③ · 工程"未运行 → 运行中"这条边沿上的自动切换决策
 *
 * 规格：第 3 份 §4.3 步骤 2–3 + 防打扰规则（R-44 / R-46 / R-49 / R-50 / R-51）。
 * 裁定：Q1（平手不切、必须留痕）、Q3（`autoLaunch` 保持 false，这里不碰系统启动项）。
 *
 * ## 拆成"纯决策 + 薄执行"两半的理由
 *
 * `decideAutoSwitch()` 不碰库、不碰磁盘、不碰桥接，所以三档 `autoSwitchBehavior`
 * 是不是**真的被读了**、冷却是不是**只在真切换时写**，都能直接用例钉住。
 * 这两条都不是"看着像就完事"的东西：
 *
 *  - `autoSwitchBehavior` 从 M1 起就是个**死设置**（默认值和类型都在，全仓库没人读）；
 *  - 冷却时间戳如果按"每次检测都写"实现，一次 skip 就会把后面 5 分钟内的真实切换全吞掉
 *    —— 和 M5-A 那个 Tick 死锁是同一类错误（副作用改变了后续守卫的判断条件）。
 *
 * ## 冷却为什么落库而不是放内存
 *
 * 放内存的症状是"每次重启 A 都立刻弹一次横幅"，而重启 A 是常态。
 * 所以 `project.last_auto_switch_at`（V6）只在 `action === 'switch'` 时写。
 */
import log from 'electron-log'
import { AUTO_SWITCH_COOLDOWN_MS } from '../../shared/constants'
import { namesOf, matchProject, type MatchEvidence, type MatchOutcome, type MatchableCollection, type ProjectFingerprint } from '../../shared/projectMatch'
import type { AutoSwitchEvent } from '../../shared/types'

/** 决策的输入。全部是"已经查好的事实"，本函数不去查任何东西 */
export interface AutoSwitchInput {
  /** 设置项 `autoSwitchBehavior`：每次 / 仅当匹配到集合 / 从不 */
  behavior: 'always' | 'when_matched' | 'never'
  cooldownMs: number
  now: number
  /** 上次**真的切换**的时刻（skip 不算）。NULL = 从没切过 */
  lastAutoSwitchAt: number | null
  /** `matchProject()` 的结论 */
  outcome: MatchOutcome
}

export type AutoSwitchAction =
  /** 切集合（唯一该写冷却的一支） */
  | { action: 'switch'; collectionId: string; collectionName: string; reason: 'switched'; evidence: MatchEvidence }
  /** 没匹配上但用户要"每次都弹"：只唤醒窗口，不动视图 */
  | { action: 'wake-only'; reason: 'no-match-always' }
  | { action: 'skip'; reason: AutoSwitchSkipReason; names?: string; evidence?: MatchEvidence[] }

export type AutoSwitchSkipReason = 'never' | 'cooldown' | 'none' | 'ambiguous'

/**
 * 决策表（顺序有意义，别重排）：
 *
 *  1. `never` → 什么都不做（连指纹都不用采）；
 *  2. 冷却中 → skip，**不写时间戳**（写了就会把下一次真实切换也吞掉 —— 隐患 B）；
 *  3. 匹配唯一命中 → 切；
 *  4. 平手 → 不切，但把候选名单带回去（Q1 的"留痕"）；
 *  5. 没命中 → `always` 才弹窗，`when_matched` 就安静（§4.3 默认档）。
 */
export function decideAutoSwitch(input: AutoSwitchInput): AutoSwitchAction {
  if (input.behavior === 'never') return { action: 'skip', reason: 'never' }

  const last = input.lastAutoSwitchAt
  if (last !== null && input.now - last < input.cooldownMs) {
    return { action: 'skip', reason: 'cooldown' }
  }

  const o = input.outcome
  if (o.kind === 'hit') {
    return {
      action: 'switch',
      collectionId: o.evidence.collectionId,
      collectionName: o.evidence.collectionName,
      reason: 'switched',
      evidence: o.evidence
    }
  }
  if (o.kind === 'ambiguous') {
    /** 留痕：日志与横幅都要能说出"有 N 个集合同时命中，未自动切换"以及是谁 */
    return { action: 'skip', reason: 'ambiguous', names: namesOf(o.evidence), evidence: o.evidence }
  }
  if (input.behavior === 'always') return { action: 'wake-only', reason: 'no-match-always' }
  return { action: 'skip', reason: 'none' }
}

/** 执行侧要用的依赖（全部注入，测试里给假的） */
export interface AutoSwitchDeps {
  /** 当前设置里的 `autoSwitchBehavior`。**每次决策都重新读**，不许启动时读一次缓存住 */
  behavior: () => 'always' | 'when_matched' | 'never'
  /** 这个工程上次真的切换的时刻（库里读的） */
  lastAutoSwitchAt: (projectId: string) => number | null
  /** 记上"这次真的切了"。只在 `switch` 那一支被调用 */
  markSwitched: (projectId: string, at: number) => void
  /** 采指纹（含落库）。测试里给一个固定指纹 */
  fingerprint: (projectId: string, projectPath: string) => Promise<ProjectFingerprint>
  /** 参与匹配的集合（`collection` 表 + `rule_json`） */
  collections: () => MatchableCollection[]
  /** 所有已知工程的指纹 —— 通用词闸门用。给空数组等于不开那道闸 */
  knownProjects: () => ProjectFingerprint[]
  /** 通知界面（切视图 / 弹横幅 / 只更新顶栏） */
  notify: (event: AutoSwitchEvent) => void
  now?: () => number
  cooldownMs?: number
}

export interface StartedProject {
  id: string
  path: string
  name: string
}

/**
 * 一个工程"刚被检测到打开了"。
 *
 * 三条纪律：
 *  - **永不抛错**：这一步在每 3 秒的轮询里跑，抛一次就会污染整条工程发现链；
 *  - **冷却只在真切换时写**（见 `decideAutoSwitch`）；
 *  - **每一次决策都留一行日志**，包括 skip —— 否则"为什么不切"只能靠猜。
 */
export function createAutoSwitcher(deps: AutoSwitchDeps): {
  onProjectStarted: (p: StartedProject) => Promise<AutoSwitchAction>
} {
  const now = deps.now ?? Date.now
  const cooldownMs = deps.cooldownMs ?? AUTO_SWITCH_COOLDOWN_MS

  async function onProjectStarted(p: StartedProject): Promise<AutoSwitchAction> {
    const t = now()
    let decision: AutoSwitchAction
    try {
      /** `never` 这一档连盘都不读：设置说"从不"，就不该有任何副作用 */
      if (deps.behavior() === 'never') {
        decision = { action: 'skip', reason: 'never' }
      } else {
        const fp = await deps.fingerprint(p.id, p.path)
        const outcome = matchOutcomeOf(fp, p.path, deps)
        decision = decideAutoSwitch({
          behavior: deps.behavior(),
          cooldownMs,
          now: t,
          lastAutoSwitchAt: deps.lastAutoSwitchAt(p.id),
          outcome
        })
      }
    } catch (e) {
      log.warn(`[auto-switch] ${p.name} 决策失败（不影响工程发现）：${String((e as Error)?.message ?? e)}`)
      return { action: 'skip', reason: 'none' }
    }

    if (decision.action === 'switch') deps.markSwitched(p.id, t)
    logDecision(p, decision, t)
    deps.notify({
      projectId: p.id,
      projectPath: p.path,
      projectName: p.name,
      action: decision.action,
      reason: decision.reason,
      collectionId: decision.action === 'switch' ? decision.collectionId : null,
      collectionName: decision.action === 'switch' ? decision.collectionName : null,
      /** 平手时的候选名单（Q1 留痕），界面拿它画"有 N 个集合同时命中" */
      candidates: decision.action === 'skip' && decision.names ? decision.names.split('、') : [],
      at: t
    })
    return decision
  }

  return { onProjectStarted }
}

function matchOutcomeOf(fp: ProjectFingerprint, projectPath: string, deps: AutoSwitchDeps): MatchOutcome {
  return matchProject(fp, deps.collections(), { projectPath, knownProjects: deps.knownProjects() })
}

/** 每一次决策都留一行：`switch` 说凭什么，`skip` 说为什么没切（Q1 的另一半留痕） */
function logDecision(p: StartedProject, d: AutoSwitchAction, at: number): void {
  if (d.action === 'switch') {
    log.info(
      `[auto-switch] ${p.name} → 切到「${d.collectionName}」（${d.evidence.via === 'projectPath' ? '记住过这个工程' : `关键词 ${d.evidence.keyword}，命中 ${d.evidence.hits} 项`}）`
    )
  } else if (d.action === 'wake-only') {
    log.info(`[auto-switch] ${p.name} 没匹配到集合，但"每次都弹"开着 → 只唤醒窗口`)
  } else {
    const extra = d.reason === 'ambiguous' ? `：同时命中 ${d.names}` : d.reason === 'cooldown' ? '（5 分钟内已切过一次）' : ''
    log.info(`[auto-switch] ${p.name} 未自动切换 —— ${d.reason}${extra}`)
  }
  void at
}
