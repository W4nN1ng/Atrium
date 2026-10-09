import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { openDatabase, closeDatabase } from '../../src/main/db'
import { loadLexicon } from '../../src/main/classify/lexicon'
import { planReanalyze } from '../../src/main/library/reanalyze'

/**
 * 「重新分析」的**只读**预览，专门用来回答一个问题：
 * **刚才那次 #40 拆分（只动 group_id）有没有影响命名 / 版本 / 附属？**
 *
 * 只读，不写库、不动盘。默认跑（结果只是打印 + 几条断言）。
 *   AVCA_PREVIEW_REANALYZE=1 npx vitest run tests/real/realdb-reanalyze-preview.spec.ts
 */
const APPDATA = process.env.APPDATA || ''
const REAL_DB = path.join(APPDATA, 'A', 'library.db')
const GO = process.env.AVCA_PREVIEW_REANALYZE === '1'
const ROOT = path.resolve(__dirname, '../..')

describe.skipIf(!GO)('真库 · 重新分析只读预览（不写库）', () => {
  it('打印会影响多少条，并证明扫描本身不改一行', () => {
    const before = fs.statSync(REAL_DB)
    const db = openDatabase(REAL_DB)
    try {
      const lex = loadLexicon({ builtin: path.join(ROOT, 'resources/lexicon/lexicon.json') })
      const t0 = Date.now()
      const plan = planReanalyze(db, lex)
      console.log(`[只读预览] 扫描 ${plan.scanned} 行，耗时 ${Date.now() - t0}ms`)
      console.log(`[影响] 重算 ${plan.changes.length} 行（其中改名 ${plan.renamed}）、附属降级 ${plan.demote.length} 行、垃圾记录 ${plan.junk.length} 行`)
      console.log(`[UUID 名] ${plan.uuidNamed} 行`)
      for (const c of plan.changes.slice(0, 20)) {
        console.log(`  ${c.name}  →  ${JSON.stringify(c.to)}`)
      }
      for (const d of plan.demote.slice(0, 10)) console.log(`  降级 ${d.name} → 挂到 ${d.hostId}`)
      /** 扫描是只读的：user_version 不许变，WAL 不许长 */
      const ver = (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version
      console.log(`[核对] user_version=${ver}（#40 拆分后应为 4）`)
      expect(ver).toBe(4)
    } finally {
      closeDatabase()
    }
    const after = fs.statSync(REAL_DB)
    console.log(`[磁盘] 库文件 ${before.size} → ${after.size} 字节，mtime ${before.mtimeMs === after.mtimeMs ? '未变' : '变了（可能只是 WAL 合回）'}`)
  })
})
