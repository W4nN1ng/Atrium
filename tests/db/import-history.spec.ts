import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { openDatabase, closeDatabase, type Db } from '../../src/main/db'
import { upsertProject } from '../../src/main/db/repos/unity'
import { appendJournal, insertImportLog, patchImportLog } from '../../src/main/db/repos/journal'
import { listImportHistory, rollbackBlockReason } from '../../src/main/db/repos/importHistory'
import type { ImportStatus } from '../../src/shared/types'

let root: string
let db: Db
let projectId: string
const A = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const B = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'

function seed(batch: string | null, name: string, guids = [A], status: ImportStatus = 'ok', pid = projectId): string {
  const row = insertImportLog(db, { projectId: pid, batchId: batch, memberRelPath: name, status })
  patchImportLog(db, row.id, { created_guids_json: JSON.stringify(guids), overwritten_json: '[]', started_at: 1234, finished_at: 1234 })
  if (status === 'ok') appendJournal(db, { op: 'import', importLogId: row.id, projectId: pid, label: name }, { batchId: batch ?? row.id })
  return row.id
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'atrium-history-'))
  db = openDatabase(path.join(root, 'library.db'))
  projectId = upsertProject(db, { name: 'Test Avatar', path: path.join(root, 'project') }).id
})
afterEach(() => { closeDatabase(); fs.rmSync(root, { recursive: true, force: true }) })

describe('persistent import history', () => {
  it('paginates whole batches, including batches larger than the old 200-row limit', () => {
    seed('old', 'old.unitypackage', [B])
    for (let i = 0; i < 205; i++) seed('large', `nested/part-${i}.unitypackage`)
    const page = listImportHistory(db, { limit: 1 })
    expect(page.total).toBe(2)
    expect(page.groups).toHaveLength(1)
    expect(page.groups[0].batchId).toBe('large')
    expect(page.groups[0].items).toHaveLength(205)
    expect(page.groups[0].items[0].name).toBe('part-0.unitypackage')
    expect(listImportHistory(db, { offset: 1, limit: 1 }).groups[0].batchId).toBe('old')
  })

  it('keeps separate single imports and projects; excludes bridge maintenance logs', () => {
    const other = upsertProject(db, { name: 'Other', path: path.join(root, 'other') }).id
    seed(null, 'one.unitypackage')
    seed(null, 'two.unitypackage', [B])
    seed('shared-id', 'other.unitypackage', [A], 'ok', other)
    seed('shared-id', 'ours.unitypackage', [B])
    insertImportLog(db, { projectId, kind: 'bridge_install', status: 'ok' })
    expect(listImportHistory(db).total).toBe(4)
    const page = listImportHistory(db, { projectId })
    expect(page.total).toBe(3)
    expect(page.groups.every(g => g.projectName === 'Test Avatar')).toBe(true)
    expect(new Set(page.groups.map(g => g.key)).size).toBe(3)
  })

  it('persists mixed terminal statuses across restart and never offers failed imports for rollback', () => {
    seed('mixed', 'good.unitypackage', [A])
    seed('mixed', 'failed.unitypackage', [], 'failed')
    seed('mixed', 'cancelled.unitypackage', [], 'cancelled')
    seed('mixed', 'reverted.unitypackage', [], 'rolledback')
    closeDatabase()
    db = openDatabase(path.join(root, 'library.db'))
    const group = listImportHistory(db).groups[0]
    expect(group.items.map(i => i.status)).toEqual(['ok', 'failed', 'cancelled', 'rolledback'])
    expect(group.items.map(i => i.canRollback)).toEqual([true, false, false, false])
    expect(group.rollbackBlockKey).toBeNull()
  })

  it('blocks an older overlapping import but allows independent batches and releases after newer rollback', () => {
    const old = seed('old', 'old.unitypackage')
    seed('independent', 'unrelated.unitypackage', [B])
    expect(rollbackBlockReason(db, old)).toBeNull()
    const newer = seed('new', 'new.unitypackage', [A.toUpperCase()])
    expect(rollbackBlockReason(db, old)).toBe('importHistory.newerOverlap')
    expect(listImportHistory(db).groups.find(g => g.batchId === 'old')?.rollbackBlockKey).toBe('importHistory.newerOverlap')
    patchImportLog(db, newer, { status: 'rolledback' })
    expect(rollbackBlockReason(db, old)).toBeNull()
  })

  it('blocks rollback while the same project is importing and treats malformed GUID history conservatively', () => {
    const old = seed('old', 'old.unitypackage')
    const active = seed('pending', 'pending.unitypackage', [B], 'running')
    expect(rollbackBlockReason(db, old)).toBe('importHistory.busyProject')
    patchImportLog(db, active, { status: 'ok', overwritten_json: '{broken' })
    expect(rollbackBlockReason(db, old)).toBe('importHistory.newerOverlap')
  })
  it('does not advertise a pruned backup directory as available', () => {
    const id = seed('old', 'old.unitypackage', [])
    const backup = path.join(root, 'retained-backup')
    fs.mkdirSync(backup)
    fs.writeFileSync(path.join(backup, 'a.prefab'), 'ORIGINAL')
    fs.writeFileSync(path.join(backup, 'manifest.json'), JSON.stringify({ projectPath: path.join(root, 'project'),
      saved: [{ guid: A, assetPath: 'Assets/A.prefab', file: 'a.prefab' }], missing: [] }))
    patchImportLog(db, id, { overwritten_json: JSON.stringify([A]), backup_dir: backup })
    expect(listImportHistory(db).groups[0].items[0].hasBackup).toBe(true)
    fs.rmSync(backup, { recursive: true })
    expect(listImportHistory(db).groups[0].items[0].hasBackup).toBe(false)
  })
})
