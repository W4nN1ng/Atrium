import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { closeVpmDb, openVpmDb, type VpmDb } from '../../../src/main/vpm/db'
import {
  InstallTransactionService,
  OperationStore,
  PROTECTED_PACKAGE_ID,
  evaluatePreflight,
  requiredBytesFor,
  type ApplyPlanResult,
  type InstallTransactionOptions,
  type LegacyGuardPort,
  type PackageSourcePort,
  type PreflightFacts
} from '../../../src/main/vpm/install'
import { ProjectFsReader } from '../../../src/main/vpm/projects'
import { fakeActivity } from './harness'
import { VaultStore } from '../../../src/main/vpm/vault'
import { sha256Hex } from '../../../src/shared/vpm/domain/hash'
import {
  buildChangePlan,
  type ChangePlan,
  type ChangePlanRequest
} from '../../../src/shared/vpm/domain/plan'
import { projectKeyOf, projectSlugOf, readProjectSnapshot, type ProjectSnapshot } from '../../../src/shared/vpm/domain/project'
import type {
  ResolverCatalogPackage,
  ResolverInstalled
} from '../../../src/shared/vpm/domain/resolver'
import { VpmError } from '../../../src/shared/vpm/errors'
import { makeZip } from './zip-fixture'

const PLAN_ID = '01ARZ3NDEKTSV4RRFFQ69G5FAV'
const UNITY = '2022.3.22f1'
const FREE = 50 * 1024 * 1024 * 1024

let root: string
let dataRoot: string
let project: string
let projectKey: string
let db: VpmDb | null
let clock: number
let operations: OperationStore
let vault: VaultStore
const zips = new Map<string, { file: string; sha256: string; size: number; url: string }>()

beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'atrium-vpm-tx-'))
  dataRoot = path.join(root, 'data')
  fs.mkdirSync(dataRoot)
  project = path.join(root, 'DemoProject')
  fs.mkdirSync(path.join(project, 'Packages'), { recursive: true })
  fs.mkdirSync(path.join(project, 'ProjectSettings'), { recursive: true })
  fs.mkdirSync(path.join(project, 'Assets'), { recursive: true })
  fs.writeFileSync(
    path.join(project, 'ProjectSettings', 'ProjectVersion.txt'),
    `m_EditorVersion: ${UNITY}\n`
  )
  projectKey = projectKeyOf(fs.realpathSync.native(project))

  db = await openVpmDb({
    file: path.join(root, 'vpm.db'),
    backupsDir: path.join(root, 'backups')
  })
  clock = 1_000
  operations = new OperationStore(db, () => ++clock)
  vault = new VaultStore({ dataRoot })
  zips.clear()
})

afterEach(() => {
  closeVpmDb(db)
  db = null
  fs.rmSync(root, { recursive: true, force: true })
})

function snapshot(): ProjectSnapshot {
  const reader = new ProjectFsReader(project)
  return readProjectSnapshot(reader, reader.root)
}

function manifestPath(): string {
  return path.join(project, 'Packages', 'vpm-manifest.json')
}

function writeManifest(value: Record<string, unknown>): string {
  const text = JSON.stringify(value, null, 2)
  fs.writeFileSync(manifestPath(), text)
  return sha256Hex(text)
}

function readManifest(): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(manifestPath(), 'utf8')) as Record<string, unknown>
}

function packageDir(name: string): string {
  return path.join(project, 'Packages', name)
}

function installedVersion(name: string): string | null {
  try {
    const raw = fs.readFileSync(path.join(packageDir(name), 'package.json'), 'utf8')
    return (JSON.parse(raw) as { version?: string }).version ?? null
  } catch {
    return null
  }
}

function writeInstalledPackage(name: string, version: string): void {
  const dir = packageDir(name)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify({ name, version, vpmDependencies: {} })
  )
  fs.writeFileSync(path.join(dir, 'index.js'), `// ${version}\n`)
}

function buildZip(name: string, version: string, deps: Record<string, string> = {}): {
  sha256: string
  url: string
  size: number
} {
  const buffer = makeZip([
    {
      name: 'package.json',
      data: JSON.stringify({ name, version, unity: '2022.3', vpmDependencies: deps })
    },
    { name: 'index.js', data: `// ${name}@${version}\n` }
  ])
  const sha256 = createHash('sha256').update(buffer).digest('hex')
  const dir = path.join(root, 'zips')
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, `${name}-${version}.zip`)
  fs.writeFileSync(file, buffer)
  const url = `https://packages.example.test/${name}-${version}.zip`
  zips.set(sha256, { file, sha256, size: buffer.length, url })
  return { sha256, url, size: buffer.length }
}

function catalogEntry(name: string, version: string, deps: Record<string, string> = {}): ResolverCatalogPackage {
  const zip = buildZip(name, version, deps)
  return {
    name,
    version,
    dependencies: deps,
    sha256: zip.sha256,
    url: zip.url,
    size: zip.size,
    repoId: 'repo-1'
  }
}

function packageSource(): PackageSourcePort {
  return {
    async ensurePackage(input) {
      const hit = zips.get(input.sha256.toLowerCase())
      if (!hit) throw new VpmError('vpmHttpNetwork')
      return { path: hit.file, sha256: hit.sha256, size: hit.size, reused: false }
    }
  }
}

interface ScenarioOptions {
  manifest?: Record<string, unknown>
  installed?: ResolverInstalled[]
  catalog?: ResolverCatalogPackage[]
  requests?: ChangePlanRequest[]
  legacyPackages?: string[]
  preset?: 'upgradeAll'
}

function makePlan(options: ScenarioOptions): { plan: ChangePlan; beforeHash: string } {
  const manifest = options.manifest ?? { dependencies: {}, locked: {} }
  const beforeHash = writeManifest(manifest)
  const dependencies = (manifest.dependencies ?? {}) as Record<string, string>
  const locked = (manifest.locked ?? {}) as Record<string, { version: string; dependencies?: Record<string, string> }>
  const plan = buildChangePlan({
    projectKey,
    unityVersion: UNITY,
    manifestHashBefore: beforeHash,
    roots: dependencies,
    locked,
    installed: options.installed ?? [],
    catalog: options.catalog ?? [],
    requests: options.requests ?? [],
    preset: options.preset,
    options: {
      protectedPackages: [PROTECTED_PACKAGE_ID],
      legacyPackages: options.legacyPackages ?? []
    }
  })
  return { plan, beforeHash }
}

interface RunOptions extends ScenarioOptions {
  overrides?: Partial<InstallTransactionOptions>
}

async function run(options: RunOptions): Promise<{ result: ApplyPlanResult; plan: ChangePlan }> {
  const { plan } = makePlan(options)
  const plans = new Map<string, ChangePlan>([[PLAN_ID, plan]])
  const transactions = new InstallTransactionService({
    operations,
    plans: {
      get: (planId: string) => {
        const cached = plans.get(planId)
        if (!cached) throw new VpmError('vpmPlanNotFound')
        return cached
      }
    },
    projects: {
      load: (key: string) =>
        key === projectKey ? { projectPath: project, snapshot: snapshot() } : null
    },
    packages: packageSource(),
    vault,
    dataRoot,
    freeBytes: () => FREE,
    renameDelayMs: 0,
    sleep: async () => undefined,
    now: () => ++clock,
    ...options.overrides
  })
  const result = await transactions.apply({ projectKey, planId: PLAN_ID })
  return { result, plan }
}

function journalOf(opId: string): Record<string, unknown> {
  const file = path.join(project, '.atrium-tx', opId, 'journal.json')
  return JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>
}

function vaultOpDir(opId: string): string {
  return path.join(dataRoot, 'vault', projectSlugOf(projectKey), opId)
}

describe('install transaction: happy paths', () => {
  it('installs a package, writes the manifest last and commits', async () => {
    const entry = catalogEntry('com.example.a', '1.0.0')
    const { result } = await run({
      catalog: [entry],
      requests: [{ kind: 'install', name: 'com.example.a' }]
    })

    expect(result.status).toBe('committed')
    expect(result.errorCode).toBeNull()
    expect(result.installed).toEqual(['com.example.a'])
    expect(installedVersion('com.example.a')).toBe('1.0.0')

    const manifest = readManifest()
    expect(manifest.dependencies).toEqual({ 'com.example.a': '*' })
    expect(manifest.locked).toEqual({
      'com.example.a': { version: '1.0.0', dependencies: {} }
    })

    const journal = journalOf(result.operationId)
    expect(journal.commitPoint).toBe('manifest_written')
    expect(journal.phase).toBe('committed')
    const moves = journal.moves as Array<{ path: string; action: string; state: string }>
    expect(moves).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'Packages/com.example.a', action: 'move-in', state: 'done' })
      ])
    )

    const operation = operations.get(result.operationId)
    expect(operation?.status).toBe('committed')
    expect(operation?.steps.map((step) => step.step)).toEqual([
      'prepare',
      'download',
      'extract',
      'move-out',
      'move-in',
      'manifest',
      'legacy',
      'vault',
      'cleanup'
    ])
    // 没有旧包 → 不需要回滚仓。
    expect(fs.existsSync(path.join(project, '.atrium-tx', result.operationId, 'trash'))).toBe(false)
    expect(vault.usage().operations).toBe(0)
  })

  it('preserves unknown manifest fields and keeps unrelated locked entries', async () => {
    writeInstalledPackage('com.example.keep', '1.0.0')
    const keep = catalogEntry('com.example.keep', '1.0.0')
    const entry = catalogEntry('com.example.a', '1.0.0')
    const { result } = await run({
      manifest: {
        dependencies: { 'com.example.keep': '1.0.0' },
        locked: {
          'com.example.keep': { version: '1.0.0', dependencies: {} },
          // 受保护包只出现在 locked 里（核心桥接自己装它），VPM 不得抹掉这一行。
          'com.avca.bridge': { version: '1.2.0', dependencies: {} }
        },
        legacyFolders: { 'com.example.old': 'Assets/OldThing' },
        customField: { keep: true }
      },
      installed: [{ name: 'com.example.keep', version: '1.0.0' }],
      catalog: [keep, entry],
      requests: [{ kind: 'install', name: 'com.example.a' }]
    })

    expect(result.status).toBe('committed')
    const manifest = readManifest()
    expect(manifest.customField).toEqual({ keep: true })
    expect(manifest.legacyFolders).toEqual({ 'com.example.old': 'Assets/OldThing' })
    expect((manifest.locked as Record<string, unknown>)['com.avca.bridge']).toEqual({
      version: '1.2.0',
      dependencies: {}
    })
    expect((manifest.dependencies as Record<string, string>)['com.example.keep']).toBe('1.0.0')
  })

  it('upgrades a package and archives the old folder into the vault', async () => {
    writeInstalledPackage('com.example.a', '1.0.0')
    const entry = catalogEntry('com.example.a', '2.0.0')
    const { result } = await run({
      manifest: {
        dependencies: { 'com.example.a': '1.0.0' },
        locked: { 'com.example.a': { version: '1.0.0', dependencies: {} } }
      },
      installed: [{ name: 'com.example.a', version: '1.0.0' }],
      catalog: [entry],
      requests: [{ kind: 'upgrade', name: 'com.example.a', version: '2.0.0' }]
    })

    expect(result.status).toBe('committed')
    expect(result.removed).toEqual(['com.example.a'])
    expect(result.installed).toEqual(['com.example.a'])
    expect(installedVersion('com.example.a')).toBe('2.0.0')
    expect((readManifest().locked as Record<string, { version: string }>)['com.example.a'].version).toBe('2.0.0')
    expect(result.vaultPending).toBe(false)

    const archived = path.join(vaultOpDir(result.operationId), 'packages', 'com.example.a', 'package.json')
    expect(fs.existsSync(archived)).toBe(true)
    const oldManifest = JSON.parse(fs.readFileSync(archived, 'utf8')) as { version: string }
    expect(oldManifest.version).toBe('1.0.0')

    const files = operations.get(result.operationId)?.files ?? []
    expect(files).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'Packages/com.example.a', action: 'move-out', state: 'done' }),
        expect.objectContaining({ path: 'Packages/com.example.a', action: 'move-in', state: 'done' }),
        expect.objectContaining({ path: 'Packages/com.example.a', action: 'vault', state: 'archived' })
      ])
    )
    // 事务区只留证据，不留旧包。
    expect(fs.existsSync(path.join(project, '.atrium-tx', result.operationId, 'trash', 'packages'))).toBe(false)
  })

  it('downgrades a package', async () => {
    writeInstalledPackage('com.example.a', '2.0.0')
    const entry = catalogEntry('com.example.a', '1.0.0')
    const { result, plan } = await run({
      manifest: {
        dependencies: { 'com.example.a': '2.0.0' },
        locked: { 'com.example.a': { version: '2.0.0', dependencies: {} } }
      },
      installed: [{ name: 'com.example.a', version: '2.0.0' }],
      catalog: [entry],
      requests: [{ kind: 'downgrade', name: 'com.example.a', version: '1.0.0' }]
    })

    expect(plan.changes[0].action).toBe('downgrade')
    expect(result.status).toBe('committed')
    expect(installedVersion('com.example.a')).toBe('1.0.0')
    expect((readManifest().locked as Record<string, { version: string }>)['com.example.a'].version).toBe('1.0.0')
  })

  it('reinstalls the same version by replacing the folder', async () => {
    writeInstalledPackage('com.example.a', '1.0.0')
    fs.writeFileSync(path.join(packageDir('com.example.a'), 'user-edit.txt'), 'local change')
    const entry = catalogEntry('com.example.a', '1.0.0')
    const { result, plan } = await run({
      manifest: {
        dependencies: { 'com.example.a': '1.0.0' },
        locked: { 'com.example.a': { version: '1.0.0', dependencies: {} } }
      },
      installed: [{ name: 'com.example.a', version: '1.0.0' }],
      catalog: [entry],
      requests: [{ kind: 'reinstall', name: 'com.example.a', version: '1.0.0' }]
    })

    expect(plan.changes[0].action).toBe('reinstall')
    expect(result.status).toBe('committed')
    expect(installedVersion('com.example.a')).toBe('1.0.0')
    expect(fs.existsSync(path.join(packageDir('com.example.a'), 'user-edit.txt'))).toBe(false)
    // 用户可能在包目录里改过文件：旧目录必须能在回滚仓里找到。
    const archived = path.join(vaultOpDir(result.operationId), 'packages', 'com.example.a', 'user-edit.txt')
    expect(fs.readFileSync(archived, 'utf8')).toBe('local change')
  })

  it('removes a package and archives it instead of deleting', async () => {
    writeInstalledPackage('com.example.a', '1.0.0')
    const { result, plan } = await run({
      manifest: {
        dependencies: { 'com.example.a': '1.0.0' },
        locked: { 'com.example.a': { version: '1.0.0', dependencies: {} } }
      },
      installed: [{ name: 'com.example.a', version: '1.0.0' }],
      catalog: [],
      requests: [{ kind: 'remove', name: 'com.example.a' }]
    })

    expect(plan.changes[0].action).toBe('remove')
    expect(result.status).toBe('committed')
    expect(fs.existsSync(packageDir('com.example.a'))).toBe(false)
    expect(readManifest().dependencies).toEqual({})
    expect(readManifest().locked).toEqual({})
    expect(
      fs.existsSync(path.join(vaultOpDir(result.operationId), 'packages', 'com.example.a', 'package.json'))
    ).toBe(true)
    expect(operations.get(result.operationId)?.kind).toBe('remove')
  })
})

describe('install transaction: preflight rejections', () => {
  function expectRejected(result: ApplyPlanResult, code: string): void {
    expect(result.status).toBe('failed')
    expect(result.errorCode).toBe(code)
    expect(result.installed).toEqual([])
    expect(result.removed).toEqual([])
  }

  it('refuses while Unity is running and leaves the project untouched', async () => {
    const entry = catalogEntry('com.example.a', '1.0.0')
    const { result } = await run({
      catalog: [entry],
      requests: [{ kind: 'install', name: 'com.example.a' }],
      overrides: { activity: fakeActivity({ unityRunning: true, importing: false }) }
    })

    expectRejected(result, 'vpmUnityRunning')
    expect(fs.existsSync(packageDir('com.example.a'))).toBe(false)
    expect(readManifest().dependencies).toEqual({})
  })

  it('refuses while assets are being imported', async () => {
    const entry = catalogEntry('com.example.a', '1.0.0')
    const { result } = await run({
      catalog: [entry],
      requests: [{ kind: 'install', name: 'com.example.a' }],
      overrides: { activity: fakeActivity({ unityRunning: false, importing: true }) }
    })
    expectRejected(result, 'vpmProjectImporting')
  })

  it('refuses when the manifest changed after the preview', async () => {
    const entry = catalogEntry('com.example.a', '1.0.0')
    const { plan } = makePlan({ catalog: [entry], requests: [{ kind: 'install', name: 'com.example.a' }] })
    // 预览之后外部改过 manifest。
    writeManifest({ dependencies: { 'com.example.other': '1.0.0' }, locked: {} })
    const transactions = new InstallTransactionService({
      operations,
      plans: { get: () => plan },
      projects: { load: () => ({ projectPath: project, snapshot: snapshot() }) },
      packages: packageSource(),
      vault,
      dataRoot,
      freeBytes: () => FREE,
      sleep: async () => undefined
    })
    const result = await transactions.apply({ projectKey, planId: PLAN_ID })
    expectRejected(result, 'vpmProjectChanged')
  })

  it('refuses when the project volume is too small', async () => {
    const entry = catalogEntry('com.example.a', '1.0.0')
    const { result } = await run({
      catalog: [entry],
      requests: [{ kind: 'install', name: 'com.example.a' }],
      overrides: { freeBytes: () => 1024 }
    })
    expectRejected(result, 'vpmProjectNoSpace')
  })

  it('refuses when the vault is unusable', async () => {
    const entry = catalogEntry('com.example.a', '1.0.0')
    const brokenVault = {
      dataRoot,
      vaultRoot: path.join(dataRoot, 'vault'),
      ensureUsable: () => false,
      opDir: () => path.join(dataRoot, 'vault', 'x'),
      exists: () => false,
      usage: () => ({ bytes: 0, files: 0, operations: 0 }),
      archive: async () => {
        throw new VpmError('vpmVaultUnavailable')
      }
    } as unknown as VaultStore
    const { result } = await run({
      catalog: [entry],
      requests: [{ kind: 'install', name: 'com.example.a' }],
      overrides: { vault: brokenVault }
    })
    expectRejected(result, 'vpmVaultUnavailable')
  })

  it('refuses a second operation while one is still active', async () => {
    const entry = catalogEntry('com.example.a', '1.0.0')
    const { plan } = makePlan({ catalog: [entry], requests: [{ kind: 'install', name: 'com.example.a' }] })
    operations.create({
      projectKey,
      projectPath: fs.realpathSync.native(project),
      kind: 'install',
      plan,
      planHash: plan.planHash,
      manifestBeforeHash: plan.manifestHashBefore
    })
    const transactions = new InstallTransactionService({
      operations,
      plans: { get: () => plan },
      projects: { load: () => ({ projectPath: project, snapshot: snapshot() }) },
      packages: packageSource(),
      vault,
      dataRoot,
      freeBytes: () => FREE,
      sleep: async () => undefined
    })
    await expect(transactions.apply({ projectKey, planId: PLAN_ID })).rejects.toMatchObject({
      code: 'vpmProjectBusy'
    })
  })
})

describe('install transaction: failure injection and rollback', () => {
  it('fails at download without touching the project', async () => {
    const entry = catalogEntry('com.example.a', '1.0.0')
    const { result } = await run({
      catalog: [entry],
      requests: [{ kind: 'install', name: 'com.example.a' }],
      overrides: {
        packages: {
          ensurePackage: async () => {
            throw new VpmError('vpmHttpTimeout')
          }
        }
      }
    })

    expect(result.status).toBe('failed')
    expect(result.errorCode).toBe('vpmHttpTimeout')
    expect(fs.existsSync(packageDir('com.example.a'))).toBe(false)
    expect(readManifest().dependencies).toEqual({})
    const journal = journalOf(result.operationId)
    expect(journal.commitPoint).toBe('before')
    const steps = journal.steps as Array<{ step: string; status: string }>
    expect(steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ step: 'download', status: 'failed' })
      ])
    )
  })

  it('fails at extract without touching Packages or the manifest', async () => {
    const entry = catalogEntry('com.example.a', '1.0.0')
    const { result } = await run({
      catalog: [entry],
      requests: [{ kind: 'install', name: 'com.example.a' }],
      overrides: {
        extract: async () => {
          throw new VpmError('vpmArchiveBomb')
        }
      }
    })
    expect(result.status).toBe('failed')
    expect(result.errorCode).toBe('vpmArchiveBomb')
    expect(fs.existsSync(packageDir('com.example.a'))).toBe(false)
    expect(readManifest().dependencies).toEqual({})
  })

  it('rolls an upgrade back when the new package cannot be moved in', async () => {
    writeInstalledPackage('com.example.a', '1.0.0')
    const entry = catalogEntry('com.example.a', '2.0.0')
    const { result } = await run({
      manifest: {
        dependencies: { 'com.example.a': '1.0.0' },
        locked: { 'com.example.a': { version: '1.0.0', dependencies: {} } }
      },
      installed: [{ name: 'com.example.a', version: '1.0.0' }],
      catalog: [entry],
      requests: [{ kind: 'upgrade', name: 'com.example.a', version: '2.0.0' }],
      overrides: {
        // 让 move-in 的 rename 因为源目录不存在而失败。
        extract: async (input) => ({
          rootDir: path.join(input.targetDir, 'missing-root'),
          packageJsonPath: path.join(input.targetDir, 'missing-root', 'package.json'),
          name: 'com.example.a',
          version: '2.0.0',
          manifest: {},
          entries: 0,
          bytes: 0
        })
      }
    })

    expect(result.status).toBe('rolled_back')
    expect(result.errorCode).toBe('vpmTransactionFailed')
    // 旧包回到原位，manifest 保持原样。
    expect(installedVersion('com.example.a')).toBe('1.0.0')
    expect((readManifest().locked as Record<string, { version: string }>)['com.example.a'].version).toBe('1.0.0')
    const journal = journalOf(result.operationId)
    expect(journal.commitPoint).toBe('before')
    expect(journal.phase).toBe('rolled_back')
    expect(fs.existsSync(path.join(project, '.atrium-tx', result.operationId, 'trash', 'packages', 'com.example.a'))).toBe(false)
  })

  it('enters needs_attention when the commit point cannot be recorded', async () => {
    writeInstalledPackage('com.example.a', '1.0.0')
    const entry = catalogEntry('com.example.a', '2.0.0')
    const wrapped = new Proxy(operations, {
      get(target, prop, receiver) {
        if (prop === 'markCommitPoint') {
          return () => {
            throw new Error('injected journal failure')
          }
        }
        const value = Reflect.get(target, prop, receiver)
        return typeof value === 'function' ? value.bind(target) : value
      }
    }) as OperationStore

    const { result } = await run({
      manifest: {
        dependencies: { 'com.example.a': '1.0.0' },
        locked: { 'com.example.a': { version: '1.0.0', dependencies: {} } }
      },
      installed: [{ name: 'com.example.a', version: '1.0.0' }],
      catalog: [entry],
      requests: [{ kind: 'upgrade', name: 'com.example.a', version: '2.0.0' }],
      overrides: { operations: wrapped }
    })

    // manifest 已经换成新的：不能假装回滚成旧状态。
    expect(result.status).toBe('needs_attention')
    expect(result.errorCode).toBe('vpmJournalWriteFailed')
    expect(installedVersion('com.example.a')).toBe('2.0.0')
    expect((readManifest().locked as Record<string, { version: string }>)['com.example.a'].version).toBe('2.0.0')
    expect(operations.get(result.operationId)?.status).toBe('needs_attention')
  })

  it('enters needs_attention when rollback cannot record its progress', async () => {
    writeInstalledPackage('com.example.a', '1.0.0')
    const entry = catalogEntry('com.example.a', '2.0.0')
    const wrapped = new Proxy(operations, {
      get(target, prop, receiver) {
        if (prop === 'setFileState') {
          return (id: string, filePath: string, action: string, state: string) => {
            if (action === 'move-out' && state === 'failed') {
              throw new Error('injected rollback failure')
            }
            return target.setFileState(id, filePath, action as 'move-out', state as 'failed')
          }
        }
        const value = Reflect.get(target, prop, receiver)
        return typeof value === 'function' ? value.bind(target) : value
      }
    }) as OperationStore

    const { result } = await run({
      manifest: {
        dependencies: { 'com.example.a': '1.0.0' },
        locked: { 'com.example.a': { version: '1.0.0', dependencies: {} } }
      },
      installed: [{ name: 'com.example.a', version: '1.0.0' }],
      catalog: [entry],
      requests: [{ kind: 'upgrade', name: 'com.example.a', version: '2.0.0' }],
      overrides: {
        operations: wrapped,
        extract: async (input) => ({
          rootDir: path.join(input.targetDir, 'missing-root'),
          packageJsonPath: path.join(input.targetDir, 'missing-root', 'package.json'),
          name: 'com.example.a',
          version: '2.0.0',
          manifest: {},
          entries: 0,
          bytes: 0
        })
      }
    })

    expect(result.status).toBe('needs_attention')
    expect(result.errorCode).toBe('vpmRollbackFailed')
    // 文件没有被删除：旧包要么回到 Packages，要么留在事务区。
    const restored = installedVersion('com.example.a')
    const inTrash = fs.existsSync(
      path.join(project, '.atrium-tx', result.operationId, 'trash', 'packages', 'com.example.a', 'package.json')
    )
    expect(restored === '1.0.0' || inTrash).toBe(true)
    expect(operations.get(result.operationId)?.status).toBe('needs_attention')
  })

  it('keeps the trash and flags vault_pending when archiving fails', async () => {
    writeInstalledPackage('com.example.a', '1.0.0')
    const entry = catalogEntry('com.example.a', '2.0.0')
    const failingVault = {
      dataRoot,
      vaultRoot: path.join(dataRoot, 'vault'),
      ensureUsable: () => true,
      opDir: (slug: string, opId: string) => path.join(dataRoot, 'vault', slug, opId),
      exists: () => false,
      usage: () => ({ bytes: 0, files: 0, operations: 0 }),
      archive: async () => {
        throw new VpmError('vpmVaultArchiveFailed', { reason: 'disk' })
      }
    } as unknown as VaultStore

    const { result } = await run({
      manifest: {
        dependencies: { 'com.example.a': '1.0.0' },
        locked: { 'com.example.a': { version: '1.0.0', dependencies: {} } }
      },
      installed: [{ name: 'com.example.a', version: '1.0.0' }],
      catalog: [entry],
      requests: [{ kind: 'upgrade', name: 'com.example.a', version: '2.0.0' }],
      overrides: { vault: failingVault }
    })

    // 工程已经可用：包是新版本，提交点已过。
    expect(result.status).toBe('committed')
    expect(installedVersion('com.example.a')).toBe('2.0.0')
    expect(result.vaultPending).toBe(true)
    expect(result.warnings.map((warning) => warning.code)).toEqual(
      expect.arrayContaining(['vpmVaultArchiveFailed', 'vpmVaultPending'])
    )
    expect(
      fs.existsSync(path.join(project, '.atrium-tx', result.operationId, 'trash', 'packages', 'com.example.a', 'package.json'))
    ).toBe(true)
  })
})

describe('install transaction: legacy Assets cleanup', () => {
  function writeAsset(relative: string, contents = 'asset'): string {
    const file = path.join(project, relative)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, contents)
    fs.writeFileSync(`${file}.meta`, 'guid: 0123456789abcdef0123456789abcdef')
    return file
  }

  it('moves a declared legacy folder and its .meta files into the vault', async () => {
    writeInstalledPackage('com.example.old', '1.0.0')
    const asset = writeAsset('Assets/OldThing/model.prefab')
    fs.writeFileSync(path.join(project, 'Assets/OldThing.meta'), 'guid: folder')
    const { result } = await run({
      manifest: {
        dependencies: { 'com.example.old': '1.0.0' },
        locked: { 'com.example.old': { version: '1.0.0', dependencies: {} } },
        legacyFolders: { 'com.example.old': 'Assets/OldThing' }
      },
      installed: [{ name: 'com.example.old', version: '1.0.0' }],
      catalog: [],
      requests: [{ kind: 'remove', name: 'com.example.old' }]
    })

    expect(result.status).toBe('committed')
    expect(fs.existsSync(path.dirname(asset))).toBe(false)
    // 目录自己的 .meta 也要跟着走，不能在 Assets 里留孤儿 meta。
    expect(fs.existsSync(path.join(project, 'Assets/OldThing.meta'))).toBe(false)
    const archived = path.join(vaultOpDir(result.operationId), 'legacy', 'Assets', 'OldThing')
    expect(fs.existsSync(path.join(archived, 'model.prefab'))).toBe(true)
    expect(fs.existsSync(path.join(archived, 'model.prefab.meta'))).toBe(true)
    expect(fs.readFileSync(path.join(archived, 'model.prefab.meta'), 'utf8')).toContain('guid:')
    expect(
      fs.existsSync(path.join(vaultOpDir(result.operationId), 'legacy', 'Assets', 'OldThing.meta'))
    ).toBe(true)
    const journal = journalOf(result.operationId)
    expect(journal.legacyPaths).toEqual(['Assets/OldThing', 'Assets/OldThing.meta'])
  })

  it('keeps a legacy folder that contains protected imported assets', async () => {
    writeInstalledPackage('com.example.old', '1.0.0')
    writeAsset('Assets/OldThing/model.prefab')
    writeAsset('Assets/OldThing/imported.png')
    const guard: LegacyGuardPort = {
      isProtected: (_project, relative) => relative === 'Assets/OldThing/imported.png'
    }
    const { result } = await run({
      manifest: {
        dependencies: { 'com.example.old': '1.0.0' },
        locked: { 'com.example.old': { version: '1.0.0', dependencies: {} } },
        legacyFolders: { 'com.example.old': 'Assets/OldThing' }
      },
      installed: [{ name: 'com.example.old', version: '1.0.0' }],
      catalog: [],
      requests: [{ kind: 'remove', name: 'com.example.old' }],
      overrides: { legacyGuard: guard }
    })

    expect(result.status).toBe('committed')
    expect(fs.existsSync(path.join(project, 'Assets/OldThing/model.prefab'))).toBe(true)
    expect(fs.existsSync(path.join(project, 'Assets/OldThing/imported.png'))).toBe(true)
    expect(result.warnings.map((warning) => warning.code)).toContain('vpmLegacyCleanupSkipped')
  })

  it('ignores legacy paths that are not owned by a removed package', async () => {
    writeInstalledPackage('com.example.old', '1.0.0')
    writeAsset('Assets/OldThing/model.prefab')
    const { result } = await run({
      manifest: {
        dependencies: { 'com.example.old': '1.0.0' },
        locked: { 'com.example.old': { version: '1.0.0', dependencies: {} } },
        legacyFolders: { 'com.example.other': 'Assets/OldThing' }
      },
      installed: [{ name: 'com.example.old', version: '1.0.0' }],
      catalog: [],
      requests: [{ kind: 'remove', name: 'com.example.old' }]
    })

    expect(result.status).toBe('committed')
    expect(fs.existsSync(path.join(project, 'Assets/OldThing/model.prefab'))).toBe(true)
  })

  it('refuses legacy paths outside Assets/', async () => {
    writeInstalledPackage('com.example.old', '1.0.0')
    fs.writeFileSync(path.join(project, 'Packages', 'outside.txt'), 'keep me')
    const { result } = await run({
      manifest: {
        dependencies: { 'com.example.old': '1.0.0' },
        locked: { 'com.example.old': { version: '1.0.0', dependencies: {} } },
        legacyFiles: { 'com.example.old': 'Packages/outside.txt' }
      },
      installed: [{ name: 'com.example.old', version: '1.0.0' }],
      catalog: [],
      requests: [{ kind: 'remove', name: 'com.example.old' }]
    })

    expect(result.status).toBe('committed')
    expect(fs.readFileSync(path.join(project, 'Packages', 'outside.txt'), 'utf8')).toBe('keep me')
    expect(result.warnings.map((warning) => warning.code)).toContain('vpmLegacyCleanupSkipped')
  })
})

describe('preflight matrix', () => {
  const basePlan = (): ChangePlan => {
    const entry = catalogEntry('com.example.a', '1.0.0')
    return buildChangePlan({
      projectKey,
      unityVersion: UNITY,
      manifestHashBefore: 'a'.repeat(64),
      roots: {},
      locked: {},
      installed: [],
      catalog: [entry],
      requests: [{ kind: 'install', name: 'com.example.a' }],
      options: { protectedPackages: [PROTECTED_PACKAGE_ID] }
    })
  }

  function facts(overrides: Partial<PreflightFacts> = {}): PreflightFacts {
    const plan = basePlan()
    return {
      plan,
      expectedPlanHash: plan.planHash,
      snapshot: {
        projectKey,
        manifestHash: 'a'.repeat(64),
        manifest: {
          hasManifest: true,
          valid: true,
          dependencies: {},
          locked: {},
          data: {},
          raw: '{}',
          legacyFolders: [],
          legacyFiles: [],
          legacyPackages: [],
          error: null
        }
      } as unknown as ProjectSnapshot,
      activity: { unityRunning: false, importing: false },
      projectFreeBytes: FREE,
      dataRootFreeBytes: FREE,
      vaultUsable: true,
      txRootUsable: true,
      packagesRootUsable: true,
      packagePaths: [
        { name: 'com.example.a', relativePath: 'Packages/com.example.a', exists: false, symlink: false, kind: 'missing' }
      ],
      ...overrides
    }
  }

  function codes(input: PreflightFacts): string[] {
    return evaluatePreflight(input).issues.map((issue) => issue.code)
  }

  it('accepts a clean plan', () => {
    expect(evaluatePreflight(facts()).ok).toBe(true)
  })

  it('rejects a plan hash mismatch and a blocked plan', () => {
    expect(codes(facts({ expectedPlanHash: 'b'.repeat(64) }))).toContain('vpmPlanChanged')
    const plan = basePlan()
    const blocked = { ...plan, blocked: true, conflicts: [{ name: 'com.example.a' }] } as unknown as ChangePlan
    expect(codes(facts({ plan: blocked, expectedPlanHash: plan.planHash }))).toContain('vpmPlanBlocked')
  })

  it('rejects an invalid manifest and an externally changed manifest', () => {
    const broken = facts()
    expect(
      codes({
        ...broken,
        snapshot: {
          ...broken.snapshot,
          manifest: { ...broken.snapshot.manifest, valid: false }
        } as unknown as ProjectSnapshot
      })
    ).toContain('vpmManifestInvalid')
    expect(codes(facts({ snapshot: { ...broken.snapshot, manifestHash: 'c'.repeat(64) } as unknown as ProjectSnapshot }))).toContain(
      'vpmProjectChanged'
    )
  })

  it('rejects protected packages even when the plan asks for them', () => {
    const plan = basePlan()
    const tampered = {
      ...plan,
      changes: [
        { ...plan.changes[0], name: PROTECTED_PACKAGE_ID, action: 'remove', from: '1.0.0' }
      ],
      downloads: []
    } as unknown as ChangePlan
    expect(codes(facts({ plan: tampered, expectedPlanHash: plan.planHash }))).toContain('vpmProtectedPackage')
  })

  it('rejects unsafe package paths and installs onto an existing folder', () => {
    expect(
      codes(
        facts({
          packagePaths: [
            { name: 'com.example.a', relativePath: 'Packages/com.example.a', exists: true, symlink: true, kind: 'dir' }
          ]
        })
      )
    ).toContain('vpmProjectPathUnsafe')
    expect(
      codes(
        facts({
          packagePaths: [
            { name: 'com.example.a', relativePath: 'Packages/com.example.a', exists: true, symlink: false, kind: 'dir' }
          ]
        })
      )
    ).toContain('vpmProjectChanged')
  })

  it('rejects missing hashes, missing URLs and unusable roots', () => {
    const plan = basePlan()
    const noHash = {
      ...plan,
      downloads: [{ ...plan.downloads[0], sha256: '', url: '' }]
    } as unknown as ChangePlan
    const found = codes(facts({ plan: noHash, expectedPlanHash: plan.planHash }))
    expect(found).toContain('vpmCacheHashMissing')
    expect(found).toContain('vpmResolutionFailed')
    expect(codes(facts({ txRootUsable: false }))).toContain('vpmJournalInvalid')
    expect(codes(facts({ packagesRootUsable: false }))).toContain('vpmProjectPathUnsafe')
  })

  it('computes the space budget from the plan', () => {
    const plan = basePlan()
    const required = requiredBytesFor(plan)
    expect(required.projectBytes).toBeGreaterThan(512 * 1024 * 1024)
    expect(required.dataRootBytes).toBeGreaterThan(512 * 1024 * 1024)
    expect(requiredBytesFor({ ...plan, disk: { downloadBytes: 0, installBytes: 0, freeBytes: null } })).toEqual({
      projectBytes: 0,
      dataRootBytes: 0
    })
  })
})
