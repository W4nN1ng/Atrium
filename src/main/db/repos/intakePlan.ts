import type { Db } from '../../db'
import { createHash } from 'node:crypto'
import { INTAKE_PLAN_VERSION, serializeContentKey, type PreparedIntakePlan, type IntakeProgress, type IntakePlanStatus } from '../../../shared/intake'
import { safeJoin, isInside, isForbiddenLibraryRoot, isForbiddenTarget, normalizeForCompare } from '../../security/paths'
import type { LibraryBlob } from '../../intake/planner'

const hash = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const sha = /^[a-f0-9]{64}$/
/** Structural validation plus the immutable plan digest; malformed plans never get rewritten. */
export function validateIntakePlan(value: unknown): asserts value is PreparedIntakePlan {
  const plan = value as PreparedIntakePlan
  if (!plan || plan.schemaVersion !== INTAKE_PLAN_VERSION) throw new Error('Unsupported intake plan version')
  if (!Array.isArray(plan.units) || !Array.isArray(plan.reviews) || !Array.isArray(plan.occurrences) || !Array.isArray(plan.blocked) ||
    !Array.isArray(plan.cacheKeys) || plan.cacheKeys.some(k => !sha.test(k)) || !Array.isArray(plan.skips) || !Array.isArray(plan.extracts)) throw new Error('Invalid prepared intake plan')
  if (plan.id !== `plan-${hash({ ...plan, id: '' })}`) throw new Error('Intake plan digest mismatch')
  if (isForbiddenLibraryRoot(plan.libraryRoot) || isForbiddenTarget(plan.libraryRoot) || isInside(plan.scanRoot, plan.libraryRoot) || isInside(plan.libraryRoot, plan.scanRoot)) throw new Error('Unsafe persisted library root')
  const ids = new Set<string>(), targets = new Set<string>(), ops = new Map<string, { blobId: string | null; reuseFromOpId?: string }>()
  for (const unit of plan.units) {
    const unitPath = safeJoin(plan.libraryRoot, unit.relativeRoot)
    if (!unit.id || ids.has(unit.id) || /[\/\\]/.test(unit.relativeRoot) || !unitPath || normalizeForCompare(unitPath) !== normalizeForCompare(unit.libraryPath) || !['new', 'merge', 'duplicate', 'blocked'].includes(unit.disposition)) throw new Error('Invalid planned unit')
    ids.add(unit.id)
    for (const op of [...unit.copyOps, ...unit.sidecars]) {
      serializeContentKey(op.key)
      const target = safeJoin(plan.libraryRoot, op.targetRelPath), key = op.targetRelPath.toLowerCase()
      if (!target || !isInside(unit.libraryPath, target) || targets.has(key) || ops.has(op.id) || !['copy', 'reuse'].includes(op.action ?? '') || (op.blobId !== null && !sha.test(op.blobId))) throw new Error('Invalid copy operation')
      if (op.action === 'reuse' && (!op.blobId || (!op.reuseFromOpId && (!op.libraryBlobPath || !isInside(plan.libraryRoot, op.libraryBlobPath))))) throw new Error('Unresolved blob reuse')
      targets.add(key); ops.set(op.id, op)
    }
    if (unit.disposition === 'duplicate' && (unit.assetId !== null || !unit.existingAssetIds.length || [...unit.copyOps, ...unit.sidecars].some(o => o.action !== 'reuse'))) throw new Error('Invalid duplicate unit')
  }
  for (const [id, op] of ops) {
    const seen = new Set([id]); let current = op
    while (current.reuseFromOpId) {
      if (seen.has(current.reuseFromOpId)) throw new Error('Cyclic blob dependency')
      seen.add(current.reuseFromOpId)
      const parent = ops.get(current.reuseFromOpId)
      if (!parent || parent.blobId !== op.blobId) throw new Error('Missing blob dependency')
      current = parent
    }
  }
  for (const occurrence of plan.occurrences) if ((occurrence.unitId && !ids.has(occurrence.unitId)) || (occurrence.copyOpId && !ops.has(occurrence.copyOpId))) throw new Error('Invalid occurrence reference')
}

/** No assets or files are changed. Existing progress/status survives an idempotent save. */
export function persistIntakePlan(db: Db, plan: PreparedIntakePlan, now = Date.now()): { id: string; status: IntakePlanStatus; inserted: boolean } {
  validateIntakePlan(plan)
  const json = JSON.stringify(plan)
  return db.transaction(() => {
    const existing = db.prepare('SELECT plan_json,status FROM intake_plan WHERE id=?').get(plan.id) as { plan_json: string; status: IntakePlanStatus } | undefined
    if (existing) {
      if (existing.plan_json !== json) throw new Error('Intake plan id conflict')
      return { id: plan.id, status: existing.status, inserted: false }
    }
    const status: IntakePlanStatus = plan.blocked.length || plan.reviews.length ? 'awaiting_confirm' : plan.units.length && plan.units.every(u => u.disposition === 'duplicate') ? 'duplicate' : 'planned'
    const progress: IntakeProgress = { completedOps: {}, failedOps: {}, cacheKeys: plan.cacheKeys }
    db.prepare('INSERT INTO intake_plan(id,status,plan_json,progress_json,created_at,updated_at) VALUES(?,?,?,?,?,?)').run(plan.id, status, json, JSON.stringify(progress), now, now)
    return { id: plan.id, status, inserted: true }
  })()
}
export function updateIntakeProgress(db: Db, id: string, status: IntakePlanStatus, progress: IntakeProgress, now = Date.now()): void {
  if (!progress || typeof progress !== 'object' || !progress.completedOps || !progress.failedOps || !Array.isArray(progress.cacheKeys) || progress.cacheKeys.some(k => !sha.test(k))) throw new Error('Invalid intake progress')
  const changed = db.prepare('UPDATE intake_plan SET status=?,progress_json=?,updated_at=? WHERE id=?').run(status, JSON.stringify(progress), now, id).changes
  if (changed !== 1) throw new Error('Intake plan not found: ' + id)
}
export function readIntakePlan(db: Db, id: string): { plan: PreparedIntakePlan; progress: IntakeProgress; status: IntakePlanStatus } | null {
  const row = db.prepare('SELECT plan_json,progress_json,status FROM intake_plan WHERE id=?').get(id) as { plan_json: string; progress_json: string | null; status: IntakePlanStatus } | undefined
  if (!row) return null
  const plan: unknown = JSON.parse(row.plan_json); validateIntakePlan(plan)
  const progress = JSON.parse(row.progress_json ?? '{}') as IntakeProgress
  if (!progress || !progress.completedOps || Array.isArray(progress.completedOps) || !progress.failedOps || Array.isArray(progress.failedOps) || !Array.isArray(progress.cacheKeys) || progress.cacheKeys.some(k => !sha.test(k))) throw new Error('Invalid intake progress')
  const ops = new Map(plan.units.flatMap(u => [...u.copyOps, ...u.sidecars]).map(op => [op.id, op]))
  for (const [opId, completed] of Object.entries(progress.completedOps)) {
    const op = ops.get(opId), target = op ? safeJoin(plan.libraryRoot, op.targetRelPath) : null
    if (!op || !completed || (completed.created !== undefined && typeof completed.created !== 'boolean') || !sha.test(completed.blobId) || !sha.test(completed.idempotencyKey) || !target || normalizeForCompare(target) !== normalizeForCompare(completed.targetPath) ||
      (op.blobId && completed.blobId !== op.blobId) || (op.idempotencyKey && completed.idempotencyKey !== op.idempotencyKey)) throw new Error('Invalid completed intake operation')
  }
  for (const [opId, failure] of Object.entries(progress.failedOps)) if (!ops.has(opId) || typeof failure !== 'string') throw new Error('Invalid failed intake operation')
  return { plan, progress, status: row.status }
}
export function readLibraryBlobIndex(db: Db, libraryRoot: string): LibraryBlob[] {
  const rows = db.prepare('SELECT blob_id,size,crc32,storage_path FROM content_blob ORDER BY blob_id').all() as { blob_id: string; size: number; crc32: number; storage_path: string }[]
  return rows.filter(row => isInside(libraryRoot, row.storage_path)).map(row => ({ blobId: row.blob_id, key: { size: row.size, crc32: row.crc32 }, storagePath: row.storage_path,
    refs: db.prepare('SELECT asset_id,rel_path FROM asset_blob_ref WHERE blob_id=? ORDER BY asset_id,rel_path').all(row.blob_id) as { asset_id: string; rel_path: string }[]
  })).map(row => ({ ...row, refs: row.refs.map(ref => ({ assetId: ref.asset_id, relPath: ref.rel_path })) }))
}
