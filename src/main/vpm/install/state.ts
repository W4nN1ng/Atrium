import fs from 'node:fs'
import path from 'node:path'
import { isValidUlid, ulid } from '../../../shared/ulid'
import { sha256Hex } from '../../../shared/vpm/domain/hash'
import { projectKeyOf } from '../../../shared/vpm/domain/project'
import { isVpmErrorCode, VpmError, type VpmErrorCode } from '../../../shared/vpm/errors'
import type { VpmDb } from '../db'
import {
  MANIFEST_RELATIVE_PATH,
  OperationJournalStore,
  normalizeRelativePath
} from './journal'
import {
  ACTIVE_OPERATION_STATUSES,
  FILE_ACTIONS,
  FILE_STATES,
  OPERATION_KINDS,
  OPERATION_STATUSES,
  STEP_STATUSES,
  type BeginStepInput,
  type BeginStepResult,
  type CreateOperationInput,
  type FileAction,
  type FileState,
  type JournalEventType,
  type JournalDetailValue,
  type OperationFileInput,
  type OperationFileRecord,
  type OperationJournalSnapshot,
  type OperationKind,
  type OperationRecord,
  type OperationStatus,
  type OperationStepRecord,
  type StepStatus,
  type TransitionOptions
} from './types'

const MAX_PLAN_JSON = 2 * 1024 * 1024
const MAX_SUMMARY_JSON = 64 * 1024
const MAX_STEP_DETAIL_JSON = 64 * 1024
const MAX_ERROR_DETAIL = 2_000
const MAX_FINGERPRINT = 256
const MAX_VAULT_PATH = 4096
const MAX_LEGACY_PATHS = 20_000
const HASH = /^[a-f0-9]{64}$/
const STEP_ID = /^[a-z][a-z0-9_.-]{0,127}$/

/**
 * 合法迁移表。
 *
 * `planned/preflight → needs_attention` 只为恢复扫描保留：实际操作流程里
 * planned/preflight 失败应走 `failed`。`needs_attention` 只能由人工/恢复
 * 推进到 committed/failed/rolled_back，不能回到 applying。
 */
const TRANSITIONS: Readonly<Record<OperationStatus, readonly OperationStatus[]>> = {
  planned: ['preflight', 'failed', 'needs_attention'],
  preflight: ['applying', 'failed', 'needs_attention'],
  applying: ['committed', 'failed', 'rolled_back', 'needs_attention'],
  committed: [],
  failed: [],
  rolled_back: [],
  needs_attention: ['committed', 'failed', 'rolled_back']
}

interface OperationDbRow {
  id: string
  project_key: string
  project_path: string
  kind: string
  status: string
  plan_json: string
  plan_hash: string
  project_fingerprint: string | null
  manifest_before_hash: string | null
  manifest_after_hash: string | null
  summary_json: string | null
  error_code: string | null
  error_detail: string | null
  vault_pending: number
  created_at: number
  started_at: number | null
  finished_at: number | null
}

interface StepDbRow {
  op_id: string
  step: string
  seq: number
  status: string
  attempts: number
  detail_json: string | null
  started_at: number | null
  finished_at: number | null
}

interface FileDbRow {
  op_id: string
  path: string
  action: string
  vault_path: string | null
  sha256: string | null
  size: number | null
  state: string
}

interface JournalEventInput {
  key: string
  type: JournalEventType
  detail?: Record<string, JournalDetailValue>
}

function operationError(field: string, cause?: unknown): VpmError {
  return new VpmError('vpmOperationInvalid', { field }, cause)
}

function projectInvalid(cause?: unknown): VpmError {
  return new VpmError('vpmProjectInvalid', { field: 'path' }, cause)
}

function resolveProject(projectPath: unknown): { path: string; key: string } {
  if (
    typeof projectPath !== 'string' ||
    !path.isAbsolute(projectPath) ||
    projectPath.includes('\0')
  ) {
    throw projectInvalid()
  }
  try {
    const real = fs.realpathSync.native(path.resolve(projectPath))
    if (!fs.statSync(real).isDirectory()) throw new Error('not a directory')
    return { path: real, key: projectKeyOf(real) }
  } catch (error) {
    throw projectInvalid(error)
  }
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], field: string): T {
  if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) {
    throw operationError(field)
  }
  return value as T
}

function hashValue(value: unknown, field: string, optional: boolean): string | null {
  if (value === null || value === undefined) {
    if (optional) return null
    throw operationError(field)
  }
  if (typeof value !== 'string') throw operationError(field)
  const normalized = value.trim().toLowerCase()
  if (!HASH.test(normalized)) throw operationError(field)
  return normalized
}

function optionalString(value: unknown, field: string, max: number): string | null {
  if (value === null || value === undefined) return null
  if (typeof value !== 'string') throw operationError(field)
  const normalized = value.trim()
  if (!normalized || normalized.length > max || normalized.includes('\0')) {
    throw operationError(field)
  }
  return normalized
}

function errorDetailValue(value: unknown): string | null {
  if (value === null || value === undefined) return null
  if (typeof value !== 'string') throw operationError('errorDetail')
  const normalized = value.trim()
  if (!normalized) return null
  if (normalized.length > MAX_ERROR_DETAIL || normalized.includes('\0')) {
    throw operationError('errorDetail')
  }
  return normalized
}

function jsonText(value: unknown, field: string, max: number): string {
  if (value === undefined) throw operationError(field)
  let text: string
  try {
    const serialized = JSON.stringify(value)
    if (typeof serialized !== 'string') throw new Error('not serializable')
    text = serialized
  } catch (error) {
    throw operationError(field, error)
  }
  if (text.length > max) throw operationError(field)
  return text
}

function optionalJsonText(value: unknown, field: string, max: number): string | null {
  if (value === undefined || value === null) return null
  return jsonText(value, field, max)
}

function normalizeStepId(value: unknown): string {
  if (typeof value !== 'string' || !STEP_ID.test(value)) throw operationError('step')
  return value
}

function normalizeSequence(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    throw operationError('seq')
  }
  return value
}

function normalizeFileAction(value: unknown): FileAction {
  return oneOf<FileAction>(value, FILE_ACTIONS, 'action')
}

function normalizeFileState(value: unknown): FileState {
  return oneOf<FileState>(value, FILE_STATES, 'state')
}

function normalizeFilePath(value: unknown): string {
  try {
    return normalizeRelativePath(value)
  } catch {
    throw operationError('path')
  }
}

function normalizeVaultPath(value: unknown): string | null {
  if (value === null || value === undefined) return null
  if (typeof value !== 'string') throw operationError('vaultPath')
  const normalized = value.trim()
  if (!normalized || normalized.length > MAX_VAULT_PATH || normalized.includes('\0')) {
    throw operationError('vaultPath')
  }
  if (path.isAbsolute(normalized) || /^[A-Za-z]:[\\/]/.test(normalized)) return normalized
  try {
    return normalizeRelativePath(normalized, MAX_VAULT_PATH)
  } catch {
    throw operationError('vaultPath')
  }
}

function normalizeSize(value: unknown): number | null {
  if (value === null || value === undefined) return null
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw operationError('size')
  }
  return value
}

function statusOf(value: string): OperationStatus {
  return oneOf<OperationStatus>(value, OPERATION_STATUSES, 'status')
}

function kindOf(value: string): OperationKind {
  return oneOf<OperationKind>(value, OPERATION_KINDS, 'kind')
}

function stepStatusOf(value: string): StepStatus {
  return oneOf<StepStatus>(value, STEP_STATUSES, 'stepStatus')
}

function mapStep(row: StepDbRow): OperationStepRecord {
  return {
    opId: row.op_id,
    step: row.step,
    seq: Number(row.seq),
    status: stepStatusOf(row.status),
    attempts: Number(row.attempts),
    detailJson: row.detail_json,
    startedAt: row.started_at === null ? null : Number(row.started_at),
    finishedAt: row.finished_at === null ? null : Number(row.finished_at)
  }
}

function mapFile(row: FileDbRow): OperationFileRecord {
  return {
    opId: row.op_id,
    path: row.path,
    action: normalizeFileAction(row.action),
    vaultPath: row.vault_path,
    sha256: row.sha256,
    size: row.size === null ? null : Number(row.size),
    state: normalizeFileState(row.state)
  }
}

function mapOperation(
  row: OperationDbRow,
  steps: OperationStepRecord[],
  files: OperationFileRecord[]
): OperationRecord {
  const errorCode =
    row.error_code && isVpmErrorCode(row.error_code) ? row.error_code : null
  return {
    id: row.id,
    projectKey: row.project_key,
    projectPath: row.project_path,
    kind: kindOf(row.kind),
    status: statusOf(row.status),
    planJson: row.plan_json,
    planHash: row.plan_hash,
    projectFingerprint: row.project_fingerprint,
    manifestBeforeHash: row.manifest_before_hash,
    manifestAfterHash: row.manifest_after_hash,
    summaryJson: row.summary_json,
    errorCode,
    errorDetail: row.error_detail,
    vaultPending: row.vault_pending === 1,
    createdAt: Number(row.created_at),
    startedAt: row.started_at === null ? null : Number(row.started_at),
    finishedAt: row.finished_at === null ? null : Number(row.finished_at),
    steps,
    files
  }
}

function stepJournalKey(opId: string, step: OperationStepRecord): string {
  return `step:${opId}:${step.seq}:${step.step}`
}

function moveJournalKey(pathValue: string, action: FileAction): string {
  return `file:${sha256Hex(`${pathValue}\0${action}`).slice(0, 24)}`
}

function toJournalStep(opId: string, step: OperationStepRecord): OperationJournalSnapshot['steps'][number] {
  return {
    key: stepJournalKey(opId, step),
    step: step.step,
    seq: step.seq,
    status: step.status,
    attempts: step.attempts,
    startedAt: step.startedAt,
    finishedAt: step.finishedAt
  }
}

function toJournalMove(file: OperationFileRecord): OperationJournalSnapshot['moves'][number] {
  return {
    path: file.path,
    action: file.action,
    state: file.state,
    vaultPath: file.vaultPath,
    sha256: file.sha256,
    size: file.size
  }
}

function isConstraint(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const code = (error as { code?: unknown }).code
  return typeof code === 'string' && code.startsWith('SQLITE_CONSTRAINT')
}

/**
 * `vpm_operation` / `vpm_operation_step` / `vpm_operation_file` 的唯一 SQL 入口。
 *
 * 这里是 P4-A 的合同例外：操作状态机必须和 journal 双写在同一事务里，
 * 所以 SQL 留在 install/state.ts，而不是拆到 db/。表结构仍由 db/ 迁移拥有。
 */
export class OperationStore {
  constructor(
    private readonly db: VpmDb,
    private readonly now: () => number = Date.now,
    private readonly journals: OperationJournalStore = new OperationJournalStore()
  ) {}

  get(id: string): OperationRecord | null {
    const row = this.db.prepare('SELECT * FROM vpm_operation WHERE id = ?').get(id) as
      | OperationDbRow
      | undefined
    if (!row) return null
    return mapOperation(row, this.steps(id), this.files(id))
  }

  findActive(projectKey: string): OperationRecord | null {
    const row = this.db
      .prepare(
        `SELECT * FROM vpm_operation
         WHERE project_key = ? AND status IN (${this.activePlaceholders()})
         ORDER BY created_at DESC, id DESC LIMIT 1`
      )
      .get(projectKey, ...ACTIVE_OPERATION_STATUSES) as OperationDbRow | undefined
    return row ? mapOperation(row, this.steps(row.id), this.files(row.id)) : null
  }

  /** 现场未恢复前不允许在同一工程开新操作；P4-C 的写入口必须尊重这个结果。 */
  findUnresolved(projectKey: string): OperationRecord | null {
    const row = this.db
      .prepare(
        `SELECT * FROM vpm_operation
         WHERE project_key = ? AND status = 'needs_attention'
         ORDER BY created_at DESC, id DESC LIMIT 1`
      )
      .get(projectKey) as OperationDbRow | undefined
    return row ? mapOperation(row, this.steps(row.id), this.files(row.id)) : null
  }

  listActive(): OperationRecord[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM vpm_operation
         WHERE status IN (${this.activePlaceholders()})
         ORDER BY created_at ASC, id ASC`
      )
      .all(...ACTIVE_OPERATION_STATUSES) as OperationDbRow[]
    return rows.map((row) => mapOperation(row, this.steps(row.id), this.files(row.id)))
  }

  list(projectKey: string, limit = 20): OperationRecord[] {
    const count =
      Number.isFinite(limit) && limit > 0 ? Math.min(200, Math.trunc(limit)) : 20
    const rows = this.db
      .prepare(
        `SELECT * FROM vpm_operation
         WHERE project_key = ?
         ORDER BY created_at DESC, id DESC LIMIT ?`
      )
      .all(projectKey, count) as OperationDbRow[]
    return rows.map((row) => mapOperation(row, this.steps(row.id), this.files(row.id)))
  }

  create(input: CreateOperationInput): OperationRecord {
    const project = resolveProject(input.projectPath)
    if (input.projectKey !== project.key) {
      throw new VpmError('vpmProjectInvalid', { field: 'projectKey' })
    }
    const id = input.id === undefined ? ulid() : input.id
    if (!isValidUlid(id)) throw operationError('id')
    const kind = oneOf<OperationKind>(input.kind, OPERATION_KINDS, 'kind')
    const planHash = hashValue(input.planHash, 'planHash', false) as string
    const planJson = jsonText(input.plan, 'plan', MAX_PLAN_JSON)
    const summaryJson = optionalJsonText(input.summary, 'summary', MAX_SUMMARY_JSON)
    const projectFingerprint = optionalString(
      input.projectFingerprint,
      'projectFingerprint',
      MAX_FINGERPRINT
    )
    const beforeHash = hashValue(input.manifestBeforeHash, 'manifestBeforeHash', true)
    const afterHash = hashValue(input.manifestAfterHash, 'manifestAfterHash', true)
    const at = this.now()

    const initial: OperationRecord = {
      id,
      projectKey: project.key,
      projectPath: project.path,
      kind,
      status: 'planned',
      planJson,
      planHash,
      projectFingerprint,
      manifestBeforeHash: beforeHash,
      manifestAfterHash: afterHash,
      summaryJson,
      errorCode: null,
      errorDetail: null,
      vaultPending: false,
      createdAt: at,
      startedAt: null,
      finishedAt: null,
      steps: [],
      files: []
    }
    const journal: OperationJournalSnapshot = {
      schemaVersion: 1,
      opId: id,
      projectKey: project.key,
      kind,
      phase: 'planned',
      commitPoint: 'before',
      planHash,
      projectFingerprint,
      manifest: {
        relativePath: MANIFEST_RELATIVE_PATH,
        beforeHash,
        afterHash
      },
      steps: [],
      moves: [],
      legacyPaths: [],
      vaultPending: false,
      createdAt: at,
      updatedAt: at,
      events: [
        {
          at,
          key: `op:${id}:created`,
          type: 'operation_created',
          detail: { kind }
        }
      ]
    }

    const write = this.db.transaction(() => {
      const active = this.findActive(project.key)
      if (active) throw new VpmError('vpmProjectBusy', { operationId: active.id })
      const unresolved = this.findUnresolved(project.key)
      if (unresolved) {
        throw new VpmError('vpmRecoveryRequired', { operationId: unresolved.id })
      }
      if (this.get(id)) throw operationError('id')
      try {
        this.db
          .prepare(
            `INSERT INTO vpm_operation
              (id, project_key, project_path, kind, status, plan_json, plan_hash,
               project_fingerprint, manifest_before_hash, manifest_after_hash,
               summary_json, error_code, error_detail, vault_pending,
               created_at, started_at, finished_at)
             VALUES
              (@id, @projectKey, @projectPath, @kind, 'planned', @planJson, @planHash,
               @fingerprint, @beforeHash, @afterHash,
               @summaryJson, NULL, NULL, 0,
               @createdAt, NULL, NULL)`
          )
          .run({
            id,
            projectKey: project.key,
            projectPath: project.path,
            kind,
            planJson,
            planHash,
            fingerprint: projectFingerprint,
            beforeHash,
            afterHash,
            summaryJson,
            createdAt: at
          })
      } catch (error) {
        if (isConstraint(error)) {
          const conflict = this.findActive(project.key)
          if (conflict) throw new VpmError('vpmProjectBusy', { operationId: conflict.id })
          throw operationError('id', error)
        }
        throw error
      }
      this.journals.create(project.path, journal)
    })
    write()
    const saved = this.get(id)
    if (!saved) throw operationError('id')
    return saved
  }

  transition(id: string, to: OperationStatus, options: TransitionOptions = {}): OperationRecord {
    const target = oneOf<OperationStatus>(to, OPERATION_STATUSES, 'status')
    const current = this.get(id)
    if (!current) throw new VpmError('vpmOperationNotFound', { operationId: id })
    if (current.status === target) return current
    if (!TRANSITIONS[current.status].includes(target)) {
      throw new VpmError('vpmOperationInvalid', {
        from: current.status,
        to: target
      })
    }

    let errorCode: VpmErrorCode | null
    if (options.errorCode === undefined) {
      errorCode = target === 'committed' ? null : current.errorCode
    } else if (options.errorCode === null) {
      errorCode = null
    } else if (isVpmErrorCode(options.errorCode)) {
      errorCode = options.errorCode
    } else {
      throw operationError('errorCode')
    }
    let errorDetail: string | null
    if (options.errorDetail === undefined) {
      errorDetail = target === 'committed' ? null : current.errorDetail
    } else {
      errorDetail = errorDetailValue(options.errorDetail)
    }

    const writeJournal = options.journal !== false
    if (writeJournal && !this.journals.exists(current.projectPath, current.id)) {
      throw new VpmError('vpmJournalInvalid')
    }
    if (target === 'committed' || target === 'failed' || target === 'rolled_back') {
      const journal = this.journals.read(current.projectPath, current.id)
      if (target === 'committed' && journal.commitPoint !== 'manifest_written') {
        throw operationError('commitPoint')
      }
      if (target !== 'committed' && journal.commitPoint === 'manifest_written') {
        // manifest 已经提交后只能补完/归档，不能假装回滚或失败。
        throw operationError('commitPoint')
      }
    }

    const at = this.now()
    const startedAt =
      current.startedAt ??
      (target === 'preflight' || target === 'applying' ? at : null)
    const finishedAt =
      target === 'committed' || target === 'failed' || target === 'rolled_back'
        ? at
        : current.finishedAt

    const write = this.db.transaction(() => {
      this.db
        .prepare(
          `UPDATE vpm_operation
           SET status = @status, started_at = @startedAt, finished_at = @finishedAt,
               error_code = @errorCode, error_detail = @errorDetail
           WHERE id = @id`
        )
        .run({
          id,
          status: target,
          startedAt,
          finishedAt,
          errorCode,
          errorDetail
        })
      if (writeJournal) {
        this.writeJournalFor(
          this.require(id),
          {
            key: `op:${id}:status:${target}`,
            type: 'operation_status',
            detail: { from: current.status, to: target }
          },
          at
        )
      }
    })
    write()
    return this.require(id)
  }

  beginStep(id: string, input: BeginStepInput): BeginStepResult {
    const op = this.require(id)
    if (!(ACTIVE_OPERATION_STATUSES as readonly string[]).includes(op.status)) {
      throw operationError('status')
    }
    const step = normalizeStepId(input.step)
    const seq = normalizeSequence(input.seq)
    const detailJson = optionalJsonText(input.detail, 'detail', MAX_STEP_DETAIL_JSON)

    const existing = this.getStep(id, step)
    if (existing) {
      if (existing.status === 'running' || existing.status === 'done') {
        return { step: existing, created: false }
      }
      throw operationError('stepStatus')
    }

    const running = this.db
      .prepare(
        "SELECT step FROM vpm_operation_step WHERE op_id = ? AND status = 'running' LIMIT 1"
      )
      .get(id) as { step: string } | undefined
    if (running) throw operationError('runningStep')

    const max = this.db
      .prepare('SELECT COALESCE(MAX(seq), 0) AS seq FROM vpm_operation_step WHERE op_id = ?')
      .get(id) as { seq: number }
    if (seq <= Number(max.seq)) throw operationError('seq')
    if (!this.journals.exists(op.projectPath, op.id)) {
      throw new VpmError('vpmJournalInvalid')
    }

    const at = this.now()
    const write = this.db.transaction(() => {
      try {
        this.db
          .prepare(
            `INSERT INTO vpm_operation_step
              (op_id, step, seq, status, attempts, detail_json, started_at, finished_at)
             VALUES (?, ?, ?, 'running', 1, ?, ?, NULL)`
          )
          .run(id, step, seq, detailJson, at)
      } catch (error) {
        if (isConstraint(error)) throw operationError('step', error)
        throw error
      }
      this.writeJournalFor(
        this.require(id),
        {
          key: `step:${id}:${seq}:${step}:started:1`,
          type: 'step_started',
          detail: { step, seq, attempt: 1 }
        },
        at
      )
    })
    write()
    const saved = this.getStep(id, step)
    if (!saved) throw operationError('step')
    return { step: saved, created: true }
  }

  finishStep(
    id: string,
    stepName: string,
    outcome: 'done' | 'failed',
    detail?: unknown
  ): OperationStepRecord {
    const step = normalizeStepId(stepName)
    if (outcome !== 'done' && outcome !== 'failed') throw operationError('outcome')
    const op = this.require(id)
    const existing = this.getStep(id, step)
    if (!existing) throw operationError('step')
    if (existing.status === outcome) return existing
    if (existing.status !== 'running') throw operationError('stepStatus')
    if (!this.journals.exists(op.projectPath, op.id)) {
      throw new VpmError('vpmJournalInvalid')
    }

    const detailJson =
      detail === undefined
        ? existing.detailJson
        : optionalJsonText(detail, 'detail', MAX_STEP_DETAIL_JSON)
    const at = this.now()
    const write = this.db.transaction(() => {
      const changed = this.db
        .prepare(
          `UPDATE vpm_operation_step
           SET status = ?, detail_json = ?, finished_at = ?
           WHERE op_id = ? AND step = ? AND status = 'running'`
        )
        .run(outcome, detailJson, at, id, step)
      if (changed.changes !== 1) throw operationError('stepStatus')
      this.writeJournalFor(
        this.require(id),
        {
          key: `step:${id}:${existing.seq}:${step}:${outcome}`,
          type: 'step_finished',
          detail: { step, seq: existing.seq, outcome }
        },
        at
      )
    })
    write()
    const saved = this.getStep(id, step)
    if (!saved) throw operationError('step')
    return saved
  }

  nextStepSequence(id: string): number {
    this.require(id)
    const max = this.db
      .prepare('SELECT COALESCE(MAX(seq), 0) AS seq FROM vpm_operation_step WHERE op_id = ?')
      .get(id) as { seq: number }
    return Number(max.seq) + 1
  }

  upsertFile(id: string, input: OperationFileInput): OperationFileRecord {
    const op = this.require(id)
    const pathValue = normalizeFilePath(input.path)
    const action = normalizeFileAction(input.action)
    const state = input.state === undefined ? 'pending' : normalizeFileState(input.state)
    if (action === 'legacy' && !pathValue.startsWith('Assets/')) {
      throw operationError('path')
    }
    const vaultPath = normalizeVaultPath(input.vaultPath)
    const sha256 = hashValue(input.sha256, 'sha256', true)
    const size = normalizeSize(input.size)

    const existing = this.getFile(id, pathValue, action)
    if (
      existing &&
      existing.state === state &&
      existing.vaultPath === vaultPath &&
      existing.sha256 === sha256 &&
      existing.size === size
    ) {
      return existing
    }
    if (!this.journals.exists(op.projectPath, op.id)) {
      throw new VpmError('vpmJournalInvalid')
    }

    const at = this.now()
    const write = this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO vpm_operation_file
            (op_id, path, action, vault_path, sha256, size, state)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(op_id, path, action) DO UPDATE SET
            vault_path = excluded.vault_path,
            sha256 = excluded.sha256,
            size = excluded.size,
            state = excluded.state`
        )
        .run(id, pathValue, action, vaultPath, sha256, size, state)
      this.writeJournalFor(
        this.require(id),
        {
          key: `${moveJournalKey(pathValue, action)}:${state}`,
          type: 'file_changed',
          detail: { path: pathValue, action, state }
        },
        at
      )
    })
    write()
    const saved = this.getFile(id, pathValue, action)
    if (!saved) throw operationError('path')
    return saved
  }

  setFileState(
    id: string,
    pathValue: string,
    action: FileAction,
    state: FileState
  ): OperationFileRecord {
    const normalizedPath = normalizeFilePath(pathValue)
    const normalizedAction = normalizeFileAction(action)
    const existing = this.getFile(id, normalizedPath, normalizedAction)
    if (!existing) throw operationError('file')
    return this.upsertFile(id, {
      path: existing.path,
      action: existing.action,
      vaultPath: existing.vaultPath,
      sha256: existing.sha256,
      size: existing.size,
      state: normalizeFileState(state)
    })
  }

  setManifestHashes(
    id: string,
    hashes: { beforeHash: string | null; afterHash: string | null }
  ): OperationRecord {
    const current = this.require(id)
    if (
      current.status === 'committed' ||
      current.status === 'failed' ||
      current.status === 'rolled_back'
    ) {
      throw operationError('status')
    }
    const beforeHash = hashValue(hashes?.beforeHash, 'manifestBeforeHash', true)
    const afterHash = hashValue(hashes?.afterHash, 'manifestAfterHash', true)
    if (current.manifestBeforeHash === beforeHash && current.manifestAfterHash === afterHash) {
      return current
    }
    if (!this.journals.exists(current.projectPath, current.id)) {
      throw new VpmError('vpmJournalInvalid')
    }
    if (this.journals.read(current.projectPath, current.id).commitPoint === 'manifest_written') {
      // 提交后 manifest 证据必须冻结；否则崩溃恢复无法证明当时写的是什么。
      throw operationError('commitPoint')
    }
    const at = this.now()
    const write = this.db.transaction(() => {
      this.db
        .prepare(
          `UPDATE vpm_operation
           SET manifest_before_hash = ?, manifest_after_hash = ?
           WHERE id = ?`
        )
        .run(beforeHash, afterHash, id)
      this.writeJournalFor(
        this.require(id),
        {
          key: `manifest:${id}:hashes:${sha256Hex(`${beforeHash ?? ''}\0${afterHash ?? ''}`).slice(0, 20)}`,
          type: 'manifest_hashes',
          detail: { before: beforeHash, after: afterHash }
        },
        at
      )
    })
    write()
    return this.require(id)
  }

  /**
   * 提交点由 manifest rename 成功后调用；journal 是唯一提交点证据。
   * 写之前要求 after hash 已存在，避免恢复时无法证明新 manifest 是什么。
   */
  markCommitPoint(id: string): OperationJournalSnapshot {
    const op = this.require(id)
    if (op.status !== 'applying' && op.status !== 'needs_attention' && op.status !== 'committed') {
      throw operationError('status')
    }
    if (!op.manifestAfterHash) throw operationError('manifestAfterHash')
    const current = this.journals.read(op.projectPath, op.id)
    if (current.kind !== op.kind || current.planHash !== op.planHash) {
      throw new VpmError('vpmJournalInvalid')
    }
    if (current.commitPoint === 'manifest_written') return current
    const at = Math.max(current.updatedAt, this.now())
    const next: OperationJournalSnapshot = {
      ...current,
      commitPoint: 'manifest_written',
      updatedAt: at,
      events: [
        ...current.events,
        {
          at,
          key: `manifest:${op.id}:committed`,
          type: 'commit_point',
          detail: { commitPoint: 'manifest_written' }
        }
      ]
    }
    this.journals.write(op.projectPath, next)
    return next
  }

  setLegacyPaths(id: string, paths: readonly string[]): OperationJournalSnapshot {
    const op = this.require(id)
    if (op.status === 'failed' || op.status === 'rolled_back') {
      throw operationError('status')
    }
    if (!Array.isArray(paths) || paths.length > MAX_LEGACY_PATHS) {
      throw operationError('legacyPaths')
    }
    const normalized = new Set<string>()
    for (const raw of paths) {
      let relative: string
      try {
        relative = normalizeRelativePath(raw)
      } catch {
        throw operationError('legacyPaths')
      }
      if (!relative.startsWith('Assets/')) throw operationError('legacyPaths')
      normalized.add(relative)
    }
    const nextPaths = [...normalized].sort()
    const current = this.journals.read(op.projectPath, op.id)
    if (
      current.legacyPaths.length === nextPaths.length &&
      current.legacyPaths.every((value, index) => value === nextPaths[index])
    ) {
      return current
    }
    const at = Math.max(current.updatedAt, this.now())
    const updated: OperationJournalSnapshot = {
      ...current,
      legacyPaths: nextPaths,
      updatedAt: at,
      events: [
        ...current.events,
        {
          at,
          key: `legacy:${op.id}:${sha256Hex(nextPaths.join('\n')).slice(0, 20)}`,
          type: 'legacy_paths',
          detail: { count: nextPaths.length }
        }
      ]
    }
    this.journals.write(op.projectPath, updated)
    return updated
  }

  setVaultPending(id: string, pending: boolean): OperationRecord {
    if (typeof pending !== 'boolean') throw operationError('vaultPending')
    const current = this.require(id)
    if (current.vaultPending === pending) return current
    if (!this.journals.exists(current.projectPath, current.id)) {
      throw new VpmError('vpmJournalInvalid')
    }
    const at = this.now()
    const write = this.db.transaction(() => {
      this.db
        .prepare('UPDATE vpm_operation SET vault_pending = ? WHERE id = ?')
        .run(pending ? 1 : 0, id)
      this.writeJournalFor(
        this.require(id),
        {
          key: `vault:${id}:${pending ? 1 : 0}`,
          type: 'vault_pending',
          detail: { pending }
        },
        at
      )
    })
    write()
    return this.require(id)
  }

  /** 读 journal 当前提交点；恢复/诊断用。 */
  commitPoint(id: string): 'before' | 'manifest_written' {
    const op = this.require(id)
    return this.journals.read(op.projectPath, op.id).commitPoint
  }

  private require(id: string): OperationRecord {
    const op = this.get(id)
    if (!op) throw new VpmError('vpmOperationNotFound', { operationId: id })
    return op
  }

  private steps(opId: string): OperationStepRecord[] {
    const rows = this.db
      .prepare('SELECT * FROM vpm_operation_step WHERE op_id = ? ORDER BY seq ASC')
      .all(opId) as StepDbRow[]
    return rows.map(mapStep)
  }

  private files(opId: string): OperationFileRecord[] {
    const rows = this.db
      .prepare(
        'SELECT * FROM vpm_operation_file WHERE op_id = ? ORDER BY path ASC, action ASC'
      )
      .all(opId) as FileDbRow[]
    return rows.map(mapFile)
  }

  private getStep(opId: string, step: string): OperationStepRecord | null {
    const row = this.db
      .prepare('SELECT * FROM vpm_operation_step WHERE op_id = ? AND step = ?')
      .get(opId, step) as StepDbRow | undefined
    return row ? mapStep(row) : null
  }

  private getFile(opId: string, pathValue: string, action: FileAction): OperationFileRecord | null {
    const row = this.db
      .prepare('SELECT * FROM vpm_operation_file WHERE op_id = ? AND path = ? AND action = ?')
      .get(opId, pathValue, action) as FileDbRow | undefined
    return row ? mapFile(row) : null
  }

  private activePlaceholders(): string {
    return ACTIVE_OPERATION_STATUSES.map(() => '?').join(', ')
  }

  private writeJournalFor(
    op: OperationRecord,
    event: JournalEventInput,
    at: number
  ): OperationJournalSnapshot {
    const current = this.journals.read(op.projectPath, op.id)
    if (
      current.kind !== op.kind ||
      current.planHash !== op.planHash ||
      current.manifest.relativePath !== MANIFEST_RELATIVE_PATH
    ) {
      throw new VpmError('vpmJournalInvalid')
    }
    const updatedAt = Math.max(current.updatedAt, at)
    const exists = current.events.some((item) => item.key === event.key)
    const next: OperationJournalSnapshot = {
      ...current,
      phase: op.status,
      projectFingerprint: op.projectFingerprint,
      manifest: {
        ...current.manifest,
        beforeHash: op.manifestBeforeHash,
        afterHash: op.manifestAfterHash
      },
      steps: op.steps.map((step) => toJournalStep(op.id, step)),
      moves: op.files.map(toJournalMove),
      vaultPending: op.vaultPending,
      updatedAt,
      events: exists
        ? current.events
        : [...current.events, { at: updatedAt, key: event.key, type: event.type, detail: event.detail ?? {} }]
    }
    this.journals.write(op.projectPath, next)
    return next
  }
}
