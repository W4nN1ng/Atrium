/**
 * M6 ⑤ · 顶部横幅的"该画什么"（**纯函数**）
 *
 * 和 `backfillState.ts` 同一个理由：渲染层零 DOM 测试，所以横幅的分支判断
 * （该不该出现、什么颜色、哪句话、几个按钮、点完之后还剩什么）全部算在这里，
 * 组件只剩 state → 节点映射。⑥ 的"10 秒淡出/固定"也只是把 `pinned` 传进来。
 *
 * ## 规格口径（第 3 份 §4.3 步骤 3 + §8-9/10/11）
 *
 * ```
 * 已识别为「Shinano」项目 · 自动打开 Shinano 集合
 * [不是这个集合 ▾]  [以后都这样]  [这次忽略]
 * ```
 * 「10 秒后自动淡出，可固定」；无匹配集合时**不自动切换、只更新顶栏**（§8-11）。
 *
 * ## 为什么 `cooldown` / `never` 要在这里明确画成"不出现"
 *
 * 主进程每次边沿都会发事件（包括 skip —— 留痕要求）。如果界面把 skip 也一律画出来，
 * 用户每 5 分钟就会被弹一次"我没切"，那正是防打扰规则要避免的事。
 * 所以"哪些事件值得占一条横幅"是**这里**的判据，不是组件里的 `if`。
 */
import type { AutoSwitchEvent } from './types'

export interface BannerCollection {
  id: string
  name: string
}

export interface BannerInput {
  /** 主进程发来的决策（null = 没有） */
  event: AutoSwitchEvent | null
  /** 用户当前搜索框里的字（R-46/R-52：一个字都不许清，只能叠加说明） */
  search: string
  /** 用户点了"固定" */
  pinned: boolean
  /** 本次运行内被"这次忽略"过的工程 id */
  ignoredProjects: string[]
  /** 除命中那个之外的集合（"不是这个集合"下拉） */
  otherCollections: BannerCollection[]
}

export type BannerButton = 'not-this' | 'switch-now' | 'remember' | 'ignore' | 'pin' | 'choose'

export type BannerRenderState =
  | { shown: false }
  | {
      shown: true
      tone: 'ok' | 'warn' | 'info'
      titleKey: string
      titleParams: Record<string, string | number>
      /** 第二句（为什么没切 / 仍在搜索什么）。没有就不画 */
      bodyKey: string | null
      bodyParams: Record<string, string | number> | null
      buttons: BannerButton[]
      /** 下拉里可选的集合 */
      choices: BannerCollection[]
      /** 自动淡出：固定之后不淡 */
      autoHide: boolean
    }

/** 这些 skip 原因不值得打扰用户（cooldown / never 都是"本来就不该动"） */
const SILENT_REASONS = new Set(['cooldown', 'never'])

export function bannerRenderState(input: BannerInput): BannerRenderState {
  const e = input.event
  if (!e) return { shown: false }
  if (input.ignoredProjects.includes(e.projectId)) return { shown: false }
  if (e.action === 'skip' && SILENT_REASONS.has(e.reason)) return { shown: false }

  /** R-52：切视图不许清空搜索框。搜索框非空时多画一句"仍在搜索「…」」"，
   *  否则用户看到的是"列表突然变空"，会以为搜索词被吃了 */
  const keepQuery = input.search.trim()
  const queryNote = keepQuery ? { key: 'project.bannerStillSearching', params: { q: keepQuery } } : null

  if (e.action === 'switch') {
    return {
      shown: true,
      tone: 'ok',
      titleKey: 'project.bannerSwitched',
      titleParams: { project: e.projectName, collection: e.collectionName ?? '' },
      bodyKey: queryNote ? queryNote.key : null,
      bodyParams: queryNote ? queryNote.params : null,
      buttons: ['not-this', 'remember', 'pin', 'ignore'],
      choices: input.otherCollections,
      autoHide: !input.pinned
    }
  }
  if (e.reason === 'busy') {
    /**
     * R-51：命中了集合，但用户正忙（有模态框开着 / 正在拖文件 / 导入在跑）。
     * 不切视图，但**必须说一声并给一个"现在切"** —— 什么都不显示的症状是
     * "A 明明检测到了却没反应"，谁也猜不到是被防打扰规则拦下了。
     */
    return {
      shown: true,
      tone: 'info',
      titleKey: 'project.bannerDeferred',
      titleParams: { project: e.projectName, collection: e.collectionName ?? '' },
      bodyKey: 'project.bannerDeferredHint',
      bodyParams: null,
      buttons: ['switch-now', 'remember', 'ignore'],
      choices: input.otherCollections,
      autoHide: !input.pinned
    }
  }
  if (e.reason === 'ambiguous') {
    /** Q1 的留痕：不切，但要把"是哪几个在抢"说出来，否则用户只能猜 */
    return {
      shown: true,
      tone: 'warn',
      titleKey: 'project.bannerAmbiguous',
      titleParams: { project: e.projectName, count: e.candidates.length, names: e.candidates.join('、') },
      bodyKey: 'project.bannerAmbiguousHint',
      bodyParams: null,
      buttons: ['choose', 'ignore'],
      choices: input.otherCollections,
      autoHide: !input.pinned
    }
  }
  /** wake-only（behavior=always 且没匹配上）：只报一句"没匹配到集合"，不给"以后都这样" */
  return {
    shown: true,
    tone: 'info',
    titleKey: 'project.bannerNoMatch',
    titleParams: { project: e.projectName },
    bodyKey: queryNote ? queryNote.key : null,
    bodyParams: queryNote ? queryNote.params : null,
    buttons: ['choose', 'ignore'],
    choices: input.otherCollections,
    autoHide: !input.pinned
  }
}

/** 横幅出现多久之后自动淡出（规格："10 秒后自动淡出"） */
export const BANNER_AUTO_HIDE_MS = 10_000

/**
 * M6 ⑥（Q3 裁定）：那条"要不要开机常驻托盘"的应用内提示该不该出现。
 *
 * 规格 §4.3 要"开机自启默认开启"。代码故意保持 `autoLaunch: false` ——
 * 程序不该擅自往用户的登录启动项里写东西。折中是**应用内问一次**：
 *  1. 他还没被问过；
 *  2. 当前没开自启；
 *  3. 而且**真的发生过一次"检测到 Unity 启动"**（没遇到过就没必要提）。
 * 点"好"才会去写启动项（走 `settings.set` 那条既有的路），点"不用"就永远不再问。
 */
export function shouldAskAutoLaunch(input: {
  autoLaunch: boolean
  alreadyAsked: boolean
  sawUnityStart: boolean
}): boolean {
  return !input.autoLaunch && !input.alreadyAsked && input.sawUnityStart
}
