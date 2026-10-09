/**
 * 硬规则（第 2 份 §1.1）—— 看"文件清单长什么样"，不看文件名像什么。
 *
 * 规格明说：这些优先级高于任何关键词打分，命中即 confidence 0.95。
 * 但硬规则**只定一级分类和 content_type**，二级仍要回词典（§5.3 Step 1 的原话）。
 */
import type { ContentType, FileEntry } from '../../shared/types'

export interface HardRuleHit {
  /** 命中的规则名，进 reason 用（'含 .shader 文件'） */
  rule: string
  contentType: ContentType
  /** 一级分类 key；null = 只给了内容类型，分类还要靠语料 */
  category: string | null
  /** 硬规则能不能直接定二级 */
  subDecided: boolean
  /** 命中证据条数，UI 上可以显示"含 3 个 .shader" */
  count: number
  /** 0.95 = 规格给硬规则的档位；0 表示没命中 */
  confidence: number
}

const has = (files: FileEntry[], re: RegExp): boolean => files.some((f) => !f.isDir && re.test(f.relPath))
const countOf = (files: FileEntry[], re: RegExp): number => files.filter((f) => !f.isDir && re.test(f.relPath)).length
const hasDir = (files: FileEntry[], name: string): boolean =>
  files.some((f) => f.isDir && new RegExp('(^|[\\\\/])' + name + '[\\\\/]?$').test(f.relPath)) ||
  files.some((f) => new RegExp('(^|[\\\\/])' + name + '[\\\\/]', 'i').test(f.relPath))

const IMAGE_RE = /\.(png|jpe?g|tga|psd|bmp|webp|gif|exr|hdr)$/i
const MODEL_RE = /\.(fbx|obj|blend|prefab)$/i
const ANIM_RE = /\.(anim|controller|overridecontroller|motion|playable)$/i
const AUDIO_RE = /\.(wav|mp3|ogg|flac|aiff?)$/i
const SHADER_RE = /\.(shader|cginc|hlsl|shadergraph)$/i
const CODE_RE = /\.(cs|dll)$/i
const DOC_RE = /\.(pdf|html?|txt|md|docx?|epub)$/i

/** §1.1 表格里"完整 Unity 工程"的判据：Assets/ + ProjectSettings/ProjectVersion.txt */
export function isUnityProject(files: FileEntry[]): boolean {
  return hasDir(files, 'Assets') && has(files, /ProjectSettings\/ProjectVersion\.txt$/i)
}

/** "Unity 插件包"：package.json + Editor/*.cs 或 *.asmdef */
export function isUpmPackage(files: FileEntry[]): boolean {
  const hasManifest = has(files, /(^|\/)package\.json$/i)
  const hasEditorCs = has(files, /(^|\/)Editor\/.*\.cs$/i)
  const hasAsmdef = has(files, /\.asmdef$/i)
  return hasManifest && (hasEditorCs || hasAsmdef)
}

/** 物理类插件信号（§1.1 启发式 2）：prefab / cs 名字里带这些引擎 */
const PHYSICS_RE = /(dynamicbone|physbone|magicacloth|vampirephysics|springbone)/i
export function looksLikePhysicsPlugin(files: FileEntry[]): boolean {
  return countOf(files, PHYSICS_RE) >= 1 && (has(files, MODEL_RE) || has(files, CODE_RE))
}

/**
 * 头发信号（启发式 4）：有 FBX 且名字带 Hair / 髪 / ヘア。
 * 注意这是"一级=头发"，不是"插件"。
 */
export function looksLikeHairModel(files: FileEntry[]): boolean {
  return files.some((f) => /\.fbx$/i.test(f.relPath) && /(hair|髪|ヘア)/i.test(f.relPath))
}

/** 材质包（启发式 5）：.mat 数量 > 20 且没有 FBX */
export function looksLikeMaterialPack(files: FileEntry[]): boolean {
  return countOf(files, /\.mat$/i) > 20 && countOf(files, /\.fbx$/i) === 0
}

const NO_HIT: HardRuleHit = {
  rule: '',
  contentType: 'unknown',
  category: null,
  subDecided: false,
  count: 0,
  confidence: 0
}

/**
 * 主入口：按 §1.1 表格从上往下判，先强后弱。
 * 返回 NO_HIT（confidence 0）时调用方继续走词典打分。
 */
export function applyHardRules(files: FileEntry[], nameHints = ''): HardRuleHit {
  const total = files.filter((f) => !f.isDir).length
  if (!total) return NO_HIT

  if (isUnityProject(files)) {
    return hit('含 Assets/ + ProjectSettings/ProjectVersion.txt', 'unity_project', 'tool', true, total)
  }
  if (isUpmPackage(files)) {
    return hit('含 package.json + Editor 脚本 / .asmdef', 'unity_upm_package', 'plugin', false, total)
  }
  const shaders = countOf(files, SHADER_RE)
  if (shaders > 0) {
    return hit(`含 ${shaders} 个着色器文件`, 'shader', 'shader', false, shaders)
  }
  const anims = countOf(files, ANIM_RE)
  const models = countOf(files, MODEL_RE)
  const imgs = countOf(files, IMAGE_RE)
  const docCount = countOf(files, DOC_RE)
  if (anims > 0 && models === 0) {
    return hit(`含 ${anims} 个动画/控制器文件`, 'animation', 'animation', false, anims)
  }
  if (looksLikeMaterialPack(files)) {
    return hit(`含 ${countOf(files, /\.mat$/i)} 个 .mat 且无 FBX`, 'material', 'material', false, total)
  }
  // 头发要排在通用"有模型"那条前面，否则永远轮不到（§1.1 启发式 4）
  if (looksLikeHairModel(files)) {
    return hit('FBX 名字含 Hair/髪/ヘア', 'model', 'hair', true, models)
  }
  if (models > 0) {
    // 模型/服装/配饰的一级靠关键词 —— 交回词典，这里只定 content_type
    return { ...hit(`含 ${models} 个模型/预制体文件`, 'model', null, false, models), subDecided: false }
  }
  const auds = countOf(files, AUDIO_RE)
  if (auds > 0 && auds >= total * 0.5) {
    return hit(`音频文件占 ${auds}/${total}`, 'audio', 'audio', false, auds)
  }
  if (looksLikePhysicsPlugin(files)) {
    return hit('含 DynamicBone/PhysBone/MagicaCloth 字样', 'bundle', 'plugin', false, total)
  }
  if (imgs === total) {
    if (docCount > 0) return hit('只有图片 + 文档', 'reference', 'reference', false, total)
    return hit('只有图片', 'texture', 'texture', false, imgs)
  }
  if (imgs > 0 && imgs >= total * 0.7 && docCount === 0) {
    return hit(`图片占 ${imgs}/${total}`, 'texture', 'texture', false, imgs)
  }
  const exes = countOf(files, /\.(exe|msi)$/i)
  if (exes > 0) {
    return hit(`含 ${exes} 个可执行文件`, 'tool', 'tool', false, exes)
  }
  const dlls = countOf(files, /\.dll$/i)
  if (dlls > 0 && has(files, /(^|\/)Editor\//i)) {
    return hit('含 Editor/ 目录 + .dll/.cs', 'unity_upm_package', 'plugin', false, total)
  }
  if (docCount > 0 && docCount >= total * 0.5) {
    return hit(`文档占 ${docCount}/${total}`, 'reference', 'reference', false, docCount)
  }
  // 只有 .unitypackage 的情况交给调用方递归解析后再判（§1.1 表格第 4 行）
  const pkgs = countOf(files, /\.unitypackage$/i)
  if (pkgs > 0) {
    return { ...NO_HIT, rule: `含 ${pkgs} 个 .unitypackage（需递归解析）`, contentType: 'bundle', count: pkgs }
  }
  return NO_HIT
}

function hit(rule: string, contentType: ContentType, category: string | null, subDecided: boolean, count: number): HardRuleHit {
  return { rule, contentType, category, subDecided, count, confidence: 0.95 }
}

/** 给 reason 用的一句话（§5.3 要求 reason 非空且是人话） */
export function describeHardHit(h: HardRuleHit, nameHints: string): string {
  if (!h.rule) return ''
  return h.category
    ? `硬规则命中：${h.rule} → 判为「${h.category}」${nameHints ? '；' + nameHints : ''}`
    : `硬规则命中：${h.rule}（二级分类靠关键词）`
}
