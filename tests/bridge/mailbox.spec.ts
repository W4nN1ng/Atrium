import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  bridgeDirOf,
  bridgeHeartbeatFile,
  bridgeInboxDir,
  bridgeOutboxDir,
  cancelCommandFile,
  consumeResult,
  isBridgeInstalled,
  isHeartbeatStale,
  isTerminal,
  listCommandFiles,
  listResultFiles,
  readHeartbeat,
  readJsonSafe,
  readResult,
  sendCommand,
  tryRemove,
  writeJsonAtomic
} from '../../src/main/bridge/mailbox'
import { BRIDGE_PROTOCOL_VERSION, type BridgeHeartbeat } from '../../src/shared/types'
import { BRIDGE_STALE_MS } from '../../src/shared/constants'

/**
 * 文件信箱是 A 与 Unity 之间唯一的通信方式，它写错的表现是"偶尔成功偶尔失败"：
 * 半截 JSON、读到还没写完的命令、终态文件没人删、陈旧心跳被当成活着。
 * 这些都是没法靠肉眼看出来的，所以在真文件系统上钉死。
 */

let root: string
let project: string

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'avca-mailbox-'))
  project = path.join(root, 'shinano-Main2')
  fs.mkdirSync(project, { recursive: true })
})

afterEach(() => {
  try {
    fs.rmSync(root, { recursive: true, force: true })
  } catch {
    /* 交给系统 */
  }
})

function heartbeat(over: Partial<BridgeHeartbeat> = {}): BridgeHeartbeat {
  return {
    protocolVersion: BRIDGE_PROTOCOL_VERSION,
    pid: 1234,
    projectPath: project,
    projectName: 'shinano-Main2',
    unityVersion: '2022.3.22f1',
    bridgeVersion: '1.0.0',
    isPlaying: false,
    isCompiling: false,
    isUpdating: false,
    isPlayingOrWillChangePlaymode: false,
    activeScene: null,
    busyReason: null,
    queueLength: 0,
    heartbeatUtc: Date.now(),
    ...over
  }
}

describe('目录布局（第 3 份 §2.1）', () => {
  it('全部落在 <Project>/Temp/AVCABridge 下', () => {
    expect(bridgeDirOf(project)).toBe(path.join(project, 'Temp', 'AVCABridge'))
    expect(bridgeHeartbeatFile(project)).toBe(path.join(project, 'Temp', 'AVCABridge', 'bridge.json'))
    expect(bridgeInboxDir(project)).toBe(path.join(project, 'Temp', 'AVCABridge', 'inbox'))
    expect(bridgeOutboxDir(project)).toBe(path.join(project, 'Temp', 'AVCABridge', 'outbox'))
  })
})

describe('原子写（R-21：先 .tmp 再 rename）', () => {
  it('写完不留 .tmp，内容完整可读', () => {
    const f = path.join(root, 'x.json')
    writeJsonAtomic(f, { hello: '世界' })
    expect(fs.existsSync(f + '.tmp')).toBe(false)
    expect(JSON.parse(fs.readFileSync(f, 'utf8'))).toEqual({ hello: '世界' })
  })

  it('目录不存在时自动建', () => {
    const f = path.join(root, 'a', 'b', 'c.json')
    writeJsonAtomic(f, { ok: 1 })
    expect(fs.existsSync(f)).toBe(true)
  })

  it('覆写已有文件是替换而不是截断追加', () => {
    const f = path.join(root, 'x.json')
    writeJsonAtomic(f, { long: 'x'.repeat(500) })
    writeJsonAtomic(f, { short: 1 })
    expect(JSON.parse(fs.readFileSync(f, 'utf8'))).toEqual({ short: 1 })
  })
})

describe('安全读：绝不抛', () => {
  it('文件不存在 → null', () => {
    expect(readJsonSafe(path.join(root, 'nope.json'))).toBeNull()
  })

  it('半截 JSON → null', () => {
    const f = path.join(root, 'half.json')
    fs.writeFileSync(f, '{"a":1,"b":', 'utf8')
    expect(readJsonSafe(f)).toBeNull()
  })

  it('内容是数组/标量时按调用方给的 T 原样返回（不做形状校验）', () => {
    const f = path.join(root, 'arr.json')
    fs.writeFileSync(f, '[1,2,3]', 'utf8')
    expect(readJsonSafe<number[]>(f)).toEqual([1, 2, 3])
  })
})

describe('心跳（§2.2）', () => {
  it('没有 bridge.json → heartbeat null 且 invalid=false（是"还没开"，不是"坏了"）', () => {
    const p = readHeartbeat(project)
    expect(p.heartbeat).toBeNull()
    expect(p.invalid).toBe(false)
    expect(isHeartbeatStale(p)).toBe(true)
  })

  it('bridge.json 存在但解析不了 → invalid=true（能区分"坏了"与"还没开"）', () => {
    fs.mkdirSync(path.dirname(bridgeHeartbeatFile(project)), { recursive: true })
    fs.writeFileSync(bridgeHeartbeatFile(project), '{"broken":', 'utf8')
    const p = readHeartbeat(project)
    expect(p.heartbeat).toBeNull()
    expect(p.invalid).toBe(true)
  })

  it('正常心跳 → 不陈旧，字段原样读出', () => {
    writeJsonAtomic(bridgeHeartbeatFile(project), heartbeat({ queueLength: 3, busyReason: '正在编译' }))
    const p = readHeartbeat(project)
    expect(p.invalid).toBe(false)
    expect(p.heartbeat?.queueLength).toBe(3)
    expect(isHeartbeatStale(p)).toBe(false)
  })

  it(`超过 ${BRIDGE_STALE_MS}ms 没更新 → 判定退出（§2.2 / R-19）`, () => {
    writeJsonAtomic(bridgeHeartbeatFile(project), heartbeat())
    const p = readHeartbeat(project)
    expect(isHeartbeatStale(p, p.seenAt + BRIDGE_STALE_MS - 1)).toBe(false)
    expect(isHeartbeatStale(p, p.seenAt + BRIDGE_STALE_MS + 1)).toBe(true)
  })

  it('**文件不再被更新 → 判死**（这条抓的是"用读的时刻当依据"那个 bug）', () => {
    writeJsonAtomic(bridgeHeartbeatFile(project), heartbeat())
    /** 把文件时间做旧 60 秒，模拟 Unity 崩了 / 桥接脚本被禁用 */
    const old = new Date(Date.now() - 60_000)
    fs.utimesSync(bridgeHeartbeatFile(project), old, old)

    const p = readHeartbeat(project)
    expect(p.invalid).toBe(false)
    expect(p.heartbeat).not.toBeNull()
    /** 如果依据是"我们读它的时刻"，这里会错判成活着 —— 僵尸实例就永远清不掉 */
    expect(isHeartbeatStale(p)).toBe(true)
  })

  it('协议版本不匹配 → invalid（不同版本的桥接不能瞎通信）', () => {
    writeJsonAtomic(bridgeHeartbeatFile(project), heartbeat({ protocolVersion: 99 }))
    const p = readHeartbeat(project)
    expect(p.invalid).toBe(true)
    expect(p.reason).toMatch(/协议版本/)
  })

  it('本机时钟被改快（心跳戳在过去）→ 以文件时间为准，仍然可判陈旧', () => {
    writeJsonAtomic(bridgeHeartbeatFile(project), heartbeat({ heartbeatUtc: Date.now() - 3600_000 }))
    const p = readHeartbeat(project)
    expect(p.invalid).toBe(false)
    /** 文件是刚写的，所以取 max(文件时间, 心跳戳) = 文件时间 */
    expect(isHeartbeatStale(p)).toBe(false)
    /** 时钟偏差仍要能看出来，方便排障时一眼判断是时钟问题而不是桥接问题 */
    expect(p.skewMs).toBeGreaterThan(3500_000)
  })

  it('时钟被改慢（心跳戳在未来）→ 取较新的那个，不会误判成陈旧', () => {
    writeJsonAtomic(bridgeHeartbeatFile(project), heartbeat({ heartbeatUtc: Date.now() + 3600_000 }))
    const p = readHeartbeat(project)
    expect(p.invalid).toBe(false)
    expect(isHeartbeatStale(p)).toBe(false)
  })
})

describe('命令下发（§2.3）', () => {
  it('写到 inbox/<id>.json，且不带 .tmp 残留', () => {
    const cmd = sendCommand(project, 'ping', {})
    const f = path.join(bridgeInboxDir(project), `${cmd.id}.json`)
    expect(fs.existsSync(f)).toBe(true)
    expect(fs.existsSync(f + '.tmp')).toBe(false)
    expect(cmd.protocolVersion).toBe(BRIDGE_PROTOCOL_VERSION)
    expect(cmd.type).toBe('ping')
  })

  it('复用同一个 id 重投 = 覆写同一个文件（busy 退避重投的关键）', () => {
    const first = sendCommand(project, 'import_unitypackage', { path: 'E:\\a.unitypackage' })
    const again = sendCommand(project, 'import_unitypackage', { path: 'E:\\a.unitypackage' }, { id: first.id })
    expect(again.id).toBe(first.id)
    /** inbox 里只有一份，不会堆出一串没人认领的副本 */
    expect(listCommandFiles(project)).toEqual([first.id])
  })

  it('每次新命令都是新 id', () => {
    const a = sendCommand(project, 'ping', {})
    const b = sendCommand(project, 'ping', {})
    expect(a.id).not.toBe(b.id)
    expect(listCommandFiles(project).sort()).toEqual([a.id, b.id].sort())
  })
})

describe('文件枚举（R-80：跳过 .tmp）', () => {
  it('只认 .json，跳过 .tmp 与非 json', () => {
    const dir = bridgeInboxDir(project)
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'aaa.json'), '{}', 'utf8')
    fs.writeFileSync(path.join(dir, 'bbb.json.tmp'), '{}', 'utf8')
    fs.writeFileSync(path.join(dir, 'notes.txt'), 'x', 'utf8')
    fs.writeFileSync(path.join(dir, 'ccc.JSON'), '{}', 'utf8')
    expect(listCommandFiles(project).sort()).toEqual(['aaa', 'ccc'])
  })

  it('目录不存在 → 空数组，不抛', () => {
    expect(listCommandFiles(project)).toEqual([])
    expect(listResultFiles(project)).toEqual([])
  })
})

describe('结果读取与终态（§2.4 / R-23）', () => {
  it('读一条 ok 结果', () => {
    const id = 'TESTID'
    fs.mkdirSync(bridgeOutboxDir(project), { recursive: true })
    writeJsonAtomic(path.join(bridgeOutboxDir(project), `${id}.json`), {
      id,
      status: 'ok',
      data: { createdGuids: ['g1'] }
    })
    const r = readResult(project, id)
    expect(r?.status).toBe('ok')
    expect(isTerminal(r!.status)).toBe(true)
  })

  it('progress / busy 都不算终态（必须继续等）', () => {
    expect(isTerminal('progress')).toBe(false)
    expect(isTerminal('busy')).toBe(false)
    expect(isTerminal('ok')).toBe(true)
    expect(isTerminal('error')).toBe(true)
    expect(isTerminal('cancelled')).toBe(true)
  })

  it('consumeResult 删掉 outbox（删除权归读方）', () => {
    const id = 'X1'
    fs.mkdirSync(bridgeOutboxDir(project), { recursive: true })
    const f = path.join(bridgeOutboxDir(project), `${id}.json`)
    writeJsonAtomic(f, { id, status: 'ok' })
    expect(consumeResult(project, id)).toBe(true)
    expect(fs.existsSync(f)).toBe(false)
    expect(readResult(project, id)).toBeNull()
  })

  it('删不存在的东西不抛（R-80：删不掉下次再试）', () => {
    expect(tryRemove(path.join(root, 'nope.json'))).toBe(true)
    expect(consumeResult(project, 'NOPE')).toBe(true)
  })

  it('cancelCommandFile 能把没被消费的命令收回来', () => {
    const cmd = sendCommand(project, 'ping', {})
    expect(listCommandFiles(project)).toEqual([cmd.id])
    expect(cancelCommandFile(project, cmd.id)).toBe(true)
    expect(listCommandFiles(project)).toEqual([])
  })
})

describe('桥接是否已装进工程', () => {
  it('看 Packages/com.avca.bridge/package.json（必须是 Packages，不能是 Assets）', () => {
    expect(isBridgeInstalled(project)).toBe(false)
    fs.mkdirSync(path.join(project, 'Packages', 'com.avca.bridge'), { recursive: true })
    expect(isBridgeInstalled(project)).toBe(false)
    fs.writeFileSync(path.join(project, 'Packages', 'com.avca.bridge', 'package.json'), '{}', 'utf8')
    expect(isBridgeInstalled(project)).toBe(true)
  })
})
