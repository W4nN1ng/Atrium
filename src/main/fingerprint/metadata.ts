/**
 * 元数据抽取（第 2 份 §1.3）—— "详细读取文件内容"里"读内容"那部分。
 *
 * 只依赖一个 SourceReader 接口：目录、zip、7z 三种来源共用同一套抽取规则。
 * 默认不自动解压（用户库 25GB / 盘只剩几十 GB），所以 zip 里那几百字节的小文本
 * 要能"按需单读"，不能为了读个 readme 就把整包解开 —— 见 unpack/zipRead.ts。
 */
import type { ExtractedMetadata, SourcePlatform } from '../../shared/types'

export interface SourceFile {
  relPath: string
  size: number
  isDir: boolean
}

export interface SourceReader {
  /** 全部条目（调用方已按数量截断） */
  files(): SourceFile[]
  /** 按需读一个小文件的文本；读不到 / 太大 / 二进制都返回 null */
  readText(relPath: string, maxBytes?: number): Promise<string | null>
}

const README_CANDIDATES =
  /(readme|reame|説明书|説明|说明書|说明|ガイド|guide|about|導入|导入手顺|インストール|利用規約|使用規約|規約|license|licence|変更履歴|更新履歴|changelog|history)/i
/** 只读小文本，几百 KB 的 html 手册不值得 */
const TEXT_EXTS = /\.(txt|md|url|html?|json|csv|xml|ini|rtf)$/i
const MAX_TEXT_BYTES = 64 * 1024
/** readme 语料只取前 8KB（§1.3 表格最后一行） */
const README_KEEP = 8 * 1024

/**
 * URL 用"白名单字符"匹配，不用"排除某些标点"。
 *
 * 一开始写的是排除式（把中日文标点一个个列进字符类），结果要么漏掉「，」把后半句
 * 吃进 URL（实测 '…/1234567，谢谢'），要么范围写歪把正常字母也排除掉。
 * 合法 URL 字符就那几个，正向列一次就稳了：括号、全角标点天然落在白名单外。
 */
const URL_RE = /https?:\/\/[A-Za-z0-9._~:/?[\]@!$&()*+,;=%-]+/g
const BOOTH_RE = /booth\.pm\/(?:ja|en)\/items\/([0-9]+)/i
const BOOTH_SHORT_RE = /booth\.pm\/items\/([0-9]+)/i
const GITHUB_RE = /github\.com\/([\w.-]+)\/([\w.-]+)/i
const GUMROAD_RE = /gumroad\.com\/l\/([\w.-]+)/i
const AFDIAN_RE = /afdian\.(?:net|com)\/([\w@.~-]+)/i

/** 版本号：至少一个点；取最后一个匹配 */
const VERSION_RE = /[vV]?(\d+(?:\.\d+){1,3}[a-zA-Z]?)/g
const IMAGE_RE = /\.(png|jpe?g|webp|bmp|gif|tga|psd)$/i

const HANHUA_RE = /汉化|漢化|中文版|简中|繁中|简体|繁体|机翻|翻译|cn版|chinese/i
const JA_RE = /日本語|日语|日文|jp版|japanese|ver\.?ja/i
const KANA_RE = /[ぁ-んァ-ヶー]/

/** Windows Internet Shortcut：[InternetShortcut]\r\nURL=https://... */
export function parseInternetShortcut(text: string): string | null {
  const m = /^\s*URL\s*=\s*(.+)$/im.exec(text)
  return m ? m[1].trim() : null
}

/** 剥标签 + 解几个常见实体，HTML 必须先剥再入语料（§1.3） */
export function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>|<\/p>|<\/div>|<\/li>|<\/tr>|<\/h[1-6]>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#(\d+);/g, (_m, code: string) => {
      const n = Number(code)
      return n > 0 && n < 0x110000 ? String.fromCodePoint(n) : ' '
    })
    .replace(/&amp;/gi, '&')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
}

/**
 * 从一串文本里抽 URL。
 * .url 文件要特殊处理：它的 URL= 行后面可能跟着 BOM/空白。
 */
export function extractUrls(text: string): string[] {
  const out = new Set<string>()
  const sc = parseInternetShortcut(text)
  if (sc) out.add(sc.replace(/[﻿\s]+$/g, ''))
  for (const m of text.matchAll(URL_RE)) out.add(m[0].replace(/[.,;:)]+$/, ''))
  return Array.from(out)
}

/** Unity 版本串（2022.3.22f1 / 2021.3.0p1）不能被当成素材版本号 */
function looksLikeUnityVersion(raw: string): boolean {
  return /^(20\d\d|5\.\d+)\.\d+\.\d+[fpb]\d+$/i.test(raw)
}

/** 抽版本号：取最后一个匹配；跳过 Unity 版本串；纯目录名里的日期不算 */
export function extractVersion(s: string): string | null {
  const matches = Array.from(s.matchAll(VERSION_RE))
  for (let i = matches.length - 1; i >= 0; i--) {
    const full = matches[i][0]
    const v = matches[i][1]
    if (looksLikeUnityVersion(full)) continue
    // 四位数开头且带 f/p 后缀的一律当 Unity/引擎版本
    if (/^20\d\d\./.test(v)) continue
    if (v.length < 2) continue
    return v
  }
  return null
}

/** 平台判定 + 商品 id；纯数字目录名只给"疑似"置信度（§1.3 明说不能直接断言） */
export function pickPlatform(urls: string[]): {
  platform: SourcePlatform
  itemId: string | null
  confidence: number
  url: string | null
} {
  for (const u of urls) {
    const b = BOOTH_RE.exec(u) ?? BOOTH_SHORT_RE.exec(u)
    if (b) return { platform: 'booth', itemId: b[1], confidence: 0.95, url: u }
    if (GITHUB_RE.test(u)) return { platform: 'github', itemId: null, confidence: 0.9, url: u }
    if (GUMROAD_RE.test(u)) return { platform: 'gumroad', itemId: null, confidence: 0.9, url: u }
    if (AFDIAN_RE.test(u)) return { platform: 'afdian', itemId: null, confidence: 0.9, url: u }
  }
  return { platform: 'other', itemId: null, confidence: 0, url: null }
}

/** 从路径的每一层里找"疑似 Booth ID"：6~8 位纯数字目录名 */
export function guessItemIdFromDirs(dirChain: string[]): string | null {
  for (const d of dirChain) {
    const s = d.trim()
    if (/^\d{6,8}$/.test(s)) return s
    // 也有 "6866030亲亲音效" 这种 id 直接粘在名字前面的
    const m = /^(\d{6,8})(?=[^\/\\]*[\u3040-\u30ff\u4e00-\u9fff])/.exec(s)
    if (m) return m[1]
  }
  return null
}

/**
 * 文件名开头粘着 Booth id 的情况：`6117553 Shinano_FaceAnimation.rar.rar`、
 * `6718483Milfy妆容.zip`。目录里没找到时才回头看名字（§7 特例 4 要求认出来）。
 * 同样只算"疑似"，不能直接断言。
 */
export function guessItemIdFromName(fileName: string): string | null {
  const m = /(?:^|[\s_\-.(【[])(\d{6,8})(?=$|[\s_\-).】\]]|[㐀-䶿一-鿿぀-ヿ])/.exec(fileName)
  return m ? m[1] : null
}
export function detectLocale(text: string): string | null {
  if (HANHUA_RE.test(text)) return '汉化'
  if (JA_RE.test(text)) return '日本語'
  if (KANA_RE.test(text)) return '日本語'
  return null
}

/**
 * 作者：
 * ① `【…汉化…】` 里带 @用户名 或平台名（闲鱼/淘宝/爱发电）→ 提出来
 * ② 通用 `@xxx` / `by xxx`
 */
export function detectAuthor(text: string): string | null {
  const bracket = /【([^】]*汉化[^】]*)】/.exec(text)
  if (bracket) {
    const inner = bracket[1]
    const at = /@([\w一-龥.-]{2,20})/.exec(inner)
    if (at) return at[1]
    const plat = /闲鱼|淘宝|爱发电|メルカリ|twitter/.exec(inner)
    if (plat) {
      const rest = inner.replace(/汉化|漢化|中文版|机翻|翻译/g, '').replace(plat[0], '').trim()
      if (rest.length >= 1 && rest.length <= 20) return rest
    }
  }
  const at = /@([\w一-龥.-]{2,20})/.exec(text)
  if (at) return at[1]
  const by = /\bby[\s_]+([A-Za-z0-9_一-龥-]{2,24})/.exec(text)
  if (by) return by[1]
  return null
}

/** 封面图五级优先级（§1.3 表格；第 ⑤ 级 Booth 联网图 v1 不做） */
export function pickPreviewImages(files: SourceFile[]): string[] {
  // psd 是源文件不是封面：它往往是最大那张，按"最大的图"选会选中它，展开还预览不了
  const imgs = files.filter((f) => !f.isDir && IMAGE_RE.test(f.relPath) && !/\.psd$/i.test(f.relPath))
  if (!imgs.length) return []
  const score = (f: SourceFile): number => {
    const base = f.relPath.split(/[\\/]/).pop() ?? f.relPath
    if (/preview|封面|サムネ|thumbnail|thumb|main|icon|表紙/i.test(base)) return 5
    return 1
  }
  const depth = (f: SourceFile): number => f.relPath.split(/[\\/]/).length
  return imgs
    .map((f) => ({ f, s: score(f), d: depth(f), size: f.size }))
    .sort((a, b) => b.s - a.s || a.d - b.d || b.size - a.size)
    .map((x) => x.f.relPath)
}

/** 挑几个最像"说明书"的文本来读，别把整包文本都读一遍 */
function readmeCandidates(files: SourceFile[]): SourceFile[] {
  return files
    .filter((f) => !f.isDir && TEXT_EXTS.test(f.relPath) && f.size > 0 && f.size <= MAX_TEXT_BYTES)
    .filter((f) => {
      const base = f.relPath.split(/[\\/]/).pop() ?? ''
      return README_CANDIDATES.test(base) || /\.url$/i.test(base)
    })
    .sort((a, b) => a.relPath.split(/[\\/]/).length - b.relPath.split(/[\\/]/).length)
    .slice(0, 6)
}

export interface MetadataInput {
  /** 素材自己的文件名（含扩展名） */
  fileName: string
  /** 库根之后的原始目录链 */
  dirChain: string[]
  reader: SourceReader
}

/**
 * 主入口：名字里的信息 + 目录里的疑似 id + 真读出来的文本，合成 ExtractedMetadata。
 * 读文本失败（加密、超大、二进制）不许抛 —— 顶多信息少一点，分类还得继续跑。
 */
export async function extractMetadata(input: MetadataInput): Promise<ExtractedMetadata> {
  const files = input.reader.files()
  const nameAndDirs = [input.fileName, ...input.dirChain].join(' / ')

  let readmeText = ''
  const urls: string[] = []

  for (const cand of readmeCandidates(files)) {
    let text = await input.reader.readText(cand.relPath, MAX_TEXT_BYTES).catch(() => null)
    if (!text) continue
    if (/\.html?$/i.test(cand.relPath)) text = stripHtml(text)
    urls.push(...extractUrls(text))
    readmeText += (readmeText ? '\n' : '') + text
    if (readmeText.length >= README_KEEP) break
  }
  readmeText = readmeText.slice(0, README_KEEP)

  const fromText = extractUrls(readmeText)
  const allUrls = Array.from(new Set([...urls, ...fromText]))
  const plat = pickPlatform(allUrls)
  const guessId = plat.itemId ?? guessItemIdFromDirs(input.dirChain) ?? guessItemIdFromName(input.fileName)

  return {
    urls: allUrls.slice(0, 20),
    boothItemId: guessId,
    // 链接里读出来的是硬证据；只有纯数字目录名时是"疑似"，UI 要标出来让人确认
    boothItemIdConfidence: plat.itemId ? plat.confidence : guessId ? 0.4 : 0,
    sourcePlatform: plat.itemId ? plat.platform : guessId ? 'booth' : allUrls.length ? plat.platform : null,
    version: extractVersion(input.fileName) ?? extractVersion(input.dirChain.join(' ')),
    localeTag: detectLocale(nameAndDirs + ' ' + readmeText.slice(0, 2000)),
    author: detectAuthor(nameAndDirs) ?? detectAuthor(readmeText.slice(0, 2000)),
    readmeText,
    previewImages: pickPreviewImages(files)
  }
}
