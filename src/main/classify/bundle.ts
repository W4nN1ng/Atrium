/**
 * 合集识别（改动单 §2）—— **不再拆成顶层卡片**，而是产出一棵三级树：
 *
 *   合集 Bundle ─ 子项 Item ─ 版本 Variant
 *
 * 为什么改：上一版把"初音的VRC小店"拆成十几个顶层素材，用户的库一下就散了；
 * 更糟的是 `StoZeroCustomEX.zip` / `_v1.01.zip` / `_v1.10.zip` 明明是同一个插件的
 * 三个版本，却被当成三个不同项（实测 228 项收编时就是这样）。
 * 现在整包算 1 个 Bundle，里面几件东西挂在它下面，库列表只出合集这一张卡。
 *
 * 判定三条（满足任一）：
 * ① 名字里写着 合集/セット/まとめ/set/pack…
 * ② 下面能独立分类的子项 ≥3
 * ③ 目录名是"容器名"而不是"商品名"（`道具22件`、`ERP用12件`、`更新`、`重要！`）
 *    —— 这条是这次新加的：`R5613-VRChat-武器合集（军事武器合集）` 里那层
 *    `4952737/INVICTA` 以前会被当成顶层素材登进来，商品名还写成数字 id。
 *
 * 拆分保护规则（§4.3 沿用）：子项**仍然待在合集自己的物理目录里**，
 * 一条文件都不搬，不然用户回头就找不到"这几个是一起来的"。
 */
import type { ContainerKind, FileEntry, IngestResult } from '../../shared/types'
import type { ClassifyDeps } from './engine'
import { deriveGroupKey } from './groupKey'
import { compareVersionDesc } from '../../shared/version'
import { cleanDisplayName } from '../../shared/naming'

const BUNDLE_NAME_RE =
  /(合集|セット|まとめ|まとめ売り|全家桶|大全|道具合集|插件合集|\bset\b|\bpack\b|\bbundle\b)/i

/**
 * 判据 ③：纯计数 / 纯归类词。这些名字下面不可能是一件商品，只能是个筐。
 * `\d+\s*[件個款点]` 覆盖 `道具22件` / `プラグイン17件` / `ERP用12件`；
 * 光杆"更新/重要/其他/备份"这类是用户自己随手建的筐。
 */
const CONTAINER_RE =
  /^\D{0,12}\d+\s*[件個款点种種]|\d+\s*件$|^(更新|重要|其他|其它|その他|备份|バックアップ|新建文件夹|整理|temp|tmp|new folder)[\s!！。._-]*$/i

/** Booth / 爱发电的商品 id 目录：纯数字 5–8 位 */
const ID_DIR_RE = /^\d{5,8}$/

const IMAGE_RE = /\.(png|jpe?g|webp)$/i
const DOCUMENT_RE = /\.(txt|md|html?|url|pdf|rtf|docx?|meta)$/i
const ATTACHMENT_IMAGE_RE = /^(cover|preview|thumbnails?|readme|help|instructions?|manuals?|guides?|tutorials?)(?:$|[\s_.\-\d])/i

/** 能独立分类 = 有素材内容；三份说明或配图不能单凭数量成为一件商品。 */
function classifiable(files: FileEntry[]): boolean {
  const real = files.filter((f) => !f.isDir)
  if (!real.length) return false
  if (real.some((f) => !IMAGE_RE.test(f.relPath) && !DOCUMENT_RE.test(f.relPath))) return true
  // 保留纯图像贴图商品，以及带 readme 的贴图商品；封面和说明配图不是素材证据。
  return real.length >= 3 && real.some((f) => {
    if (!IMAGE_RE.test(f.relPath)) return false
    const stem = (segs(f.relPath).pop() ?? '').replace(/\.[^.]+$/, '')
    return !ATTACHMENT_IMAGE_RE.test(stem)
  })
}

/** 子项是压缩包还是 unitypackage —— 根下散文件能不能自立成一项要看这个 */
const ARCHIVE_RE = /\.(zip|rar|7z|tar|gz|tgz|unitypackage)$/i

export interface BundleVersion {
  /** 原始名（含扩展名），UI 展开版本列表时显示它 */
  rawName: string
  /** 相对合集根的路径 —— 导入单个版本要用它定位 */
  relPath: string
  sizeBytes: number
  version: string | null
  avatar: string | null
  installMethod: string | null
  locale: string | null
  /** §B2：这个变体是从哪截方括号内容认出来的（`Shinano_ATTITUDE The Royal Bunny`） */
  variantRaw: string | null
  /** §B3：复合模型名拆出来的全部（`Chiffon&Chocolat` → 两个徽章） */
  avatars: string[]
}

export interface BundleItem {
  /** 展示名：穿透 ID 目录、剥掉版本/适配 token 之后的"产品本名" */
  name: string
  rawNames: string[]
  /** 相对合集根的主路径（目录或单个压缩包） */
  relPath: string
  groupKey: string
  /** ID 目录穿透出来的疑似商品号（只当来源，不当名字） */
  sourceItemId: string | null
  /** 归并进这个子项的物理文件；1 条 = 它自己就是叶子，≥2 = 有多个版本 */
  versions: BundleVersion[]
  /** 这个子项的全部条目（含版本文件的），交给引擎各自分类 */
  entries: FileEntry[]
  sizeBytes: number
  /** 剥掉版本/适配 token 后的共同核心词（合并版本后名字要用它） */
  coreTokens: string[]
  /** 子项自己还是个筐（嵌套合集）：允许 Bundle > Item > Bundle > Item */
  nested: boolean
}

export interface BundlePlan {
  name: string
  coverImage?: string
  items: BundleItem[]
  /** 为什么算合集（i18n key + 参数，主进程不许回中文） */
  why: Array<{ key: string; params?: Record<string, unknown> }>
  sourceItemId: string | null
  /** 子项首词高度一致：更像"一件商品的几个部分"而不是一堆商品 */
  oneProduct: boolean
  /**
   * §B7：这个容器是**合集型**还是**归并型**。
   * `collection` = 目录名/结构说明它是一个筐（`插件道具合集-初音的VRC小店`）；
   * `merged`     = 名字没说是筐，是同一产品的多个变体被 groupKey 聚出来的（20 个 Libero）。
   * 两种在 UI 上是同一种容器卡、同一套进入式浏览，只有卡片上那行字不同。
   */
  containerKind: ContainerKind
}

function segs(rel: string): string[] {
  return rel.replace(/\\/g, '/').split('/').filter(Boolean)
}

/** 把条目从 `<前缀>/` 下往上提一层 */
function reRoot(files: FileEntry[], drop: number): FileEntry[] {
  const out: FileEntry[] = []
  for (const f of files) {
    const s = segs(f.relPath)
    if (s.length <= drop) continue
    out.push({ ...f, relPath: s.slice(drop).join('/') })
  }
  return out
}

/** 按第一层分组：直接子目录 / 合集根下的散文件 */
function groupByChild(entries: FileEntry[]): Map<string, FileEntry[]> {
  const g = new Map<string, FileEntry[]>()
  for (const e of entries) {
    const s = segs(e.relPath)
    let key: string
    let rest: string
    if (s.length >= 2) {
      key = s[0]
      rest = s.slice(1).join('/')
    } else {
      /**
       * 合集根下的单个文件：只有"本身就是一个产品"的（压缩包 / unitypackage）才立成子项，
       * 说明文件和封面图不算。漏了这条会把 SPS.zip / 佳兔工具箱.unitypackage 整批丢掉
       * （实测拆出来 4 个子项而不是 6 个，就是这个原因）。
       */
      if (!ARCHIVE_RE.test(s[0])) continue
      key = s[0]
      rest = s[0]
    }
    const list = g.get(key) ?? []
    list.push({ ...e, relPath: rest })
    g.set(key, list)
  }
  return g
}

/**
 * ID 目录穿透：`4952737/INVICTA/...` → 名字取 INVICTA，4952737 只当疑似来源。
 *
 * 只在"这一层确实只有一个非数字子目录"时穿，避免把 `6117553 xxx.rar.rar` 那种
 * 名字里带 id 的单文件误伤。
 */
function penetrateIdDir(name: string, files: FileEntry[]): { name: string; id: string | null; files: FileEntry[] } {
  if (!ID_DIR_RE.test(name)) return { name, id: null, files }
  const kids = new Set<string>()
  for (const f of files) {
    const s = segs(f.relPath)
    if (s.length >= 2 && !ID_DIR_RE.test(s[0])) kids.add(s[0])
  }
  if (kids.size !== 1) return { name, id: name, files }
  const inner = Array.from(kids)[0]
  return { name: inner, id: name, files: reRoot(files, 1) }
}

/** 名字里就写着 Booth id（`6159895摇后会喷的酒`）时，id 拿出去、名字留下 */
function splitLeadingId(name: string): { id: string | null; rest: string } {
  const m = /^(\d{5,8})[\s_\-.(【[]*(.*)$/s.exec(name)
  if (!m) return { id: null, rest: name }
  const rest = m[2] ? cleanDisplayName(m[2]).name || m[2] : ''
  return rest ? { id: m[1], rest } : { id: null, rest: name }
}

/**
 * Unity 工程里的"结构目录"：Mesh / Textures / Prefabs 这种是**一件素材的内部结构**，
 * 不是"合集里的一个子项"。不排掉它们的话 `Some_Avatar_Fullset/` 会被判成合集、
 * 拆成 Mesh + Textures + Prefabs 三个"素材" —— 等于把一件衣服撕碎。
 */
const STRUCTURE_DIR_RE =
  /^(mesh(es)?|textures?|tex|materials?|mats?|shaders?|scripts?|editor|animations?|anim|physics|prefabs?|scenes?|sounds?|aud?ios?|res|resources|fonts?|ui|base|extra|extras|other|reference|references|docs?|documentations?|instructions?|readmes?|manuals?|guides?|tutorials?|help|licenses?|licences?|thumbnails?|icons?|images?|img|plugins?|backup|backups|源文件|说明|说明书|使用说明|文档|教程|帮助|图片|贴图|模型|材质|动作|脚本|场景|语音|音效)$/i

/** 顶层和嵌套筐使用同一门槛，不能在递归时把说明/结构目录重新当成产品。 */
function usableChild(name: string, files: FileEntry[]): boolean {
  return !/^\./.test(name) && !STRUCTURE_DIR_RE.test(name) && (ARCHIVE_RE.test(name) || classifiable(files))
}

/**
 * 子项名字是不是"同一个产品的几块"（首词高度一致）。
 *
 * 旧版拿它**否决**合集拆分（实测 ABT 1.3.0 里三个分包被拆成三个顶层素材很难看）。
 * 新版不再拿它否决：改动单 §6.7 明确要求 `ABT 左手用` / `ABT 右手用` 是 2 个 Item，
 * 而"合集"现在只是一张卡、一个文件都不搬，代价几乎为零。
 * 它现在只用来做一件事：整坨看起来就是一件东西时，别把合集的置信度吹高（见 oneProductPenalty）。
 */
function looksLikeOneProduct(names: string[]): boolean {
  if (names.length < 2) return false
  const WORD_RE = /[a-z]{3,}|[㐀-䶿一-鿿ぁ-ヿ]{2,}/g
  const first = names.map((n) => (n.toLowerCase().match(WORD_RE) ?? [''])[0])
  const usable = first.filter(Boolean)
  if (usable.length < 2) return false
  const counts = new Map<string, number>()
  for (const f of usable) counts.set(f, (counts.get(f) ?? 0) + 1)
  const top = Array.from(counts.values()).sort((a, b) => b - a)[0] ?? 0
  return top / names.length >= 0.6
}

/** 版本号比较在 shared/version.ts（渲染进程和落库都要同一口径） */

/** 只去掉"确实是压缩包"的扩展名；`GoLoco.v.1.8.6u` 这种结尾像扩展名的不能碰 */
function dropArchiveExt(name: string): string {
  const m = /\.(zip|rar|7z|tar|gz|tgz|unitypackage)$/i.exec(name)
  return m ? name.slice(0, m.index) : name
}

/**
 * 把"同一个产品的几个版本"合成一个子项（改动单 §2.3）。
 *
 * 归并键 = 剥掉 avatar / install_method / version / locale 之后的核心词，
 * 所以 `Grimoir_SHINANO_V1.0` 和 `Grimoir_MANUKA_V1.0` 合成一项（11 个 avatar 变体），
 * 而 `Grimoir_Hat` / `Grimoir_Gimmick` 核心词不同，各自成项（用户点名不许误并的那条）；
 * `ABT 左手用` / `ABT 右手用` 里"左手/右手"不在词表里 → 留在核心词 → 2 个 Item。
 *
 * @param parent 这些候选所在的目录（相对合集根）；'' = 合集根
 */
function mergeVersions(
  parent: string,
  candidates: Candidate[],
  lex: ClassifyDeps['lex']
): BundleItem[] {
  const byKey = new Map<string, BundleItem>()
  for (const c of candidates) {
    const t = deriveGroupKey(c.rawName, lex)
    const v: BundleVersion = {
      rawName: c.rawName,
      relPath: c.relPath,
      sizeBytes: c.files.reduce((a, f) => a + (f.isDir ? 0 : f.size), 0),
      version: t.version,
      avatar: t.avatar,
      installMethod: t.installMethod,
      locale: t.locale,
      variantRaw: t.variantRaw[0] ?? null,
      avatars: t.avatars
    }
    const showName = splitLeadingId(c.name)
    const existing = byKey.get(t.groupKey)
    if (existing) {
      existing.versions.push(v)
      existing.rawNames.push(c.rawName)
      existing.entries.push(...c.files)
      existing.sizeBytes += v.sizeBytes
      existing.sourceItemId = existing.sourceItemId ?? c.id ?? showName.id
      continue
    }
    byKey.set(t.groupKey, {
      // 展示名不许带压缩包后缀：三个 StoZeroCustomEX*.zip 合成一项后名字该是 StoZeroCustomEX
      name: dropArchiveExt(showName.rest || c.name),
      rawNames: [c.rawName],
      // 单个版本 → 指到那个文件；多个版本 → 指到它们共同的目录
      relPath: c.relPath,
      groupKey: t.groupKey,
      sourceItemId: c.id ?? showName.id,
      versions: [v],
      entries: [...c.files],
      sizeBytes: v.sizeBytes,
      coreTokens: t.core,
      nested: false
    })
  }
  const items = Array.from(byKey.values())
  for (const it of items) {
    it.versions.sort((a, b) => compareVersionDesc(a.version, b.version))
    if (it.versions.length > 1) {
      it.relPath = parent
      /**
       * 并了版本之后名字要回到"共同核心词"：11 个 `Grimoir_XXX_V1.0` 合成一项后
       * 该叫 `Grimoir`，不能留着第一个成员的名字（实测显示成 `Grimoir_AIRI_V1.0`）。
       * 只有一件东西时反过来 —— 保留磁盘上的原名，用户按名字找文件才对得上。
       */
      const core = it.coreTokens.join(' ').trim()
      if (core) it.name = core
    }
    /** 目录型子项 = 内容还在一个文件夹里；压缩包型 = 单个文件 */
    it.nested = !ARCHIVE_RE.test(it.relPath.split('/').pop() ?? '')
  }
  return items
}

/**
 * 把一个"直接子项"摊平成候选文件列表。
 *
 * 递归进子目录的门槛要严：普通素材目录长这样 `Mesh/ Textures/ Prefabs/`，
 * 一进去就拆成三个子项等于把一件衣服撕碎。所以只有
 * ① 目录名自己就是容器名（`道具22件`、`更新`、`プラグイン17件`）或写着合集，
 * ② 或者里面直接躺着 ≥2 个压缩包（一个文件夹装几个不同产品 / 几个版本）
 * 才往下拆。
 */
interface Candidate {
  /** 展示名（穿透 ID 目录后的那个真名） */
  name: string
  /** 归并用的原始名（带扩展名、带版本 token） */
  rawName: string
  /** 相对合集根 */
  relPath: string
  files: FileEntry[]
  id: string | null
}

const MAX_NEST_DEPTH = 3

function flattenChild(childName: string, files: FileEntry[], depth: number): Candidate[] {
  if (!usableChild(childName, files)) return []
  const directArchives: FileEntry[] = []
  const subDirs = new Map<string, FileEntry[]>()
  for (const f of files) {
    const s = segs(f.relPath)
    if (s.length === 1) {
      if (ARCHIVE_RE.test(s[0]) && !/^\./.test(s[0])) directArchives.push(f)
      continue
    }
    if (/^\./.test(s[0])) continue
    const list = subDirs.get(s[0]) ?? []
    list.push({ ...f, relPath: s.slice(1).join('/') })
    subDirs.set(s[0], list)
  }

  const containerHere = depth < MAX_NEST_DEPTH && (CONTAINER_RE.test(childName) || BUNDLE_NAME_RE.test(childName))
  const multiProduct = directArchives.length >= 2
  /** 一整目录 = 一件东西（GoLoco.v.1.8.6u/ 里躺着一个同名 unitypackage 就是这种） */
  if (!containerHere && !multiProduct) {
    return [{ name: childName, rawName: childName, relPath: childName, files, id: null }]
  }

  const out: Candidate[] = []
  for (const a of directArchives) {
    const s = segs(a.relPath)
    out.push({ name: s[s.length - 1], rawName: s[s.length - 1], relPath: [childName, ...s].join('/'), files: [a], id: null })
  }
  if (containerHere) {
    for (const [dir, kidFiles] of subDirs) {
      const p = penetrateIdDir(dir, kidFiles)
      for (const c of flattenChild(p.name, p.files, depth + 1)) {
        out.push({ ...c, relPath: [childName, dir, c.relPath].join('/'), id: c.id ?? p.id })
      }
    }
  }
  if (out.length) return out
  // 筐里直接存着 prefab/mat 等散装素材时仍保留它；只有被排除的子目录时不回退成假产品。
  const directFiles = files.filter((f) => segs(f.relPath).length === 1)
  return classifiable(directFiles) ? [{ name: childName, rawName: childName, relPath: childName, files, id: null }] : []
}

/**
 * 第 10 轮 C（他 2026-10-10 批的 Q2 甲）：这个名字是**筐**还是**一件商品**？
 *
 * 判据只有形状这一条：**`CONTAINER_RE` 命中、而 `BUNDLE_NAME_RE` 没命中**。
 *
 *  - `道具22件` / `ERP用12件` / `插件17件` / `更新` / `重要！` → **筐**：
 *    下面装的是各家的东西，它自己不该成为一张卡（他的原话：
 *    「明明这个文件夹的名字都叫道具22件了，那就意味着这是 22 件不同厂家出的道具」）。
 *  - `插件道具合集-初音的VRC小店` / `○○セット` → **不是筐**，是卖家打包卖的一件商品 →
 *    照旧建一张合集卡（02 号 §验收 5 那条没被推翻，被推翻的只是"筐也当一张卡"）。
 *
 * ⚠ 和"同一件衣服的多个素体适配"**完全无关** —— 那条走 `groupKey`（`containerKind='merged'`），
 * 20 个 Libero 该并成一张卡，这条判据一点不着它。反向夹具里必须留着它。
 */
export function isBasketOnlyName(name: string | null | undefined): boolean {
  const s = (name ?? '').trim()
  if (!s) return false
  return CONTAINER_RE.test(s) && !BUNDLE_NAME_RE.test(s)
}

/**
 * 只看**名字**的合集判据（§2.1 的 ①③）。
 * 刻意不含"子项 ≥3"那条 —— 那条要靠看内容，否则库根的 `贴图/皮肤` 会因为
 * 里面有三件素材就被当成合集（那是分类结构，不是筐）。
 */
export function isCollectionName(name: string): boolean {
  return BUNDLE_NAME_RE.test(name) || CONTAINER_RE.test(name)
}

/**
 * 只看名字的合集判据（§2.1 的 ①③），给「重新整理合集」这类**没有包内清单**的场合用。
 * planBundle 能看条目内容，这个只能看目录名 + 子项数，所以门槛放严一点：
 * 名字写着合集/容器词，或者同目录下 ≥3 个兄弟，才算这个目录是个筐。
 */
export function looksLikeBundleDir(dirName: string, siblingCount: number): boolean {
  return BUNDLE_NAME_RE.test(dirName) || CONTAINER_RE.test(dirName) || siblingCount >= 3
}

export function planBundle(ingest: IngestResult, deps: ClassifyDeps): BundlePlan | null {
  const entries = ingest.entries
  if (entries.length < 2) return null

  const groups = groupByChild(entries)
  const nameSaysBundle =
    BUNDLE_NAME_RE.test(ingest.rawName) || ingest.sourceDirChain.some((d) => BUNDLE_NAME_RE.test(d))
  const containerName = CONTAINER_RE.test(ingest.rawName) || ingest.sourceDirChain.some((d) => CONTAINER_RE.test(d))

  /** 结构目录（Mesh/Textures/…）不算"子项"，否则一件衣服会被判成合集 */
  const usable = Array.from(groups.entries()).filter(([name, files]) => usableChild(name, files))
  /** 名字写着合集 / 是容器名时 2 个子项就够（`4952737/INVICTA` + `4185283/M4A1` 这种两个商品的合集） */
  const minChildren = nameSaysBundle || containerName ? 2 : 3
  if (usable.length < minChildren) return null

  const why: BundlePlan['why'] = []
  if (nameSaysBundle) why.push({ key: 'classify.whyBundleName' })
  if (containerName) why.push({ key: 'classify.whyBundleContainer' })
  if (!why.length) why.push({ key: 'classify.whyBundleCount', params: { count: usable.length } })

  /**
   * 先摊平（含 ID 目录穿透），再**按所在目录分组**做版本归并。
   * 跨层归并会把 `ERP用12件/DPS.zip` 和 `道具16件/DPS.zip` 并成一项，
   * 名字对了但路径丢一半 —— 那种"看着更整齐其实更错"的事不能干。
   */
  const byParent = new Map<string, Candidate[]>()
  for (const [name, files] of usable) {
    if (ARCHIVE_RE.test(name)) {
      const list = byParent.get('') ?? []
      list.push({ name, rawName: name, relPath: name, files, id: null })
      byParent.set('', list)
      continue
    }
    const p = penetrateIdDir(name, files)
    for (const c of flattenChild(p.name, p.files, 0)) {
      const parent = c.relPath.split('/').slice(0, -1).join('/')
      const list = byParent.get(parent) ?? []
      list.push({ ...c, name: p.name === c.name ? splitLeadingId(c.name).rest || c.name : c.name, id: c.id ?? p.id })
      byParent.set(parent, list)
    }
  }

  const items: BundleItem[] = []
  for (const [parent, cands] of byParent) {
    for (const it of mergeVersions(parent, cands, deps.lex)) items.push(it)
  }
  /**
   * 合集里到底有几件东西：子项数 + 多版本带来的版本数。
   * 只剩"1 个 Item / 1 个版本"说明这目录本来就是一件素材，别硬套合集。
   */
  const things = items.reduce((a, i) => a + i.versions.length, 0)
  if (items.length < 1 || things < 2) return null
  items.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))

  /** 合集封面优先用**根目录**那张图，别拿子产品里的图 */
  const rootImages = entries.filter((e) => !e.isDir && /\.(png|jpe?g|webp)$/i.test(e.relPath) && !e.relPath.includes('/'))
  const cover = rootImages.length === 1 ? rootImages[0].relPath : (rootImages[0]?.relPath ?? ingest.metadata.previewImages[0])
  const ownId = items.find((i) => i.sourceItemId)?.sourceItemId ?? null

  return {
    name: cleanDisplayName(ingest.rawName).name || ingest.rawName.replace(/\.[^.]+$/, ''),
    coverImage: cover,
    items,
    why,
    sourceItemId: ownId,
    /** 首词全一样 → 很可能是一件商品的几个部分，合集自己那行的置信度要降一档 */
    oneProduct: looksLikeOneProduct(usable.map(([n]) => n)),
    /**
     * 名字/结构没说它是筐，却仍然聚出了一堆同 groupKey 的变体 → 这是**归并型**容器。
     * 20 个 Libero 走的就是这条：`名流` 这个目录名一点没提"合集"。
     */
    containerKind: nameSaysBundle || containerName ? 'collection' : 'merged'
  }
}
