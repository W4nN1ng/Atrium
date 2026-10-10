/**
 * 「自动收拾历史遗留」的判据（第 9 轮 ⑥）。
 *
 * ## 为什么要单独一层
 *
 * ② 那次我把这件事做成了 `设置 → 维护 → 检查一遍 → 合并` 四步，他的原话是
 * 「为什么不自动合并还要自己手动，这样步骤长根本不适于普通人高效率的使用工具」。
 * 这条批评是对的，而且我原来的辩护站不住：我把"安全"寄托在**让用户多点一次确认**上，
 * 可这个操作真正的安全垫根本不是那一下点击 —— 它**一个文件都不搬、不改用户手调过的分类、
 * 不动置信度，而且 `Ctrl+Z` 一次整批退回**。有这三条，"先看看再决定"的净收益
 * 只是心理安慰，净成本却是每个普通用户都要先学会"归并组"是什么。
 *
 * 所以他 2026-10-10 拍的口径是：
 *  - **历史遗留 → 自动并完 + 事后告知**（告知不挡路，可看清单、可撤销、可关掉）；
 *  - **新入库的东西 → 保持现状**：入库那一刻就按现行规则归组，不弹任何东西。
 *
 * 本仓库零 DOM 测试，"这次到底该不该自动跑"这种判断必须落在 `shared/` 才有用例可钉。
 */
import { normalizeDirKey } from './pathkey'

/** 刹车那一列现在长什么样：时间戳 + 落它的时候是哪套库 */
export interface RemergeStamp {
  runAt: string | null
  /**
   * 第 10 轮 #112 补的那一列。
   * 老版本只记时刻，于是"换一套库"会被上一次的时间戳永久拦住 ——
   * 他要是把素材库整体搬到另一块盘，那套新库里的旧账就再也不会被自动收拾。
   */
  runRoot: string | null
}

/**
 * 「这台机器上已经自动收拾过了吗」—— **按库**判，不按机器判。
 *
 * 判据只有两条：
 *  - 没时间戳 → 没跑过；
 *  - 有时间戳且**是同一套库**（比归一化后的目录键，`E:\vrc\A` 与 `e:/vrc/a` 算同一套）→ 跑过，别再来一遍。
 *
 * `runRoot` 为空是老数据（那一版还没这一列）：维持"已跑过"，
 * 因为这条判据的用途是**刹车**，把它当"没跑过"就是给旧用户多跑一次写库的操作。
 * 反过来，换新库那种情形一定有非空的 `runRoot`，能正常松开。
 */
export function remergeAlreadyRun(stamp: RemergeStamp, currentRoot: string | null): boolean {
  if (!stamp.runAt) return false
  const ran = normalizeDirKey(stamp.runRoot)
  if (!ran) return true
  return ran === normalizeDirKey(currentRoot)
}

/** 「这次启动该不该去问主进程」所需的全部事实 */
export interface AutoRemergeGateInput {
  /** 这台机器 + **这套库**上已经自动收拾过一次了（由 `remergeAlreadyRun` 算出来） */
  alreadyRun: boolean
  /** 设置读回来了没有（没读回来时不能判，否则会抢在 boot 之前动库） */
  booted: boolean
  /** 库根配好了没有 —— 空库/还没配库时跑它毫无意义，还会在首启向导上叠一层 */
  libraryReady: boolean
  /** 首启向导还开着：那一刻用户连库都还没配完，别跟他抢注意力 */
  wizardOpen: boolean
  /** 小窗（拖放快捷入口）：它只负责收文件，不负责收拾库 */
  miniView: boolean
}

/**
 * 第一步：这次启动**要不要去问主进程**"库里有没有旧账"（问了才知道簇数）。
 *
 * 顺序是刻意的：`alreadyRun` 排第一 —— 这条是整个设计的**刹车**。
 * 没有它，用户手动撤销之后，下次开机程序会把同一批卡又并一遍，
 * 那就是"程序跟用户抢方向盘"，比原来的四步确认糟得多。
 */
export function shouldProbeAutoRemerge(i: AutoRemergeGateInput): boolean {
  if (i.alreadyRun) return false
  return i.booted && i.libraryReady && !i.wizardOpen && !i.miniView
}

/** 第二步：问回来了，要不要真的动库。0 簇就是没事可做，一行都不该写 */
export function shouldApplyAutoRemerge(clusters: number): boolean {
  return clusters > 0
}

/**
 * 告知条上那句话要填的数。
 *
 * ⚠ `moved` 是**执行结果**里"改挂了几张卡"，不是预览里"这几簇一共几张卡"。
 * 用后者的话，真库那个形状（20 张 / 13 组）会说成"帮你并了 20 张"，
 * 而用户界面上实际少掉的只有 12 张 —— 数字对不上，告知就成了误导。
 *
 * 两个数都不大于 0 时返回 null：**没有看得见的变化就不该打扰人**。
 * 唯一会走到这里的情形是"只修了归并键、一张卡都没挪"（`keyOnly`）——
 * 那次变更在界面上完全看不出来，弹条只会让人去找"哪里变了"。
 * 它照样记进操作账本，也照样能 Ctrl+Z，只是不告。
 */
export function noticeText(clusters: number, moved: number): { key: string; params: { clusters: number; moved: number } } | null {
  if (clusters <= 0 || moved <= 0) return null
  return { key: 'remerge.autoDone', params: { clusters, moved } }
}

/** 告知条展开后的每一行。`merged` = 并进来几张；`keyfix` = 卡没挪、只修了归并键 */
export interface RemergeNoticeLine {
  name: string
  key: 'remerge.autoLineMerged' | 'remerge.autoLineKeyfix'
  count: number
}

/**
 * 展开明细最多列几处。
 *
 * 上限是给"一条不挡路的告知"用的：库很大时这里可能几十上百簇，
 * 全列出来就变成第二个「检查一遍」面板，而那条路本来就是本轮要拆掉的。
 * 剩下的写明条数，并告诉他去哪本账里看全。
 */
export const NOTICE_DETAIL_MAX = 6

/**
 * 预览簇 → 告知条上的明细行。**组件里不许有判断**（本仓库的横幅都是这么做的），
 * 所以"先摆能看见的、只修键的沉底、超过 6 处折成一句"全在这里算完。
 */
export function noticeLines(clusters: Array<{ name: string; moved: number; rows: number }>): { lines: RemergeNoticeLine[]; more: number } {
  const sorted = [...clusters].sort((a, b) => Number(b.moved > 0) - Number(a.moved > 0) || b.moved - a.moved)
  const lines = sorted.map((c) =>
    c.moved > 0
      ? { name: c.name, key: 'remerge.autoLineMerged' as const, count: c.moved }
      : { name: c.name, key: 'remerge.autoLineKeyfix' as const, count: c.rows }
  )
  return { lines: lines.slice(0, NOTICE_DETAIL_MAX), more: Math.max(0, lines.length - NOTICE_DETAIL_MAX) }
}

/**
 * 告知条自己收起的时间。
 *
 * 12 秒不是 5 秒：这条消息里有"我动了我什么"和一个撤销入口，
 * 5 秒不够一个人把一句中文读完再想一下。它**不挡路**（不遮任何控件、不抢焦点），
 * 所以稍长一点没有代价；真不想理它，它自己会走。
 */
export const NOTICE_AUTO_DISMISS_MS = 12000
