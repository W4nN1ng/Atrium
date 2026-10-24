import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { MaintenanceKind, ProjectActivityPort } from '../../../src/shared/vpm/linkage'
import { TxHarness, crashAt, failAt } from '../install/harness'

/**
 * P9-B：锁/租约不泄漏。
 *
 * 三道锁分别验证：
 * - 进程内维护租约：成功、失败回滚、模拟进程死亡都必须 release；
 * - vpm.db 活动操作：多次崩溃恢复后不能残留 active 行；
 * - 未恢复的 needs_attention 是有意的锁：证据修好后必须能释放（见 manual-recovery）。
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

interface LeaseStats {
  acquired: number
  released: number
  open: number
}

function countingActivity(): { port: ProjectActivityPort; stats: () => LeaseStats } {
  const stats: LeaseStats = { acquired: 0, released: 0, open: 0 }
  const released = new Set<string>()
  const port: ProjectActivityPort = {
    state: () => ({ unityRunning: false, importing: false, maintenance: null }),
    acquireMaintenance: (projectPath: string, kind: MaintenanceKind) => {
      const token = `${projectPath}:${kind}:${stats.acquired}`
      stats.acquired++
      stats.open++
      return {
        projectPath,
        kind,
        release: () => {
          if (released.has(token)) return
          released.add(token)
          stats.released++
          stats.open--
        }
      }
    }
  }
  return { port, stats: () => ({ ...stats }) }
}

function installPlan(name: string): string {
  return h.makePlan(project, {
    manifest: h.readManifest(project),
    catalog: [h.catalogEntry(name, '1.0.0')],
    requests: [{ kind: 'install', name }]
  }).planId
}

describe('P9-B leases: every exit path releases', () => {
  it('releases after a successful commit', async () => {
    const activity = countingActivity()
    const result = await h.apply(project, installPlan('com.example.ok'), {
      activity: activity.port
    })
    expect(result.status).toBe('committed')
    expect(activity.stats()).toEqual({ acquired: 1, released: 1, open: 0 })
  })

  it('releases after a mid-transaction failure that rolls back', async () => {
    const activity = countingActivity()
    const result = await h.apply(project, installPlan('com.example.fail'), {
      activity: activity.port,
      hooks: failAt(['move-in:item:after'])
    })
    expect(result.status).toBe('rolled_back')
    expect(activity.stats()).toEqual({ acquired: 1, released: 1, open: 0 })
    expect(h.operations.listActive()).toEqual([])
  })

  it('releases when the simulated process dies (real death releases with the process)', async () => {
    const activity = countingActivity()
    await expect(
      h.apply(project, installPlan('com.example.crash'), {
        activity: activity.port,
        hooks: crashAt('move-in:item:after')
      })
    ).rejects.toThrow(/simulated crash/)
    expect(activity.stats()).toEqual({ acquired: 1, released: 1, open: 0 })
    // 真实进程死亡不会执行 finally，但进程内的租约也随进程消失；
    // 这里证明的是"能不崩就不漏"的进程内路径。
    expect(h.operations.listActive()).toHaveLength(1)
  })

  it('never acquires a lease when preflight fails', async () => {
    const activity = countingActivity()
    const result = await h.apply(project, installPlan('com.example.nospace'), {
      activity: activity.port,
      freeBytes: () => 1024
    })
    expect(result.status).toBe('failed')
    expect(result.errorCode).toBe('vpmProjectNoSpace')
    expect(activity.stats()).toEqual({ acquired: 0, released: 0, open: 0 })
  })

  it('does not leak across a burst of failures', async () => {
    const activity = countingActivity()
    for (let index = 0; index < 12; index++) {
      const name = `com.example.burst${index}`
      const result = await h.apply(project, installPlan(name), {
        activity: activity.port,
        hooks: failAt(['move-in:item:after'])
      })
      expect(result.status).toBe('rolled_back')
      expect(h.operations.listActive()).toEqual([])
    }
    expect(activity.stats()).toEqual({ acquired: 12, released: 12, open: 0 })
  })
})

describe('P9-B database lock: crash/recover cycles leave no active row', () => {
  it('manual recovery gives way to a transaction that is actually running', async () => {
    const planId = installPlan('com.example.slow')
    const source = h.packageSource()
    let leave!: () => void
    let entered!: () => void
    const left = new Promise<void>((resolve) => {
      leave = resolve
    })
    const reachedDownload = new Promise<void>((resolve) => {
      entered = resolve
    })
    const service = h.service({
      packages: {
        ensurePackage: async (input) => {
          entered()
          await left
          return source.ensurePackage(input)
        }
      }
    })

    let opId = ''
    const running = service.apply({
      projectKey: h.keyOf(project),
      planId,
      onStarted: (id) => {
        opId = id
      }
    })
    await reachedDownload
    expect(service.isProjectBusy(h.keyOf(project))).toBe(true)

    const recovery = h.recovery({ isProjectBusy: (key) => service.isProjectBusy(key) })
    expect(recovery.inspect(opId)).toMatchObject({ action: 'wait', reason: 'project_busy' })
    const outcome = await recovery.recover(opId)
    expect(outcome).toMatchObject({ applied: false, resultStatus: 'applying' })
    expect(h.operations.get(opId)?.status).toBe('applying')

    leave()
    expect((await running).status).toBe('committed')
    expect(service.isProjectBusy(h.keyOf(project))).toBe(false)
    // 事务已经结束，恢复只能报告终态，不会再动文件。
    expect(await recovery.recover(opId)).toMatchObject({
      applied: false,
      resultStatus: 'committed'
    })
  })

  it('can recover the same operation repeatedly and finally commit', async () => {
    h.writeInstalledPackage(project, 'com.example.a', '1.0.0')
    const handle = h.makePlan(project, {
      manifest: {
        dependencies: { 'com.example.a': '1.0.0' },
        locked: { 'com.example.a': { version: '1.0.0', dependencies: {} } }
      },
      installed: [{ name: 'com.example.a', version: '1.0.0' }],
      catalog: [h.catalogEntry('com.example.a', '2.0.0')],
      requests: [{ kind: 'upgrade', name: 'com.example.a', version: '2.0.0' }]
    })

    for (let cycle = 0; cycle < 6; cycle++) {
      await expect(
        h.apply(project, handle.planId, { hooks: crashAt('move-in:item:after') })
      ).rejects.toThrow(/simulated crash/)
      expect(h.operations.listActive()).toHaveLength(1)
      await h.recovery().scanAndApply()
      expect(h.operations.listActive()).toEqual([])
      expect(h.operations.findUnresolved(h.keyOf(project))).toBeNull()
      expect(h.installedVersion(project, 'com.example.a')).toBe('1.0.0')
    }

    const result = await h.apply(project, handle.planId)
    expect(result.status).toBe('committed')
    expect(h.installedVersion(project, 'com.example.a')).toBe('2.0.0')
    expect(h.operations.listActive()).toEqual([])
  })
})
