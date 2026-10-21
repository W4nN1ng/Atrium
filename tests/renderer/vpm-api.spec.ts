import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { VpmDataRootPick, VpmStatus } from '../../src/shared/vpm/types'
import type {
  VpmCatalogPage,
  VpmCatalogPackageDetail,
  VpmNetworkStatus,
  VpmOperationStart,
  VpmProjectDetailDto,
  VpmProjectSummaryDto,
  VpmRepoDoneEvent,
  VpmRepoDto,
  VpmRepoProgressEvent
} from '../../src/shared/vpm/dto'

const status = { enabled: false, safeMode: false } as VpmStatus
const pick: VpmDataRootPick = { path: null, validation: null }
const repo = { id: 'repo-a', name: 'Repo A' } as VpmRepoDto
const operation: VpmOperationStart = { operationId: 'op-1', repoIds: ['repo-a'] }
const network: VpmNetworkStatus = { consentAt: null, allowed: false }
const page: VpmCatalogPage = { items: [], total: 0, limit: 100, offset: 0 }
const detail = { name: 'com.example.foo' } as VpmCatalogPackageDetail
const projectSummary = {
  projectKey: 'c:\\projects\\demo',
  coreId: 'core-1',
  path: 'C:\\Projects\\Demo',
  name: 'Demo',
  unityVersion: '2022.3.22f1',
  unityRevision: null,
  running: false,
  detectedBy: [],
  bridgeVersion: null,
  busyReason: null,
  linked: true,
  hasLedger: true,
  lastScanAt: 1,
  packageCount: 0,
  legacyCount: 0,
  hasVpmManifest: true
} satisfies VpmProjectSummaryDto
const projectDetail = {
  ...projectSummary,
  manifestHash: 'a'.repeat(64),
  manifestMtime: 1,
  unityExePath: null,
  unityArgsJson: null,
  packages: [],
  warnings: [],
  legacy: { readOnly: true, truncated: false, candidates: [] }
} satisfies VpmProjectDetailDto

let vpm: Record<string, ReturnType<typeof vi.fn>>
let listeners: Map<string, (payload: unknown) => void>
let off: ReturnType<typeof vi.fn>
let on: ReturnType<typeof vi.fn>
let openExternal: ReturnType<typeof vi.fn>
let pickDirectory: ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.resetModules()
  listeners = new Map()
  off = vi.fn()
  on = vi.fn((event: string, callback: (payload: unknown) => void) => {
    listeners.set(event, callback)
    return off
  })
  openExternal = vi.fn(async () => undefined)
  pickDirectory = vi.fn(async () => 'C:\\Projects\\Demo')
  vpm = {
    status: vi.fn(async () => status),
    enable: vi.fn(async () => status),
    disable: vi.fn(async () => status),
    pickDataRoot: vi.fn(async () => pick),
    reposList: vi.fn(async () => [repo]),
    repoAdd: vi.fn(async () => repo),
    repoRemove: vi.fn(async () => ({ ok: true })),
    repoRefresh: vi.fn(async () => operation),
    repoRefreshAll: vi.fn(async () => operation),
    networkStatus: vi.fn(async () => network),
    networkConsent: vi.fn(async () => ({ consentAt: '2026-10-21T00:00:00.000Z', allowed: true })),
    catalogQuery: vi.fn(async () => page),
    packageDetail: vi.fn(async () => detail),
    packageVersions: vi.fn(async () => []),
    projectsList: vi.fn(async () => [projectSummary]),
    projectDetail: vi.fn(async () => projectDetail),
    projectAdd: vi.fn(async () => projectDetail),
    projectRemove: vi.fn(async () => ({ ok: true })),
    projectRescan: vi.fn(async () => projectDetail),
    projectOpenFolder: vi.fn(async () => ({ ok: true }))
  }
  ;(globalThis as { window?: unknown }).window = {
    a: { vpm, on, system: { openExternal, pickDirectory } }
  }
})

describe('renderer/vpm/api', () => {
  it('forwards the P0 calls with their original arguments', async () => {
    const { vpmApi } = await import('../../src/renderer/vpm/api')

    await expect(vpmApi.status()).resolves.toBe(status)
    await expect(vpmApi.enable('E:\\AtriumVPM')).resolves.toBe(status)
    await expect(vpmApi.disable()).resolves.toBe(status)
    await expect(vpmApi.pickDataRoot()).resolves.toBe(pick)

    expect(vpm.status).toHaveBeenCalledTimes(1)
    expect(vpm.enable).toHaveBeenCalledWith('E:\\AtriumVPM')
    expect(vpm.disable).toHaveBeenCalledTimes(1)
    expect(vpm.pickDataRoot).toHaveBeenCalledTimes(1)
  })

  it('forwards repository/catalog/consent calls', async () => {
    const { vpmApi } = await import('../../src/renderer/vpm/api')

    await expect(vpmApi.reposList()).resolves.toEqual([repo])
    await expect(vpmApi.repoAdd({ url: 'https://example.test/repo.json', name: 'Repo' })).resolves.toBe(repo)
    await expect(vpmApi.repoRemove('repo-a')).resolves.toEqual({ ok: true })
    await expect(vpmApi.repoRefresh('repo-a')).resolves.toBe(operation)
    await expect(vpmApi.repoRefreshAll()).resolves.toBe(operation)
    await expect(vpmApi.networkStatus()).resolves.toBe(network)
    await expect(vpmApi.networkConsent(true)).resolves.toMatchObject({ allowed: true })
    await expect(vpmApi.catalogQuery({ text: 'foo' })).resolves.toBe(page)
    await expect(vpmApi.packageDetail('com.example.foo')).resolves.toBe(detail)
    await expect(vpmApi.packageVersions('com.example.foo')).resolves.toEqual([])
    await expect(vpmApi.projectsList()).resolves.toEqual([projectSummary])
    await expect(vpmApi.projectDetail(projectSummary.projectKey)).resolves.toBe(projectDetail)
    await expect(vpmApi.projectAdd({ path: 'C:\\Projects\\Demo' })).resolves.toBe(projectDetail)
    await expect(vpmApi.projectRemove(projectSummary.projectKey)).resolves.toEqual({ ok: true })
    await expect(vpmApi.projectRescan(projectSummary.projectKey)).resolves.toBe(projectDetail)
    await expect(vpmApi.projectOpenFolder(projectSummary.projectKey)).resolves.toEqual({ ok: true })
    await expect(vpmApi.pickProjectDirectory('选工程')).resolves.toBe('C:\\Projects\\Demo')
    await expect(vpmApi.openExternal('https://example.test/docs')).resolves.toBeUndefined()

    expect(pickDirectory).toHaveBeenCalledWith({ title: '选工程' })

    expect(vpm.repoAdd).toHaveBeenCalledWith({ url: 'https://example.test/repo.json', name: 'Repo' })
    expect(vpm.networkConsent).toHaveBeenCalledWith(true)
    expect(vpm.catalogQuery).toHaveBeenCalledWith({ text: 'foo' })
    expect(openExternal).toHaveBeenCalledWith('https://example.test/docs')
  })

  it('wraps progress/done events and unsubscribes with the preload cleanup', async () => {
    const { vpmApi } = await import('../../src/renderer/vpm/api')
    const progress = vi.fn()
    const done = vi.fn()

    const stopProgress = vpmApi.onRepoProgress(progress)
    const stopDone = vpmApi.onRepoDone(done)
    expect(on).toHaveBeenCalledWith('vpm:repo-progress', expect.any(Function))
    expect(on).toHaveBeenCalledWith('vpm:repo-done', expect.any(Function))

    listeners.get('vpm:repo-progress')?.({
      operationId: 'op-1',
      phase: 'start',
      repoIds: ['repo-a']
    } satisfies VpmRepoProgressEvent)
    listeners.get('vpm:repo-done')?.({
      operationId: 'op-1',
      results: []
    } satisfies VpmRepoDoneEvent)
    expect(progress).toHaveBeenCalledWith(
      expect.objectContaining({ operationId: 'op-1', phase: 'start' })
    )
    expect(done).toHaveBeenCalledWith(expect.objectContaining({ operationId: 'op-1' }))

    stopProgress()
    stopDone()
    expect(off).toHaveBeenCalledTimes(2)
  })
})
