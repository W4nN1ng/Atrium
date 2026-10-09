import fs from 'node:fs'
import path from 'node:path'
import { probeFile } from './magic'
import { normalizeEntryPath } from './encoding'
import { extractZip, listZip } from './unzip'
import { extractArchive, listArchive, type ArchiveEntry } from './sevenZip'
import { memberMatches, isDirEntry } from './entryMatch'
import { safeJoin } from '../security/paths'

/**
 * **定点抽取**：只把用户点名的那几个成员从压缩包里弄到磁盘上。
 *
 * 这是 M5-B「压缩包型容器的成员提取」的地基，也是 `docs/M5B-DESIGN.md` §2 里
 * P0-1 / P0-2 / P0-3 三个缺陷的收口处。设计见那份文档，这里只写实现与它的坑。
 *
 * 三条不可协商的规矩：
 *
 * 1. **永不整包解压**。`wanted` 是必填的，空数组直接抛 —— 历史上
 *    `extractZip(file, dir, { only: [] })` 等于"没传过滤"，实测把一个 39 MB 的包
 *    整个解成 933 个文件 / 75 MB。这种"忘了传"的失败模式必须从签名上堵死。
 * 2. **返回 localPath，不让调用方自己拼**。旧代码就是拼错了才静默失效：
 *    抽取按完整相对路径落盘（`safeJoin(dest, 'A/B.pack')`），
 *    读取却按 `path.join(dest, path.basename('A/B.pack'))` 找 ——
 *    真库 68 个内层包里有 22 个因此从来没被解析过，一条日志都不留。
 * 3. **列清单和解压用同一个后端**。cp932 文件名在 yauzl 和 7z 里解码结果可能不同；
 *    拿 yauzl 解出来的路径去喂 7z，就会变成"明明在包里，7z 说找不到"。
 *    所以按 magic bytes（不是扩展名）决定走哪条，两边都用那条。
 */

export interface MemberList {
  entries: ArchiveEntry[]
  /** 有没有加密条目（含头部加密，那种连清单都要密码） */
  encrypted: boolean
  /** 用哪个后端列的 —— 决定了抽取必须走同一个后端 */
  backend: 'yauzl' | string
  /** 分卷：缺任一卷时后端会失败，界面要单独说 */
  splitVolume: boolean
  /** 按 magic bytes 认定的真实格式 */
  format: string
}

export interface ExtractedMember {
  /** 用户请求的那条成员路径（归一化后的斜杠口径） */
  relPath: string
  /** **磁盘上实际落地的路径** —— 调用方只用这个，不许自己拼 */
  localPath: string
  sizeBytes: number
}

export interface ExtractMembersResult {
  members: ExtractedMember[]
  /** 请求了、后端也退了 0，但磁盘上没有 —— 多半是后端按通配符没匹配上 */
  missing: string[]
  /** 落地了但没人要的条目（后端模糊匹配的产物），调用方可以选择删掉 */
  unexpected: string[]
  totalBytes: number
  backend: string
}

export interface MemberOptions {
  password?: string
  extraBackendDirs?: string[]
  signal?: AbortSignal
  onProgress?: (percent: number, current: string) => void
}

/** 它其实是个目录 —— 真库里实测有 2 例（`Texture_Package.zip` 是个文件夹），别去 `7z x` 它 */
export class NotAnArchiveError extends Error {
  constructor(
    readonly file: string,
    readonly why: 'is-directory' | 'not-a-container' | 'unknown-format',
    readonly format?: string
  ) {
    super(`不是可解压的容器：${file}（${why}${format ? ':' + format : ''}）`)
    this.name = 'NotAnArchiveError'
  }
}

/**
 * "这东西到底是不是一个能解压的文件" —— **只此一份**。
 *
 * 原来 `listMembers` 和 `extractMembers` 各写一遍 stat 检查，回退验证时
 * 撤掉一处另一处还挡着，用例照样绿：这就是"同一个规则写两遍一定会漂"的现场版
 * （项目里上一次是 groupKey 没剥 UUID，表现是分类莫名判错）。
 *
 * 判据是**磁盘事实 + magic bytes**，名字不算话：
 * 真库里实测有 2 个名字叫 `.zip` 的**目录**（`Texture_Package.zip`、`Shinano_Guidance.zip`），
 * 对它们起 `7z l` 会得到一堆误导性的 `Cannot open the file as archive`。
 */
async function requireArchive(file: string): Promise<{ sizeBytes: number; format: string; isZip: boolean; splitVolume: boolean }> {
  let st: fs.Stats
  try {
    st = fs.statSync(file)
  } catch {
    throw new NotAnArchiveError(file, 'not-a-container')
  }
  if (st.isDirectory()) throw new NotAnArchiveError(file, 'is-directory')
  if (!st.isFile()) throw new NotAnArchiveError(file, 'not-a-container')
  const probed = await probeFile(file)
  const isZip = probed.format === 'zip'
  if (!probed.isArchive && !isZip) throw new NotAnArchiveError(file, 'not-a-container', probed.format)
  return { sizeBytes: st.size, format: probed.format, isZip, splitVolume: probed.splitVolume }
}

/**
 * 列成员清单。**先问磁盘事实，再看名字**（见 `requireArchive`）。
 */
export async function listMembers(file: string, opts: MemberOptions = {}): Promise<MemberList> {
  const kind = await requireArchive(file)
  if (kind.isZip) {
    const r = await listZip(file)
    return { entries: r.entries, encrypted: r.encrypted, backend: 'yauzl', splitVolume: kind.splitVolume, format: kind.format }
  }
  const r = await listArchive(file, { password: opts.password, extraBackendDirs: opts.extraBackendDirs })
  return { entries: r.entries, encrypted: r.encrypted, backend: r.backend, splitVolume: kind.splitVolume, format: kind.format }
}

/** 扫落地结果：返回"相对 destDir 的正斜杠路径 → 绝对路径 + 体积" */
function scanLanded(destDir: string): Map<string, { localPath: string; sizeBytes: number }> {
  const out = new Map<string, { localPath: string; sizeBytes: number }>()
  const walk = (dir: string): void => {
    let ents: fs.Dirent[]
    try {
      ents = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of ents) {
      const full = path.join(dir, e.name)
      if (e.isDirectory()) {
        walk(full)
        continue
      }
      const rel = normalizeEntryPath(path.relative(destDir, full))
      let size = 0
      try {
        size = fs.statSync(full).size
      } catch {
        /* 刚被占用/删掉，算 0 就是了 */
      }
      out.set(rel.toLowerCase(), { localPath: full, sizeBytes: size })
    }
  }
  walk(destDir)
  return out
}

/**
 * 从压缩包（或任何后端支持的容器）里**只**抽出 `wanted` 点名的成员。
 *
 * 落地结构由后端决定（保留包内相对路径），所以函数**扫一遍 dest 再回报 localPath**，
 * 而不是"猜"它落在哪 —— 这一条就是 P0-1 的教训写成了代码。
 */
export async function extractMembers(
  file: string,
  destDir: string,
  wanted: string[],
  opts: MemberOptions = {}
): Promise<ExtractMembersResult> {
  const list = wanted.map((w) => normalizeEntryPath(w)).filter((w) => w && !isDirEntry(w, false))
  if (!list.length) {
    /**
     * 空清单 = 调用方漏传，**不等于"解全部"**。
     * 真按"解全部"做的代价实测过：一张 39 MB 的卡解出 933 个文件 / 75 MB，
     * 而那时候的暂存目录在系统盘上。
     */
    throw new Error('extractMembers：wanted 不能为空 —— 空清单不代表"解全部"')
  }

  const kind = await requireArchive(file)

  fs.mkdirSync(destDir, { recursive: true })

  let backend = 'yauzl'
  if (kind.isZip) {
    const r = await extractZip(file, destDir, {
      only: list,
      password: opts.password,
      extraBackendDirs: opts.extraBackendDirs,
      signal: opts.signal,
      onProgress: opts.onProgress
    })
    backend = `yauzl(${r.files})`
  } else {
    const r = await extractArchive(file, destDir, {
      only: list,
      password: opts.password,
      extraBackendDirs: opts.extraBackendDirs,
      signal: opts.signal,
      onProgress: opts.onProgress
    })
    backend = `7z(${r.files})`
  }

  const landed = scanLanded(destDir)
  const members: ExtractedMember[] = []
  const missing: string[] = []
  /** 已认领的落地条目（小写相对路径）—— 不认领就会被当成"多解出来的东西"报一遍 */
  const claimed = new Set<string>()
  for (const w of list) {
    const key = w.toLowerCase()
    const hit = landed.get(key)
    /**
     * **只认整条相对路径相等**，不做"按文件名猜"的兜底。
     *
     * 曾经这里有个 findLoose：找不到就把 `basename` 唯一的落地文件当命中。
     * 回退验证时发现它把 P0-1 的病灶整个掩盖掉了（撤成 basename 查找也测不出红），
     * 而更糟的是它会**悄悄返回一个位置不对的文件** ——
     * 真库里 `PSD.zip` 这种同名成员出现在不同目录，正是最容易猜错的那种。
     * 拿错包导进 Unity 比"导不进去"严重得多，所以宁可报 missing 让人看见。
     */
    if (!hit) {
      missing.push(w)
      continue
    }
    claimed.add(key)
    members.push({ relPath: w, localPath: hit.localPath, sizeBytes: hit.sizeBytes })
  }
  const unexpected = [...landed.keys()].filter((rel) => !claimed.has(rel))

  return {
    members,
    missing,
    unexpected,
    totalBytes: members.reduce((a, m) => a + m.sizeBytes, 0),
    backend
  }
}

/** 抽出到 `<destDir>/<assetId>/<seq>/` 之后的目录名，供撤销与 prune 对齐（见 extractRoot） */
export function memberLocalPath(destDir: string, relPath: string): string | null {
  return safeJoin(destDir, relPath)
}
