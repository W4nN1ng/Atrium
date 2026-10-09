import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'
import { openDatabase, closeDatabase, collectStats } from '../../src/main/db'
import { SCHEMA_VERSION } from '../../src/main/db/schema'
import { ensureGroup } from '../../src/main/db/repos/product'
import { dirKeyOf } from '../../src/shared/pathkey'
import { planReanalyze, applyReanalyze } from '../../src/main/library/reanalyze'
import { undoLast } from '../../src/main/library/undo'
import { loadLexicon } from '../../src/main/classify/lexicon'

/**
 * 拿**他机器上那个真库的副本**跑一遍 schema 迁移 + 重新分析的只读预览。
 *
 * 两条硬规矩：
 *  1. 只在**副本**上跑。真库文件一个字节都不写 —— 迁移要 ALTER TABLE，
 *     在用户点头之前动他的库不该发生。跑完还会核对原文件字节数没变。
 *  2. 默认整份跳过：要 %APPDATA%\A\library.db 在、且显式设了环境变量才跑，
 *     否则就变成"换台机器就红"的测试。
 *
 * 跑法（Node ABI，先 npm run native:node）：
 *   AVCA_CHECK_REAL_DB=1 npx vitest run tests/real/realdb-migration.spec.ts
 * 它打出来的那行"会影响多少条"就是交付要求点名的那个预览。
 */
const APPDATA = process.env.APPDATA || ''
const REAL_DB = path.join(APPDATA, 'A', 'library.db')
const GO = !!process.env.AVCA_CHECK_REAL_DB && fs.existsSync(REAL_DB)
const ROOT = path.resolve(__dirname, '../..')

/** 只读连接数一遍行数（不迁移、不写） */
function readOnlyCount(file: string): { rows: number; bytes: number } {
  const raw = new Database(file, { readonly: true })
  try {
    const n = (raw.prepare(`SELECT COUNT(*) AS n FROM asset`).get() as { n: number }).n
    return { rows: n, bytes: fs.statSync(file).size }
  } finally {
    raw.close()
  }
}

describe.skipIf(!GO)('真库副本 · schema 迁移 + 重新分析预览', () => {
  it('V2/V3 迁移跑通、行数一条不少，并给出"会影响多少条"的预览', async () => {
    const original = readOnlyCount(REAL_DB)
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'avca-realdbmig-'))
    const copy = path.join(tmp, 'library.db')
    fs.copyFileSync(REAL_DB, copy)

    const db = openDatabase(copy)
    try {
      const ver = db.prepare(`PRAGMA user_version`).get() as { user_version: number }
      expect(ver.user_version, '迁移没跑到最新版').toBe(SCHEMA_VERSION)

      const cols = new Set((db.prepare(`PRAGMA table_info(asset)`).all() as Array<{ name: string }>).map((c) => c.name))
      for (const c of ['parent_asset_id', 'is_bundle', 'needs_review', 'attachment_kind', 'container_kind', 'variant_raw']) {
        expect(cols.has(c), `asset 缺列 ${c}`).toBe(true)
      }
      const gcols = new Set((db.prepare(`PRAGMA table_info(asset_group)`).all() as Array<{ name: string }>).map((c) => c.name))
      expect(gcols.has('cover_image'), 'asset_group.cover_image 没加上').toBe(true)

      const after = (db.prepare(`SELECT COUNT(*) AS n FROM asset`).get() as { n: number }).n
      expect(after, '迁移不许丢行或造行').toBe(original.rows)
      void after

      const stats = collectStats(db)
      console.log(
        `真库副本：asset ${after} 行 / 素材 ${stats.assets} / 容器 ${stats.bundles} / 子项 ${stats.bundleItems} / 附属 ${stats.attachments} / 待复核 ${stats.review} / ${Math.round(stats.totalBytes / 1048576)} MB`
      )

      const t0 = Date.now()
      const plan = planReanalyze(db, loadLexicon({ builtin: path.join(ROOT, 'resources/lexicon/lexicon.json') }))
      const tPlan = Date.now() - t0
      console.log(
        `重新分析预览：扫描 ${plan.scanned} 条 → 改名/版本 ${plan.changes.length} 条（改名 ${plan.renamed}）；` +
          `附属降级 ${plan.demote.length} 条；名字里还挂着 UUID ${plan.uuidNamed} 条；垃圾记录 ${plan.junk.length} 条`
      )
      /** 降级会直接改到"素材总数 / 待复核"两个口径上，所以前后都打一遍 */
      const statBefore = collectStats(db)
      const t1 = Date.now()
      const r = applyReanalyze(db, plan)
      const tApply = Date.now() - t1
      const statAfter = collectStats(db)
      console.log(
        `副本上试跑一次（真库未动）：写入 ${r.updated} 行 → 素材 ${statBefore.assets}→${statAfter.assets}、` +
          `附属 ${statBefore.attachments}→${statAfter.attachments}、待复核 ${statBefore.review}→${statAfter.review}`
      )
      const u = await undoLast({ db, holdDir: path.join(tmp, 'hold') })
      const undone = collectStats(db)
      console.log(
        `撤销试跑：ok=${u.ok} → 素材回到 ${undone.assets}、附属 ${undone.attachments}、待复核 ${undone.review}`
      )
      console.log(`耗时：只读预览 ${tPlan}ms / 写库 ${tApply}ms`)
      for (const c of plan.changes.slice(0, 40)) {
        console.log(`  [${c.fields.join('+')}] ${c.name}  →  ${String(c.to.name ?? c.name)}`)
      }
      for (const j of plan.junk.slice(0, 20)) console.log(`  [junk] ${j.name}  @ ${j.path ?? ''}`)

      /** plan 必须真的只读：跑完再点一次，行数还是一样的 */
      expect((db.prepare(`SELECT COUNT(*) AS n FROM asset`).get() as { n: number }).n).toBe(after)
    } finally {
      closeDatabase()
      fs.rmSync(tmp, { recursive: true, force: true })
      expect(fs.statSync(REAL_DB).size, '真库本体被改动过').toBe(original.bytes)
    }
  })

  it('V4（#40）：dir_key 回填结果要和 tools/probe-groups.cjs 量到的一致，历史误并组不再吃新成员', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'avca-v4-'))
    const copy = path.join(tmp, 'library.db')
    fs.copyFileSync(REAL_DB, copy)
    const raw = new Database(copy, { readonly: true })
    const rowsBefore = (raw.prepare(`SELECT COUNT(*) n FROM asset`).get() as { n: number }).n
    const groupsBefore = (raw.prepare(`SELECT COUNT(*) n FROM asset_group`).get() as { n: number }).n
    const versionBefore = (raw.prepare(`PRAGMA user_version`).get() as { user_version: number }).user_version
    raw.close()

    const db = openDatabase(copy)
    try {
      expect((db.prepare(`PRAGMA user_version`).get() as { user_version: number }).user_version, 'V4 没应用').toBe(SCHEMA_VERSION)
      const gcols = new Set((db.prepare(`PRAGMA table_info(asset_group)`).all() as Array<{ name: string }>).map((c) => c.name))
      expect(gcols.has('dir_key'), 'asset_group.dir_key 没加上').toBe(true)
      /** V5（M5-B）：真库升到 5 之后，老的 import_log 行三列必须是 NULL */
      const ilcols = new Set((db.prepare(`PRAGMA table_info(import_log)`).all() as Array<{ name: string }>).map((c) => c.name))
      for (const c of ['container_asset_id', 'member_rel_path', 'origin_archive']) {
        expect(ilcols.has(c), `import_log.${c} 没加上（V5 没应用？）`).toBe(true)
      }
      const notNull = (
        db.prepare(`select count(*) n from import_log where container_asset_id is not null or member_rel_path is not null or origin_archive is not null`).get() as { n: number }
      ).n
      const ilTotal = (db.prepare(`select count(*) n from import_log`).get() as { n: number }).n
      console.log(`  V5：import_log ${ilTotal} 行里 ${notNull} 行带容器信息（老行应为 0 —— V5 明确不回填）`)
      expect(notNull, 'V5 不许回填老记录').toBe(0)
      /** V1 那条 UNIQUE(group_key, category) 必须让位，否则第二个"同 key 不同目录"的组根本插不进去 */
      const uniq = (db.prepare(`PRAGMA index_list(asset_group)`).all() as Array<{ name: string; unique: number }>).filter((i) => i.unique)
      expect(uniq.some((i) => i.name === 'idx_group_key_cat'), '老的单目录唯一索引还在').toBe(false)

      const withDir = (db.prepare(`SELECT COUNT(*) n FROM asset_group WHERE dir_key IS NOT NULL`).get() as { n: number }).n
      const nullDir = (db.prepare(`SELECT COUNT(*) n FROM asset_group WHERE dir_key IS NULL`).get() as { n: number }).n
      /** "跨目录"按 dirname 判，和 tools/probe-groups.cjs 同一个口径（别拿整条路径比，那样人人都是跨目录） */
      const mem = db
        .prepare(
          `select group_id gid, coalesce(library_path, source_path) p
             from asset where group_id is not null and coalesce(library_path, source_path) is not null`
        )
        .all() as Array<{ gid: string; p: string }>
      const dirsOf = new Map<string, Set<string>>()
      for (const m of mem) {
        const d = dirKeyOf(m.p)
        if (!d) continue
        let s = dirsOf.get(m.gid)
        if (!s) dirsOf.set(m.gid, (s = new Set()))
        s.add(d)
      }
      const cross = [...dirsOf.entries()].filter(([, s]) => s.size > 1).map(([g]) => g)
      const sample = db
        .prepare(`select group_key, dir_key from asset_group where dir_key is not null order by group_key limit 4`)
        .all() as Array<{ group_key: string; dir_key: string }>
      console.log(
        `V4 回填：组 ${groupsBefore} 个 → 有 dir_key ${withDir}、留 NULL ${nullDir}（user_version ${versionBefore}→${SCHEMA_VERSION}）`
      )
      console.log(`  样例：${sample.map((s) => `${s.group_key} → ${s.dir_key}`).join('   |   ')}`)
      console.log(`  按 dirname 口径的跨目录组 = ${cross.length} 个（probe-groups.cjs 量到 13）`)
      const noPath = (
        db
          .prepare(
            `select count(*) n from asset_group g
              where g.id not in (select group_id from asset where group_id is not null and coalesce(library_path, source_path) is not null)`
          )
          .get() as { n: number }
      ).n
      console.log(`  留 NULL 的 ${nullDir} 个拆开看：跨目录误并 ${cross.length} 个、成员无可判路径（含空组）${noPath} 个`)
      expect(nullDir, 'NULL = 跨目录 + 无可判路径，不许有第三种来源').toBe(cross.length + noPath)

      expect(withDir + nullDir, '组数一条不许变').toBe(groupsBefore)
      expect((db.prepare(`SELECT COUNT(*) n FROM asset`).get() as { n: number }).n, '迁移不许动 asset 行').toBe(rowsBefore)
      for (const g of cross) {
        const row = db.prepare(`select dir_key from asset_group where id = ?`).get(g) as { dir_key: string | null }
        expect(row.dir_key, `跨目录组 ${g} 被猜了一个 dir_key`).toBe(null)
      }

      /** 带 dirKey 的请求绝不许吸附到 NULL 组：那是误并存量，继续长大就永远拆不干净 */
      const legacy = db.prepare(`select group_key, category from asset_group where dir_key is null limit 1`).get() as
        | { group_key: string; category: string }
        | undefined
      if (legacy) {
        const g = ensureGroup(db, {
          groupKey: legacy.group_key,
          name: '新来的',
          category: legacy.category,
          dirKey: 'e:/vrc/a/某个没见过的目录'
        })
        expect((g as { dir_key?: string | null }).dir_key).toBe('e:/vrc/a/某个没见过的目录')
        expect((g as { name: string }).name).toBe('新来的')
        console.log(`  吸附测试：往历史组「${legacy.group_key}」的目录里再入库一件 → 另立新组，没有吸附 ✅`)
      }
      const stats = collectStats(db)
      console.log(`  迁移后口径：素材 ${stats.assets} / 容器 ${stats.bundles} / 子项 ${stats.bundleItems} / 附属 ${stats.attachments} / 待复核 ${stats.review}`)
    } finally {
      closeDatabase()
      fs.rmSync(tmp, { recursive: true, force: true })
    }
  })
})
