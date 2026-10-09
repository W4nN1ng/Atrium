import fs from 'node:fs'
import path from 'node:path'
import log from 'electron-log'
import {
  BRIDGE_DIR,
  BRIDGE_PROTOCOL_VERSION,
  type BridgeCommand,
  type BridgeHeartbeat,
  type BridgeResult
} from '../../shared/types'
import { BRIDGE_STALE_MS } from '../../shared/constants'
import { ulid } from '../../shared/ulid'

/**
 * 文件信箱：A 侧与 Unity 桥接之间**唯一**的通信方式（第 3 份 §2）。
 *
 * ```
 * <Project>/Temp/AVCABridge/
 *   ├─ bridge.json      Unity 写 / A 读    心跳与状态
 *   ├─ inbox/<id>.json  A 写 / Unity 消费后删
 *   └─ outbox/<id>.json Unity 写 / A 读后删
 * ```
 *
 * **为什么是文件而不是 TCP / HTTP / 命名管道（§2.1，不得改）**，原文五条：
 *   1. Unity 不会导入 `Temp/` 下的文件，不会触发无谓的资源刷新
 *   2. Unity 关闭时 `Temp/` 自动清理，不留垃圾
 *   3. 不涉及端口占用、防火墙、多实例端口冲突
 *   4. 不需要处理连接建立/断开/重连的竞态
 *   5. 文件系统的原子 rename 天然提供了"命令只被消费一次"的语义
 *
 * 三个必须守住的纪律：
 *  - **原子写**（R-21）：先写 `<name>.tmp` 再 `rename`。Unity 那边读到 `.tmp` 会跳过（R-80），
 *    所以半截文件永远不会被当成完整命令。
 *  - **终态删除权归读方**（R-23）：Unity 消费完删 `inbox/<id>.json`，A 读到终态删 `outbox/<id>.json`。
 *  - **一个命令可以有多条结果**（R-22）：Unity 覆写同一个 `outbox/<id>.json` 表示进度，
 *    文件名固定为 `<id>.json`，所以这里是"覆写"而不是"追加"。
 */

/** `Temp/AVCABridge` 的绝对路径 */
export function bridgeDirOf(projectPath: string): string {
  return path.join(projectPath, ...BRIDGE_DIR)
}

export function bridgeHeartbeatFile(projectPath: string): string {
  return path.join(bridgeDirOf(projectPath), 'bridge.json')
}

export function bridgeInboxDir(projectPath: string): string {
  return path.join(bridgeDirOf(projectPath), 'inbox')
}

export function bridgeOutboxDir(projectPath: string): string {
  return path.join(bridgeDirOf(projectPath), 'outbox')
}

/**
 * 原子写 JSON：先写 `<file>.tmp`，再 `rename` 盖过去。
 *
 * 为什么不能直接 `writeFileSync(file)`：Unity 的 Tick 每 500ms 枚举一次 inbox，
 * 恰好落在"文件已创建、内容还没写完"的窗口里就会读到半截 JSON。
 * `rename` 在同一卷上是原子的，读方要么看到旧文件、要么看到完整新文件。
 */
export function writeJsonAtomic(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8')
  try {
    fs.renameSync(tmp, file)
  } catch (e) {
    /** rename 失败（杀毒软件锁文件之类）时别把 .tmp 留在 inbox 里污染目录 */
    try {
      fs.rmSync(tmp, { force: true })
    } catch {
      /* 交给系统 */
    }
    throw e
  }
}

/** 读完就删不了就下次再删（R-80：删除失败不要抛，下次 Tick 重试） */
export function tryRemove(file: string): boolean {
  try {
    fs.rmSync(file, { force: true })
    return true
  } catch {
    return false
  }
}

/** 安全读 JSON：文件不存在 / 半截 / 解析失败一律返回 null，绝不抛 */
export function readJsonSafe<T>(file: string): T | null {
  let raw: string
  try {
    raw = fs.readFileSync(file, 'utf8')
  } catch {
    return null
  }
  try {
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

/** 只认 `.json`，跳过 `.tmp`（R-80：`.tmp` 说明 A 还没写完） */
export function listCommandFiles(projectPath: string): string[] {
  return listIdsIn(bridgeInboxDir(projectPath))
}

export function listResultFiles(projectPath: string): string[] {
  return listIdsIn(bridgeOutboxDir(projectPath))
}

function listIdsIn(dir: string): string[] {
  let names: string[]
  try {
    names = fs.readdirSync(dir)
  } catch {
    return []
  }
  const out: string[] = []
  for (const n of names) {
    if (!n.toLowerCase().endsWith('.json')) continue
    out.push(n.slice(0, -'.json'.length))
  }
  return out
}

// ---------------------------------------------------------------- 心跳

export interface HeartbeatProbe {
  heartbeat: BridgeHeartbeat | null
  /**
   * **陈旧判定的依据**：桥接最后一次写这个文件的时刻。
   *
   * 取**文件 mtime 优先**，只在拿不到 mtime 时退回 `heartbeatUtc`：
   *  - 正常情况两者几乎相等（桥接每 2 秒覆写一次）
   *  - Unity 崩了 / 桥接脚本被禁用 / 文件被冻结 → mtime 停在过去 → 正确判死
   *
   * ⚠ 两个坑，第一版都踩过：
   *  1. **不能用"我们读它的时刻"**。那个值永远是刚读的，会让陈旧判定恒为 false，
   *     僵尸实例永远清不掉。
   *  2. **不能用 `max(mtime, heartbeatUtc)`**。`heartbeatUtc` 是"写文件那一刻的当下时间"，
   *     它和写入同时发生 —— 所以文件冻结之后，文件里的 heartbeatUtc 恰好也是"最后写入时刻"，
   *     看着很正常；而只要文件里那个值还在，`max` 就会把它当成新鲜度的下限，
   *     但真正的问题是它**不会前进**：实测文件做旧 60 秒后 `max` 仍等于心跳戳（≈now 附近）。
   *     判"多久没更新"只能看**文件系统**给的 mtime。
   *  3. 反过来，mtime 会被"打开/触碰文件"影响 → 所以只在**读心跳**这条路径上用它，
   *     而且读的时候不做任何写入（`readJsonSafe` 是纯读）。
   */
  seenAt: number
  /** 文件里的 heartbeatUtc 与本地时钟差多少毫秒（诊断用；为 null 表示心跳里没这个字段） */
  skewMs: number | null
  /** 解析失败 / 协议版本不认识 */
  invalid: boolean
  reason: string | null
}

/**
 * 读一次心跳。
 *
 * 判据见 `HeartbeatProbe.seenAt` 的注释：**看文件 mtime，不看"我们什么时候读的"**。
 */
export function readHeartbeat(projectPath: string): HeartbeatProbe {
  const file = bridgeHeartbeatFile(projectPath)
  const now = Date.now()
  const hb = readJsonSafe<BridgeHeartbeat>(file)
  if (!hb) {
    let exists = false
    try {
      exists = fs.existsSync(file)
    } catch {
      /* 目录都不在 */
    }
    return {
      heartbeat: null,
      seenAt: now,
      skewMs: null,
      invalid: exists,
      reason: exists ? 'bridge.json 内容解析不了（可能正被覆写，下次 Tick 再看）' : '还没有 bridge.json'
    }
  }
  if (hb.protocolVersion !== BRIDGE_PROTOCOL_VERSION) {
    return {
      heartbeat: hb,
      seenAt: now,
      skewMs: null,
      invalid: true,
      reason: `协议版本不匹配：桥接 ${hb.protocolVersion}，本程序 ${BRIDGE_PROTOCOL_VERSION}`
    }
  }

  let mtimeMs: number | null = null
  try {
    mtimeMs = fs.statSync(file).mtimeMs
  } catch {
    /* 刚被删掉，退化成用心跳戳 */
  }
  const stamp = typeof hb.heartbeatUtc === 'number' && hb.heartbeatUtc > 0 ? hb.heartbeatUtc : null
  const seenAt = mtimeMs ?? stamp ?? now

  const skewMs = stamp === null ? null : now - stamp
  if (mtimeMs !== null && stamp !== null && Math.abs(mtimeMs - stamp) > 10 * 60 * 1000) {
    log.warn(
      `[bridge] ${hb.projectName} 的 bridge.json 文件时间与心跳戳差了 ` +
        `${((mtimeMs - stamp) / 1000).toFixed(0)} 秒（时钟被改过？陈旧判定以文件时间为准）`
    )
  }
  return { heartbeat: hb, seenAt, skewMs, invalid: false, reason: null }
}

/**
 * 心跳是否已陈旧（§2.2：**10 秒**没更新 → 判定该实例已退出）。
 *
 * `now - seenAt` 为负是**正常**的（时钟被改快时会出现），负数表示"很新鲜"。
 */
export function isHeartbeatStale(probe: HeartbeatProbe, now = Date.now()): boolean {
  if (!probe.heartbeat || probe.invalid) return true
  return now - probe.seenAt > BRIDGE_STALE_MS
}

// ---------------------------------------------------------------- 命令下发

export interface SendOptions {
  /** 复用已有的命令 id（busy 退避重投时用；规格未写，见 M5A-SPEC-NOTES §11-Q6 —— 这里选择复用） */
  id?: string
  createdAt?: number
}

/**
 * 下发一条命令：`inbox/<id>.json`。
 *
 * **busy 退避重投复用同一个 id**（`opts.id`）。理由：`inbox/<id>.json` 还在原地
 * （Unity 忙时明确不消费、只写 `busy` 结果，见 §2.5），换个新 id 会在 inbox 里
 * 堆出一串没人认领的副本；复用 id 则"重投"就是覆写同一个文件，天然幂等。
 */
export function sendCommand(
  projectPath: string,
  type: BridgeCommand['type'],
  payload: unknown,
  opts: SendOptions = {}
): BridgeCommand {
  const cmd: BridgeCommand = {
    id: opts.id ?? ulid(),
    type,
    protocolVersion: BRIDGE_PROTOCOL_VERSION,
    createdAt: opts.createdAt ?? Date.now(),
    payload: payload ?? null
  }
  writeJsonAtomic(path.join(bridgeInboxDir(projectPath), `${cmd.id}.json`), cmd)
  return cmd
}

/** 读一条结果（`outbox/<id>.json`） */
export function readResult(projectPath: string, id: string): BridgeResult | null {
  return readJsonSafe<BridgeResult>(path.join(bridgeOutboxDir(projectPath), `${id}.json`))
}

/** A 读到**终态**后删掉 outbox（R-23：删除权归读方） */
export function consumeResult(projectPath: string, id: string): boolean {
  return tryRemove(path.join(bridgeOutboxDir(projectPath), `${id}.json`))
}

/** 撤销/放弃一条还没被 Unity 消费的命令 */
export function cancelCommandFile(projectPath: string, id: string): boolean {
  return tryRemove(path.join(bridgeInboxDir(projectPath), `${id}.json`))
}

/** 终态判定：只有这三种表示这条命令了结了 */
export function isTerminal(status: BridgeResult['status']): boolean {
  return status === 'ok' || status === 'error' || status === 'cancelled'
}

/** 桥接是不是已经装进这个工程（`Packages/com.avca.bridge/package.json` 在不在） */
export function isBridgeInstalled(projectPath: string): boolean {
  try {
    return fs.existsSync(path.join(projectPath, 'Packages', 'com.avca.bridge', 'package.json'))
  } catch {
    return false
  }
}

/**
 * `bridge.json` 存在但我们从没读到过有效内容 —— 用于区分
 * "Unity 没开" 与 "Unity 开着但桥接坏了/版本不对"。
 */
export function heartbeatFileExists(projectPath: string): boolean {
  try {
    return fs.existsSync(bridgeHeartbeatFile(projectPath))
  } catch {
    return false
  }
}
