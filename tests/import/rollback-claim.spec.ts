import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { openDatabase, closeDatabase, type Db } from '../../src/main/db'
import { upsertProject } from '../../src/main/db/repos/unity'
import { rollbackImport, type BridgeLike } from '../../src/main/import/coordinator'
import { bridgeDirOf, writeJsonAtomic } from '../../src/main/bridge/mailbox'
import { BRIDGE_PROTOCOL_VERSION, type BridgeHeartbeat } from '../../src/shared/types'
import { setAppPathsForTest } from '../../src/main/services/paths'
import { ulid } from '../../src/shared/ulid'

/**
 * 撤销导入的**并发闸门**与"没删掉"的如实上报。
 *
 * 这两条都是 2026-10-07 用真 Unity 跑 §8 时抓到的，假对端永远测不出来
 * （假对端自己按包里的 `.meta` 铺文件、自己算 `deleted`，从不经过 Unity 的资源库）：
 *
 *  1. 「整批退回」被点两次（活体脚本双击；人手快双击一样）→ 两次都读到 `status='ok'`
 *     → 同一批资源删两遍，第二遍桥接回 `failed`，而后写的那次把 message 覆盖成
 *     「撤销：删除 0 个新建资源」。数字看着像"本来就没建东西"，用户以为撤销没生效。
 *  2. 桥接回 `failed:[路径…]`（这个资源我没能删掉）以前被直接丢掉 →
 *     界面只剩"删除 0 个"，看不出**有东西还留在工程里**。
 */

let root: string
let project: string
let db: Db
let projectId: string

const GUID_A = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const GUID_B = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'

function heartbeat(): void {
  const hb: BridgeHeartbeat = {
    protocolVersion: BRIDGE_PROTOCOL_VERSION,
    pid: 777,
    projectPath: project,
    projectName: path.basename(project),
    unityVersion: '2022.3.22f1',
    bridgeVersion: '1.0.0',
    isPlaying: false,
    isCompiling: false,
    isUpdating: false,
    isPlayingOrWillChangePlaymode: false,
    activeScene: null,
    busyReason: null,
    queueLength: 0,
    heartbeatUtc: Date.now()
  }
  writeJsonAtomic(path.join(bridgeDirOf(project), 'bridge.json'), hb)
}

/** 一次导入一行账，created 里放这两个 GUID */
function seedImport(created: string[], status = 'ok'): string {
  const id = ulid()
  db.prepare(
    `INSERT INTO import_log (id, project_id, asset_id, unitypackage_path, created_guids_json, overwritten_json, status, kind, started_at, finished_at)
     VALUES (?, ?, NULL, 'x.unitypackage', ?, '[]', ?, 'import', ?, ?)`
  ).run(id, projectId, JSON.stringify(created), status, Date.now(), Date.now())
  return id
}

function fakeBridge(
  onDelete: (n: number) => { deleted: string[]; failed: string[] },
  /** 给 delete 那一步加一道闸：测试要能在"第一次还卡在桥接里"的时候发起第二次 */
  gate?: () => Promise<void>
): { bridge: BridgeLike; deleteCalls: () => number } {
  let calls = 0
  const bridge: BridgeLike = {
    async execute(_p, type, _payload) {
      let data: { deleted: string[]; failed: string[] } | null = null
      if (type === 'delete_guids') {
        if (gate) await gate()
        calls++
        data = onDelete(calls)
      }
      return {
        ok: true,
        status: 'ok',
        data,
        error: null,
        stackTrace: null,
        elapsedMs: 2,
        retries: 0,
        commandId: 'cmd-' + calls
      }
    }
  }
  return { bridge, deleteCalls: () => calls }
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'avca-rbclaim-'))
  setAppPathsForTest(path.join(root, 'appdata'))
  project = path.join(root, 'Shinano-R4LiveTest')
  fs.mkdirSync(path.join(project, 'Assets'), { recursive: true })
  db = openDatabase(path.join(root, 'library.db'))
  projectId = ulid()
  upsertProject(db, { path: project, name: path.basename(project), unityVersion: '2022.3.22f1', bridgeVersion: '1.0.0', isRunning: true })
  heartbeat()
})

afterEach(() => {
  closeDatabase()
  try {
    fs.rmSync(root, { recursive: true, force: true })
  } catch {
    /* 交给系统 */
  }
})

describe('撤销导入的并发闸门（真 Unity 活体抓到的）', () => {
  it('两次撤销真的撞上时（第一次还卡在桥接里）：只有一次去删，第二次停手且不改写第一次的账', async () => {
    const id = seedImport([GUID_A, GUID_B])
    /**
     * 关键是把第二次发起**塞进第一次的 await 窗口里** —— 真机上就是这么撞的：
     * 界面上连点两次「整批退回」，第一次还在等桥接回话、库里状态还没动，
     * 第二次读到的是同一个 `ok`，于是同一批 GUID 被删了两遍。
     */
    let hold = true
    const gate = async (): Promise<void> => {
      while (hold) await new Promise((r) => setTimeout(r, 5))
    }
    const { bridge, deleteCalls } = fakeBridge((n) => ({
      deleted: n === 1 ? ['Assets/A.txt', 'Assets/B.txt'] : [],
      failed: n === 1 ? [] : ['Assets/A.txt', 'Assets/B.txt']
    }), gate)

    const first = rollbackImport(db, bridge, project, id)
    await new Promise((r) => setTimeout(r, 30))
    const second = rollbackImport(db, bridge, project, id)
    await new Promise((r) => setTimeout(r, 30))
    hold = false
    const [a, b] = await Promise.all([first, second])
    const okOnes = [a, b].filter((r) => r.ok)
    const refused = [a, b].filter((r) => !r.ok)

    /** 桥接**只该被叫一次**：两次都去删就是拿白名单在同一批资源上跑两遍 */
    expect(deleteCalls()).toBe(1)
    expect(okOnes).toHaveLength(1)
    expect(refused).toHaveLength(1)
    expect(refused[0].error).toMatch(/正在撤销|已经撤过|还在进行中/)

    const row = db.prepare(`SELECT status, message FROM import_log WHERE id = ?`).get(id) as { status: string; message: string }
    expect(row.status).toBe('rolledback')
    /** 后写的那次不许把数字抹成 0 —— 这是"撤销没生效"这种误判的来源 */
    expect(row.message).toContain('删除 2 个新建资源')
  })

  it('撤完再点一次：状态已经不是 ok，直接拒（不许出现"删除 0 个"那种二次账）', async () => {
    const id = seedImport([GUID_A])
    const { bridge, deleteCalls } = fakeBridge(() => ({ deleted: ['Assets/A.txt'], failed: [] }))
    const one = await rollbackImport(db, bridge, project, id)
    expect(one.ok).toBe(true)
    const two = await rollbackImport(db, bridge, project, id)
    expect(two.ok).toBe(false)
    expect(two.error).toMatch(/正在撤销|已经撤过|还在进行中|只有成功/)
    expect(deleteCalls()).toBe(1)
  })

  it('桥接报 failed（有资源没删掉）→ 如实带出来，不许只写"删除 0 个"', async () => {
    const id = seedImport([GUID_A, GUID_B])
    const { bridge } = fakeBridge(() => ({ deleted: ['Assets/A.txt'], failed: ['Assets/B.txt'] }))
    const r = await rollbackImport(db, bridge, project, id)
    expect(r.ok).toBe(true)
    expect(r.deletedFiles).toEqual(['Assets/A.txt'])
    expect(r.failedToDelete).toEqual(['Assets/B.txt'])
    const row = db.prepare(`SELECT message FROM import_log WHERE id = ?`).get(id) as { message: string }
    expect(row.message).toContain('删除 1 个新建资源')
    expect(row.message).toContain('有 1 个没能删掉')
  })

  it('删除那一步整个失败：状态要退回 ok（能再撤一次），不许卡在 running', async () => {
    const id = seedImport([GUID_A])
    let n = 0
    const bridge: BridgeLike = {
      async execute(_p, type) {
        if (type === 'delete_guids') {
          n++
          return {
            ok: false,
            status: 'error',
            data: null,
            error: 'Unity 拒绝了这个删除',
            stackTrace: null,
            elapsedMs: 2,
            retries: 0,
            commandId: 'c' + n
          }
        }
        return { ok: true, status: 'ok', data: null, error: null, stackTrace: null, elapsedMs: 1, retries: 0, commandId: 'c' + n }
      }
    }
    const r = await rollbackImport(db, bridge, project, id)
    expect(r.ok).toBe(false)
    const row = db.prepare(`SELECT status, message FROM import_log WHERE id = ?`).get(id) as { status: string; message: string | null }
    expect(row.status).toBe('ok')
    expect(row.message ?? '').toContain('撤销没做成')
    /** 还能再撤一次（卡住的话用户只能重启 A） */
    const again = fakeBridge(() => ({ deleted: ['Assets/A.txt'], failed: [] }))
    const second = await rollbackImport(db, again.bridge, project, id)
    expect(second.ok).toBe(true)
  })
})
