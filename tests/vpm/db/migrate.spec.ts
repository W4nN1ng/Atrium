import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { closeVpmDb, openVpmDb, type VpmDb } from '../../../src/main/vpm/db'
import { VPM_MIGRATIONS } from '../../../src/main/vpm/db/migrations'
import { P, setAppPathsForTest } from '../../../src/main/services/paths'

let root: string
let file: string
let backupsDir: string
let db: VpmDb | null

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'atrium-vpm-db-'))
  setAppPathsForTest(root)
  file = P.vpmDb()
  backupsDir = P.vpmBackups()
  db = null
})

afterEach(() => {
  closeVpmDb(db)
  db = null
  fs.rmSync(root, { recursive: true, force: true })
})

function makeRawDb(run: (raw: Database.Database) => void): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const raw = new Database(file)
  try {
    run(raw)
  } finally {
    raw.close()
  }
}

function tableNames(target: Database.Database): string[] {
  const rows = target
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
    .all() as Array<{ name: string }>
  return rows.map((row) => row.name)
}

describe('vpm.db connection and migrations', () => {
  it('creates schema v5 in the VPM state directory with WAL and foreign keys', async () => {
    db = await openVpmDb()

    expect(fs.existsSync(file)).toBe(true)
    expect(file).toBe(path.join(root, 'vpm', 'vpm.db'))
    expect(db.pragma('user_version', { simple: true })).toBe(5)
    expect(String(db.pragma('journal_mode', { simple: true })).toLowerCase()).toBe('wal')
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1)
    expect(tableNames(db)).toEqual(
      expect.arrayContaining([
        'vpm_repo',
        'vpm_repo_package',
        'vpm_unity_install',
        'vpm_project',
        'vpm_project_package',
        'vpm_operation',
        'vpm_operation_step',
        'vpm_operation_file',
        'vpm_cache_entry',
        'vpm_template',
        'vpm_recent_location',
        'vpm_backup'
      ])
    )
    expect(fs.existsSync(backupsDir) ? fs.readdirSync(backupsDir) : []).toEqual([])
  })

  it('is idempotent and does not back up a database that is already current', async () => {
    db = await openVpmDb()
    closeVpmDb(db)
    db = null
    db = await openVpmDb()

    expect(db.pragma('user_version', { simple: true })).toBe(5)
    expect(fs.existsSync(backupsDir) ? fs.readdirSync(backupsDir) : []).toEqual([])
  })

  it('refuses a database newer than this build instead of downgrading or rebuilding', async () => {
    makeRawDb((raw) => raw.pragma('user_version = 6'))

    await expect(openVpmDb()).rejects.toMatchObject({ code: 'vpmDbVersionTooNew' })
    const raw = new Database(file, { readonly: true, fileMustExist: true })
    try {
      expect(raw.pragma('user_version', { simple: true })).toBe(6)
    } finally {
      raw.close()
    }
  })

  it('refuses user_version=0 when VPM tables already exist', async () => {
    makeRawDb((raw) => raw.exec('CREATE TABLE vpm_repo (id TEXT PRIMARY KEY)'))

    await expect(openVpmDb()).rejects.toMatchObject({ code: 'vpmDbOpenFailed' })
    const raw = new Database(file, { readonly: true, fileMustExist: true })
    try {
      expect(tableNames(raw)).toContain('vpm_repo')
      expect(raw.pragma('user_version', { simple: true })).toBe(0)
    } finally {
      raw.close()
    }
  })

  it('rolls back the version transaction when a migration fails', async () => {
    const migrations = [
      { version: 1, sql: 'CREATE TABLE vpm_bad (id TEXT); INSERT INTO missing_table VALUES (1);' }
    ]

    await expect(openVpmDb({ file, backupsDir, migrations })).rejects.toMatchObject({
      code: 'vpmDbMigrationFailed'
    })

    const raw = new Database(file, { readonly: true, fileMustExist: true })
    try {
      expect(raw.pragma('user_version', { simple: true })).toBe(0)
      expect(tableNames(raw)).not.toContain('vpm_bad')
    } finally {
      raw.close()
    }
  })

  it('stops before migrating when the pre-upgrade backup cannot be written', async () => {
    db = await openVpmDb()
    closeVpmDb(db)
    db = null

    const blocked = path.join(root, 'not-a-directory')
    fs.writeFileSync(blocked, 'x')
    const migrations = [...VPM_MIGRATIONS, { version: 6, sql: 'CREATE TABLE vpm_v6 (id TEXT);' }]

    await expect(openVpmDb({ file, backupsDir: blocked, migrations })).rejects.toMatchObject({
      code: 'vpmDbBackupFailed'
    })

    const raw = new Database(file, { readonly: true, fileMustExist: true })
    try {
      expect(raw.pragma('user_version', { simple: true })).toBe(5)
      expect(tableNames(raw)).not.toContain('vpm_v6')
    } finally {
      raw.close()
    }
  })

  it('backs up a populated v1 database before applying v2..v5, and verifies the backup', async () => {
    db = await openVpmDb({ file, backupsDir, migrations: [VPM_MIGRATIONS[0]] })
    db.prepare(
      'INSERT INTO vpm_repo (id, url, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
    ).run('repo-a', 'https://example.test/repo.json', 'Repo A', 1, 1)
    closeVpmDb(db)
    db = null

    const fixed = new Date('2026-10-21T12:34:56')
    db = await openVpmDb({ file, backupsDir, now: () => fixed })

    const backup = path.join(backupsDir, 'vpm.db.bak-v1-20261021-123456')
    expect(fs.existsSync(backup)).toBe(true)
    expect(db.pragma('user_version', { simple: true })).toBe(5)
    expect(tableNames(db)).toContain('vpm_unity_install')
    expect(tableNames(db)).toContain('vpm_project')
    expect(tableNames(db)).toContain('vpm_operation')

    const check = new Database(backup, { readonly: true, fileMustExist: true })
    try {
      expect(check.pragma('user_version', { simple: true })).toBe(1)
      expect(check.pragma('integrity_check', { simple: true })).toBe('ok')
      expect(check.prepare('SELECT COUNT(*) AS n FROM vpm_repo').get()).toEqual({ n: 1 })
      expect(tableNames(check)).not.toContain('vpm_unity_install')
      expect(tableNames(check)).not.toContain('vpm_operation')
    } finally {
      check.close()
    }
  })

  it('rolls back a failed v6 migration and keeps v5 plus the backup', async () => {
    db = await openVpmDb()
    db.prepare(
      'INSERT INTO vpm_repo (id, url, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
    ).run('repo-a', 'https://example.test/repo.json', 'Repo A', 1, 1)
    closeVpmDb(db)
    db = null

    const migrations = [
      ...VPM_MIGRATIONS,
      {
        version: 6,
        sql: 'CREATE TABLE vpm_v6 (id TEXT); INSERT INTO missing_table VALUES (1);'
      }
    ]
    const fixed = new Date('2026-10-21T12:35:00')
    await expect(openVpmDb({ file, backupsDir, migrations, now: () => fixed })).rejects.toMatchObject({
      code: 'vpmDbMigrationFailed'
    })

    const raw = new Database(file, { readonly: true, fileMustExist: true })
    try {
      expect(raw.pragma('user_version', { simple: true })).toBe(5)
      expect(tableNames(raw)).not.toContain('vpm_v6')
      expect(raw.prepare('SELECT COUNT(*) AS n FROM vpm_repo').get()).toEqual({ n: 1 })
    } finally {
      raw.close()
    }
    const backups = fs.readdirSync(backupsDir)
    expect(backups).toContain('vpm.db.bak-v5-20261021-123500')
    const backup = new Database(path.join(backupsDir, backups[0]), { readonly: true })
    try {
      expect(backup.pragma('user_version', { simple: true })).toBe(5)
      expect(backup.pragma('integrity_check', { simple: true })).toBe('ok')
    } finally {
      backup.close()
    }
  })

  it('wraps a non-database file as vpmDbOpenFailed', async () => {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, 'this is not sqlite')

    await expect(openVpmDb()).rejects.toMatchObject({ code: 'vpmDbOpenFailed' })
  })

  it('refuses a version-current database whose required tables are missing', async () => {
    makeRawDb((raw) => {
      raw.pragma('user_version = 5')
      raw.exec('CREATE TABLE vpm_repo (id TEXT PRIMARY KEY)')
    })

    await expect(openVpmDb()).rejects.toMatchObject({ code: 'vpmDbIntegrityFailed' })
  })
})
