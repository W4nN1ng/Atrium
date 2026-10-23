import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { TxHarness, crashAt } from '../install/harness'

/**
 * P9-B：`needs_attention` 不是死路。
 *
 * 这些用例只走公开服务（inspect/recover），不直接改状态：
 * - 证据足够时，人工点"恢复"可以重试回滚/补完；
 * - 证据不足时只解释原因，不动文件，也不偷偷解锁；
 * - 外部把证据修好后，同一个操作可以再次恢复。
 */

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

function key(): string {
  return h.keyOf(project)
}

describe('P9-B manual recovery: retry after external evidence is fixed', () => {
  it('rolls back a needs_attention operation after the external manifest is restored', async () => {
    const scenario = upgradeScenario()
    const before = scenario.manifestText
    await expect(
      h.apply(project, scenario.planId, { hooks: crashAt('manifest:after-write') })
    ).rejects.toThrow(/simulated crash/)
    const opId = h.operations.listActive()[0].id
    const movedInBefore = h.installedVersion(project, 'com.example.a')
    expect(movedInBefore).toBe('2.0.0')

    // 外部改了 manifest：恢复只能停手。
    h.writeManifest(project, { dependencies: { 'com.external.pkg': '9.9.9' }, locked: {} })
    await h.recovery().scanAndApply()
    expect(h.operations.get(opId)).toMatchObject({
      status: 'needs_attention',
      errorCode: 'vpmRecoveryRequired'
    })
    expect(h.recovery().inspect(opId)).toMatchObject({
      action: 'needs_attention',
      reason: 'project_changed'
    })
    const blocked = await h.recovery().recover(opId)
    expect(blocked).toMatchObject({
      applied: false,
      resultStatus: 'needs_attention',
      errorCode: 'vpmRecoveryRequired'
    })

    // 用户把 manifest 恢复到事务前；现在证据重新完整。
    fs.writeFileSync(h.manifestPath(project), before)
    expect(h.recovery().inspect(opId)).toMatchObject({
      action: 'rollback',
      reason: 'before_commit'
    })
    const outcome = await h.recovery().recover(opId)
    expect(outcome).toMatchObject({ applied: true, resultStatus: 'rolled_back' })

    expect(h.installedVersion(project, 'com.example.a')).toBe('1.0.0')
    expect(h.manifestText(project)).toBe(before)
    expect(h.operations.listActive()).toEqual([])
    expect(h.operations.findUnresolved(key())).toBeNull()
    expect(h.journalOf(project, opId).phase).toBe('rolled_back')
  })

  it('completes a needs_attention operation after the new manifest is put in place', async () => {
    upgradeScenario()
    const opId = await crash('manifest:after-write')
    const newManifest = fs.readFileSync(
      path.join(h.transactionDir(project, opId), 'vpm-manifest.new.json'),
      'utf8'
    )

    h.writeManifest(project, { dependencies: { 'com.external.pkg': '9.9.9' }, locked: {} })
    await h.recovery().scanAndApply()
    expect(h.operations.get(opId)?.status).toBe('needs_attention')
    expect(h.recovery().inspect(opId)?.action).toBe('needs_attention')

    fs.writeFileSync(h.manifestPath(project), newManifest)
    expect(h.recovery().inspect(opId)).toMatchObject({
      action: 'complete',
      reason: 'manifest_committed'
    })
    const outcome = await h.recovery().recover(opId)
    expect(outcome).toMatchObject({ applied: true, resultStatus: 'committed' })

    expect(h.installedVersion(project, 'com.example.a')).toBe('2.0.0')
    expect(h.manifestText(project)).toBe(newManifest)
    expect(h.journalOf(project, opId).commitPoint).toBe('manifest_written')
    // 旧包补进回滚仓，而不是被丢掉。
    const archived = JSON.parse(
      fs.readFileSync(
        path.join(h.vaultOpDir(project, opId), 'packages', 'com.example.a', 'package.json'),
        'utf8'
      )
    ) as { version: string }
    expect(archived.version).toBe('1.0.0')
    expect(h.operations.findUnresolved(key())).toBeNull()
  })

  it('re-decides at click time instead of trusting an earlier inspect result', async () => {
    const scenario = upgradeScenario()
    await expect(
      h.apply(project, scenario.planId, { hooks: crashAt('manifest:after-write') })
    ).rejects.toThrow(/simulated crash/)
    const opId = h.operations.listActive()[0].id
    h.writeManifest(project, { dependencies: { 'com.external.pkg': '9.9.9' }, locked: {} })
    await h.recovery().scanAndApply()

    // 用户刚把 manifest 修好，inspect 显示可以回滚……
    fs.writeFileSync(h.manifestPath(project), scenario.manifestText)
    expect(h.recovery().inspect(opId)?.action).toBe('rollback')
    // ……但点"恢复"之前，另一个工具又改了一次 manifest。
    h.writeManifest(project, { dependencies: { 'com.third.pkg': '3.0.0' }, locked: {} })

    const outcome = await h.recovery().recover(opId)
    expect(outcome).toMatchObject({
      applied: false,
      resultStatus: 'needs_attention',
      errorCode: 'vpmRecoveryRequired'
    })
    // 外部内容保留，新包还在半途，绝不被这第二次点击抹掉。
    expect(
      (h.readManifest(project).dependencies as Record<string, string>)['com.third.pkg']
    ).toBe('3.0.0')
    expect(h.installedVersion(project, 'com.example.a')).toBe('2.0.0')
  })

  it('explains a damaged journal, keeps every byte, and recovers after the journal is repaired', async () => {
    const opId = await crash('move-in:item:after')
    const journalFile = path.join(h.transactionDir(project, opId), 'journal.json')
    const original = fs.readFileSync(journalFile, 'utf8')
    fs.writeFileSync(journalFile, '{')

    await h.recovery().scanAndApply()
    expect(h.operations.get(opId)?.status).toBe('needs_attention')
    expect(h.recovery().inspect(opId)).toMatchObject({
      action: 'needs_attention',
      reason: 'journal_invalid'
    })
    const blocked = await h.recovery().recover(opId)
    expect(blocked).toMatchObject({
      applied: false,
      resultStatus: 'needs_attention',
      errorCode: 'vpmJournalInvalid'
    })
    expect(fs.readFileSync(journalFile, 'utf8')).toBe('{')

    // 未恢复前，同一工程不能开新操作；这是有意的锁，不是泄漏。
    let blockedByUnresolved: unknown = null
    try {
      h.operations.create({
        projectKey: key(),
        projectPath: project,
        kind: 'install',
        plan: { changes: [] },
        planHash: 'a'.repeat(64)
      })
    } catch (error) {
      blockedByUnresolved = error
    }
    expect(blockedByUnresolved).toMatchObject({ code: 'vpmRecoveryRequired' })

    // 用户从备份/事务副本修复 journal 后，重试即可完成回滚并释放锁。
    fs.writeFileSync(journalFile, original)
    expect(h.recovery().inspect(opId)).toMatchObject({
      action: 'rollback',
      reason: 'before_commit'
    })
    const recovered = await h.recovery().recover(opId)
    expect(recovered).toMatchObject({ applied: true, resultStatus: 'rolled_back' })
    expect(h.operations.listActive()).toEqual([])
    expect(h.operations.findUnresolved(key())).toBeNull()
    expect(h.installedVersion(project, 'com.example.a')).toBe('1.0.0')
  })
})

describe('P9-B manual recovery: waits and terminal operations', () => {
  it('does not touch the project while Unity is using it; retries after it closes', async () => {
    const opId = await crash('move-in:item:after')
    const active = h.recovery({ isProjectActive: () => true })
    expect(active.inspect(opId)).toMatchObject({ action: 'wait', reason: 'unity_running' })
    const waiting = await active.recover(opId)
    expect(waiting).toMatchObject({ applied: false, resultStatus: 'applying' })
    expect(h.installedVersion(project, 'com.example.a')).toBe('2.0.0')

    const closed = h.recovery({ isProjectActive: () => false })
    const recovered = await closed.recover(opId)
    expect(recovered).toMatchObject({ applied: true, resultStatus: 'rolled_back' })
    expect(h.installedVersion(project, 'com.example.a')).toBe('1.0.0')
  })

  it('waits for backups/imports/other transactions and fails closed if the busy check throws', async () => {
    const opId = await crash('move-in:item:after')
    const busy = h.recovery({ isProjectBusy: () => true })
    expect(busy.inspect(opId)).toMatchObject({ action: 'wait', reason: 'project_busy' })
    const waiting = await busy.recover(opId)
    expect(waiting).toMatchObject({ applied: false, resultStatus: 'applying' })
    expect(h.installedVersion(project, 'com.example.a')).toBe('2.0.0')

    const broken = h.recovery({
      isProjectBusy: () => {
        throw new Error('activity gate exploded')
      }
    })
    expect(broken.inspect(opId)).toMatchObject({ action: 'wait', reason: 'project_busy' })

    const free = h.recovery({ isProjectBusy: () => false })
    expect((await free.recover(opId)).resultStatus).toBe('rolled_back')
  })

  it('reports terminal operations without pretending to recover them', async () => {
    const scenario = upgradeScenario()
    const result = await h.apply(project, scenario.planId)
    expect(result.status).toBe('committed')

    expect(h.recovery().inspect(result.operationId)).toMatchObject({
      action: 'none',
      reason: 'terminal'
    })
    const outcome = await h.recovery().recover(result.operationId)
    expect(outcome).toMatchObject({
      applied: false,
      resultStatus: 'committed',
      errorCode: null
    })
  })

  it('refuses unknown operation ids', async () => {
    await expect(h.recovery().recover('missing')).rejects.toMatchObject({
      code: 'vpmOperationNotFound'
    })
    expect(h.recovery().inspect('missing')).toBeNull()
  })
})
