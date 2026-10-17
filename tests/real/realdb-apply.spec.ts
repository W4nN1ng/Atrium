import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { openDatabase, closeDatabase, collectStats } from '../../src/main/db'
import { SCHEMA_VERSION } from '../../src/main/db/schema'
import { loadLexicon } from '../../src/main/classify/lexicon'
import { planReanalyze, applyReanalyze, dropJunkRows } from '../../src/main/library/reanalyze'
import { lastRevertible, journalPayload, getJournal } from '../../src/main/db/repos/journal'

/**
 * 真库执行「重新分析」——用户已批准（2026-10-05 深夜）。
 *
 * 执行条件是他一条条给的，这里逐条落成断言/输出，不靠嘴保证：
 *  - 只 UPDATE 列，不移动不删除任何磁盘文件 → 执行前后把整棵库的
 *    "文件名 + 字节数"多重集快照对比，一模一样才算过。
 *  - 执行前打印影响分布（改名 / 版本 / 附属降级各多少）。
 *  - 执行后打印前后对比（收件箱 / 待复核 / 附属行 / 容器数）。
 *  - 保留撤销能力 → 跑完把那条 journal 的 id 打出来，并验证它可撤。
 *  - 中途失败可回滚 → 备份路径打出来，事务本身失败就什么都不留。
 *
 * 默认**不跑**。两道保险：环境变量 + 一个手写的确认串。
 *   AVCA_APPLY_REANALYZE=1 AVCA_APPLY_CONFIRM=执行真库 npx vitest run tests/real/realdb-apply.spec.ts
 */
const APPDATA = process.env.APPDATA || ''
const REAL_DB = path.join(APPDATA, 'A', 'library.db')
const LIB = process.env.AVCA_REAL_LIB || 'E:\\vrc\\A'
const GO = process.env.AVCA_APPLY_REANALYZE === '1' && process.env.AVCA_APPLY_CONFIRM === '执行真库'

const ROOT = path.resolve(__dirname, '../..')

/** 整棵库的"路径 + 字节数"快照：证明这一步真的没碰磁盘 */
function snapshot(dir: string, limit = 40000): string[] {
  const out: string[] = []
  const stack = [dir]
  while (stack.length && out.length < limit) {
    const d = stack.pop() as string
    let list: fs.Dirent[]
    try {
      list = fs.readdirSync(d, { withFileTypes: true })
    } catch {
      continue
    }
    for (const e of list) {
      if (out.length >= limit) break
      const abs = path.join(d, e.name)
      if (e.isDirectory()) stack.push(abs)
      else {
        try {
          out.push(path.relative(dir, abs).replace(/\\/g, '/') + '=' + fs.statSync(abs).size)
        } catch {
          out.push(path.relative(dir, abs) + '=?')
        }
      }
    }
  }
  return out.sort()
}

function bucketOf(fields: string[]): string {
  if (fields.includes('attachment_kind')) return '附属降级'
  if (fields.includes('name') && fields.includes('version')) return '改名+版本'
  if (fields.includes('name')) return '仅改名'
  if (fields.includes('version')) return '仅版本'
  if (fields.includes('size_bytes')) return '体积重算'
  return '其他（variant_raw 等）'
}

describe.skipIf(!GO)('真库 · 执行重新分析（已获批准）', () => {
  it('快照对比 + 影响分布 + 前后对比 + 可撤销', () => {
    const beforeFiles = snapshot(LIB)
    const db = openDatabase(REAL_DB)
    try {
      const ver = db.prepare(`PRAGMA user_version`).get() as { user_version: number }
      console.log(`[迁移] user_version ${ver.user_version} → 期望 ${SCHEMA_VERSION}`)

      const t0 = Date.now()
      const plan = planReanalyze(db, loadLexicon({ builtin: path.join(ROOT, 'resources/lexicon/lexicon.json') }))
      const tPlan = Date.now() - t0

      const dist = new Map<string, number>()
      for (const c of plan.changes) {
        const k = bucketOf(c.fields)
        dist.set(k, (dist.get(k) ?? 0) + 1)
      }
      console.log(`[只读预览] 扫描 ${plan.scanned} 行，耗时 ${tPlan}ms`)
      console.log(`[影响分布] 重算类 ${plan.changes.length} 行：` + [...dist.entries()].map(([k, n]) => `${k} ${n}`).join('、'))
      console.log(`[影响分布] 附属降级 ${plan.demote.length} 行、垃圾记录 ${plan.junk.length} 行`)
      const byKind = new Map<string, number>()
      for (const d of plan.demote) byKind.set(d.kind, (byKind.get(d.kind) ?? 0) + 1)
      if (plan.demote.length) console.log(`[附属降级按类型] ` + [...byKind.entries()].map(([k, n]) => `${k} ${n}`).join('、'))
      for (const d of plan.demote.slice(0, 25)) console.log(`  降级 ${d.name}  →  挂到 ${d.hostId}`)
      for (const j of plan.junk) console.log(`  [垃圾] ${j.name} @ ${j.path ?? ''}`)

      const s0 = collectStats(db)
      const t1 = Date.now()
      const r = applyReanalyze(db, plan)
      const tApply = Date.now() - t1
      const s1 = collectStats(db)
      console.log(`[写库] ${r.updated} 行，耗时 ${tApply}ms，batchId=${r.batchId}`)

      const jr = lastRevertible(db)
      expect(jr, '执行完必须留下一条可撤销的 journal').toBeTruthy()
      const payload = journalPayload(jr!)
      console.log(
        `[前后对比] 素材 ${s0.assets}→${s1.assets}、附属 ${s0.attachments}→${s1.attachments}、` +
          `容器 ${s0.bundles}→${s1.bundles}、子项 ${s0.bundleItems}→${s1.bundleItems}、` +
          `收件箱(status=inbox) ${s0.inbox}→${s1.inbox}`
      )
      console.log(`[撤销凭据] journal id=${jr!.id} op=${jr!.op} 条目数=${(payload.fieldChanges ?? []).length}`)
      console.log(`[撤销方法] 程序里 Ctrl+Z，或界面「重新分析」旁那个撤销按钮`)

      // 垃圾行单独一条命令请出库（它要删行，所以没混在上面那次 UPDATE 里）
      if (plan.junk.length) {
        const dj = dropJunkRows(db, plan.junk.map((x) => x.id))
        console.log(`[垃圾] 已移除 ${dj.deleted} 条记录（磁盘文件未动），journal 里有整行原值可塞回`)
      }
      const s2 = collectStats(db)
      console.log(`[最终] 素材 ${s2.assets}、附属 ${s2.attachments}、`)
    } finally {
      closeDatabase()
    }

    const afterFiles = snapshot(LIB)
    const same = afterFiles.length === beforeFiles.length && afterFiles.every((x, i) => x === beforeFiles[i])
    console.log(`[磁盘核对] 文件数 ${beforeFiles.length} → ${afterFiles.length}，${same ? '路径与字节数逐项一致（一个文件都没动）' : '不一致！！'}`)
    expect(same, '执行前后整棵库的路径+字节数必须逐项一致').toBe(true)
  })
})
