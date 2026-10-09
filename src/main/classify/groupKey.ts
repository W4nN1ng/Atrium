/**
 * 名字归一化与归并键（第 2 份 §3.1 + 增量改动单 2 §B2/§B3）
 *
 * 按规格四步剥 token：avatar → install_method → version → locale，
 * 剩下的拼成 groupKey。这样 Grimoir 的 11 个模型适配版会并到同一个 key，
 * 而 Grimoir_Gimmick / Grimoir_Hat 因为剩下的词不同，天然不会被并进来
 * （用户明确点过名不许误并的那条）。
 *
 * §B2 补的是**方括号变体槽位**：`Libero[Shinano_ATTITUDE The Royal Bunny]_1.01`
 * 这个结构里 `[...]` 就是变体位，整个内容不参与 groupKey。之前把括号里的字当普通文本，
 * 于是 20 个 Libero 只有词表认得的 8+2 个并上了，剩下 10 个各自成卡（05 §B0 的真事故）。
 * §B3 补的是**复合模型名**：`Chiffon&Chocolat` 得拆成两个候选名分别查词表。
 */
import type { Lexicon } from './lexicon'
import { cleanDisplayName, stripIdLike } from '../../shared/naming'

const NAME_SPLIT_RE = /[\s_\-./\\()\[\]【】{}（）]+/
/** 版本号整段（含前缀 v/V），剥 token 时用 */
const VERSION_TOKEN_RE = /^[vV]?\d+(?:[.\-]\d+){1,3}[a-zA-Z]?$/
/**
 * 先从整串里把版本号**连同点**摘出来，再切其余 token。
 * 顺序反了就不行：NAME_SPLIT_RE 含 '.'，'Grimoir_SHINANO_V1.0' 会先被切成 V1 / 0，
 * 版本再也认不出来，groupKey 变成 'grimoir v1 0'（实测就是这么挂的）。
 */
const VERSION_INLINE_RE = /[vV]?(\d+(?:[.\-]\d+){1,3}[a-zA-Z]?)/

/**
 * 方括号槽位（§B2）：半角/全角/中日文括号都认。
 * 用 \u 转义写而不是直接贴字符 —— 这个文件被编辑工具改坏过两次（CJK 区间的端点被吃掉），
 * 转义写法至少坏了能一眼看出来。
 * 开：[ ( （ { 【 ［ ｛    闭：] ) ） } 】 ］ ｝
 */
const BRACKET_OPEN = '[[(\\uFF08{\\u3010\\uFF3B\\uFF5B]'
const BRACKET_CLOSE = '[\\])\\uFF09}\\u3011\\uFF3D\\uFF5D]'
const BRACKET_INNER = '[^\\[\\]()\\uFF08\\uFF09{}\\u3010\\u3011\\uFF3B\\uFF3D\\uFF5B\\uFF5D]{1,120}'
const BRACKET_RE = new RegExp('(' + BRACKET_OPEN + ')(' + BRACKET_INNER + ')(' + BRACKET_CLOSE + ')', 'g')

/** 复合模型名的连接符（§B3）：& ＆ + ＋ 、 , ， */
const COMPOSITE_RE = /[&\uFF06+\uFF0B\u3001,\uFF0C]/
/** 括号内容里"模型位 / 系列位"的分隔符：Booth 惯例是 `<模型>_<系列>` */
const SLOT_SEP_RE = /[_\uFF3F]+/

export interface NameTokens {
  /** 剥完四类 token 之后剩下的"产品本名"token */
  core: string[]
  avatar: string | null
  /** §B3：`Chiffon&Chocolat` 这种复合名拆出来的全部模型（avatar 是它的第一个） */
  avatars: string[]
  installMethod: string | null
  version: string | null
  locale: string | null
  /** 归并键；core 为空时退回整名归一 */
  groupKey: string
  /** §B2：被当成变体槽位摘出来的括号原文 */
  variantRaw: string[]
  /** §B3：括号里的产品系列名头词（容器卡上显示"ATTITUDE 系列"用） */
  series: string[]
  /** §B2 安全保护 3：括号外那部分的头词，判"同目录 ≥3 个不同前缀塌成一个 key"的歧义用 */
  slotPrefixes: string[]
  /**
   * 括号模型位里按位置判定为变体、但词表不认的 token。
   * 这些正是 §B4「从库中学习模型名」要收的东西 —— 词表能自己长，不用每次改代码。
   */
  variantUnknown: string[]
  /** 被剥掉的 token，UI/调试要看 */
  stripped: Array<{ token: string; kind: 'avatar' | 'install' | 'version' | 'locale' | 'bracket' }>
}

/** 展示名：复用 shared/naming，保证界面预填和归并口径一致 */
export function displayNameOf(rawName: string): string {
  return cleanDisplayName(rawName).name || rawName
}

export function tokenizeName(raw: string): string[] {
  return raw
    .split(NAME_SPLIT_RE)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}

/** 反复剥掉容器扩展名，但**不**剥数字 id / 版本 —— 那些正是这里要识别的 token */
function stripArchiveExt(name: string): string {
  let s = name.trim()
  const exts = ['rar', 'zip', '7z', 'tar', 'gz', 'tgz', 'bz2', 'xz', 'unitypackage', '001', 'part1', 'part2']
  for (;;) {
    const m = /\.([A-Za-z0-9]+)$/.exec(s)
    if (!m) break
    if (!exts.includes(m[1].toLowerCase())) break
    s = s.slice(0, m.index)
  }
  return s
}

/** 去掉分隔符后还剩几个字（判断"括号外那部分够不够当身份"） */
function identityLen(s: string): number {
  return s.replace(/[\s._\-+]/g, '').length
}

export interface BracketPass {
  /** 括号内容被摘掉/摊平之后的串，后续照常走版本 + token 流程 */
  text: string
  variantRaw: string[]
  /** 括号模型位拆出来的候选名，命中词表与否都在里面 */
  slotTokens: string[]
  /** 其中命中 avatar 词表的 */
  hitTokens: string[]
  /** 每个槽位的产品系列名头词（`ATTITUDE The Royal Bunny` → `ATTITUDE`） */
  seriesHeads: string[]
  /**
   * 每个槽位**括号外**那部分的头词（`Libero[X_ATTITUDE]_1.0` → `libero`）。
   * §B2 安全保护第 3 条要用它判歧义：同目录里 ≥3 个不同前缀塌成同一个 groupKey，
   * 说明这个 key 已经没有区分力了，不能自动合并。
   */
  prefixes: string[]
}

/** 驼峰切分：`KipfelMame` → ['Kipfel','Mame']；全大写/无交界的原样返回一段 */
function camelPieces(s: string): string[] {
  const out: string[] = []
  let cur = ''
  for (const ch of s) {
    if (cur && /[A-Z]/.test(ch) && /[a-z0-9]/.test(cur[cur.length - 1])) {
      out.push(cur)
      cur = ch
    } else cur += ch
  }
  if (cur) out.push(cur)
  return out
}

/**
 * 一个候选名 → 若干个模型名（§B3）。
 * 先按连接符拆（调用方已经拆过一层 `&`，这里管驼峰）：
 * 真库里 `Libero[KipfelMame_ATTITUDE]_1.00` 把 `&` 写丢了，只剩驼峰这一条线索。
 *
 * **只有每一段都命中词表才拆** —— 拆错会把 `FaceAnimation` 这种正常驼峰名劈成两半，
 * 而劈开之后 groupKey 就再也拼不回去了。全命中才动手，误伤面积最小。
 */
export function splitModelCandidates(piece: string, lex: Lexicon): string[] {
  const parts = camelPieces(piece)
  if (parts.length >= 2 && parts.every((p) => lex.dimOf(p) === 'avatar')) return parts
  return [piece]
}

/**
 * §B2 方括号变体槽位。
 *
 * 三道闸门（05 §B2「安全保护」）：
 * ① 括号外至少 2 个字 —— 不然 `ab[一大串]` 的 groupKey 只剩 `ab`，什么都能并进来；
 * ② 括号内容 ≤ 全名 70% —— **只在单位段时生效**（原因见下）；
 * ③ 同目录 ≥3 个不同前缀塌成同一个 key → 判歧义、不自动合并。这条在 grouping 层，这里看不到目录。
 *
 * 关于 ②：原文写的是无条件 70%，但拿它自己 §B0 那 20 个文件名一算就有 4 个过不去 ——
 * `Libero[Chiffon&Chocolat_ATTITUDE The Royal Bunny]_1.01` 括号内容 40 字 / 全名 53 字 = 75%。
 * 而"括号里有 `_` 分成 `<模型>_<系列>` 两段"这件事本身就证明它是变体位、不是整个名字，
 * 所以**多段结构只过闸门 ①，单位段才过 ②**。这是我对规格做的一处偏离，报告里单独列了。
 *
 * 系列名只取**头一个词**进 groupKey，也是偏离，同样是被真数据逼的：
 * `E:\vrc\A\衣服\名流\` 里 19 个写的是 `_ATTITUDE The Royal Bunny]`，
 * 但 `Libero[KipfelMame_ATTITUDE]_1.00` 那个被截短成 `ATTITUDE` ——
 * 整串留着的话这一个就并不上去，验收 6 在真库上直接不成立。
 * 系列名几乎总是在第一个词上就分得开（ATTITUDE / SUMMER / WINTER），截到头词既不丢保护又能容错。
 */
export function passBrackets(display: string, lex: Lexicon): BracketPass {
  const variantRaw: string[] = []
  const slotTokens: string[] = []
  const hitTokens: string[] = []
  const seriesHeads: string[] = []
  const prefixes: string[] = []
  let text = ''
  let last = 0
  BRACKET_RE.lastIndex = 0
  for (let m = BRACKET_RE.exec(display); m; m = BRACKET_RE.exec(display)) {
    const content = m[2].trim()
    const outside = (display.slice(0, m.index) + display.slice(m.index + m[0].length)).trim()
    const segs = content
      .split(SLOT_SEP_RE)
      .map((s) => s.trim())
      .filter(Boolean)
    const multiSeg = segs.length >= 2
    const guardOutside = identityLen(outside) >= 2
    const guardRatio = content.length <= display.length * 0.7
    if (!content || !guardOutside || (!multiSeg && !guardRatio)) {
      // 闸门没过：括号当普通分隔符，内容照旧参与 groupKey（就是改动单 2 之前的行为）
      text += display.slice(last, m.index) + ' ' + content + ' '
      last = m.index + m[0].length
      continue
    }
    variantRaw.push(content)
    prefixes.push((tokenizeName(outside)[0] ?? '').toLowerCase())
    /**
     * 多段：第一段是模型位，整段摘出 groupKey；剩下的段是**产品系列名**，
     * 取头一个词摊回文本里参与 groupKey（§B3 的要求：不同系列不许被误并）。
     * 单位段：认不出模型位，整个内容摊回去走原来的 token 流程 —— 只有词表认得的才剥。
     */
    let rest = content
    if (multiSeg) {
      const head = tokenizeName(segs.slice(1).join(' '))[0] ?? ''
      seriesHeads.push(head)
      rest = head
      for (const piece of segs[0]
        .split(COMPOSITE_RE)
        .map((s) => s.trim())
        .filter(Boolean)) {
        for (const cand of splitModelCandidates(piece, lex)) {
          slotTokens.push(cand)
          if (lex.dimOf(cand) === 'avatar') hitTokens.push(cand)
        }
      }
    }
    text += display.slice(last, m.index) + ' ' + rest + ' '
    last = m.index + m[0].length
  }
  text += display.slice(last)
  return { text: text.replace(/\s{2,}/g, ' ').trim(), variantRaw, slotTokens, hitTokens, seriesHeads, prefixes }
}

/**
 * @param rawName 原始文件名（含扩展名）或目录名
 *
 * 注意这里**故意不用 cleanDisplayName**：那个函数会把版本号一起剥掉，
 * 而 groupKey 的职责恰恰是"把版本号认出来再剥"（§3.1 第 3 步）。
 * 之前先清洗再分词，结果 ABT 的 version 永远是 null（实测踩过）。
 */
export function deriveGroupKey(rawName: string, lex: Lexicon): NameTokens {
  const display0 = stripArchiveExt(rawName)
  const stripped: NameTokens['stripped'] = []

  /**
   * §A4 第一件事：UUID / 长 hex 必须在**提版本号之前**剥掉。
   * 只写在 cleanDisplayName 里不够 —— 那条路管展示名，这条路管归并键和版本行的 version，
   * 真库的 `d6b99874-… base resized.jpg` 就是因为这里没走，version 还是 `99874-3687-4746-8e`。
   */
  const idless = stripIdLike(display0)
  for (const s0 of idless.stripped) stripped.push({ token: s0, kind: 'version' })
  const display = idless.text
  /** 括号备注不许被当主体候选名传给后面（这里只是把整串摊平，真正的槽位判定在 passBrackets） */

  // 0) §B2 方括号变体槽位：先摘出来，剩下的才拿去认版本号和 token
  const bp = passBrackets(display, lex)
  for (const raw of bp.variantRaw) stripped.push({ token: raw, kind: 'bracket' })

  // 1) 再把版本号整段摘出来（连同它前面的 v/V 和粘着的分隔符）
  const vm = VERSION_INLINE_RE.exec(bp.text)
  const version = vm ? vm[1] : null
  const withoutVersion = vm ? bp.text.slice(0, vm.index) + bp.text.slice(vm.index + vm[0].length) : bp.text
  if (vm) stripped.push({ token: vm[0].trim(), kind: 'version' })

  const tokens = tokenizeName(withoutVersion).filter((t) => !/^\d{6,8}$/.test(t))
  let installMethod: string | null = null
  let locale: string | null = null
  const avatars: string[] = []
  /** 括号模型位里词表不认的：照样算变体（这样 Libero 那 20 个不靠词表也能并上），但记下来喂 §B4 */
  const variantUnknown: string[] = []
  const addAvatar = (t: string): void => {
    const up = t.toUpperCase()
    if (!avatars.includes(up)) avatars.push(up)
  }
  for (const piece of bp.slotTokens) {
    if (bp.hitTokens.includes(piece)) addAvatar(piece)
    else if (!variantUnknown.includes(piece)) variantUnknown.push(piece)
  }
  // §B3 复合名：括号外的 `Chiffon&Chocolat` 也拆一拆，词表命中就算 avatar
  for (const t of tokens) {
    if (!COMPOSITE_RE.test(t)) continue
    for (const piece of t.split(COMPOSITE_RE).map((s) => s.trim()).filter(Boolean)) {
      for (const cand of splitModelCandidates(piece, lex)) {
        if (lex.dimOf(cand) === 'avatar') addAvatar(cand)
      }
    }
  }

  const core: string[] = []
  for (const t of tokens) {
    const dim = lex.dimOf(t)
    if (VERSION_TOKEN_RE.test(t)) {
      stripped.push({ token: t, kind: 'version' })
      continue
    }
    if (dim === 'avatar') {
      addAvatar(t)
      stripped.push({ token: t, kind: 'avatar' })
      continue
    }
    if (dim === 'install') {
      installMethod = installMethod ?? t.toLowerCase()
      stripped.push({ token: t, kind: 'install' })
      continue
    }
    if (dim === 'locale') {
      locale = locale ?? t
      stripped.push({ token: t, kind: 'locale' })
      continue
    }
    core.push(t)
  }

  const keyCore = core.length ? core : tokens.filter((t) => !VERSION_TOKEN_RE.test(t))
  const groupKey = keyCore
    .join(' ')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()

  return {
    core: keyCore,
    avatar: avatars[0] ?? null,
    avatars,
    installMethod,
    version,
    locale,
    // 全被剥光时（名字就一个 'SHINANO'）用展示名兜底，别给出空 key —— 空 key 会把不相干的东西并一起
    groupKey: groupKey || withoutVersion.toLowerCase().trim() || 'unknown',
    variantRaw: bp.variantRaw,
    series: bp.seriesHeads.filter(Boolean),
    slotPrefixes: bp.prefixes.filter(Boolean),
    variantUnknown,
    stripped
  }
}

/** 变体差异写库时用：哪个维度不一样 */
export type VariantDim = 'avatar' | 'install_method' | 'version' | 'locale' | 'other'

export function variantDiff(a: NameTokens, b: NameTokens): VariantDim[] {
  const out: VariantDim[] = []
  if ((a.avatar ?? '') !== (b.avatar ?? '')) out.push('avatar')
  if ((a.installMethod ?? '') !== (b.installMethod ?? '')) out.push('install_method')
  if ((a.version ?? '') !== (b.version ?? '')) out.push('version')
  if ((a.locale ?? '') !== (b.locale ?? '')) out.push('locale')
  if (!out.length) out.push('other')
  return out
}

/** 除变体 token 外完全一致（§3.2 判定 4） */
export function sameIgnoringVariants(a: NameTokens, b: NameTokens): boolean {
  return a.core.join(' ').toLowerCase() === b.core.join(' ').toLowerCase()
}
