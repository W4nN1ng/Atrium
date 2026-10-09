import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { openDatabase, closeDatabase, collectStats } from '../../src/main/db'
import { planRegroup, applyRegroup } from '../../src/main/library/regroup'
import { journalPayload } from '../../src/main/db/repos/journal'

/**
 * #40 存量清理：在**真库的副本**上干跑，再（可选）对真库执行。
 *
 * 两级门控，默认什么都不做：
 *   干跑（推荐先跑这个，只碰副本）：
 *     AVCA_DRYRUN_REGROUP=1 npx vitest run tests/real/realdb-regroup.spec.ts
 *   真库执行（用户已批准 2026-10-06）：
 *     AVCA_APPLY_REGROUP=1 AVCA_APPLY_CONFIRM=执行真库 npx vitest run tests/real/realdb-regroup.spec.ts
 *
 * 为什么要有干跑：真库 13 个跨目录组里**只有 8 个该拆**，另 5 个是
 * 「同一产品的压缩包 + 已解压副本」，按裁定 #16 必须保持一张卡。
 * 这个数字必须先亲眼看到，再动真库。
 *
 * 这一步**只写库、一个文件都不碰**，所以前后都做整库路径+字节数快照对比。
 */

const APPDATA = process.env.APPDATA || ''
const REAL_DB = path.join(APPDATA, 'A', 'library.db')
const LIB = process.env.AVCA_REAL_LIB || 'E:\\vrc\\A'
const DRY = process.env.AVCA_DRYRUN_REGROUP === '1'
const APPLY = process.env.AVCA_APPLY_REGROUP === '1' && process.env.AVCA_APPLY_CONFIRM === '执行真库'
const GO = DRY || APPLY

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

describe.skipIf(!GO)('#40 拆开跨目录归并组', () => {
  it('干跑/执行：预览 → 写库 → 磁盘未动 → 可撤销', () => {
    /** 干跑：把真库复制一份到临时目录，只动副本（C 盘那点空间放得下 2.3 MB） */
    let target = REAL_DB
    let copy = ''
    if (DRY) {
      copy = path.join(os.tmpdir(), `avca-regroup-dry-${Date.now()}.db`)
      fs.copyFileSync(REAL_DB, copy)
      target = copy
      console.log(`[干跑] 真库只读复制到 ${copy}（${(fs.statSync(copy).size / 1048576).toFixed(2)} MB），只动副本`)
    }

    const beforeFiles = snapshot(LIB)
    const db = openDatabase(target)
    try {
      const ver = (db.prepare(`PRAGMA user_version`).get() as { user_version: number }).user_version
      const hasDirKey = (db.prepare(`PRAGMA table_info(asset_group)`).all() as Array<{ name: string }>).some(
        (c) => c.name === 'dir_key'
      )
      console.log(`[迁移] user_version=${ver}  asset_group.dir_key=${hasDirKey ? '有' : '无'}`)

      const s0 = collectStats(db)
      const t0 = Date.now()
      const plan = planRegroup(db)
      const tPlan = Date.now() - t0

      console.log(
        `[只读预览] 扫了 ${plan.scanned} 个组，耗时 ${tPlan}ms；` +
          `会拆 ${plan.groups.length} 组 / 影响 ${plan.affected} 行；保持归并 ${plan.kept.length} 组`
      )
      for (const g of plan.groups) {
        console.log(`  拆 [${g.groupKey}] 「${g.groupName}」 ${g.before.length} 个 → ${g.clusters.length} 组`)
        for (const c of g.clusters) {
          console.log(`      → ${c.dirKey ?? '(无目录)'}  (${c.names.length} 行)`)
        }
      }
      for (const k of plan.kept) {
        console.log(`  留 [${k.groupKey}] 「${k.groupName}」 ${k.reason}`)
        for (const d of k.dirs) console.log(`      = ${d}`)
      }

      /** 真库实测应当是 8 拆 / 5 留 —— 对不上就说明判据和数据漂了，先别看结论 */
      if (target === REAL_DB || DRY) {
        console.log(`[核对] 期望 8 组拆开 / 5 组保持（真库 2026-10-06 实测）`)
      }

      const t1 = Date.now()
      const r = applyRegroup(db, plan)
      const tApply = Date.now() - t1
      const s1 = collectStats(db)
      console.log(`[写库] ${r.groups} 组 / ${r.moved} 行改挂 / 新建 ${r.createdGroups} 个组，耗时 ${tApply}ms，batchId=${r.batchId}`)

      /** 每条被拆的行必须落在"它自己目录"对应的组上 —— 这是本次修复的核心不变量 */
      let bad = 0
      for (const g of plan.groups) {
        for (const c of g.clusters) {
          const want = c.dirKey
          for (const id of c.assetIds) {
            const row = db.prepare(`SELECT a.group_id AS gid, g.dir_key AS dk FROM asset a
                LEFT JOIN asset_group g ON g.id = a.group_id WHERE a.id = ?`).get(id) as
              | { gid: string | null; dk: string | null }
              | undefined
            if (!row || row.dk !== want) {
              bad++
              console.log(`  ⚠ 行 ${id} 的组 dir_key=${row?.dk ?? 'null'}，期望 ${want}`)
            }
          }
        }
      }
      expect(bad, '每个成员的组 dir_key 必须等于它自己所在目录').toBe(0)
      console.log(`[不变量] 所有被拆行的 group.dir_key 都等于自身目录 ✓`)

      /**
       * 撤销凭据取 `reparent` 那条 —— 批次里还有一条 `register`（只记新建的组、没有 changes），
       * 拿错那条会打印出"条目数 0"，看着像没记东西。
       */
      const jr = db
        .prepare(`SELECT * FROM journal WHERE op = 'reparent' AND undone = 0 ORDER BY id DESC LIMIT 1`)
        .get() as { id: number; op: string } | undefined
      expect(jr, '执行完必须留下一条可撤销的 reparent journal').toBeTruthy()
      const payload = journalPayload(jr as never)
      console.log(
        `[前后对比] 素材 ${s0.assets}→${s1.assets}、附属 ${s0.attachments}→${s1.attachments}、` +
          `容器 ${s0.bundles}→${s1.bundles}、子项 ${s0.bundleItems}→${s1.bundleItems}、` +
          `待复核 ${s0.review}→${s1.review}`
      )
      console.log(`[撤销凭据] journal id=${jr!.id} op=${jr!.op} 改挂条目=${(payload.changes ?? []).length}`)
      console.log(`[撤销方法] 程序里 Ctrl+Z，或设置 → 维护 → 「拆开跨目录的归并组」旁那个撤销按钮`)

      /** 反查一遍：拆完之后不该还剩任何"成员跨目录"的组 */
      const left = planRegroup(db)
      console.log(`[复查] 再扫一次：还剩 ${left.groups.length} 组可拆（应为 0）、${left.kept.length} 组保持归并`)
      expect(left.groups.length, '拆完不该还剩可拆的组').toBe(0)
    } finally {
      closeDatabase()
    }

    const afterFiles = snapshot(LIB)
    const same = afterFiles.length === beforeFiles.length && afterFiles.every((x, i) => x === beforeFiles[i])
    console.log(
      `[磁盘核对] 文件数 ${beforeFiles.length} → ${afterFiles.length}，` +
        `${same ? '路径与字节数逐项一致（一个文件都没动）' : '不一致！！'}`
    )
    expect(same, '执行前后整棵库的路径+字节数必须逐项一致').toBe(true)

    if (copy) {
      try {
        fs.rmSync(copy, { force: true })
        console.log(`[干跑] 已删副本 ${copy}`)
      } catch {
        /* 交给系统 */
      }
    }
  })
})
