import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { closeVpmDb, openVpmDb, type VpmDb } from '../../../src/main/vpm/db'
import {
  InstallTransactionService,
  OperationStore,
  RecoveryService,
  type ApplyPlanResult,
  type InstallTransactionOptions,
  type PackageSourcePort,
  type TransactionHooks,
  type TransactionProgress
} from '../../../src/main/vpm/install'
import { ProjectFsReader } from '../../../src/main/vpm/projects'
import { VaultStore } from '../../../src/main/vpm/vault'
import { sha256Hex } from '../../../src/shared/vpm/domain/hash'
import {
  buildChangePlan,
  type ChangePlan,
  type ChangePlanRequest
} from '../../../src/shared/vpm/domain/plan'
import {
  projectKeyOf,
  projectSlugOf,
  readProjectSnapshot,
  type ProjectSnapshot
} from '../../../src/shared/vpm/domain/project'
import type {
  ResolverCatalogPackage,
  ResolverInstalled
} from '../../../src/shared/vpm/domain/resolver'
import { VpmError } from '../../../src/shared/vpm/errors'
import { ulid } from '../../../src/shared/ulid'
import { makeZip } from './zip-fixture'

export const UNITY = '2022.3.22f1'
export const FREE = 50 * 1024 * 1024 * 1024

export interface ScenarioOptions {
  manifest?: Record<string, unknown>
  installed?: ResolverInstalled[]
  catalog?: ResolverCatalogPackage[]
  requests?: ChangePlanRequest[]
  legacyPackages?: string[]
  preset?: 'upgradeAll'
}

export interface PlanHandle {
  planId: string
  plan: ChangePlan
  beforeHash: string
  manifestText: string
}

/**
 * P4-C/P4-D 测试共用的临时工程 + vpm.db + 回滚仓夹具。
 *
 * 只在测试里用：不启动 Electron、不碰真实库、不联网。
 */
export class TxHarness {
  readonly root: string
  readonly dataRoot: string
  readonly db: VpmDb
  readonly operations: OperationStore
  readonly vault: VaultStore
  readonly plans = new Map<string, ChangePlan>()
  private readonly zips = new Map<string, { file: string; sha256: string; size: number; url: string }>()
  private clock = 1_000

  private constructor(root: string, db: VpmDb) {
    this.root = root
    this.dataRoot = path.join(root, 'data')
    this.db = db
    this.operations = new OperationStore(db, () => ++this.clock)
    this.vault = new VaultStore({ dataRoot: this.dataRoot })
  }

  static async create(): Promise<TxHarness> {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atrium-vpm-p4d-'))
    fs.mkdirSync(path.join(root, 'data'))
    const db = await openVpmDb({
      file: path.join(root, 'vpm.db'),
      backupsDir: path.join(root, 'backups')
    })
    return new TxHarness(root, db)
  }

  now(): number {
    return ++this.clock
  }

  dispose(): void {
    closeVpmDb(this.db)
    fs.rmSync(this.root, { recursive: true, force: true })
  }

  addProject(name = 'DemoProject'): string {
    const project = path.join(this.root, name)
    fs.mkdirSync(path.join(project, 'Packages'), { recursive: true })
    fs.mkdirSync(path.join(project, 'ProjectSettings'), { recursive: true })
    fs.mkdirSync(path.join(project, 'Assets'), { recursive: true })
    fs.writeFileSync(
      path.join(project, 'ProjectSettings', 'ProjectVersion.txt'),
      `m_EditorVersion: ${UNITY}\n`
    )
    this.writeManifest(project, { dependencies: {}, locked: {} })
    return project
  }

  keyOf(projectPath: string): string {
    return projectKeyOf(fs.realpathSync.native(projectPath))
  }

  manifestPath(projectPath: string): string {
    return path.join(projectPath, 'Packages', 'vpm-manifest.json')
  }

  writeManifest(projectPath: string, value: Record<string, unknown>): string {
    const text = JSON.stringify(value, null, 2)
    fs.writeFileSync(this.manifestPath(projectPath), text)
    return sha256Hex(text)
  }

  readManifest(projectPath: string): Record<string, unknown> {
    return JSON.parse(fs.readFileSync(this.manifestPath(projectPath), 'utf8')) as Record<string, unknown>
  }

  manifestText(projectPath: string): string {
    return fs.readFileSync(this.manifestPath(projectPath), 'utf8')
  }

  snapshot(projectPath: string): ProjectSnapshot {
    const reader = new ProjectFsReader(projectPath)
    return readProjectSnapshot(reader, reader.root)
  }

  packageDir(projectPath: string, name: string): string {
    return path.join(projectPath, 'Packages', name)
  }

  installedVersion(projectPath: string, name: string): string | null {
    try {
      const raw = fs.readFileSync(path.join(this.packageDir(projectPath, name), 'package.json'), 'utf8')
      return (JSON.parse(raw) as { version?: string }).version ?? null
    } catch {
      return null
    }
  }

  writeInstalledPackage(projectPath: string, name: string, version: string): void {
    const dir = this.packageDir(projectPath, name)
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(
      path.join(dir, 'package.json'),
      JSON.stringify({ name, version, vpmDependencies: {} })
    )
    fs.writeFileSync(path.join(dir, 'index.js'), `// ${version}\n`)
  }

  buildZip(name: string, version: string, deps: Record<string, string> = {}): {
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
    const dir = path.join(this.root, 'zips')
    fs.mkdirSync(dir, { recursive: true })
    const file = path.join(dir, `${name}-${version}.zip`)
    fs.writeFileSync(file, buffer)
    const url = `https://packages.example.test/${name}-${version}.zip`
    this.zips.set(sha256, { file, sha256, size: buffer.length, url })
    return { sha256, url, size: buffer.length }
  }

  catalogEntry(name: string, version: string, deps: Record<string, string> = {}): ResolverCatalogPackage {
    const zip = this.buildZip(name, version, deps)
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

  packageSource(): PackageSourcePort {
    return {
      ensurePackage: async (input) => {
        const hit = this.zips.get(input.sha256.toLowerCase())
        if (!hit) throw new VpmError('vpmHttpNetwork')
        return { path: hit.file, sha256: hit.sha256, size: hit.size, reused: false }
      }
    }
  }

  makePlan(projectPath: string, options: ScenarioOptions = {}): PlanHandle {
    const manifest = options.manifest ?? { dependencies: {}, locked: {} }
    const beforeHash = this.writeManifest(projectPath, manifest)
    const manifestText = JSON.stringify(manifest, null, 2)
    const plan = buildChangePlan({
      projectKey: this.keyOf(projectPath),
      unityVersion: UNITY,
      manifestHashBefore: beforeHash,
      roots: (manifest.dependencies ?? {}) as Record<string, string>,
      locked: (manifest.locked ?? {}) as Record<
        string,
        { version: string; dependencies?: Record<string, string> }
      >,
      installed: options.installed ?? [],
      catalog: options.catalog ?? [],
      requests: options.requests ?? [],
      preset: options.preset,
      options: {
        protectedPackages: ['com.avca.bridge'],
        legacyPackages: options.legacyPackages ?? []
      }
    })
    const planId = ulid()
    this.plans.set(planId, plan)
    return { planId, plan, beforeHash, manifestText }
  }

  service(overrides: Partial<InstallTransactionOptions> = {}): InstallTransactionService {
    return new InstallTransactionService({
      operations: this.operations,
      plans: {
        get: (planId: string) => {
          const plan = this.plans.get(planId)
          if (!plan) throw new VpmError('vpmPlanNotFound')
          return plan
        }
      },
      projects: {
        load: (key: string) => {
          const projectPath = this.projectByKey(key)
          if (!projectPath) return null
          return { projectPath, snapshot: this.snapshot(projectPath) }
        }
      },
      packages: this.packageSource(),
      vault: this.vault,
      dataRoot: this.dataRoot,
      freeBytes: () => FREE,
      renameDelayMs: 0,
      sleep: async () => undefined,
      now: () => this.now(),
      ...overrides
    })
  }

  recovery(overrides: {
    isProjectActive?: (projectPath: string) => boolean
    vault?: VaultStore
  } = {}): RecoveryService {
    return new RecoveryService({
      operations: this.operations,
      vault: overrides.vault ?? this.vault,
      isProjectActive: overrides.isProjectActive
    })
  }

  async apply(
    projectPath: string,
    planId: string,
    overrides: Partial<InstallTransactionOptions> = {},
    input: { onProgress?: (progress: TransactionProgress) => void } = {}
  ): Promise<ApplyPlanResult> {
    const service = this.service(overrides)
    return service.apply({
      projectKey: this.keyOf(projectPath),
      planId,
      onProgress: input.onProgress
    })
  }

  journalOf(projectPath: string, opId: string): Record<string, unknown> {
    const file = path.join(projectPath, '.atrium-tx', opId, 'journal.json')
    return JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>
  }

  transactionDir(projectPath: string, opId: string): string {
    return path.join(projectPath, '.atrium-tx', opId)
  }

  vaultOpDir(projectPath: string, opId: string): string {
    return path.join(this.dataRoot, 'vault', projectSlugOf(this.keyOf(projectPath)), opId)
  }

  exists(target: string): boolean {
    return fs.existsSync(target)
  }

  private projectByKey(key: string): string | null {
    for (const entry of fs.readdirSync(this.root, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name === 'data' || entry.name === 'zips') continue
      const candidate = path.join(this.root, entry.name)
      if (!fs.existsSync(path.join(candidate, 'Packages'))) continue
      try {
        if (projectKeyOf(fs.realpathSync.native(candidate)) === key) return candidate
      } catch {
        /* 不是工程目录 */
      }
    }
    return null
  }
}

/** 组合一组"在某点抛错"的 hooks。 */
export function failAt(
  points: readonly string[],
  code: 'vpmTransactionFailed' | 'vpmJournalWriteFailed' = 'vpmTransactionFailed'
): TransactionHooks {
  const set = new Set(points)
  return {
    onPoint: (point) => {
      if (set.has(point)) throw new VpmError(code, { point })
    }
  }
}

/** 组合一组"在某点让进程直接死掉"的 hooks。 */
export function crashAt(point: string): TransactionHooks {
  return {
    crashOnError: true,
    onPoint: (current) => {
      if (current === point) throw new Error(`simulated crash at ${point}`)
    }
  }
}
