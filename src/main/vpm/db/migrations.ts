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

export const VPM_SCHEMA_VERSION = 3

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

export const VPM_MIGRATIONS: readonly VpmMigration[] = [
  { version: 1, sql: V1 },
  { version: 2, sql: V2 },
  { version: 3, sql: V3 }
]

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
  ]
}
