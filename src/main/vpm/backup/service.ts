import fs from 'node:fs'
import path from 'node:path'
import { projectSlugOf } from '../../../shared/vpm/domain/project'
import { VpmError } from '../../../shared/vpm/errors'
import type { MaintenanceKind, ProjectActivityPort } from '../../../shared/vpm/linkage'
import { ulid } from '../../../shared/ulid'
import type { VpmDb } from '../db'
import { hashFile } from '../fsUtil'
import type { ProjectsService } from '../projects'
import { collectProjectFiles } from './collector'
import { extractZip, readZipEntries, writeZip, type ZipCompression } from './zip'

export type BackupStatus = 'running' | 'ok' | 'failed' | 'cancelled'

export interface BackupRecord {
  id: string
  projectKey: string
  projectName: string
  sourcePath: string
  filePath: string
  size: number | null
  sha256: string | null
  unityVersion: string | null
  packageCount: number | null
  optionsJson: string | null
  status: BackupStatus
  createdAt: number
  finishedAt: number | null
  errorCode: string | null
}

export interface CreateBackupInput {
  projectKey: string
  /** 目标 zip；不传就 `<dataRoot>/backups/<slug>/<name>-<ts>.zip`。 */
  targetPath?: string
  compression?: ZipCompression
  /** 排除 vpm-manifest 受管的包（默认包含）。 */
  excludeVpmPackages?: boolean
  signal?: AbortSignal
  onProgress?: (progress: { phase: 'collect' | 'zip'; files: number; bytes: number }) => void
  /** Unity 运行中也继续（调用方负责二次确认）。 */
  allowUnityRunning?: boolean
}

export interface RestoreBackupInput {
  backupId: string
  /** 必须不存在；不覆盖任何已存在目录。 */
  targetDir: string
  installPackages?: boolean
  signal?: AbortSignal
}

export interface RestoreBackupResult {
  projectPath: string
  projectKey: string
  files: number
  installed: 'none' | 'installed' | 'failed'
}

export interface BackupServiceDeps {
  db: VpmDb
  dataRoot: string
  projects: ProjectsService
  /** P4-F 闸门：备份要独占维护租约（导入中会被拒）。 */
  activity?: ProjectActivityPort
  /** 打开文件位置（Electron shell），由组合根注入。 */
  revealPath?: (target: string) => void
  /** 从备份新建后按 manifest 补装依赖；由组合根注入。 */
  installer?: (projectPath: string) => Promise<'none' | 'installed' | 'failed'>
  now?: () => number
  maxBytes?: number
}

const DEFAULT_MAX_BYTES = 64 * 1024 * 1024 * 1024

interface DbRow {
  id: string
  project_key: string
  project_name: string
  source_path: string
  file_path: string
  size: number | null
  sha256: string | null
  unity_version: string | null
  package_count: number | null
  options_json: string | null
  status: string
  created_at: number
  finished_at: number | null
  error_code: string | null
}

function mapRow(row: DbRow): BackupRecord {
  return {
    id: row.id,
    projectKey: row.project_key,
    projectName: row.project_name,
    sourcePath: row.source_path,
    filePath: row.file_path,
    size: row.size,
    sha256: row.sha256,
    unityVersion: row.unity_version,
    packageCount: row.package_count,
    optionsJson: row.options_json,
    status: row.status as BackupStatus,
    createdAt: row.created_at,
    finishedAt: row.finished_at,
    errorCode: row.error_code
  }
}

/** 文件名里的非法字符替换掉，保留可读性。 */
export function sanitizeFileStem(value: string): string {
  const cleaned = value.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/[. ]+$/g, '').trim()
  return (cleaned || 'project').slice(0, 80)
}

function stamp(now: number): string {
  const date = new Date(now)
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
}

/**
 * 备份服务（P6-B）。
 *
 * - 先拿维护租约（导入中/装包中直接拒绝，避免备份到半成品）；
 * - 收集 → 写 `.part` → rename → 算 sha256 → 用 yauzl 读一遍验证；
 * - 记录写 `vpm_backup`，失败/取消也留一行（带 error_code），便于排查；
 * - 从备份新建：目标必须不存在，解压后可选按 manifest 补装依赖。
 */
export class ProjectBackupService {
  private readonly db: VpmDb
  private readonly now: () => number

  constructor(private readonly deps: BackupServiceDeps) {
    this.db = deps.db
    this.now = deps.now ?? Date.now
  }

  async create(input: CreateBackupInput): Promise<BackupRecord> {
    const project = this.deps.projects.get(input.projectKey)
    if (!project) throw new VpmError('vpmProjectInvalid', { field: 'projectKey' })
    if (project.running && !input.allowUnityRunning) {
      throw new VpmError('vpmUnityRunning', { kind: 'backup' })
    }

    const id = ulid()
    const createdAt = this.now()
    const lease = this.acquire(project.path, 'backup')
    const options = {
      compression: input.compression ?? 'normal',
      excludeVpmPackages: input.excludeVpmPackages === true
    }
    this.insert({
      id,
      projectKey: input.projectKey,
      projectName: project.name,
      sourcePath: project.path,
      filePath: input.targetPath ?? this.defaultTarget(project.name, project.path),
      status: 'running',
      createdAt,
      optionsJson: JSON.stringify(options)
    })

    try {
      const collect = await collectProjectFiles({
        root: project.path,
        mode: 'backup',
        excludeVpmPackages: options.excludeVpmPackages,
        ...(input.signal ? { signal: input.signal } : {}),
        onProgress: (progress) =>
          input.onProgress?.({ phase: 'collect', files: progress.files, bytes: progress.bytes })
      })
      if (collect.truncated) throw new VpmError('vpmBackupTooLarge', { limit: 'files' })

      const target = input.targetPath ?? this.defaultTarget(project.name, project.path)
      const written = await writeZip({
        entries: collect.files.map((file) => ({
          absolutePath: file.absolutePath,
          relativePath: file.relativePath,
          size: file.size
        })),
        target,
        compression: options.compression,
        emptyDirectories: ['Assets/'],
        ...(input.signal ? { signal: input.signal } : {}),
        onProgress: (progress) =>
          input.onProgress?.({ phase: 'zip', files: progress.files, bytes: progress.bytesWritten })
      })

      const digest = await hashFile(written.path)
      // 写完必须能读：读不了就当失败，不留"看起来成功"的包。
      await readZipEntries(written.path)

      this.update(id, {
        status: 'ok',
        filePath: written.path,
        size: digest.size,
        sha256: digest.sha256,
        unityVersion: project.unityVersion ?? null,
        packageCount: collect.fileCount,
        finishedAt: this.now()
      })
      return this.require(id)
    } catch (error) {
      const aborted = input.signal?.aborted === true || (error as { code?: string }).code === 'vpmBackupCancelled'
      this.update(id, {
        status: aborted ? 'cancelled' : 'failed',
        errorCode: (error as { code?: string }).code ?? 'vpmBackupFailed',
        finishedAt: this.now()
      })
      throw error
    } finally {
      lease?.release()
    }
  }

  list(projectKey?: string, limit = 20): BackupRecord[] {
    const rows = projectKey
      ? (this.db
          .prepare('SELECT * FROM vpm_backup WHERE project_key = ? ORDER BY created_at DESC LIMIT ?')
          .all(projectKey, clamp(limit)) as DbRow[])
      : (this.db
          .prepare('SELECT * FROM vpm_backup ORDER BY created_at DESC LIMIT ?')
          .all(clamp(limit)) as DbRow[])
    return rows.map(mapRow)
  }

  get(id: string): BackupRecord | null {
    const row = this.db.prepare('SELECT * FROM vpm_backup WHERE id = ?').get(id) as DbRow | undefined
    return row ? mapRow(row) : null
  }

  /** 打开备份所在位置（由组合根注入 shell.showItemInFolder）。 */
  reveal(id: string): boolean {
    const record = this.get(id)
    if (!record || !this.deps.revealPath) return false
    try {
      this.deps.revealPath(record.filePath)
      return true
    } catch {
      return false
    }
  }

  async restore(input: RestoreBackupInput): Promise<RestoreBackupResult> {
    const record = this.get(input.backupId)
    if (!record || record.status !== 'ok') throw new VpmError('vpmBackupInvalid', { field: 'id' })
    const target = path.resolve(input.targetDir)
    if (fs.existsSync(target)) throw new VpmError('vpmBackupConflict', { path: target })

    fs.mkdirSync(target, { recursive: true })
    const extracted = await extractZip({
      file: record.filePath,
      targetDir: target,
      ...(input.signal ? { signal: input.signal } : {}),
      ...(this.deps.maxBytes ? { maxBytes: this.deps.maxBytes } : {})
    })

    this.deps.projects.addExisting(target)
    let installed: RestoreBackupResult['installed'] = 'none'
    if (input.installPackages && this.deps.installer) {
      installed = await this.deps.installer(target)
    }
    return {
      projectPath: target,
      projectKey: record.projectKey,
      files: extracted.files,
      installed
    }
  }

  private acquire(projectPath: string, kind: MaintenanceKind) {
    if (!this.deps.activity) return null
    return this.deps.activity.acquireMaintenance(projectPath, kind)
  }

  private defaultTarget(projectName: string, projectPath: string): string {
    const slug = projectSlugOf(projectPath)
    const dir = path.join(this.deps.dataRoot, 'backups', slug)
    const stem = `${sanitizeFileStem(projectName)}-${stamp(this.now())}`
    let candidate = path.join(dir, `${stem}.zip`)
    let index = 2
    while (fs.existsSync(candidate)) {
      candidate = path.join(dir, `${stem}-${index}.zip`)
      index++
    }
    return candidate
  }

  private insert(input: {
    id: string
    projectKey: string
    projectName: string
    sourcePath: string
    filePath: string
    status: BackupStatus
    createdAt: number
    optionsJson: string
  }): void {
    this.db
      .prepare(
        `INSERT INTO vpm_backup
           (id, project_key, project_name, source_path, file_path, status, created_at, options_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        input.id,
        input.projectKey,
        input.projectName,
        input.sourcePath,
        input.filePath,
        input.status,
        input.createdAt,
        input.optionsJson
      )
  }

  private update(
    id: string,
    patch: {
      status?: BackupStatus
      filePath?: string
      size?: number
      sha256?: string
      unityVersion?: string | null
      packageCount?: number
      finishedAt?: number
      errorCode?: string
    }
  ): void {
    const sets: string[] = []
    const values: unknown[] = []
    if (patch.status !== undefined) {
      sets.push('status = ?')
      values.push(patch.status)
    }
    if (patch.filePath !== undefined) {
      sets.push('file_path = ?')
      values.push(patch.filePath)
    }
    if (patch.size !== undefined) {
      sets.push('size = ?')
      values.push(patch.size)
    }
    if (patch.sha256 !== undefined) {
      sets.push('sha256 = ?')
      values.push(patch.sha256)
    }
    if (patch.unityVersion !== undefined) {
      sets.push('unity_version = ?')
      values.push(patch.unityVersion)
    }
    if (patch.packageCount !== undefined) {
      sets.push('package_count = ?')
      values.push(patch.packageCount)
    }
    if (patch.finishedAt !== undefined) {
      sets.push('finished_at = ?')
      values.push(patch.finishedAt)
    }
    if (patch.errorCode !== undefined) {
      sets.push('error_code = ?')
      values.push(patch.errorCode)
    }
    if (sets.length === 0) return
    values.push(id)
    this.db.prepare(`UPDATE vpm_backup SET ${sets.join(', ')} WHERE id = ?`).run(...values)
  }

  private require(id: string): BackupRecord {
    const record = this.get(id)
    if (!record) throw new VpmError('vpmBackupInvalid', { field: 'id' })
    return record
  }
}

function clamp(limit: number): number {
  if (!Number.isFinite(limit)) return 20
  return Math.max(1, Math.min(200, Math.trunc(limit)))
}
