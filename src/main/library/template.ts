import path from 'node:path'
import { MAX_TEMPLATE_LENGTH } from '../../shared/constants'

/**
 * 目录模板渲染 + Windows 非法字符清洗（第 1 份 F4）。
 * 这是"素材库会不会被搞乱"的第一道闸，所以单独成文件、单独测。
 */

const ILLEGAL = /[\\/:*?"<>|\x00-\x1f]/g
const RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\.|$)/i

export interface TemplateVars {
  /** 分类 key，不是显示名 */
  category?: string | null
  subcategory?: string | null
  name?: string | null
  version?: string | null
  avatar?: string | null
  author?: string | null
  year?: string | null
}

export interface SegmentOptions {
  /** 单段最长字符数（不是字节），默认 100 */
  maxSegment?: number
  /** 整路径预算 */
  totalLimit?: number
  /** 非法字符替换成什么 */
  replacement?: string
}

export function sanitizeSegment(raw: string, opts: SegmentOptions = {}): string {
  const max = opts.maxSegment ?? 100
  const rep = opts.replacement ?? ' '
  let s = String(raw ?? '')
    .replace(ILLEGAL, rep)
    // 全角竖线/冒号这类看起来无害但会被某些工具当分隔符的，一并压掉
    .replace(/[”“‘’]/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
  // Windows 不允许结尾有空格或点
  s = s.replace(/[ .]+$/u, '')
  s = s.replace(/^\.+/, '')
  if (RESERVED.test(s)) s = s + '_'
  if (s.length > max) {
    // 别把代理对（emoji）切成半个
    let cut = max
    const code = s.charCodeAt(cut - 1)
    if (code >= 0xd800 && code <= 0xdbff) cut -= 1
    s = s.slice(0, cut).replace(/[ .]+$/u, '')
  }
  return s || '未命名'
}

const PLACEHOLDER = /\{(\w+)\}/g

/**
 * 渲染成目录段数组。`names` 提供 key → 磁盘显示名（用 libraryLocale 固定的那份）。
 * 模板里引用了未知占位符 → 当空串处理（不抛异常，不写垃圾目录）。
 */
export function renderSegments(
  template: string,
  vars: TemplateVars,
  names: Map<string, string>,
  opts: SegmentOptions = {}
): string[] {
  const raw = String(template ?? '{category}/{subcategory}/{name}')
  const segments = raw
    .split(/[\/\\]/)
    .map((segTemplate) =>
      segTemplate.replace(PLACEHOLDER, (_m, key: string) => valueFor(key, vars, names))
    )
    .map((seg) => (seg.trim() ? sanitizeSegment(seg, opts) : ''))
    .filter((seg) => seg && seg !== '未命名')

  if (!segments.length) {
    return ['其他', '未归类', vars.name ? sanitizeSegment(vars.name, opts) : '未命名']
  }
  return enforceTotal(segments, opts.totalLimit ?? MAX_TEMPLATE_LENGTH)
}

function valueFor(key: string, vars: TemplateVars, names: Map<string, string>): string {
  switch (key) {
    case 'category':
      return vars.category ? names.get(vars.category) ?? vars.category : ''
    case 'subcategory':
      if (!vars.subcategory || !vars.category) return ''
      /**
       * 查不到就少一层目录。
       * 之前 `?? vars.subcategory` 会把英文 key 直接当目录名写进用户的库：
       * 实测出现过 `模型/outfit/` —— 一级来自界面默认值、二级来自分类结果，配成一对不存在的组合。
       */
      return names.get(`${vars.category}/${vars.subcategory}`) ?? ''
    case 'name':
      return vars.name ?? ''
    case 'version':
      return vars.version ?? ''
    case 'avatar':
      return vars.avatar ?? ''
    case 'author':
      return vars.author ?? ''
    case 'year':
      return vars.year ?? String(new Date().getFullYear())
    default:
      return ''
  }
}

/** 总长超预算时从最后一段（资产名）开始裁，保证分类目录层级完整 */
function enforceTotal(segments: string[], limit: number): string[] {
  const out = [...segments]
  const total = () => out.join(path.sep).length
  while (total() > limit && out.length > 1) {
    const last = out[out.length - 1]
    const overshoot = total() - limit
    const keep = Math.max(8, last.length - overshoot)
    if (keep >= last.length) break
    out[out.length - 1] = sanitizeSegment(last.slice(0, keep), { maxSegment: keep })
    if (out[out.length - 1] === last) break
  }
  return out
}

export function renderRelativeDir(
  template: string,
  vars: TemplateVars,
  names: Map<string, string>,
  opts: SegmentOptions = {}
): string {
  return renderSegments(template, vars, names, opts).join(path.sep)
}

/** 同一目标目录下重名时加 (2)/(3)…，绝不覆盖已有文件 */
export function uniqueSuffix(dir: string, existing: (target: string) => boolean): string {
  let n = 2
  let candidate = dir
  while (existing(candidate)) {
    candidate = `${dir} (${n})`
    n++
    if (n > 999) throw new Error('重名过多：' + dir)
  }
  return candidate
}
