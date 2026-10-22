import type { VpmDb } from '../db'

/**
 * 最近使用的**父目录**（新建工程时选的目录）。
 *
 * 存在 `vpm.db` 的 `vpm_recent_location` 表，不写核心设置（`settings.json` 是
 * 素材库/界面偏好，不该被 VPM 的临时状态污染）。
 *
 * 只保留最近 N 条：新建工程是低频动作，8 条足够，也不让表无限长。
 */
export interface RecentLocation {
  path: string
  lastUsedAt: number
}

export const RECENT_LOCATION_LIMIT = 8

export class RecentLocationStore {
  constructor(
    private readonly db: VpmDb,
    private readonly now: () => number = Date.now,
    private readonly limit: number = RECENT_LOCATION_LIMIT
  ) {}

  list(limit = this.limit): RecentLocation[] {
    const rows = this.db
      // rowid 兜底：同一毫秒内连续记录时，后写的应该排在前面。
      .prepare(
        'SELECT path, last_used_at FROM vpm_recent_location ORDER BY last_used_at DESC, rowid DESC LIMIT ?'
      )
      .all(clamp(limit)) as Array<{ path: string; last_used_at: number }>
    return rows.map((row) => ({ path: row.path, lastUsedAt: row.last_used_at }))
  }

  record(target: string): void {
    const value = typeof target === 'string' ? target.trim() : ''
    if (!value || value.includes('\0') || value.length > 4096) return
    const at = this.now()
    this.db
      .prepare(
        `INSERT INTO vpm_recent_location (path, last_used_at) VALUES (?, ?)
         ON CONFLICT(path) DO UPDATE SET last_used_at = excluded.last_used_at`
      )
      .run(value, at)
    this.db
      .prepare(
        `DELETE FROM vpm_recent_location
          WHERE path NOT IN (
            SELECT path FROM vpm_recent_location ORDER BY last_used_at DESC, rowid DESC LIMIT ?
          )`
      )
      .run(clamp(this.limit))
  }

  remove(target: string): void {
    this.db.prepare('DELETE FROM vpm_recent_location WHERE path = ?').run(target)
  }

  clear(): void {
    this.db.prepare('DELETE FROM vpm_recent_location').run()
  }
}

function clamp(limit: number): number {
  if (!Number.isFinite(limit)) return RECENT_LOCATION_LIMIT
  return Math.max(1, Math.min(50, Math.trunc(limit)))
}
