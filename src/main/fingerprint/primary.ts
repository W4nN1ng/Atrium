/**
 * 容器里的「主体」与「附属资源」（增量改动单 2 §A2 / §A5）。
 *
 * 背景是真库里的 `6866030亲亲音效+亲吻时产生爱心粒子/`：1 个 zip + 1 个解压目录 +
 * 3 张介绍图 + 1 个演示 mp4。旧实现把 3 张图和 mp4 当成 4 个独立素材扫进库，
 * 封面那张还顶着 `d6b99874-… base resized` 这种 UUID 名占了一张卡。
 * 现在：主体只有一件，附属挂到它下面当子行，一张卡都不多给。
 *
 * 纯函数：输入是列好的条目清单（目录或压缩包内部都适用），不碰 fs。
 * relPath 的分隔符两种都认 —— 目录遍历给的是 `\`，zip 清单给的是 `/`，
 * 这里统一切开再拼，不然 `firstSeg` 在 Windows 路径上会返回 null（踩过）。
 */
import type { FileEntry } from '../../shared/types'
import {
  attachmentKindOf,
  isArchiveFileName,
  isCodeFileName,
  isCompanionFileName,
  isJunkRelPath,
  isPrimaryFileName,
  type AttachmentKind
} from '../../shared/junk'

export type PrimaryKind = 'unitypackage' | 'unity_project' | 'assets_dir' | 'upm' | 'archive' | null

export interface AttachmentRef {
  relPath: string
  kind: AttachmentKind
  size: number
}

export interface ContainerSplit {
  /** 主体条目；null = 这容器里没有主体 */
  primary: FileEntry[] | null
  primaryKind: PrimaryKind
  /** 主体所在的那一层（散在容器根上时为 null） */
  primaryRoot: string | null
  /** 附属资源（§A2 表）；主体内部的图不算附属 */
  attachments: AttachmentRef[]
  /** 既不是主体、不是附属、也不是代码的其余文件（.zip 壳 / .meta / package.json…） */
  others: FileEntry[]
  /** §A5 第一条：整个容器全是图片/文档 → 1 个「参考资料」素材，一张卡不是 N 张 */
  allAttachments: boolean
  /** §A5 + 裁定 11：只有代码/文档（`Editor/` 那种）→ 整体 1 个单元，不孤立成卡 */
  codeOnly: boolean
}

function segs(rel: string): string[] {
  return rel.split(/[\\/]/).filter(Boolean)
}

function base(rel: string): string {
  const s = segs(rel)
  return s[s.length - 1] ?? rel
}

/** 第一层目录名；文件直接躺在容器根上时返回 null */
function firstSeg(rel: string): string | null {
  const s = segs(rel)
  return s.length >= 2 ? s[0] : null
}

/** 目录里有没有 Assets/ 和 ProjectSettings/（完整 Unity 工程，§A2 优先级 2） */
function projectRoots(entries: FileEntry[]): Set<string> {
  const roots = new Set<string>()
  const seen = new Map<string, Set<string>>()
  for (const e of entries) {
    const s = segs(e.relPath)
    if (s.length < 2) continue
    let sub = seen.get(s[0])
    if (!sub) {
      sub = new Set()
      seen.set(s[0], sub)
    }
    sub.add(s[1])
  }
  for (const [root, sub] of seen) if (sub.has('Assets') && sub.has('ProjectSettings')) roots.add(root)
  return roots
}

/** UPM 包：package.json + Editor/*.cs（§A2 优先级 5） */
function upmRoots(entries: FileEntry[]): Set<string> {
  const pkgs = new Set<string>()
  const editors = new Set<string>()
  for (const e of entries) {
    const s = segs(e.relPath)
    if (s.length === 2 && s[1] === 'package.json') pkgs.add(s[0])
    if (s.length >= 3 && s[1] === 'Editor' && isCodeFileName(s[s.length - 1])) editors.add(s[0])
  }
  const out = new Set<string>()
  for (const r of pkgs) if (editors.has(r)) out.add(r)
  return out
}

export function splitContainer(entries: FileEntry[]): ContainerSplit {
  const live = entries.filter((e) => !e.isDir && !isJunkRelPath(e.relPath))

  const primaries: FileEntry[] = []
  const codes: FileEntry[] = []
  const archives: FileEntry[] = []
  for (const e of live) {
    const n = base(e.relPath)
    if (isPrimaryFileName(n)) primaries.push(e)
    /**
     * .cs.meta / package.json 这类伴生文件跟着脚本一起算 code。
     * 真库 `E:\vrc\A\Editor\` 是 2 个 .cs + 2 个 .cs.meta（实读）——
     * 少了这一条 codeOnly 判不出来，那一个目录又散成 4 张卡（验收 4）。
     */
    else if (isCodeFileName(n) || isCompanionFileName(n)) codes.push(e)
    else if (isArchiveFileName(n)) archives.push(e)
  }

  const proj = projectRoots(live)
  const upm = upmRoots(live)
  /**
   * 主体目录下的条目。有一条例外：**直接躺在主体目录根上的图/文档算附属介绍图**，
   * 再往里一层的（`Assets/Textures/icon.png`、`ProjectSettings/ProjectVersion.txt`）才算主体的一部分。
   * 没有这条例外，`Outfit/preview.jpg` 会被整个吞进主体，改动单 2 §A0 的封面图问题只修了一半。
   */
  const under = (root: string): FileEntry[] =>
    live.filter((e) => {
      const s = segs(e.relPath)
      if (s[0] !== root) return false
      return !(s.length === 2 && attachmentKindOf(s[1]) !== null)
    })

  let primary: FileEntry[] | null = null
  let primaryKind: PrimaryKind = null
  let primaryRoot: string | null = null

  // 优先级 1：unitypackage 文件
  const upkgs = primaries.filter((e) => /\.unitypackage$/i.test(base(e.relPath)))
  if (upkgs.length) {
    primaryRoot = firstSeg(upkgs[0].relPath)
    primaryKind = 'unitypackage'
    // 同层的 unitypackage 全算主体（一个包出好几个 .unitypackage 是常态：本体 + 补丁）
    primary = primaryRoot ? upkgs.filter((e) => segs(e.relPath)[0] === primaryRoot) : upkgs
  } else if (proj.size) {
    // 优先级 2：完整 Unity 工程目录
    primaryRoot = Array.from(proj)[0]
    primaryKind = 'unity_project'
    primary = under(primaryRoot)
  } else if (upm.size) {
    // 优先级 5 提到 3 前面：UPM 包比"含 prefab 的目录"更精确
    primaryRoot = Array.from(upm)[0]
    primaryKind = 'upm'
    primary = under(primaryRoot)
  } else {
    // 优先级 3：含 prefab/mat/shader/fbx/anim/controller 的目录，取最浅那层
    const assetDirs = new Set<string>()
    for (const e of primaries) {
      const r = firstSeg(e.relPath)
      if (r) assetDirs.add(r)
    }
    if (assetDirs.size) {
      primaryRoot = Array.from(assetDirs)[0]
      primaryKind = 'assets_dir'
      primary = under(primaryRoot)
    } else if (primaries.length) {
      // 散着躺在容器根上的资产文件
      primary = primaries
      primaryKind = 'assets_dir'
      primaryRoot = null
    } else if (archives.length) {
      // 优先级 4：主体还在压缩包里（内层清单由 worker 的 dig 逻辑负责看）
      primaryRoot = firstSeg(archives[0].relPath)
      primaryKind = 'archive'
      primary = archives
    }
  }

  const inPrimary = new Set((primary ?? []).map((e) => e.relPath))
  const codeSet = new Set(codes.map((e) => e.relPath))
  const attachments: AttachmentRef[] = []
  const others: FileEntry[] = []
  for (const e of live) {
    // 主体内部的贴图/图标是主体的一部分，不是"附属介绍图"
    if (inPrimary.has(e.relPath)) continue
    const kind = attachmentKindOf(base(e.relPath))
    if (kind) attachments.push({ relPath: e.relPath, kind, size: e.size })
    else if (!codeSet.has(e.relPath)) others.push(e)
  }

  const hasPrimary = primary !== null
  const attachSet = new Set(attachments.map((a) => a.relPath))
  const rest = live.filter((e) => !inPrimary.has(e.relPath))
  const onlyKinds = rest.every((e) => attachSet.has(e.relPath) || codeSet.has(e.relPath))
  return {
    primary,
    primaryKind,
    primaryRoot,
    attachments,
    others,
    allAttachments: !hasPrimary && live.length > 0 && rest.every((e) => attachSet.has(e.relPath)),
    codeOnly: !hasPrimary && codes.length > 0 && onlyKinds
  }
}
