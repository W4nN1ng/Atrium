/**
 * 导入结果横幅上那句"备份"的话该怎么说 —— 判据收在这儿，界面只做映射。
 *
 * 为什么单独成一个文件（而不是留在 `ImportFlow.tsx` 里）：本仓库渲染层零 DOM 测试，
 * 判据写在 JSX 里就等于**没测**。真机踩过的那条正是这种：
 * 冲突框说"会覆盖 2 个已有文件"，导入前实际 `备份 0 个被覆盖文件`
 * （那两个文件在盘上根本不存在 —— 上一次撤销把它们删了，而 Unity 的资源库还记着 GUID），
 * 可横幅上照旧写着「被覆盖的文件已备份」。用户按下撤销才发现没有退路。
 *
 * 所以规则是：**只有真存下了文件才说"已备份"**，一个都没存下就说"没东西可备份"，
 * 不许用"备份目录建了"来代替"备份成功了"。
 */

export interface ImportResultLike {
  /** 备份目录（null = 这次压根没走备份那一步） */
  backupDir: string | null
  /** 备份目录里真存下了几个文件。老数据没这个字段 → 按"不知道"处理，宁可少说一句 */
  backupSaved?: number
}

/** 横幅上追加的那一句（i18n key + 参数）；null = 什么都不加 */
export function importResultNote(last: ImportResultLike | null | undefined): { key: string; params: Record<string, number> } | null {
  if (!last || !last.backupDir) return null
  const n = typeof last.backupSaved === 'number' ? last.backupSaved : -1
  if (n === 0) return { key: 'library.backedUpNothing', params: {} }
  if (n > 0) return { key: 'library.backedUpCount', params: { count: n } }
  /** 没带数字（老数据 / 别条路）：只说"备份目录在"，不承诺存下了几个 */
  return { key: 'library.backedUp', params: {} }
}
