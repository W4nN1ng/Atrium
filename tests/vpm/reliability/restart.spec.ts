import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { ulid } from '../../../src/shared/ulid'
import { TxHarness } from '../install/harness'

/**
 * P9-B：真实退出/重启。
 *
 * 子进程在事务中途 `process.exit(37)`，不关库、不清理；
 * 父测试用新连接手动 recover，随后再让另一个子进程抢同一工程的锁。
 * 证明"恢复不是只在新进程启动时碰巧成立"。
 */

const ROOT = path.resolve(__dirname, '../../..')
const VITE_NODE = path.join(ROOT, 'node_modules', 'vite-node', 'vite-node.mjs')
const FIXTURES = path.join(__dirname, '../install/fixtures')

interface ChildResult {
  code: number | null
  stdout: string
  stderr: string
}

function runFixture(script: string, env: Record<string, string>): Promise<ChildResult> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [VITE_NODE, script], {
      cwd: ROOT,
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe']
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString()
    })
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })
    child.on('error', (error) =>
      resolve({ code: null, stdout, stderr: `${stderr}\n${error.message}` })
    )
    child.on('close', (code) => resolve({ code, stdout, stderr }))
  })
}

function lastJson(stdout: string): Record<string, unknown> | null {
  const line = stdout
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .pop()
  if (!line) return null
  try {
    return JSON.parse(line) as Record<string, unknown>
  } catch {
    return null
  }
}

let h: TxHarness
let project: string

beforeEach(async () => {
  h = await TxHarness.create()
  project = h.addProject()
})

afterEach(() => {
  h.dispose()
})

describe('P9-B real process death and restart', () => {
  it('recovers manually after process death, then lets another process take the lock', async () => {
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
    const planFile = path.join(h.root, 'plan.json')
    fs.writeFileSync(planFile, JSON.stringify(handle.plan))
    const zip = h.buildZip('com.example.a', '2.0.0')
    const zipPath = path.join(h.root, 'zips', 'com.example.a-2.0.0.zip')

    const child = await runFixture(path.join(FIXTURES, 'crash-transaction.ts'), {
      FIX_DB: h.dbFile,
      FIX_DATA_ROOT: h.dataRoot,
      FIX_PROJECT: project,
      FIX_PLAN_FILE: planFile,
      FIX_ZIP: zipPath,
      FIX_SHA: zip.sha256
    })
    expect(child.code, child.stderr.slice(-800)).toBe(37)

    const active = h.operations.listActive()
    expect(active).toHaveLength(1)
    expect(active[0].status).toBe('applying')
    expect(h.installedVersion(project, 'com.example.a')).toBe('2.0.0')

    // 新进程/新连接手动恢复，而不是依赖启动扫描。
    expect(h.recovery().inspect(active[0].id)).toMatchObject({
      action: 'rollback',
      reason: 'before_commit'
    })
    const outcome = await h.recovery().recover(active[0].id)
    expect(outcome).toMatchObject({ applied: true, resultStatus: 'rolled_back' })
    expect(h.installedVersion(project, 'com.example.a')).toBe('1.0.0')
    expect(h.manifestText(project)).toBe(handle.manifestText)
    expect(h.operations.listActive()).toEqual([])

    // 另一进程现在能拿到同一工程的活动操作名额。
    const grab = await runFixture(path.join(FIXTURES, 'create-operation.ts'), {
      FIX_DB: h.dbFile,
      FIX_PROJECT: project,
      FIX_PLAN_HASH: 'b'.repeat(64),
      FIX_OP_ID: ulid()
    })
    expect(lastJson(grab.stdout), grab.stderr.slice(-800)).toMatchObject({ ok: true })
    expect(h.operations.listActive()).toHaveLength(1)
  }, 120_000)
})
