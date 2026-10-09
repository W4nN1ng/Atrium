/**
 * 分类目录别名（已批准的裁定："归档分类优先尊重用户自建目录"）
 *
 * 用户真库顶层现在是：插件 / 衣服 / 贴图 / Editor / lilToon_1.x.x / …
 * 而分类表里 clothing 的中文名是"服装"。直接按分类表渲染，就会在他的
 * `衣服` 旁边再建一个 `服装`，同一个东西分两处 —— 比不整理还糟。
 *
 * 做法：先看库根里已经有哪些顶层目录，能对上某个分类的（本名或别名），
 * 归档就用那个已有名字。
 */
import fs from 'node:fs'
import path from 'node:path'
import type { CategoryConfig } from '../../shared/types'
import { normalizeForCompare } from '../security/paths'

/**
 * 分类 key → 常见的用户自建叫法（含日文），只放没有歧义的。
 *
 * 这是**内置兜底**；R4 ④ 之后同一批词汇也进了 `categories.json` 的 `synonyms`
 * （那边管检索，这边管归档落点）。两边取并集，见 `resolveDirNames` 里那段注释。
 */
const ALIASES: Record<string, string[]> = {
  clothing: ['衣服', '服', '衣装', 'クローズ', 'ウェア', 'clothes', 'cloth'],
  hair: ['头发', '髪', '发型', 'ヘア', 'ヘアー', 'hair'],
  accessory: ['配饰', '饰品', 'アクセ', 'アクセサリー', 'accessory', '小物'],
  texture: ['贴图', '纹理', 'テクスチャ', 'texture', 'textures'],
  material: ['材质', 'マテリアル', 'material'],
  shader: ['着色器', 'シェーダー', 'shader'],
  plugin: ['插件', 'プラグイン', 'plugin', 'plugins', '脚本'],
  animation: ['动画', '动作', 'アニメ', 'モーション', 'animation'],
  audio: ['音频', '音效', '音声', 'sound', 'audio', 'se'],
  prop: ['道具', '小道具', 'プロップ', 'prop', 'props'],
  world: ['场景', '世界', '地图', 'ワールド', 'world', 'map'],
  tool: ['工具', '软件', 'ツール', 'tool', 'tools', 'editor工具'],
  reference: ['参考', '资料', '文档', 'リファレンス', 'reference', 'docs'],
  model: ['模型', 'アバター', 'モデル', 'model', 'avatar'],
  other: ['其他', '其它', '未分类', 'misc', 'other']
}

export interface DirAliasResult {
  /** category key → 实际要用的目录名（可能是用户已有的叫法） */
  names: Record<string, string>
  /** 哪些分类改用了别名目录（设置页要能让用户看见） */
  reused: Array<{ category: string; dir: string }>
}

/**
 * @param libraryRoot 库根；不存在或读不到时原样返回分类表的名字
 */
export function resolveDirNames(
  libraryRoot: string | null,
  base: Record<string, string>,
  cfg: CategoryConfig
): DirAliasResult {
  const names = { ...base }
  const reused: DirAliasResult['reused'] = []
  if (!libraryRoot) return { names, reused }

  let existing: string[]
  try {
    existing = fs
      .readdirSync(libraryRoot, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
  } catch {
    return { names, reused }
  }

  // 先按分类表本名配（他要是本来就用"服装"，一个都不用换）
  const taken = new Set<string>()
  for (const [key, label] of Object.entries(base)) {
    const hit = existing.find((d) => normalizeForCompare(d) === normalizeForCompare(label))
    if (hit) {
      names[key] = hit
      taken.add(normalizeForCompare(hit))
    }
  }
  // 再按别名配（内置那份 + 分类表里用户自己写的口语，取并集）
  for (const key of Object.keys(base)) {
    if (taken.has(normalizeForCompare(names[key]))) continue
    const words = [...(ALIASES[key] ?? []), ...(cfg.categories.find((c) => c.key === key)?.synonyms ?? [])]
    for (const alias of words) {
      const hit = existing.find((d) => normalizeForCompare(d) === normalizeForCompare(alias))
      if (hit && !taken.has(normalizeForCompare(hit))) {
        names[key] = hit
        reused.push({ category: key, dir: hit })
        taken.add(normalizeForCompare(hit))
        break
      }
    }
  }
  /**
   * 为什么把 `cfg.synonyms` 也算进来：用户在设置页给「配饰」写了口语"小物"，
   * 而他库里已经有一个 `小物/` —— 那归档就该往那儿放。
   * 只让检索认、不让归档认，就是"我明明写了它却不管"那种分裂体验。
   * 内置那份仍然排在前面（它是我审过没有歧义的词）。
   */
  return { names, reused }
}
