/**
 * 「这个素材导进 Unity 以后叫什么」—— 只回答这一件事。
 *
 * 名字不是猜的：`.unitypackage` 里每个文件都带真实落点路径（`Assets/xxx/...`），
 * 预检阶段已经整包解析过一遍（`PreflightResult.paths`），Unity 的 ImportPackage
 * 就是按这些路径落的盘。所以取路径的**一级目录名**，就是用户在 Project 窗口里看到的那个文件夹。
 *
 * 三条铁律（用户明确要求，别加东西）：
 *  1. 只记成功的导入；失败/取消/撤销的不记。
 *  2. 只保留最近 100 条，超出丢最旧。
 *  3. 清空只清这张表，**不碰 `import_log`**（那个是撤销功能的地基）。
 */

export const MAX_IMPORT_NAME_HISTORY = 100

export interface ImportNameEntry {
  id: string
  /** 导入完成时间（ms） */
  at: number
  /** 库里那张卡叫什么 */
  assetName: string
  /** 导进哪个工程（工程名，不是路径） */
  projectName: string
  /** 在 Unity 里出现的一级目录名（通常只有 1 个） */
  names: string[]
}

/** `Assets/shinano Candy/Prefab/x.prefab` → `shinano Candy`；`Assets/foo.mat` → `foo` */
export function topLevelNames(paths: Iterable<string>, folderPaths: Iterable<string> = []): string[] {
  const normalize = (raw: string): string => raw.trim().replace(/\\/g, '/').replace(/^\.\//, '')
  // 先收齐：folder 条目可能比它的子项先出现，Map.values() 也只能消费一次。
  const normalized = Array.from(paths).filter((raw) => typeof raw === 'string').map(normalize)
  const folders = new Set(Array.from(folderPaths, (raw) => normalize(raw).replace(/\/+$/, '').toLowerCase()))
  for (const path of normalized) {
    const match = /^(assets\/[^/]+)\//i.exec(path)
    if (match) folders.add(match[1].toLowerCase())
  }
  const out: string[] = []
  const seen = new Set<string>()
  for (const path of normalized) {
    const m = /^assets\/([^/]+)(\/|$)/i.exec(path)
    if (!m) continue
    let name = m[1].trim()
    if (m[2] === '' && !folders.has(path.toLowerCase())) name = name.replace(/\.[^.]+$/, '')
    if (!name || seen.has(name)) continue
    seen.add(name)
    out.push(name)
  }
  return out
}

/** 新的在最前；超出 cap 丢最旧的（数组尾部） */
export function pushImportName(
  list: ImportNameEntry[],
  entry: ImportNameEntry,
  cap: number = MAX_IMPORT_NAME_HISTORY
): ImportNameEntry[] {
  const next = [entry, ...list.filter((item) => item && item.id !== entry.id)]
  return next.slice(0, Math.max(0, cap))
}

/** 脏数据不崩：形状不对的行直接丢，不因为一条坏记录把整页弄白 */
export function parseImportNameHistory(raw: unknown): ImportNameEntry[] {
  if (!Array.isArray(raw)) return []
  const out: ImportNameEntry[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const row = item as Record<string, unknown>
    if (typeof row.id !== 'string' || typeof row.assetName !== 'string') continue
    if (!Array.isArray(row.names)) continue
    const names = row.names.filter((n): n is string => typeof n === 'string')
    if (!names.length) continue
    out.push({
      id: row.id,
      at: typeof row.at === 'number' && Number.isFinite(row.at) ? row.at : 0,
      assetName: row.assetName,
      projectName: typeof row.projectName === 'string' ? row.projectName : '',
      names
    })
  }
  return out.slice(0, MAX_IMPORT_NAME_HISTORY)
}
