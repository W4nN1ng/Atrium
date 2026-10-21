import { projectKeyOf, type ProjectSnapshot } from '../../../shared/vpm/domain/project'
import type { VpmDb } from '../db'

export interface ProjectPackageRow {
  name: string
  version: string | null
  source: string
  isLegacy: boolean
  state: string
  dependencyJson: string | null
  updatedAt: number
}

export interface ProjectLedgerRecord {
  projectKey: string
  projectPath: string
  name: string
  unityVersion: string | null
  unityRevision: string | null
  unityExePath: string | null
  unityArgsJson: string | null
  manifestHash: string | null
  manifestMtime: number | null
  lastScanAt: number | null
  lastOpId: string | null
  createdAt: number
  updatedAt: number
  packages: ProjectPackageRow[]
}

export interface ProjectLedgerMeta {
  unityExePath?: string | null
  unityArgsJson?: string | null
  lastOpId?: string | null
}

interface ProjectDbRow {
  project_key: string
  project_path: string
  name: string
  unity_version: string | null
  unity_revision: string | null
  unity_exe_path: string | null
  unity_args_json: string | null
  manifest_hash: string | null
  manifest_mtime: number | null
  last_scan_at: number | null
  last_op_id: string | null
  created_at: number
  updated_at: number
}

interface PackageDbRow {
  project_key: string
  name: string
  version: string | null
  source: string | null
  is_legacy: number
  state: string
  dependency_json: string | null
  updated_at: number
}

function mapPackage(row: PackageDbRow): ProjectPackageRow {
  return {
    name: row.name,
    version: row.version,
    source: row.source ?? 'embedded',
    isLegacy: row.is_legacy === 1,
    state: row.state,
    dependencyJson: row.dependency_json,
    updatedAt: Number(row.updated_at)
  }
}

function mapProject(row: ProjectDbRow, packages: ProjectPackageRow[]): ProjectLedgerRecord {
  return {
    projectKey: row.project_key,
    projectPath: row.project_path,
    name: row.name,
    unityVersion: row.unity_version,
    unityRevision: row.unity_revision,
    unityExePath: row.unity_exe_path,
    unityArgsJson: row.unity_args_json,
    manifestHash: row.manifest_hash,
    manifestMtime: row.manifest_mtime === null ? null : Number(row.manifest_mtime),
    lastScanAt: row.last_scan_at === null ? null : Number(row.last_scan_at),
    lastOpId: row.last_op_id,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
    packages
  }
}

/**
 * `vpm_project` / `vpm_project_package` 的唯一 SQL 入口。
 *
 * 这是**缓存/台账**：不覆盖工程文件；remove 只删台账行，不删盘、不删核心工程。
 */
export class ProjectLedgerStore {
  constructor(
    private readonly db: VpmDb,
    private readonly now: () => number = Date.now
  ) {}

  list(): ProjectLedgerRecord[] {
    const rows = this.db
      .prepare('SELECT * FROM vpm_project ORDER BY name COLLATE NOCASE ASC, project_key ASC')
      .all() as ProjectDbRow[]
    return rows.map((row) => mapProject(row, this.packages(row.project_key)))
  }

  get(projectKey: string): ProjectLedgerRecord | null {
    const row = this.db
      .prepare('SELECT * FROM vpm_project WHERE project_key = ?')
      .get(projectKey) as ProjectDbRow | undefined
    return row ? mapProject(row, this.packages(row.project_key)) : null
  }

  getByPath(projectPath: string): ProjectLedgerRecord | null {
    return this.get(projectKeyOf(projectPath))
  }

  upsertSnapshot(snapshot: ProjectSnapshot, meta: ProjectLedgerMeta = {}): ProjectLedgerRecord {
    const at = this.now()
    const existing = this.db
      .prepare('SELECT created_at FROM vpm_project WHERE project_key = ?')
      .get(snapshot.projectKey) as { created_at: number } | undefined
    const exePath = meta.unityExePath === undefined ? null : meta.unityExePath
    const argsJson = meta.unityArgsJson === undefined ? null : meta.unityArgsJson
    const opId = meta.lastOpId === undefined ? null : meta.lastOpId

    const write = this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO vpm_project
            (project_key, project_path, name, unity_version, unity_revision,
             unity_exe_path, unity_args_json, manifest_hash, manifest_mtime,
             last_scan_at, last_op_id, created_at, updated_at)
           VALUES
            (@key, @path, @name, @version, @revision,
             @exe, @args, @hash, @mtime, @scan, @op, @created, @updated)
           ON CONFLICT(project_key) DO UPDATE SET
            project_path = excluded.project_path,
            name = excluded.name,
            unity_version = excluded.unity_version,
            unity_revision = excluded.unity_revision,
            unity_exe_path = COALESCE(excluded.unity_exe_path, vpm_project.unity_exe_path),
            unity_args_json = COALESCE(excluded.unity_args_json, vpm_project.unity_args_json),
            manifest_hash = excluded.manifest_hash,
            manifest_mtime = excluded.manifest_mtime,
            last_scan_at = excluded.last_scan_at,
            last_op_id = COALESCE(excluded.last_op_id, vpm_project.last_op_id),
            updated_at = excluded.updated_at`
        )
        .run({
          key: snapshot.projectKey,
          path: snapshot.projectPath,
          name: snapshot.name,
          version: snapshot.unityVersion,
          revision: snapshot.unityRevision,
          exe: exePath,
          args: argsJson,
          hash: snapshot.manifestHash,
          mtime: snapshot.manifestMtime,
          scan: at,
          op: opId,
          created: existing?.created_at ?? at,
          updated: at
        })

      this.db.prepare('DELETE FROM vpm_project_package WHERE project_key = ?').run(snapshot.projectKey)
      const insert = this.db.prepare(
        `INSERT INTO vpm_project_package
          (project_key, name, version, source, is_legacy, state, dependency_json, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      const names = new Set<string>()
      for (const pkg of snapshot.packages) {
        names.add(pkg.name)
        insert.run(
          snapshot.projectKey,
          pkg.name,
          pkg.version,
          pkg.source,
          0,
          pkg.state,
          JSON.stringify(pkg.vpmDependencies),
          at
        )
      }
      let index = 0
      for (const legacy of snapshot.legacy.candidates) {
        const base = legacy.name ?? legacy.relativePath ?? `legacy-${index}`
        let name = base
        while (names.has(name)) name = `${base}#${index}`
        names.add(name)
        insert.run(
          snapshot.projectKey,
          name,
          null,
          legacy.match,
          1,
          'legacy',
          JSON.stringify({
            relativePath: legacy.relativePath,
            confidence: legacy.confidence,
            risk: legacy.risk
          }),
          at
        )
        index++
      }
    })
    write()
    const saved = this.get(snapshot.projectKey)
    if (!saved) throw new Error('project ledger row missing after upsert')
    return saved
  }

  remove(projectKey: string): boolean {
    const write = this.db.transaction(() => {
      this.db.prepare('DELETE FROM vpm_project_package WHERE project_key = ?').run(projectKey)
      const changed = this.db.prepare('DELETE FROM vpm_project WHERE project_key = ?').run(projectKey)
      return changed.changes > 0
    })
    return write()
  }

  private packages(projectKey: string): ProjectPackageRow[] {
    const rows = this.db
      .prepare('SELECT * FROM vpm_project_package WHERE project_key = ? ORDER BY is_legacy ASC, name COLLATE NOCASE ASC')
      .all(projectKey) as PackageDbRow[]
    return rows.map(mapPackage)
  }
}
