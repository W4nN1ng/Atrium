import fs from 'node:fs'
import path from 'node:path'
import type { Db } from '../db'
import { deleteAssetRow } from '../db/repos/asset'

interface FileRef {
  id: string
  name: string
  parent_asset_id: string | null
  library_path: string | null
  source_path: string | null
}
interface TrashDeps {
  db: Db
  recycle: (file: string) => Promise<void>
  forget?: (id: string) => void
  removed?: (id: string) => void
}
export interface TrashResult { trashed: string[]; failed: Array<{ id: string; error: string }> }

/** Resolve existing ancestors too: a missing member can still be inside a directory being recycled. */
function fileKey(file: string): string {
  let current = path.resolve(file)
  const tail: string[] = []
  for (;;) {
    try {
      const resolved = path.join(fs.realpathSync(current), ...tail.reverse())
      return process.platform === 'win32' ? resolved.toLowerCase() : resolved
    } catch (error) {
      if (!['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error
      const parent = path.dirname(current)
      if (parent === current) throw error
      tail.push(path.basename(current)); current = parent
    }
  }
}
function refs(db: Db): FileRef[] {
  return db.prepare('SELECT id, name, parent_asset_id, library_path, source_path FROM asset').all() as FileRef[]
}
function subtree(rows: FileRef[], root: string): Set<string> {
  const children = new Map<string, string[]>()
  for (const row of rows) if (row.parent_asset_id) {
    const ids = children.get(row.parent_asset_id) ?? []
    ids.push(row.id); children.set(row.parent_asset_id, ids)
  }
  const ids = new Set<string>(), queue = [root]
  while (queue.length) {
    const id = queue.pop()!
    if (ids.has(id)) continue
    ids.add(id); queue.push(...(children.get(id) ?? []))
  }
  return ids
}

/** Only the selected logical subtree may lose files; shared sources and independent rows stay untouched. */
export async function trashAssets(deps: TrashDeps, input: string[]): Promise<TrashResult> {
  const requested = [...new Set(input)]
  const selected = new Set(requested)
  const initial = new Map(refs(deps.db).map(row => [row.id, row]))
  const groups = new Map<string, string[]>()
  for (const id of requested) {
    let root = id, parent = initial.get(id)?.parent_asset_id
    const seen = new Set([id])
    while (parent && !seen.has(parent)) {
      seen.add(parent)
      if (selected.has(parent)) root = parent
      parent = initial.get(parent)?.parent_asset_id
    }
    const ids = groups.get(root) ?? []
    ids.push(id); groups.set(root, ids)
  }
  const result: TrashResult = { trashed: [], failed: [] }
  for (const [root, selectedIds] of groups) {
    try {
      // Re-read after each await so preceding operations do not leave stale ownership snapshots.
      const rows = refs(deps.db), row = rows.find(item => item.id === root)
      if (!row) throw new Error('i18n:err.trashMissing')
      const affected = subtree(rows, root)
      const target = row.library_path ?? row.source_path
      if (target && fs.existsSync(target)) {
        const key = fileKey(target), directory = fs.statSync(target).isDirectory()
        const keys = new Map<string, string>([[target, key]])
        const conflict = rows.find(other => !affected.has(other.id) &&
          [other.library_path, other.source_path].some(file => {
            if (!file) return false
            const otherKey = keys.get(file) ?? fileKey(file)
            keys.set(file, otherKey)
            return otherKey === key || (directory && otherKey.startsWith(key + path.sep))
          }))
        if (conflict) throw new Error(`i18n:err.${directory ? 'trashReferencedDirectory' : 'trashSharedFile'}|${JSON.stringify({ name: conflict.name })}`)
        await deps.recycle(target)
      }
      for (const id of affected) deps.forget?.(id)
      deleteAssetRow(deps.db, root)
      for (const id of affected) deps.removed?.(id)
      result.trashed.push(...selectedIds)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      for (const id of selectedIds) result.failed.push({ id, error: message })
    }
  }
  return result
}
