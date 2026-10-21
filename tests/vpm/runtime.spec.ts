import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { initVpm, type VpmRuntime } from '../../src/main/vpm'
import { P, setAppPathsForTest } from '../../src/main/services/paths'

let root: string
let dataRoot: string
let runtime: VpmRuntime | null

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'atrium-vpm-runtime-'))
  setAppPathsForTest(root)
  dataRoot = path.join(root, 'data')
  fs.mkdirSync(dataRoot, { recursive: true })
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
      isNetworkAllowed: () => false
    })

    expect(fs.existsSync(P.vpmDb())).toBe(true)
    expect(fs.statSync(dataRoot).isDirectory()).toBe(true)
    expect(fs.statSync(path.join(dataRoot, 'cache')).isDirectory()).toBe(true)
    expect(runtime.repos.listRepos()).toEqual([])
    expect(runtime.catalog.query()).toMatchObject({ items: [], total: 0 })
    expect(runtime.unity.list()).toEqual([])
  })

  it('seeds official/curated only when consent is already granted', async () => {
    runtime = await initVpm({
      dataRoot,
      userAgent: 'Atrium/test',
      isNetworkAllowed: () => true
    })

    const repos = runtime.repos.listRepos()
    expect(repos).toHaveLength(2)
    expect(repos[0]).toMatchObject({ id: 'vrchat-official', sortOrder: 0 })
    expect(repos[1]).toMatchObject({ id: 'vrchat-curated', sortOrder: 1 })
    expect(repos.every((repo) => repo.lastFetchAt === null)).toBe(true)
  })

  it('exposes project ledger merging through injected core/VCC ports', async () => {
    runtime = await initVpm({
      dataRoot,
      userAgent: 'Atrium/test',
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

  it('can reopen after dispose and keeps the schema valid', async () => {
    runtime = await initVpm({
      dataRoot,
      userAgent: 'Atrium/test',
      isNetworkAllowed: () => false
    })
    runtime.dispose()
    runtime = null

    runtime = await initVpm({
      dataRoot,
      userAgent: 'Atrium/test',
      isNetworkAllowed: () => false
    })
    expect(runtime.repos.listRepos()).toEqual([])
  })

  it('rejects a newer vpm.db schema instead of rebuilding it', async () => {
    fs.mkdirSync(path.dirname(P.vpmDb()), { recursive: true })
    const raw = new Database(P.vpmDb())
    try {
      raw.pragma('user_version = 3')
    } finally {
      raw.close()
    }

    await expect(
      initVpm({
        dataRoot,
        userAgent: 'Atrium/test',
        isNetworkAllowed: () => false
      })
    ).rejects.toMatchObject({ code: 'vpmDbVersionTooNew' })
    const check = new Database(P.vpmDb(), { readonly: true })
    try {
      expect(check.pragma('user_version', { simple: true })).toBe(3)
    } finally {
      check.close()
    }
  })

  it('fails before creating vpm.db when the data root is missing', async () => {
    await expect(
      initVpm({
        dataRoot: path.join(root, 'missing'),
        userAgent: 'Atrium/test',
        isNetworkAllowed: () => false
      })
    ).rejects.toMatchObject({ code: 'vpmCachePathInvalid' })
    expect(fs.existsSync(P.vpmDb())).toBe(false)
  })
})
