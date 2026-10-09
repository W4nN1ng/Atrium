/**
 * 用户自己加的词典词条（第 2 份 §5.4 的"词典管理"，也是设置页分类 tab 里那个框）。
 *
 * 为什么不写进 resources/lexicon/lexicon.user.json：打包之后 resources/ 是只读的
 * （而且 electron-builder 每次都会重写整个 win-unpacked），用户的东西必须落在 %APPDATA%\A。
 *
 * 文件格式和内置词典一样是 { entries: [...] }，这样 loadLexicon 一份代码读两处。
 * 内置词典排在前面读、用户词典排在后面读，同词以用户为准。
 */
import fs from 'node:fs'
import path from 'node:path'
import { P, lexiconFile } from '../services/paths'
import { normTerm, type LexDim } from '../classify/lexicon'

export interface UserTerm {
  term: string
  cat: string | null
  sub: string | null
  /** 带分类的词条用 'theme'（内置词典里 461 条分类词条全是这个维度） */
  dim: LexDim
  w: number
}

interface UserFile {
  schema: number
  updatedAt: number
  entries: UserTerm[]
}

function empty(): UserFile {
  return { schema: 1, updatedAt: Date.now(), entries: [] }
}

export function readUserTerms(): UserTerm[] {
  try {
    const raw = fs.readFileSync(P.userLexicon(), 'utf8')
    const j = JSON.parse(raw) as UserFile
    /**
     * cat 允许是 null：§B4「从库中学习模型名」加进来的是 avatar 维度词条，
     * 它们**不带分类**（内置词典里 90 条 avatar 也全是 cat=null）。
     * 早先这里写死 `typeof cat === 'string'`，学来的模型名会在设置页里凭空消失。
     */
    return Array.isArray(j?.entries)
      ? j.entries.filter((e) => typeof e?.term === 'string' && (typeof e?.cat === 'string' || e?.cat === null))
      : []
  } catch {
    return []
  }
}

/**
 * §B4：把「从库中学习」扫出来的模型名一次写进用户词典。
 *
 * 走这里而不是各写各的 JSON：这个文件的格式（schema/updatedAt/entries + tmp 改名落盘）
 * 只有一份实现，第二份写出来早晚和读的那份对不上。
 */
export function addUserAvatarTerms(tokens: string[]): { added: number } {
  const want = tokens.map((t) => normTerm(t)).filter((t) => t.length >= 2)
  if (!want.length) return { added: 0 }
  const have = readUserTerms()
  const seen = new Set(have.map((e) => e.term.toLowerCase()))
  const fresh: UserTerm[] = []
  for (const t of want) {
    if (seen.has(t)) continue
    seen.add(t)
    fresh.push({ term: t, cat: null, sub: null, dim: 'avatar', w: 5 })
  }
  if (!fresh.length) return { added: 0 }
  writeAll([...have, ...fresh])
  return { added: fresh.length }
}

function writeAll(entries: UserTerm[]): void {
  const file = P.userLexicon()
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = file + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify({ schema: 1, updatedAt: Date.now(), entries } satisfies UserFile, null, 2), 'utf8')
  fs.renameSync(tmp, file)
}

export interface AddResult {
  ok: boolean
  errorKey?: 'settings.termEmpty' | 'settings.termBad' | 'settings.termUnknownCat'
  entries: UserTerm[]
}

/** 只用到"有哪些分类 key"，所以收一个最小形状：单测能直接喂 JSON，不必拉 electron */
export interface CategoryKeys {
  categories: Array<{ key: string; subcategories: Array<{ key: string }> }>
}

/** 加（或改）一条：同名的旧词条直接被覆盖，因为 loadLexicon 也是按词去重 */
export function addUserTerm(
  input: { term: string; cat: string; sub?: string | null; w?: number },
  cfg: CategoryKeys
): AddResult {
  const term = normTerm(input.term ?? '')
  const cat = normTerm(input.cat ?? '')
  if (!term || !cat) return { ok: false, errorKey: 'settings.termEmpty', entries: readUserTerms() }
  if (!/^[\w\u3400-\u9fff\u3041-\u30ff .+-]+$/u.test(term)) return { ok: false, errorKey: 'settings.termBad', entries: readUserTerms() }
  // 分类 key 得真的存在：写进去一个引擎不认识的 key，等于埋一条永远命中不了的规则
  const chosen = cfg.categories.find((c) => c.key === cat)
  if (!chosen) return { ok: false, errorKey: 'settings.termUnknownCat', entries: readUserTerms() }
  const sub = normTerm(input.sub ?? '')
  if (sub && !chosen.subcategories.some((s) => s.key === sub)) {
    return { ok: false, errorKey: 'settings.termUnknownCat', entries: readUserTerms() }
  }
  const w = typeof input.w === 'number' && Number.isFinite(input.w) ? Math.max(0.1, Math.min(5, input.w)) : 2
  const entry: UserTerm = { term, cat, sub: sub || null, dim: 'theme', w }
  const rest = readUserTerms().filter((e) => e.term.toLowerCase() !== term.toLowerCase())
  writeAll([...rest, entry])
  return { ok: true, entries: readUserTerms() }
}

export function removeUserTerm(term: string): UserTerm[] {
  const want = term.trim().toLowerCase()
  writeAll(readUserTerms().filter((e) => e.term.toLowerCase() !== want))
  return readUserTerms()
}

/**
 * 内置词典有多大（界面上要告诉用户"另有 854 条内置词条"）。
 *
 * 路径必须走 lexiconFile()：dev 时词典在项目根的 resources/ 下，
 * 直接拼 process.resourcesPath 会指到 Electron 自己的 resources，读出 0 条。
 */
export function builtinLexiconCount(): number {
  try {
    const j = JSON.parse(fs.readFileSync(lexiconFile('lexicon.json'), 'utf8')) as { count?: number; entries?: unknown[] }
    return typeof j.count === 'number' ? j.count : Array.isArray(j.entries) ? j.entries.length : 0
  } catch {
    return 0
  }
}
