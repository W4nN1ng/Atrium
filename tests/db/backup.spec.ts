import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'
import { createDatabaseBackup } from '../../src/main/db/backup'
import type { Db } from '../../src/main/db'

let dir: string
let source: string
let db: Db

beforeEach(() => {
  dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'atrium-db-backup-')))
  source = path.join(dir, 'library.db')
  db = new Database(source)
  db.pragma('journal_mode = WAL')
  db.pragma('wal_autocheckpoint = 0')
  db.exec('CREATE TABLE note (id INTEGER PRIMARY KEY, body TEXT NOT NULL)')
  db.pragma('user_version = 6')
  db.pragma('wal_checkpoint(TRUNCATE)')
  db.prepare('INSERT INTO note (body) VALUES (?)').run('committed in WAL')
})

afterEach(() => {
  if (db.open) db.close()
  fs.rmSync(dir, { recursive: true, force: true })
})

function readNotes(file: string): unknown[] {
  const snapshot = new Database(file, { readonly: true, fileMustExist: true })
  try {
    expect(snapshot.pragma('integrity_check', { simple: true })).toBe('ok')
    expect(snapshot.pragma('user_version', { simple: true })).toBe(6)
    return snapshot.prepare('SELECT id, body FROM note ORDER BY id').all()
  } finally {
    snapshot.close()
  }
}

function makeOldBackup(file: string): void {
  const old = new Database(file)
  try {
    old.exec('CREATE TABLE note (id INTEGER PRIMARY KEY, body TEXT NOT NULL)')
    old.pragma('user_version = 6')
    old.prepare('INSERT INTO note (body) VALUES (?)').run('old backup')
  } finally {
    old.close()
  }
}

describe('manual database backup', () => {
  it('refuses an orphan destination WAL instead of reporting a snapshot that replays stale destination data', async () => {
    const destination = path.join(dir, 'orphan.db')
    fs.copyFileSync(source, destination)
    fs.copyFileSync(`${source}-wal`, `${destination}-wal`)
    const oldMain = fs.readFileSync(destination)
    const oldWal = fs.readFileSync(`${destination}-wal`)
    db.prepare('INSERT INTO note (body) VALUES (?)').run('new source data')
    await expect(createDatabaseBackup(db, source, destination)).rejects.toThrow('i18n:settings.backupTargetJournal')
    expect(fs.readFileSync(destination)).toEqual(oldMain)
    expect(fs.readFileSync(`${destination}-wal`)).toEqual(oldWal)
    expect(db.prepare('SELECT COUNT(*) AS n FROM note').get()).toEqual({ n: 2 })
  })
  it('includes committed WAL rows in a standalone snapshot without changing the live database', async () => {
    const mainBefore = fs.readFileSync(source)
    const walBefore = fs.readFileSync(`${source}-wal`)
    expect(walBefore.byteLength).toBeGreaterThan(0)
    const destination = path.join(dir, 'snapshot.db')

    const result = await createDatabaseBackup(db, source, destination)

    expect(result).toEqual({ path: destination, bytes: fs.statSync(destination).size })
    expect(result.bytes).toBeGreaterThan(0)
    expect(readNotes(destination)).toEqual([{ id: 1, body: 'committed in WAL' }])
    expect(fs.readFileSync(source)).toEqual(mainBefore)
    expect(fs.readFileSync(`${source}-wal`)).toEqual(walBefore)
    expect(db.prepare('SELECT id, body FROM note').all()).toEqual([
      { id: 1, body: 'committed in WAL' }
    ])
    db.prepare('INSERT INTO note (body) VALUES (?)').run('after backup')
    expect(db.prepare('SELECT COUNT(*) AS count FROM note').get()).toEqual({ count: 2 })
    expect(readNotes(destination)).toEqual([{ id: 1, body: 'committed in WAL' }])
    expect(fs.readdirSync(dir).filter((name) => name.startsWith('.atrium-db-backup-'))).toEqual([])
  })

  it('replaces an existing backup only after the new snapshot succeeds', async () => {
    const destination = path.join(dir, 'snapshot.db')
    makeOldBackup(destination)
    expect(readNotes(destination)).toEqual([{ id: 1, body: 'old backup' }])

    await createDatabaseBackup(db, source, destination)

    expect(readNotes(destination)).toEqual([{ id: 1, body: 'committed in WAL' }])
  })

  it('returns the absolute written path for a relative destination', async () => {
    const destination = path.join(dir, 'snapshot.db')
    const result = await createDatabaseBackup(db, source, path.relative(process.cwd(), destination))

    expect(result.path).toBe(destination)
    expect(readNotes(result.path)).toEqual([{ id: 1, body: 'committed in WAL' }])
  })

  it.each(['', '-wal', '-shm', '-journal'])(
    'rejects replacing the live database or its %s sidecar',
    async (suffix) => {
      const destination = `${source}${suffix}`
      if (!fs.existsSync(destination)) fs.writeFileSync(destination, 'protected journal')
      const before = fs.readFileSync(destination)

      await expect(createDatabaseBackup(db, source, destination)).rejects.toThrow(
        'i18n:settings.backupProtectLiveDatabase'
      )

      expect(fs.readFileSync(destination)).toEqual(before)
      expect(db.prepare('SELECT id, body FROM note').all()).toEqual([
        { id: 1, body: 'committed in WAL' }
      ])
    }
  )

  it('rejects a normalized path alias of the live database', async () => {
    const destination = path.join(dir, 'unused', '..', 'library.db')

    await expect(createDatabaseBackup(db, source, destination)).rejects.toThrow(
      'i18n:settings.backupProtectLiveDatabase'
    )
    expect(db.prepare('SELECT id, body FROM note').all()).toEqual([
      { id: 1, body: 'committed in WAL' }
    ])
  })

  it.runIf(process.platform === 'win32')('rejects case aliases of the live database and absent sidecars on Windows', async () => {
    for (const destination of [source.toUpperCase(), `${source.toUpperCase()}-JOURNAL`]) {
      await expect(createDatabaseBackup(db, source, destination)).rejects.toThrow(
        'i18n:settings.backupProtectLiveDatabase'
      )
    }
    expect(fs.existsSync(`${source}-journal`)).toBe(false)
  })

  it('rejects a directory symlink alias of the live database and an absent journal sidecar', async () => {
    const realDirectory = path.join(dir, 'data')
    fs.mkdirSync(realDirectory)
    const live = path.join(realDirectory, 'library.db')
    db.close()
    fs.renameSync(source, live)
    source = live
    db = new Database(source)
    const alias = path.join(dir, 'alias')
    fs.symlinkSync(realDirectory, alias, process.platform === 'win32' ? 'junction' : 'dir')

    for (const destination of [path.join(alias, 'library.db'), path.join(alias, 'library.db-journal')]) {
      await expect(createDatabaseBackup(db, source, destination)).rejects.toThrow(
        'i18n:settings.backupProtectLiveDatabase'
      )
    }
    expect(fs.existsSync(`${source}-journal`)).toBe(false)
  })

  it.each(['', '-wal', '-shm', '-journal'])('rejects hardlink aliases of the live database %s', async (suffix) => {
    const protectedFile = `${source}${suffix}`
    if (!fs.existsSync(protectedFile)) fs.writeFileSync(protectedFile, 'protected journal')
    const destination = path.join(dir, 'linked-backup.db')
    fs.linkSync(protectedFile, destination)
    const before = fs.readFileSync(protectedFile)

    await expect(createDatabaseBackup(db, source, destination)).rejects.toThrow(
      'i18n:settings.backupProtectLiveDatabase'
    )
    expect(fs.readFileSync(protectedFile)).toEqual(before)
    expect(fs.readFileSync(destination)).toEqual(before)
  })

  it('protects the actual open database even when the supplied source path is different', async () => {
    const suppliedSource = path.join(dir, 'different.db')
    makeOldBackup(suppliedSource)

    await expect(createDatabaseBackup(db, suppliedSource, source)).rejects.toThrow(
      'i18n:settings.backupProtectLiveDatabase'
    )
    expect(db.prepare('SELECT id, body FROM note').all()).toEqual([
      { id: 1, body: 'committed in WAL' }
    ])
  })

  it('preserves an existing backup and removes staging files when SQLite backup fails', async () => {
    const destination = path.join(dir, 'snapshot.db')
    makeOldBackup(destination)
    db.close()
    const before = fs.readFileSync(destination)
    const filesBefore = fs.readdirSync(dir).sort()

    await expect(createDatabaseBackup(db, source, destination)).rejects.toThrow(
      'i18n:settings.backupFailed'
    )

    expect(fs.readFileSync(destination)).toEqual(before)
    expect(readNotes(destination)).toEqual([{ id: 1, body: 'old backup' }])
    expect(fs.readdirSync(dir).sort()).toEqual(filesBefore)
  })

  it.runIf(process.platform === 'win32')('preserves a locked backup when Windows cannot replace it', async () => {
    const destination = path.join(dir, 'snapshot.db')
    makeOldBackup(destination)
    const locked = new Database(destination, { readonly: true, fileMustExist: true })
    const before = fs.readFileSync(destination)
    const filesBefore = fs.readdirSync(dir).sort()
    try {
      await expect(createDatabaseBackup(db, source, destination)).rejects.toThrow(
        'i18n:settings.backupFailed'
      )
      expect(fs.readFileSync(destination)).toEqual(before)
      expect(locked.prepare('SELECT id, body FROM note').all()).toEqual([
        { id: 1, body: 'old backup' }
      ])
      expect(fs.readdirSync(dir).sort()).toEqual(filesBefore)
    } finally {
      locked.close()
    }
  })

  it.each(['', 'directory', 'missing-parent/snapshot.db'])(
    'rejects invalid destination %s without changing the source',
    async (input) => {
      fs.mkdirSync(path.join(dir, 'directory'))
      const destination = input ? path.join(dir, input) : input

      await expect(createDatabaseBackup(db, source, destination)).rejects.toThrow(
        'i18n:settings.backupInvalidTarget'
      )
      expect(db.prepare('SELECT id, body FROM note').all()).toEqual([
        { id: 1, body: 'committed in WAL' }
      ])
    }
  )
})
