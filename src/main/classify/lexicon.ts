/**
 * 词典加载与索引（第 2 份 §5.2 / §6 / §9）。
 *
 * 这里**不 import electron**：分类要在摄取 worker 里跑（§12 坑 8 不许占主线程），
 * worker 里拿不到 app 路径，所以路径由调用方传进来（和 library/commit.ts 的 deps 一个路子）。
 *
 * 性能（§9：100 个素材批量分类 ≤10 秒）：全部走 Map 精确查表，
 * 不做"每个 token 线性扫一遍词典"。
 */
import fs from 'node:fs'

export type LexDim = 'avatar' | 'install' | 'tool' | 'theme' | 'style' | 'locale' | 'generic'

export interface LexEntry {
  /** 已归一（小写、空白折叠）的检索词 */
  term: string
  /** 一级分类 key；null = 只当维度标签，不直接给分类 */
  cat: string | null
  sub: string | null
  /** baseWeight 1~5 */
  w: number
  dim: LexDim
}

interface LexiconFile {
  schema?: number
  count?: number
  entries?: Array<Partial<LexEntry> & { term?: string }>
}

export interface Lexicon {
  /** 精确查；命中多个（内置 + 用户覆盖）时返回权重最高的 */
  lookup(term: string): LexEntry | null
  /** 该词形属于哪个维度（归并要用：avatar / install_method / version / locale 四类 token） */
  dimOf(term: string): LexDim | null
  size(): number
  all(): LexEntry[]
  /** 命中的分类候选数，给 reason 用 */
  categories(): string[]
}

/** 归一化：和 tools/build-lexicon.cjs 必须一致，否则查不到 */
export function normTerm(s: string): string {
  return s.toLowerCase().replace(/[\s　]+/g, ' ').trim()
}

/** 去掉所有空白：让 'face animation' 也能被 'faceanimation' 这种连写命中 */
function squash(s: string): string {
  return s.replace(/[\s　_-]/g, '')
}

function valid(e: Partial<LexEntry> & { term?: string }): e is LexEntry & { term: string } {
  return (
    typeof e.term === 'string' &&
    e.term.length > 0 &&
    typeof e.w === 'number' &&
    e.w > 0 &&
    typeof e.dim === 'string'
  )
}

/**
 * 读一个 JSON 文件并解析成条目；文件不存在返回空数组（用户词典本来就可能没有）。
 * 解析失败要冒泡 —— 词典坏了得让人知道，不能静默当空词典用（那会让所有素材掉进待确认队列）。
 */
function readEntries(file: string): Array<LexEntry & { term: string }> {
  let raw: string
  try {
    raw = fs.readFileSync(file, 'utf8')
  } catch {
    return []
  }
  const parsed = JSON.parse(raw) as LexiconFile
  if (!parsed || !Array.isArray(parsed.entries)) throw new Error('词典文件格式不对（缺 entries 数组）：' + file)
  const out: Array<LexEntry & { term: string }> = []
  for (const e of parsed.entries) {
    if (!valid(e)) continue
    out.push({ term: normTerm(e.term), cat: e.cat ?? null, sub: e.sub ?? null, w: e.w, dim: e.dim })
  }
  return out
}

export interface LexiconSources {
  /** resources/lexicon/lexicon.json */
  builtin: string
  /** 用户在设置页增删改后落的那份，可缺省 */
  user?: string | null
}

export function loadLexicon(src: LexiconSources): Lexicon {
  const byTerm = new Map<string, LexEntry>()
  const bySquash = new Map<string, LexEntry>()

  const put = (e: LexEntry): void => {
    const prev = byTerm.get(e.term)
    // 用户词典排在后面读，同词以"后读的"为准（用户覆盖内置）
    if (prev && e.w <= 0) return
    byTerm.set(e.term, e)
    const sq = squash(e.term)
    const prevSq = bySquash.get(sq)
    if (!prevSq || prevSq.term.length <= e.term.length) bySquash.set(sq, e)
  }

  for (const e of readEntries(src.builtin)) put(e)
  if (src.user) for (const e of readEntries(src.user)) put(e)

  return {
    lookup(term: string): LexEntry | null {
      const t = normTerm(term)
      if (!t) return null
      return byTerm.get(t) ?? bySquash.get(squash(t)) ?? null
    },
    dimOf(term: string): LexDim | null {
      return this.lookup(term)?.dim ?? null
    },
    size(): number {
      return byTerm.size
    },
    all(): LexEntry[] {
      return Array.from(byTerm.values())
    },
    categories(): string[] {
      return Array.from(new Set(Array.from(byTerm.values()).map((e) => e.cat).filter((x): x is string => !!x))).sort()
    }
  }
}

/** 词形列表 → 条目（给设置页"新增词条"和单测用） */
export function makeEntry(term: string, cat: string | null, sub: string | null, w: number, dim: LexDim): LexEntry {
  return { term: normTerm(term), cat: cat || null, sub: sub || null, w, dim }
}
