import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  OperationLogService,
  buildDiagnostics,
  clearUsage,
  exportDiagnostics,
  toLogEntry,
  usageOf
} from '../../../src/main/vpm/log'
import type { OperationRecord } from '../../../src/main/vpm/install'

let root: string

function record(overrides: Partial<OperationRecord> = {}): OperationRecord {
  return {
    id: 'op-1',
    projectKey: 'e:\\secret\\demo',
    projectPath: 'E:\\secret\\Demo',
    kind: 'install',
    status: 'committed',
    planJson: '{"secret":"plan"}',
    planHash: 'deadbeef',
    projectFingerprint: 'fp',
    manifestBeforeHash: 'aaa',
    manifestAfterHash: 'bbb',
    summaryJson: null,
    errorCode: null,
    errorDetail: 'C:\\Users\\me\\very-secret-file.txt',
    vaultPending: false,
    createdAt: 1000,
    finishedAt: 2000,
    steps: [
      { opId: 'op-1', step: 'prepare', seq: 1, status: 'done', attempts: 1, detailJson: null, startedAt: 1, finishedAt: 2 },
      { opId: 'op-1', step: 'download', seq: 2, status: 'failed', attempts: 1, detailJson: null, startedAt: 3, finishedAt: 4 }
    ],
    files: [],
    ...overrides
  } as unknown as OperationRecord
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'atrium-log-'))
})

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true })
})

describe('operation log redaction (P8-B)', () => {
  it('keeps codes/steps but drops paths, plan and hashes', () => {
    const entry = toLogEntry(record())
    expect(entry).toMatchObject({
      projectName: 'Demo',
      kind: 'install',
      status: 'committed',
      failedStep: 'download',
      stepCount: 2
    })
    const text = JSON.stringify(entry)
    expect(text).not.toContain('E:\\\\secret')
    expect(text).not.toContain('very-secret-file')
    expect(text).not.toContain('deadbeef')
    expect(text).not.toContain('plan')
  })

  it('merges recent operations across projects and sorts by time', () => {
    const service = new OperationLogService({
      operations: {
        list: (key: string) =>
          key === 'a'
            ? [record({ id: 'a1', createdAt: 10 } as never)]
            : [record({ id: 'b1', createdAt: 30 } as never), record({ id: 'b2', createdAt: 20 } as never)]
      },
      projects: { list: () => [{ projectKey: 'a' }, { projectKey: 'b' }] } as never
    })
    expect(service.recent(5).map((item) => item.id)).toEqual(['b1', 'b2', 'a1'])
  })
})

describe('usage and cleanup (P8-B)', () => {
  it('reports sizes of cache / vault / backups only', () => {
    for (const dir of ['cache', 'vault', 'backups']) {
      fs.mkdirSync(path.join(root, dir), { recursive: true })
      fs.writeFileSync(path.join(root, dir, 'x.bin'), Buffer.alloc(10))
    }
    const usage = usageOf(root)
    expect(usage.cache.files).toBe(1)
    expect(usage.vault.bytes).toBe(10)
    expect(usage.totalBytes).toBe(30)
  })

  it('clears only the cache, and refuses anything else', () => {
    fs.mkdirSync(path.join(root, 'cache'), { recursive: true })
    fs.writeFileSync(path.join(root, 'cache', 'x.bin'), Buffer.alloc(5))
    expect(clearUsage(root, 'cache')).toEqual({ removedBytes: 5 })
    expect(fs.existsSync(path.join(root, 'cache'))).toBe(true)
    expect(fs.readdirSync(path.join(root, 'cache'))).toEqual([])

    // vault / 备份不能通过这个入口删
    expect(() => clearUsage(root, 'vault' as never)).toThrow()
    expect(() => clearUsage(root, 'backups' as never)).toThrow()
  })
})

describe('diagnostics package (P8-B)', () => {
  it('contains no paths or secrets', () => {
    const payload = buildDiagnostics({
      appVersion: '0.9.0',
      platform: 'win32',
      dataRoot: 'C:\\Users\\me\\AppData\\Roaming\\Atrium',
      status: { enabled: true, safeMode: false, degraded: false },
      operations: [toLogEntry(record())],
      usage: usageOf(root)
    })
    const text = JSON.stringify(payload)
    expect(text).not.toContain('C:\\\\Users')
    expect(text).not.toContain('very-secret')
    expect(payload).toMatchObject({ kind: 'atrium-vpm-diagnostics', version: 1 })
  })

  it('writes a readable zip', async () => {
    const file = await exportDiagnostics(root, { hello: 'world' }, 1_700_000_000_000)
    expect(fs.existsSync(file)).toBe(true)
    expect(file.endsWith('.zip')).toBe(true)
    expect(fs.existsSync(`${file}.part`)).toBe(false)
    expect(fs.statSync(file).size).toBeGreaterThan(0)
  })
})
