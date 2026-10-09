/**
 * 语料合成与分词（第 2 份 §1.4 / §1.2）。
 *
 * 权重：目录名 2.5 > 文件名 3.0？—— 按规格原文：文件名 3.0 最高，目录名 2.5 次之，
 * 包内路径 2.0，readme 1.0。同一词多处出现时取最大权重，不相加
 * （相加会让 readme 里出现的普通词盖过文件名里的强信号）。
 *
 * 分词两条铁律（§10.4）：
 * 1. 不许对 CJK 做英文式空格分词 —— 中日文没空格，一切就碎。
 *    所以既保留"未切分的完整串"，又对无空格 CJK 串滑窗取 2~6 字子串。
 * 2. 完整串必须保留：VRCFury / GoGoLoco 切开就没意义了。
 */

/** 规格给定的切分字符集 */
const SPLIT_RE = /[\s_\-./\\()\[\]【】{}（）]+/

/** Unity 排序前缀与生成物痕迹（§1.2，归一化时必须剥） */
const JUNK_PREFIX_RE = /^[!#~@+]+/
const GENERATED_SUFFIX_RE = /__generated$/i

/** 中日韩统一表意 + 假名 + 韩文（用 \u 写清楚，别用字面字符 —— 容易把范围写歪） */
const CJK_RE = /[㐀-䶿一-鿿ぁ-ゟァ-ヿ가-힣]/

export type CorpusWhere = 'dir' | 'file' | 'entry' | 'readme'

export const POSITION_WEIGHT: Record<CorpusWhere, number> = {
  dir: 2.5,
  file: 3.0,
  entry: 2.0,
  readme: 1.0
}

export interface CorpusToken {
  term: string
  weight: number
  where: CorpusWhere
  /** 该词是从哪个原始串切出来的（reason 要能说"文件名含 GoLoco"） */
  origin: string
}

export interface Corpus {
  tokens: CorpusToken[]
  /** term → 权重最高的那条（查词典就靠它） */
  best: Map<string, CorpusToken>
}

/** 剥掉 ! # ~ 前缀与 __Generated 后缀 */
export function stripJunk(name: string): string {
  let s = name.trim()
  for (;;) {
    const t = s.replace(JUNK_PREFIX_RE, '')
    if (t === s) break
    s = t.trim()
  }
  s = s.replace(GENERATED_SUFFIX_RE, '')
  return s.trim()
}

/** 去扩展名（只去最后一段；上限 12 是因为 .unitypackage 有 12 个字母，卡 8 会漏） */
export function stripExt(name: string): string {
  const m = /\.([A-Za-z0-9]{1,12})$/.exec(name)
  return m ? name.slice(0, m.index) : name
}

/** 滑窗上限：CJK 串太长时别把组合数打爆 */
const MAX_WINDOW_SOURCE = 24
const MIN_GRAM = 2
const MAX_GRAM = 6

/**
 * 把一个字符串切成候选词：切分串 + 完整串 + （纯 CJK 段）滑窗子串。
 * 全部小写归一，和词典的 normTerm 保持一致。
 */
export function tokenize(input: string): string[] {
  const raw = stripJunk(input)
  if (!raw) return []
  const out: string[] = []
  const seen = new Set<string>()
  const push = (s: string): void => {
    const t = s.toLowerCase().replace(/[\s　]+/g, ' ').trim()
    if (t.length < 2 || t.length > 64 || seen.has(t)) return
    seen.add(t)
    out.push(t)
  }

  // 1) 完整串（连写也要能查，所以另外推一份去空格的）
  push(raw)
  // 2) 按规格字符集切分
  for (const part of raw.split(SPLIT_RE)) {
    if (!part) continue
    push(part)
    // 3) 中英混排里 camelCase 边界再切一刀：FaceAnimation -> Face / Animation
    const camel = part.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    if (camel !== part) for (const c of camel.split(' ')) push(c)
    // 4) 纯 CJK 段滑窗
    if (CJK_RE.test(part) && !/\s/.test(part) && part.length > MIN_GRAM && part.length <= MAX_WINDOW_SOURCE) {
      const maxGram = Math.min(MAX_GRAM, part.length)
      for (let g = MIN_GRAM; g <= maxGram; g++) {
        for (let i = 0; i + g <= part.length; i++) push(part.slice(i, i + g))
      }
    }
  }
  return out
}

export interface CorpusInput {
  /** 原始路径的每一层目录名（库根之后的部分） */
  dirChain: string[]
  /** 素材自己的文件名（可带扩展名） */
  fileName: string
  /** 包内 / 目录内的相对路径（太多时调用方要先截断） */
  entryPaths: string[]
  /** readme 正文（调用方已解码 + 剥标签 + 截 8KB） */
  readmeText?: string
}

/** readme 里最多取多少个 token —— 长 readme 会把打分表冲淡 */
const README_TOKEN_CAP = 400

export function buildCorpus(input: CorpusInput): Corpus {
  const best = new Map<string, CorpusToken>()
  const add = (term: string, where: CorpusWhere, origin: string): void => {
    const w = POSITION_WEIGHT[where]
    const prev = best.get(term)
    if (prev && prev.weight >= w) return
    best.set(term, { term, weight: w, where, origin })
  }

  for (const dir of input.dirChain) {
    for (const t of tokenize(dir)) add(t, 'dir', dir)
  }
  for (const t of tokenize(stripExt(input.fileName))) add(t, 'file', input.fileName)
  // 文件名带扩展名时也整串收一次（'lightcontrollerv2.0.3.1.unitypackage' 这种）
  for (const t of tokenize(input.fileName)) if (!best.has(t)) add(t, 'file', input.fileName)

  for (const p of input.entryPaths) {
    const segs = p.split(/[\\/]/).filter(Boolean)
    // 每一层目录名 + 最后的文件名都算，权重都是 entry 的 2.0
    for (const seg of segs) for (const t of tokenize(seg)) add(t, 'entry', p)
  }

  if (input.readmeText) {
    let used = 0
    for (const line of input.readmeText.split(/\r?\n/)) {
      if (used >= README_TOKEN_CAP) break
      for (const t of tokenize(line)) {
        if (used >= README_TOKEN_CAP) break
        add(t, 'readme', 'readme')
        used++
      }
    }
  }

  return { tokens: Array.from(best.values()), best }
}

/** 给 reason 用：这个词是从哪儿来的 */
export function corpusOrigin(corpus: Corpus, term: string): CorpusWhere | null {
  return corpus.best.get(term)?.where ?? null
}
