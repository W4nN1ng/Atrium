import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { openDatabase, closeDatabase, type Db } from '../../src/main/db'
import { upsertProject } from '../../src/main/db/repos/unity'
import { applyDetection, detectRunning } from '../../src/main/project/running'
import type { WmiProbeResult } from '../../src/main/project/wmi'

/**
 * `applyDetection` 的落库纪律。
 *
 * 这个函数每 3 秒被调一次，所以"什么时候写库"本身就是被测行为：
 *
 *  - **状态变了**才写 `is_running` / `last_seen`（否则 SQLite 会被写爆，
 *    而且 `last_seen` 的语义会退化成"最后一次轮询时间"）
 *  - **桥接版本变了**才写 `bridge_version`
 *
 * ⚠ 第二点是 2026-10-06 在真机上查库时发现的缺口：那时 `bridge_version`
 * **永远是 null**（桥接明明在跑、报 1.0.0）。界面看不出来 —— `applyDetection`
 * 返回的 `list` 用活的心跳值覆盖了 —— 但任何直接查库的人都会被误导，
 * 而 `toProjectInfo` 里"还没探测过时的兜底 detectedBy"也依赖这一列。
 */

let root: string
let project: string
let db: Db

/**
 * 假的 WMI 缓存结论："刚查过、没有 Unity 进程"。
 * `queried` 字段必填（它区分"查询失败"与"没查"）。
 */
const NO_WMI: { at: number; result: WmiProbeResult } = {
  at: Date.now(),
  result: { projects: [], error: null, queried: true }
}

function writeHeartbeat(ver: string, pid = 4242): void {
  const dir = path.join(project, 'Temp', 'AVCABridge')
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(
    path.join(dir, 'bridge.json'),
    JSON.stringify({
      protocolVersion: 1,
      pid,
      projectPath: project,
      projectName: 'shinano-Main2',
      unityVersion: '2022.3.22f1',
      bridgeVersion: ver,
      isPlaying: false,
      isCompiling: false,
      isUpdating: false,
      isPlayingWillChangePlaymode: false,
      activeScene: null,
      busyReason: null,
      queueLength: 0,
      heartbeatUtc: Date.now()
    }),
    'utf8'
  )
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'avca-apply-'))
  project = path.join(root, 'shinano-Main2')
  fs.mkdirSync(path.join(project, 'ProjectSettings'), { recursive: true })
  fs.writeFileSync(path.join(project, 'ProjectSettings', 'ProjectVersion.txt'), 'm_EditorVersion: 2022.3.22f1', 'utf8')
  /** 桥接目录得在，`isBridgeInstalled` 才算真 */
  const bd = path.join(project, 'Packages', 'com.avca.bridge')
  fs.mkdirSync(bd, { recursive: true })
  fs.writeFileSync(path.join(bd, 'package.json'), '{"name":"com.avca.bridge","version":"1.0.0"}', 'utf8')

  db = openDatabase(path.join(root, 'library.db'))
  upsertProject(db, { path: project, name: 'shinano-Main2', unityVersion: '2022.3.22f1' })
  void os
  void vi
})

afterEach(() => {
  closeDatabase()
  fs.rmSync(root, { recursive: true, force: true })
})

describe('applyDetection 的落库纪律', () => {
  it('桥接在跑时，**把 bridge_version 落库**（曾经永远是 null）', async () => {
    writeHeartbeat('1.2.3')
    const { evidence } = await detectRunning({ lastWmi: NO_WMI })
    applyDetection(evidence, new Map())

    const row = db.prepare(`SELECT bridge_version FROM project WHERE path = ?`).get(project) as {
      bridge_version: string | null
    }
    expect(row.bridge_version, 'bridge_version 没落库，查库的人会被误导').toBe('1.2.3')
  })

  it('桥接升版本时才改这一列（不是每轮都写）', async () => {
    writeHeartbeat('1.0.0')
    const first = await detectRunning({ lastWmi: NO_WMI })
    applyDetection(first.evidence, new Map())
    expect((db.prepare(`SELECT bridge_version AS v FROM project WHERE path = ?`).get(project) as { v: string }).v).toBe('1.0.0')

    /** 同一版本再跑一轮：值不变 */
    const again = await detectRunning({ lastWmi: NO_WMI })
    applyDetection(again.evidence, new Map([['x', true]]))
    expect((db.prepare(`SELECT bridge_version AS v FROM project WHERE path = ?`).get(project) as { v: string }).v).toBe('1.0.0')

    /** 换成 2.0.0 → 落库 */
    writeHeartbeat('2.0.0')
    const up = await detectRunning({ lastWmi: NO_WMI })
    applyDetection(up.evidence, new Map())
    expect((db.prepare(`SELECT bridge_version AS v FROM project WHERE path = ?`).get(project) as { v: string }).v).toBe('2.0.0')
  })

  it('没有心跳时**不写** bridge_version（不许瞎猜）', async () => {
    const { evidence } = await detectRunning({ lastWmi: NO_WMI })
    applyDetection(evidence, new Map())
    const row = db.prepare(`SELECT bridge_version FROM project WHERE path = ?`).get(project) as {
      bridge_version: string | null
    }
    expect(row.bridge_version).toBeNull()
  })

  it('状态没变时不碰 last_seen（语义是"最后一次看到"，不是"最后一次轮询"）', async () => {
    const { evidence } = await detectRunning({ lastWmi: NO_WMI })
    applyDetection(evidence, new Map())
    const before = db.prepare(`SELECT last_seen FROM project WHERE path = ?`).get(project) as { last_seen: number }

    await new Promise((r) => setTimeout(r, 20))
    const again = await detectRunning({ lastWmi: NO_WMI })
    applyDetection(again.evidence, new Map())
    const after = db.prepare(`SELECT last_seen FROM project WHERE path = ?`).get(project) as { last_seen: number }
    expect(after.last_seen).toBe(before.last_seen)
  })

  it('返回的 list 里桥接信息来自**活的心跳**，不只是库', async () => {
    writeHeartbeat('9.9.9')
    const { evidence } = await detectRunning({ lastWmi: NO_WMI })
    const { list } = applyDetection(evidence, new Map())
    const mine = list.find((p) => p.name === 'shinano-Main2')!
    expect(mine.bridgeVersion).toBe('9.9.9')
    expect(mine.bridgeInstalled).toBe(true)
    expect(mine.detectedBy).toContain('bridge')
    expect(mine.running).toBe(true)
  })
})
