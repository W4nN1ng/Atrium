/**
 * 主进程侧的词典访问（worker 里那份是它自己的，两边不共享内存）。
 *
 * 为什么要缓存：loadLexicon 读的是 854 条 JSON，「重新整理合集」这类操作
 * 一次要对每个素材跑一遍 deriveGroupKey，不能每次都重新读盘。
 */
import path from 'node:path'
import { loadLexicon, type Lexicon } from '../classify/lexicon'
import { lexiconFile, P } from './paths'

let cached: { builtin: string; user: string; lex: Lexicon } | null = null

export function mainLexicon(): Lexicon {
  const builtin = lexiconFile('lexicon.json')
  const user = P.userLexicon()
  if (cached && cached.builtin === builtin && cached.user === user) return cached.lex
  const lex = loadLexicon({ builtin, user })
  cached = { builtin, user, lex }
  return lex
}

/** 改了自定义词条时要让它重新读（userLexicon 那边写完调一下） */
export function invalidateLexicon(): void {
  cached = null
}

export const lexiconPathOf = (): string => path.basename(lexiconFile('lexicon.json'))
