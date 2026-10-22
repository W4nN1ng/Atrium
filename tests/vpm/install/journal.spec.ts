import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { closeVpmDb, openVpmDb, type VpmDb } from '../../../src/main/vpm/db'
import {
  JOURNAL_FILE,
  OperationJournalStore,
  OperationStore,
  RecoveryService,
  TRANSACTION_DIR,
  type CreateOperationInput,
  type OperationRecord,
  type OperationStatus
} from '../../../src/main/vpm/install'
import { projectKeyOf } from '../../../src/shared/vpm/domain/project'
import { sha256Hex } from '../../../src/shared/vpm/domain/hash'

const PLAN_HASH = 'a'.repeat(64)
const BEFORE_HASH = 'b'.repeat(64)
const AFTER_HASH = 'c'.repeat(64)
const FIXED_ID = '01ARZ3NDEKTSV4RRFFQ69G5FAV'
const OTHER_ID = '01ARZ3NDEKTSV4RRFFQ69G5FAW'

let root: string
let dbFile: string
let backupsDir: string
let db: VpmDb | null
let clock: number
let store: OperationStore
let journals: OperationJournalStore

beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'atrium-vpm-install-'))
  dbFile = path.join(root, 'vpm.db')
  backupsDir = path.join(root, 'backups')
  clock = 1_000
  db = await openVpmDb({ file: dbFile, backupsDir })
  store = new OperationStore(db, () => ++clock)
  journals = new OperationJournalStore()
})

afterEach(() => {
  closeVpmDb(db)
  db = null
  fs.rmSync(root, { recursive: true, force: true })
})

function makeProject(name: string): string {
  const dir = path.join(root, 'projects', name)
  fs.mkdirSync(path.join(dir, 'Packages'), { recursive: true })
  fs.mkdirSync(path.join(dir, 'ProjectSettings'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'Packages', 'vpm-manifest.json'), '{"dependencies":{}}')
  fs.writeFileSync(path.join(dir, 'ProjectSettings', 'ProjectVersion.txt'), 'm_EditorVersion: 2022.3.22f1\n')
  return dir
}

function inputFor(
  projectPath: string,
  overrides: Partial<CreateOperationInput> = {}
): CreateOperationInput {
  const real = fs.realpathSync.native(projectPath)
  // 真实的 beforeHash 必须等于磁盘 manifest 的 hash：恢复判定靠这个对账。
  const beforeHash = sha256Hex(
    fs.readFileSync(path.join(real, 'Packages', 'vpm-manifest.json'), 'utf8')
  )
  return {
    projectKey: projectKeyOf(real),
    projectPath: real,
    kind: 'install',
    plan: { changes: [{ action: 'install', name: 'com.example.a' }], roots: ['com.example.a'] },
    planHash: PLAN_HASH,
    projectFingerprint: 'manifest:test',
    manifestBeforeHash: beforeHash,
    manifestAfterHash: AFTER_HASH,
    summary: { changes: 1 },
    ...overrides
  }
}

function createOperation(projectPath: string, overrides: Partial<CreateOperationInput> = {}): OperationRecord {
  return store.create(inputFor(projectPath, overrides))
}

function journalFile(op: OperationRecord): string {
  return journals.pathFor(op.projectPath, op.id)
}

function readJournal(op: OperationRecord): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(journalFile(op), 'utf8')) as Record<string, unknown>
}

function eventKeys(op: OperationRecord): string[] {
  const journal = readJournal(op)
  return (journal.events as Array<{ key: string }>).map((event) => event.key)
}

async function reopen(): Promise<void> {
  closeVpmDb(db)
  db = null
  db = await openVpmDb({ file: dbFile, backupsDir })
  store = new OperationStore(db, () => ++clock)
  journals = new OperationJournalStore()
}

function applyBeforeCommit(op: OperationRecord): void {
  store.transition(op.id, 'preflight')
  store.transition(op.id, 'applying')
}

function expectCode(code: string, fn: () => unknown): void {
  let thrown: unknown = null
  try {
    fn()
  } catch (error) {
    thrown = error
  }
  expect(thrown).toMatchObject({ code })
}

describe('operation journal and state machine', () => {
  it('creates the operation row and journal together, and enforces one active operation per project', () => {
    const project = makeProject('Active')
    const other = makeProject('Other')
    const op = createOperation(project)

    expect(op.status).toBe('planned')
    expect(op.projectKey).toBe(projectKeyOf(fs.realpathSync.native(project)))
    expect(op.startedAt).toBeNull()
    expect(op.finishedAt).toBeNull()
    expect(store.findActive(op.projectKey)?.id).toBe(op.id)

    const file = journalFile(op)
    expect(file).toBe(
      path.join(fs.realpathSync.native(project), TRANSACTION_DIR, op.id, JOURNAL_FILE)
    )
    const journal = readJournal(op)
    expect(journal).toMatchObject({
      schemaVersion: 1,
      opId: op.id,
      projectKey: op.projectKey,
      kind: 'install',
      phase: 'planned',
      commitPoint: 'before',
      planHash: PLAN_HASH,
      projectFingerprint: 'manifest:test',
      vaultPending: false
    })
    expect((journal.events as unknown[]).length).toBe(1)
    expect((journal.steps as unknown[])).toEqual([])
    expect((journal.moves as unknown[])).toEqual([])

    expectCode('vpmProjectBusy', () => createOperation(project))
    expect(store.listActive().map((item) => item.id)).toEqual([op.id])
    expect(createOperation(other).id).not.toBe(op.id)
    const third = makeProject('Third')

    store.transition(op.id, 'preflight')
    store.transition(op.id, 'applying')
    store.markCommitPoint(op.id)
    store.transition(op.id, 'committed')
    expect(store.findActive(op.projectKey)).toBeNull()
    expect(() => createOperation(project)).not.toThrow()

    expectCode('vpmOperationInvalid', () => createOperation(third, { id: op.id }))
    expectCode('vpmOperationInvalid', () => createOperation(third, { id: '../invalid' }))
  })

  it('accepts only the documented state transitions and keeps terminal states terminal', () => {
    const project = makeProject('States')
    const op = createOperation(project)

    expectCode('vpmOperationInvalid', () => store.transition(op.id, 'applying'))
    expectCode('vpmOperationInvalid', () => store.transition(op.id, 'committed'))
    expect(store.get(op.id)?.status).toBe('planned')

    const preflight = store.transition(op.id, 'preflight')
    expect(preflight.startedAt).not.toBeNull()
    const eventsAfterPreflight = eventKeys(op).length
    expect(store.transition(op.id, 'preflight')).toEqual(preflight)
    expect(eventKeys(op).length).toBe(eventsAfterPreflight)

    expectCode('vpmOperationInvalid', () => store.transition(op.id, 'committed'))
    store.transition(op.id, 'applying')
    expectCode('vpmOperationInvalid', () => store.transition(op.id, 'preflight'))
    expectCode('vpmOperationInvalid', () => store.transition(op.id, 'committed'))
    store.markCommitPoint(op.id)
    const committed = store.transition(op.id, 'committed')
    expect(committed.status).toBe('committed')
    expect(committed.finishedAt).not.toBeNull()
    expect(readJournal(op).phase).toBe('committed')

    expectCode('vpmOperationInvalid', () => store.transition(op.id, 'applying'))
    expectCode('vpmOperationNotFound', () =>
      store.transition('01ARZ3NDEKTSV4RRFFQ69G5FAX', 'failed')
    )
    expectCode('vpmOperationInvalid', () =>
      store.transition(op.id, 'bogus' as OperationStatus)
    )

    const keys = eventKeys(op)
    expect(new Set(keys).size).toBe(keys.length)
    expect(keys).toContain(`op:${op.id}:status:committed`)
  })

  it('allows needs_attention recovery outcomes without going back to applying', () => {
    const project = makeProject('RecoveryStates')
    const op = createOperation(project)
    applyBeforeCommit(op)
    store.transition(op.id, 'needs_attention', {
      errorCode: 'vpmRecoveryRequired',
      errorDetail: 'before_commit'
    })
    expect(store.get(op.id)).toMatchObject({
      status: 'needs_attention',
      errorCode: 'vpmRecoveryRequired',
      errorDetail: 'before_commit'
    })
    expectCode('vpmOperationInvalid', () => store.transition(op.id, 'applying'))
    expect(store.transition(op.id, 'rolled_back').status).toBe('rolled_back')

    const other = createOperation(makeProject('RecoveredCommit'))
    applyBeforeCommit(other)
    store.transition(other.id, 'needs_attention')
    store.markCommitPoint(other.id)
    expect(store.transition(other.id, 'committed').status).toBe('committed')
  })

  it('writes step start/end journal in order and treats repeated calls idempotently', () => {
    const project = makeProject('Steps')
    const op = createOperation(project)
    store.transition(op.id, 'preflight')

    const first = store.beginStep(op.id, {
      step: 'preflight.read-manifest',
      seq: 1,
      detail: { source: 'manifest' }
    })
    expect(first.created).toBe(true)
    expect(first.step).toMatchObject({
      step: 'preflight.read-manifest',
      seq: 1,
      status: 'running',
      attempts: 1
    })
    expect(first.step.detailJson).toBe('{"source":"manifest"}')
    const eventsAfterFirst = eventKeys(op).length
    const stepJournal = readJournal(op).steps as Array<Record<string, unknown>>
    expect(stepJournal).toHaveLength(1)
    expect(stepJournal[0]).toMatchObject({
      key: `step:${op.id}:1:preflight.read-manifest`,
      step: 'preflight.read-manifest',
      seq: 1,
      status: 'running',
      attempts: 1
    })

    expect(
      store.beginStep(op.id, { step: 'preflight.read-manifest', seq: 1 }).created
    ).toBe(false)
    expect(eventKeys(op).length).toBe(eventsAfterFirst)
    expectCode('vpmOperationInvalid', () =>
      store.beginStep(op.id, { step: 'second', seq: 2 })
    )

    const done = store.finishStep(op.id, 'preflight.read-manifest', 'done')
    expect(done.status).toBe('done')
    expect(done.finishedAt).not.toBeNull()
    expect(store.finishStep(op.id, 'preflight.read-manifest', 'done')).toEqual(done)
    const eventsAfterDone = eventKeys(op).length
    expectCode('vpmOperationInvalid', () =>
      store.finishStep(op.id, 'preflight.read-manifest', 'failed')
    )
    expect(eventKeys(op).length).toBe(eventsAfterDone)

    const second = store.beginStep(op.id, { step: 'download', seq: 2 })
    expect(second.created).toBe(true)
    const failed = store.finishStep(op.id, 'download', 'failed', { code: 'vpmHttpNetwork' })
    expect(failed.status).toBe('failed')
    expect(failed.detailJson).toBe('{"code":"vpmHttpNetwork"}')
    expect(store.finishStep(op.id, 'download', 'failed')).toEqual(failed)
    expectCode('vpmOperationInvalid', () =>
      store.beginStep(op.id, { step: 'old-seq', seq: 1 })
    )
    expectCode('vpmOperationInvalid', () =>
      store.finishStep(op.id, 'missing', 'done')
    )

    expect(store.nextStepSequence(op.id)).toBe(3)
    store.beginStep(op.id, { step: 'commit', seq: 3 })
    store.finishStep(op.id, 'commit', 'done')
    const steps = (readJournal(op).steps as Array<{ seq: number }>).map((item) => item.seq)
    expect(steps).toEqual([1, 2, 3])

    store.transition(op.id, 'applying')
    store.markCommitPoint(op.id)
    store.transition(op.id, 'committed')
    expectCode('vpmOperationInvalid', () =>
      store.beginStep(op.id, { step: 'late', seq: 4 })
    )

    const keys = eventKeys(op)
    expect(new Set(keys).size).toBe(keys.length)
    expect(keys).toContain(`step:${op.id}:1:preflight.read-manifest:started:1`)
    expect(keys).toContain(`step:${op.id}:1:preflight.read-manifest:done`)
    expect(keys).toContain(`step:${op.id}:2:download:failed`)
  })

  it('records operation files as paths and hashes only, and mirrors them into the journal', () => {
    const project = makeProject('Files')
    const op = createOperation(project)
    store.transition(op.id, 'preflight')

    const moved = store.upsertFile(op.id, {
      path: 'Packages/com.example.a',
      action: 'move-out',
      sha256: 'd'.repeat(64),
      size: 123,
      state: 'pending'
    })
    expect(moved).toMatchObject({
      path: 'Packages/com.example.a',
      action: 'move-out',
      state: 'pending',
      size: 123
    })
    expect(readJournal(op).moves).toEqual([
      {
        path: 'Packages/com.example.a',
        action: 'move-out',
        state: 'pending',
        vaultPath: null,
        sha256: 'd'.repeat(64),
        size: 123
      }
    ])

    const eventsBefore = eventKeys(op).length
    const done = store.setFileState(op.id, 'Packages/com.example.a', 'move-out', 'done')
    expect(done.state).toBe('done')
    expect((readJournal(op).moves as Array<{ state: string }>)[0].state).toBe('done')
    expect(store.setFileState(op.id, 'Packages/com.example.a', 'move-out', 'done')).toEqual(done)
    expect(eventKeys(op).length).toBe(eventsBefore + 1)

    store.upsertFile(op.id, {
      path: 'Assets/OldThing',
      action: 'legacy',
      state: 'pending'
    })
    expectCode('vpmOperationInvalid', () =>
      store.upsertFile(op.id, { path: '../outside', action: 'move-in' })
    )
    expectCode('vpmOperationInvalid', () =>
      store.upsertFile(op.id, { path: 'Packages/x', action: 'legacy' })
    )
    expectCode('vpmOperationInvalid', () =>
      store.upsertFile(op.id, { path: 'Packages/x', action: 'move-in', sha256: 'nope' })
    )
    expectCode('vpmOperationInvalid', () =>
      store.upsertFile(op.id, { path: 'Packages/x', action: 'move-in', size: -1 })
    )
    expectCode('vpmOperationInvalid', () =>
      store.setFileState(op.id, 'Packages/missing', 'move-in', 'done')
    )

    applyBeforeCommit(op)
    store.markCommitPoint(op.id)
    store.transition(op.id, 'committed')
    expect(
      store.setFileState(op.id, 'Packages/com.example.a', 'move-out', 'archived').state
    ).toBe('archived')
  })

  it('keeps an append-only event history for commit point, legacy paths, hashes and vault', () => {
    const project = makeProject('Evidence')
    const op = createOperation(project)
    applyBeforeCommit(op)

    const hashes = store.setManifestHashes(op.id, {
      beforeHash: BEFORE_HASH,
      afterHash: 'e'.repeat(64)
    })
    expect(hashes.manifestAfterHash).toBe('e'.repeat(64))
    expect((readJournal(op).manifest as Record<string, unknown>).afterHash).toBe('e'.repeat(64))

    const committed = store.markCommitPoint(op.id)
    expect(committed.commitPoint).toBe('manifest_written')
    expectCode('vpmOperationInvalid', () => store.transition(op.id, 'failed'))
    expectCode('vpmOperationInvalid', () => store.transition(op.id, 'rolled_back'))
    expectCode('vpmOperationInvalid', () =>
      store.setManifestHashes(op.id, { beforeHash: BEFORE_HASH, afterHash: 'f'.repeat(64) })
    )
    const eventsAtCommit = eventKeys(op).length
    expect(store.markCommitPoint(op.id).events.length).toBe(committed.events.length)
    expect(eventKeys(op).length).toBe(eventsAtCommit)
    expect(eventKeys(op)).toContain(`manifest:${op.id}:committed`)

    const legacy = store.setLegacyPaths(op.id, [
      'Assets/Old/',
      'Assets/Old',
      'Assets/Legacy'
    ])
    expect(legacy.legacyPaths).toEqual(['Assets/Legacy', 'Assets/Old'])
    const eventsAfterLegacy = eventKeys(op).length
    store.setLegacyPaths(op.id, ['Assets/Old', 'Assets/Legacy'])
    expect(eventKeys(op).length).toBe(eventsAfterLegacy)
    expectCode('vpmOperationInvalid', () =>
      store.setLegacyPaths(op.id, ['Packages/NotAssets'])
    )

    const vault = store.setVaultPending(op.id, true)
    expect(vault.vaultPending).toBe(true)
    expect(readJournal(op).vaultPending).toBe(true)
    expect(store.setVaultPending(op.id, true)).toEqual(vault)

    store.transition(op.id, 'committed')
    expect(store.commitPoint(op.id)).toBe('manifest_written')
    expect(readJournal(op).phase).toBe('committed')

    const keys = eventKeys(op)
    expect(new Set(keys).size).toBe(keys.length)
    expect(keys).toContain(`vault:${op.id}:1`)

    const noAfter = createOperation(makeProject('NoAfter'), { manifestAfterHash: null })
    expectCode('vpmOperationInvalid', () => store.markCommitPoint(noAfter.id))
    expectCode('vpmOperationInvalid', () =>
      store.markCommitPoint(createOperation(makeProject('NotApplying')).id)
    )
  })
})

describe('crash recovery decisions', () => {
  it('rolls back before the commit point without touching project files', async () => {
    const project = makeProject('CrashBeforeCommit')
    const marker = path.join(project, 'Packages', 'com.example.a')
    fs.mkdirSync(marker, { recursive: true })
    const markerFile = path.join(marker, 'keep.txt')
    fs.writeFileSync(markerFile, 'user content')
    const before = fs.readFileSync(markerFile, 'utf8')

    const op = createOperation(project)
    applyBeforeCommit(op)
    const first = store.beginStep(op.id, { step: 'move-old', seq: 1 })
    store.finishStep(op.id, first.step.step, 'done')
    store.beginStep(op.id, { step: 'move-new', seq: 2 })
    expect(store.get(op.id)?.steps.map((step) => step.status)).toEqual(['done', 'running'])

    const opId = op.id
    await reopen()
    const recovery = new RecoveryService({ operations: store })
    const decisions = recovery.scan()
    expect(decisions).toHaveLength(1)
    expect(decisions[0]).toMatchObject({
      operationId: opId,
      action: 'rollback',
      reason: 'before_commit',
      status: 'applying',
      journalPhase: 'applying'
    })

    const outcomes = await recovery.apply(decisions)
    expect(outcomes[0]).toMatchObject({
      applied: true,
      resultStatus: 'failed',
      errorCode: null
    })
    // 没有任何文件被移动过 → 恢复判定为 failed（不是 needs_attention），工程可以继续用。
    expect(store.get(opId)).toMatchObject({
      status: 'failed',
      errorCode: null
    })
    expect(fs.readFileSync(markerFile, 'utf8')).toBe(before)
    expect(fs.existsSync(journalFile(store.get(opId) as OperationRecord))).toBe(true)
    const journal = readJournal(store.get(opId) as OperationRecord)
    expect(journal.phase).toBe('failed')
    expect(journal.commitPoint).toBe('before')
    expect(new Set(eventKeys(store.get(opId) as OperationRecord)).size).toBe(
      eventKeys(store.get(opId) as OperationRecord).length
    )
    expect(recovery.scan()).toEqual([])
    // 恢复完成后同一工程可以开新操作，不需要人工解锁。
    expect(createOperation(project).status).toBe('planned')
  })

  it('turns missing, corrupt or mismatched journals into needs_attention without inventing evidence', async () => {
    const missingProject = makeProject('MissingJournal')
    const missing = createOperation(missingProject)
    applyBeforeCommit(missing)
    fs.rmSync(journalFile(missing), { force: true })
    expect(journals.exists(missingProject, missing.id)).toBe(false)

    const corruptProject = makeProject('CorruptJournal')
    const corrupt = createOperation(corruptProject)
    applyBeforeCommit(corrupt)
    const corruptFile = journalFile(corrupt)
    fs.writeFileSync(corruptFile, '{')

    const missingProjectDir = makeProject('MissingProject')
    const gone = createOperation(missingProjectDir)
    applyBeforeCommit(gone)
    fs.rmSync(missingProjectDir, { recursive: true, force: true })

    const recovery = new RecoveryService({ operations: store })
    const decisions = recovery.scan()
    expect(decisions.map((decision) => decision.reason)).toEqual([
      'journal_missing',
      'journal_invalid',
      'project_missing'
    ])
    expect(decisions.map((decision) => decision.action)).toEqual([
      'needs_attention',
      'needs_attention',
      'needs_attention'
    ])

    const outcomes = await recovery.apply(decisions)
    expect(outcomes.map((item) => item.applied)).toEqual([true, true, true])
    expect(store.get(missing.id)).toMatchObject({
      status: 'needs_attention',
      errorCode: 'vpmJournalInvalid'
    })
    expect(store.get(corrupt.id)).toMatchObject({
      status: 'needs_attention',
      errorCode: 'vpmJournalInvalid'
    })
    expect(store.get(gone.id)).toMatchObject({
      status: 'needs_attention',
      errorCode: 'vpmRecoveryRequired'
    })
    expect(journals.exists(missingProject, missing.id)).toBe(false)
    expect(fs.readFileSync(corruptFile, 'utf8')).toBe('{')
  })

  it('completes after the manifest commit point and waits while Unity or an import is active', async () => {
    const committedProject = makeProject('AfterCommit')
    const committed = createOperation(committedProject)
    applyBeforeCommit(committed)
    store.markCommitPoint(committed.id)

    const activeProject = makeProject('ActiveProject')
    const active = createOperation(activeProject)
    applyBeforeCommit(active)

    const waiting = new RecoveryService({
      operations: store,
      isProjectActive: (projectPath) =>
        path.resolve(projectPath).toLowerCase() ===
        fs.realpathSync.native(activeProject).toLowerCase()
    })
    const waitingDecisions = waiting.scan()
    expect(waitingDecisions).toHaveLength(2)
    expect(waitingDecisions.find((item) => item.operationId === active.id)).toMatchObject({
      action: 'wait',
      reason: 'unity_running',
      journalPhase: null
    })
    expect(waitingDecisions.find((item) => item.operationId === committed.id)).toMatchObject({
      action: 'complete',
      reason: 'manifest_committed',
      journalPhase: 'applying'
    })
    const waitingOutcomes = await waiting.apply(waitingDecisions)
    expect(waitingOutcomes.find((item) => item.decision.operationId === active.id)).toMatchObject({
      applied: false,
      resultStatus: 'applying'
    })
    expect(store.get(active.id)?.status).toBe('applying')
    expect(store.get(committed.id)?.status).toBe('committed')
    expect(readJournal(committed).phase).toBe('committed')
    expect(readJournal(committed).commitPoint).toBe('manifest_written')

    const afterClose = new RecoveryService({ operations: store })
    const decisions = afterClose.scan()
    expect(decisions).toHaveLength(1)
    expect(decisions[0]).toMatchObject({
      operationId: active.id,
      action: 'rollback',
      reason: 'before_commit'
    })
    await afterClose.apply(decisions)
    expect(store.get(active.id)?.status).toBe('failed')
  })
})

describe('journal path and ownership guards', () => {
  it('rejects traversal-like ids and mismatched project keys', () => {
    const project = makeProject('Guards')
    expectCode('vpmJournalInvalid', () => journals.pathFor(project, '../escape'))
    expectCode('vpmOperationInvalid', () => createOperation(project, { id: '../escape' }))
    expectCode('vpmProjectInvalid', () =>
      store.create(inputFor(project, { projectPath: 'relative/path' }))
    )
    expectCode('vpmProjectInvalid', () =>
      createOperation(project, { projectKey: 'c:\\somewhere\\else' })
    )
  })

  it('refuses to overwrite an existing operation directory and rolls back the row', () => {
    const project = makeProject('ExistingDir')
    const real = fs.realpathSync.native(project)
    const tx = path.join(real, TRANSACTION_DIR)
    fs.mkdirSync(path.join(tx, FIXED_ID), { recursive: true })

    expectCode('vpmJournalInvalid', () =>
      store.create(inputFor(project, { id: FIXED_ID }))
    )
    expect(store.get(FIXED_ID)).toBeNull()
    expect(fs.existsSync(path.join(tx, FIXED_ID, JOURNAL_FILE))).toBe(false)
  })

  it('keeps the plan hash and journal evidence stable across DB reopen', async () => {
    const project = makeProject('Reopen')
    const op = createOperation(project, { id: OTHER_ID })
    applyBeforeCommit(op)
    const keys = eventKeys(op)
    await reopen()
    const saved = store.get(op.id)
    expect(saved).toMatchObject({
      id: OTHER_ID,
      status: 'applying',
      planHash: PLAN_HASH,
      projectFingerprint: 'manifest:test'
    })
    expect(eventKeys(op)).toEqual(keys)
  })

  it('rejects a tampered journal that claims committed before the manifest commit point', () => {
    const project = makeProject('TamperedPhase')
    const op = createOperation(project)
    applyBeforeCommit(op)
    const file = journalFile(op)
    const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>
    raw.phase = 'committed'
    fs.writeFileSync(file, JSON.stringify(raw))

    expect(journals.inspect(project, op.id).status).toBe('invalid')
    expectCode('vpmJournalInvalid', () => journals.read(project, op.id))
  })
})
