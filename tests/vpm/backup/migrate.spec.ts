import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ProjectMigrateService } from '../../../src/main/vpm/backup'
import type { ProjectsService } from '../../../src/main/vpm/projects'
import type { PlanService } from '../../../src/main/vpm/planService'
import type { InstallTransactionService } from '../../../src/main/vpm/install'

const KEY = 'c:\\demo'

let resolve: ReturnType<typeof vi.fn>
let apply: ReturnType<typeof vi.fn>
let backupCreate: ReturnType<typeof vi.fn>
let installed: string[]

function service(options: { running?: boolean } = {}): ProjectMigrateService {
  return new ProjectMigrateService({
    projects: {
      get: () => ({
        projectKey: KEY,
        name: 'Demo',
        path: 'C:\\demo',
        running: options.running === true,
        ledger: { packages: installed.map((name) => ({ name })) }
      })
    } as unknown as ProjectsService,
    plans: { resolve } as unknown as PlanService,
    transactions: { apply } as unknown as InstallTransactionService,
    backup: { create: backupCreate }
  })
}

function codeOf(promise: Promise<unknown>): Promise<string | null> {
  return promise.then(
    () => null,
    (error: { code?: string }) => error.code ?? 'unknown'
  )
}

beforeEach(() => {
  installed = []
  resolve = vi.fn(() => ({ planId: 'plan-1', changes: [{ name: 'com.a' }] }))
  apply = vi.fn(async () => ({ operationId: 'op-1', status: 'committed', errorCode: null }))
  backupCreate = vi.fn(async () => ({ id: 'backup-1' }))
})

describe('project migrate', () => {
  it('backs up first, installs only trusted candidates and skips the rest', async () => {
    const result = await service().migrate({
      projectKey: KEY,
      candidates: [
        { packageId: 'com.vpm.good', relativePath: 'Assets/Good', confidence: 'high' },
        { packageId: 'com.vpm.low', relativePath: 'Assets/Low', confidence: 'low' },
        { packageId: null, relativePath: 'Assets/Unknown', confidence: 'high' },
        { packageId: 'com.vpm.good', relativePath: 'Assets/Duplicate', confidence: 'high' }
      ]
    })

    expect(backupCreate).toHaveBeenCalledTimes(1)
    expect(result.backupId).toBe('backup-1')
    expect(result.installed).toEqual(['com.vpm.good'])
    expect(result.skipped).toEqual(
      expect.arrayContaining([
        { packageId: 'com.vpm.low', reason: 'lowConfidence' },
        { packageId: '', reason: 'noPackageId' }
      ])
    )
    expect(resolve).toHaveBeenCalledWith(
      expect.objectContaining({ requests: [{ kind: 'install', name: 'com.vpm.good' }] })
    )
  })

  it('skips packages that are already in the ledger', async () => {
    installed = ['com.vpm.good']
    const result = await service().migrate({
      projectKey: KEY,
      candidates: [{ packageId: 'com.vpm.good', relativePath: 'Assets/Good', confidence: 'high' }]
    })
    expect(result.skipped).toEqual([{ packageId: 'com.vpm.good', reason: 'alreadyInstalled' }])
    expect(apply).not.toHaveBeenCalled()
  })

  it('skips candidates the catalog cannot resolve', async () => {
    resolve = vi.fn(() => ({ planId: 'plan-1', changes: [] }))
    const result = await service().migrate({
      projectKey: KEY,
      candidates: [{ packageId: 'com.unknown', relativePath: 'Assets/X', confidence: 'high' }]
    })
    expect(result.skipped).toEqual([{ packageId: 'com.unknown', reason: 'notInCatalog' }])
  })

  it('reports per-package failures without stopping the batch', async () => {
    apply = vi
      .fn()
      .mockResolvedValueOnce({ operationId: 'op-1', status: 'committed', errorCode: null })
      .mockResolvedValueOnce({ operationId: 'op-2', status: 'rolled_back', errorCode: 'vpmProjectChanged' })
    const result = await service().migrate({
      projectKey: KEY,
      candidates: [
        { packageId: 'com.a', relativePath: 'Assets/A', confidence: 'high' },
        { packageId: 'com.b', relativePath: 'Assets/B', confidence: 'high' }
      ]
    })
    expect(result.installed).toEqual(['com.a'])
    expect(result.failed).toEqual([{ packageId: 'com.b', errorCode: 'vpmProjectChanged' }])
  })

  it('refuses while Unity runs and can skip the backup', async () => {
    expect(
      await codeOf(
        service({ running: true }).migrate({
          projectKey: KEY,
          candidates: [{ packageId: 'com.a', relativePath: null, confidence: 'high' }]
        })
      )
    ).toBe('vpmUnityRunning')

    const result = await service().migrate({
      projectKey: KEY,
      candidates: [],
      backupFirst: false
    })
    expect(result.backupSkipped).toBe(true)
    expect(backupCreate).not.toHaveBeenCalled()
  })
})
