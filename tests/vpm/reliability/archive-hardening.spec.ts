import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { TxHarness, crashAt } from '../install/harness'

/**
 * P9-B：提交后的归档补完是"尽力而为"，不能反过来卡死启动/工程。
 *
 * 用 lstat 的 EACCES 注入模拟"归档阶段看不了事务区"；
 * 旧实现会让异常从 scanAndApply 冒出去；现在必须只保留 vault_pending。
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

describe('P9-B archive hardening', () => {
  it('keeps the commit and reports vault_pending when archive inspection throws', async () => {
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
    await expect(
      h.apply(project, handle.planId, { hooks: crashAt('manifest:after-rename') })
    ).rejects.toThrow(/simulated crash/)
    const opId = h.operations.listActive()[0].id
    const trash = `${path.sep}${opId}${path.sep}trash`
    const realLstat = fs.lstatSync.bind(fs)
    const spy = vi.spyOn(fs, 'lstatSync').mockImplementation(((
      target: fs.PathLike,
      options?: fs.StatOptions
    ) => {
      if (String(target).includes(trash)) {
        throw Object.assign(new Error('EACCES: archive inspection blocked'), { code: 'EACCES' })
      }
      return realLstat(target, options as never)
    }) as typeof fs.lstatSync)

    let outcomes: Awaited<ReturnType<ReturnType<TxHarness['recovery']>['scanAndApply']>>
    try {
      outcomes = await h.recovery().scanAndApply()
    } finally {
      spy.mockRestore()
    }
    expect(outcomes[0]).toMatchObject({ applied: true, resultStatus: 'committed' })
    expect(h.operations.get(opId)).toMatchObject({
      status: 'committed',
      vaultPending: true
    })
    expect(h.installedVersion(project, 'com.example.a')).toBe('2.0.0')
    expect(h.operations.listActive()).toEqual([])

    // 工程没有被归档失败挡住：还能继续装下一个包。
    const next = h.makePlan(project, {
      manifest: h.readManifest(project),
      installed: [{ name: 'com.example.a', version: '2.0.0' }],
      catalog: [h.catalogEntry('com.example.b', '1.0.0')],
      requests: [{ kind: 'install', name: 'com.example.b' }]
    })
    expect((await h.apply(project, next.planId)).status).toBe('committed')
  })
})
