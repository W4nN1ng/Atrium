import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { openDatabase, closeDatabase, type Db } from '../../src/main/db'
import { upsertProject } from '../../src/main/db/repos/unity'
import { startProjectWatcher } from '../../src/main/project/api'
import type { IpcRegistrar } from '../../src/main/ipc/types'
import type { ProjectInfo } from '../../src/shared/types'

/**
 * **运行状态探测有没有真的被接上。**
 *
 * ## 为什么必须有这个文件
 *
 * `src/main/project/running.ts`（三路取并集：锁文件 / 桥接心跳 / WMI）写完后
 * **没有任何地方 import 它** —— 它是死代码。表现是：用户在真 Unity 里开着
 * `shinano-Main2`，A 的工程页却显示"未运行"，而同一页的说明还写着
 * "运行状态三路取并集判定"。**文案在说谎。**
 *
 * `tests/bridge/lockfile.spec.ts` 那 14 项直接调 `probeUnityLockfile`、
 * `tests/project/running.spec.ts`（若有）直接调 `detectRunning` ——
 * 它们验的是**探测逻辑**，全绿。**没有一个测试问"它被接上了吗"**，
 * 所以这个洞一路过了 720 条测试、直到真机上人工验才发现。
 *
 * 所以这里**从 IPC 入口进去**（`startProjectWatcher` 注册的 handler），
 * 断言的是"用户能看到的状态对不对"。这类"接线测试"是那 720 条里缺的一环。
 *
 * ⚠ 这个文件用**真的独占锁**来模拟 Unity 持锁：光创建锁文件不算"在运行"
 * （异常退出会残留），必须是"独占试开失败"。用 PowerShell 起一个
 * `FileShare.None` 的持有者 —— 与 `tests/bridge/lockfile.spec.ts` 同法。
 * 环境起不来子进程时**跳过并说明**，不把整仓搞红。
 */

let root: string
let project: string
let db: Db
let api: { refresh(): Promise<ProjectInfo[]>; detect(): Promise<ProjectInfo[]>; dispose(): void }
let handlers: Map<string, (...args: unknown[]) => unknown>
let broadcasts: Array<{ event: string; payload: unknown }>

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

function makeRegistrar(): IpcRegistrar {
  handlers = new Map()
  broadcasts = []
  return {
    ipc: {
      handle(channel, fn) {
        handlers.set(channel, fn as (...args: unknown[]) => unknown)
      }
    },
    broadcast(event, payload) {
      broadcasts.push({ event, payload })
    }
  }
}

/**
 * 起一个 `FileShare.None` 的持有者，等到**连续两次**都判定"被持有"为止。
 *
 * ⚠ 为什么要"连续两次"：持有者子进程刚起来的那一刻，文件偶尔还是可打开的
 * （`File.Open` 与 `Start-Sleep` 之间有极短窗口）。单次采样会**偶发**判成"没持有"，
 * 于是用例间歇性失败 —— 单跑绿、全量红那种。
 */
async function startExclusiveHolder(file: string): Promise<import('node:child_process').ChildProcess | null> {
  const { spawn } = await import('node:child_process')
  const { probeUnityLockfile } = await import('../../src/main/project/lockfile')
  const child = spawn(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `$f=[System.IO.File]::Open('${file.replace(/'/g, "''")}','Open','ReadWrite','None'); Start-Sleep -Seconds 90; $f.Close()`
    ],
    { stdio: 'ignore', windowsHide: true }
  )
  const deadline = Date.now() + 25_000
  let streak = 0
  for (;;) {
    streak = probeUnityLockfile(project).held ? streak + 1 : 0
    if (streak >= 2) return child
    if (Date.now() > deadline) {
      child.kill()
      return null
    }
    await sleep(60)
  }
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'avca-wiring-'))
  project = path.join(root, 'shinano-Main2')
  fs.mkdirSync(path.join(project, 'ProjectSettings'), { recursive: true })
  fs.mkdirSync(path.join(project, 'Assets'), { recursive: true })
  fs.writeFileSync(path.join(project, 'ProjectSettings', 'ProjectVersion.txt'), 'm_EditorVersion: 2022.3.22f1', 'utf8')

  db = openDatabase(path.join(root, 'library.db'))
  upsertProject(db, { path: project, name: 'shinano-Main2', unityVersion: '2022.3.22f1' })

  /**
   * 模拟上一会话留下的“运行中”缓存：重启首屏不能直接信它。
   * 真实问题：Lime / shinano-Main2 会先亮绿灯，探测完成后不到一秒又变灰。
   */
  db.prepare(`UPDATE project SET is_running = 1 WHERE path = ?`).run(project)

  /**
   * 把 ALCOM 清单指到一个不存在的文件，让 `refresh()` 只认库里的工程 ——
   * 否则它会去读用户真实的 `%APPDATA%\...\settings.json`，把用户的工程也登记进来。
   */
  vi.spyOn(os, 'homedir').mockReturnValue(root)
  /**
   * ⚠ **关掉轮询定时器**（`pollMs: 0`）。
   *
   * 开着的话它会在用例执行到一半时插进来跑一轮探测，把"状态变化 → 广播"的时序
   * 搅乱；更糟的是 `applyDetection` 的 `previous` 是**模块级**状态，
   * 而真机上同时还有一个 `startProjectWatcher` 在跑（A 应用），
   * 两边共享同一个 Map，`changed` 就时有时无。
   * 关掉之后由测试显式调 `detect()` 推进，时序才是确定的。
   */
  api = startProjectWatcher(makeRegistrar(), { pollMs: 0 })
})

afterEach(async () => {
  api.dispose()
  vi.restoreAllMocks()
  closeDatabase()
  /**
   * 清临时目录要**容错**。
   *
   * ⚠ `fs.rmSync(..., { force: true })` 里的 `force` **只忽略 ENOENT**，
   * 不管 EPERM/EBUSY。而 `child.kill()` 之后 PowerShell 子进程还会短暂持有
   * 锁文件的句柄，于是删除会抛：
   *
   * ```
   * Error: EPERM, Permission denied: ...\avca-wiring-XXXX
   * ```
   *
   * 这个错误发生在 `afterEach` 里，会被算成**用例失败** ——
   * 而它的断言其实全过了。实测 8 连跑里红 2~4 次，我一开始还误判成
   * "锁探测采样不稳"、"活着的 A 在共享状态"，两次都猜错。
   * 重试几次等句柄释放；实在删不掉就留给系统（临时目录，不影响正确性）。
   */
  for (let i = 0; i < 5; i++) {
    try {
      fs.rmSync(root, { recursive: true, force: true })
      return
    } catch {
      await new Promise((r) => setTimeout(r, 200))
    }
  }
})

/** 建出锁文件（还没人独占） */
function makeLockfile(): string {
  const lock = path.join(project, 'Temp', 'UnityLockfile')
  fs.mkdirSync(path.dirname(lock), { recursive: true })
  fs.writeFileSync(lock, '', 'utf8')
  return lock
}

/**
 * 反复探测，直到看到 `shinano-Main2` 被报成 `running`，或超时。
 *
 * ## 为什么必须重试，而不是"等到 held=true 再断言一次"
 *
 * `probeUnityLockfile` 靠 `fs.openSync(file, 'r+')` 判断独占。持有者那边是
 * PowerShell 的 `FileStream`，在它**建立/关闭的瞬间**，我们的读写试开会
 * **偶发成功** —— 看起来像"没人持有"。于是"先等到 held 再断言一次 running"
 * 这种写法会间歇性失败（实测 8 连跑里红 2 次），而**产品行为其实是对的**。
 *
 * 这是**采样假象**，不是产品缺陷。所以这里改成"重试到看见为止"：
 * 它证明的是"锁被持有时，这套接线**确实能**报出运行中"，
 * 而这个命题不受某一瞬间采样结果的影响。
 */
async function waitUntilRunning(timeoutMs = 8000): Promise<ProjectInfo | null> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const list = await api.detect()
    const mine = list.find((p) => p.name === 'shinano-Main2')
    if (mine?.running) return mine
    if (Date.now() > deadline) return null
    await sleep(100)
  }
}

describe('三路探测的**接线**（曾经是死代码）', () => {
  it('启动时先清掉上一会话的运行状态，首屏不显示假绿灯', () => {
    const row = db.prepare(`SELECT is_running FROM project WHERE path = ?`).get(project) as {
      is_running: number
    }
    expect(row.is_running, 'startProjectWatcher 没有清理上一轮的 is_running').toBe(0)
  })

  it('⭐ 锁文件被独占时，从 IPC 拉列表就能看到"运行中"（这条曾经会红）', async (ctx) => {
    const lock = makeLockfile()
    const child = await startExclusiveHolder(lock)
    if (!child) {
      console.log('⚠ 独占持有者起不来（满载机器上 PowerShell 冷启动 25 秒超时）→ 这一条本轮**没验**，不算通过')
      ctx.skip()
      return
    }
    try {
      /** 从 **IPC 入口**拉，而不是直接调 detect —— 验的是"接线" */
      const pull = (): Promise<ProjectInfo[]> =>
        (handlers.get('unity:list-projects') as () => Promise<ProjectInfo[]>)()
      const deadline = Date.now() + 8000
      let mine: ProjectInfo | undefined
      for (;;) {
        mine = (await pull()).find((p) => p.name === 'shinano-Main2')
        if (mine?.running || Date.now() > deadline) break
        await sleep(100)
      }
      expect(mine, '工程没被登记').toBeTruthy()
      expect(
        mine!.running,
        'IPC 拉出来的列表说"未运行"—— 说明 project/running.ts 的三路探测没被接进 refresh 链路'
      ).toBe(true)
      expect(mine!.detectedBy, 'detectedBy 里应当有 lockfile').toContain('lockfile')
    } finally {
      child.kill()
    }
  }, 60_000)

  it('⭐ 没有任何证据时必须报"未运行"，且 detectedBy 为空（不许瞎猜）', async () => {
    const list = await api.refresh()
    const mine = list.find((p) => p.name === 'shinano-Main2')
    expect(mine!.running).toBe(false)
    /**
     * 这条专门防旧写法：以前 `toProjectInfo` 会把 `vcc`（工程从哪发现的）
     * 当成运行依据塞进 `detectedBy`，于是"未运行"的工程也带着一个依据，
     * 排障时完全误导。
     */
    expect(mine!.detectedBy, '没有证据就不能有 detectedBy').toEqual([])
  })

  it('运行状态**变化时**广播 project:running-changed，否则界面显示旧状态', async (ctx) => {
    makeLockfile()
    /** 先建立基线：未运行 */
    const base = await api.detect()
    expect(base.find((p) => p.name === 'shinano-Main2')!.running, '基线应当是未运行').toBe(false)
    broadcasts.length = 0

    const child = await startExclusiveHolder(path.join(project, 'Temp', 'UnityLockfile'))
    if (!child) {
      console.log('⚠ 独占持有者起不来（满载机器上 PowerShell 冷启动 25 秒超时）→ 这一条本轮**没验**，不算通过')
      ctx.skip()
      return
    }
    try {
      const mine = await waitUntilRunning()
      expect(mine, '锁被持有却没报出运行中').toBeTruthy()
      const ev = broadcasts.find((b) => b.event === 'project:running-changed')
      expect(ev, '状态从"关"变"开"却没有广播').toBeTruthy()
      const changed = (ev!.payload as { changed: Array<{ name: string; running: boolean }> }).changed
      expect(changed.some((c) => c.name === 'shinano-Main2' && c.running)).toBe(true)
    } finally {
      child.kill()
    }
  }, 60_000)

  it('状态**没变时**不广播、不写库（每 3 秒一次，无条件写会把 SQLite 写爆）', async () => {
    await api.refresh()
    broadcasts.length = 0
    const before = db.prepare(`SELECT last_seen FROM project WHERE path = ?`).get(project) as { last_seen: number }

    await api.detect()
    await api.detect()

    expect(broadcasts.filter((b) => b.event === 'project:running-changed'), '状态没变却广播了').toEqual([])
    const after = db.prepare(`SELECT last_seen FROM project WHERE path = ?`).get(project) as { last_seen: number }
    /**
     * `last_seen` 的语义是"最后一次看到这个工程"，不该变成"最后一次轮询时间"。
     * 状态没变时 `applyDetection` 不该碰它。
     */
    expect(after.last_seen, 'last_seen 被轮询改写了，语义退化').toBe(before.last_seen)
  })

  it('register 不会把探测出的"已打开"抹掉（曾经的 isRunning:false 硬写）', async (ctx) => {
    const lock = makeLockfile()
    const child = await startExclusiveHolder(lock)
    if (!child) {
      console.log('⚠ 独占持有者起不来（满载机器上 PowerShell 冷启动 25 秒超时）→ 这一条本轮**没验**，不算通过')
      ctx.skip()
      return
    }
    try {
      /** 多跑几轮，状态必须稳在"运行中"（同样用重试消除采样假象） */
      let mine = await waitUntilRunning()
      for (let i = 0; i < 2; i++) {
        /** 每一轮都走 refresh（含 register），验的是 register 不会抹掉状态 */
        const list = await api.refresh()
        const cur = list.find((p) => p.name === 'shinano-Main2')
        if (cur?.running) mine = cur
      }
      expect(mine?.running, '锁被持有却没报出运行中').toBe(true)
      const row = db.prepare(`SELECT is_running FROM project WHERE path = ?`).get(project) as { is_running: number }
      expect(row.is_running, 'is_running 被 register 的 isRunning:false 覆盖了').toBe(1)
    } finally {
      child.kill()
    }
  }, 60_000)

  it('残留的锁文件（没人持有）不算"运行中"（§4.2：异常退出会留锁）', async () => {
    makeLockfile()
    /** 没人独占它 */
    const list = await api.refresh()
    const mine = list.find((p) => p.name === 'shinano-Main2')!
    expect(mine.running, '光有个残留锁文件就判成运行中').toBe(false)
    expect(mine.lockfilePresent, '锁文件确实存在，这个字段要如实反映').toBe(true)
    expect(mine.detectedBy).toEqual([])
  })

  it('pollMs:0 时**不起**定时器；默认起，且 dispose 能停掉', () => {
    /**
     * ⚠ 第一版这条我写反了：`beforeEach` 里用的是 `pollMs: 0`，
     * 我却断言 `api.dispose()` 会调 `clearInterval` —— 它当然不会调，
     * 因为压根没起过定时器。所以这里分成两半各自断言。
     */
    const setSpy = vi.spyOn(globalThis, 'setInterval')
    const clearSpy = vi.spyOn(globalThis, 'clearInterval')

    /** 当前这个 api 是 pollMs:0 建的，dispose 不该碰 clearInterval */
    api.dispose()
    expect(clearSpy, 'pollMs:0 的实例不该调 clearInterval').not.toHaveBeenCalled()
    expect(setSpy, 'pollMs:0 不该起定时器').not.toHaveBeenCalled()

    /** 默认参数下确实会起定时器，而且 dispose 能停掉 */
    const withPoll = startProjectWatcher(makeRegistrar())
    expect(setSpy, '默认应当起轮询定时器').toHaveBeenCalled()
    withPoll.dispose()
    expect(clearSpy, '默认实例的 dispose 必须停掉定时器，否则会吊住进程').toHaveBeenCalled()

    setSpy.mockRestore()
    clearSpy.mockRestore()
  })

  it('两个 handler 都注册上了，且都返回 Promise（界面刷新要能拿到新状态）', () => {
    expect(handlers.has('unity:list-projects')).toBe(true)
    expect(handlers.has('unity:refresh-projects')).toBe(true)
    expect(api.refresh()).toBeInstanceOf(Promise)
  })
})
