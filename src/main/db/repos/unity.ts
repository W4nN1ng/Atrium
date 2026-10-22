import type { Db } from '../index'
import { ulid } from '../../../shared/ulid'
import type {
  DependencyRow,
  EntryKind,
  InstalledWhereRow,
  PackageEntry,
  ProjectInfo,
  ProjectRow
} from '../../../shared/types'

// ---------------------------------------------------------------- Unity 工程

export function upsertProject(
  db: Db,
  input: {
    path: string
    name: string
    unityVersion?: string | null
    isRunning?: boolean
    bridgeVersion?: string | null
    fingerprint?: unknown
  }
): ProjectRow {
  const now = Date.now()
  const existing = db.prepare(`SELECT * FROM project WHERE path = ?`).get(input.path) as
    | ProjectRow
    | undefined
  if (existing) {
    db.prepare(
      `UPDATE project SET name = ?, unity_version = ?, last_seen = ?, is_running = ?,
          bridge_version = ?, fingerprint_json = ?
       WHERE id = ?`
    ).run(
      input.name,
      input.unityVersion ?? existing.unity_version,
      now,
      input.isRunning ? 1 : existing.is_running,
      input.bridgeVersion ?? existing.bridge_version,
      input.fingerprint === undefined ? existing.fingerprint_json : JSON.stringify(input.fingerprint),
      existing.id
    )
    return db.prepare(`SELECT * FROM project WHERE id = ?`).get(existing.id) as ProjectRow
  }
  const row: ProjectRow = {
    id: ulid(),
    path: input.path,
    name: input.name,
    unity_version: input.unityVersion ?? null,
    last_seen: now,
    is_running: input.isRunning ? 1 : 0,
    guid_index_at: null,
    bridge_version: input.bridgeVersion ?? null,
    fingerprint_json: input.fingerprint === undefined ? null : JSON.stringify(input.fingerprint),
    /** 新工程从没自动切过 —— NULL 不是 0：0 会被冷却判成"很久以前切过"以外的任何东西 */
    last_auto_switch_at: null
  }
  db.prepare(
    `INSERT INTO project (id, path, name, unity_version, last_seen, is_running, guid_index_at, bridge_version, fingerprint_json)
     VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?)`
  ).run(
    row.id,
    row.path,
    row.name,
    row.unity_version,
    row.last_seen,
    row.is_running,
    row.bridge_version,
    row.fingerprint_json
  )
  return row
}

export function listProjects(db: Db): ProjectRow[] {
  return db.prepare(`SELECT * FROM project ORDER BY name`).all() as ProjectRow[]
}

export function getProjectByPath(db: Db, p: string): ProjectRow | null {
  const row = db.prepare(`SELECT * FROM project WHERE path = ?`).get(p) as ProjectRow | undefined
  return row ?? null
}

export function getProject(db: Db, id: string): ProjectRow | null {
  const row = db.prepare(`SELECT * FROM project WHERE id = ?`).get(id) as ProjectRow | undefined
  return row ?? null
}

/** 从核心工程表里删掉一行（用户明确删除工程时用）。 */
export function deleteProject(db: Db, id: string): void {
  db.prepare(`DELETE FROM project WHERE id = ?`).run(id)
}

export function setProjectRunning(db: Db, id: string, running: boolean): void {
  db.prepare(`UPDATE project SET is_running = ?, last_seen = ? WHERE id = ?`).run(
    running ? 1 : 0,
    Date.now(),
    id
  )
}

/**
 * M6 ③ · 自动切换冷却的两个读写口。
 *
 * ⚠ `markAutoSwitched` **只在真的切换了之后**调用。skip（没匹配上 / 平手 / 行为开关关掉）
 * 一次都不许写 —— 那样等于把后面 5 分钟内的真实切换全吞掉（隐患 B）。
 * 配套断言在 `tests/project/auto-switch.spec.ts`：「一次 skip 之后紧接着的真实 hit 仍能切换」。
 */
export function autoSwitchAtOf(db: Db, projectId: string): number | null {
  const row = db.prepare(`SELECT last_auto_switch_at FROM project WHERE id = ?`).get(projectId) as
    | { last_auto_switch_at: number | null }
    | undefined
  return row?.last_auto_switch_at ?? null
}

export function markAutoSwitched(db: Db, projectId: string, at: number): void {
  db.prepare(`UPDATE project SET last_auto_switch_at = ? WHERE id = ?`).run(at, projectId)
}

export function projectFingerprint(row: ProjectRow): unknown {
  if (!row.fingerprint_json) return null
  try {
    return JSON.parse(row.fingerprint_json)
  } catch {
    return null
  }
}

export function toProjectInfo(row: ProjectRow): ProjectInfo {
  return {
    id: row.id,
    path: row.path,
    name: row.name,
    unityVersion: row.unity_version,
    running: row.is_running === 1,
    /**
     * ⚠ 这里**只能**给"桥接装着且记了版本"这一条猜测。
     * 真正的依据（lockfile / wmi / bridge 心跳）由 `project/running.ts` 的
     * `applyDetection` 填 —— 它是唯一知道三路探测结果的地方。
     *
     * 以前这里写的是 `row.bridge_version ? ['vcc','bridge'] : ['vcc']`，
     * 把"从哪发现的工程"（vcc/scan）和"凭什么说它在运行"（bridge/lockfile/wmi）
     * 混成了一个字段。两者含义完全不同：`vcc` 说明工程来自 ALCOM 清单，
     * 与"现在开着 Unity"毫无关系。`applyDetection` 会整个覆盖这个字段，
     * 所以这里是"还没探测过"时的兜底值。
     */
    detectedBy: row.bridge_version ? ['bridge'] : [],
    bridgeVersion: row.bridge_version
  }
}

// ---------------------------------------------------------------- unitypackage 内容清单

export function replacePackageEntries(db: Db, assetId: string, entries: PackageEntry[]): void {
  db.transaction(() => {
    db.prepare(`DELETE FROM package_entry WHERE asset_id = ?`).run(assetId)
    const stmt = db.prepare(
      `INSERT INTO package_entry (asset_id, guid, unity_path, entry_kind, size, has_preview)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    for (const e of entries) {
      stmt.run(assetId, e.guid, e.unityPath, e.entryKind as EntryKind, e.size, e.hasPreview ? 1 : 0)
    }
  })()
}

export function packageEntriesOf(db: Db, assetId: string): PackageEntry[] {
  const rows = db
    .prepare(`SELECT guid, unity_path, entry_kind, size, has_preview FROM package_entry WHERE asset_id = ?`)
    .all(assetId) as Array<{
    guid: string
    unity_path: string
    entry_kind: EntryKind | null
    size: number | null
    has_preview: number | null
  }>
  return rows.map((r) => ({
    guid: r.guid,
    unityPath: r.unity_path,
    entryKind: (r.entry_kind ?? 'other') as EntryKind,
    size: Number(r.size ?? 0),
    hasPreview: r.has_preview === 1
  }))
}

export function guidsOfAsset(db: Db, assetId: string): string[] {
  return (
    db.prepare(`SELECT guid FROM package_entry WHERE asset_id = ?`).all(assetId) as Array<{ guid: string }>
  ).map((r) => r.guid)
}

export function entryKindHistogram(db: Db, assetId: string): Record<string, number> {
  const rows = db
    .prepare(
      `SELECT COALESCE(entry_kind, 'other') AS k, COUNT(*) AS n FROM package_entry WHERE asset_id = ? GROUP BY k`
    )
    .all(assetId) as Array<{ k: string; n: number }>
  const out: Record<string, number> = {}
  for (const r of rows) out[r.k] = Number(r.n)
  return out
}

/** 反查：哪个已索引素材提供了这个 GUID（第 2 份 §2.3） */
export function findProviderOfGuid(db: Db, guid: string): { assetId: string; name: string } | null {
  const row = db
    .prepare(
      `SELECT pe.asset_id AS assetId, a.name AS name
         FROM package_entry pe JOIN asset a ON a.id = pe.asset_id
        WHERE pe.guid = ? LIMIT 1`
    )
    .get(guid) as { assetId: string; name: string } | undefined
  return row ?? null
}

// ---------------------------------------------------------------- 依赖

export function replaceDependencies(db: Db, assetId: string, deps: DependencyRow[]): void {
  db.transaction(() => {
    db.prepare(`DELETE FROM dependency WHERE asset_id = ?`).run(assetId)
    const stmt = db.prepare(
      `INSERT OR IGNORE INTO dependency (asset_id, dep_guid, dep_kind, resolved_by) VALUES (?, ?, ?, ?)`
    )
    for (const d of deps) stmt.run(assetId, d.dep_guid, d.dep_kind, d.resolved_by ?? null)
  })()
}

export interface DependencySummary {
  internal: number
  external: number
  resolved: number
  missing: string[]
}

export function dependencySummary(db: Db, assetId: string): DependencySummary {
  const rows = db
    .prepare(`SELECT dep_guid, dep_kind, resolved_by FROM dependency WHERE asset_id = ?`)
    .all(assetId) as Array<{ dep_guid: string; dep_kind: string | null; resolved_by: string | null }>
  const s: DependencySummary = { internal: 0, external: 0, resolved: 0, missing: [] }
  for (const r of rows) {
    if (r.dep_kind === 'internal') s.internal++
    else {
      s.external++
      if (r.resolved_by) s.resolved++
      else s.missing.push(r.dep_guid)
    }
  }
  return s
}

/** 工程 GUID 索引：M5 由桥接 resolve_guids 分批填充，这里只管存取 */
export function setProjectGuidIndex(db: Db, projectId: string, guids: string[]): void {
  db.transaction(() => {
    db.prepare(`UPDATE project SET guid_index_at = ? WHERE id = ?`).run(Date.now(), projectId)
    db.prepare(
      `INSERT OR REPLACE INTO setting (key, value_json) VALUES (?, ?)`
    ).run(`projectGuids:${projectId}`, JSON.stringify({ at: Date.now(), guids }))
  })()
}

export function getProjectGuidIndex(db: Db, projectId: string): { at: number; guids: string[] } | null {
  const row = db.prepare(`SELECT value_json FROM setting WHERE key = ?`).get(`projectGuids:${projectId}`) as
    | { value_json: string }
    | undefined
  if (!row) return null
  try {
    return JSON.parse(row.value_json) as { at: number; guids: string[] }
  } catch {
    return null
  }
}

/**
 * 素材在哪些工程装过（第 3 份 §7 反查；R4 ⑥ 把它接上了界面）。
 *
 * ## 口径必须写死在这里，界面上原样转述
 *
 * 查的是 `import_log`，所以它只认**A 导过的那几次**：
 *  - 用户自己在 Unity 里右键 Import 过的 → 桥接不认识那次 → **查不到**；
 *  - 导完之后又被手动删掉的 → 日志还在，这里仍然算"装过"；
 *  - "工程里现在到底有哪些 GUID"当前桥接答不了（`list_project_assets` 只回包名，
 *    `resolve_guids` 只查传进去的、不枚举），所以这里给不了"现在还在不在"。
 *
 * ## 为什么按"整组"查而不是只查这一行
 *
 * 聚合视图里一张卡代表一个归并组（11 个体型 = 11 行 asset）。只查代表行的 `asset_id`
 * 会出现"明明导过，卡片却说没装过"—— 那次导的是兄弟行。所以把同组的行一起算进来，
 * 界面上用 `packages`（几个包）说清数了几次。
 *
 * 行类型 `InstalledWhereRow` 住在 `shared/types.ts`（主进程算、渲染进程画，两边一份）。
 */
export function installedProjects(db: Db, assetId: string): InstalledWhereRow[] {
  const group = (db.prepare(`SELECT group_id AS g FROM asset WHERE id = ?`).get(assetId) as { g?: string } | undefined)?.g ?? null
  const rows = db
    .prepare(
      `SELECT il.project_id AS projectId,
              p.name AS name,
              MAX(CASE WHEN il.status = 'ok' THEN il.finished_at END) AS at,
              SUM(CASE WHEN il.status = 'ok' THEN 1 ELSE 0 END) AS packages,
              SUM(CASE WHEN il.status = 'ok' AND json_valid(il.created_guids_json) THEN json_array_length(il.created_guids_json) ELSE 0 END) AS created,
              SUM(CASE WHEN il.status = 'ok' AND json_valid(il.overwritten_json) THEN json_array_length(il.overwritten_json) ELSE 0 END) AS overwritten,
              SUM(CASE WHEN il.status = 'rolledback' THEN 1 ELSE 0 END) AS rolledBack
         FROM import_log il LEFT JOIN project p ON p.id = il.project_id
        WHERE il.kind = 'import' AND il.status IN ('ok', 'rolledback')
          AND (il.asset_id = :id
               OR (:g IS NOT NULL AND il.asset_id IN (SELECT id FROM asset WHERE group_id = :g)))
        GROUP BY il.project_id
        /* 只有失败尝试的工程不进这张表（那次什么都没发生）；
           "导过又被 A 退回"的工程**要**进来，packages=0 + rolledBack>0 */
        HAVING packages > 0 OR rolledBack > 0
        ORDER BY (at IS NULL), at DESC`
    )
    .all({ id: assetId, g: group }) as Array<{
    projectId: string
    name: string | null
    at: number | null
    packages: number
    created: number
    overwritten: number
    rolledBack: number
  }>
  return rows.map((r) => ({
    projectId: r.projectId,
    name: r.name ?? '',
    at: Number(r.at ?? 0),
    packages: Number(r.packages || 0),
    created: Number(r.created || 0),
    overwritten: Number(r.overwritten || 0),
    rolledBack: Number(r.rolledBack || 0),
    known: r.name !== null
  }))
}
