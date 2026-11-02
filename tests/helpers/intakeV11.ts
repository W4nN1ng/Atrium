import type { Db } from '../../src/main/db'
import { MIGRATIONS } from '../../src/main/db/schema'
import { makeAssetRow, upsertAsset } from '../../src/main/db/repos/asset'

/** Build an actual V11 database, not a current database with its version label lowered. */
export function seedIntakeV11(db: Db): void {
  for (const migration of MIGRATIONS.filter((item) => item.version <= 11)) {
    db.transaction(() => {
      db.exec(migration.sql)
      migration.post?.(db)
      db.pragma(`user_version = ${migration.version}`)
    })()
  }
  // Seed after V11's historical repair. V12 must not rerun that repair on legitimate shared data.
  for (const id of ['legacy-a', 'legacy-b']) {
    upsertAsset(db, makeAssetRow({
      id, name: id, raw_name: id + '.unitypackage', category: 'plugin',
      status: 'archived', storage_mode: 'indexed', hash_xxh64: 'shared-v11-hash',
      cover_image: id === 'legacy-a' ? 'athumb://cover-manual.jpg' : 'athumb://shared-v11-hash.jpg',
      size_bytes: 100, created_at: 1, updated_at: 2
    }))
  }
  db.prepare(`INSERT INTO asset_cover (asset_id, cover_image, previous_image, source, updated_at)
    VALUES ('legacy-a', 'athumb://cover-manual.jpg', 'athumb://previous.jpg', 'image', 3)`).run()
  db.prepare(`INSERT INTO project (id, path, name) VALUES ('legacy-project', 'E:/sandbox/project', 'legacy')`).run()
  db.prepare(`INSERT INTO import_log (id, project_id, asset_id, status)
    VALUES ('legacy-import', 'legacy-project', 'legacy-a', 'success')`).run()
  db.prepare(`INSERT INTO setting (key, value_json) VALUES ('ui.importNames', '[]')`).run()
}

export function snapshotIntakeLegacy(db: Db): Record<string, unknown[]> {
  const tables = db.prepare(`SELECT name FROM sqlite_master
    WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`).all() as Array<{ name: string }>
  return Object.fromEntries(tables.map(({ name }) => [
    name, db.prepare(`SELECT * FROM "${name.replace(/"/g, '""')}" ORDER BY rowid`).all()
  ]))
}
