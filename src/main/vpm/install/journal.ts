import fs from 'node:fs'
import path from 'node:path'
import { isValidUlid, ulid } from '../../../shared/ulid'
import { projectKeyOf } from '../../../shared/vpm/domain/project'
import { isSameOrInside } from '../../../shared/vpm/dataRoot'
import { VpmError } from '../../../shared/vpm/errors'
import {
  COMMIT_POINTS,
  FILE_ACTIONS,
  FILE_STATES,
  JOURNAL_EVENT_TYPES,
  OPERATION_KINDS,
  OPERATION_STATUSES,
  STEP_STATUSES,
  type FileAction,
  type FileState,
  type JournalEvent,
  type JournalInspection,
  type JournalMove,
  type JournalStep,
  type OperationJournalSnapshot,
  type OperationKind,
  type OperationStatus,
  type StepStatus
} from './types'

export const TRANSACTION_DIR = '.atrium-tx'
export const JOURNAL_FILE = 'journal.json'
export const MANIFEST_RELATIVE_PATH = 'Packages/vpm-manifest.json'

const MAX_JOURNAL_BYTES = 8 * 1024 * 1024
const MAX_PATH_LENGTH = 1024
const MAX_VAULT_PATH_LENGTH = 4096
const MAX_EVENTS = 100_000
const MAX_STEPS = 2_000
const MAX_MOVES = 200_000
const MAX_LEGACY_PATHS = 20_000
const MAX_EVENT_DETAIL_ENTRIES = 32
const MAX_EVENT_DETAIL_TEXT = 1024

const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i
const HASH = /^[a-f0-9]{64}$/

function invalid(): never {
  throw new VpmError('vpmJournalInvalid')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function record(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) invalid()
  return value
}

function text(value: unknown, max: number): string {
  if (typeof value !== 'string') invalid()
  const normalized = value.trim()
  if (!normalized || normalized.length > max || normalized.includes('\0')) invalid()
  return normalized
}

function optionalText(value: unknown, max: number): string | null {
  if (value === null || value === undefined) return null
  return text(value, max)
}

function integer(value: unknown, min = 0): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min) invalid()
  return value
}

function optionalInteger(value: unknown, min = 0): number | null {
  if (value === null || value === undefined) return null
  return integer(value, min)
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T {
  if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) invalid()
  return value as T
}

function optionalHash(value: unknown): string | null {
  if (value === null || value === undefined) return null
  if (typeof value !== 'string') invalid()
  const normalized = value.trim().toLowerCase()
  if (!HASH.test(normalized)) invalid()
  return normalized
}

/** 工程内相对路径；拒绝盘符、UNC、`..`、ADS、控制字符、尾点/空格和 Windows 保留名。 */
export function normalizeRelativePath(value: unknown, max = MAX_PATH_LENGTH): string {
  if (typeof value !== 'string') invalid()
  const normalized = value.trim().replace(/\\/g, '/').replace(/\/+$/g, '')
  if (!normalized || normalized.length > max) invalid()
  if (normalized.startsWith('/') || normalized.startsWith('//') || /^[A-Za-z]:/.test(normalized)) {
    invalid()
  }
  if (/[\u0000-\u001f\u007f]/.test(normalized)) invalid()
  const parts = normalized.split('/')
  for (const part of parts) {
    if (!part || part === '.' || part === '..') invalid()
    if (part.includes(':') || /[. ]$/.test(part)) invalid()
    if (WINDOWS_RESERVED.test(part)) invalid()
  }
  return parts.join('/')
}

function opaquePath(value: unknown): string | null {
  if (value === null || value === undefined) return null
  if (typeof value !== 'string') invalid()
  const normalized = value.trim()
  if (!normalized || normalized.length > MAX_VAULT_PATH_LENGTH || normalized.includes('\0')) {
    invalid()
  }
  if (path.isAbsolute(normalized) || /^[A-Za-z]:[\\/]/.test(normalized)) return normalized
  return normalizeRelativePath(normalized, MAX_VAULT_PATH_LENGTH)
}

function canonicalProjectKey(value: unknown): string {
  const key = text(value, 1024)
  try {
    if (projectKeyOf(key) === key) return key
  } catch {
    /* 非法路径按 journal invalid 处理 */
  }
  invalid()
}

function normalizeOpId(value: unknown): string {
  if (typeof value !== 'string' || !isValidUlid(value)) invalid()
  return value
}

function tryRealProject(projectPath: unknown): string | null {
  if (
    typeof projectPath !== 'string' ||
    !path.isAbsolute(projectPath) ||
    projectPath.includes('\0')
  ) {
    return null
  }
  try {
    const real = fs.realpathSync.native(path.resolve(projectPath))
    return fs.statSync(real).isDirectory() ? real : null
  } catch {
    return null
  }
}

function realProject(projectPath: unknown): string {
  const real = tryRealProject(projectPath)
  if (!real) throw new VpmError('vpmProjectInvalid', { field: 'path' })
  return real
}

function assertInside(parent: string, candidate: string): void {
  if (candidate === parent || !isSameOrInside(parent, candidate, process.platform)) invalid()
}

function lstatOrNull(file: string): fs.Stats | null {
  try {
    return fs.lstatSync(file)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    invalid()
  }
}

function ensureTransactionRoot(projectReal: string): string {
  const tx = path.join(projectReal, TRANSACTION_DIR)
  const stat = lstatOrNull(tx)
  if (stat) {
    if (stat.isSymbolicLink() || !stat.isDirectory()) invalid()
  } else {
    try {
      fs.mkdirSync(tx)
    } catch (error) {
      throw new VpmError('vpmJournalWriteFailed', undefined, error)
    }
  }
  let real: string
  try {
    real = fs.realpathSync.native(tx)
  } catch (error) {
    throw new VpmError('vpmJournalWriteFailed', undefined, error)
  }
  assertInside(projectReal, real)
  return real
}

function transactionRootForRead(projectReal: string): string | null {
  const tx = path.join(projectReal, TRANSACTION_DIR)
  const stat = lstatOrNull(tx)
  if (!stat) return null
  if (stat.isSymbolicLink() || !stat.isDirectory()) invalid()
  let real: string
  try {
    real = fs.realpathSync.native(tx)
  } catch {
    invalid()
  }
  assertInside(projectReal, real)
  return real
}

function operationDirForRead(txRoot: string, opId: string): string | null {
  const dir = path.join(txRoot, opId)
  const stat = lstatOrNull(dir)
  if (!stat) return null
  if (stat.isSymbolicLink() || !stat.isDirectory()) invalid()
  let real: string
  try {
    real = fs.realpathSync.native(dir)
  } catch {
    invalid()
  }
  assertInside(txRoot, real)
  return real
}

function writeAtomic(file: string, contents: string): void {
  const dir = path.dirname(file)
  const size = Buffer.byteLength(contents, 'utf8')
  if (size > MAX_JOURNAL_BYTES) throw new VpmError('vpmJournalWriteFailed')
  const temp = path.join(dir, `.${JOURNAL_FILE}.${ulid()}.tmp`)
  let fd: number | null = null
  try {
    fd = fs.openSync(temp, 'wx', 0o600)
    fs.writeFileSync(fd, contents, 'utf8')
    fs.fsyncSync(fd)
    fs.closeSync(fd)
    fd = null
    fs.renameSync(temp, file)
  } catch (error) {
    if (fd !== null) {
      try {
        fs.closeSync(fd)
      } catch {
        /* 已关闭 */
      }
    }
    try {
      fs.unlinkSync(temp)
    } catch {
      /* 临时文件没写成或已 rename */
    }
    throw new VpmError('vpmJournalWriteFailed', undefined, error)
  }
  try {
    const dirFd = fs.openSync(dir, 'r')
    try {
      fs.fsyncSync(dirFd)
    } finally {
      fs.closeSync(dirFd)
    }
  } catch {
    /* Windows 不保证目录 fsync；文件本身已经 fsync + rename */
  }
}

function validateDetail(value: unknown): Record<string, string | number | boolean | null> {
  if (value === undefined || value === null) return {}
  const input = record(value)
  const entries = Object.entries(input)
  if (entries.length > MAX_EVENT_DETAIL_ENTRIES) invalid()
  const detail: Record<string, string | number | boolean | null> = {}
  for (const [key, raw] of entries) {
    if (!key || key.length > 64) invalid()
    if (raw === null || typeof raw === 'boolean') detail[key] = raw
    else if (typeof raw === 'number') {
      if (!Number.isFinite(raw)) invalid()
      detail[key] = raw
    } else if (typeof raw === 'string') {
      if (raw.length > MAX_EVENT_DETAIL_TEXT || raw.includes('\0')) invalid()
      detail[key] = raw
    } else {
      invalid()
    }
  }
  return detail
}

function validateStep(value: unknown): JournalStep {
  const input = record(value)
  const seq = integer(input.seq, 1)
  const status = oneOf<StepStatus>(input.status, STEP_STATUSES)
  const startedAt = optionalInteger(input.startedAt)
  const finishedAt = optionalInteger(input.finishedAt)
  if (startedAt === null) invalid()
  if (status === 'running' && finishedAt !== null) invalid()
  if (status !== 'running' && finishedAt === null) invalid()
  const step = text(input.step, 128)
  return {
    key: text(input.key, 300),
    step,
    seq,
    status,
    attempts: integer(input.attempts, 1),
    startedAt,
    finishedAt
  }
}

function validateMove(value: unknown): JournalMove {
  const input = record(value)
  return {
    path: normalizeRelativePath(input.path),
    action: oneOf<FileAction>(input.action, FILE_ACTIONS),
    state: oneOf<FileState>(input.state, FILE_STATES),
    vaultPath: opaquePath(input.vaultPath),
    sha256: optionalHash(input.sha256),
    size: optionalInteger(input.size)
  }
}

function validateEvent(value: unknown): JournalEvent {
  const input = record(value)
  return {
    at: integer(input.at),
    key: text(input.key, 300),
    type: oneOf(input.type, JOURNAL_EVENT_TYPES),
    detail: validateDetail(input.detail)
  }
}

function validateLegacyPath(value: unknown): string {
  const relative = normalizeRelativePath(value)
  if (!relative.startsWith('Assets/') || relative === 'Assets') invalid()
  return relative
}

/**
 * 把磁盘上的 JSON 归一成已知字段；任何可疑结构都按 journal invalid 处理。
 * 未知字段会被丢弃，不直接回传。
 */
export function validateJournalSnapshot(value: unknown): OperationJournalSnapshot {
  const input = record(value)
  if (input.schemaVersion !== 1) invalid()
  const opId = normalizeOpId(input.opId)
  const projectKey = canonicalProjectKey(input.projectKey)
  const kind = oneOf<OperationKind>(input.kind, OPERATION_KINDS)
  const phase = oneOf<OperationStatus>(input.phase, OPERATION_STATUSES)
  const commitPoint = oneOf(input.commitPoint, COMMIT_POINTS)
  if (phase === 'committed' && commitPoint !== 'manifest_written') invalid()
  const planHash = optionalHash(input.planHash)
  if (!planHash) invalid()
  const manifestInput = record(input.manifest)
  const relativePath = normalizeRelativePath(manifestInput.relativePath)
  if (relativePath !== MANIFEST_RELATIVE_PATH) invalid()

  if (!Array.isArray(input.steps) || input.steps.length > MAX_STEPS) invalid()
  const steps = input.steps.map((item) => validateStep(item))
  const stepKeys = new Set<string>()
  let lastSeq = 0
  for (const step of steps) {
    if (stepKeys.has(step.key)) invalid()
    stepKeys.add(step.key)
    if (step.seq <= lastSeq) invalid()
    lastSeq = step.seq
  }

  if (!Array.isArray(input.moves) || input.moves.length > MAX_MOVES) invalid()
  const moves = input.moves.map(validateMove)
  const moveKeys = new Set<string>()
  for (const move of moves) {
    const key = `${move.path}\0${move.action}`
    if (moveKeys.has(key)) invalid()
    moveKeys.add(key)
  }

  if (!Array.isArray(input.legacyPaths) || input.legacyPaths.length > MAX_LEGACY_PATHS) {
    invalid()
  }
  const legacyPaths = input.legacyPaths.map(validateLegacyPath)
  if (new Set(legacyPaths).size !== legacyPaths.length) invalid()

  if (!Array.isArray(input.events) || input.events.length < 1 || input.events.length > MAX_EVENTS) {
    invalid()
  }
  const events = input.events.map(validateEvent)
  const eventKeys = new Set<string>()
  let lastAt = 0
  for (const event of events) {
    if (eventKeys.has(event.key)) invalid()
    eventKeys.add(event.key)
    if (event.at < lastAt) invalid()
    lastAt = event.at
  }
  if (events[0].type !== 'operation_created') invalid()

  const createdAt = integer(input.createdAt)
  const updatedAt = integer(input.updatedAt)
  if (updatedAt < createdAt || lastAt > updatedAt) invalid()
  if (typeof input.vaultPending !== 'boolean') invalid()

  return {
    schemaVersion: 1,
    opId,
    projectKey,
    kind,
    phase,
    commitPoint,
    planHash,
    projectFingerprint: optionalText(input.projectFingerprint, 256),
    manifest: {
      relativePath,
      beforeHash: optionalHash(manifestInput.beforeHash),
      afterHash: optionalHash(manifestInput.afterHash)
    },
    steps,
    moves,
    legacyPaths,
    vaultPending: input.vaultPending,
    createdAt,
    updatedAt,
    events
  }
}

/**
 * `.atrium-tx/<op>` 的目录布局。
 *
 * 事务区必须和 `Packages/` 同卷，才能用 rename 原子移动；
 * 这里只做路径派生与安全检查，是否创建由 `ensureTransactionLayout()` 决定。
 */
export interface TransactionLayout {
  /** `.atrium-tx/<op>` 的真实路径。 */
  root: string
  /** 解压后的新包暂存区。 */
  install: string
  /** 旧包/旧 Assets 的临时停放区。 */
  trash: string
  trashPackages: string
  trashLegacy: string
  /** 回滚时把新包移出的地方（不删除）。 */
  rolledback: string
  /** 变更前的 manifest 副本。 */
  manifestOriginal: string
  /** 新 manifest 的暂存文件；rename 到 Packages/ 就是提交点。 */
  manifestNew: string
  journal: string
}

function layoutOf(root: string): TransactionLayout {
  const install = path.join(root, 'install')
  const trash = path.join(root, 'trash')
  return {
    root,
    install,
    trash,
    trashPackages: path.join(trash, 'packages'),
    trashLegacy: path.join(trash, 'legacy'),
    rolledback: path.join(root, 'rolledback'),
    manifestOriginal: path.join(root, 'manifest.original.json'),
    manifestNew: path.join(root, 'vpm-manifest.new.json'),
    journal: path.join(root, JOURNAL_FILE)
  }
}

/** 只算路径，不建目录；工程/opId 不合法直接拒绝。 */
export function transactionLayout(projectPath: string, opId: string): TransactionLayout {
  const real = realProject(projectPath)
  const id = normalizeOpId(opId)
  const tx = path.join(real, TRANSACTION_DIR)
  const root = path.join(tx, id)
  assertInside(real, root)
  assertInside(tx, root)
  return layoutOf(root)
}

/** 建好 install/trash/rolledback 子目录；已存在时只校验类型，不覆盖内容。 */
export function ensureTransactionLayout(projectPath: string, opId: string): TransactionLayout {
  const real = realProject(projectPath)
  const id = normalizeOpId(opId)
  const tx = ensureTransactionRoot(real)
  const root = path.join(tx, id)
  const stat = lstatOrNull(root)
  if (stat) {
    if (stat.isSymbolicLink() || !stat.isDirectory()) invalid()
  } else {
    try {
      fs.mkdirSync(root)
    } catch (error) {
      throw new VpmError('vpmJournalWriteFailed', undefined, error)
    }
  }
  let rootReal: string
  try {
    rootReal = fs.realpathSync.native(root)
  } catch (error) {
    throw new VpmError('vpmJournalWriteFailed', undefined, error)
  }
  assertInside(tx, rootReal)

  const layout = layoutOf(rootReal)
  for (const dir of [layout.install, layout.trashPackages, layout.trashLegacy, layout.rolledback]) {
    try {
      fs.mkdirSync(dir, { recursive: true })
      const dirReal = fs.realpathSync.native(dir)
      if (dirReal === rootReal) invalid()
      if (!isSameOrInside(rootReal, dirReal, process.platform)) invalid()
    } catch (error) {
      if (error instanceof VpmError) throw error
      throw new VpmError('vpmJournalWriteFailed', undefined, error)
    }
  }
  return layout
}

/**
 * `.atrium-tx/<op>/journal.json` 的唯一读写入口。
 *
 * - 原子写：同目录临时文件 + fsync + rename；不直接改原文件；
 * - 读只认常规文件，拒绝 symlink/超限/结构不符；
 * - 只允许 ULID 目录名，路径不会逃出 `.atrium-tx`；
 * - 不删除 journal：历史事件随快照一起保留，恢复/归档后再由后续阶段清理。
 */
export class OperationJournalStore {
  pathFor(projectPath: string, opId: string): string {
    const real = realProject(projectPath)
    const id = normalizeOpId(opId)
    return path.join(real, TRANSACTION_DIR, id, JOURNAL_FILE)
  }

  exists(projectPath: string, opId: string): boolean {
    const real = tryRealProject(projectPath)
    if (!real) return false
    try {
      const tx = transactionRootForRead(real)
      if (!tx) return false
      const dir = operationDirForRead(tx, normalizeOpId(opId))
      if (!dir) return false
      const stat = lstatOrNull(path.join(dir, JOURNAL_FILE))
      return !!stat && stat.isFile() && !stat.isSymbolicLink()
    } catch {
      return false
    }
  }

  inspect(projectPath: string, opId: string): JournalInspection {
    const real = tryRealProject(projectPath)
    if (!real) return { status: 'missing' }
    let id: string
    try {
      id = normalizeOpId(opId)
    } catch {
      return { status: 'invalid' }
    }
    try {
      const tx = transactionRootForRead(real)
      if (!tx) return { status: 'missing' }
      const dir = operationDirForRead(tx, id)
      if (!dir) return { status: 'missing' }
      const file = path.join(dir, JOURNAL_FILE)
      const stat = lstatOrNull(file)
      if (!stat) return { status: 'missing' }
      if (stat.isSymbolicLink() || !stat.isFile() || stat.size > MAX_JOURNAL_BYTES) {
        return { status: 'invalid' }
      }
      const parsed: unknown = JSON.parse(fs.readFileSync(file, 'utf8'))
      const journal = validateJournalSnapshot(parsed)
      if (journal.opId !== id || journal.projectKey !== projectKeyOf(real)) {
        return { status: 'invalid' }
      }
      return { status: 'ok', journal }
    } catch {
      return { status: 'invalid' }
    }
  }

  read(projectPath: string, opId: string): OperationJournalSnapshot {
    const result = this.inspect(projectPath, opId)
    if (result.status !== 'ok') invalid()
    return result.journal
  }

  /** 新建操作时调用；目录已存在就拒绝，绝不覆盖旧现场。 */
  create(projectPath: string, snapshot: OperationJournalSnapshot): string {
    const real = realProject(projectPath)
    const normalized = validateJournalSnapshot(snapshot)
    if (normalized.projectKey !== projectKeyOf(real)) invalid()
    const tx = ensureTransactionRoot(real)
    const dir = path.join(tx, normalized.opId)
    try {
      fs.mkdirSync(dir)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') invalid()
      throw new VpmError('vpmJournalWriteFailed', undefined, error)
    }
    let dirReal: string
    try {
      dirReal = fs.realpathSync.native(dir)
    } catch (error) {
      throw new VpmError('vpmJournalWriteFailed', undefined, error)
    }
    assertInside(tx, dirReal)
    const file = path.join(dirReal, JOURNAL_FILE)
    writeAtomic(file, JSON.stringify(normalized, null, 2))
    return file
  }

  /** 更新已有 journal 的快照；不存在/不是常规文件时拒绝。 */
  write(projectPath: string, snapshot: OperationJournalSnapshot): string {
    const real = realProject(projectPath)
    const normalized = validateJournalSnapshot(snapshot)
    if (normalized.projectKey !== projectKeyOf(real)) invalid()
    let tx: string | null
    try {
      tx = transactionRootForRead(real)
    } catch {
      invalid()
    }
    if (!tx) invalid()
    const dir = operationDirForRead(tx, normalized.opId)
    if (!dir) invalid()
    const file = path.join(dir, JOURNAL_FILE)
    const stat = lstatOrNull(file)
    if (!stat || stat.isSymbolicLink() || !stat.isFile()) invalid()
    writeAtomic(file, JSON.stringify(normalized, null, 2))
    return file
  }
}
