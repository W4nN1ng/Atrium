import path from 'node:path'
import log from 'electron-log'
import type { ProjectInfo } from '../../shared/types'
import { WMI_ONLY_GRACE_MS } from '../../shared/constants'
import { getDb } from '../db'
import { listProjects, toProjectInfo } from '../db/repos/unity'
import { isBridgeInstalled, isHeartbeatStale, readHeartbeat, type HeartbeatProbe } from '../bridge/mailbox'
import { probeUnityLockfile } from './lockfile'
import { probeUnityProcesses, type WmiProbeResult } from './wmi'

/**
 * 三路取并集判定"Unity 是否开着这个工程"（第 3 份 §4.2）。
 *
 * ```
 *   路径 1  ALCOM 清单 / 扫盘         → 有哪些工程（`project/api.ts` 已做）
 *   路径 2  Temp/UnityLockfile 独占试开 → 每 3 秒，轻量，硬证据
 *   路径 3  WMI 进程命令行             → 每 5 秒，慢且**管理员 Unity 读不到**，仅兜底
 *   路径 4  桥接心跳 bridge.json       → 事件驱动（chokidar），最可靠
 * ```
 *
 * 「三者结果合并，**任一命中即认为工程在运行**」。
 *
 * ⚠ 为什么不能只靠 WMI：Unity 以管理员权限启动时非管理员进程读不到它的 CommandLine，
 * 这是 Windows 的既定行为。只看这一路会变成"偶尔检测不到 Unity"，而且只在用户
 * 用管理员身份跑 Unity 时才复现 —— 极难自己发现。见 `wmi.ts` 的注释。
 *
 * ⚠ 这里**不**做"三路都失败就清掉 project 记录"这种清理：规格 §2.2 明确
 * 「清理该实例但**保留 project 记录**」。
 *
 * ## ⚠ 这个模块曾经是死代码（2026-10-06 在真 Unity 上才发现）
 *
 * `detectRunning` / `applyDetection` 写完之后，**没有任何地方 import 它**。
 * 于是工程页的"运行中"永远来自 `project.is_running` 这个陈旧列：
 * 用户明明开着 `shinano-Main2`，界面上却是"未运行"，而同一页还写着
 * "运行状态三路取并集判定" —— 文案在说谎。
 *
 * 为什么单测没抓到：那些测试**直接调 `detectRunning`**，验的是探测逻辑本身
 * （那部分是对的）。没有任何测试问"它被接上了吗"。
 * 教训：**"实现了"不等于"生效了"**，接线本身需要一个从入口进去的测试。
 * 现在的接线点在 `project/api.ts` 的 `startProjectWatcher`，
 * `tests/project/running-wiring.spec.ts` 从 IPC 入口验这件事。
 */

export interface DetectionEvidence {
  projectPath: string
  projectId: string
  name: string
  running: boolean
  bridge: HeartbeatProbe
  lockfile: ReturnType<typeof probeUnityLockfile>
  wmiHit: boolean
  detectedBy: ProjectInfo['detectedBy']
  bridgeInstalled: boolean
  busyReason: string | null
}

export interface DetectOptions {
  /** 上一次 WMI 查询的结果与时刻：WMI 每 5 秒才查一次（§4.2），期间复用上次结论 */
  lastWmi?: { at: number; result: WmiProbeResult } | null
  wmiIntervalMs?: number
  now?: number
  /**
   * 注入 WMI 探测。**默认就是真的那个**（`probeUnityProcesses`）。
   * 之所以要能换：§8-2 那个"Unity 关了 A 还报运行中"的毛病只在真机上出现，
   * 而这一路的结论是**跨轮缓存**的 —— 要测"上一轮命中、这一轮没了"就必须能控制
   * 每一轮返回什么，而不是只能等真进程消失。
   */
  probe?: () => Promise<WmiProbeResult>
}

/** 上一轮 wmi 命中集合的指纹（只在变了时打日志用） */
let lastWmiHitKey = ''
/** 每个工程"只剩 wmi 撑着"是从什么时候开始的（超 `WMI_ONLY_GRACE_MS` 就不认了） */
const wmiOnlySince = new Map<string, number>()
/** 每个工程"只剩 wmi 撑着"这条 warn 的上次时刻（限频 60 秒） */
const lastWmiOnlyWarnAt = new Map<string, number>()
/** 只给测试用：把观测状态复位 */
export function __resetRunningObserve(): void {
  lastWmiHitKey = ''
  lastWmiOnlyWarnAt.clear()
  wmiOnlySince.clear()
}

/** 只在 WMI 命中集合里按 **Windows 路径规则**比较：大小写不敏感、斜杠统一 */
function samePath(a: string, b: string): boolean {
  const n = (p: string): string => path.win32.normalize(p).replace(/\\+$/, '').toLowerCase()
  return n(a) === n(b)
}

/**
 * 跑一轮探测。**只读**：不写库、不改磁盘（写库交给调用方 `applyDetection`）。
 * 这样可以先在只读模式下跑通、看懂了再决定要不要落库。
 */
export async function detectRunning(opts: DetectOptions = {}): Promise<{
  evidence: DetectionEvidence[]
  wmi: WmiProbeResult
}> {
  const db = getDb()
  const now = opts.now ?? Date.now()
  const wmiInterval = opts.wmiIntervalMs ?? 5000

  const projects = listProjects(db)

  /**
   * WMI 是四路里最慢的一路，所以按 `wmiIntervalMs` 节流；
   * 没到点就复用上次结论（不要更频繁 —— 规格 §4.2 明说）。
   */
  let wmi: WmiProbeResult
  const cached = opts.lastWmi
  if (cached && now - cached.at < wmiInterval) {
    wmi = cached.result
  } else {
    wmi = await (opts.probe ?? probeUnityProcesses)()
  }
  /**
   * 观测（2026-10-07 真机加）：**wmi 这一路命中了什么，之前没有任何地方看得见**。
   * 症状是"Unity 早就关了、A 还报 running:true / detectedBy:['wmi']"，
   * 而同一条 PowerShell 在外部复算返回空 —— 没有这行日志就只能靠猜。
   * 只在命中集合**变了**的时候打一行，不每 3 秒刷屏。
   */
  const hitKey = wmi.projects.map((w) => w.pid + '=' + w.projectPath.toLowerCase()).join(';')
  if (hitKey !== lastWmiHitKey) {
    lastWmiHitKey = hitKey
    log.info(
      `[wmi] 这一轮认出 ${wmi.projects.length} 个带 -projectPath 的 Unity 进程：${hitKey || '（无）'}` +
        (wmi.error ? ' · 查询失败：' + wmi.error.split('\n')[0] : '')
    )
  }

  const evidence: DetectionEvidence[] = projects.map((row) => {
    const bridge = readHeartbeat(row.path)
    const lockfile = probeUnityLockfile(row.path)
    const wmiHit = wmi.projects.some((w) => samePath(w.projectPath, row.path))

    const detectedBy: ProjectInfo['detectedBy'] = []
    if (bridge.heartbeat && !isHeartbeatStale(bridge, now)) detectedBy.push('bridge')
    if (lockfile.held) detectedBy.push('lockfile')
    if (wmiHit) detectedBy.push('wmi')
    /**
     * **wmi 不许单独长期撑着"在运行"**（2026-10-07 真机定下来的）。
     *
     * 桥接心跳和 `UnityLockfile` 都是"**这个工程**现在被人开着"的直接证据；
     * wmi 只是"有个 `Unity.exe` 的命令行里写着这个工程路径"，是间接证据。
     * 真机实测它会卡在一个**已经消失的 pid** 上：编辑器进程 31956 早没了
     * （外部复算同一条 `Get-CimInstance` 返回 0 行），A 每 5 秒重查却仍然报命中，
     * 于是 §8-2 那条"关掉 Unity → 10 秒内标退出"永远不成立，
     * 用户看到的是"顶栏说运行中、点导入要等超时才报错"。
     *
     * 所以给它一个宽限期：只剩 wmi 时先信 `WMI_ONLY_GRACE_MS`（覆盖"Unity 刚开、
     * 锁文件还没建、桥接还没装"那段真实窗口），超时就不认了，并留一条 warn。
     */
    if (detectedBy.length === 1 && detectedBy[0] === 'wmi') {
      const since = wmiOnlySince.get(row.id)
      if (since === undefined) {
        wmiOnlySince.set(row.id, now)
      } else if (now - since > WMI_ONLY_GRACE_MS) {
        detectedBy.length = 0
        log.warn(
          `[running] 「${row.name}」只剩 wmi 一路撑着，已超过 ${Math.round(WMI_ONLY_GRACE_MS / 1000)} 秒 —— ` +
            '按未运行处理（桥接心跳与锁文件都没命中，进程号多半已经不存在了）'
        )
        wmiOnlySince.delete(row.id)
      }
    } else if (detectedBy.length > 0) {
      wmiOnlySince.delete(row.id)
    } else {
      wmiOnlySince.delete(row.id)
    }
    /**
     * 只剩 wmi 一路撑着"在运行" = 最可疑的形状：桥接没心跳、锁文件也没人拿，
     * 却还有一个进程命令行写着这个工程。真机上 §8-2 卡住的就是这个形状，
     * 所以这里留一条限频 warn（每个工程 60 秒最多一条），下次一眼能看出来。
     */
    if (detectedBy.length === 1 && detectedBy[0] === 'wmi' && now - (lastWmiOnlyWarnAt.get(row.id) ?? 0) > 60_000) {
      lastWmiOnlyWarnAt.set(row.id, now)
      log.warn(
        `[running] 只有 wmi 认「${row.name}」还在运行（桥接心跳与锁文件都没命中）—— ` +
          '如果 Unity 其实已经关了，就是这一路没翻回来'
      )
    }

    /**
     * 桥接心跳本身也是"在运行"的证据，但它比 lockfile 更强：
     * 它能顺带回答"忙不忙、装的哪个版本"。
     */
    const running = detectedBy.length > 0

    return {
      projectPath: row.path,
      projectId: row.id,
      name: row.name,
      running,
      bridge,
      lockfile,
      wmiHit,
      detectedBy,
      bridgeInstalled: isBridgeInstalled(row.path),
      busyReason: bridge.heartbeat?.busyReason ?? null
    }
  })

  return { evidence, wmi }
}

/**
 * 把探测结论落库，并生成给界面用的 `ProjectInfo[]`。
 *
 * ## 写库的节流纪律
 *
 * 这个函数每 3 秒被调一次，所以**只有真的变了才写**：
 *
 *  - `is_running` 变了 → 写 + 记日志（这是用户能看见的状态翻转）
 *  - `bridge_version` 变了 → 写（桥接升级/换版本时才发生，极少）
 *
 * 绝不无条件 UPDATE：那会把 SQLite 写爆，而且 `last_seen` 会退化成
 * "最后一次轮询时间"，语义就不再是"最后一次看到这个工程"了。
 *
 * ⚠ 曾经的缺口（2026-10-06 在真机上查库时发现）：这个函数**从来不写
 * `bridge_version`**。界面看不出来（下面返回的 `list` 用活的心跳值覆盖了），
 * 但 `project.bridge_version` 这一列会**永远停在 null**，
 * 于是 `toProjectInfo` 里那个"还没探测过时的兜底 `detectedBy`"
 * 以及任何直接查库的人都拿到错信息。修法是插值变了才写。
 */
export function applyDetection(
  evidence: DetectionEvidence[],
  previous: Map<string, boolean>
): { changed: Array<{ name: string; path: string; running: boolean; detectedBy: string[] }>; list: ProjectInfo[] } {
  const db = getDb()
  const changed: Array<{ name: string; path: string; running: boolean; detectedBy: string[] }> = []

  const selBridgeVer = db.prepare(`SELECT bridge_version FROM project WHERE id = ?`)
  const updVersion = db.prepare(`UPDATE project SET bridge_version = ? WHERE id = ?`)

  for (const e of evidence) {
    const was = previous.get(e.projectId) ?? false
    if (was !== e.running) {
      db.prepare(`UPDATE project SET is_running = ?, last_seen = ? WHERE id = ?`).run(
        e.running ? 1 : 0,
        Date.now(),
        e.projectId
      )
      changed.push({ name: e.name, path: e.projectPath, running: e.running, detectedBy: e.detectedBy })
      log.info(
        `工程运行状态变化：${e.name} → ${e.running ? '已打开' : '已关闭'}` +
          `（依据：${e.detectedBy.length ? e.detectedBy.join('+') : '三路都没命中'}）`
      )
    }

    /** 心跳里报的桥接版本与库里记的不一致才写（不是每轮都写） */
    const live = e.bridge.heartbeat?.bridgeVersion ?? null
    if (live) {
      const row = selBridgeVer.get(e.projectId) as { bridge_version: string | null } | undefined
      if (row && row.bridge_version !== live) updVersion.run(live, e.projectId)
    }
  }

  const byId = new Map(evidence.map((e) => [e.projectId, e]))
  const list = listProjects(db).map((row) => {
    const base = toProjectInfo(row)
    const e = byId.get(row.id)
    if (!e) return base
    return {
      ...base,
      running: e.running,
      detectedBy: e.detectedBy,
      bridgeInstalled: e.bridgeInstalled,
      bridgeVersion: e.bridge.heartbeat?.bridgeVersion ?? base.bridgeVersion,
      busyReason: e.busyReason,
      lockfilePresent: e.lockfile.present
    }
  })

  return { changed, list }
}
