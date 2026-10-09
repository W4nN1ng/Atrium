/**
 * M6 ① · 工程 ↔ 集合的匹配（**纯函数，零 IO，零 electron**）
 *
 * 规格：第 3 份 §4.3 步骤 1–2（指纹四段、两边归一化、多命中取 priority、并列取最长关键词）。
 * 裁定：2026-10-06 那六条里的 Q1 —— **平手不切，但必须留痕**（候选名单要能拿去记日志、
 * 拿去画横幅「有 N 个集合同时命中，未自动切换」）。不留痕的话"为什么不切"永远无法从现象反推。
 *
 * ## 为什么单独一个共享层文件
 *
 * 匹配规则和工程状态都在主进程/库里，放渲染进程就要两边各算一遍 ——
 * 这个仓库为"同一个规则两份实现"付过两次学费（M5-3 的 `cleanDisplayName`、`.cs.meta` 伴生判据）。
 * 所以：这里只出结论，主进程 `project/autoSwitch.ts` 负责触发与落库，界面只画。
 *
 * ## 归一化必须走 `fold()`，不许自己写
 *
 * M4 那个 NFKD 把浊音假名拆成"清音 + U+3099"的坑已经修在 `shared/normalize.ts` 的 `fold()` 里，
 * 重写一遍必踩。`tests/shared/project-match.spec.ts` 有一条钉住"它俩用的是同一个 fold"。
 *
 * ⚠ 这个文件里的中日韩/假名**码位一律写 `\uXXXX` 转义**：往正则里放 CJK 字面量区间，
 * 一次批量替换就能把它搅成看着像、其实错的东西，而且它未必报错 —— 只是范围悄悄不对。
 */
import { fold, searchForms } from './normalize'
import { normalizeDirKey } from './pathkey'
import type { CollectionRule } from './types'

/** 工程指纹（§4.3 步骤 1 那四段） */
export interface ProjectFingerprint {
  /** 工程目录名，如 `shinano-Main2`。首帧只有这一段 */
  dirName: string
  /** `Assets/` 顶层目录名 */
  topFolders: string[]
  /** `Packages/manifest.json` 的依赖键名 */
  installedPackages: string[]
  /** `AvatarDescriptor` 资源的工程路径（这一版桥接没回，见 §8-Q5 裁定"先不改 C#"） */
  avatarDescriptors: string[]
}

/** 参与匹配的集合（调用方从 `collection` 表 + `rule_json` 拼出来） */
export interface MatchableCollection {
  id: string
  name: string
  rule: CollectionRule
  /** `collection.priority` 那一列；规则里没写 priority 时用它 */
  priority?: number
}

/** 一条"凭什么算命中"的证据 */
export interface MatchEvidence {
  collectionId: string
  collectionName: string
  /** `projectPath` = "以后都这样"写进去的精确路径；`keyword` = 关键词命中 */
  via: 'projectPath' | 'keyword'
  /** 决定性的那个关键词（`projectPath` 时放那条路径） */
  keyword: string
  /** 该关键词在指纹里命中了多少个 token（写日志用，也用来解释"凭什么"） */
  hits: number
  /** 参与仲裁的优先级：`rule.priority ?? collection.priority ?? 0` */
  priority: number
}

/** 被丢弃的关键词及原因（**留痕**：为什么明明有规则却没切） */
export interface DroppedKeyword {
  collectionId: string
  keyword: string
  why: 'tooShort' | 'generic'
}

export type MatchOutcome =
  | { kind: 'hit'; evidence: MatchEvidence }
  /** 平手（Q1：不切，但把候选全交出去） */
  | { kind: 'ambiguous'; evidence: MatchEvidence[] }
  | { kind: 'none'; tried: number; dropped: DroppedKeyword[] }

export interface MatchOptions {
  /** 这个工程的绝对路径（比对 `rule.projectPaths` 用，走 `normalizeDirKey`） */
  projectPath?: string | null
  /**
   * 已知的所有工程指纹（含当前这个）。给了才会开"通用词"闸门：
   * 一个词**命中了全部已知工程**（如 `unity` / `asset`）说明它什么都没说，不据它切。
   * 命中多个但没到全部**不算通用词** —— 六个 shinano 工程指向同一个 Shinano 集合正是设计目的。
   * **不给 = 不开这道闸**（调用方要么传全量，要么明确接受这个风险）。
   */
  knownProjects?: ProjectFingerprint[]
}

/** ASCII 词短于这个长度不参与匹配（'av' 会咬住 avatar，M5-B 的 `tokenHits` 同一个道理） */
const MIN_LATIN_LEN = 3
/** 汉字/假名短于 2 字不参与（'信' 单字太容易撞） */
const MIN_CJK_LEN = 2
/** 少于这么多个已知工程时，不开"全都命中才算通用词"这道闸（一个工程时"全都命中"没有意义） */
const GENERIC_MIN_PROJECTS = 3

/** 中日韩（扩展 A + 基本区）+ 平假名 + 片假名 + 长音符 + 中点 */
const CJK_RANGE = '\\u3400-\\u4dbf\\u4e00-\\u9fff\\u3041-\\u30ff\\u30fc\\u30fb'
const CJK_ONLY = new RegExp('[' + CJK_RANGE + ']')
/** 切 token 时"不算分隔符"的字符：拉丁、数字、中日韩、假名 */
const NOT_TOKEN = new RegExp('[^0-9a-z' + CJK_RANGE + ']+', 'gi')

/**
 * 按同一把尺子切 token（`modelCollections` 那边也用它 —— 分隔规则写两份必漂）。
 * 传带 g 标志的正则时 `lastIndex` 会残留，所以每次用完归零。
 */
export function splitTokens(s: string): string[] {
  const out = s.replace(NOT_TOKEN, ' ').split(' ')
  NOT_TOKEN.lastIndex = 0
  return out.map((t) => t.trim().toLowerCase()).filter(Boolean)
}

/** 去掉一切"字母/数字/中日韩/假名"之外的字符，当作比较键 */
export function stripToKey(s: string): string {
  return splitTokens(s).join('')
}

/**
 * 一个字符串 → 可比较的 token 集合。
 *
 * 走 `searchForms().all` 是为了把**罗马字 / 拼音**那几种写法也摊平成 token：
 * `信奈` → `xin` `nai` `xinnai`，`しなの` → `shinano`，
 * 于是工程叫 `信奈工坊` 时关键词 `shinano` 也能命中（规格只说"假名转罗马字"，
 * 汉字这条是超出原文的 —— 词典里 `信奈` 本来就是 avatar 维词条，不接上就白搭）。
 */
export function tokensOf(text: string): string[] {
  const out: string[] = []
  for (const form of searchForms(text).all) for (const t of splitTokens(form)) out.push(t)
  return Array.from(new Set(out))
}

/** 这个 token 有没有资格当匹配依据 */
export function usableToken(t: string): boolean {
  if (!t) return false
  /** 纯数字（版本号、Booth ID 尾巴）不说明任何身份 */
  if (/^[\d.]+$/.test(t)) return false
  return CJK_ONLY.test(t) ? t.length >= MIN_CJK_LEN : t.length >= MIN_LATIN_LEN
}

/** 工程指纹 → token 集合（四段全摊平） */
export function fingerprintTokens(fp: ProjectFingerprint): Set<string> {
  const set = new Set<string>()
  for (const seg of [
    fp.dirName,
    ...(fp.topFolders ?? []),
    ...(fp.installedPackages ?? []),
    ...(fp.avatarDescriptors ?? [])
  ]) {
    if (!seg) continue
    for (const t of tokensOf(seg)) if (usableToken(t)) set.add(t)
  }
  return set
}

/** 关键词 → 它的可用 token（一个都不剩时返回空数组 = 这个词不参与匹配） */
function keywordTokens(keyword: string): string[] {
  return tokensOf(keyword).filter(usableToken)
}

/** 命中数：关键词的任一变体出现在指纹 token 里就算一次 */
function hitsOf(kwTokens: string[], fp: Set<string>): number {
  let n = 0
  for (const t of kwTokens) if (fp.has(t)) n++
  return n
}

/** 参与仲裁的优先级：规则里写的优先，其次集合列 */
function priorityOf(c: MatchableCollection): number {
  return Number(c.rule?.priority ?? c.priority ?? 0) || 0
}

/** 精确路径命中（"以后都这样"）：两边都过 `normalizeDirKey`，写法不同也算同一个 */
function pathHit(c: MatchableCollection, projectPath: string | null | undefined): string | null {
  const key = normalizeDirKey(projectPath)
  if (!key) return null
  for (const p of c.rule?.projectPaths ?? []) {
    if (normalizeDirKey(p) === key) return p
  }
  return null
}

/**
 * 这个词是不是"什么都没说"（`unity` / `asset` / `tools` 这类）。
 *
 * ⚠ 判据在 2026-10-06 的沙盒活体上改过一次，原因是原来那条写错了：
 * 第一版是"命中 ≥3 个已知工程就算通用词"，而他机器上 9 个工程里有 7 个名字带 `shinano` ——
 * 于是 `Shinano` 集合的关键词被判成通用词，**规格 §8-9 那条验收（打开 shinano-Main2
 * 自动切到 Shinano 集合）结构上不可能通过**。多个工程指向同一个分区本来就是这件事的目的，
 * 不是它的反例。
 *
 * 现在的判据：**只有命中了所有已知工程**（且工程数 ≥3，一个工程时"全都命中"没有意义）
 * 才叫什么都没说 —— 那种词切去哪都一样，凭什么据它改用户的视图。
 */
function isGeneric(keyword: string, opts: MatchOptions): boolean {
  const known = opts.knownProjects
  if (!known || known.length < GENERIC_MIN_PROJECTS) return false
  const kt = keywordTokens(keyword)
  if (!kt.length) return false
  for (const other of known) if (hitsOf(kt, fingerprintTokens(other)) === 0) return false
  return true
}

/** 单个集合的匹配结果（可能一条证据，也可能只是"被丢弃的关键词"清单） */
interface CandidateResult {
  evidence: MatchEvidence | null
  dropped: DroppedKeyword[]
}

function evaluate(c: MatchableCollection, fpTokens: Set<string>, opts: MatchOptions): CandidateResult {
  const dropped: DroppedKeyword[] = []
  const kws = (c.rule?.keywords ?? []).map((k) => String(k ?? '').trim()).filter(Boolean)
  if (!kws.length) return { evidence: null, dropped }

  const mode = c.rule?.matchMode === 'all' ? 'all' : 'any'
  let best: { keyword: string; hits: number } | null = null
  let allHit = true

  for (const kw of kws) {
    const kt = keywordTokens(kw)
    if (!kt.length) {
      /** 短到没资格：既不算命中，也说明"这条规则帮不上忙"（留痕用） */
      dropped.push({ collectionId: c.id, keyword: kw, why: 'tooShort' })
      allHit = false
      continue
    }
    const hits = hitsOf(kt, fpTokens)
    if (!hits) {
      allHit = false
      continue
    }
    /** 通用词：能命中，但不足以决定切去哪（只有它时整个集合不作候选） */
    if (isGeneric(kw, opts)) {
      dropped.push({ collectionId: c.id, keyword: kw, why: 'generic' })
      continue
    }
    if (!best || kw.length > best.keyword.length || (kw.length === best.keyword.length && hits > best.hits)) {
      best = { keyword: kw, hits }
    }
  }

  /** `all` 要求每个关键词都命中（规格只给了 any 的例子，但字段有 matchMode 就得照它办） */
  if (mode === 'all' && !allHit) return { evidence: null, dropped }
  if (!best) return { evidence: null, dropped }
  return {
    evidence: {
      collectionId: c.id,
      collectionName: c.name,
      via: 'keyword',
      keyword: best.keyword,
      hits: best.hits,
      priority: priorityOf(c)
    },
    dropped
  }
}

/** 排序：优先级高 → 决定性关键词长（更具体）→ 命中 token 多 → 集合名（只为日志稳定，**不作裁定依据**） */
function byStrength(a: MatchEvidence, b: MatchEvidence): number {
  if (a.priority !== b.priority) return b.priority - a.priority
  if (a.keyword.length !== b.keyword.length) return b.keyword.length - a.keyword.length
  if (a.hits !== b.hits) return b.hits - a.hits
  return a.collectionName.localeCompare(b.collectionName)
}

/**
 * 主入口：这个工程该切去哪个集合。
 *
 * 三条口径（都是裁定过的）：
 *  - `rule.projectPaths` 精确路径**最高优先**，命中就直接切，不再比关键词（§4.3 步骤 3「以后都这样」）；
 *  - 关键词命中后按 priority → 最长关键词 仲裁；
 *  - **仲裁到最后还平手 → `ambiguous`，调用方不许硬选**（Q1）。
 */
export function matchProject(
  fp: ProjectFingerprint,
  collections: MatchableCollection[],
  opts: MatchOptions = {}
): MatchOutcome {
  /** ① 精确路径 */
  const pathHits: MatchEvidence[] = []
  for (const c of collections) {
    const p = pathHit(c, opts.projectPath)
    if (p)
      pathHits.push({
        collectionId: c.id,
        collectionName: c.name,
        via: 'projectPath',
        keyword: p,
        hits: 1,
        priority: priorityOf(c)
      })
  }
  if (pathHits.length === 1) return { kind: 'hit', evidence: pathHits[0] }
  if (pathHits.length > 1) {
    /** 同一条路径被写进两个集合 = 用户自己冲突了，也不硬选（Q1 同一条理由） */
    return { kind: 'ambiguous', evidence: pathHits }
  }

  const fpTokens = fingerprintTokens(fp)
  const dropped: DroppedKeyword[] = []
  /** ② 关键词 */
  if (!fpTokens.size) {
    /** 指纹彻底是空的（首帧连目录名都没有）：如实报没命中，别猜 */
    return { kind: 'none', tried: collections.length, dropped }
  }
  const candidates: MatchEvidence[] = []
  for (const c of collections) {
    const r = evaluate(c, fpTokens, opts)
    dropped.push(...r.dropped)
    if (r.evidence) candidates.push(r.evidence)
  }
  if (!candidates.length) return { kind: 'none', tried: collections.length, dropped }

  candidates.sort(byStrength)
  const top = candidates[0]
  const tied = candidates.filter(
    (e) => e.priority === top.priority && e.keyword.length === top.keyword.length && e.via === top.via
  )
  if (tied.length > 1) return { kind: 'ambiguous', evidence: tied }
  return { kind: 'hit', evidence: top }
}

/** 平手时给日志/横幅用的一句话名单（`Shinano A、Shinano B`）。Q1 的"留痕"要求的一半 */
export function namesOf(evidence: MatchEvidence[]): string {
  return evidence.map((e) => e.collectionName).join('、')
}

/** 归一化一个小写串（导出来只为让测试能钉"匹配用的是 fold"） */
export function normalizeForMatch(s: string): string {
  return fold(s).toLowerCase()
}
