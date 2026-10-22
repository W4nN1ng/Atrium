import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { TxHarness, crashAt, fakeActivity } from './harness'

let h: TxHarness
let project: string

beforeEach(async () => {
  h = await TxHarness.create()
  project = h.addProject()
})

afterEach(() => {
  h.dispose()
})

function installPlan(projectPath: string, name: string, version = '1.0.0'): string {
  return h.makePlan(projectPath, {
    catalog: [h.catalogEntry(name, version)],
    requests: [{ kind: 'install', name }]
  }).planId
}

describe('project lock', () => {
  it('rejects a second operation on the same project while one is active', async () => {
    const first = installPlan(project, 'com.example.a')
    const second = installPlan(project, 'com.example.b')

    const settled = await Promise.allSettled([
      h.apply(project, first),
      h.apply(project, second)
    ])

    const fulfilled = settled.filter((item) => item.status === 'fulfilled')
    const rejected = settled.filter((item) => item.status === 'rejected')
    expect(fulfilled).toHaveLength(1)
    expect(rejected).toHaveLength(1)
    expect((fulfilled[0] as PromiseFulfilledResult<{ status: string }>).value.status).toBe('committed')
    expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({ code: 'vpmProjectBusy' })

    // 只有一个包真的被装上，另一个连操作行都没建。
    const installed = fs
      .readdirSync(path.join(project, 'Packages'), { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name.startsWith('com.example.'))
      .map((entry) => entry.name)
    expect(installed).toHaveLength(1)
    expect(h.operations.list(h.keyOf(project), 10).length).toBeGreaterThanOrEqual(1)
  })

  it('allows two different projects to run in parallel', async () => {
    const other = h.addProject('OtherProject')
    const first = installPlan(project, 'com.example.a')
    const second = installPlan(other, 'com.example.b')

    const [a, b] = await Promise.all([h.apply(project, first), h.apply(other, second)])

    expect(a.status).toBe('committed')
    expect(b.status).toBe('committed')
    expect(h.installedVersion(project, 'com.example.a')).toBe('1.0.0')
    expect(h.installedVersion(other, 'com.example.b')).toBe('1.0.0')
    expect(h.operations.listActive()).toEqual([])
  })

  it('releases the lock after a normal run, so the next operation can start', async () => {
    const first = installPlan(project, 'com.example.a')
    expect((await h.apply(project, first)).status).toBe('committed')

    const second = h.makePlan(project, {
      manifest: h.readManifest(project),
      installed: [{ name: 'com.example.a', version: '1.0.0' }],
      catalog: [h.catalogEntry('com.example.b', '1.0.0')],
      requests: [{ kind: 'install', name: 'com.example.b' }]
    })
    expect((await h.apply(project, second.planId)).status).toBe('committed')
    expect(h.installedVersion(project, 'com.example.b')).toBe('1.0.0')
  })

  it('releases the lock after a crash is recovered', async () => {
    const first = installPlan(project, 'com.example.a')
    await expect(h.apply(project, first, { hooks: crashAt('move-in:item:after') })).rejects.toThrow(
      /simulated crash/
    )

    const next = installPlan(project, 'com.example.b')
    await expect(h.apply(project, next)).rejects.toMatchObject({ code: 'vpmProjectBusy' })

    await h.recovery().scanAndApply()
    expect(h.operations.listActive()).toEqual([])

    const retry = installPlan(project, 'com.example.b')
    expect((await h.apply(project, retry)).status).toBe('committed')
  })
})

describe('activity gate', () => {
  it('refuses to install while assets are being imported', async () => {
    const planId = installPlan(project, 'com.example.a')
    const result = await h.apply(project, planId, {
      activity: fakeActivity({ unityRunning: false, importing: true })
    })

    expect(result.status).toBe('failed')
    expect(result.errorCode).toBe('vpmProjectImporting')
    expect(h.exists(h.packageDir(project, 'com.example.a'))).toBe(false)
    expect(h.readManifest(project).dependencies).toEqual({})
  })

  it('refuses to install while Unity is running', async () => {
    const planId = installPlan(project, 'com.example.a')
    const result = await h.apply(project, planId, {
      activity: fakeActivity({ unityRunning: true, importing: false })
    })

    expect(result.status).toBe('failed')
    expect(result.errorCode).toBe('vpmUnityRunning')
    expect(h.exists(h.packageDir(project, 'com.example.a'))).toBe(false)
  })

  it('fails closed when the activity gate itself throws', async () => {
    const planId = installPlan(project, 'com.example.a')
    const result = await h.apply(project, planId, {
      activity: fakeActivity(() => {
        throw new Error('gate exploded')
      })
    })

    expect(result.status).toBe('failed')
    expect(result.errorCode).toBe('vpmUnityRunning')
    expect(h.exists(h.packageDir(project, 'com.example.a'))).toBe(false)
  })
})

describe('double apply and external changes', () => {
  it('does not install twice when the same plan is applied again', async () => {
    const planId = installPlan(project, 'com.example.a')
    const first = await h.apply(project, planId)
    expect(first.status).toBe('committed')

    const second = await h.apply(project, planId)
    expect(second.status).toBe('failed')
    expect(second.errorCode).toBe('vpmProjectChanged')

    const manifest = h.readManifest(project)
    expect(manifest.dependencies).toEqual({ 'com.example.a': '*' })
    expect(Object.keys(manifest.locked as Record<string, unknown>)).toEqual(['com.example.a'])
    expect(h.installedVersion(project, 'com.example.a')).toBe('1.0.0')
    // 第二次没有留下任何活动操作。
    expect(h.operations.listActive()).toEqual([])
  })

  it('refuses when another tool changed the manifest during the transaction', async () => {
    const planId = installPlan(project, 'com.example.a')
    const result = await h.apply(project, planId, {
      hooks: {
        onPoint: async (point) => {
          if (point !== 'move-in:before') return
          // 模拟 Unity/VCC 在事务中途改了 manifest。
          h.writeManifest(project, { dependencies: { 'com.external.pkg': '2.0.0' }, locked: {} })
        }
      }
    })

    expect(result.status).toBe('rolled_back')
    expect(result.errorCode).toBe('vpmProjectChanged')
    // 外部写入的 manifest 保留，不被我们的新 manifest 覆盖。
    expect((h.readManifest(project).dependencies as Record<string, string>)['com.external.pkg']).toBe('2.0.0')
    expect(h.exists(h.packageDir(project, 'com.example.a'))).toBe(false)
  })
})
