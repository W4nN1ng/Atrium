/**
 * 路径 → "目录键"：归并组（asset_group.dir_key）用它回答一个问题 ——
 * **这两件东西是不是躺在同一个父容器里。**
 *
 * 为什么需要单独一个函数：库里同一层目录的写法有两套来源
 * （用户自己在资源管理器里建的、归档模板 `settings.dirTemplate` 生成的），
 * 分隔符和大小写都不一样（`E:\vrc\A\衣服` vs `E:/vrc/A/衣服`）。
 * Windows 路径本身大小写不敏感，所以比较前必须统一归一化，
 * 否则同一个目录会被判成两个，#40 的修复就白做了。
 *
 * 归一化三件事：反斜杠 → 正斜杠、去尾斜杠、整体小写。
 *
 * ⚠ 为什么这个文件在 `shared/` 而不是 `main/lib/`（2026-10-06 挪的）：
 * M6 的集合匹配（`shared/projectMatch.ts`）要拿它比对 `rule_json.projectPaths`
 * 与工程路径，而 shared 层不许 import main。同一个"路径怎么算同一个目录"的规则
 * 放两处实现必漂（M5-3 为这事犯过两次），所以整份搬到共享层。
 */
export function normalizeDirKey(p: string | null | undefined): string | null {
  if (!p) return null
  const norm = p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
  return norm || null
}

/**
 * 这一条**所在**的目录（永远是 dirname，不给目录型素材特殊待遇）。
 * 理由：归并组说的是"同一层货架上的兄弟"，压缩包 `.zip` 的货架是它的 dirname，
 * 解压出来的同名目录的货架也必须是同一个 dirname —— 否则 G6 那种
 * 「zip 和已解压目录并存」就会一个挂货架 A、一个挂货架 B，连想合都对不上话。
 */
export function dirKeyOf(p: string | null | undefined): string | null {
  const norm = normalizeDirKey(p)
  if (!norm) return null
  const i = norm.lastIndexOf('/')
  // `e:/vrc/a` 这种只剩盘符的，视为没有目录信息
  return i > 1 ? norm.slice(0, i) : null
}
