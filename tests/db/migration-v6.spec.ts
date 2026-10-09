/**
 * V6（M6 ③ 的自动切换冷却列）迁移测试。
 *
 * 和 V5 那份同一个理由：**"新库里有这一列"验不到"用户那个已经跑到 V5 的库能不能升上来"**。
 * 所以这里手工搭一个 V5 状态的库、塞一行工程，再让 `migrate()` 往上走，
 * 然后核对：列有了、老行还在、老列的值一个都没变。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'
import { MIGRATIONS, SCHEMA_VERSION } from '../../src/main/db/schema'
import { migrate } from '../../src/main/db'
import type { Db } from '../../src/main/db'

let file: string
let db: Db

/** 搭一个"已经跑完 V5"的库 */
function buildV5Database(handle: Db): void {
  for (const m of MIGRATIONS) {
    if (m.version > 5) break
    handle.exec(m.sql)
    m.post?.(handle)
  }
  handle.pragma('user_version = 5')
}

beforeEach(() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'avca-v6-'))
  file = path.join(dir, 'library.db')
  db = new Database(file) as unknown as Db
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  buildV5Database(db)
  db.prepare(
    `INSERT INTO project (id, path, name, unity_version, last_seen, is_running, guid_index_at, bridge_version, fingerprint_json)
     VALUES ('P1','E:/ALCOMprojects/shinano-Main2','shinano-Main2','2022.3.22f1',100,1,NULL,'1.0.0',NULL)`
  ).run()
})

afterEach(() => {
  db.close()
})

describe('V5 → V6', () => {
  it('迁移跑完 user_version 落在 SCHEMA_VERSION，且这一版就是 V6', () => {
    expect(SCHEMA_VERSION).toBe(6)
    const applied = migrate(db)
    expect(applied).toBe(1)
    expect(Number(db.pragma('user_version', { simple: true }))).toBe(6)
  })

  /**
   * `verify-red-m6` 的 G1 暴露的口径问题：把 `SCHEMA_VERSION` 从 6 改回 5，
   * "列有没有加出来"那条用例**照样绿** —— 因为 `migrate()` 看的是 `user_version`，
   * 而库里记的还是 5，V6 一样会跑。真正的症状在**下一次启动**：
   * `user_version` 被写成 5，于是 V6 又跑一遍 → `duplicate column` → 库打不开。
   * 所以这条不变量得单独钉：版本号必须跟得上最后一篇迁移。
   */
  it('SCHEMA_VERSION == 最后一篇迁移的版本号（忘了 bump 的后果是下次启动二次执行、库直接打不开）', () => {
    const last = Math.max(...MIGRATIONS.map((m) => m.version))
    expect(SCHEMA_VERSION).toBe(last)
    expect(MIGRATIONS.map((m) => m.version)).toEqual([...MIGRATIONS.map((m) => m.version)].sort((a, b) => a - b))
  })

  it('project 多了 last_auto_switch_at，且老行的其它列一个都没变', () => {
    const before = db.prepare(`SELECT * FROM project WHERE id='P1'`).get() as Record<string, unknown>
    migrate(db)
    const cols = db.prepare(`PRAGMA table_info(project)`).all().map((c) => (c as { name: string }).name)
    expect(cols).toContain('last_auto_switch_at')
    const after = db.prepare(`SELECT * FROM project WHERE id='P1'`).get() as Record<string, unknown>
    /** 新列 NULL = "从没自动切过"，第一次检测到 Unity 启动就该切 */
    expect(after.last_auto_switch_at).toBeNull()
    for (const k of Object.keys(before)) {
      if (k === 'last_auto_switch_at') continue
      expect(after[k], `列 ${k} 被迁移改动了`).toEqual(before[k])
    }
  })

  it('重复迁移不炸（幂等哨兵：migrate 只看 user_version，不该二次执行）', () => {
    migrate(db)
    expect(migrate(db)).toBe(0)
    expect(Number(db.pragma('user_version', { simple: true }))).toBe(6)
  })

  it('V6 之后 import_log 那三列还在（别把上一版的列挤掉）', () => {
    migrate(db)
    const cols = db.prepare(`PRAGMA table_info(import_log)`).all().map((c) => (c as { name: string }).name)
    for (const need of ['container_asset_id', 'member_rel_path', 'origin_archive']) {
      expect(cols, need).toContain(need)
    }
  })
})
