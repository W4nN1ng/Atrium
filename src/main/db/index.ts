import Database from 'better-sqlite3'
import { MIGRATIONS, SCHEMA_VERSION } from './schema'

export type Db = Database.Database
export type Statement = Database.Statement

let current: Db | null = null

/** 增量迁移：按 user_version 逐版执行，绝不 DROP 已有表 */
export function migrate(db: Db): number {
  const before = Number(db.pragma('user_version', { simple: true }))
  let applied = 0
  for (const m of MIGRATIONS) {
    if (m.version <= before) continue
    db.transaction(() => {
      db.exec(m.sql)
      m.post?.(db)
      db.pragma(`user_version = ${m.version}`)
    })()
    applied++
  }
  if (before === 0 && applied === 0) {
    // 空库首次建表也要落 user_version
    db.pragma(`user_version = ${SCHEMA_VERSION}`)
  }
  return applied
}

export function openDatabase(file: string): Db {
  const db = new Database(file)
  db.pragma('journal_mode = WAL')
  db.pragma('synchronous = NORMAL')
  db.pragma('foreign_keys = ON')
  db.pragma('busy_timeout = 5000')
  db.pragma('cache_size = -32000')
  migrate(db)
  current = db
  return db
}

export function getDb(): Db {
  if (!current) throw new Error('数据库尚未打开')
  return current
}

/**
 * 库打开了没有。
 *
 * 给"每 3 秒跑一次的轮询"用：应用启动最初几毫秒定时器就可能到点，
 * 那时 `getDb()` 会抛「数据库尚未打开」。轮询该**安静跳过**，
 * 而不是往日志里刷一串错误 —— 那会掩盖真正的失败。
 */
export function isDbOpen(): boolean {
  return current !== null
}

export function setDb(db: Db | null): void {
  current = db
}

export function closeDatabase(): void {
  if (current) {
    try {
      current.pragma('wal_checkpoint(TRUNCATE)')
    } catch {
      /* 盘被拔掉时 checkpoint 会失败，忽略 */
    }
    current.close()
    current = null
  }
}

export interface DbStats {
  /** 顶层素材数：**不含**合集容器，也不含合集里的子项（子项跟着合集算一张卡的体积） */
  assets: number
  groups: number
  /** 合集卡数（asset.is_bundle=1）。老的 bundle 表已废弃，别再读它 */
  bundles: number
  /** 合集里的子项总数 */
  bundleItems: number
  /** 附属资源总数（介绍图/视频/文档…）：不计入 assets，只在维护页露个数 */
  attachments: number
  pendingConfirm: number
  inbox: number
  collections: number
  tags: number
  packageEntries: number
  totalBytes: number
  fileBytes: number
}

const countOf = (db: Db, table: string): number => {
  try {
    const row = db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number } | undefined
    return row ? Number(row.n) : 0
  } catch {
    return 0
  }
}

const sumOf = (db: Db, sql: string): number => {
  const row = db.prepare(sql).get() as { n: number } | undefined
  return row ? Number(row.n) : 0
}

export function collectStats(db: Db): DbStats {
  return {
    /**
     * 素材总数**不含附属资源**（增量改动单 2 §A2：介绍图/演示视频/说明文档不进统计），
     * 也不含合集容器和合集里的子项（子项跟着合集算一张卡的体积）。
     */
    assets: sumOf(
      db,
      `SELECT COUNT(*) AS n FROM asset
        WHERE parent_asset_id IS NULL AND is_bundle = 0 AND attachment_kind IS NULL`
    ),
    groups: countOf(db, 'asset_group'),
    bundles: sumOf(db, `SELECT COUNT(*) AS n FROM asset WHERE is_bundle = 1`),
    /**
     * 子项数 = **父级是合集**的那些行。
     * 版本行（父级是子项）不算子项，否则合集卡上"含 17 项"会变成"含 41 项"。
     * 附属资源也不算 —— 6 个条目的亲亲音效目录里只有 1 件是真素材。
     */
    bundleItems: sumOf(
      db,
      `SELECT COUNT(*) AS n FROM asset c JOIN asset p ON p.id = c.parent_asset_id
        WHERE p.is_bundle = 1 AND c.attachment_kind IS NULL`
    ),
    attachments: sumOf(db, `SELECT COUNT(*) AS n FROM asset WHERE attachment_kind IS NOT NULL`),
    pendingConfirm: sumOf(db, `SELECT COUNT(*) AS n FROM asset WHERE status = 'pending_confirm'`),
    inbox: sumOf(db, `SELECT COUNT(*) AS n FROM asset WHERE status = 'inbox'`),
    collections: countOf(db, 'collection'),
    tags: countOf(db, 'tag'),
    packageEntries: countOf(db, 'package_entry'),
    /**
     * 体积只算顶层：合集那一行的 size_bytes 在入库时就已经是子项之和，
     * 再把子项加一遍等于把合集数两次。附属资源的体积已经含在主体那一行里了，同样不重复计。
     */
    totalBytes: sumOf(
      db,
      `SELECT COALESCE(SUM(size_bytes), 0) AS n FROM asset
        WHERE parent_asset_id IS NULL AND attachment_kind IS NULL
          AND status IN ('archived','classified','pending_confirm')`
    ),
    fileBytes: 0
  }
}

/** 备份当前库到指定文件（设置页 → 维护 → 数据库备份）。better-sqlite3 的 backup() 是异步的。 */
export async function backupTo(db: Db, destFile: string): Promise<void> {
  await db.backup(destFile)
}
