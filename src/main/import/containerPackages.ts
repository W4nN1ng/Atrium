import fs from 'node:fs'
import path from 'node:path'
import { listMembers, NotAnArchiveError } from '../unpack/members'
import { PasswordNeededError } from '../unpack/sevenZip'
import { normalizeEntryPath } from '../unpack/encoding'
import { isJunkRelPath } from '../../shared/junk'

/**
 * **容器成员清单**（M5-B ③）：一张卡底下到底有几个 `.unitypackage`、分别在哪。
 *
 * 只做"列"，不做"抽" —— 抽取是 `unpack/members.extractMembers` 的事，
 * 而抽取必须由用户勾了之后才发生（设计文档 §3.4：默认不勾、单批 ≤8）。
 *
 * 三条封顶（设计文档 §3.3）：
 *
 * | 常量 | 值 | 依据 |
 * |---|---|---|
 * | `MEMBER_DEPTH_MAX` | 8 段 | 真库实测最深 7 段（`插件道具合集-初音的VRC小店`） |
 * | `MEMBER_SCAN_MAX` | 400 条 | 单个容器的成员硬闸 |
 * | `ARCHIVE_DEPTH_MAX` | 0（不钻子包） | 见下面 `walkDir` 的注释 |
 *
 * ⚠ 顺带修掉一个已经存在的静默少列：`coordinator.findPackages(dir, depth = 4)`
 * 在那个 87 个包的容器上只看得见 80 个（实测段数分布 1:1 2:3 3:22 4:18 5:36 6:4 7:3，
 * 看不见的是 6/7 段那 7 个）。而且撞线不吭声 —— 用户以为"库里没这个东西"。
 * 这里的规矩是：**撞线必须记账**（`capped` / `truncated`），界面要能说出来。
 */

export const MEMBER_DEPTH_MAX = 8
export const MEMBER_SCAN_MAX = 400
/**
 * 目录容器里发现子压缩包时往里钻几层。0 = 不钻，只记一笔 `nestedArchive`。
 *
 * 不是一刀切的保守，是量出来的：真库 77 张压缩包卡里"里面还有别的压缩包"的只有 3 张，
 * 而**用户要导的包一张都不在第二层里**（内层包全部位于"外层容器 → 一层同名目录 → 包"）。
 * 多钻一层的代价是：清单要起 N 个后端进程、空间与失败原因翻倍、
 * 而"用户点的这张卡到底包含了什么"这件事变得更难解释。
 */
export const ARCHIVE_DEPTH_MAX = 0

const PACKAGE_RE = /\.unitypackage$/i
const ARCHIVE_RE = /\.(zip|rar|7z|tar|gz|tgz|bz2|xz|zst)$/i

export interface ContainerLimits {
  depthMax: number
  scanMax: number
  archiveDepthMax: number
}

export const DEFAULT_LIMITS: ContainerLimits = {
  depthMax: MEMBER_DEPTH_MAX,
  scanMax: MEMBER_SCAN_MAX,
  archiveDepthMax: ARCHIVE_DEPTH_MAX
}

export interface ContainerMember {
  /** 相对容器根的**正斜杠**路径（压缩包成员也是这个口径） */
  relPath: string
  /** 体积；压缩包成员用清单报的解后大小 */
  sizeBytes: number
  /** 在哪个外层压缩包里（null = 就在磁盘上，不用抽） */
  originArchive: string | null
  /** 磁盘上的绝对路径；压缩包成员要抽出来之后才有，所以是 null */
  absPath: string | null
  /** 从容器根数过来的段数，界面用来标"藏在第几层" */
  depth: number
}

export type ListBlockKey =
  /** 包里还有压缩包，A 只处理一层 */
  | 'nestedArchive'
  /** 加密包，连清单都要密码 */
  | 'passwordNeeded'
  /** 列不出来（损坏 / 后端不支持） */
  | 'listFailed'

export interface ContainerListing {
  containerPath: string
  /** 磁盘事实：容器是目录还是压缩包。名字叫 .zip 的目录会被判成**目录**（P0-3） */
  isArchive: boolean
  members: ContainerMember[]
  /** 各撞了几次上限。全 0 就是"这份清单是完整的" */
  capped: { depth: number; count: number }
  /** 被跳过的东西 + 为什么，界面按 key 出文案 */
  blocked: Array<{ relPath: string; key: ListBlockKey; detail?: string }>
  /** 一共看了多少条目（不是"库里有多少"） */
  scannedEntries: number
  /** 有成员被上限挡在外面 */
  truncated: boolean
  /** 至少要一个密码才能读全 */
  needsPassword: boolean
  /** 列清单用的后端，排查"这台机器读不了 rar"用 */
  backend: string | null
}

export interface ListOptions {
  limits?: Partial<ContainerLimits>
  password?: string
  /** 自带后端目录（`resources/bin`）；不传会退到 7za，那条路读不了 RAR */
  extraBackendDirs?: string[]
  signal?: AbortSignal
}

function stats(p: string): fs.Stats | null {
  try {
    return fs.statSync(p)
  } catch {
    return null
  }
}

/** 相对容器根的段数（文件本身算最后一段） */
function segments(rel: string): number {
  return rel.split('/').filter(Boolean).length
}

/**
 * 入册的唯一入口 —— **两条来源（磁盘 / 压缩包清单）共用这一份上限判断**。
 *
 * 为什么要提成模块级而不是两处各写一个闭包：写成闭包时"数量上限"在两个分支里
 * 各出现一次，回退验证想撤掉它就得指定是哪一处；一处撤、一处留，
 * 测出来的就是"撤了也不红"的假绿。上限这种安全口径只应该有一份。
 */
function addMember(
  out: ContainerListing,
  lim: ContainerLimits,
  cand: { relPath: string; sizeBytes: number; originArchive: string | null; absPath: string | null }
): boolean {
  out.scannedEntries++
  if (out.members.length >= lim.scanMax) {
    out.capped.count++
    out.truncated = true
    return false
  }
  const rel = normalizeEntryPath(cand.relPath)
  const depth = segments(rel)
  if (depth > lim.depthMax) {
    out.capped.depth++
    out.truncated = true
    return false
  }
  out.members.push({ relPath: rel, sizeBytes: cand.sizeBytes, originArchive: cand.originArchive, absPath: cand.absPath, depth })
  return true
}

/**
 * 列一个容器（目录 或 压缩包）里能拿来导入的 `.unitypackage`。
 *
 * 永不抛：某个成员读不动只进 `blocked`，别把整份清单搞崩 ——
 * 用户看到的应该是"这个包里 12 个能导、1 个要密码"，不是"打不开"。
 */
export async function listContainerMembers(containerPath: string, opts: ListOptions = {}): Promise<ContainerListing> {
  const lim: ContainerLimits = { ...DEFAULT_LIMITS, ...(opts.limits ?? {}) }
  const out: ContainerListing = {
    containerPath,
    isArchive: false,
    members: [],
    capped: { depth: 0, count: 0 },
    blocked: [],
    scannedEntries: 0,
    truncated: false,
    needsPassword: false,
    backend: null
  }
  const st = stats(containerPath)
  if (!st) return out

  if (st.isDirectory()) {
    // 名字叫 .zip 的目录也走这一支 —— 真库实测有 2 个这种（P0-3）
    await walkDir(containerPath, containerPath, lim, out, opts, 0)
    return out
  }

  /** 是个文件：只可能是压缩包。单个 .png 素材之类会得到一份空清单，不算失败 */
  try {
    const list = await listMembers(containerPath, {
      password: opts.password,
      extraBackendDirs: opts.extraBackendDirs
    })
    out.isArchive = true
    out.backend = list.backend
    for (const e of list.entries) {
      if (e.isDir || isJunkRelPath(e.path)) continue
      if (!PACKAGE_RE.test(e.path)) {
        /** 看过但不是包 —— 也要计入"看了多少条"，否则界面写不出"看了 900 条、里面 1 个包" */
        out.scannedEntries++
        continue
      }
      addMember(out, lim, { relPath: e.path, sizeBytes: e.size, originArchive: containerPath, absPath: null })
    }
  } catch (e) {
    if (e instanceof PasswordNeededError) {
      out.needsPassword = true
      out.blocked.push({ relPath: path.basename(containerPath), key: 'passwordNeeded' })
      return out
    }
    if (!(e instanceof NotAnArchiveError)) {
      out.blocked.push({
        relPath: path.basename(containerPath),
        key: 'listFailed',
        detail: e instanceof Error ? e.message.slice(0, 160) : String(e)
      })
    }
  }
  return out
}

/**
 * 目录容器：一层层看下去，但**看见子压缩包就只记一笔、不往里钻**
 * （`archiveDepth` 一超过 `ARCHIVE_DEPTH_MAX` 就整支返回，见文件头那段理由）。
 */
async function walkDir(
  root: string,
  dir: string,
  lim: ContainerLimits,
  out: ContainerListing,
  opts: ListOptions,
  archiveDepth: number
): Promise<void> {
  if (archiveDepth > lim.archiveDepthMax) return
  let ents: fs.Dirent[]
  try {
    ents = await fs.promises.readdir(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const e of ents) {
    if (opts.signal?.aborted) return
    /** 上限已经撞过就别再往下翻了（唯一的判定点在 `addMember`，这里只是提前收工） */
    if (out.truncated && out.members.length >= lim.scanMax) return
    const full = path.join(dir, e.name)
    const rel = normalizeEntryPath(path.relative(root, full))
    if (isJunkRelPath(rel)) continue
    if (e.isDirectory()) {
      await walkDir(root, full, lim, out, opts, archiveDepth)
      continue
    }
    if (ARCHIVE_RE.test(e.name)) {
      out.scannedEntries++
      out.blocked.push({ relPath: rel, key: 'nestedArchive' })
      continue
    }
    if (!PACKAGE_RE.test(e.name)) continue
    let size = 0
    try {
      size = (await fs.promises.stat(full)).size
    } catch {
      continue
    }
    addMember(out, lim, { relPath: rel, sizeBytes: size, originArchive: null, absPath: full })
  }
}

/** 清单里所有能导的包（体积降序；界面让最大的排第一条） */
export function sortableMembers(list: ContainerListing): ContainerMember[] {
  return [...list.members].sort((a, b) => b.sizeBytes - a.sizeBytes || a.relPath.localeCompare(b.relPath))
}
