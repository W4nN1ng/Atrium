import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { openDatabase, closeDatabase, type Db } from '../../src/main/db'
import { upsertProject } from '../../src/main/db/repos/unity'
import { detectRunning, __resetRunningObserve } from '../../src/main/project/running'
import type { WmiProbeResult } from '../../src/main/project/wmi'
import { WMI_ONLY_GRACE_MS } from '../../src/shared/constants'

/**
 * 「只剩 WMI 一路撑着工程在运行」的宽限期。
 *
 * 真机（2026-10-07，§8-2）抓到的形状：Unity 编辑器的进程 31956 早就没了
 * （外部复算同一条 `Get-CimInstance` 返回 0 行），A 每 5 秒重查却仍然报
 * `running:true / detectedBy:['wmi']`，日志里"已关闭"一条都没有 ——
 * 用户看到的是顶栏说"运行中"、点导入要等超时才报错。
 *
 * 机制没完全定位（所以顺手加了两条观测日志：`[wmi] 这一轮认出 N 个…`、
 * `[running] 只有 wmi 认…`），但**结论可以先立**：WMI 是间接证据，
 * 不能单独长期撑着"在运行"。这里测的就是那条宽限期。
 */

let root: string
let project: string
let db: Db
let projectId: string

const HIT = (pid: number): WmiProbeResult => ({ projects: [{ pid, projectPath: project }], error: null, queried: true })
const NONE: WmiProbeResult = { projects: [], error: null, queried: true }

function heartbeat(at?: number): void {
  const dir = path.join(project, 'Temp', 'AVCABridge')
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(
    path.join(dir, 'bridge.json'),
    JSON.stringify({
      protocolVersion: 1,
      pid: 4242,
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
      heartbeatUtc: at ?? Date.now()
    }),
    'utf8'
  )
}
function dropHeartbeat(): void {
  fs.rmSync(path.join(project, 'Temp'), { recursive: true, force: true })
}

const run = async (now: number, probe: () => Promise<WmiProbeResult>) => {
  const { evidence } = await detectRunning({ lastWmi: null, now, probe })
  return evidence.find((e) => e.projectId === projectId)
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'avca-wmigrace-'))
  project = path.join(root, 'Shinano-Main2')
  fs.mkdirSync(project, { recursive: true })
  db = openDatabase(path.join(root, 'library.db'))
  upsertProject(db, { path: project, name: path.basename(project), unityVersion: '2022.3.22f1', bridgeVersion: null })
  /** id 是 `upsertProject` 自己生成的 ULID，不能猜 —— 猜了就 find 不到、六条用例全红 */
  projectId = (db.prepare('SELECT id FROM project WHERE path = ?').get(project) as { id: string }).id
  __resetRunningObserve()
})

afterEach(() => {
  closeDatabase()
  try {
    fs.rmSync(root, { recursive: true, force: true })
  } catch {
    /* 交给系统 */
  }
})

describe('只剩 wmi 时的宽限期', () => {
  it('常量本身要钉住（数字改了=行为改了，光看用例是看不出来的）', () => {
    expect(WMI_ONLY_GRACE_MS).toBe(15_000)
  })

  it('第一轮先信它（Unity 刚开、锁文件/桥接还没起来的窗口）', async () => {
    const t0 = Date.now()
    const e = await run(t0, async () => HIT(31956))
    expect(e?.running).toBe(true)
    expect(e?.detectedBy).toEqual(['wmi'])
  })

  it('超过宽限期还不认第二路证据 → 判未运行（§8-2 卡住的就是这个形状）', async () => {
    const t0 = Date.now()
    const first = await run(t0, async () => HIT(31956))
    expect(first?.running).toBe(true)
    /** 中间几轮都在宽限期内：每轮都不该翻脸 */
    for (let k = 1; k <= 4; k++) {
      const e = await run(t0 + k * 3000, async () => HIT(31956))
      expect(e?.running, `第 ${k} 轮还在宽限期内`).toBe(true)
    }
    const late = await run(t0 + WMI_ONLY_GRACE_MS + 1000, async () => HIT(31956))
    expect(late?.running, 'wmi 单独撑着超过宽限期，必须按未运行处理').toBe(false)
    expect(late?.detectedBy).toEqual([])
  })

  it('有桥接心跳时不受这条影响（三路取并集本来就是并集）', async () => {
    const t0 = Date.now()
    /**
     * 注入的 `now` 只能往前挪几秒：`isHeartbeatStale` 判的是
     * `now - probe.seenAt`（`seenAt` 是**读文件的真实时刻**），
     * 挪过 `BRIDGE_STALE_MS`(10 秒) 心跳就先被判陈旧，测的就不是 wmi 了。
     */
    for (let k = 0; k <= 6; k++) {
      heartbeat()
      const e = await run(t0 + k * 1500, async () => HIT(31956))
      expect(e?.running, `第 ${k} 轮：桥接心跳在，wmi 只是加分项`).toBe(true)
      expect(e?.detectedBy).toContain('bridge')
    }
  })

  it('更强证据回来过，计时要清零 —— 不许拿旧账立刻判死', async () => {
    const t0 = Date.now()
    await run(t0, async () => HIT(1))
    heartbeat(t0 + 8000)
    const mid = await run(t0 + 8000, async () => HIT(1))
    expect(mid?.running).toBe(true)
    dropHeartbeat()
    /** 心跳刚消失：这是"Unity 关了"的正常路径，锁文件/心跳都没了但 wmi 还在 ——
     *  重新给一整段宽限期，而不是"从 t0 算起已经超了" */
    const after = await run(t0 + 10_000, async () => HIT(1))
    expect(after?.running, '刚失去强证据就立刻判死会误伤（Unity 关到一半）').toBe(true)
    const late = await run(t0 + 10_000 + WMI_ONLY_GRACE_MS + 1000, async () => HIT(1))
    expect(late?.running).toBe(false)
  })

  it('wmi 自己空了 → 立刻就是未运行（宽限期只管"只剩它"那种情况）', async () => {
    const e = await run(Date.now(), async () => NONE)
    expect(e?.running).toBe(false)
  })
})
