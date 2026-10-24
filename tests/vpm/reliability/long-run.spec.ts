import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ResolverInstalled } from '../../../src/shared/vpm/domain/resolver'
import { TxHarness } from '../install/harness'

/**
 * P9-B：长稳（加速版）。
 *
 * 不是替代真机长时间挂机，而是在同一份 SQLite/journal 上连续跑 40 次真实文件事务，
 * 查 active 行、running 步骤、journal 提交点和 DB 完整性是否随次数漂移。
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

function installedOf(): ResolverInstalled[] {
  const manifest = h.readManifest(project)
  const locked = (manifest.locked ?? {}) as Record<
    string,
    { version: string; dependencies?: Record<string, string> }
  >
  return Object.entries(locked).map(([name, value]) => ({
    name,
    version: value.version,
    dependencies: value.dependencies ?? {}
  }))
}

describe('P9-B long run', () => {
  it('stays consistent across 40 sequential installs', async () => {
    const started = Date.now()
    for (let index = 0; index < 40; index++) {
      const name = `com.example.long${String(index).padStart(2, '0')}`
      const plan = h.makePlan(project, {
        manifest: h.readManifest(project),
        installed: installedOf(),
        catalog: [h.catalogEntry(name, '1.0.0')],
        requests: [{ kind: 'install', name }]
      })
      const result = await h.apply(project, plan.planId)
      expect(result.status, name).toBe('committed')
      expect(h.installedVersion(project, name)).toBe('1.0.0')
      expect(h.operations.listActive()).toEqual([])
    }
    const elapsed = Date.now() - started

    expect(installedOf()).toHaveLength(40)
    expect(h.operations.findUnresolved(h.keyOf(project))).toBeNull()
    expect(h.db.pragma('integrity_check', { simple: true })).toBe('ok')

    const records = h.operations.list(h.keyOf(project), 100)
    expect(records).toHaveLength(40)
    for (const record of records) {
      expect(record.status).toBe('committed')
      expect(record.errorCode).toBeNull()
      expect(record.steps.some((step) => step.status === 'running')).toBe(false)
      expect(record.steps.every((step) => step.status === 'done' || step.status === 'skipped')).toBe(
        true
      )
      const journal = h.journalOf(project, record.id)
      expect(journal.commitPoint).toBe('manifest_written')
      expect(journal.phase).toBe('committed')
    }

    // 证据写进测试输出，交接文档引用同一组数字（不同机器会不同）。
    console.log(
      `[P9-B] long-run: 40 commits, ${elapsed}ms, ` +
        `${h.operations.list(h.keyOf(project), 100).length} journal(s) committed`
    )
  }, 120_000)
})
