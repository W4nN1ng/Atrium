/**
 * 垃圾文件与附属资源的判定（增量改动单 2 §A1 / §A2）。
 *
 * 放 shared 是因为三处都要用、且口径必须一致：
 *   1. 游离扫描（health.findStrays）—— 不然 `.DS_Store` 会被当成"插件/动作类"素材（真库实测）
 *   2. 监视文件夹（services/watcher）—— 不然下载一半的 `.part` 会排进取物队列
 *   3. 解压/列清单之后的条目（ingest worker）—— 不然 `__MACOSX/` 里的碎片会进分类语料
 * 任何一处漏了，垃圾就会从别的门进来（改动单 2 明确要求三处都进）。
 *
 * 这里全是纯函数：不碰 fs，只认路径字符串，好测。
 */

/** 系统/编辑器垃圾：整棵子树都不看 */
const JUNK_DIRS = new Set(['__macosx', '.git', '.svn', '.hg', '$recycle.bin', 'system volume information'])

/** 单文件垃圾 */
const JUNK_NAMES = new Set(['.ds_store', 'thumbs.db', 'desktop.ini', 'ehthumbs.db', '.spotlight-v100', '.trashes'])

/** Office 锁文件：~$xxx.docx */
const OFFICE_LOCK_RE = /^~\$/

/** 临时/半成品后缀 */
const JUNK_EXT_RE = /\.(tmp|temp|crdownload|download|part|partial|bak~|swp|swo)$/i

/** macOS 的 AppleDouble 伴生文件：._foo.png */
const APPLE_DOUBLE_RE = /^\._/

/** 单个路径段是不是垃圾 */
export function isJunkSegment(name: string): boolean {
  const n = name.toLowerCase()
  if (JUNK_DIRS.has(n)) return true
  if (JUNK_NAMES.has(n)) return true
  if (OFFICE_LOCK_RE.test(name)) return true
  if (APPLE_DOUBLE_RE.test(name)) return true
  if (JUNK_EXT_RE.test(n)) return true
  return false
}

/**
 * 相对路径里**任何一段**是垃圾就算垃圾。
 * `__MACOSX/foo/png` 这种要整枝掐掉，只看末段会漏。
 */
export function isJunkRelPath(rel: string): boolean {
  return rel.split(/[\\/]/).some((seg) => seg !== '' && isJunkSegment(seg))
}

export function isJunkAbsPath(abs: string): boolean {
  return isJunkRelPath(abs.replace(/\\/g, '/'))
}

// ---------------------------------------------------------------- 附属资源（§A2）

export type AttachmentKind = 'image' | 'video' | 'doc' | 'link' | 'source' | 'audio'

const ATTACH_EXT: Record<AttachmentKind, RegExp> = {
  image: /\.(jpe?g|png|gif|webp|bmp|tga)$/i,
  video: /\.(mp4|webm|mov|avi)$/i,
  doc: /\.(txt|md|pdf|html?|rtf)$/i,
  link: /\.url$/i,
  source: /\.(psd|psb|aseprite|blend)$/i,
  audio: /\.(wav|mp3|ogg|flac)$/i
}

/** 附属资源类型；不是附属返回 null。`.url` 也是附属，但它同时是 Booth ID 的来源，别丢 */
export function attachmentKindOf(name: string): AttachmentKind | null {
  for (const [kind, re] of Object.entries(ATTACH_EXT)) {
    if (re.test(name)) return kind as AttachmentKind
  }
  return null
}

/**
 * 主体候选：Unity 资产/工程/包（§A2 的优先级 1/2/3/5 靠这些扩展名与目录特征判）。
 * **`.cs` 不在这里** —— 光有脚本不算主体（`Editor/SkinnedMeshMover.cs` 单独成卡就是 05 §A0
 * 点名的事故）。脚本要么跟着 package.json 组成 UPM 包，要么整个目录按 codeOnly 收成一个单元。
 */
const PRIMARY_EXT_RE =
  /\.(unitypackage|prefab|mat|shader|shadergraph|fbx|obj|anim|controller|asset|mask|playable|asmdef|unity)$/i

export function isPrimaryFileName(name: string): boolean {
  return PRIMARY_EXT_RE.test(name)
}

/** 代码/文档型目录（裁定 11：`Editor/` 里只有 .cs 时整体算 1 个 tool/reference，不孤立成卡） */
const CODE_EXT_RE = /\.(cs|js|ts|py|lua|hlsl|cginc|glsl)$/i
export function isCodeFileName(name: string): boolean {
  return CODE_EXT_RE.test(name)
}

/**
 * 脚本/包的伴生文件：跟着 .cs 一起算「代码」，不算"别的东西"。
 *
 * 真库 `E:\vrc\A\Editor\` 里是 2 个 .cs 加 2 个 .cs.meta（实读）。少这一条，
 * .meta 会让 codeOnly 判定落空，那一个目录又散成 4 张卡 —— 验收 4 说的就是它。
 *
 * 判定只写在这一处：原先 health.contentKind 里自己有一份、primary.splitContainer
 * 里压根没有，同一个目录会出现"一处算 code、一处算 mixed"的分歧。
 */
const COMPANION_EXT_RE =
  /\.(json|meta|xml|ya?ml|asmdef|asmref|hlsl|cginc|glsl|shadersubgraph|uxml|uss|ini|cfg|config|props|targets)$/i

export function isCompanionFileName(name: string): boolean {
  return COMPANION_EXT_RE.test(name)
}

/** 压缩包壳（§A2 优先级 4：主体可能在里面，得先 dig 一层再判） */
const ARCHIVE_EXT_RE = /\.(zip|rar|7z|tar|gz|tgz|bz2|xz)$/i
export function isArchiveFileName(name: string): boolean {
  return ARCHIVE_EXT_RE.test(name)
}
