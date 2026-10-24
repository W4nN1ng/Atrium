import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { CatalogService } from '../../src/main/vpm/catalog'
import { closeVpmDb, openVpmDb, type VpmDb } from '../../src/main/vpm/db'
import { RepoStore } from '../../src/main/vpm/repos'
import type { PackageVersionInput } from '../../src/main/vpm/repos'
import { collectProjectFiles } from '../../src/main/vpm/backup/collector'
import { buildChangePlan } from '../../src/shared/vpm/domain/plan'
import { resolveVpmDependencies } from '../../src/shared/vpm/domain/resolver'
import { sha256Hex } from '../../src/shared/vpm/domain/hash'

/**
 * P9-C：规模上限（10,000 行 / 5 个仓库 / 500 依赖 manifest）。
 *
 * P8-E 只量到 2,500 包 × 2 版本 = 5,000 行（p95 145ms），并明确留了一句
 * "10,000 行会接近/超过预算 → 记入 P9-C"。这里就是那张卡的量具。
 *
 * 和 `vpm-perf.spec.ts` 一样默认 skip：全量 Vitest 会并行压 200+ 个文件，
 * 同一查询的 p95 能从 150ms 漂到 300ms，当门禁会随机咬红。隔离跑：
 *
 *   VPM_PERF_ISOLATED=1 npx vitest run tests/perf/vpm-scale-p9c.spec.ts
 *
 * 阈值不放宽：超了就先看是不是别的进程在抢 CPU，再看代码。
 */

const ISOLATED = process.env.VPM_PERF_ISOLATED === '1'

/** 5,000 个包 × 2 个版本 = 10,000 行，是规格上限的两倍。 */
const PACKAGE_COUNT = 5_000
const VERSION_ROWS = PACKAGE_COUNT * 2
const REPO_COUNT = 5
const ROOTS = 500
/** 一个工程里 500 个直接依赖 —— 真实项目通常 20–80 个，这是压力值。 */
const MANIFEST_DEPS = 500

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
    displayName: `Scale ${name} ${version}`,
    description: `Scale fixture ${name}`,
    authorJson: '{"name":"Atrium"}',
    keywordsJson: '["scale","avatar"]',
    aliasesJson: `["scale-${name}"]`,
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

function measure(
  label: string,
  fn: () => void,
  runs = 10,
  warmup = 2
): { p50: number; p95: number; max: number } {
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

beforeAll(async () => {
  if (!ISOLATED) return
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'atrium-vpm-scale-'))
  db = await openVpmDb({
    file: path.join(root, 'vpm.db'),
    backupsDir: path.join(root, 'backups')
  })
  store = new RepoStore(db, () => 1_700_000_000_000)

  const perRepo = PACKAGE_COUNT / REPO_COUNT
  const t0 = performance.now()
  for (let repoIndex = 0; repoIndex < REPO_COUNT; repoIndex++) {
    const repoId = `scale-${repoIndex}`
    store.upsertRepo({
      id: repoId,
      url: `https://packages.example.test/${repoId}.json`,
      name: `Scale Repo ${repoIndex}`,
      sortOrder: repoIndex
    })
    const rows: PackageVersionInput[] = []
    for (let index = 0; index < perRepo; index++) {
      const serial = repoIndex * perRepo + index
      const name = `com.scale.pkg${String(serial).padStart(5, '0')}`
      rows.push(packageRow(name, '1.0.0'))
      rows.push(packageRow(name, '1.1.0'))
    }
    store.replaceRepoPackages(repoId, rows)
  }
  console.log(`seed: ${VERSION_ROWS} rows / ${REPO_COUNT} repos in ${(performance.now() - t0).toFixed(0)}ms`)

  catalog = new CatalogService(store)
  catalogEntries = catalog.resolverCatalog()
  rootNames = [...new Set(catalogEntries.map((item) => item.name))].slice(0, ROOTS)
  if (rootNames.length !== ROOTS) throw new Error(`resolver roots not enough: ${rootNames.length}`)

  projectRoot = path.join(root, 'project')
  fs.mkdirSync(path.join(projectRoot, 'Assets', 'Scale'), { recursive: true })
  fs.mkdirSync(path.join(projectRoot, 'Packages'), { recursive: true })
  fs.mkdirSync(path.join(projectRoot, 'ProjectSettings'), { recursive: true })
  const deps: Record<string, string> = {}
  for (let index = 0; index < MANIFEST_DEPS; index++) {
    deps[`com.scale.pkg${String(index).padStart(5, '0')}`] = '1.0.0'
  }
  fs.writeFileSync(
    path.join(projectRoot, 'Packages', 'vpm-manifest.json'),
    JSON.stringify({ dependencies: deps, locked: {} }, null, 2)
  )
  fs.writeFileSync(
    path.join(projectRoot, 'Packages', 'manifest.json'),
    JSON.stringify({ dependencies: {} }, null, 2)
  )
  fs.writeFileSync(
    path.join(projectRoot, 'ProjectSettings', 'ProjectVersion.txt'),
    'm_EditorVersion: 2022.3.22f1\n'
  )
  // 5,000 个文件（不是 10k）：这个文件量级 P8-E 已量过，这里只要"大 manifest + 大目录"同场。
  for (let index = 0; index < 50; index++) {
    fs.mkdirSync(path.join(projectRoot, 'Assets', 'Scale', `d${String(index).padStart(3, '0')}`), {
      recursive: true
    })
  }
  for (let index = 0; index < 5_000; index++) {
    const dir = path.join(projectRoot, 'Assets', 'Scale', `d${String(index % 50).padStart(3, '0')}`)
    fs.writeFileSync(path.join(dir, `f${String(index).padStart(5, '0')}.txt`), '')
  }
}, 600_000)

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

describePerf('P9-C 规模上限（10k 行 / 5 仓库 / 500 依赖）', { timeout: 300_000 }, () => {
  it('10,000 行的目录搜索仍在 200ms 预算内', () => {
    const first = catalog.query({ text: 'scale', limit: 100 })
    expect(first.total).toBe(PACKAGE_COUNT)
    expect(first.items).toHaveLength(100)

    const all = measure('catalog.query(text=scale, 5k 包/10k 行)', () => {
      const page = catalog.query({ text: 'scale', limit: 100 })
      if (page.total !== PACKAGE_COUNT) throw new Error(`unexpected total ${page.total}`)
    })
    const exact = measure('catalog.query(text=单包名, 10k 行)', () => {
      catalog.query({ text: 'com.scale.pkg02500', limit: 20 })
    })
    const detail = measure('catalog.getPackage(单包详情, 10k 行)', () => {
      const item = catalog.getPackage('com.scale.pkg02500')
      if (!item || item.versions.length !== 2) throw new Error('unexpected detail')
    })

    expect(all.p95, `10k 行 query p95 ${all.p95.toFixed(1)}ms`).toBeLessThan(200)
    expect(exact.p95).toBeLessThan(120)
    expect(detail.p95).toBeLessThan(60)
  })

  it('多仓库过滤与跨仓库合并不额外膨胀', () => {
    const one = measure('catalog.query(repoIds=[scale-0], 2k 行)', () => {
      const page = catalog.query({ text: 'scale', repoIds: ['scale-0'], limit: 100 })
      if (page.total !== PACKAGE_COUNT / REPO_COUNT) throw new Error(`unexpected total ${page.total}`)
    })
    const resolved = measure('catalog.resolverCatalog(10k 行)', () => {
      const rows = catalog.resolverCatalog()
      if (rows.length !== VERSION_ROWS) throw new Error(`unexpected rows ${rows.length}`)
    }, 6, 1)

    expect(one.p95).toBeLessThan(120)
    expect(resolved.p95).toBeLessThan(500)
  })

  it('500 个根依赖的解析与计划仍在预算内', () => {
    const roots = Object.fromEntries(rootNames.map((name) => [name, '^1.0.0']))
    const resolver = measure('resolve(500 roots, 10k catalog)', () => {
      const result = resolveVpmDependencies({
        roots,
        catalog: catalogEntries,
        options: { unityVersion: '2022.3.22f1' }
      })
      if (Object.keys(result.roots).length !== ROOTS) throw new Error('unexpected roots')
    }, 6, 1)

    expect(resolver.p95, `resolve p95 ${resolver.p95.toFixed(1)}ms`).toBeLessThan(200)
  })

  it('大 manifest（500 依赖）+ 5,000 文件工程的收集不退化', async () => {
    const plan = measure('buildChangePlan(500 roots)', () => {
      buildChangePlan({
        projectKey: 'scale-project',
        unityVersion: '2022.3.22f1',
        manifestHashBefore: 'a'.repeat(64),
        roots: Object.fromEntries(rootNames.map((name) => [name, '^1.0.0'])),
        locked: {},
        installed: [],
        catalog: catalogEntries,
        requests: [],
        preset: 'upgradeAll',
        options: { allowPrerelease: false, protectedPackages: [], legacyPackages: [] }
      })
    }, 6, 1)

    const started = performance.now()
    const collected = await collectProjectFiles({ root: projectRoot, mode: 'backup' })
    const collectMs = performance.now() - started
    console.log(`collectProjectFiles(5k files + 500 deps manifest): ${collectMs.toFixed(0)}ms`)

    expect(plan.p95).toBeLessThan(800)
    expect(collected.truncated).toBe(false)
    expect(collected.fileCount).toBeGreaterThan(5_000)
    expect(collectMs).toBeLessThan(10_000)
  })
})
