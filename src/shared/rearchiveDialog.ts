/**
 * R4 ③ · 「改分类要不要把文件也搬过去」确认框的**判据**。
 *
 * 和 `importQueue.ts` / `bannerState.ts` 同一个理由：vitest 跑在 node 环境、一个 DOM 都没有，
 * 所以凡是"该显示什么、该给哪几个按钮"的判断都必须从组件里挪到这里，组件只做映射。
 *
 * ## 这一轮唯一动磁盘的操作，默认值必须是"不搬"
 *
 * `canMove` 只在主进程预览明确说 `willMove=true` 时才为真，
 * 而 `moveIsDefault` 恒为 false —— 回车 / ESC 都不该触发搬 25 GB。
 * 预览失败（`ok=false`）时连"只改记录"都不给：那时候素材当前路径都没确认，
 * 让用户在信息不全的情况下点确认，等于替他决定。
 */
import type { RearchiveOutcome } from './types'

export interface RearchivePending {
  assetId: string
  category: string
  subcategory: string | null
  /** 界面上那两个 Select 的中文名，用来把标题拼成「材质 → 道具」这种看得懂的样式 */
  fromLabel: string
  toLabel: string
}

export interface RearchiveNote {
  key: string
  params?: Record<string, string | number>
}

export interface RearchiveDialogState {
  show: boolean
  /** 「搬过去」——只有预览说该搬、且路径确实认出来了才给 */
  canMove: boolean
  /** 「只改记录」（旧行为：卡片改了、文件留在原地） */
  canRecordOnly: boolean
  /** 预览结论是会搬（用来决定标题与那句"Ctrl+Z 能撤"） */
  willMove: boolean
  /** 键盘默认项：一律是取消，见文件头 */
  defaultKey: 'cancel'
  reasonKey: string | null
  reasonParams: Record<string, string | number> | null
  /** 会随计划变化的提醒行（撞名 / 连带几项 / 几条附属记录跟着改路径 / 预览失败） */
  notes: RearchiveNote[]
  fromDir: string | null
  toDir: string | null
  fileCount: number
  bytes: number
  /** 搬动条目数（>1 就是父目录之外还有子项要单独搬） */
  moveCount: number
  /** 会被改写路径的**其它**记录数（附属、子项） */
  rewriteCount: number
}

const IDLE: RearchiveDialogState = {
  show: false,
  canMove: false,
  canRecordOnly: false,
  willMove: false,
  defaultKey: 'cancel',
  reasonKey: null,
  reasonParams: null,
  notes: [],
  fromDir: null,
  toDir: null,
  fileCount: 0,
  bytes: 0,
  moveCount: 0,
  rewriteCount: 0
}

/** `reasonParams` 里的值必须是 `t()` 收得动的类型（契约上是 `unknown`） */
function params(p: Record<string, unknown> | null | undefined): Record<string, string | number> | null {
  if (!p) return null
  const out: Record<string, string | number> = {}
  for (const [k, v] of Object.entries(p)) out[k] = typeof v === 'number' ? v : String(v ?? '')
  return out
}

export function rearchiveDialogState(
  pending: RearchivePending | null,
  plan: RearchiveOutcome | null
): RearchiveDialogState {
  if (!pending || !plan) return IDLE
  const base: RearchiveDialogState = { ...IDLE, show: true }

  if (!plan.ok) {
    return {
      ...base,
      reasonKey: plan.reasonKey,
      reasonParams: params(plan.reasonParams),
      notes: [{ key: plan.reasonKey }]
    }
  }

  const notes: RearchiveNote[] = []
  if (!plan.willMove) {
    /** 不该搬：只给"只改记录"，并把原因写在第一行（不能让它看起来像搬成功了） */
    return {
      ...base,
      canRecordOnly: true,
      willMove: false,
      reasonKey: plan.reasonKey,
      reasonParams: params(plan.reasonParams),
      notes: plan.reasonKey ? [{ key: plan.reasonKey, params: params(plan.reasonParams) ?? undefined }] : []
    }
  }

  /** 目标位置已经有同名的东西：执行时会加 `(2)` 之类的后缀，目录名和预览里看到的不一样 */
  if (plan.moves.some((m) => m.taken)) notes.push({ key: 'rearchive.note.taken', params: { toDir: plan.toDir ?? '' } })
  if (plan.moves.length > 1) {
    notes.push({ key: 'rearchive.note.extraMoves', params: { count: plan.moves.length - 1 } })
  }
  /** 附属/子项只改库里的路径字符串（它们在被搬的那棵目录**里面**，跟着整棵走） */
  const others = new Set(plan.rewrites.filter((r) => r.assetId !== plan.assetId).map((r) => r.assetId))
  if (others.size) notes.push({ key: 'rearchive.note.rewrites', params: { count: others.size } })

  return {
    ...base,
    canMove: true,
    canRecordOnly: true,
    willMove: true,
    notes,
    fromDir: plan.fromDir,
    toDir: plan.toDir,
    fileCount: plan.fileCount,
    bytes: plan.bytes,
    moveCount: plan.moves.length,
    rewriteCount: others.size
  }
}
