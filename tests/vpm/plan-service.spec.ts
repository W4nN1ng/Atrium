import { describe, expect, it, vi } from 'vitest'
import type { ProjectSnapshot } from '../../src/shared/vpm/domain/project'
import type { ResolverCatalogPackage } from '../../src/shared/vpm/domain/resolver'
import { PlanService } from '../../src/main/vpm/planService'
import type { ProjectsService } from '../../src/main/vpm/projects'
import type { CatalogService } from '../../src/main/vpm/catalog'

const HASH = 'a'.repeat(64)

function snapshot(overrides: Partial<ProjectSnapshot> = {}): ProjectSnapshot {
  return {
    readOnly: true,
    projectKey: 'c:\\projects\\demo',
    projectPath: 'C:\\Projects\\Demo',
    name: 'Demo',
    projectSlug: 'demo-12345678',
    unityVersion: '2022.3.22f1',
    unityRevision: null,
    unityVersionWithRevision: '2022.3.22f1',
    productGuid: null,
    manifest: {
      hasManifest: true,
      raw: '{}',
      valid: true,
      data: {},
      dependencies: { 'com.example.a': '^1.0.0' },
      locked: {},
      legacyFolders: [],
      legacyFiles: [],
      legacyPackages: [],
      error: null
    },
    manifestHash: 'manifest-hash',
    manifestMtime: 1,
    packages: [
      {
        name: 'com.example.a',
        displayName: 'Example A',
        version: '1.0.0',
        manifestVersion: '^1.0.0',
        source: 'embedded',
        state: 'installed',
        missing: false,
        path: 'Packages/com.example.a',
        unity: null,
        vpmDependencies: {}
      }
    ],
    legacy: { readOnly: true, scanned: 0, truncated: false, candidates: [] },
    fingerprint: 'fingerprint',
    warnings: [],
    ...overrides
  }
}

function pkg(name: string, version: string, extra: Partial<ResolverCatalogPackage> = {}): ResolverCatalogPackage {
  return {
    name,
    version,
    dependencies: {},
    unity: null,
    yanked: false,
    repoId: 'repo-a',
    repoPriority: 0,
    sha256: HASH,
    url: `https://example.test/${name}-${version}.zip`,
    size: 10,
    ...extra
  }
}

function service(input?: {
  project?: ProjectSnapshot | null
  catalog?: ResolverCatalogPackage[]
  now?: () => number
  ttlMs?: number
}): PlanService {
  const projects = {
    detail: vi.fn(() => input?.project === null
      ? null
      : { item: {} as never, snapshot: input?.project ?? snapshot() })
  } as unknown as ProjectsService
  const catalog = {
    resolverCatalog: vi.fn(() => input?.catalog ?? [pkg('com.example.a', '1.0.0')])
  } as unknown as CatalogService
  return new PlanService({
    projects,
    catalog,
    now: input?.now,
    ttlMs: input?.ttlMs
  })
}

describe('plan application service', () => {
  it('assembles a plan from the project snapshot and catalog', () => {
    const plans = service()
    const result = plans.resolve({ projectKey: 'c:\\projects\\demo', preset: 'upgradeAll' })

    expect(result.planId).toBeTruthy()
    expect(result.planHash).toMatch(/^[0-9a-f]{64}$/)
    expect(result.changes).toEqual([
      expect.objectContaining({ name: 'com.example.a', action: 'keep', from: '1.0.0' })
    ])
    expect(plans.explain(result.planId, 'com.example.a')).toMatchObject({
      planId: result.planId,
      name: 'com.example.a',
      planHash: result.planHash,
      changes: [expect.objectContaining({ name: 'com.example.a' })]
    })
  })

  it('creates a download plan for an explicit install request', () => {
    const plans = service({
      catalog: [pkg('com.example.b', '2.0.0')]
    })
    const result = plans.resolve({
      projectKey: 'c:\\projects\\demo',
      requests: [{ kind: 'install', name: 'com.example.b' }]
    })
    expect(result.changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'com.example.a', action: 'keep' }),
        expect.objectContaining({ name: 'com.example.b', action: 'install', to: '2.0.0' })
      ])
    )
    expect(result.downloads).toEqual([
      expect.objectContaining({ name: 'com.example.b', version: '2.0.0' })
    ])
  })

  it('rejects missing projects and invalid manifests', () => {
    expect(() => service({ project: null }).resolve({ projectKey: 'missing' })).toThrowError(/vpmProjectInvalid/)
    const invalid = snapshot({
      manifest: {
        ...snapshot().manifest,
        valid: false,
        error: 'bad json'
      }
    })
    expect(() => service({ project: invalid }).resolve({ projectKey: invalid.projectKey })).toThrowError(/vpmManifestInvalid/)
  })

  it('expires plans and filters explanations by package name', () => {
    let now = 1_000
    const plans = service({ now: () => now, ttlMs: 1_000 })
    const result = plans.resolve({ projectKey: 'c:\\projects\\demo', preset: 'upgradeAll' })
    expect(plans.explain(result.planId, 'com.example.missing').missing).toEqual([])
    now = 2_001
    expect(() => plans.explain(result.planId)).toThrowError(/vpmPlanExpired/)
    expect(() => plans.explain('nope')).toThrowError(/vpmPlanNotFound/)
  })
})
