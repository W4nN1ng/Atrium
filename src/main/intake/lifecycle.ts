import type Database from 'better-sqlite3'
import { ExpandCache } from './expandCache'

/** Fail closed on malformed resumable plans: their cache cannot safely be collected. */
export async function pruneIntakeCache(db: Pick<Database.Database, 'prepare' | 'name'>, cache = new ExpandCache({ namespace: db.name })): Promise<void> {
  const rows = db.prepare("SELECT plan_json, progress_json FROM intake_plan WHERE status NOT IN ('completed', 'duplicate')").all() as { plan_json: string; progress_json: string | null }[]
  const keys = new Set<string>()
  for (const row of rows) for (const json of [row.plan_json, row.progress_json]) {
    if (json === null) continue
    const value = JSON.parse(json) as { cacheKeys?: unknown }
    if (!value || !Array.isArray(value.cacheKeys) || value.cacheKeys.some(k => typeof k !== 'string' || !/^[a-f0-9]{64}$/.test(k))) throw new Error('Invalid persisted cache references; cleanup stopped')
    for (const key of value.cacheKeys) keys.add(key)
  }
  await cache.prune([...keys])
}
