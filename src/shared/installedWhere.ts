/**
 * R4 ⑥ · 「在哪些工程装过」那块界面的判据。
 *
 * ## 为什么空列表也要画出来
 *
 * 后端查的是 `import_log`，所以"没记录"有两种完全不同的意思：
 *  1. 这件素材从来没通过 A 导进任何工程；
 *  2. 用户自己在 Unity 里右键 Import 过 —— 桥接不认识那次，日志里就是没有。
 * 空的时候整块不显示，用户读到的是"没装过"，而真相是"A 不知道"。
 * 所以：**空列表照样画，并把这句限制写在界面上**（规格 §7 反查那条点名要求过口径要可见）。
 */
import type { InstalledWhereRow } from './types'

export interface InstalledWhereLine {
  projectId: string
  name: string
  isCurrent: boolean
  known: boolean
  /** 时间未知（老数据没写完 finished_at）时不许显示成 1970 */
  hasTime: boolean
  at: number
  /** 成功导入过几个包（0 = 这行只是"导过又被退回"的历史） */
  packages: number
  /** 这一行的账：几个包 / 新建几个 / 覆盖几个 / 退回过几次 */
  chips: Array<{ key: string; params: Record<string, string | number> }>
}

export interface InstalledWhereState {
  /** 整块要不要画（永远画，除非详情还没加载出来） */
  show: boolean
  count: number
  lines: InstalledWhereLine[]
  /** 空列表时那句"没查到"的文案 key */
  emptyKey: string | null
  /** 口径说明（必须出现，不许只在大标题里暗示） */
  noteKeys: Array<{ key: string; params?: Record<string, string | number> }>
  /** 有"工程已从清单里消失"的行时额外说一句 */
  ghostKey: string | null
}

/**
 * @param rows 主进程给的原样数据（已按最后一次时间倒序）
 * @param currentProjectId 顶栏当前选的导入目标（可能为 null = 没选）
 */
export function installedWhereState(
  rows: InstalledWhereRow[] | null | undefined,
  currentProjectId: string | null
): InstalledWhereState {
  const list = Array.isArray(rows) ? rows : []
  const lines: InstalledWhereLine[] = list.map((r) => {
    /**
     * `packages = 0` 的那一行是"只被退回过"，再写一句「0 个包」就是噪音 ——
     * 让它直接读成「退回过 N 次」。
     */
    const chips: InstalledWhereLine['chips'] = []
    if (r.packages > 0) chips.push({ key: 'installed.packages', params: { count: r.packages } })
    if (r.created > 0) chips.push({ key: 'installed.created', params: { count: r.created } })
    if (r.overwritten > 0) chips.push({ key: 'installed.overwritten', params: { count: r.overwritten } })
    /** 退回过的次数单独一条：它不算"装过"，但发生过的事不许抹掉 */
    if (r.rolledBack > 0) chips.push({ key: 'installed.rolledBack', params: { count: r.rolledBack } })
    return {
      projectId: r.projectId,
      name: r.name,
      isCurrent: !!currentProjectId && r.projectId === currentProjectId,
      known: r.known,
      /** 老数据 `finished_at` 没写完 → 0。0 不许显示成 1970/1/1，那是把缺数据说成一个日期 */
      hasTime: r.at > 0,
      at: r.at,
      packages: r.packages,
      chips
    }
  })
  const noteKeys: Array<{ key: string; params?: Record<string, string | number> }> = [{ key: 'installed.noteLogOnly' }]
  return {
    show: true,
    /**
     * 标题那句「在哪些工程装过（N）」数的**只算真装过的**（packages>0）。
     * 列表里可能还挂着"导过但被 A 退回"的工程 —— 那是历史，不能算进"装过"的数，
     * 但也不许抹掉：用户点过整批退回之后想知道的恰恰是"那次有没有真的清干净"。
     */
    count: lines.filter((l) => l.packages > 0).length,
    lines,
    emptyKey: lines.length ? null : 'installed.empty',
    noteKeys,
    ghostKey: lines.some((l) => !l.known) ? 'installed.ghost' : null
  }
}
