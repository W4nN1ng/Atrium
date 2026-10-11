import type { Db } from '../index'
import fs from 'node:fs'
import path from 'node:path'
import { readBackupManifest } from '../../import/backupManifest'
import type { ImportHistoryPage, ImportHistoryQuery, ImportLogRow } from '../../../shared/types'

type OrderedLog = ImportLogRow & { seq: number; journalSeq: number | null; asset_name: string | null }
// Aggregate the journal once. A correlated query per log and per page member
// becomes cubic as import history grows, blocking the main process.
const ORDERED_LOGS = `SELECT il.*, il.rowid AS seq, ordering.journalSeq, a.name AS asset_name
  FROM import_log il LEFT JOIN asset a ON a.id = il.asset_id LEFT JOIN (
    SELECT CASE WHEN json_valid(payload_json) THEN json_extract(payload_json, '$.importLogId') END AS logId,
      MAX(id) AS journalSeq FROM journal WHERE op = 'import' GROUP BY logId
  ) ordering ON ordering.logId = il.id`

function projectLogs(db: Db, projectId: string): OrderedLog[] {
  return db.prepare(`${ORDERED_LOGS} WHERE il.project_id = ? AND il.kind = 'import' ORDER BY il.rowid`)
    .all(projectId) as OrderedLog[]
}

function guids(json: string | null): string[] | null {
  if (!json) return []
  try {
    const values: unknown = JSON.parse(json)
    return Array.isArray(values) && values.every(v => typeof v === 'string')
      ? values.map(v => v.toLowerCase()) : null
  } catch { return null }
}

/** Older overlapping imports must be rolled back after their successors. Check again at execution. */
export function rollbackBlockReason(db: Db, importId: string, ignoredIds: ReadonlySet<string> = new Set()): string | null {
  const row = db.prepare('SELECT project_id FROM import_log WHERE id = ?').get(importId) as { project_id: string } | undefined
  if (!row) return 'importHistory.missingRecord'
  const logs = projectLogs(db, row.project_id)
  const current = logs.find(r => r.id === importId)
  if (!current) return 'importHistory.missingRecord'
  return blockedByLogs(current, logs, ignoredIds)
}

function blockedByLogs(current: OrderedLog, logs: OrderedLog[], ignoredIds: ReadonlySet<string>): string | null {
  const others = logs.filter(r => r.id !== current.id &&
    ['ok', 'running', 'queued', 'rollbackpartial'].includes(r.status))
  if (others.some(r => r.status === 'running' || r.status === 'queued')) return 'importHistory.busyProject'
  const created = guids(current.created_guids_json)
  const overwritten = guids(current.overwritten_json)
  const touched = new Set([...(created ?? []), ...(overwritten ?? [])])
  for (const other of others) {
    if (ignoredIds.has(other.id)) continue
    const later = current.journalSeq != null && other.journalSeq != null
      ? other.journalSeq > current.journalSeq : other.seq > current.seq
    if (!later) continue
    const a = guids(other.created_guids_json)
    const b = guids(other.overwritten_json)
    if (!created || !overwritten || !a || !b || [...a, ...b].some(g => touched.has(g))) {
      return 'importHistory.newerOverlap'
    }
  }
  return null
}

/** Paginate groups rather than rows so a large batch never loses its members. */
export function listImportHistory(db: Db, query: ImportHistoryQuery = {}): ImportHistoryPage {
  const offset = Number.isFinite(query.offset) ? Math.max(0, Math.floor(query.offset!)) : 0
  const limit = Number.isFinite(query.limit) ? Math.max(1, Math.min(50, Math.floor(query.limit!))) : 20
  const filtered = typeof query.projectId === 'string' && query.projectId.length > 0
  const where = `kind = 'import'${filtered ? ' AND project_id = ?' : ''}`
  const args = filtered ? [query.projectId!] : []
  const groupKey = `CASE WHEN batch_id IS NULL THEN 'i:' || id ELSE 'b:' || batch_id END`
  const groupsSql = `SELECT project_id, batch_id, ${groupKey} AS group_key, MAX(rowid) AS newest
    FROM import_log WHERE ${where} GROUP BY project_id, group_key`
  const total = (db.prepare(`SELECT COUNT(*) AS n FROM (${groupsSql})`).get(...args) as { n: number }).n
  const groups = db.prepare(`${groupsSql} ORDER BY newest DESC LIMIT ? OFFSET ?`).all(...args, limit, offset) as
    Array<{ project_id: string; batch_id: string | null; group_key: string }>
  const cached = new Map<string, OrderedLog[]>()
  return { total, offset, groups: groups.map(group => {
    const project = db.prepare('SELECT name, path FROM project WHERE id = ?').get(group.project_id) as
      { name: string; path: string } | undefined
    let logs = cached.get(group.project_id)
    if (!logs) { logs = projectLogs(db, group.project_id); cached.set(group.project_id, logs) }
    const rows = logs.filter(r => (r.batch_id === null ? `i:${r.id}` : `b:${r.batch_id}`) === group.group_key)
    const rollbackRows = rows.filter(r => r.status === 'ok' && (group.batch_id === null || r.journalSeq !== null))
    const ignored = new Set(rollbackRows.map(r => r.id))
    const times = rows.flatMap(r => r.started_at != null ? [r.started_at] : r.finished_at != null ? [r.finished_at] : [])
    return {
      key: `${group.project_id}:${group.group_key}`, batchId: group.batch_id,
      projectId: group.project_id, projectName: project?.name ?? group.project_id, projectPath: project?.path ?? null,
      at: times.length ? Math.min(...times) : null,
      rollbackBlockKey: !project ? 'importHistory.projectGone' :
        rollbackRows.map(r => blockedByLogs(r, logs, ignored)).find(Boolean) ?? null,
      items: rows.map(r => ({
        id: r.id, name: r.member_rel_path?.split(/[\\/]/).pop() || r.asset_name ||
          r.unitypackage_path?.split(/[\\/]/).pop() || r.id,
        status: r.status, created: guids(r.created_guids_json)?.length ?? 0,
        overwritten: guids(r.overwritten_json)?.length ?? 0, hasBackup: backupAvailable(r),
        message: r.message, canRollback: rollbackRows.includes(r)
      }))
    }
  }) }
}

function backupAvailable(row: ImportLogRow): boolean {
  if (!row.backup_dir) return false
  const manifest = readBackupManifest(row.backup_dir)
  const covered = new Set(manifest?.saved.map(s => s.guid.toLowerCase()) ?? [])
  const overwritten = guids(row.overwritten_json)
  return !!manifest && manifest.missing.length === 0 && !!overwritten &&
    overwritten.every(g => covered.has(g)) && manifest.saved.every(s => fs.existsSync(path.join(row.backup_dir!, s.file)))
}
