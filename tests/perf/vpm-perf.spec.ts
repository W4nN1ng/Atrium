import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { CatalogService } from '../../src/main/vpm/catalog'
import { closeVpmDb, openVpmDb, type VpmDb } from '../../src/main/vpm/db'
import { RepoStore } from '../../src/main/vpm/repos'
import type { PackageVersionInput } from '../../src/main/vpm/repos'
import { collectProjectFiles } from '../../src/main/vpm/backup/collector'
import { evaluatePreflight, type PreflightFacts } from '../../src/main/vpm/install/preflight'
import { buildChangePlan } from '../../src/shared/vpm/domain/plan'
import { resolveVpmDependencies } from '../../src/shared/vpm/domain/resolver'
import type { ProjectSnapshot } from '../../src/shared/vpm/domain/project'
import { sha256Hex } from '../../src/shared/vpm/domain/hash'

/**
 * P8-E：VPM 的性能基线。
 *
 * 数字按这台 16 GB Windows 11 机器写；目标值来自 P8 规格：
 * 目录 5,000 个包版本 <200ms、解析 200 包 <200ms、工程扫描 10k 文件不卡 UI。
 *
 * 为什么默认 skip：全量 Vitest 会并行跑多个 fork + 50k 素材基准，这台机器上
 * 同一个 catalog 查询的 p95 会从 ~150ms 漂到 ~300ms；把它当全量门禁会随机咬红。
 * 性能证据用显式隔离命令跑：
 *   VPM_PERF_ISOLATED=1 npx vitest run tests/perf/vpm-perf.spec.ts
 * 阈值没有被放宽；失败时先看是不是还有别的进程抢 CPU。
 */

const ISOLATED = process.env.VPM_PERF_ISOLATED === '1'

const PACKAGE_COUNT = 2_500
const VERSION_ROWS = PACKAGE_COUNT * 2
const RESOLVER_ROOTS = 200
const FILE_COUNT = 10_000

let root = ''
let db: VpmDb | null = null
let store: RepoStore
let catalog: CatalogService
let catalogEntries: ReturnType<CatalogService['resolverCatalog']>
let rootNames: string[] = []
let projectRoot = ''

function packageRow(name: string, version: string): PackageVersionInput {
  return {
    name,
    version,
    displayName: `Perf ${name} ${version}`,
    description: `Performance fixture ${name}`,
    authorJson: '{"name":"Atrium"}',
    keywordsJson: '["perf","avatar"]',
    aliasesJson: `["perf-${name}"]`,
    unityMin: '2022.3',
    zipUrl: `https://packages.example.test/${name}-${version}.zip`,
    zipSha256: sha256Hex(`${name}@${version}`),
    zipSize: 1_000,
    yanked: false,
    yankedReason: null,
    hidden: false,
    deprecated: false,
    manifestJson: '{"vpmDependencies":{}}',
    fetchedAt: 1_700_000_000_000
  }
}

function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))]
}

function measure(label: string, fn: () => void, runs = 12, warmup = 2): { p50: number; p95: number; max: number } {
  for (let index = 0; index < warmup; index++) fn()
  const times: number[] = []
  for (let index = 0; index < runs; index++) {
    const start = performance.now()
    fn()
    times.push(performance.now() - start)
  }
  const result = {
    p50: percentile(times, 0.5),
    p95: percentile(times, 0.95),
    max: Math.max(...times)
  }
  console.log(
    `${label}: p50=${result.p50.toFixed(2)}ms p95=${result.p95.toFixed(2)}ms max=${result.max.toFixed(2)}ms`
  )
  return result
}

function memoryMb(): number {
  try {
    ;(globalThis as { gc?: () => void }).gc?.()
  } catch {
    /* 没有 --expose-gc 时就是普通采样 */
  }
  return process.memoryUsage().heapUsed / 1024 / 1024
}

beforeAll(async () => {
  if (!ISOLATED) return
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'atrium-vpm-perf-'))
  db = await openVpmDb({
    file: path.join(root, 'vpm.db'),
    backupsDir: path.join(root, 'backups')
  })
  store = new RepoStore(db, () => 1_700_000_000_000)
  store.upsertRepo({
    id: 'perf',
    url: 'https://packages.example.test/repo.json',
    name: 'Perf Repo',
    sortOrder: 0
  })
  const rows: PackageVersionInput[] = []
  for (let index = 0; index < PACKAGE_COUNT; index++) {
    const name = `com.perf.pkg${String(index).padStart(4, '0')}`
    rows.push(packageRow(name, '1.0.0'))
    rows.push(packageRow(name, '1.1.0'))
  }
  const t0 = performance.now()
  store.replaceRepoPackages('perf', rows)
  console.log(`seed: ${rows.length} rows in ${(performance.now() - t0).toFixed(0)}ms`)
  catalog = new CatalogService(store)
  catalogEntries = catalog.resolverCatalog()
  rootNames = [...new Set(catalogEntries.map((item) => item.name))].slice(0, RESOLVER_ROOTS)
  if (rootNames.length !== RESOLVER_ROOTS) throw new Error('resolver roots not enough')

  projectRoot = path.join(root, 'project')
  fs.mkdirSync(path.join(projectRoot, 'Assets', 'Perf'), { recursive: true })
  fs.mkdirSync(path.join(projectRoot, 'Packages'), { recursive: true })
  fs.mkdirSync(path.join(projectRoot, 'ProjectSettings'), { recursive: true })
  fs.writeFileSync(path.join(projectRoot, 'Packages', 'manifest.json'), '{}')
  fs.writeFileSync(
    path.join(projectRoot, 'ProjectSettings', 'ProjectVersion.txt'),
    'm_EditorVersion: 2022.3.22f1\n'
  )
  for (let index = 0; index < 100; index++) {
    fs.mkdirSync(path.join(projectRoot, 'Assets', 'Perf', `d${String(index).padStart(3, '0')}`), {
      recursive: true
    })
  }
  for (let index = 0; index < FILE_COUNT; index++) {
    const dir = path.join(projectRoot, 'Assets', 'Perf', `d${String(index % 100).padStart(3, '0')}`)
    fs.writeFileSync(path.join(dir, `f${String(index).padStart(5, '0')}.txt`), '')
  }
}, 300_000)

afterAll(() => {
  if (!ISOLATED) return
  closeVpmDb(db)
  db = null
  try {
    fs.rmSync(root, { recursive: true, force: true })
  } catch {
    /* 系统会回收 temp */
  }
})

const describePerf = ISOLATED ? describe : describe.skip

describePerf('VPM performance baseline (P8-E)', { timeout: 180_000 }, () => {
  it('目录查询/详情在 5,000 个包版本上 p95 <200ms', () => {
    const base = memoryMb()
    expect(catalog.query({ text: 'perf', limit: 100 })).toMatchObject({
      total: PACKAGE_COUNT,
      limit: 100
    })

    const all = measure('catalog.query(text=perf, 2.5k 包)', () => {
      const page = catalog.query({ text: 'perf', limit: 100 })
      if (page.total !== PACKAGE_COUNT) throw new Error('unexpected total')
    })
    const one = measure('catalog.query(text=exact, 单包)', () => {
      catalog.query({ text: 'com.perf.pkg0100', limit: 20 })
    })
    const detail = measure('catalog.getPackage(单包详情)', () => {
      const item = catalog.getPackage('com.perf.pkg0100')
      if (!item || item.versions.length !== 2) throw new Error('unexpected detail')
    })
    const resolverRows = measure('catalog.resolverCatalog(5k 行)', () => {
      const rows = catalog.resolverCatalog()
      if (rows.length !== VERSION_ROWS) throw new Error('unexpected resolver rows')
    }, 6, 1)

    const used = memoryMb() - base
    console.log(`catalog memory delta: ${used.toFixed(1)} MB`)
    expect(all.p95, `query p95 ${all.p95}ms`).toBeLessThan(200)
    expect(one.p95).toBeLessThan(100)
    expect(detail.p95).toBeLessThan(50)
    expect(resolverRows.p95).toBeLessThan(300)
    expect(used).toBeLessThan(128)
  })

  it('解析 200 包 / 生成计划 / 预检在预算内', () => {
    const roots = Object.fromEntries(rootNames.map((name) => [name, '^1.0.0']))
    const resolver = measure('resolve(200 roots, 5k catalog)', () => {
      const result = resolveVpmDependencies({
        roots,
        catalog: catalogEntries,
        options: { unityVersion: '2022.3.22f1' }
      })
      if (result.blocked || result.selected.length !== RESOLVER_ROOTS) {
        throw new Error(`resolver blocked=${result.blocked} selected=${result.selected.length}`)
      }
    }, 10, 2)

    let plan: ReturnType<typeof buildChangePlan> | null = null
    const planTime = measure('buildChangePlan(200 roots)', () => {
      plan = buildChangePlan({
        projectKey: 'perf\\project',
        unityVersion: '2022.3.22f1',
        manifestHashBefore: 'a'.repeat(64),
        roots,
        catalog: catalogEntries,
        options: { unityVersion: '2022.3.22f1' }
      })
      if (!plan || plan.changes.length !== RESOLVER_ROOTS) {
        throw new Error(`unexpected plan changes ${plan?.changes.length}`)
      }
    }, 8, 2)

    const current = plan as unknown as ReturnType<typeof buildChangePlan>
    const facts: PreflightFacts = {
      plan: current,
      expectedPlanHash: current.planHash,
      snapshot: {
        projectKey: 'perf\\project',
        manifestHash: 'a'.repeat(64),
        manifest: { hasManifest: true, valid: true }
      } as unknown as ProjectSnapshot,
      activity: { unityRunning: false, importing: false },
      projectFreeBytes: 50 * 1024 * 1024 * 1024,
      dataRootFreeBytes: 50 * 1024 * 1024 * 1024,
      vaultUsable: true,
      txRootUsable: true,
      packagesRootUsable: true,
      packagePaths: current.changes.map((change) => ({
        name: change.name,
        relativePath: `Packages/${change.name}`,
        exists: false,
        symlink: false,
        kind: 'missing' as const
      }))
    }
    const preflight = measure('evaluatePreflight(200 changes)', () => {
      const result = evaluatePreflight(facts)
      if (!result.ok) throw new Error(`preflight not ok: ${JSON.stringify(result.issues)}`)
    }, 50, 5)

    console.log(
      `resolver p95=${resolver.p95.toFixed(2)}ms plan p95=${planTime.p95.toFixed(2)}ms preflight p95=${preflight.p95.toFixed(2)}ms`
    )
    expect(resolver.p95, `resolver p95 ${resolver.p95}ms`).toBeLessThan(200)
    expect(planTime.p95).toBeLessThan(500)
    expect(preflight.p95).toBeLessThan(20)
  })

  it('工程收集 10,000 文件在预算内且内存不失控', async () => {
    const before = memoryMb()
    const t0 = performance.now()
    const result = await collectProjectFiles({ root: projectRoot, mode: 'backup' })
    const elapsed = performance.now() - t0
    const used = memoryMb() - before
    console.log(`collect 10k files: ${elapsed.toFixed(0)}ms, ${result.fileCount} files, heap +${used.toFixed(1)} MB`)
    expect(result.truncated).toBe(false)
    expect(result.fileCount).toBeGreaterThanOrEqual(FILE_COUNT)
    expect(elapsed).toBeLessThan(15_000)
    expect(used).toBeLessThan(256)
  })
})
