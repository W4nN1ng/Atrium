/**
 * 检索归一化（第 1 份 F5：`归一化(name) = 原文 + 小写 + 罗马字(假名) + 拼音(汉字) + 去符号`）
 *
 * 目标：输 `shinano` 能搜到 `しなの`，输 `yifu` 能搜到 `衣服`。
 *
 * 放在 shared 是因为主进程和渲染进程用的是同一套规则（输入框那边也要能预览归一化结果），
 * 但这个文件**不许 import electron**，也不许被渲染进程无谓引用 —— 它带着 pinyin-pro/wanakana，
 * 渲染进程打包时被 tree-shake 掉才对（现在没人引它，检索全在主进程做）。
 *
 * 实测踩过的坑（别改回去）：
 * - `pinyin('Grimoir')` 会把拉丁字母**逐字母加空格**变成 `G r i m o i r`，
 *   所以必须按字符类别分段，只把汉字段丢给 pinyin；
 * - `wanakana.toRomaji('束縛チャイナ')` 只转假名、汉字原样留着 → 得到 `束縛chaina`，
 *   所以汉字段还要再过一遍 pinyin。
 */
import { pinyin } from 'pinyin-pro'
import * as wanakanaNS from 'wanakana'

/**
 * wanakana 的 ESM 产物没有 default export（CJS 那份有），
 * 写 `import wanakana from 'wanakana'` 在 rollup 构建期直接报
 * `"default" is not exported`。两种形态都兜住，别赌打包器的 interop。
 */
const wanakana = ((wanakanaNS as unknown as { default?: typeof wanakanaNS }).default ??
  wanakanaNS) as typeof wanakanaNS

/** 汉字（中日共用，简繁都在这儿） */
const HAN = /\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff/
/** 平假名 + 片假名 + 长音符 + 小写促音 */
const KANA = /\u3041-\u309f\u30a1-\u30ff\u30fc\u30fb/
/** 拉丁字母与数字 */
const LATIN = /[a-z0-9]/i

/**
 * 全角 → 半角 + 兼容分解，再把拉丁组合音标去掉（é → e、（）→ ()、Ａ → A）。
 *
 * 用 **NFKC 而不是 NFKD**：NFKD 会把促音/浊音假名拆成"清音 + U+3099/309A"，
 * 而那两个码点不在 \u0300-\u036f 里，删不掉，于是 toRomaji('バ') 变成 'ha゙' ——
 * 搜"ソクバク"会吐出带 U+3099 的怪 token（实测：单搜一个「バ」都能匹配出东西）。
 * NFKC 既做全角折半角，又把假名保持成合成形式。
 *
 * ⚠ **导出的理由（2026-10-06，M6 ①）**：`shared/projectMatch.ts` 做工程指纹归一化时
 * 必须走同一个 `fold`，自己再写一遍 normalize 就会重踩上面那个 NFKD 坑
 * （`tests/shared/project-match.spec.ts` 里有一条专门钉"它是导出的"）。
 */
export function fold(s: string): string {
  return s
    .normalize('NFKC')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .normalize('NFC')
}

/** 去掉检索无意义的符号，留字母/数字/汉字/假名/空格 */
export function stripSymbols(s: string): string {
  return fold(s).replace(/[^\p{L}\p{N}\s\u3400-\u4dbf\u4e00-\u9fff\u3041-\u30ff\u30fc\u30fb]+/gu, ' ')
}

function hanOf(ch: string): boolean {
  return new RegExp(`^[${HAN.source}]$`).test(ch)
}
function kanaOf(ch: string): boolean {
  return new RegExp(`^[${KANA.source}]$`).test(ch)
}
function latinOf(ch: string): boolean {
  return LATIN.test(ch)
}

type Run = { kind: 'han' | 'kana' | 'latin' | 'other'; text: string }

/** 按字符类别切段：'束縛チャイナFullset' → [han 束縛][kana チャイナ][latin Fullset] */
function runs(s: string): Run[] {
  const out: Run[] = []
  for (const ch of fold(s)) {
    const kind: Run['kind'] = hanOf(ch) ? 'han' : kanaOf(ch) ? 'kana' : latinOf(ch) ? 'latin' : 'other'
    const last = out[out.length - 1]
    // 假名和汉字在日文里是连着的，但转换方式不同 → 必须分段
    if (last && last.kind === kind) last.text += ch
    else out.push({ kind, text: ch })
  }
  return out
}

/** 'kaa' → 也给出 'ka'；'shinano' 不受影响。长音写法因人而异 */
function vowelFolded(romaji: string): string[] {
  const out = [romaji]
  const collapsed = romaji.replace(/([aeiou])\1+/g, '$1')
  if (collapsed !== romaji) out.push(collapsed)
  return out
}

export interface SearchForms {
  /** 原文（trim 过） */
  raw: string
  /** 小写 + 全角折半角 */
  lower: string
  /** 去符号后的分词友好形式 */
  stripped: string
  /** 汉字→拼音、假名→罗马字，逐段拼出来的那一串 */
  translit: string[]
  /** 上面所有形式合起来喂索引 */
  all: string[]
}

/**
 * 一个字符串 → 全部该进索引的写法。
 * 返回的顺序不重要，去重后交给 MiniSearch。
 */
export function searchForms(input: string): SearchForms {
  return cachedForms(input)
}
/**
 * searchForms 的记忆化。
 *
 * 5 万素材全量建索引实测要 10 秒，其中大头是 pinyin / toRomaji 被反复调用 ——
 * 而真正不同的字符串远少于调用次数：一个库里 109 个分类标签会被拼进每一条素材，
 * 版本号 / 作者 / 常见词根也高度重复。缓存一加上，别名生成时间掉一个数量级。
 *
 * 上限是为了不让长时间运行的进程吃光内存（每条最多几 KB）。
 */
const FORM_CACHE_MAX = 40000
const formCache = new Map<string, SearchForms>()

function cachedForms(input: string): SearchForms {
  const hit = formCache.get(input)
  if (hit) return hit
  const made = computeForms(input)
  if (formCache.size >= FORM_CACHE_MAX) formCache.clear()
  formCache.set(input, made)
  return made
}

/** 测试用：清掉记忆化（缓存跨用例串味很难查） */
export function resetSearchFormCache(): void {
  formCache.clear()
}

function computeForms(input: string): SearchForms {
  const raw = (input ?? '').trim()
  const lower = fold(raw).toLowerCase()
  const stripped = stripSymbols(raw).toLowerCase().replace(/\s+/g, ' ').trim()

  const translit: string[] = []
  if (raw) {
    const parts: string[] = []
    const squashed: string[] = []
    for (const r of runs(raw)) {
      if (r.kind === 'han') {
        const py = pinyin(r.text, { toneType: 'none', type: 'array' })
        for (const p of py) {
          const v = String(p).toLowerCase().trim()
          if (!v) continue
          parts.push(v)
          squashed.push(v)
        }
      } else if (r.kind === 'kana') {
        for (const variant of vowelFolded(String(wanakana.toRomaji(r.text)).toLowerCase())) {
          parts.push(variant)
          squashed.push(variant.replace(/\s+/g, ''))
        }
      } else if (r.kind === 'latin') {
        parts.push(r.text.toLowerCase())
        squashed.push(r.text.toLowerCase())
      }
    }
    const spaced = parts.join(' ').replace(/\s+/g, ' ').trim()
    const joined = squashed.join('').replace(/\s+/g, '').trim()
    if (spaced) translit.push(spaced)
    if (joined && joined !== spaced) translit.push(joined)
  }

  const all = Array.from(
    new Set([raw, lower, stripped, ...translit].map((s) => s.trim()).filter((s) => s.length > 0))
  )
  return { raw, lower, stripped, translit, all }
}

/** 只要一条主键的场景（比如 search_alias.alias） */
export function searchKey(input: string): string {
  return searchForms(input).stripped || fold(input).toLowerCase().trim()
}

/** 一个词的所有检索写法（输入框那边也用这个，保证口径一致） */
export function expandQuery(q: string): string[] {
  return searchForms(q).all
}
