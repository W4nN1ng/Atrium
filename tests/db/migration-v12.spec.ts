import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import Database from 'better-sqlite3'
import { migrate, type Db } from '../../src/main/db'
import { SCHEMA_VERSION } from '../../src/main/db/schema'
import { deleteAssetRow } from '../../src/main/db/repos/asset'
import { seedIntakeV11, snapshotIntakeLegacy } from '../helpers/intakeV11'

let root: string
let db: Db
const blobA = 'a'.repeat(64)
const blobB = 'b'.repeat(64)

function blob(id = blobA, size = 100, crc32 = 42): void {
  db.prepare('INSERT INTO content_blob (blob_id, size, crc32, storage_path) VALUES (?, ?, ?, ?)')
    .run(id, size, crc32, 'E:/sandbox/library/.atrium/blobs/' + id)
}

function reference(id: string, asset = 'legacy-a', target = id, content = blobA): void {
  db.prepare(`INSERT INTO asset_blob_ref (id, asset_id, blob_id, rel_path, path_key)
    VALUES (?, ?, ?, ?, ?)`).run(id, asset, content, target, target.toLowerCase())
}

function count(id = blobA): number {
  return (db.prepare('SELECT ref_count FROM content_blob WHERE blob_id = ?').get(id) as { ref_count: number }).ref_count
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'avca-intake-v12-'))
  db = new Database(path.join(root, 'v11.db'))
  db.pragma('foreign_keys = ON')
  seedIntakeV11(db)
})

afterEach(() => {
  if (db?.open) db.close()
  fs.rmSync(root, { recursive: true, force: true })
})

describe('V11 → V12 intake migration', () => {
  it('upgrades a V11 file copy, preserves every old row and leaves the original bytes unchanged', () => {
    const before = snapshotIntakeLegacy(db)
    expect(before).not.toHaveProperty('content_blob')
    const original = db.name
    db.close()
    const hash = (file: string): string => createHash('sha256').update(fs.readFileSync(file)).digest('hex')
    const originalHash = hash(original)
    const copy = path.join(root, 'copy.db')
    fs.copyFileSync(original, copy)
    db = new Database(copy)
    db.pragma('foreign_keys = ON')
    expect(migrate(db)).toBe(1)
    expect(SCHEMA_VERSION).toBe(12)
    expect(db.pragma('user_version', { simple: true })).toBe(12)
    const after = snapshotIntakeLegacy(db)
    for (const table of Object.keys(before)) expect(after[table], table).toEqual(before[table])
    for (const table of ['content_blob', 'asset_blob_ref', 'source_occurrence', 'intake_plan']) expect(after[table]).toEqual([])
    expect(db.pragma('integrity_check', { simple: true })).toBe('ok')
    expect(db.pragma('foreign_key_check')).toEqual([])
    expect(migrate(db)).toBe(0)
    expect(hash(original)).toBe(originalHash)
  })

  it('reopening and replaying V12 does not duplicate tables, triggers or references', () => {
    migrate(db)
    blob()
    reference('ref-a')
    db.pragma('user_version = 11')
    expect(migrate(db)).toBe(1)
    expect(migrate(db)).toBe(0)
    expect(count()).toBe(1)
  })
})

describe('V12 shared content ownership', () => {
  beforeEach(() => { migrate(db); blob() })

  it('counts logical files including repeated content inside one asset', () => {
    reference('one', 'legacy-a', 'one.unitypackage')
    reference('two', 'legacy-a', 'two.unitypackage')
    expect(count()).toBe(2)
  })

  it('duplicate source history does not create an additional physical-content reference', () => {
    reference('one')
    for (const id of ['origin-a', 'origin-b', 'origin-c']) {
      db.prepare(`INSERT INTO source_occurrence (id, asset_id, blob_id, asset_file_id, source_path, kind)
        VALUES (?, 'legacy-a', ?, 'one', ?, 'loose')`).run(id, blobA, 'E:/fixture/' + id)
    }
    expect(count()).toBe(1)
    expect(db.prepare('SELECT id FROM source_occurrence').all()).toHaveLength(3)
  })

  it('deleting one asset removes only its references and keeps the other asset and blob', () => {
    reference('one')
    reference('two', 'legacy-b')
    db.prepare(`INSERT INTO source_occurrence (id, asset_id, blob_id, source_path, kind)
      VALUES ('origin-a', 'legacy-a', ?, 'E:/fixture/a', 'extracted')`).run(blobA)
    deleteAssetRow(db, 'legacy-a')
    expect(count()).toBe(1)
    expect(db.prepare('SELECT asset_id FROM asset_blob_ref').all()).toEqual([{ asset_id: 'legacy-b' }])
    expect(db.prepare('SELECT id FROM source_occurrence').all()).toEqual([])
    expect(() => db.prepare('DELETE FROM content_blob WHERE blob_id = ?').run(blobA)).toThrow()
    deleteAssetRow(db, 'legacy-b')
    expect(count()).toBe(0)
  })

  it('changing a logical file to another blob transfers the reference exactly once', () => {
    blob(blobB)
    reference('one')
    db.prepare('UPDATE asset_blob_ref SET blob_id = ? WHERE id = ?').run(blobB, 'one')
    expect(count()).toBe(0)
    expect(count(blobB)).toBe(1)
    db.prepare('UPDATE asset_blob_ref SET blob_id = ? WHERE id = ?').run(blobB, 'one')
    expect(count(blobB)).toBe(1)
  })

  it('logical path conflicts and retries do not leak extra references', () => {
    reference('one', 'legacy-a', 'File.unitypackage')
    expect(() => reference('two', 'legacy-a', 'file.unitypackage')).toThrow()
    expect(() => reference('one', 'legacy-a', 'another.unitypackage')).toThrow()
    expect(count()).toBe(1)
  })

  it('keeps distinct SHA-256 blobs even when size and CRC32 collide', () => {
    blob(blobB)
    expect(db.prepare('SELECT blob_id FROM content_blob WHERE size = 100 AND crc32 = 42').all()).toHaveLength(2)
  })

  it('rejects invalid sizes, CRCs, blob identities, negative reference counts and missing targets', () => {
    expect(() => blob('c'.repeat(64), -1)).toThrow()
    expect(() => blob('c'.repeat(64), 1, 0x100000000)).toThrow()
    expect(() => blob('not-a-sha256')).toThrow()
    expect(() => db.prepare('UPDATE content_blob SET ref_count = -1').run()).toThrow()
    expect(() => reference('missing-asset', 'does-not-exist')).toThrow()
    expect(() => reference('missing-blob', 'legacy-a', 'x', blobB)).toThrow()
    expect(count()).toBe(0)
  })

  it('retains provenance when removing a logical file and later its unreferenced blob record', () => {
    reference('one')
    db.prepare(`INSERT INTO source_occurrence (id, asset_id, blob_id, asset_file_id, source_path, kind, detail)
      VALUES ('origin', 'legacy-a', ?, 'one', 'E:/fixture/a', 'loose', ?)`).run(blobA, JSON.stringify({ blobId: blobA }))
    db.prepare('DELETE FROM asset_blob_ref WHERE id = ?').run('one')
    expect(count()).toBe(0)
    db.prepare('DELETE FROM content_blob WHERE blob_id = ?').run(blobA)
    expect(db.prepare('SELECT blob_id, asset_file_id, detail FROM source_occurrence').get()).toEqual({
      blob_id: null, asset_file_id: null, detail: JSON.stringify({ blobId: blobA })
    })
  })

  it('accepts empty files and preserves maximum unsigned CRC32', () => {
    blob('c'.repeat(64), 0, 0)
    blob(blobB, 1, 0xffffffff)
    expect(db.prepare('SELECT crc32 FROM content_blob WHERE blob_id = ?').get(blobB)).toEqual({ crc32: 0xffffffff })
  })

  it('persists plan/progress JSON and rejects invalid JSON or unknown states', () => {
    const insert = db.prepare(`INSERT INTO intake_plan (id, status, plan_json, progress_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, 1, 2)`)
    insert.run('plan', 'planned', '{"schemaVersion":1}', '{"cacheKeys":["cached-container"]}')
    expect(db.prepare('SELECT progress_json FROM intake_plan WHERE id = ?').get('plan')).toEqual({ progress_json: '{"cacheKeys":["cached-container"]}' })
    expect(() => insert.run('bad-json', 'planned', '{', null)).toThrow()
    expect(() => insert.run('bad-progress', 'planned', '{}', '{')).toThrow()
    expect(() => insert.run('bad-state', 'silently-truncated', '{}', null)).toThrow()
  })
})
