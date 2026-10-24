import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { ulid } from '../../../src/shared/ulid'
import { TxHarness } from './harness'

/**
 * 真·跨进程验证：
 * - 两个 Node 进程同时给同一工程建操作 → 只有一个成功（DB 唯一索引是跨进程锁）；
 * - 一个进程在事务中途 `process.exit(37)`（不清理、不关库）→ 另一个进程启动恢复能回滚。
 *
 * 子进程用 `vite-node` 跑同一份 TS 源码，不是重写一份 SQL。
 */

const ROOT = path.resolve(__dirname, '../../..')
const VITE_NODE = path.join(ROOT, 'node_modules', 'vite-node', 'vite-node.mjs')
const FIXTURES = path.join(__dirname, 'fixtures')

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
    child.on('error', (error) => resolve({ code: null, stdout, stderr: `${stderr}\n${error.message}` }))
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

describe('cross-process lock', () => {
  it('lets exactly one of two processes create an operation for the same project', async () => {
    const env = {
      FIX_DB: h.dbFile,
      FIX_PROJECT: project,
      FIX_PLAN_HASH: 'a'.repeat(64)
    }
    const [first, second] = await Promise.all([
      runFixture(path.join(FIXTURES, 'create-operation.ts'), { ...env, FIX_OP_ID: ulid() }),
      runFixture(path.join(FIXTURES, 'create-operation.ts'), { ...env, FIX_OP_ID: ulid() })
    ])

    const results = [lastJson(first.stdout), lastJson(second.stdout)].filter(
      (item): item is Record<string, unknown> => item !== null
    )
    expect(results).toHaveLength(2)
    expect(results.filter((item) => item.ok === true)).toHaveLength(1)
    const rejected = results.filter((item) => item.ok === false)
    expect(rejected).toHaveLength(1)
    expect(rejected[0].code).toBe('vpmProjectBusy')
    // 父进程能看到子进程写下的那一行。
    expect(h.operations.listActive()).toHaveLength(1)
  }, 60_000)
})

describe('real process death', () => {
  it('recovers in a new process after the transaction process dies mid-move', async () => {
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
    // 进程真的死了：操作停在 applying，现场是"新包已就位、旧包在事务区"。
    const active = h.operations.listActive()
    expect(active).toHaveLength(1)
    expect(active[0].status).toBe('applying')
    expect(h.installedVersion(project, 'com.example.a')).toBe('2.0.0')

    // 新进程/新连接做启动恢复。
    const decisions = h.recovery().scan()
    expect(decisions[0]).toMatchObject({ action: 'rollback', reason: 'before_commit' })
    const outcomes = await h.recovery().apply(decisions)
    expect(outcomes[0]).toMatchObject({ resultStatus: 'rolled_back' })

    expect(h.installedVersion(project, 'com.example.a')).toBe('1.0.0')
    expect(h.manifestText(project)).toBe(handle.manifestText)
    expect(h.operations.listActive()).toEqual([])
  }, 90_000)
})
