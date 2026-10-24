/**
 * vpm.db 的 schema 与只前进迁移表。
 *
 * 规则（见 docs/VPM-ARCHITECTURE.md §9）：
 * - 一个版本一段 SQL；迁移器负责事务；
 * - 只增不删；不在这里写 BEGIN/COMMIT；
 * - 新版本同时更新 VPM_SCHEMA_VERSION、VPM_REQUIRED_TABLES 和测试。
 */

export interface VpmMigration {
  version: number
  sql: string
}


const V1 = `
CREATE TABLE IF NOT EXISTS vpm_repo (
  id TEXT PRIMARY KEY,
  url TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'remote',
  enabled INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  headers_enc BLOB,
  etag TEXT,
  last_modified TEXT,
  last_fetch_at INTEGER,
  last_success_at INTEGER,
  last_error_code TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS vpm_repo_package (
  repo_id TEXT NOT NULL REFERENCES vpm_repo(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  version TEXT NOT NULL,
  display_name TEXT,
  description TEXT,
  author_json TEXT,
  keywords_json TEXT,
  aliases_json TEXT,
  unity_min TEXT,
  zip_url TEXT,
  zip_sha256 TEXT,
  zip_size INTEGER,
  yanked INTEGER NOT NULL DEFAULT 0,
  yanked_reason TEXT,
  hidden INTEGER NOT NULL DEFAULT 0,
  deprecated INTEGER NOT NULL DEFAULT 0,
  manifest_json TEXT NOT NULL,
  fetched_at INTEGER NOT NULL,
  PRIMARY KEY (repo_id, name, version)
);

CREATE INDEX IF NOT EXISTS idx_vpm_pkg_name ON vpm_repo_package(name);
CREATE INDEX IF NOT EXISTS idx_vpm_pkg_version ON vpm_repo_package(version);
`

const V2 = `
CREATE TABLE IF NOT EXISTS vpm_unity_install (
  id TEXT PRIMARY KEY,
  path TEXT NOT NULL COLLATE NOCASE UNIQUE,
  version TEXT,
  version_with_revision TEXT,
  source TEXT NOT NULL,
  arch TEXT,
  last_seen_at INTEGER,
  missing INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_vpm_unity_version ON vpm_unity_install(version);

CREATE TABLE IF NOT EXISTS vpm_project (
  project_key TEXT PRIMARY KEY,
  project_path TEXT NOT NULL,
  name TEXT NOT NULL,
  unity_version TEXT,
  unity_revision TEXT,
  unity_exe_path TEXT,
  unity_args_json TEXT,
  manifest_hash TEXT,
  manifest_mtime INTEGER,
  last_scan_at INTEGER,
  last_op_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS vpm_project_package (
  project_key TEXT NOT NULL,
  name TEXT NOT NULL,
  version TEXT,
  source TEXT,
  is_legacy INTEGER NOT NULL DEFAULT 0,
  state TEXT NOT NULL,
  dependency_json TEXT,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (project_key, name)
);

CREATE INDEX IF NOT EXISTS idx_vpm_project_pkg_key ON vpm_project_package(project_key);
`

const V3 = `
CREATE TABLE IF NOT EXISTS vpm_operation (
  id TEXT PRIMARY KEY,
  project_key TEXT NOT NULL,
  project_path TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('install', 'remove', 'upgrade', 'undo')),
  status TEXT NOT NULL CHECK (status IN (
    'planned', 'preflight', 'applying', 'committed',
    'failed', 'rolled_back', 'needs_attention'
  )),
  plan_json TEXT NOT NULL,
  plan_hash TEXT NOT NULL,
  project_fingerprint TEXT,
  manifest_before_hash TEXT,
  manifest_after_hash TEXT,
  summary_json TEXT,
  error_code TEXT,
  error_detail TEXT,
  vault_pending INTEGER NOT NULL DEFAULT 0 CHECK (vault_pending IN (0, 1)),
  created_at INTEGER NOT NULL,
  started_at INTEGER,
  finished_at INTEGER
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_vpm_op_active
  ON vpm_operation(project_key)
  WHERE status IN ('planned', 'preflight', 'applying');

CREATE INDEX IF NOT EXISTS idx_vpm_op_status ON vpm_operation(status);
CREATE INDEX IF NOT EXISTS idx_vpm_op_project_created
  ON vpm_operation(project_key, created_at DESC);

CREATE TABLE IF NOT EXISTS vpm_operation_step (
  op_id TEXT NOT NULL REFERENCES vpm_operation(id) ON DELETE CASCADE,
  step TEXT NOT NULL,
  seq INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('running', 'done', 'failed', 'skipped')),
  attempts INTEGER NOT NULL DEFAULT 0,
  detail_json TEXT,
  started_at INTEGER,
  finished_at INTEGER,
  PRIMARY KEY (op_id, step),
  UNIQUE (op_id, seq)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_vpm_step_running
  ON vpm_operation_step(op_id)
  WHERE status = 'running';

CREATE INDEX IF NOT EXISTS idx_vpm_step_order ON vpm_operation_step(op_id, seq);

CREATE TABLE IF NOT EXISTS vpm_operation_file (
  op_id TEXT NOT NULL REFERENCES vpm_operation(id) ON DELETE CASCADE,
  path TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('move-out', 'move-in', 'legacy', 'vault')),
  vault_path TEXT,
  sha256 TEXT,
  size INTEGER,
  state TEXT NOT NULL CHECK (state IN ('pending', 'done', 'failed', 'archived')),
  PRIMARY KEY (op_id, path, action)
);

CREATE TABLE IF NOT EXISTS vpm_cache_entry (
  sha256 TEXT PRIMARY KEY,
  size INTEGER NOT NULL,
  path TEXT NOT NULL,
  source_host TEXT,
  last_used_at INTEGER NOT NULL
);
`

/**
 * v4：模板与"最近使用位置"（P5-A）。
 *
 * 模板的**文件**在 `<dataRoot>/templates/<id>/`，这里只存索引/元数据：
 * 收藏、可见性、最近使用都改行，不动用户文件。删模板 = `visible=0`。
 */
const V4 = `
CREATE TABLE IF NOT EXISTS vpm_template (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  source TEXT NOT NULL CHECK (source IN ('builtin', 'imported', 'user')),
  format TEXT NOT NULL CHECK (format = 'atrium'),
  base_id TEXT,
  unity_range TEXT,
  dependencies_json TEXT,
  unitypackages_json TEXT,
  settings_json TEXT,
  favorite INTEGER NOT NULL DEFAULT 0,
  visible INTEGER NOT NULL DEFAULT 1,
  last_used_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_vpm_template_visible
  ON vpm_template(visible, favorite, last_used_at);

CREATE TABLE IF NOT EXISTS vpm_recent_location (
  path TEXT PRIMARY KEY,
  last_used_at INTEGER NOT NULL
);
`

/**
 * v5：备份记录（P6-B）。
 *
 * 只存"做过什么备份"，zip 本身在 `<dataRoot>/backups/...`；
 * 删记录不删文件（P6-D 的 UI 才会问用户）。
 */
const V5 = `
CREATE TABLE IF NOT EXISTS vpm_backup (
  id TEXT PRIMARY KEY,
  project_key TEXT NOT NULL,
  project_name TEXT NOT NULL,
  source_path TEXT NOT NULL,
  file_path TEXT NOT NULL,
  size INTEGER,
  sha256 TEXT,
  unity_version TEXT,
  package_count INTEGER,
  options_json TEXT,
  status TEXT NOT NULL CHECK (status IN ('running', 'ok', 'failed', 'cancelled')),
  created_at INTEGER NOT NULL,
  finished_at INTEGER,
  error_code TEXT
);

CREATE INDEX IF NOT EXISTS idx_vpm_backup_project
  ON vpm_backup(project_key, created_at DESC);
`

/**
 * v6：本地包目录（P7-C）。
 *
 * 只有用户**显式添加**的目录才会进这张表；`last_scan_at` 用来判断"上次扫到现在有没有变"。
 */
const V6 = `
CREATE TABLE IF NOT EXISTS vpm_local_root (
  id TEXT PRIMARY KEY,
  path TEXT NOT NULL UNIQUE,
  label TEXT,
  created_at INTEGER NOT NULL,
  last_scan_at INTEGER,
  package_count INTEGER NOT NULL DEFAULT 0
);
`

export const VPM_MIGRATIONS: readonly VpmMigration[] = [
  { version: 1, sql: V1 },
  { version: 2, sql: V2 },
  { version: 3, sql: V3 },
  { version: 4, sql: V4 },
  { version: 5, sql: V5 },
  { version: 6, sql: V6 }
]

/**
 * 当前支持的最高版本。
 *
 * **从迁移表推出来，不写字面量**：以前这里硬编码成 3，v4/v5/v6 加完就再没人动它，
 * 于是"支持的最高版本"整整落后三个版本（`tests/vpm/runtime.spec.ts` 里那条
 * "拒绝更新的库"因此一直在测别的东西）。推导出来就漂不动了。
 */
export const VPM_SCHEMA_VERSION: number = VPM_MIGRATIONS[VPM_MIGRATIONS.length - 1].version

/** 每个版本完整迁移后必须存在的表；用于发现“版本号对但表被删/半迁移”的库。 */
export const VPM_REQUIRED_TABLES: Readonly<Record<number, readonly string[]>> = {
  1: ['vpm_repo', 'vpm_repo_package'],
  2: [
    'vpm_repo',
    'vpm_repo_package',
    'vpm_unity_install',
    'vpm_project',
    'vpm_project_package'
  ],
  3: [
    'vpm_repo',
    'vpm_repo_package',
    'vpm_unity_install',
    'vpm_project',
    'vpm_project_package',
    'vpm_operation',
    'vpm_operation_step',
    'vpm_operation_file',
    'vpm_cache_entry'
  ],
  4: [
    'vpm_repo',
    'vpm_repo_package',
    'vpm_unity_install',
    'vpm_project',
    'vpm_project_package',
    'vpm_operation',
    'vpm_operation_step',
    'vpm_operation_file',
    'vpm_cache_entry',
    'vpm_template',
    'vpm_recent_location'
  ],
  5: [
    'vpm_repo',
    'vpm_repo_package',
    'vpm_unity_install',
    'vpm_project',
    'vpm_project_package',
    'vpm_operation',
    'vpm_operation_step',
    'vpm_operation_file',
    'vpm_cache_entry',
    'vpm_template',
    'vpm_recent_location',
    'vpm_backup'
  ],
  // v6 加的是 `vpm_local_root`（本地包根）。**必须单开一个 6**：
  // 当初把它塞进 5 的数组里，导致 `VPM_REQUIRED_TABLES[6]` 是 undefined，
  // 完整性检查对 v6 库直接 `if (!required) return` —— 一个缺表的新库也能开起来。
  6: [
    'vpm_repo',
    'vpm_repo_package',
    'vpm_unity_install',
    'vpm_project',
    'vpm_project_package',
    'vpm_operation',
    'vpm_operation_step',
    'vpm_operation_file',
    'vpm_cache_entry',
    'vpm_template',
    'vpm_recent_location',
    'vpm_backup',
    'vpm_local_root'
  ]
}
