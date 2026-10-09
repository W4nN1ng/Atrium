/**
 * §B4「从库中学习模型名」。
 *
 * 为什么要这个：avatar 词表写死在代码里的话，每来一个新模型就得改一次源码、重打包，
 * 用户的库越攒越大，这条路走不通。所以让词表能自己长 ——
 * 扫库里 `<模型>_<系列>` 这种方括号槽位结构，把反复出现、词典还不认识的名字列出来，
 * 用户在设置页点一下就进 `lexicon.user.json`（用户词典，可导出分享，不动内置词典）。
 *
 * **规格里的「频次 ≥3」在真库上一条都捞不到**，这条得改：
 * `E:\vrc\A\衣服\名流\` 那 20 个 Libero 是 20 个**不同**模型各出现 1 次，
 * 按 ≥3 筛完全空手（实测跑过，见 tools/scan-avatar-tokens.cjs 的输出）。
 * 真正有信号的判据是"**同一个系列下有一批不同的名字**" ——
 * 一个系列挂着 24 个候选名，那这 24 个几乎必然是模型，哪怕每个只出现 1 次。
 * 所以这里两条都收：单名频次 ≥3，或者同系列下候选名 ≥3 个。
 */
import type { Db } from '../db'
import { deriveGroupKey } from '../classify/groupKey'
import type { Lexicon } from '../classify/lexicon'
import type { LearnCandidate } from '../../shared/api'

/** 扫描上限：库再大也不能把主进程按死 */
const MAX_ROWS = 20000

interface Slot {
  token: string
  series: string
}

/** 从一批名字里把方括号槽位拆出来（复用 deriveGroupKey，口径必须和归并一致） */
function slotsOf(names: string[], lex: Lexicon): Slot[] {
  const out: Slot[] = []
  for (const n of names) {
    const t = deriveGroupKey(n, lex)
    if (!t.variantRaw.length) continue
    const series = t.series[0] ?? ''
    for (const tok of variantTokens(t.variantRaw[0])) {
      if (tok.length < 2 || tok.length > 24) continue
      if (/^[0-9.\s]+$/.test(tok)) continue
      out.push({ token: tok, series })
    }
  }
  return out
}

/** 槽位第一段按连接符拆（`Chiffon&Chocolat` → 两个）；和 groupKey 的 §B3 同一套符号 */
const COMP = /[&\uFF06+\uFF0B\u3001,\uFF0C]/
function variantTokens(raw: string): string[] {
  const head = raw.split(/[_\uFF3F]/)[0] ?? ''
  return head
    .split(COMP)
    .map((s) => s.trim())
    .filter(Boolean)
}

/**
 * 扫库。数据源是 asset 表的 raw_name（已入库的）——
 * 不去爬磁盘：25GB 的库爬一遍要几十秒，而 raw_name 已经把所有文件名都记着了。
 */
export function scanLearnCandidates(db: Db, lex: Lexicon): LearnCandidate[] {
  const rows = db.prepare(`SELECT raw_name, name FROM asset WHERE attachment_kind IS NULL LIMIT ?`).all(MAX_ROWS) as Array<{
    raw_name: string
    name: string
  }>
  const names: string[] = []
  for (const r of rows) {
    if (r.raw_name) names.push(r.raw_name)
    if (r.name && r.name !== r.raw_name) names.push(r.name)
  }
  const slots = slotsOf(names, lex)

  const hits = new Map<string, number>()
  const seriesOf = new Map<string, string>()
  const seriesMembers = new Map<string, Set<string>>()
  for (const s of slots) {
    hits.set(s.token, (hits.get(s.token) ?? 0) + 1)
    if (s.series && !seriesOf.has(s.token)) seriesOf.set(s.token, s.series)
    if (s.series) {
      const set = seriesMembers.get(s.series) ?? new Set()
      set.add(s.token)
      seriesMembers.set(s.series, set)
    }
  }

  const out: LearnCandidate[] = []
  for (const [token, n] of hits) {
    if (lex.dimOf(token)) continue // 词典已经认识了，不用学
    const series = seriesOf.get(token) ?? null
    const size = series ? (seriesMembers.get(series)?.size ?? 0) : 0
    /** 两条判据满足一条就列出来（见文件头：真库靠的是第二条） */
    if (n < 3 && size < 3) continue
    out.push({ token, hits: n, series, seriesSize: size })
  }
  return out.sort((a, b) => b.seriesSize - a.seriesSize || b.hits - a.hits || a.token.localeCompare(b.token))
}

