/**
 * V5（M5-B 的记账列）迁移测试。
 *
 * ⚠ 为什么单独一份而不是"新库里有这几列"就完事：
 * 那种断言只验了 V1 建表，**验不到"用户那个已经跑到 V4 的库能不能升上来"**。
 * V4 那次就是教训 —— 光加列测不出"老的 UNIQUE 索引会把新行挡掉"，
 * 真库副本上跑第二个同 key 不同目录的组时直接 SqliteError（见 docs/TRIAGE-A）。
 * 所以这里手工搭一个 V4 状态的库，再让 `migrate()` 往上走。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'
import { MIGRATIONS, SCHEMA_VERSION } from '../../src/main/db/schema'
import { migrate } from '../../src/main/db'
import { insertImportLog, patchImportLog, listImportLogs } from '../../src/main/db/repos/journal'
import type { Db } from '../../src/main/db'

const V4 = 4

/** 搭一个"已经跑完 V4"的库：把 V1..V4 的 SQL 原样执行，再把 user_version 钉在 4 */
function buildV4Database(db: Db): void {
  for (const m of MIGRATIONS) {
    if (m.version > V4) break
    db.exec(m.sql)
    m.post?.(db)
  }
  db.pragma(`user_version = ${V4}`)
}

let file: string
let db: Db

beforeEach(() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'avca-v5-'))
  file = path.join(dir, 'library.db')
  db = new Database(file) as unknown as Db
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
})

afterEach(() => {
  try {
    db.close()
  } catch {
    /* 已经关了 */
  }
})

describe('V4 → V5：只增列，老行不猜', () => {
  it('migrate() 把 user_version 推到 5，三列都在，老行三列全 NULL', () => {
    buildV4Database(db)
    expect(Number(db.pragma('user_version', { simple: true }))).toBe(V4)

    // 造一条"散装直导"的老记录（老代码不会知道这三列）
    db.prepare(
      `insert into import_log (id, project_id, batch_id, asset_id, unitypackage_path, status, kind)
       values ('OLD1','P1',null,'A1','E:\\vrc\\A\\x.unitypackage','ok','import')`
    ).run()

    const applied = migrate(db)
    expect(applied, 'V5 这一版应该被应用一次').toBe(MIGRATIONS.filter((m) => m.version > 4).length)
    expect(Number(db.pragma('user_version', { simple: true }))).toBe(SCHEMA_VERSION)

    const cols = new Set((db.prepare(`PRAGMA table_info(import_log)`).all() as Array<{ name: string }>).map((c) => c.name))
    for (const c of ['container_asset_id', 'member_rel_path', 'origin_archive']) {
      expect(cols.has(c), `V5 少加了一列：${c}`).toBe(true)
    }
    const old = db.prepare(`select container_asset_id c, member_rel_path m, origin_archive o from import_log where id='OLD1'`).get() as {
      c: string | null
      m: string | null
      o: string | null
    }
    /** 回填=从 unitypackage_path 反推一个"容器"出来 —— 那是把猜测写成事实，撤销和反查会拿它当真凭据 */
    expect(old).toEqual({ c: null, m: null, o: null })
  })

  it('反查用的部分索引真的建起来了', () => {
    buildV4Database(db)
    migrate(db)
    const idx = db.prepare(`PRAGMA index_list(import_log)`).all() as Array<{ name: string; partial: number }>
    const hit = idx.find((i) => i.name === 'idx_import_log_container')
    expect(hit, 'idx_import_log_container 没建').toBeTruthy()
    /** 局部索引：散装那批（NULL）不该进索引占地方 */
    expect(hit?.partial, '这个索引必须是 partial 的').toBe(1)
  })

  it('幂等：再 migrate 一次什么都不做，也不报错', () => {
    buildV4Database(db)
    expect(migrate(db)).toBe(MIGRATIONS.filter((m) => m.version > 4).length)
    expect(migrate(db), '第二次 migrate 不该再动任何东西').toBe(0)
    expect(Number(db.pragma('user_version', { simple: true }))).toBe(SCHEMA_VERSION)
  })

  it('insertImportLog 写三列；patch 不把它们冲掉', () => {
    buildV4Database(db)
    migrate(db)
    db.prepare(`insert or ignore into project (id, name, path, is_running, last_seen) values ('P1','shinano-Main2','E:\\p',0,0)`).run()

    const row = insertImportLog(db, {
      projectId: 'P1',
      assetId: 'CONTAINER1',
      batchId: 'B1',
      unitypackagePath: path.join(os.tmpdir(), 'avca-v5-tmp', 'A1', '0', 'Inside.unitypackage'),
      containerAssetId: 'CONTAINER1',
      memberRelPath: '插件17件/子包/Inside.unitypackage',
      originArchive: 'E:\\vrc\\A\\衣服\\名流\\材质包 PSD.zip'
    })
    expect(row.container_asset_id).toBe('CONTAINER1')

    patchImportLog(db, row.id, { status: 'ok', created_guids_json: '["g1","g2"]' })
    const back = listImportLogs(db, 'P1').find((l) => l.id === row.id)
    expect(back?.status).toBe('ok')
    /**
     * 临时路径迟早消失，反查全靠这三列 —— 所以"改状态"不能顺手把它们抹掉。
     * `patchImportLog` 的入参类型是 `Partial<Pick<ImportLogRow, 'status' | 'message' | ...>>`，
     * 这三列不在白名单里，编译期就写不进去；这条断言守的是运行时的行为：
     * 只 UPDATE 传进来的那几个键。谁把它改成"整行覆盖"（先 SELECT * 再全字段写回），
     * 一旦那张 SELECT 漏了新列，记账就静默丢了 —— 这条会变红。
     */
    expect(back?.container_asset_id).toBe('CONTAINER1')
    expect(back?.member_rel_path).toBe('插件17件/子包/Inside.unitypackage')
    expect(back?.origin_archive).toBe('E:\\vrc\\A\\衣服\\名流\\材质包 PSD.zip')
  })

  it('散装直导（不传三列）落库就是 NULL，不写空串', () => {
    buildV4Database(db)
    migrate(db)
    const row = insertImportLog(db, { projectId: 'P1', unitypackagePath: 'E:\\vrc\\A\\x.unitypackage' })
    expect(row.container_asset_id).toBe(null)
    expect(row.member_rel_path).toBe(null)
    expect(row.origin_archive).toBe(null)
    /** 空串和 NULL 在 SQLite 里是两回事：查询写 `IS NOT NULL` 时空串会被当成"有容器" */
    const stored = db.prepare(`select container_asset_id c from import_log where id = ?`).get(row.id) as { c: string | null }
    expect(stored.c).toBe(null)
  })
})
