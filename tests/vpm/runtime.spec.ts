import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { initVpm, type VpmRuntime } from '../../src/main/vpm'
import { VPM_SCHEMA_VERSION } from '../../src/main/vpm/db'
import { P, setAppPathsForTest } from '../../src/main/services/paths'
import { projectKeyOf } from '../../src/shared/vpm/domain/project'
import { sha256Hex } from '../../src/shared/vpm/domain/hash'

let root: string
let dataRoot: string
let runtime: VpmRuntime | null
/** 空的发现根：测试**绝不能**扫到这台机器上真实的 Unity Hub。 */
let discovery: { appDataDir: string; localAppData: string; programFiles: string[]; extraRoots: string[] }

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'atrium-vpm-runtime-'))
  setAppPathsForTest(root)
  dataRoot = path.join(root, 'data')
  fs.mkdirSync(dataRoot, { recursive: true })
  const empty = path.join(root, 'no-unity-here')
  fs.mkdirSync(empty, { recursive: true })
  discovery = { appDataDir: empty, localAppData: empty, programFiles: [], extraRoots: [] }
  runtime = null
})

afterEach(() => {
  runtime?.dispose()
  runtime = null
  fs.rmSync(root, { recursive: true, force: true })
})

describe('VPM composition root', () => {
  it('assembles DB, cache, repos and catalog without seeding when consent is absent', async () => {
    runtime = await initVpm({
      dataRoot,
      userAgent: 'Atrium/test',
      unityDiscovery: discovery,
      isNetworkAllowed: () => false
    })

    expect(fs.existsSync(P.vpmDb())).toBe(true)
    expect(fs.statSync(dataRoot).isDirectory()).toBe(true)
    expect(fs.statSync(path.join(dataRoot, 'cache')).isDirectory()).toBe(true)
    expect(runtime.repos.listRepos()).toEqual([])
    expect(runtime.catalog.query()).toMatchObject({ items: [], total: 0 })
    expect(runtime.unity.list()).toEqual([])
    expect(runtime.cacheEntries.list()).toEqual([])
    expect(runtime.packageCache.usage()).toMatchObject({ bytes: 0, files: 0 })
  })

  it('seeds official/curated only when consent is already granted', async () => {
    runtime = await initVpm({
      dataRoot,
      userAgent: 'Atrium/test',
      unityDiscovery: discovery,
      isNetworkAllowed: () => true
    })

    const repos = runtime.repos.listRepos()
    expect(repos).toHaveLength(2)
    expect(repos[0]).toMatchObject({ id: 'vrchat-official', sortOrder: 0 })
    expect(repos[1]).toMatchObject({ id: 'vrchat-curated', sortOrder: 1 })
    expect(repos.every((repo) => repo.lastFetchAt === null)).toBe(true)
  })

  it('exposes the injected project target linkage to the runtime', async () => {
    const linkage = {
      currentTarget: () => null,
      bindLaunchTarget: () => {},
      clearLaunchTarget: () => {}
    }
    runtime = await initVpm({
      dataRoot,
      userAgent: 'Atrium/test',
      unityDiscovery: discovery,
      isNetworkAllowed: () => false,
      projectLinkage: linkage
    })
    expect(runtime.linkage).toBe(linkage)
  })

  it('exposes project ledger merging through injected core/VCC ports', async () => {
    runtime = await initVpm({
      dataRoot,
      userAgent: 'Atrium/test',
      unityDiscovery: discovery,
      isNetworkAllowed: () => false,
      coreProjects: {
        list: () => [
          {
            id: 'core-1',
            path: 'C:\\Projects\\CoreOnly',
            name: 'CoreOnly',
            unityVersion: '2022.3.22f1',
            running: true,
            detectedBy: ['bridge'],
            bridgeVersion: '1.2.0'
          }
        ]
      },
      vccProjects: { read: () => ({ paths: [], error: null }) }
    })

    expect(runtime.projects.list()).toEqual([
      expect.objectContaining({
        coreId: 'core-1',
        name: 'CoreOnly',
        running: true,
        detectedBy: ['bridge'],
        linked: true,
        ledger: null
      })
    ])
    expect(runtime.projects.importVcc()).toMatchObject({
      imported: 0,
      skipped: 0,
      sourceError: null
    })
  })

  it('rolls back an unfinished operation during startup', async () => {
    const project = path.join(root, 'project')
    fs.mkdirSync(path.join(project, 'Packages'), { recursive: true })
    fs.mkdirSync(path.join(project, 'ProjectSettings'), { recursive: true })
    fs.writeFileSync(
      path.join(project, 'ProjectSettings', 'ProjectVersion.txt'),
      'm_EditorVersion: 2022.3.22f1\n'
    )
    const manifestText = '{\n  "dependencies": {},\n  "locked": {}\n}'
    fs.writeFileSync(path.join(project, 'Packages', 'vpm-manifest.json'), manifestText)
    const real = fs.realpathSync.native(project)

    runtime = await initVpm({
      dataRoot,
      userAgent: 'Atrium/test',
      unityDiscovery: discovery,
      isNetworkAllowed: () => false
    })
    const op = runtime.operations.create({
      projectKey: projectKeyOf(real),
      projectPath: real,
      kind: 'install',
      plan: { changes: [] },
      planHash: 'a'.repeat(64),
      manifestBeforeHash: sha256Hex(manifestText),
      manifestAfterHash: 'c'.repeat(64)
    })
    runtime.operations.transition(op.id, 'preflight')
    runtime.operations.transition(op.id, 'applying')
    runtime.dispose()
    runtime = null

    runtime = await initVpm({
      dataRoot,
      userAgent: 'Atrium/test',
      unityDiscovery: discovery,
      isNetworkAllowed: () => false
    })
    // 没有任何文件被移动过 → 恢复判定 failed，工程不需要人工确认就能继续用。
    expect(runtime.operations.get(op.id)).toMatchObject({
      status: 'failed',
      errorCode: null
    })
    expect(runtime.recovery.scan()).toEqual([])
    expect(fs.readFileSync(path.join(project, 'Packages', 'vpm-manifest.json'), 'utf8')).toBe(
      manifestText
    )
  })

  it('can reopen after dispose and keeps the schema valid', async () => {
    runtime = await initVpm({
      dataRoot,
      userAgent: 'Atrium/test',
      unityDiscovery: discovery,
      isNetworkAllowed: () => false
    })
    runtime.dispose()
    runtime = null

    runtime = await initVpm({
      dataRoot,
      userAgent: 'Atrium/test',
      unityDiscovery: discovery,
      isNetworkAllowed: () => false
    })
    expect(runtime.repos.listRepos()).toEqual([])
  })

  it('rejects a newer vpm.db schema instead of rebuilding it', async () => {
    // 必须比当前 schema **真的更新**：以前这里写死 `user_version = 6`，
    // P7-C 把版本推到 6 之后这条就变成了"版本正好相等但一张表都没有"，
    // 断言跟着变味（拿到的是一条 SQLITE_ERROR 而不是 vpmDbVersionTooNew）。
    const tooNew = VPM_SCHEMA_VERSION + 1
    fs.mkdirSync(path.dirname(P.vpmDb()), { recursive: true })
    const raw = new Database(P.vpmDb())
    try {
      raw.pragma(`user_version = ${tooNew}`)
    } finally {
      raw.close()
    }

    await expect(
      initVpm({
        dataRoot,
        userAgent: 'Atrium/test',
        unityDiscovery: discovery,
        isNetworkAllowed: () => false
      })
    ).rejects.toMatchObject({ code: 'vpmDbVersionTooNew' })
    const check = new Database(P.vpmDb(), { readonly: true })
    try {
      // 拒绝后必须原样保留"更新版本"，不能悄悄降级
      expect(check.pragma('user_version', { simple: true })).toBe(tooNew)
    } finally {
      check.close()
    }
  })

  it('fails before creating vpm.db when the data root is missing', async () => {
    await expect(
      initVpm({
        dataRoot: path.join(root, 'missing'),
        userAgent: 'Atrium/test',
        unityDiscovery: discovery,
        isNetworkAllowed: () => false
      })
    ).rejects.toMatchObject({ code: 'vpmCachePathInvalid' })
    expect(fs.existsSync(P.vpmDb())).toBe(false)
  })
})
