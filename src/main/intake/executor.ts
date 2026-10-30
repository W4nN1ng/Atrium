import fs from 'node:fs'
import path from 'node:path'
import { randomUUID, createHash } from 'node:crypto'
import type { Db } from '../db'
import { fileIdentity } from './identity'
import { readIntakePlan, updateIntakeProgress } from '../db/repos/intakePlan'
import { makeAssetRow, upsertAsset } from '../db/repos/asset'
import type { CopyOp, IntakeProgress, PlanReview, PreparedIntakePlan, PreparedUnit, PlannedOccurrence } from '../../shared/intake'
import { isInside, safeJoin } from '../security/paths'
import { appendJournal } from '../db/repos/journal'
import type { AssetUnit } from '../../shared/types'

export class IntakeExecutionError extends Error {
  constructor(message: string, readonly code: 'space' | 'review-required' | 'source-changed' | 'target-conflict' | 'blocked' | 'cancelled' | 'database' = 'database') {
    super(message); this.name = 'IntakeExecutionError'
  }
}
export interface ExecuteOptions {
  dryRun?: boolean
  signal?: AbortSignal
  freeBytes?: () => number
  now?: () => number
  review?: (review: PlanReview) => Promise<boolean> | boolean
  /** Testing/maintenance hook; the default uses hard links for same-volume blob references. */
  link?: (from: string, to: string) => Promise<void>
}
export interface ExecutionResult {
  planId: string
  status: 'completed' | 'duplicate' | 'planned' | 'awaiting_confirm' | 'cancelled' | 'failed'
  dryRun: boolean
  copiedBytes: number
  reusedBytes: number
  copiedOps: string[]
  reusedOps: string[]
  assetIds: string[]
  journalId: number | null
}
const sha = /^[a-f0-9]{64}$/
const digest = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const abort = (signal?: AbortSignal): void => { if (signal?.aborted) throw new IntakeExecutionError('摄取已取消', 'cancelled') }
const checkedPath = (root: string, target: string): string => {
  const resolved = path.resolve(target)
  if (!isInside(root, resolved)) throw new IntakeExecutionError(`目标越界：${target}`, 'target-conflict')
  return resolved
}
async function removeQuietly(file: string): Promise<void> { try { await fs.promises.rm(file, { recursive: true, force: true }) } catch { /* best effort cleanup */ } }
async function ensureDir(dir: string): Promise<void> { await fs.promises.mkdir(dir, { recursive: true }) }
async function targetLink(from: string, to: string): Promise<void> {
  await ensureDir(path.dirname(to))
  try { await fs.promises.link(from, to); return } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code !== 'EXDEV' && code !== 'EPERM' && code !== 'EACCES' && code !== 'EEXIST') throw error
  }
  await fs.promises.copyFile(from, to, fs.constants.COPYFILE_EXCL)
}
async function publishBlob(source: string, blobPath: string, expectedSha: string, expectedSize: number, expectedCrc: number, opts: ExecuteOptions): Promise<'new' | 'existing'> {
  const parent = path.dirname(blobPath); await ensureDir(parent)
  if (fs.existsSync(blobPath)) {
    const actual = await fileIdentity(blobPath, opts.signal)
    if (actual.sha256 !== expectedSha || actual.key.size !== expectedSize || actual.key.crc32 !== expectedCrc) throw new IntakeExecutionError('已有 blob 内容冲突', 'target-conflict')
    return 'existing'
  }
  const temp = path.join(parent, `.tmp-${randomUUID()}`)
  try {
    await fs.promises.copyFile(source, temp, fs.constants.COPYFILE_EXCL)
    abort(opts.signal)
    const actual = await fileIdentity(temp, opts.signal)
    if (actual.sha256 !== expectedSha || actual.key.size !== expectedSize || actual.key.crc32 !== expectedCrc) throw new IntakeExecutionError('复制后内容校验失败', 'source-changed')
    try { await fs.promises.rename(temp, blobPath) } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
        const existing = await fileIdentity(blobPath, opts.signal)
        if (existing.sha256 !== expectedSha) throw new IntakeExecutionError('并发 blob 内容冲突', 'target-conflict')
      } else throw error
    }
    return 'new'
  } finally { await removeQuietly(temp) }
}
function blobPath(root: string, blobId: string): string { if (!sha.test(blobId)) throw new IntakeExecutionError('无效 blob SHA-256', 'database'); return path.join(root, '.atrium', 'blobs', blobId.slice(0, 2), blobId) }
function allOps(plan: PreparedIntakePlan): CopyOp[] { return plan.units.flatMap(unit => [...unit.copyOps, ...unit.sidecars]) }
function opMap(plan: PreparedIntakePlan): Map<string, CopyOp> { return new Map(allOps(plan).map(op => [op.id, op])) }
function unitAssetId(unit: PreparedUnit | undefined): string | null { return !unit || unit.disposition === 'duplicate' ? null : unit.assetId }
function sourceFor(op: CopyOp, ops: Map<string, CopyOp>, completed: Record<string, { blobId: string; targetPath: string; idempotencyKey: string }>): string {
  if (op.action === 'reuse' && op.reuseFromOpId) {
    const parent = ops.get(op.reuseFromOpId), done = parent && completed[parent.id]
    if (!parent || !done) throw new IntakeExecutionError(`复用依赖未完成：${op.id}`, 'database')
    return done.targetPath
  }
  if (op.action === 'reuse' && op.libraryBlobPath) return op.libraryBlobPath
  return op.sourcePath
}
function unitName(unit: PreparedUnit): string { return unit.displayName || unit.relativeRoot }
function assetFromUnit(unit: PreparedUnit, assetId: string, now: number): ReturnType<typeof makeAssetRow> {
  const classified = unit.classification.units[0] as AssetUnit | undefined
  const size = unit.normalizedEntries.reduce((sum, entry) => sum + entry.size, 0)
  return makeAssetRow({ id: assetId, name: classified?.name ?? unitName(unit), raw_name: classified?.name ?? unitName(unit), category: classified?.category ?? 'other',
    subcategory: classified?.subcategory ?? null, confidence: classified?.confidence ?? 0, status: classified?.status ?? 'pending_confirm',
    kind: unit.primaryKind === 'unitypackage' ? 'unitypackage' : unit.primaryKind === 'archive' ? 'archive' : 'folder', content_type: classified?.contentType ?? 'unknown', size_bytes: size,
    library_path: unit.libraryPath, source_path: unit.sources[0] ?? null, storage_mode: 'indexed', hash_xxh64: null,
    source_url: classified?.sourceUrl ?? null, source_platform: null, source_item_id: classified?.sourceItemId ?? null,
    source_item_id_confidence: classified?.sourceItemIdConfidence ?? 0, author: classified?.author ?? null, version: classified?.version ?? null,
    locale_tag: classified?.localeTag ?? null, notes: `intake plan ${unit.id}`, variant_raw: classified?.variantRaw ?? null, created_at: now, updated_at: now })
}
function updateProgress(db: Db, plan: PreparedIntakePlan, progress: IntakeProgress, status: 'running' | 'cancelled' | 'failed' | 'completed' | 'duplicate', now: number): void {
  updateIntakeProgress(db, plan.id, status, progress, now)
}

/**
 * Execute a prepared M5 plan. All bytes are copied/verified before the final short
 * database transaction. The source tree is never moved, renamed, or deleted.
 */
export async function executePlan(db: Db, planId: string, opts: ExecuteOptions = {}): Promise<ExecutionResult> {
  const saved = readIntakePlan(db, planId)
  if (!saved) throw new IntakeExecutionError(`找不到计划：${planId}`, 'database')
  const { plan } = saved
  const progress: IntakeProgress = { completedOps: { ...saved.progress.completedOps }, failedOps: { ...saved.progress.failedOps }, cacheKeys: [...saved.progress.cacheKeys] }
  const now = opts.now ?? Date.now
  if (plan.blocked.length) throw new IntakeExecutionError('计划包含 blocked 条目', 'blocked')
  if (plan.reviews.length) {
    for (const review of plan.reviews) {
      abort(opts.signal)
      if (!opts.review || !(await opts.review(review))) throw new IntakeExecutionError(`计划仍需复核：${review.id}`, 'review-required')
    }
  }
  const ops = opMap(plan), copiedOps: string[] = [], reusedOps: string[] = [], staged = new Set<string>(), published = new Set<string>(), createdDirs = new Set<string>(), copiedBytes = { value: 0 }, reusedBytes = { value: 0 }
  const uniqueCopyBytes = [...new Map(allOps(plan).filter(op => op.action === 'copy').map(op => [op.blobId ?? op.id, op.key.size])).values()].reduce((a, b) => a + b, 0)
  const free = opts.freeBytes ?? (() => { const info = fs.statfsSync(plan.libraryRoot); return info.bavail * info.bsize })
  if (!opts.dryRun && free() < Math.ceil(uniqueCopyBytes * 1.1) + 16 * 1024 * 1024) throw new IntakeExecutionError('目标盘空间不足', 'space')
  if (opts.dryRun) return { planId, status: saved.status === 'running' ? 'planned' : saved.status, dryRun: true, copiedBytes: 0, reusedBytes: 0, copiedOps: [], reusedOps: [], assetIds: plan.units.flatMap(u => u.assetId ? [u.assetId] : []), journalId: null }
  updateProgress(db, plan, progress, 'running', now())
  try {
    for (const unit of plan.units) {
      if (unit.disposition === 'duplicate') continue
      for (const op of [...unit.copyOps, ...unit.sidecars]) {
      abort(opts.signal)
      if (progress.completedOps[op.id]) {
        const done = progress.completedOps[op.id]
        if (fs.existsSync(done.targetPath)) {
          const actual = await fileIdentity(done.targetPath, opts.signal)
          if (actual.sha256 === done.blobId && actual.sha256 === op.blobId) { (op.action === 'reuse' ? reusedOps : copiedOps).push(op.id); continue }
        }
        delete progress.completedOps[op.id]
      }
      const target = checkedPath(plan.libraryRoot, path.join(plan.libraryRoot, op.targetRelPath))
      const blob = op.blobId ?? (() => { throw new IntakeExecutionError(`CopyOp 缺少 blobId：${op.id}`, 'database') })()
      const physical = blobPath(plan.libraryRoot, blob)
      let source = sourceFor(op, ops, progress.completedOps)
      if (!fs.existsSync(source)) throw new IntakeExecutionError(`来源不存在：${source}`, 'source-changed')
      const sourceIdentity = await fileIdentity(source, opts.signal)
      if (sourceIdentity.sha256 !== blob || sourceIdentity.key.size !== op.key.size || sourceIdentity.key.crc32 !== op.key.crc32) throw new IntakeExecutionError(`来源内容已变化：${source}`, 'source-changed')
      if (op.action === 'copy') {
        if (await publishBlob(source, physical, blob, op.key.size, op.key.crc32, opts) === 'new') published.add(physical)
        source = physical
        copiedBytes.value += op.key.size; copiedOps.push(op.id)
      } else { reusedBytes.value += op.key.size; reusedOps.push(op.id) }
      let parent = path.dirname(target), parents: string[] = []
      while (isInside(plan.libraryRoot, parent) && !fs.existsSync(parent)) { parents.push(parent); parent = path.dirname(parent) }
      await ensureDir(path.dirname(target)); for (const dir of parents) createdDirs.add(dir)
      if (fs.existsSync(target)) {
        const existing = await fileIdentity(target, opts.signal)
        if (existing.sha256 !== blob) throw new IntakeExecutionError(`目标已存在且内容不同：${target}`, 'target-conflict')
      } else {
        await (opts.link ?? targetLink)(source, target)
        const written = await fileIdentity(target, opts.signal)
        if (written.sha256 !== blob || written.key.size !== op.key.size || written.key.crc32 !== op.key.crc32) throw new IntakeExecutionError(`目标校验失败：${target}`, 'target-conflict')
        staged.add(target)
      }
      progress.completedOps[op.id] = { blobId: blob, targetPath: target, idempotencyKey: op.idempotencyKey ?? digest([target, blob]) }
      delete progress.failedOps[op.id]
      updateProgress(db, plan, progress, 'running', now())
      }
    }
    const result = db.transaction(() => {
      const assetIds: string[] = []
      const blobSeen = new Set<string>(), blobStorage = new Map(allOps(plan).filter(op => op.blobId).map(op => [op.blobId!, op.libraryBlobPath ?? blobPath(plan.libraryRoot, op.blobId!)]))
      for (const op of allOps(plan)) if (op.blobId && !blobSeen.has(op.blobId)) {
        db.prepare('INSERT INTO content_blob(blob_id,size,crc32,storage_path,ref_count) VALUES(?,?,?,?,0) ON CONFLICT(blob_id) DO UPDATE SET size=excluded.size,crc32=excluded.crc32,storage_path=excluded.storage_path').run(op.blobId, op.key.size, op.key.crc32, blobStorage.get(op.blobId)); blobSeen.add(op.blobId)
      }
      for (const unit of plan.units) {
        const assetId = unitAssetId(unit)
        if (assetId) { upsertAsset(db, assetFromUnit(unit, assetId, now())); assetIds.push(assetId) }
        const targetAssetIds = assetId ? [assetId] : unit.existingAssetIds
        for (const op of [...unit.copyOps, ...unit.sidecars]) if (op.blobId) for (const targetId of targetAssetIds.slice(0, 1)) {
          const refId = `ref-${digest([targetId, op.targetRelPath, op.blobId])}`
          db.prepare('INSERT OR IGNORE INTO asset_blob_ref(id,asset_id,blob_id,rel_path,path_key) VALUES(?,?,?,?,?)').run(refId, targetId, op.blobId, op.targetRelPath, op.targetRelPath.toLowerCase())
        }
      }
      for (const occurrence of plan.occurrences) {
        const unit = occurrence.unitId ? plan.units.find(u => u.id === occurrence.unitId) : undefined
        const assetId = unitAssetId(unit as PreparedUnit) ?? unit?.existingAssetIds[0]
        if (!assetId) continue
        db.prepare('INSERT OR REPLACE INTO source_occurrence(id,asset_id,blob_id,asset_file_id,plan_id,source_path,kind,detail) VALUES(?,?,?,?,?,?,?,?)').run(
          occurrence.id, assetId, occurrence.blobId, occurrence.copyOpId ? `ref-${digest([assetId, (ops.get(occurrence.copyOpId) as CopyOp).targetRelPath, occurrence.blobId])}` : null, plan.id, occurrence.sourcePath, occurrence.kind,
          JSON.stringify({ relPath: occurrence.relPath, key: occurrence.key, chain: occurrence.chain }))
      }
      appendJournal(db, { op: 'register', assetIds, libraryRoot: plan.libraryRoot, label: `执行摄取计划 ${plan.id}`, extra: { planId: plan.id, targetFiles: [...staged] } }, { batchId: plan.id })
      return assetIds
    })()
    updateProgress(db, plan, progress, result.length && result.every(id => plan.units.find(u => u.assetId === id)?.disposition === 'duplicate') ? 'duplicate' : 'completed', now())
    return { planId, status: result.length ? 'completed' : 'duplicate', dryRun: false, copiedBytes: copiedBytes.value, reusedBytes: reusedBytes.value, copiedOps, reusedOps, assetIds: result, journalId: null }
  } catch (error) {
    for (const target of staged) await removeQuietly(target)
    for (const blob of published) await removeQuietly(blob)
    for (const dir of [...createdDirs].sort((a, b) => b.length - a.length)) await removeQuietly(dir)
    const cancelled = opts.signal?.aborted || (error instanceof IntakeExecutionError && error.code === 'cancelled')
    const normalized = cancelled && !(error instanceof IntakeExecutionError) ? new IntakeExecutionError('摄取已取消', 'cancelled') : error
    const failure = normalized instanceof Error ? normalized.message : String(normalized)
    for (const op of allOps(plan)) if (!progress.completedOps[op.id]) progress.failedOps[op.id] = failure
    updateProgress(db, plan, progress, cancelled ? 'cancelled' : 'failed', now())
    throw normalized
  }
}

/** Remove only this plan's logical references and newly-created asset rows. Shared blobs survive. */
export function undoPlan(db: Db, planId: string): { removedAssetIds: string[]; removedRefs: number; removedOccurrences: number } {
  const saved = readIntakePlan(db, planId); if (!saved) throw new IntakeExecutionError(`找不到计划：${planId}`, 'database')
  const result = db.transaction(() => {
    const plan = saved.plan, ids = plan.units.map(unitAssetId).filter((id): id is string => !!id), refRows = db.prepare('SELECT id,blob_id FROM asset_blob_ref WHERE asset_id IN (' + ids.map(() => '?').join(',') + ')').all(...ids) as { id: string; blob_id: string }[]
    const occurrences = db.prepare('DELETE FROM source_occurrence WHERE plan_id=?').run(planId).changes
    if (ids.length) db.prepare('DELETE FROM asset_blob_ref WHERE asset_id IN (' + ids.map(() => '?').join(',') + ')').run(...ids)
    if (ids.length) db.prepare('DELETE FROM asset WHERE id IN (' + ids.map(() => '?').join(',') + ')').run(...ids)
    updateIntakeProgress(db, planId, 'cancelled', { ...saved.progress, completedOps: {}, failedOps: { ...saved.progress.failedOps, undone: 'plan undone' } }, Date.now())
    return { removedAssetIds: ids, removedRefs: refRows.length, removedOccurrences: occurrences, targetPaths: allOps(plan).map(op => safeJoin(plan.libraryRoot, op.targetRelPath)).filter((p): p is string => !!p), blobIds: [...new Set(refRows.map(r => r.blob_id))] }
  })()
  for (const target of result.targetPaths) { try { fs.rmSync(target, { force: true }) } catch { /* report leaves the row if a user has it open */ } }
  for (const blobId of result.blobIds) {
    const row = db.prepare('SELECT ref_count,storage_path FROM content_blob WHERE blob_id=?').get(blobId) as { ref_count: number; storage_path: string } | undefined
    if (row && row.ref_count === 0) { try { fs.rmSync(row.storage_path, { force: true }) } catch { /* keep orphan for later cache cleanup */ } db.prepare('DELETE FROM content_blob WHERE blob_id=? AND ref_count=0').run(blobId) }
  }
  return { removedAssetIds: result.removedAssetIds, removedRefs: result.removedRefs, removedOccurrences: result.removedOccurrences }
}
