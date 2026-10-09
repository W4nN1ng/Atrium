import fs from 'node:fs'
import path from 'node:path'
import log from 'electron-log'
import { normalizeDirKey } from '../../shared/pathkey'

/**
 * **抽取根目录**：从压缩包型容器里抽出来的 `.unitypackage` 临时副本落在这里。
 *
 * 为什么非要单独一个模块、而不是复用 `staging/`：
 *  - `staging/` 在 `%APPDATA%\A` 下，也就是 **C 盘**；而本机 C 盘实测只剩 12.0 GB，
 *    内层包单个就有 653 MB（真库实测 `TS_MaterialPack_1`），一次批量导八个就是把系统盘写满。
 *  - 生命周期也不同：staging 属于"摄取"（还没进库的东西），这里属于"导入"（已经入库、
 *    只是要从容器里取一个成员出来给 Unity）。混在一起，两边的清理规则会互相踩。
 *
 * 三条硬规矩，全部可测（`tests/import/extract-root.spec.ts`）：
 *  1. **不得落在库根之内** —— 往 `E:\vrc\A` 里塞临时文件，会被游离扫描报成"没登记的素材"，
 *     用户点一次「重新登记」就把几百个临时副本登记进库。这是真的会造成损失的失败模式。
 *  2. **不得落在 C 盘** —— 见上。
 *  3. **动手前先量剩余空间** —— 宁可不开工，也不要解到一半把盘写爆。
 */

/** 默认目录名：库根的**兄弟**目录（`E:\vrc\A` → `E:\vrc\A__extract`） */
export const EXTRACT_DIR_NAME = 'A__extract'
/** 最少留 2 GB 余量：抽取本身要空间，Unity 导入过程也要 */
export const EXTRACT_MIN_FREE = 2 * 1024 * 1024 * 1024

/** 界面按 key 出文案，主进程不许回中文（项目铁律） */
export class ExtractRootError extends Error {
  constructor(
    readonly key: string,
    readonly params: Record<string, unknown> = {}
  ) {
    super(key)
    this.name = 'ExtractRootError'
  }
}

/**
 * 剥掉 Windows 的命名空间前缀：`\\?\C:\x`、`\\.\C:\x`、`//?/C:/x` 说的都是 **C 盘**。
 *
 * 这条不是洁癖，是实测出来的洞：本来的 `driveOf` 只看开头有没有 `X:`，
 * 于是 `\\?\C:\Users\...\Temp` 判出"没有盘符"→ 放行，而这个路径**真的能写**
 * （`tools/probe-drive-forms.cjs`：mkdir 成功、existsSync 为真）。
 * "抽取目录绝不落 C 盘"是红线，一个陌生写法不能让它失效。
 * 同理，"不许落在库根之内"那条比的是字符串前缀，不剥前缀就会让
 * `\\?\E:\vrc\A\ex` 绕过"不在库内"的判断。
 */
function stripNamespace(p: string): string {
  return p.replace(/^[\\/]{2}[?.][\\/]/, '')
}

/** 比较用的目录键：剥命名空间前缀 + 统一斜杠 + 去尾斜杠 + 小写 */
function keyFor(p: string): string {
  return (normalizeDirKey(stripNamespace(p).replace(/[\\/]+$/, '')) ?? '').toLowerCase()
}

function driveOf(p: string): string {
  const m = /^([a-zA-Z]):/.exec(stripNamespace(p).replace(/\\/g, '/'))
  return m ? m[1].toLowerCase() : ''
}

/**
 * 闸门要用的**磁盘事实**。两个都是"读盘"的动作，所以一起注入；
 * **规则本身不可注入** —— 可注入的规则等于没有规则。
 *
 * 为什么要能注入：
 *  - `freeBytes`：这台机器上"C 盘以外、又不是库根"的盘只有 E 盘，拿真盘做断言
 *    就成了"换台机器就红/假绿"的用例。
 *  - `driveOf`：单测的临时目录天生在 C 盘（`%TEMP%`），而 C 盘正是这道闸门要拒的盘。
 *    不给注入，"抽 → 导 → 清"这条**正向**链路就没法在离线用例里跑完
 *    （只能跑"拒绝"那半边）。生产调用方一个都不传，行为与注入前完全一致。
 */
export interface DiskFacts {
  freeBytes: (p: string) => number
  driveOf: (p: string) => string
}

/** 从某个路径推默认抽取根：同盘的兄弟目录，不带任何"猜库在哪"的成分 */
export function defaultExtractRoot(fromPath: string): string | null {
  const norm = fromPath.replace(/[\\/]+$/, '')
  if (!norm) return null
  const parent = path.dirname(norm)
  if (!parent || parent === norm) return null
  return path.join(parent, EXTRACT_DIR_NAME)
}

/**
 * 决定用哪个抽取根。**不做任何创建**（创建留给 allocMemberDir），
 * 因为解析失败时界面上要能说清楚，而不该顺手在盘上留个空目录。
 *
 * @param settingsValue 设置项 `extractRoot`，空串 = 让用户不管、由库根推
 * @param libraryRoot   库根（推默认值用，也是"不许在库内"那条检查的参照）
 */
export function resolveExtractRoot(settingsValue: string | null | undefined, libraryRoot: string | null | undefined): string {
  const custom = (settingsValue ?? '').trim()
  if (custom) return custom.replace(/[\\/]+$/, '')
  const lib = (libraryRoot ?? '').trim()
  if (!lib) {
    throw new ExtractRootError('err.extractNoLibrary', { hint: EXTRACT_DIR_NAME })
  }
  const d = defaultExtractRoot(lib)
  if (!d) throw new ExtractRootError('err.extractNoRoot', { libraryRoot: lib })
  return d
}

/** 盘上剩余空间（用户可用）；拿不到就返回 -1，调用方按"未知"处理 */
export function freeBytesOf(p: string): number {
  try {
    const s = fs.statfsSync(p)
    return s.bsize * s.bavail
  } catch {
    return -1
  }
}

/** 真盘读数。生产路径上闸门用的就是这一份 */
const REAL_DISK: DiskFacts = { freeBytes: freeBytesOf, driveOf }

/**
 * 三道检查一次做完，返回实际可用字节。
 * 空间闸门的口径：**至少要 `max(needBytes × 2, 2 GB)`** ——
 * 抽出来的副本之后 Unity 还要在自己那边写一批文件，一倍余量不算多。
 *
 * 第四个参数 `disk` 只换**读数**、不换**规则**（理由见 `DiskFacts` 的注释）。
 */
export function assertExtractRootUsable(
  extractRoot: string,
  libraryRoot: string | null | undefined,
  needBytes = 0,
  disk: Partial<DiskFacts> = {}
): number {
  const facts: DiskFacts = { ...REAL_DISK, ...disk }
  const root = keyFor(extractRoot)
  const lib = keyFor((libraryRoot ?? '').trim())
  if (!root) throw new ExtractRootError('err.extractNoRoot')
  /** 比较的是**剥掉命名空间前缀**的键 —— 否则 `\\?\E:\vrc\A\ex` 能从"不在库内"这一关溜过去 */
  if (lib && (root === lib || root.startsWith(lib + '/'))) {
    throw new ExtractRootError('err.extractInsideLibrary', { extractRoot, libraryRoot: libraryRoot ?? '' })
  }
  if (facts.driveOf(root) === 'c') throw new ExtractRootError('err.extractOnSystemDrive', { extractRoot })
  const free = facts.freeBytes(path.parse(stripNamespace(extractRoot)).root || extractRoot)
  const floor = Math.max(needBytes * 2, EXTRACT_MIN_FREE)
  if (free < 0) {
    /** 量不到空间不拦路（有些盘/网络路径就是读不到），但要能继续干活 */
    return free
  }
  if (free < floor) {
    throw new ExtractRootError('err.extractNoSpace', {
      freeGB: +(free / 1073741824).toFixed(1),
      needGB: +(floor / 1073741824).toFixed(1)
    })
  }
  return free
}

/**
 * 分配一个成员目录：`<root>\<assetId>\<seq>\`
 *
 * `<seq>` 用调用方传进来的字符串（一般是数组下标或 ULID）：
 * 同一次批量里两个包同名也不会在同一个目录里互相覆盖 ——
 * 真库里"两个不同目录里都叫 `PSD.zip`"是真实存在的（甲轨那份探针量过）。
 */
export async function allocMemberDir(extractRoot: string, assetId: string, seq: string | number): Promise<string> {
  const dir = path.join(extractRoot, String(assetId), String(seq))
  await fs.promises.mkdir(dir, { recursive: true })
  return dir
}

/**
 * 释放：只删 `<seq>` 这一层，不动 `<assetId>` 目录本身 ——
 * 同一素材并发的两个任务共用父目录，删父目录会把对方抽走。
 *
 * `mustBeUnder` 是**必填**的抽取根，这是一道"删错东西"的闸门，不是装饰：
 * 传进来的路径不在这棵子树里（或者它就是根本身）→ 拒绝，返回 false。
 * 为什么非要调用方传：这个函数旁边就是**用户素材的真实路径** ——
 * 目录型容器的成员直接指向库里那个 `.unitypackage`，一旦哪条分支把
 * "抽出来的副本路径"和"磁盘原路径"传混了，被删掉的就是用户 25 GB 库里的原件，
 * 而导入本身还会报成功（文件是导完才删的）。那种事故不该靠调用方自觉。
 */
export async function releaseMemberDir(dir: string, mustBeUnder: string): Promise<boolean> {
  const target = normalizeDirKey(dir)
  const root = normalizeDirKey(mustBeUnder)
  if (!target || !root || !isInsideDir(target, root)) {
    log.warn(`[extract] 拒绝删除抽取根之外的目录：${dir}（根=${mustBeUnder}）`)
    return false
  }
  try {
    await fs.promises.rm(dir, { recursive: true, force: true })
    return true
  } catch {
    /**
     * 删不掉**不许影响导入结论**：文件已经导完了，这只是垃圾没清干净。
     * 留在原地等启动 prune（第 2 层）或手动清理（设置 → 维护）捞。
     */
    return false
  }
}

/** `p` 在 `root` 这棵子树**里面**（不含 root 自身）。两边都是 dir-key 口径 */
export function isInsideDir(p: string | null | undefined, root: string | null | undefined): boolean {
  const a = normalizeDirKey(p)
  const b = normalizeDirKey(root)
  if (!a || !b) return false
  return a.startsWith(b + '/')
}

/**
 * 清扫整个抽取根（启动时调，和 `pruneStaging()` 一个套路：
 * 任务表是内存态、不跨重启，所以开机时这里剩下的必是垃圾）。
 * 只删一层 `<assetId>` 目录，删除失败就留着下次。
 *
 * `skip` 给"手动清理"用（设置 → 维护）：那时内存里可能还挂着一批
 * 等用户点确认的副本，删了它按下"导入"就是"找不到这个 .unitypackage"。
 * 启动时不传 —— 那时候不可能有在途批次。
 */
export async function pruneExtractRoot(
  extractRoot: string,
  skip?: (topLevelName: string) => boolean
): Promise<{ removed: number; kept: number; bytes: number }> {
  let names: string[] = []
  try {
    names = await fs.promises.readdir(extractRoot)
  } catch {
    return { removed: 0, kept: 0, bytes: 0 }
  }
  let removed = 0
  let kept = 0
  let bytes = 0
  for (const n of names) {
    if (skip?.(n)) {
      kept++
      continue
    }
    const full = path.join(extractRoot, n)
    try {
      bytes += sizeOfTree(full)
      await fs.promises.rm(full, { recursive: true, force: true })
      removed++
    } catch {
      kept++
    }
  }
  return { removed, kept, bytes }
}

/** 目录占用（算给界面看，"这里还压着 N MB"）。**要递归** —— 实际结构是 <root>/<asset>/<seq>/文件 */
export function sizeOfTree(p: string): number {
  let st: fs.Stats
  try {
    st = fs.statSync(p)
  } catch {
    return 0
  }
  if (st.isFile()) return st.size
  let total = 0
  let ents: fs.Dirent[]
  try {
    ents = fs.readdirSync(p, { withFileTypes: true })
  } catch {
    return 0
  }
  for (const e of ents) {
    const full = path.join(p, e.name)
    if (e.isDirectory()) {
      // 不回递归就永远是 0：抽取目录天生是 <root>/<assetId>/<seq>/xxx 三层
      total += sizeOfTree(full)
      continue
    }
    try {
      total += fs.statSync(full).size
    } catch {
      /* 刚被删掉 */
    }
  }
  return total
}
