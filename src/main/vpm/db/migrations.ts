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

export const VPM_SCHEMA_VERSION = 1

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

export const VPM_MIGRATIONS: readonly VpmMigration[] = [{ version: 1, sql: V1 }]

/** 每个版本完整迁移后必须存在的表；用于发现“版本号对但表被删/半迁移”的库。 */
export const VPM_REQUIRED_TABLES: Readonly<Record<number, readonly string[]>> = {
  1: ['vpm_repo', 'vpm_repo_package']
}
