import type { VpmDb } from '../db'
import type { TemplateRow } from './types'

interface DbRow {
  id: string
  name: string
  description: string | null
  source: string
  format: string
  base_id: string | null
  unity_range: string | null
  dependencies_json: string
  unitypackages_json: string
  settings_json: string
  favorite: number
  visible: number
  last_used_at: number | null
  created_at: number
  updated_at: number
}

function mapRow(row: DbRow): TemplateRow {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    source: row.source as TemplateRow['source'],
    format: 'atrium',
    baseId: row.base_id,
    unityRange: row.unity_range,
    dependenciesJson: row.dependencies_json,
    unitypackagesJson: row.unitypackages_json,
    settingsJson: row.settings_json,
    favorite: row.favorite === 1,
    visible: row.visible === 1,
    lastUsedAt: row.last_used_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

/**
 * `vpm_template` / `vpm_recent_location` 的唯一 SQL 入口。
 *
 * 行是**索引**，不是真相：用户模板的真相是 `<dataRoot>/templates/<id>/template.json`。
 * 删模板 = `visible=0`，永远不在这里删文件。
 */
export class TemplateStore {
  constructor(
    private readonly db: VpmDb,
    private readonly now: () => number = Date.now
  ) {}

  list(includeHidden = false): TemplateRow[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM vpm_template
          ${includeHidden ? '' : 'WHERE visible = 1'}
          ORDER BY favorite DESC, COALESCE(last_used_at, 0) DESC, name ASC`
      )
      .all() as DbRow[]
    return rows.map(mapRow)
  }

  get(id: string): TemplateRow | null {
    const row = this.db.prepare('SELECT * FROM vpm_template WHERE id = ?').get(id) as DbRow | undefined
    return row ? mapRow(row) : null
  }

  upsert(row: Omit<TemplateRow, 'createdAt' | 'updatedAt'> & { createdAt?: number; updatedAt?: number }): TemplateRow {
    const at = this.now()
    const existing = this.get(row.id)
    const createdAt = existing?.createdAt ?? row.createdAt ?? at
    this.db
      .prepare(
        `INSERT INTO vpm_template
           (id, name, description, source, format, base_id, unity_range,
            dependencies_json, unitypackages_json, settings_json,
            favorite, visible, last_used_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'atrium', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name,
           description = excluded.description,
           source = excluded.source,
           base_id = excluded.base_id,
           unity_range = excluded.unity_range,
           dependencies_json = excluded.dependencies_json,
           unitypackages_json = excluded.unitypackages_json,
           settings_json = excluded.settings_json,
           favorite = excluded.favorite,
           visible = excluded.visible,
           last_used_at = excluded.last_used_at,
           updated_at = excluded.updated_at`
      )
      .run(
        row.id,
        row.name,
        row.description,
        row.source,
        row.baseId,
        row.unityRange,
        row.dependenciesJson,
        row.unitypackagesJson,
        row.settingsJson,
        row.favorite ? 1 : 0,
        row.visible ? 1 : 0,
        row.lastUsedAt,
        createdAt,
        at
      )
    const saved = this.get(row.id)
    if (!saved) throw new Error('template row missing after upsert')
    return saved
  }

  setFavorite(id: string, favorite: boolean): TemplateRow | null {
    this.db
      .prepare('UPDATE vpm_template SET favorite = ?, updated_at = ? WHERE id = ?')
      .run(favorite ? 1 : 0, this.now(), id)
    return this.get(id)
  }

  setVisible(id: string, visible: boolean): TemplateRow | null {
    this.db
      .prepare('UPDATE vpm_template SET visible = ?, updated_at = ? WHERE id = ?')
      .run(visible ? 1 : 0, this.now(), id)
    return this.get(id)
  }

  markUsed(id: string): void {
    this.db
      .prepare('UPDATE vpm_template SET last_used_at = ?, updated_at = ? WHERE id = ?')
      .run(this.now(), this.now(), id)
  }

  deleteRow(id: string): void {
    this.db.prepare('DELETE FROM vpm_template WHERE id = ?').run(id)
  }

}
