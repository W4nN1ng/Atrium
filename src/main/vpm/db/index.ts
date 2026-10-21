import Database from 'better-sqlite3'
import fs from 'node:fs'
import path from 'node:path'
import { VpmError } from '../../../shared/vpm/errors'
import { P } from '../../services/paths'
import { backupVpmDb } from './backup'
import { VPM_MIGRATIONS, VPM_REQUIRED_TABLES, type VpmMigration } from './migrations'
import type { VpmDb } from './types'

export type { VpmDb } from './types'
export { VPM_SCHEMA_VERSION } from './migrations'

export interface OpenVpmDbOptions {
  /** 默认 `P.vpmDb()`；测试传临时目录。 */
  file?: string
  /** 默认 `P.vpmBackups()`；只在从旧版本迁移时使用。 */
  backupsDir?: string
  /** 测试用：替换迁移表，验证失败回滚/备份顺序。 */
  migrations?: readonly VpmMigration[]
  /** 测试用：固定备份文件名里的时间。 */
  now?: () => Date
}

function orderedMigrations(input: readonly VpmMigration[]): VpmMigration[] {
  const sorted = [...input].sort((a, b) => a.version - b.version)
  if (sorted.length === 0 || sorted[0].version !== 1) throw new VpmError('vpmDbOpenFailed')
  for (let i = 0; i < sorted.length; i++) {
    const current = sorted[i]
    if (!Number.isInteger(current.version) || current.version < 1) {
      throw new VpmError('vpmDbOpenFailed')
    }
    if (i > 0) {
      if (current.version === sorted[i - 1].version) throw new VpmError('vpmDbOpenFailed')
      if (current.version !== sorted[i - 1].version + 1) throw new VpmError('vpmDbOpenFailed')
    }
  }
  return sorted
}

function userVersion(db: VpmDb): number {
  return Number(db.pragma('user_version', { simple: true }))
}

function assertIntegrity(db: VpmDb, mode: 'quick' | 'full'): void {
  const result = db.pragma(mode === 'quick' ? 'quick_check' : 'integrity_check', { simple: true })
  if (result !== 'ok') throw new VpmError('vpmDbIntegrityFailed')
}

function tableNames(db: VpmDb): Set<string> {
  const rows = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
    .all() as Array<{ name: string }>
  return new Set(rows.map((row) => row.name))
}

function assertSchema(db: VpmDb, version: number): void {
  const required = VPM_REQUIRED_TABLES[version]
  if (!required) return
  const present = tableNames(db)
  if (required.some((name) => !present.has(name))) throw new VpmError('vpmDbIntegrityFailed')
}

function assertNoHalfMigratedDb(db: VpmDb): void {
  const present = tableNames(db)
  if (present.has('vpm_repo') || present.has('vpm_repo_package')) {
    // user_version=0 却有 VPM 表：来源不明，绝不覆盖/重建。
    throw new VpmError('vpmDbOpenFailed')
  }
}

function runMigrations(
  db: VpmDb,
  from: number,
  migrations: readonly VpmMigration[]
): void {
  for (const migration of migrations) {
    if (migration.version <= from) continue
    try {
      db.transaction(() => {
        db.exec(migration.sql)
        db.pragma(`user_version = ${migration.version}`)
      })()
    } catch (error) {
      throw new VpmError('vpmDbMigrationFailed', { from, to: migration.version }, error)
    }
  }
}

/**
 * 打开/迁移 VPM 独立库。
 *
 * 顺序：建目录 → 打开 → 连接 pragma → 版本检查 → 旧库 quick_check →
 * 备份（从旧版本升级时）→ 事务迁移 → integrity_check → 表存在性检查。
 *
 * 从旧版本升级时是 async（better-sqlite3 的 backup 是异步的）；
 * 空库首次建库不需要备份。任何失败都会关闭句柄并抛出 VpmError。
 */
export async function openVpmDb(options: OpenVpmDbOptions = {}): Promise<VpmDb> {
  const file = options.file ?? P.vpmDb()
  const backupsDir = options.backupsDir ?? P.vpmBackups()
  const migrations = orderedMigrations(options.migrations ?? VPM_MIGRATIONS)
  const target = migrations[migrations.length - 1].version

  let db: VpmDb | null = null
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    db = new Database(file)
    db.pragma('journal_mode = WAL')
    db.pragma('synchronous = NORMAL')
    db.pragma('foreign_keys = ON')
    db.pragma('busy_timeout = 5000')
    db.pragma('cache_size = -32000')

    const from = userVersion(db)
    if (!Number.isInteger(from) || from < 0) throw new VpmError('vpmDbOpenFailed')
    if (from > target) {
      throw new VpmError('vpmDbVersionTooNew', { found: from, supported: target })
    }

    if (from === 0) assertNoHalfMigratedDb(db)
    else assertSchema(db, from)

    if (from < target) {
      assertIntegrity(db, 'quick')
      if (from > 0) {
        await backupVpmDb(db, from, backupsDir, options.now ?? (() => new Date()))
      }
      runMigrations(db, from, migrations)
      assertIntegrity(db, 'full')
    }

    assertSchema(db, target)
    if (userVersion(db) !== target) throw new VpmError('vpmDbIntegrityFailed')
    return db
  } catch (error) {
    if (db) closeVpmDb(db)
    if (error instanceof VpmError) throw error
    throw new VpmError('vpmDbOpenFailed', undefined, error)
  }
}

/** 关闭句柄；WAL checkpoint 失败不影响关闭，吞掉异常。 */
export function closeVpmDb(db: VpmDb | null | undefined): void {
  if (!db) return
  try {
    if (db.open) db.pragma('wal_checkpoint(TRUNCATE)')
  } catch {
    /* 盘被拔掉/句柄已坏时 checkpoint 会失败 */
  }
  try {
    if (db.open) db.close()
  } catch {
    /* 已关闭 */
  }
}
