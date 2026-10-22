import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import type { VaultStore } from '../../../src/main/vpm/vault'
import { TxHarness, crashAt } from './harness'

let h: TxHarness
let project: string

beforeEach(async () => {
  h = await TxHarness.create()
  project = h.addProject()
})

afterEach(() => {
  h.dispose()
})

function upgradeScenario(name = 'com.example.a'): { planId: string; manifestText: string } {
  h.writeInstalledPackage(project, name, '1.0.0')
  const handle = h.makePlan(project, {
    manifest: {
      dependencies: { [name]: '1.0.0' },
      locked: { [name]: { version: '1.0.0', dependencies: {} } }
    },
    installed: [{ name, version: '1.0.0' }],
    catalog: [h.catalogEntry(name, '2.0.0')],
    requests: [{ kind: 'upgrade', name, version: '2.0.0' }]
  })
  return { planId: handle.planId, manifestText: handle.manifestText }
}

async function crash(point: string): Promise<string> {
  const scenario = upgradeScenario()
  await expect(
    h.apply(project, scenario.planId, { hooks: crashAt(point) })
  ).rejects.toThrow(/simulated crash/)
  const active = h.operations.listActive()
  expect(active).toHaveLength(1)
  return active[0].id
}

describe('recovery: crash before the commit point rolls back', () => {
  const cases = ['move-out:item:after', 'move-in:item:after', 'manifest:after-write'] as const

  for (const point of cases) {
    it(`restores the project after a crash at ${point}`, async () => {
      const opId = await crash(point)
      const before = h.manifestText(project)

      const decisions = h.recovery().scan()
      expect(decisions).toHaveLength(1)
      expect(decisions[0]).toMatchObject({
        operationId: opId,
        action: 'rollback',
        reason: 'before_commit'
      })

      const outcomes = await h.recovery().apply(decisions)
      expect(outcomes[0]).toMatchObject({ applied: true, resultStatus: 'rolled_back' })

      expect(h.operations.get(opId)?.status).toBe('rolled_back')
      expect(h.installedVersion(project, 'com.example.a')).toBe('1.0.0')
      expect(h.manifestText(project)).toBe(before)
      expect(
        (h.readManifest(project).locked as Record<string, { version: string }>)['com.example.a'].version
      ).toBe('1.0.0')
      // 事务区不自动删除（现场留给用户/后续清理）。
      expect(h.exists(h.transactionDir(project, opId))).toBe(true)
      expect(h.operations.listActive()).toEqual([])
    })
  }

  it('moves the new package into rolledback/ instead of deleting it', async () => {
    const opId = await crash('move-in:item:after')
    await h.recovery().scanAndApply()

    expect(h.installedVersion(project, 'com.example.a')).toBe('1.0.0')
    const rolledBack = path.join(h.transactionDir(project, opId), 'rolledback', 'com.example.a')
    expect(fs.existsSync(path.join(rolledBack, 'package.json'))).toBe(true)
    const version = JSON.parse(fs.readFileSync(path.join(rolledBack, 'package.json'), 'utf8')) as {
      version: string
    }
    expect(version.version).toBe('2.0.0')
  })

  it('is idempotent: a second recovery run changes nothing', async () => {
    const opId = await crash('move-in:item:after')
    const first = h.recovery()
    const decisions = first.scan()
    await first.apply(decisions)

    const statusAfterFirst = h.operations.get(opId)?.status
    const treeAfterFirst = fs.readdirSync(h.packageDir(project, 'com.example.a')).sort()
    const second = h.recovery()
    expect(second.scan()).toEqual([])
    const repeated = await second.apply(decisions)
    expect(repeated[0]).toMatchObject({ applied: false })
    expect(h.operations.get(opId)?.status).toBe(statusAfterFirst)
    expect(fs.readdirSync(h.packageDir(project, 'com.example.a')).sort()).toEqual(treeAfterFirst)
  })
})

describe('recovery: crash after the commit point completes and archives', () => {
  for (const point of ['manifest:after-rename', 'manifest:after-commit-point', 'vault:before'] as const) {
    it(`completes after a crash at ${point}`, async () => {
      const opId = await crash(point)

      const decisions = h.recovery().scan()
      expect(decisions[0]).toMatchObject({ operationId: opId, action: 'complete' })

      const outcomes = await h.recovery().apply(decisions)
      expect(outcomes[0]).toMatchObject({ applied: true, resultStatus: 'committed' })

      expect(h.operations.get(opId)?.status).toBe('committed')
      expect(h.installedVersion(project, 'com.example.a')).toBe('2.0.0')
      expect(
        (h.readManifest(project).locked as Record<string, { version: string }>)['com.example.a'].version
      ).toBe('2.0.0')
      // journal 补上了提交点，恢复后不会再有"已提交但证据缺失"。
      expect(h.journalOf(project, opId).commitPoint).toBe('manifest_written')
      expect(h.operations.get(opId)?.vaultPending).toBe(false)
    })
  }

  it('archives the old package into the vault when the crash happened before archiving', async () => {
    const opId = await crash('manifest:after-rename')
    await h.recovery().scanAndApply()

    const archived = path.join(h.vaultOpDir(project, opId), 'packages', 'com.example.a', 'package.json')
    expect(fs.existsSync(archived)).toBe(true)
    const version = JSON.parse(fs.readFileSync(archived, 'utf8')) as { version: string }
    expect(version.version).toBe('1.0.0')
    // 归档成功后事务区里的旧包副本被清掉，只留证据文件。
    expect(
      h.exists(
        path.join(h.transactionDir(project, opId), 'trash', 'packages', 'com.example.a', 'package.json')
      )
    ).toBe(false)
  })

  it('detects the rename-without-commit-point window and treats the disk manifest as truth', async () => {
    const opId = await crash('manifest:after-rename')
    // 崩溃点就在 rename 之后、markCommitPoint 之前。
    expect(h.journalOf(project, opId).commitPoint).toBe('before')
    expect(h.installedVersion(project, 'com.example.a')).toBe('2.0.0')

    const decision = h.recovery().scan()[0]
    expect(decision).toMatchObject({ action: 'complete', reason: 'manifest_committed' })
    await h.recovery().scanAndApply()
    expect(h.operations.get(opId)?.status).toBe('committed')
  })

  it('keeps the package installed but reports vault_pending when the archive cannot finish', async () => {
    const opId = await crash('vault:before')
    const brokenVault = {
      dataRoot: h.dataRoot,
      vaultRoot: path.join(h.dataRoot, 'vault'),
      ensureUsable: () => true,
      opDir: (slug: string, id: string) => path.join(h.dataRoot, 'vault', slug, id),
      exists: () => false,
      usage: () => ({ bytes: 0, files: 0, operations: 0 }),
      archive: async () => {
        throw new Error('disk on fire')
      }
    } as unknown as VaultStore

    const recovery = h.recovery({ vault: brokenVault })
    await recovery.scanAndApply()

    expect(h.operations.get(opId)?.status).toBe('committed')
    expect(h.operations.get(opId)?.vaultPending).toBe(true)
    expect(
      h.exists(
        path.join(h.transactionDir(project, opId), 'trash', 'packages', 'com.example.a', 'package.json')
      )
    ).toBe(true)
  })
})

describe('recovery: refuses to guess', () => {
  it('waits while Unity is running and leaves the files alone', async () => {
    const opId = await crash('move-in:item:after')
    const tree = h.installedVersion(project, 'com.example.a')

    const recovery = h.recovery({ isProjectActive: () => true })
    const decisions = recovery.scan()
    expect(decisions[0]).toMatchObject({ action: 'wait', reason: 'unity_running' })

    const outcomes = await recovery.apply(decisions)
    expect(outcomes[0]).toMatchObject({ applied: false, resultStatus: 'applying' })
    expect(h.operations.get(opId)?.status).toBe('applying')
    expect(h.installedVersion(project, 'com.example.a')).toBe(tree)
  })

  it('marks needs_attention when the manifest was changed by someone else', async () => {
    const opId = await crash('manifest:after-write')
    h.writeManifest(project, { dependencies: { 'com.external.pkg': '9.9.9' }, locked: {} })

    const decision = h.recovery().scan()[0]
    expect(decision).toMatchObject({ action: 'needs_attention', reason: 'project_changed' })

    await h.recovery().scanAndApply()
    expect(h.operations.get(opId)).toMatchObject({
      status: 'needs_attention',
      errorCode: 'vpmRecoveryRequired'
    })
    // 外部写入的 manifest 不被覆盖。
    expect(
      (h.readManifest(project).dependencies as Record<string, string>)['com.external.pkg']
    ).toBe('9.9.9')
  })

  it('marks needs_attention when the journal is corrupt', async () => {
    const opId = await crash('move-in:item:after')
    fs.writeFileSync(path.join(h.transactionDir(project, opId), 'journal.json'), '{')

    const decision = h.recovery().scan()[0]
    expect(decision).toMatchObject({ action: 'needs_attention', reason: 'journal_invalid' })
    await h.recovery().scanAndApply()
    expect(h.operations.get(opId)?.status).toBe('needs_attention')
    // 现场一字不动。
    expect(fs.readFileSync(path.join(h.transactionDir(project, opId), 'journal.json'), 'utf8')).toBe('{')
  })

  it('closes the dangling running step so the project is not locked forever', async () => {
    const opId = await crash('move-in:item:after')
    const before = h.operations.get(opId)
    expect(before?.steps.some((step) => step.status === 'running')).toBe(true)

    await h.recovery().scanAndApply()

    const after = h.operations.get(opId)
    expect(after?.steps.some((step) => step.status === 'running')).toBe(false)
    // 恢复完成后可以立刻开新操作。
    const next = h.makePlan(project, {
      manifest: h.readManifest(project),
      installed: [{ name: 'com.example.a', version: '1.0.0' }],
      requests: [{ kind: 'install', name: 'com.example.b' }],
      catalog: [h.catalogEntry('com.example.b', '1.0.0')]
    })
    const result = await h.apply(project, next.planId)
    expect(result.status).toBe('committed')
  })
})
