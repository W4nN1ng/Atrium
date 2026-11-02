import type Database from 'better-sqlite3'
import { ExpandCache } from './expandCache'
import { readIntakePlan, updateIntakeProgress } from '../db/repos/intakePlan'

/** Fail closed on malformed resumable plans: their cache cannot safely be collected. */
export async function pruneIntakeCache(db: Pick<Database.Database, 'prepare' | 'name'>, cache = new ExpandCache({ namespace: db.name })): Promise<void> {
  const keys = activePlanCacheKeys(db)
  await cache.replaceRetained('database-active-plans', keys)
  await cache.prune(keys)
}

function activePlanCacheKeys(db: Pick<Database.Database, 'prepare'>): string[] {
  const rows = db.prepare("SELECT plan_json, progress_json FROM intake_plan WHERE status <> 'completed' AND (status <> 'duplicate' OR json_extract(progress_json,'$.committed') IS NOT 1)").all() as { plan_json: string; progress_json: string | null }[]
  const keys = new Set<string>()
  for (const row of rows) for (const json of [row.plan_json, row.progress_json]) {
    if (json === null) continue
    const value = JSON.parse(json) as { cacheKeys?: unknown }
    if (!value || !Array.isArray(value.cacheKeys) || value.cacheKeys.some(k => typeof k !== 'string' || !/^[a-f0-9]{64}$/.test(k))) throw new Error('Invalid persisted cache references; cleanup stopped')
    for (const key of value.cacheKeys) keys.add(key)
  }
  return [...keys]
}

/** Only committed plans may drop their own lease; resumable or concurrent plans keep their bytes. */
export async function releaseCompletedIntakeCache(db: Database.Database, planId: string, cache = new ExpandCache({ namespace: db.name })): Promise<void> {
  const saved = readIntakePlan(db, planId)
  if (!saved || !saved.progress.committed || !['completed', 'duplicate'].includes(saved.status)) throw new Error('Cannot release an unfinished intake plan')
  updateIntakeProgress(db, planId, saved.status, { ...saved.progress, cacheKeys: [] })
  const active = activePlanCacheKeys(db)
  await cache.replaceRetained('database-active-plans', active)
  await cache.release(planId)
  await cache.discardUnreferenced(saved.plan.cacheKeys, active)
}

/** The planning worker must have stopped before an unpublished attempt can be discarded. */
export async function releasePendingIntakeCache(db: Pick<Database.Database, 'prepare' | 'name'>, jobId: string, cache = new ExpandCache({ namespace: db.name })): Promise<void> {
  const active = activePlanCacheKeys(db)
  await cache.replaceRetained('database-active-plans', active)
  await cache.releaseAndCollect('pending:' + jobId, active)
}
