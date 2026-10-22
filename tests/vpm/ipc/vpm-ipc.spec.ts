import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { IpcEvent, IpcInvoke } from '../../../src/shared/ipc'
import { readNetworkConsent } from '../../../src/main/vpm/config'
import { registerVpmIpc } from '../../../src/main/vpm/ipc'
import type { VpmRuntime } from '../../../src/main/vpm'
import type { RepoDto, RepoRefreshResult } from '../../../src/main/vpm/reposService'
import type {
  VpmNetworkStatus,
  VpmOperationStart,
  VpmPlanDto,
  VpmPlanExplainDto
} from '../../../src/shared/vpm/dto'
import type { CatalogPage, CatalogPackageDetail } from '../../../src/main/vpm/catalog'
import type { ProjectListItem, ProjectPackageRow } from '../../../src/main/vpm/projects'
import { setAppPathsForTest } from '../../../src/main/services/paths'
import type { IpcApi } from '../../../src/main/ipc/types'

let root: string
let handlers: Map<string, (...args: never[]) => unknown>
let broadcast: ReturnType<typeof vi.fn>
let runtime: VpmRuntime | null
let controller: { dispose(): void } | null

const repo: RepoDto = {
  id: 'repo-a',
  url: 'https://example.test/repo.json',
  name: 'Repo A',
  kind: 'remote',
  enabled: true,
  sortOrder: 0,
  packageCount: 2,
  lastFetchAt: 10,
  lastSuccessAt: 10,
  lastErrorCode: null
}

const refresh: RepoRefreshResult = {
  repo,
  status: 'updated',
  packageCount: 2,
  errorCode: null
}

const summary = {
  name: 'com.example.foo',
  displayName: 'Foo',
  description: 'desc',
  unityMin: '2022.3',
  latestVersion: '1.0.0',
  versionCount: 1,
  sources: [{ repoId: 'repo-a', repoName: 'Repo A' }],
  hasConflict: false,
  conflictCount: 0,
  hasYanked: false,
  hidden: false,
  keywords: ['avatar'],
  aliases: ['foo']
}

const version = {
  version: '1.0.0',
  displayName: 'Foo',
  description: 'desc',
  unityMin: '2022.3',
  yanked: false,
  yankedReason: null,
  hidden: false,
  deprecated: false,
  sources: [
    { repoId: 'repo-a', repoName: 'Repo A', zipUrl: 'https://example.test/foo.zip', zipSha256: 'a'.repeat(64), zipSize: 1 }
  ],
  zipUrl: 'https://example.test/foo.zip',
  zipSha256: 'a'.repeat(64),
  zipSize: 1,
  changelogUrl: 'https://example.test/changelog',
  documentationUrl: 'https://example.test/docs'
}

const detail: CatalogPackageDetail = {
  ...summary,
  versions: [version],
  conflicts: []
}

const page: CatalogPage = { items: [summary], total: 1, limit: 100, offset: 0 }

const projectPackage: ProjectPackageRow = {
  name: 'com.example.foo',
  version: '1.0.0',
  source: 'embedded',
  isLegacy: false,
  state: 'installed',
  dependencyJson: '{}',
  updatedAt: 20
}

const planDto = {
  planId: 'plan-1',
  projectKey: 'c:\\projects\\demo',
  planHash: 'b'.repeat(64),
  changes: [],
  conflicts: [],
  missing: [],
  warnings: []
} as unknown as VpmPlanDto
const planExplain = {
  planId: 'plan-1',
  name: null,
  planHash: 'b'.repeat(64),
  changes: [],
  conflicts: [],
  missing: [],
  warnings: []
} as VpmPlanExplainDto

const projectItem: ProjectListItem = {
  projectKey: 'c:\\projects\\demo',
  coreId: 'core-1',
  path: 'C:\\Projects\\Demo',
  name: 'Demo',
  unityVersion: '2022.3.22f1',
  running: true,
  detectedBy: ['bridge'],
  bridgeVersion: '1.2.0',
  busyReason: null,
  linked: true,
  ledger: {
    projectKey: 'c:\\projects\\demo',
    projectPath: 'C:\\Projects\\Demo',
    name: 'Demo',
    unityVersion: '2022.3.22f1',
    unityRevision: 'abc123',
    unityExePath: 'E:\\Unity\\2022.3.22f1\\Editor\\Unity.exe',
    unityArgsJson: null,
    manifestHash: 'a'.repeat(64),
    manifestMtime: 10,
    lastScanAt: 20,
    lastOpId: null,
    createdAt: 1,
    updatedAt: 20,
    packages: [projectPackage]
  }
}

function fakeRuntime(): VpmRuntime {
  const seed = vi.fn(async () => {})
  const fake = {
    repos: {
      listRepos: () => [repo],
      addRepo: vi.fn(async (input: { url: string; name?: string }) => ({
        ...repo,
        url: input.url,
        name: input.name ?? repo.name
      })),
      removeRepo: vi.fn(() => {}),
      refreshRepo: vi.fn(async () => refresh),
      refreshAll: vi.fn(async (onResult?: (result: RepoRefreshResult, index: number) => void) => {
        onResult?.(refresh, 0)
        return [refresh]
      }),
      seedIfEmpty: seed
    },
    catalog: {
      query: vi.fn(() => page),
      getPackage: vi.fn((name: string) => (name === summary.name ? detail : null))
    },
    projects: {
      list: vi.fn(() => [projectItem]),
      get: vi.fn((key: string) => (key === projectItem.projectKey ? projectItem : null)),
      detail: vi.fn((key: string) =>
        key === projectItem.projectKey ? { item: projectItem, snapshot: null } : null
      ),
      addExisting: vi.fn(() => ({ ledger: projectItem.ledger, snapshot: null })),
      refresh: vi.fn(() => ({ ledger: projectItem.ledger, snapshot: null })),
      remove: vi.fn(() => true)
    },
    plans: {
      resolve: vi.fn(() => planDto),
      explain: vi.fn(() => planExplain)
    }
  }
  return fake as unknown as VpmRuntime
}

function handler(channel: string): (...args: never[]) => unknown {
  const fn = handlers.get(channel)
  if (!fn) throw new Error('missing handler ' + channel)
  return fn
}

const tick = (ms = 20): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

function call(channel: string, ...args: never[]): Promise<unknown> {
  return Promise.resolve().then(() => handler(channel)(...args))
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'atrium-vpm-ipc-'))
  setAppPathsForTest(root)
  handlers = new Map()
  broadcast = vi.fn()
  runtime = fakeRuntime()
  const ipc: IpcApi = {
    handle(channel, fn) {
      handlers.set(channel, fn as unknown as (...args: never[]) => unknown)
    }
  }
  controller = registerVpmIpc({ ipc, broadcast, getRuntime: () => runtime })
})

afterEach(() => {
  controller?.dispose()
  controller = null
  fs.rmSync(root, { recursive: true, force: true })
})

describe('VPM P1 IPC', () => {
  it('registers exactly the read-only repository/catalog channels', () => {
    expect([...handlers.keys()].sort()).toEqual(
      [
        IpcInvoke.Vpm.ReposList,
        IpcInvoke.Vpm.RepoAdd,
        IpcInvoke.Vpm.RepoRemove,
        IpcInvoke.Vpm.RepoUpdate,
        IpcInvoke.Vpm.RepoReorder,
        IpcInvoke.Vpm.RepoImport,
        IpcInvoke.Vpm.RepoExport,
        IpcInvoke.Vpm.RepoHeaders,
        IpcInvoke.Vpm.RepoHeadersSet,
        IpcInvoke.Vpm.RepoHeadersClear,
        IpcInvoke.Vpm.RepoTest,
        IpcInvoke.Vpm.BackupCreate,
        IpcInvoke.Vpm.BackupList,
        IpcInvoke.Vpm.BackupReveal,
        IpcInvoke.Vpm.ProjectCopy,
        IpcInvoke.Vpm.ProjectVersionChange,
        IpcInvoke.Vpm.ProjectMigrate,
        IpcInvoke.Vpm.ProjectTrash,
        IpcInvoke.Vpm.ProjectParentCheck,
        IpcInvoke.Vpm.ProjectScanRoot,
        IpcInvoke.Vpm.RepoRefresh,
        IpcInvoke.Vpm.RepoRefreshAll,
        IpcInvoke.Vpm.NetworkStatus,
        IpcInvoke.Vpm.NetworkConsent,
        IpcInvoke.Vpm.CatalogQuery,
        IpcInvoke.Vpm.PackageDetail,
        IpcInvoke.Vpm.PackageVersions,
        IpcInvoke.Vpm.ProjectsList,
        IpcInvoke.Vpm.ProjectDetail,
        IpcInvoke.Vpm.ProjectAdd,
        IpcInvoke.Vpm.ProjectRemove,
        IpcInvoke.Vpm.ProjectRescan,
        IpcInvoke.Vpm.ProjectOpenFolder,
        IpcInvoke.Vpm.PlanResolve,
        IpcInvoke.Vpm.PlanApply,
        IpcInvoke.Vpm.OperationStatus,
        IpcInvoke.Vpm.OperationCancel,
        IpcInvoke.Vpm.OperationHistory,
        IpcInvoke.Vpm.OperationUndo,
        IpcInvoke.Vpm.ProjectCatalog,
        IpcInvoke.Vpm.UnityInstalls,
        IpcInvoke.Vpm.UnityRefresh,
        IpcInvoke.Vpm.ProjectLaunch,
        IpcInvoke.Vpm.ProjectLaunchArgs,
        IpcInvoke.Vpm.ProjectCreate,
        IpcInvoke.Vpm.TemplateList,
        IpcInvoke.Vpm.TemplateFavorite,
        IpcInvoke.Vpm.TemplateRecent,
        IpcInvoke.Vpm.PlanExplain
      ].sort()
    )
  })

  it('maps repository add/remove/list with input validation', async () => {
    expect(await handler(IpcInvoke.Vpm.ReposList)()).toEqual([repo])
    expect(await handler(IpcInvoke.Vpm.RepoAdd)({ url: 'https://example.test/new.json', name: 'New' } as never)).toMatchObject({
      url: 'https://example.test/new.json',
      name: 'New'
    })
    await expect(call(IpcInvoke.Vpm.RepoAdd, { url: 42 } as never)).rejects.toMatchObject({
      code: 'vpmRepoInvalid'
    })
    await expect(call(IpcInvoke.Vpm.RepoRemove, '' as never)).rejects.toMatchObject({
      code: 'vpmRepoNotFound'
    })
    expect(await handler(IpcInvoke.Vpm.RepoRemove)('repo-a' as never)).toEqual({ ok: true })
  })

  it('starts a refresh operation and broadcasts progress/done', async () => {
    const started = (await handler(IpcInvoke.Vpm.RepoRefresh)('repo-a' as never)) as VpmOperationStart
    expect(started).toMatchObject({ repoIds: ['repo-a'] })
    await tick(150)

    const progress = broadcast.mock.calls
      .filter(([event]) => event === IpcEvent.VpmRepoProgress)
      .map(([, payload]) => payload)
    expect(progress[0]).toMatchObject({ phase: 'start', repoId: 'repo-a' })
    expect(progress.at(-1)).toMatchObject({
      phase: 'repo',
      result: { status: 'updated', packageCount: 2 }
    })
    const done = broadcast.mock.calls.find(([event]) => event === IpcEvent.VpmRepoDone)
    expect(done?.[1]).toMatchObject({ operationId: started.operationId, results: [{ status: 'updated' }] })
  })

  it('broadcasts refresh-all results and ignores disabled repositories in the start list', async () => {
    const started = (await handler(IpcInvoke.Vpm.RepoRefreshAll)()) as VpmOperationStart
    await tick(150)
    expect(started.repoIds).toEqual(['repo-a'])
    const done = broadcast.mock.calls.find(([event]) => event === IpcEvent.VpmRepoDone)
    expect(done?.[1]).toMatchObject({ results: [{ repo: { id: 'repo-a' } }] })
  })

  it('handles network consent/status and seeds official repositories', async () => {
    expect(await handler(IpcInvoke.Vpm.NetworkStatus)()).toEqual({ consentAt: null, allowed: true })
    await expect(call(IpcInvoke.Vpm.NetworkConsent, { allow: 'yes' } as never)).rejects.toMatchObject({
      code: 'vpmInternal'
    })
    const off = (await handler(IpcInvoke.Vpm.NetworkConsent)({ allow: false } as never)) as VpmNetworkStatus
    expect(off.allowed).toBe(false)
    const status = (await handler(IpcInvoke.Vpm.NetworkConsent)({ allow: true } as never)) as VpmNetworkStatus
    expect(status.allowed).toBe(true)
    expect(status.consentAt).toBeTruthy()
    expect(readNetworkConsent()).toBe(status.consentAt)
  })

  it('maps catalog query/detail/versions', async () => {
    expect(await handler(IpcInvoke.Vpm.CatalogQuery)({ text: 'foo' } as never)).toMatchObject({
      total: 1,
      items: [{ name: summary.name }]
    })
    expect(await handler(IpcInvoke.Vpm.PackageDetail)(summary.name as never)).toMatchObject({
      name: summary.name,
      versions: [{ changelogUrl: version.changelogUrl }]
    })
    expect(await handler(IpcInvoke.Vpm.PackageVersions)(summary.name as never)).toMatchObject([
      { version: '1.0.0', documentationUrl: version.documentationUrl }
    ])
    expect(await handler(IpcInvoke.Vpm.PackageDetail)('com.missing' as never)).toBeNull()
    await expect(call(IpcInvoke.Vpm.CatalogQuery, 'nope' as never)).rejects.toMatchObject({
      code: 'vpmInternal'
    })
  })

  it('maps project ledger list/detail/add/remove/rescan and validates keys', async () => {
    expect(await handler(IpcInvoke.Vpm.ProjectsList)()).toEqual([
      expect.objectContaining({ projectKey: projectItem.projectKey, packageCount: 1, linked: true })
    ])
    expect(await handler(IpcInvoke.Vpm.ProjectDetail)(projectItem.projectKey as never)).toMatchObject({
      projectKey: projectItem.projectKey,
      unityRevision: 'abc123',
      packages: [expect.objectContaining({ name: 'com.example.foo', state: 'installed' })],
      legacy: { readOnly: true, candidates: [] }
    })
    expect(await handler(IpcInvoke.Vpm.ProjectAdd)({ path: 'C:\\Projects\\Demo' } as never)).toMatchObject({
      projectKey: projectItem.projectKey
    })
    expect(await handler(IpcInvoke.Vpm.ProjectRemove)(projectItem.projectKey as never)).toEqual({ ok: true })
    expect(await handler(IpcInvoke.Vpm.ProjectRescan)(projectItem.projectKey as never)).toMatchObject({
      projectKey: projectItem.projectKey
    })
    await expect(call(IpcInvoke.Vpm.ProjectDetail, '' as never)).rejects.toMatchObject({
      code: 'vpmProjectInvalid'
    })
    await expect(call(IpcInvoke.Vpm.ProjectAdd, {} as never)).rejects.toMatchObject({
      code: 'vpmProjectInvalid'
    })
    await expect(call(IpcInvoke.Vpm.ProjectOpenFolder, '' as never)).rejects.toMatchObject({
      code: 'vpmProjectInvalid'
    })
  })

  it('validates and forwards plan resolve/explain requests', async () => {
    expect(await handler(IpcInvoke.Vpm.PlanResolve)({
      projectKey: projectItem.projectKey,
      preset: 'upgradeAll'
    } as never)).toMatchObject({ planId: 'plan-1' })
    expect(await handler(IpcInvoke.Vpm.PlanExplain)('plan-1' as never, 'com.example.foo' as never)).toMatchObject({
      planId: 'plan-1'
    })
    await expect(call(IpcInvoke.Vpm.PlanResolve, { projectKey: '' } as never)).rejects.toMatchObject({
      code: 'vpmProjectInvalid'
    })
    await expect(call(IpcInvoke.Vpm.PlanResolve, {
      projectKey: projectItem.projectKey,
      preset: 'other'
    } as never)).rejects.toMatchObject({ code: 'vpmResolutionFailed' })
    await expect(call(IpcInvoke.Vpm.PlanExplain, '' as never)).rejects.toMatchObject({
      code: 'vpmPlanNotFound'
    })
  })

  it('returns vpmRuntimeNotReady instead of leaking a missing runtime', async () => {
    runtime = null
    await expect(call(IpcInvoke.Vpm.ReposList)).rejects.toMatchObject({
      code: 'vpmRuntimeNotReady'
    })
    await expect(call(IpcInvoke.Vpm.CatalogQuery, {} as never)).rejects.toMatchObject({
      code: 'vpmRuntimeNotReady'
    })
    expect(await handler(IpcInvoke.Vpm.NetworkStatus)()).toEqual({ consentAt: null, allowed: true })
  })
})
