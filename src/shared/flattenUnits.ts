/**
 * 筐摊平之后，**每件东西各自落在哪儿**（第 10 轮 C 的后半程）。
 *
 * ## 为什么这份文件存在
 *
 * `classify()` 把一个筐（`道具22件`）摊成 22 个单元，这一步单测早就绿了。
 * 活体却抓出后半程是断的：`ingest/api.ts` 的 `commit()` 原来只读
 * `res.classification.units[0]` —— 于是 22 件里只落了 1 行，而且那一行还被
 * "磁盘名优先"（D 那条）盖成了 `道具22件`。**用户看到的仍然是"一个筐一张卡"。**
 *
 * 所以登记那一步必须逐件走，而"这一件该登记成哪个源路径"是路径算术，
 * 放 `shared/` 才有用例可钉（本仓库零 DOM 测试，判据放主进程就测不到）。
 */
import type { AssetUnit } from './types'

/**
 * 这批单元是不是"摊平出来的筐"：
 * 没有合集树（`tree`）却有多个单元 —— 现阶段只有筐会走这条路。
 * 有树的情形由 `commitBundleAsset` 那条三级路径处理，不许混进来。
 */
export function isFlattenedBasket(units: readonly unknown[] | null | undefined, hasTree: boolean): boolean {
  if (hasTree) return false
  return Array.isArray(units) && units.length > 1
}

/** Windows 目录分隔符拼一段相对路径（不引 `node:path`，shared 层要能被渲染进程用） */
function joinRel(base: string, rel: string): string {
  /**
   * 两半都归一到反斜杠：`settings.libraryRoot` 里存的是正斜杠（用户从别处粘来的），
   * 而 `source_path` 别处都是反斜杠 —— 混着写虽然 Windows 认，但库里出现两种写法
   * 就是给以后的字符串比较埋雷（`normalizeDirKey` 那种坑已经踩过一次）。
   */
  const b = base.replace(/[\\/]+$/, '').replace(/\//g, '\\')
  const r = rel.replace(/^[\\/]+/, '').replace(/\//g, '\\')
  if (!r) return b
  return b + '\\' + r
}

/** 一段相对路径所在的目录（没有目录就返回空串） */
function relDirname(rel: string): string {
  const norm = rel.replace(/\//g, '\\')
  const i = norm.lastIndexOf('\\')
  return i < 0 ? '' : norm.slice(0, i)
}

/**
 * 这一件东西的源路径。
 *
 * 首选引擎标好的 `sourceRelPath`（`planBundle` 的项相对父目录的位置）；
 * 老数据/别的路径没标时退回"它的第一个文件所在目录" —— 两者都给不出时，
 * 只能用父任务那个目录本身（宁可登记得粗一点也不许丢件）。
 */
export function unitSourcePath(jobSourcePath: string, unit: Pick<AssetUnit, 'filePaths'> & { sourceRelPath?: string | null }): string {
  const rel = (unit.sourceRelPath ?? '').trim()
  if (rel) return joinRel(jobSourcePath, rel)
  const first = (unit.filePaths ?? []).find((p) => !!p && p.trim())
  if (first) {
    const dir = relDirname(first.trim())
    if (dir) return joinRel(jobSourcePath, dir)
  }
  /** 兜底也走一遍 `joinRel`：同一次登记里不许一半路径是正斜杠、一半是反斜杠 */
  return joinRel(jobSourcePath, '')
}

/** 这一件的原名（详情面板里"原名"那一行；拿不到就交给调用方兜底） */
export function unitRawName(unit: { sourceRelPath?: string | null }): string | null {
  const rel = (unit.sourceRelPath ?? '').trim()
  if (!rel) return null
  const parts = rel.replace(/\//g, '\\').split('\\').filter((x) => !!x)
  return parts.length ? parts[parts.length - 1] : null
}
