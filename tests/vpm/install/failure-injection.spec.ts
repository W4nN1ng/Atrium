import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { VpmError } from '../../../src/shared/vpm/errors'
import { sha256Hex } from '../../../src/shared/vpm/domain/hash'
import type { ApplyPlanResult, InstallTransactionOptions } from '../../../src/main/vpm/install'
import { TxHarness, crashAt, failAt } from './harness'

let h: TxHarness
let project: string

beforeEach(async () => {
  h = await TxHarness.create()
  project = h.addProject()
})

afterEach(() => {
  h.dispose()
})

/** 工程文件树（跳过事务区），用内容 hash 比较"是否逐字节一致"。 */
function treeOf(root: string): string[] {
  const out: string[] = []
  const walk = (dir: string, relative: string): void => {
    const entries = fs
      .readdirSync(dir, { withFileTypes: true })
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    for (const entry of entries) {
      if (relative === '' && entry.name === '.atrium-tx') continue
      const child = relative ? `${relative}/${entry.name}` : entry.name
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        out.push(`${child}/`)
        walk(full, child)
        continue
      }
      out.push(`${child}:${sha256Hex(fs.readFileSync(full, 'utf8'))}`)
    }
  }
  walk(root, '')
  return out
}

function installed(name: string): { manifest: Record<string, unknown>; catalog: ReturnType<TxHarness['catalogEntry']> } {
  h.writeInstalledPackage(project, name, '1.0.0')
  h.writeManifest(project, {
    dependencies: { [name]: '1.0.0' },
    locked: { [name]: { version: '1.0.0', dependencies: {} } }
  })
  return {
    manifest: {
      dependencies: { [name]: '1.0.0' },
      locked: { [name]: { version: '1.0.0', dependencies: {} } }
    },
    catalog: h.catalogEntry(name, '2.0.0')
  }
}

function expectNoHalfInstall(name: string): void {
  const dir = h.packageDir(project, name)
  if (!fs.existsSync(dir)) return
  expect(fs.existsSync(path.join(dir, 'package.json'))).toBe(true)
  expect(fs.statSync(dir).isDirectory()).toBe(true)
}

interface Case {
  point: string
  status: ApplyPlanResult['status']
  tree: 'unchanged' | 'new'
  warning?: string
  vaultPending?: boolean
}

const UPGRADE_CASES: Case[] = [
  { point: 'prepare:before', status: 'failed', tree: 'unchanged' },
  { point: 'prepare:after', status: 'failed', tree: 'unchanged' },
  { point: 'download:before', status: 'failed', tree: 'unchanged' },
  { point: 'download:after', status: 'failed', tree: 'unchanged' },
  { point: 'extract:before', status: 'failed', tree: 'unchanged' },
  { point: 'extract:after', status: 'failed', tree: 'unchanged' },
  { point: 'move-out:before', status: 'failed', tree: 'unchanged' },
  { point: 'move-out:item:before', status: 'failed', tree: 'unchanged' },
  { point: 'move-out:item:after', status: 'rolled_back', tree: 'unchanged' },
  { point: 'move-out:after', status: 'rolled_back', tree: 'unchanged' },
  { point: 'move-in:before', status: 'rolled_back', tree: 'unchanged' },
  { point: 'move-in:item:before', status: 'rolled_back', tree: 'unchanged' },
  { point: 'move-in:item:after', status: 'rolled_back', tree: 'unchanged' },
  { point: 'move-in:after', status: 'rolled_back', tree: 'unchanged' },
  { point: 'manifest:before', status: 'rolled_back', tree: 'unchanged' },
  { point: 'manifest:after-write', status: 'rolled_back', tree: 'unchanged' },
  { point: 'manifest:after-rename', status: 'needs_attention', tree: 'new' },
  { point: 'manifest:after-commit-point', status: 'needs_attention', tree: 'new' },
  {
    point: 'vault:before',
    status: 'committed',
    tree: 'new',
    warning: 'vpmVaultArchiveFailed',
    vaultPending: true
  },
  {
    point: 'vault:after',
    status: 'committed',
    tree: 'new',
    warning: 'vpmVaultArchiveFailed',
    vaultPending: true
  },
  { point: 'cleanup:before', status: 'committed', tree: 'new', warning: 'vpmTransactionFailed' },
  { point: 'cleanup:after', status: 'committed', tree: 'new', warning: 'vpmTransactionFailed' }
]

describe('failure injection: every transaction step', () => {
  for (const testCase of UPGRADE_CASES) {
    it(`fails at ${testCase.point} → ${testCase.status}`, async () => {
      const { manifest, catalog } = installed('com.example.a')
      const handle = h.makePlan(project, {
        manifest,
        installed: [{ name: 'com.example.a', version: '1.0.0' }],
        catalog: [catalog],
        requests: [{ kind: 'upgrade', name: 'com.example.a', version: '2.0.0' }]
      })
      const before = treeOf(project)

      const result = await h.apply(project, handle.planId, {
        hooks: failAt([testCase.point])
      })

      expect(result.status).toBe(testCase.status)
      expectNoHalfInstall('com.example.a')

      if (testCase.tree === 'unchanged') {
        expect(treeOf(project)).toEqual(before)
        expect(h.installedVersion(project, 'com.example.a')).toBe('1.0.0')
        expect((h.readManifest(project).locked as Record<string, { version: string }>)['com.example.a'].version).toBe('1.0.0')
        expect(h.journalOf(project, result.operationId).commitPoint).toBe('before')
      } else {
        expect(h.installedVersion(project, 'com.example.a')).toBe('2.0.0')
        expect((h.readManifest(project).locked as Record<string, { version: string }>)['com.example.a'].version).toBe('2.0.0')
      }

      if (testCase.warning) {
        expect(result.warnings.map((warning) => warning.code)).toContain(testCase.warning)
      }
      if (testCase.vaultPending !== undefined) {
        expect(result.vaultPending).toBe(testCase.vaultPending)
      }
      // 现场永不自动删除：事务目录必须还在。
      expect(fs.existsSync(h.transactionDir(project, result.operationId))).toBe(true)
    })
  }

  it('rejects a download whose hash does not match the plan', async () => {
    const entry = h.catalogEntry('com.example.a', '1.0.0')
    const handle = h.makePlan(project, {
      catalog: [entry],
      requests: [{ kind: 'install', name: 'com.example.a' }]
    })
    const result = await h.apply(project, handle.planId, {
      packages: {
        ensurePackage: async () => ({
          path: path.join(h.root, 'zips', 'com.example.a-1.0.0.zip'),
          sha256: 'f'.repeat(64),
          size: entry.size ?? 0,
          reused: false
        })
      }
    })
    expect(result.status).toBe('failed')
    expect(result.errorCode).toBe('vpmCacheHashMismatch')
    expect(h.exists(h.packageDir(project, 'com.example.a'))).toBe(false)
  })

  it('turns a legacy cleanup failure into a warning and keeps the package installed', async () => {
    h.writeInstalledPackage(project, 'com.example.old', '1.0.0')
    const asset = path.join(project, 'Assets', 'OldThing', 'model.prefab')
    fs.mkdirSync(path.dirname(asset), { recursive: true })
    fs.writeFileSync(asset, 'prefab')
    const handle = h.makePlan(project, {
      manifest: {
        dependencies: { 'com.example.old': '1.0.0' },
        locked: { 'com.example.old': { version: '1.0.0', dependencies: {} } },
        legacyFolders: { 'com.example.old': 'Assets/OldThing' }
      },
      installed: [{ name: 'com.example.old', version: '1.0.0' }],
      requests: [{ kind: 'remove', name: 'com.example.old' }]
    })

    const result = await h.apply(project, handle.planId, { hooks: failAt(['legacy:before']) })

    expect(result.status).toBe('committed')
    expect(result.warnings.map((warning) => warning.code)).toContain('vpmLegacyCleanupFailed')
    expect(fs.existsSync(asset)).toBe(true)
    expect(h.exists(h.packageDir(project, 'com.example.old'))).toBe(false)
  })
})

describe('crash simulation leaves a recoverable scene', () => {
  it('keeps the operation active and the old package in trash when the process dies mid-move', async () => {
    const { manifest, catalog } = installed('com.example.a')
    const handle = h.makePlan(project, {
      manifest,
      installed: [{ name: 'com.example.a', version: '1.0.0' }],
      catalog: [catalog],
      requests: [{ kind: 'upgrade', name: 'com.example.a', version: '2.0.0' }]
    })

    await expect(
      h.apply(project, handle.planId, { hooks: crashAt('move-in:item:after') })
    ).rejects.toThrow(/simulated crash/)

    const operation = h.operations.listActive()[0]
    expect(operation).toBeDefined()
    expect(operation.status).toBe('applying')
    // 新包已就位、旧包在事务区：现场是"半完成"，但没有任何一步被标成功。
    expect(h.installedVersion(project, 'com.example.a')).toBe('2.0.0')
    expect(
      h.exists(
        path.join(h.transactionDir(project, operation.id), 'trash', 'packages', 'com.example.a', 'package.json')
      )
    ).toBe(true)
    expect(h.journalOf(project, operation.id).commitPoint).toBe('before')
  })

  it('keeps the transaction folder when the crash happens before the manifest is renamed', async () => {
    const { manifest, catalog } = installed('com.example.a')
    const handle = h.makePlan(project, {
      manifest,
      installed: [{ name: 'com.example.a', version: '1.0.0' }],
      catalog: [catalog],
      requests: [{ kind: 'upgrade', name: 'com.example.a', version: '2.0.0' }]
    })

    await expect(
      h.apply(project, handle.planId, { hooks: crashAt('manifest:after-write') })
    ).rejects.toThrow(/simulated crash/)

    const operation = h.operations.listActive()[0]
    expect(operation.status).toBe('applying')
    expect(h.manifestText(project)).toBe(handle.manifestText)
    expect(h.exists(path.join(h.transactionDir(project, operation.id), 'vpm-manifest.new.json'))).toBe(true)
  })
})

describe('transaction invariants under injected failures', () => {
  it('never marks a half-installed package as committed', async () => {
    const { manifest, catalog } = installed('com.example.a')
    const handle = h.makePlan(project, {
      manifest,
      installed: [{ name: 'com.example.a', version: '1.0.0' }],
      catalog: [catalog],
      requests: [{ kind: 'upgrade', name: 'com.example.a', version: '2.0.0' }]
    })

    const result = await h.apply(project, handle.planId, { hooks: failAt(['move-in:item:after']) })

    expect(result.status).not.toBe('committed')
    expectNoHalfInstall('com.example.a')
    expect(h.installedVersion(project, 'com.example.a')).toBe('1.0.0')
    // 每个操作都有自己的 journal，不会被下一条覆盖。
    expect(h.exists(path.join(h.transactionDir(project, result.operationId), 'journal.json'))).toBe(true)
  })

  it('keeps the manifest byte-identical when the failure is before the commit point', async () => {
    const { manifest, catalog } = installed('com.example.a')
    const handle = h.makePlan(project, {
      manifest,
      installed: [{ name: 'com.example.a', version: '1.0.0' }],
      catalog: [catalog],
      requests: [{ kind: 'upgrade', name: 'com.example.a', version: '2.0.0' }]
    })
    const before = h.manifestText(project)

    const result = await h.apply(project, handle.planId, { hooks: failAt(['manifest:after-write']) })

    expect(result.status).toBe('rolled_back')
    expect(h.manifestText(project)).toBe(before)
  })

  it('does not delete the transaction scene when rollback fails', async () => {
    const { manifest, catalog } = installed('com.example.a')
    const handle = h.makePlan(project, {
      manifest,
      installed: [{ name: 'com.example.a', version: '1.0.0' }],
      catalog: [catalog],
      requests: [{ kind: 'upgrade', name: 'com.example.a', version: '2.0.0' }]
    })
    const wrapped = new Proxy(h.operations, {
      get(target, prop, receiver) {
        if (prop === 'setFileState') {
          return (id: string, filePath: string, action: string, state: string) => {
            if (action === 'move-out' && state === 'failed') throw new Error('injected rollback failure')
            return target.setFileState(id, filePath, action as 'move-out', state as 'failed')
          }
        }
        const value = Reflect.get(target, prop, receiver)
        return typeof value === 'function' ? value.bind(target) : value
      }
    }) as typeof h.operations

    const overrides: Partial<InstallTransactionOptions> = {
      operations: wrapped,
      hooks: failAt(['move-in:before'])
    }
    const result = await h.apply(project, handle.planId, overrides)

    expect(result.status).toBe('needs_attention')
    expect(result.errorCode).toBe('vpmRollbackFailed')
    expect(fs.existsSync(h.transactionDir(project, result.operationId))).toBe(true)
  })
})
