/**
 * F9 · 库健康检查（第 1 份 §F9 的六项工具）
 *
 * 两条铁律：
 * 1. **扫描只读**。所有会动文件/动库的都在单独的 action 函数里，界面点了才执行。
 * 2. **僵尸条目标记不删**。DB 里有、盘上没有 —— 大概率是拔了移动硬盘或者用户在外部删了，
 *    直接删记录等于替用户做决定；标成 missing 让他自己选。
 */
import fs from 'node:fs'
import path from 'node:path'
import type { Db } from '../db'
import type { FileEntry, HealthAssetRef, HealthReport } from '../../shared/types'

export type { HealthAssetRef, HealthReport }
import { getAsset, upsertAsset } from '../db/repos/asset'
import { thumbPathFor } from './thumbs'
import { thumbKeyFromCover } from './thumbRules'
import { assetFromSidecar, isSidecarFile, readSidecar } from './sidecar'
import { isCollectionName } from '../classify/bundle'
import { deriveGroupKey } from '../classify/groupKey'
import type { Lexicon } from '../classify/lexicon'
import { splitContainer } from '../fingerprint/primary'
import { attachmentKindOf, isArchiveFileName, isCodeFileName, isCompanionFileName, isJunkSegment, isPrimaryFileName } from '../../shared/junk'

/** 目录遍历的硬上限：25GB 的库扫穿了也不卡 */
const WALK_LIMIT = 20000
/** 游离文件只报到这一层，深一层的东西多半属于某个没登记的素材 */
const STRAY_MAX_DEPTH = 4

interface AssetRowLite {
  id: string
  name: string
  category: string
  subcategory: string | null
  status: string
  kind: string
  size_bytes: number | null
  hash_xxh64: string | null
  library_path: string | null
  source_path: string | null
  cover_image: string | null
  group_id: string | null
}

const ref = (r: AssetRowLite): HealthAssetRef => ({
  id: r.id,
  name: r.name,
  path: r.library_path ?? r.source_path,
  sizeBytes: r.size_bytes
})

/** 直接子目录数（判断"这个容器名底下到底装了几件东西"，不递归） */
function countChildDirs(dir: string): number {
  try {
    let n = 0
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory() && !isSidecarFile(e.name)) n++
      if (n >= 2) return n
    }
    return n
  } catch {
    return 0
  }
}

function dirSize(dir: string, limit = 4000): { bytes: number; entries: number } {
  let bytes = 0
  let entries = 0
  const stack = [dir]
  while (stack.length && entries < limit) {
    const d = stack.pop() as string
    let list: fs.Dirent[]
    try {
      list = fs.readdirSync(d, { withFileTypes: true })
    } catch {
      continue
    }
    for (const e of list) {
      if (entries++ >= limit) break
      /** §A1 垃圾不计入体积也不计入条目数（`__MACOSX/` 能让一个 3MB 的包报成 6MB） */
      if (isJunkSegment(e.name)) continue
      const abs = path.join(d, e.name)
      try {
        if (e.isDirectory()) stack.push(abs)
        else bytes += fs.statSync(abs).size
      } catch {
        /* 读不到的当 0 */
      }
    }
  }
  return { bytes, entries }
}

/**
 * 这棵目录里装的到底是"素材"还是"附属/代码"（增量改动单 2 §A5）。
 *
 * 真库里两个实测事故都出在**结构层**（`{分类}/{二级}/`）上散着的文件：
 *   - `Editor/SkinnedMeshMover.cs` → 一个 .cs 成了一张卡（验收 4）
 *   - `参考图/xxx.jpg` 一堆散图 → N 张卡，而 §A5 说这应该整体算 1 个「参考资料」
 * depth ≥ 3 的目录本来就整棵报一条，不会犯这个错；要拦的正是 depth ≤ 2 往下钻的那一层。
 *
 * 两道闸门，缺一个就会吞掉真素材：
 * ① **flat** —— 里面还有子目录就不收口。`贴图/lime/Custom skin/a.png` 这种
 *    三层结构必须照旧报到 `Custom skin` 那一层，收口到 `lime` 会把每个素材目录揉成一坨。
 * ② 整棵树干净地全是同一类 —— 混着主体（fbx/unitypackage/zip）一律往下钻。
 */
type DirContentKind = 'primary' | 'attachments' | 'code' | 'empty' | 'mixed'

interface DirContent {
  kind: DirContentKind
  /** 除了文件没有别的（垃圾目录不算），也就是"散文件直接躺在这一层" */
  flat: boolean
}

/** 脚本/包的伴生文件判定统一在 shared/junk（primary.splitContainer 用的同一份） */

function contentKind(dir: string, limit = 3000): DirContent {
  let attach = 0
  let code = 0
  let other = 0
  let n = 0
  let flat = true
  const stack = [dir]
  while (stack.length && n < limit) {
    const d = stack.pop() as string
    let list: fs.Dirent[]
    try {
      list = fs.readdirSync(d, { withFileTypes: true })
    } catch {
      continue
    }
    for (const e of list) {
      if (n++ >= limit) break
      if (isJunkSegment(e.name) || isSidecarFile(e.name)) continue
      const abs = path.join(d, e.name)
      if (e.isDirectory()) {
        flat = false
        stack.push(abs)
        continue
      }
      if (isPrimaryFileName(e.name) || isArchiveFileName(e.name)) return { kind: 'primary', flat }
      /**
       * 脚本的伴生文件（package.json / .meta / .asmdef / .hlsl…）跟着脚本一起算 code，
       * 不然一个 UPM 包目录会因为多了个 package.json 就判成 mixed、又散成 N 张卡。
       */
      if (isCodeFileName(e.name) || isCompanionFileName(e.name)) code++
      else if (attachmentKindOf(e.name)) attach++
      else other++
    }
  }
  const total = attach + code + other
  if (total === 0) return { kind: 'empty', flat }
  if (other > 0) return { kind: 'mixed', flat }
  if (code > 0 && attach === 0) return { kind: 'code', flat }
  if (attach > 0 && code === 0) return { kind: 'attachments', flat }
  return { kind: 'mixed', flat }
}

/** 这个路径在磁盘上是不是个目录 */
function isDirPath(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory()
  } catch {
    return false
  }
}

/**
 * 递归列出文件（同步版，`/` 分隔），垃圾整枝掐掉。
 * `listTree` 是异步的，而 `findStrays` 整条链是同步的（同步扫才不用把 UI 挂起来等），
 * 所以这里要自己走一遍 —— 只多这一个用途，别再想着合并成一份。
 */
function collectFileEntries(dir: string, limit = 3000): FileEntry[] {
  const out: FileEntry[] = []
  const stack: Array<{ abs: string; depth: number }> = [{ abs: dir, depth: 0 }]
  while (stack.length && out.length < limit) {
    const { abs: d, depth } = stack.pop() as { abs: string; depth: number }
    let list: fs.Dirent[]
    try {
      list = fs.readdirSync(d, { withFileTypes: true })
    } catch {
      continue
    }
    for (const e of list) {
      if (out.length >= limit) break
      if (isJunkSegment(e.name) || isSidecarFile(e.name)) continue
      const abs = path.join(d, e.name)
      const rel = path.relative(dir, abs).replace(/\\/g, '/')
      if (e.isDirectory()) {
        out.push({ relPath: rel, size: 0, ext: '', isDir: true })
        if (depth < 12) stack.push({ abs, depth: depth + 1 })
      } else {
        let size = 0
        try {
          size = fs.statSync(abs).size
        } catch {
          /* 算 0 */
        }
        out.push({ relPath: rel, size, ext: path.extname(e.name).toLowerCase(), isDir: false })
      }
    }
  }
  return out
}

/**
 * 结构层（**只第 2 层**）的那个目录该不该整棵收成一个单元。
 *
 * 沙盒活体实测（2026-10-05 晚）打回来的两条：
 *   - `着色器/lilToon_2.x.x/` → 报了 5 条（`Assets/` 一条 + 根上 Readme.html / Distribution.png /
 *     【重要】….html / package.json 各一条）。真实形状是"主体在子目录、根上散着附属"。
 *   - `衣服/名流/` → 报了 21 条（20 个 Libero + 封面图）。而且 `cleanDisplayName` 把每个包都洗成
 *     `Libero`，进了收件箱就是 20 张**同名**卡，比"零散"还糟。
 *
 * **只在 depth === 2 生效**，这条不是保守是要命：第 1 层是 `{分类}`，
 * 在它身上收口等于把整个分类目录当成一件素材报上去（第一版就犯了这个错，
 * 四条单测一起红：`衣服/名流` 变成了 `衣服`）。第 1 层只保留原来那条
 * "平铺 + 全是脚本/全是图"的收口（`E:\vrc\A\Editor\` 靠它，验收 4 已有测试）。
 *
 * 两条新收口：
 *  - `group`：**根上散着的包 ≥3 个且 groupKey 全同** → 同一件东西的多个变体。
 *    Libero 走这条。`TwinkleSpica` 的 Mint/Plum 和模型版 groupKey 不同 → **不**走这条，
 *    仍然各是一条 + 出 §B5 建议横幅（验收 10 要的就是不自动并）。
 *  - `primary`：**第一层只有一个目录、主体在它里面，其余第一层条目全是附属/伴生/脚本**
 *    → lilToon 走这条。有两个以上子目录就不收（那是筐，不是"一件东西带附属"）；
 *    根上一个文件都没有也不收（那只是"分类下面只有一个子目录"，往下钻自然会报到正确那层）。
 */
function structureCollapse(abs: string, lex: Lexicon | null): 'group' | 'primary' | null {
  const entries = collectFileEntries(abs)
  if (entries.length < 2) return null

  /** 只看这个目录的**第一层**：收口判的是"这一层摊开了是什么" */
  const firstDirs = new Set<string>()
  const firstFiles: string[] = []
  for (const e of entries) {
    const segs = e.relPath.split('/')
    if (segs[0]) {
      if (segs.length >= 2) firstDirs.add(segs[0])
      else if (!e.isDir) firstFiles.push(segs[0])
      else firstDirs.add(segs[0])
    }
  }

  const rootFiles = entries.filter((e) => !e.isDir && !e.relPath.includes('/'))
  if (lex && rootFiles.length >= 3) {
    const packish = rootFiles.filter((e) => /\.(unitypackage|zip|rar|7z)$/i.test(e.relPath))
    if (packish.length >= 3) {
      const toks = packish.map((e) => deriveGroupKey(e.relPath, lex))
      const keys = new Set(toks.map((t) => t.groupKey))
      /**
       * 光 groupKey 全同还不够，**括号外的前缀也必须同一个**。
       * 这条是 §B2 安全保护第 3 条在收口层的落点：沙盒里我专门造了
       * `Shinano[X_Same Series]` / `Manuka[…]` / `Moe[…]` 三个不同产品，
       * 括号一摘三者 groupKey 全塌成 `same` —— 只比 key 就会把它们并成一张卡
       * （第一版真这么错了，活体扫出来一个凭空的 "Manuka" 容器）。
       * Libero 那 20 个前缀全是 `libero`，不受影响。
       */
      const prefixes = new Set(
        toks.map((t) => (t.slotPrefixes[0] ?? t.core[0] ?? '').toLowerCase())
      )
      if (keys.size === 1 && prefixes.size === 1) return 'group'
    }
  }

  if (lex && firstDirs.size === 1 && firstFiles.length > 0) {
    const split = splitContainer(entries)
    if (split.primary && split.primaryRoot === Array.from(firstDirs)[0]) {
      const stray = firstFiles.filter(
        (n) => !attachmentKindOf(n) && !isCompanionFileName(n) && !isCodeFileName(n) && !isArchiveFileName(n)
      )
      if (!stray.length) return 'primary'
    }
  }
  return null
}

/** inside(a, b) ：a 在 b 里面（或就是 b） */
function inside(a: string, b: string): boolean {
  const ra = path.resolve(a)
  const rb = path.resolve(b)
  return ra === rb || ra.startsWith(rb + path.sep)
}

/**
 * 把"包 + 同名已解压目录"并排的情况合成一条。
 *
 * 真库里这形态占大头（实测 72 对，光 贴图 就 7 对）：用户自己解压过又留着原件。
 * 不合并的话一次收编就凭空多出一堆重复资产 —— 而且哈希查重救不了，
 * 因为"一个 zip"和"一堆散文件"算出来的指纹根本不是一回事。
 * 合成一条时以**包**为代表（它才是紧凑原件），旁边那个目录记在 alsoDirs 里给界面说明。
 */
function mergePairs(items: HealthReport['strays']): HealthReport['strays'] {
  const byParent = new Map<string, HealthReport['strays']>()
  for (const it of items) {
    const key = path.dirname(it.path)
    const list = byParent.get(key)
    if (list) list.push(it)
    else byParent.set(key, [it])
  }
  const out: HealthReport['strays'] = []
  for (const list of byParent.values()) {
    const dirs = new Map(list.filter((i) => i.isDir).map((i) => [path.basename(i.path).toLowerCase(), i]))
    const eaten = new Set<HealthReport['strays'][number]>()
    for (const file of list.filter((i) => !i.isDir)) {
      const base = path.basename(file.path).replace(/\.(zip|rar|7z|unitypackage|tar|gz)$/i, '')
      if (base === path.basename(file.path)) continue
      const dir = dirs.get(base.toLowerCase())
      if (!dir || eaten.has(dir)) continue
      file.alsoDirs = [...(file.alsoDirs ?? []), dir.path]
      eaten.add(dir)
    }
    for (const it of list) if (!eaten.has(it)) out.push(it)
  }
  out.sort((a, b) => b.sizeBytes - a.sizeBytes)
  return out
}

export interface StrayOptions {
  /** 只收这一棵子树（分批收编用：一次只动 贴图，不把整库端上来） */
  under?: string | null
  maxDepth?: number
  limit?: number
  /**
   * 词典。给了才会做"结构层收口"里的两条新判据（同 groupKey 的散包、主体在子目录）。
   * 故意做成可选：health.ts 的单测不带 electron，而 mainLexicon() 走的是
   * `process.resourcesPath` / `app.getAppPath()` —— 硬依赖进去测试就跑不起来了。
   */
  lex?: Lexicon | null
}

/**
 * 盘上有、DB 里没有的东西。
 *
 * 规则：一个目录如果"里面装着已登记的素材"就往下钻（同层可能还有别的游离货），
 * 如果它整个都在某个素材里面就直接跳过（那是素材的内部），
 * 两者都不是 —— 整棵子树都是游离的，报出来，不再往下钻。
 *
 * 深度是**相对库根**算的，所以 `under` 只是剪枝（别的分支不走），
 * 不改变"第几层才算素材"的判断 —— 不然从 贴图/ 起走会把 贴图/lime/Custom skin 误当成结构层跳过。
 */
export function findStrays(
  libraryRoot: string,
  knownPaths: string[],
  opts: StrayOptions | number = {}
): { items: HealthReport['strays']; truncated: boolean } {
  // 老调用方还按位置传 maxDepth，接住
  const o: StrayOptions = typeof opts === 'number' ? { maxDepth: opts } : opts
  const maxDepth = o.maxDepth ?? STRAY_MAX_DEPTH
  const limit = o.limit ?? 500
  const lex = o.lex ?? null
  const known = knownPaths.filter(Boolean).map((p) => path.resolve(p))
  const under = o.under ? path.resolve(o.under) : null
  // inside(a, b) 读作"a 在 b 里面"：目标子树必须落在库根之内，否则一律不扫（防越界）
  if (under && !inside(under, libraryRoot)) return { items: [], truncated: false }
  const items: HealthReport['strays'] = []
  let visited = 0
  let truncated = false

  const containsKnown = (dir: string): boolean => known.some((k) => inside(k, dir))
  const walk = (dir: string, depth: number): void => {
    if (depth > maxDepth || truncated) return
    let list: fs.Dirent[]
    try {
      list = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of list) {
      if (++visited > WALK_LIMIT) {
        truncated = true
        return
      }
      const abs = path.join(dir, e.name)
      if (isSidecarFile(e.name)) continue
      /** §A1 垃圾过滤（三处之一）：`.DS_Store` / `__MACOSX` / `Thumbs.db` 不报、不计入统计 */
      if (isJunkSegment(e.name)) continue
      if (known.some((k) => path.resolve(k) === path.resolve(abs))) continue
      /** 分批收编：跟目标子树既不包含也不被包含的分支，整枝不走 */
      if (under && !inside(abs, under) && !inside(under, abs)) continue
      if (e.isDirectory()) {
        if (containsKnown(abs)) {
          walk(abs, depth + 1)
          continue
        }
        /**
         * 例外：名字自己就写着"合集 / 22件 / 更新"这种容器词的，二层也算一件东西。
         * 真库的 `插件道具合集-初音的VRC小店` 就在顶层，按下面的结构闸门会被一路钻进去，
         * 报上来的是它孙辈的十几件碎片 —— 那样永远建不出"1 张合集卡含 17 项"（改动单 §6.3）。
         *
         * 但**只有一个孩子的容器要继续往下钻**：`道具22件/6159895摇后会喷的酒/` 这种
         * 套一层的，报容器会把真正那件商品（里面三个版本的包）埋掉。
         */
        if (depth <= 2 && isCollectionName(e.name) && countChildDirs(abs) >= 2) {
          const { bytes, entries } = dirSize(abs)
          items.push({ path: abs, sizeBytes: bytes, entries, isDir: true })
          continue
        }
        /**
         * 一二级目录（{分类}/{二级}）是库的**结构**，不是"没人要的素材"。
         * 真库刚接上、库里还没登记过任何素材时，整棵目录树都会在这一层被判成游离，
         * 用户点一下"重新登记"就等于把 25GB 全丢进取物队列 —— 而自动归档会搬文件。
         * 素材目录按模板必然在第三层往下，所以只报 depth ≥ 3 的目录。
         *
         * **但两种结构层要整棵报一条**（§A5，验收 4）：
         * 里面全是脚本 → 一个「编辑器脚本」单元；全是图/文档 → 一个「参考资料」单元。
         * 不然 `Editor/SkinnedMeshMover.cs` 和 `参考图/` 里的 30 张散图会各自成卡。
         */
        if (depth <= 2) {
          const c = contentKind(abs)
          if (c.flat && (c.kind === 'code' || c.kind === 'attachments')) {
            const { bytes, entries } = dirSize(abs)
            items.push({ path: abs, sizeBytes: bytes, entries, isDir: true, contentKind: c.kind })
            continue
          }
          /**
           * §A2/§B6 的收口。**只在第二层做** —— 第一层是 {分类}，在那儿收口等于
           * 把整个分类目录当成一件素材报上去（第一版就栽在这，四条单测一起红）。
           */
          const collapse = depth === 2 ? structureCollapse(abs, lex) : null
          if (collapse) {
            const { bytes, entries } = dirSize(abs)
            items.push({ path: abs, sizeBytes: bytes, entries, isDir: true, contentKind: collapse })
            continue
          }
          walk(abs, depth + 1)
          continue
        }
        const { bytes, entries } = dirSize(abs)
        items.push({ path: abs, sizeBytes: bytes, entries, isDir: true })
        continue
      }
      let size = 0
      try {
        size = fs.statSync(abs).size
      } catch {
        /* 算 0 */
      }
      items.push({ path: abs, sizeBytes: size, entries: 1, isDir: false })
    }
  }
  walk(libraryRoot, 1)
  items.sort((a, b) => b.sizeBytes - a.sizeBytes)
  return { items: mergePairs(items).slice(0, limit), truncated }
}

/**
 * 从库里已有的封面算 64 位 dHash。
 * 用 dHash 而不是 aHash：对整体亮度漂移不敏感，Booth 上同一张图压了两次也能认出来。
 * 拿缩略图算而不是拿原图：缓存本来就在磁盘上，不用为一件事再解一遍 40MB 的图。
 */
export function dHashFromBitmap(rgba: Buffer, width: number, height: number): string | null {
  if (width < 2 || height < 1) return null
  const gray = (x: number, y: number): number => {
    const i = (y * width + x) * 4
    // BGRA（Chromium 的 bitmap 顺序），转亮度用 ITU-R BT.601 的权重
    return 0.299 * rgba[i + 2] + 0.587 * rgba[i + 1] + 0.114 * rgba[i]
  }
  let bits = ''
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width - 1; x++) {
      bits += gray(x, y) > gray(x + 1, y) ? '1' : '0'
    }
  }
  // 每行取 width-1 个相邻比较，共 height 行 —— 9x8 的图正好 64 位
  return bits.length === (width - 1) * height ? bits : null
}

export function hamming(a: string, b: string): number {
  if (a.length !== b.length) return Number.MAX_SAFE_INTEGER
  let n = 0
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) n++
  return n
}

/** 一张封面 → 64 位 dHash。由调用方提供"缩到 9x8 的灰度位图"（主进程用 nativeImage） */
export type ThumbDigest = (key: string) => { bitmap: Buffer; width: number; height: number } | null

export function dHashOf(key: string, digest: ThumbDigest): string | null {
  const d = digest(key)
  if (!d || !d.bitmap || !d.bitmap.length) return null
  return dHashFromBitmap(d.bitmap, d.width, d.height)
}

/**
 * 只读扫描。
 *
 * @param thumbDigest 把一张缓存图缩到 9x8 取灰度 —— 由主进程注入（要用 Electron 的 nativeImage），
 *                    这样这份文件在单测里也能跑。
 */
export function scanLibrary(
  db: Db,
  libraryRoot: string | null,
  thumbDigest?: (key: string) => { bitmap: Buffer; width: number; height: number } | null,
  /** 分批收编：只扫这一棵子树（界面上选"这批只动 贴图"） */
  under?: string | null,
  /** 词典：给了才会做结构层的两条新收口（见 StrayOptions.lex） */
  lex?: Lexicon | null
): HealthReport {
  const rows = db
    .prepare(
      `SELECT id, name, category, subcategory, status, kind, size_bytes, hash_xxh64, library_path, source_path, cover_image, group_id FROM asset ORDER BY updated_at DESC`
    )
    .all() as AssetRowLite[]

  const missing: HealthAssetRef[] = []
  let missingBytes = 0
  for (const r of rows) {
    const p = r.library_path ?? r.source_path
    if (!p) {
      if (r.status !== 'inbox') missing.push(ref(r))
      continue
    }
    let ok = false
    try {
      ok = fs.existsSync(p)
    } catch {
      ok = false
    }
    if (!ok) {
      missing.push(ref(r))
      missingBytes += r.size_bytes ?? 0
    }
  }

  const byHash = new Map<string, AssetRowLite[]>()
  for (const r of rows) {
    if (!r.hash_xxh64) continue
    const list = byHash.get(r.hash_xxh64)
    if (list) list.push(r)
    else byHash.set(r.hash_xxh64, [r])
  }
  const duplicates: HealthReport['duplicates'] = []
  let duplicateBytes = 0
  for (const [hash, list] of byHash) {
    if (list.length < 2) continue
    const size = list[0].size_bytes ?? 0
    duplicateBytes += size * (list.length - 1)
    duplicates.push({ hash, sizeBytes: size, assets: list.map(ref) })
  }
  duplicates.sort((a, b) => b.sizeBytes * b.assets.length - a.sizeBytes * a.assets.length)

  const largest = [...rows]
    .sort((a, b) => (b.size_bytes ?? 0) - (a.size_bytes ?? 0))
    .slice(0, 20)
    .map(ref)

  const groupCount = (db.prepare(`SELECT COUNT(*) AS n FROM asset_group`).get() as { n: number }).n
  const orphanGroups = orphanGroupRows(db)

  const similar: HealthReport['similar'] = []
  if (thumbDigest) {
    const hashes: Array<{ bits: string; row: AssetRowLite }> = []
    const seenKey = new Set<string>()
    for (const r of rows) {
      const key = thumbKeyFromCover(r.cover_image)
      if (!key || seenKey.has(key)) continue
      seenKey.add(key)
      if (!fs.existsSync(thumbPathFor(key))) continue
      const bits = dHashOf(key, thumbDigest)
      if (bits) hashes.push({ bits, row: r })
    }
    for (let i = 0; i < hashes.length; i++) {
      for (let j = i + 1; j < hashes.length; j++) {
        const d = hamming(hashes[i].bits, hashes[j].bits)
        if (d <= 6) similar.push({ distance: d, a: ref(hashes[i].row), b: ref(hashes[j].row) })
      }
    }
    similar.sort((a, b) => a.distance - b.distance)
  }

  let strays: HealthReport['strays'] = []
  let truncated = false
  if (libraryRoot && fs.existsSync(libraryRoot)) {
    const known = rows.flatMap((r) => [r.library_path, r.source_path].filter((x): x is string => !!x))
    const s = findStrays(libraryRoot, known, { under, lex })
    strays = s.items
    truncated = s.truncated
  }

  return {
    scannedAt: Date.now(),
    libraryRoot,
    missing,
    duplicates,
    similar,
    strays,
    largest,
    orphanGroups,
    totals: {
      assets: rows.length,
      groups: groupCount,
      bytes: rows.reduce((a, r) => a + (r.size_bytes ?? 0), 0),
      missingBytes,
      duplicateBytes
    },
    truncated
  }
}

/** 僵尸条目：只改状态，不动文件、不删记录 */
export function markMissing(db: Db, ids: string[]): { marked: number } {
  let marked = 0
  db.transaction(() => {
    for (const id of ids) {
      const r = db.prepare(`UPDATE asset SET status = 'missing', updated_at = ? WHERE id = ? AND status <> 'missing'`).run(Date.now(), id)
      marked += r.changes
    }
  })()
  return { marked }
}

/** 解除标记（用户把盘插回来了 / 自己确认过还在） */
export function unmarkMissing(db: Db, ids: string[]): { restored: number } {
  let restored = 0
  db.transaction(() => {
    for (const id of ids) {
      const r = db
        .prepare(`UPDATE asset SET status = CASE WHEN confidence >= 0.6 THEN 'classified' ELSE 'pending_confirm' END, updated_at = ? WHERE id = ? AND status = 'missing'`)
        .run(Date.now(), id)
      restored += r.changes
    }
  })()
  return { restored }
}

/**
 * 什么才算"孤儿变体"。
 *
 * 规格里那句"group 下只剩一个变体时自动解散"不能照字面实现：
 * 每个素材入库时都会带一个 groupKey，于是**任何单件素材都是一个单成员分组**，
 * 照字面扫会把整个库全报成孤儿。
 * 真正的孤儿是"曾经并过、后来兄弟没了"—— 留下来的证据就是 variant 行：
 * 只有多成员分组才会写下 ≥2 行差异维度。
 * （顺带正好收掉旧版本误写的一堆 avatar 行。）
 */
function orphanGroupRows(db: Db): HealthReport['orphanGroups'] {
  const rows = db
    .prepare(
      `SELECT g.id AS groupId, g.group_key AS key, g.name AS name,
              (SELECT COUNT(*) FROM asset a WHERE a.group_id = g.id) AS members,
              (SELECT COUNT(*) FROM variant v WHERE v.group_id = g.id) AS variantRows
       FROM asset_group g ORDER BY g.name`
    )
    .all() as Array<{ groupId: string; key: string; name: string; members: number; variantRows: number }>
  const out: HealthReport['orphanGroups'] = []
  for (const g of rows) {
    if (g.members > 1) continue
    if (g.members === 0) {
      out.push({ groupId: g.groupId, key: g.key, name: g.name, assetId: '' })
      continue
    }
    if (g.variantRows < 2) continue
    const only = db.prepare(`SELECT id FROM asset WHERE group_id = ? LIMIT 1`).get(g.groupId) as { id: string }
    out.push({ groupId: g.groupId, key: g.key, name: g.name, assetId: only.id })
  }
  return out
}
export function dissolveOrphanGroups(db: Db): { dissolved: number; assetsFreed: number } {
  let dissolved = 0
  let assetsFreed = 0
  /** 判据和扫描共用同一个函数：界面上列了哪几个，点下去就解散哪几个 */
  const targets = orphanGroupRows(db)
  db.transaction(() => {
    for (const o of targets) {
      if (o.assetId) {
        db.prepare(`UPDATE asset SET group_id = NULL, updated_at = ? WHERE id = ?`).run(Date.now(), o.assetId)
        assetsFreed++
      }
      db.prepare(`DELETE FROM variant WHERE group_id = ?`).run(o.groupId)
      db.prepare(`DELETE FROM asset_group WHERE id = ?`).run(o.groupId)
      dissolved++
    }
  })()
  return { dissolved, assetsFreed }
}

/**
 * 从侧车文件重建库记录（§F9"索引重建"）。
 *
 * 侧车里不存绝对路径，所以路径由"它在库根的哪个子目录下"还原（sidecar.assetFromSidecar）。
 * 已存在的 id 一律跳过 —— 这个按钮的用途是"库文件还在、DB 没了/坏了"，
 * 不是"拿磁盘上的老记录覆盖库里较新的记录"，那种事不该由一个重建按钮顺手做掉。
 */
export async function rebuildFromSidecars(
  db: Db,
  libraryRoot: string,
  onRow?: (assetId: string) => void
): Promise<{ found: number; inserted: number; skipped: number; errors: string[] }> {
  const errors: string[] = []
  let found = 0
  let inserted = 0
  let skipped = 0
  const stack = [libraryRoot]
  let visited = 0
  let hitLimit = false
  while (stack.length && !hitLimit) {
    const d = stack.pop() as string
    let list: fs.Dirent[]
    try {
      list = fs.readdirSync(d, { withFileTypes: true })
    } catch {
      continue
    }
    for (const e of list) {
      if (++visited > WALK_LIMIT) {
        errors.push('目录条目超过 ' + WALK_LIMIT + '，扫描提前结束')
        hitLimit = true
        break
      }
      const abs = path.join(d, e.name)
      if (e.isDirectory()) {
        stack.push(abs)
        continue
      }
      if (!isSidecarFile(e.name)) continue
      const assetDir = path.dirname(abs)
      try {
        const data = await readSidecar(assetDir)
        if (!data) {
          errors.push('侧车读不出内容：' + assetDir)
          continue
        }
        found++
        if (getAsset(db, data.asset.id)) {
          skipped++
          continue
        }
        upsertAsset(db, assetFromSidecar(data, assetDir, libraryRoot))
        inserted++
        onRow?.(data.asset.id)
      } catch (err) {
        errors.push(assetDir + '：' + (err instanceof Error ? err.message : String(err)))
      }
    }
  }
  return { found, inserted, skipped, errors }
}
