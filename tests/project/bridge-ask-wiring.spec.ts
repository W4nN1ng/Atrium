import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { openDatabase, closeDatabase, type Db } from '../../src/main/db'
import { upsertProject } from '../../src/main/db/repos/unity'
import { getBridgeAsk, setBridgeAsk } from '../../src/main/db/repos/bridgeAsk'
import { setAppPathsForTest } from '../../src/main/services/paths'
import { setSettings } from '../../src/main/services/settings'
import { startProjectWatcher } from '../../src/main/project/api'
import { __resetBridgeAsk, dropBridgeAsk, pendingBridgeAsks } from '../../src/main/bridge/askQueue'
import { BRIDGE_PROTOCOL_VERSION, type BridgeFirstSeenEvent } from '../../src/shared/types'
import type { IpcRegistrar } from '../../src/main/ipc/types'
import type { ProjectInfo } from '../../src/shared/types'

/**
 * 显式旧桥接询问接口的兼容行为，以及新自动连接的生产接线。
 *
 * ## 为什么光有 `tests/shared/bridge-ask.spec.ts` 不算数
 *
 * 判据纯函数全绿只能证明"函数写对了"。这个仓库已经栽过两次同一类跟头：
 * `project/running.ts` 写完**没有任何地方 import 它**（死代码，720 条测试全绿），
 * `autoSwitchBehavior` / `bridgeAutoInstall` 两个设置项**有默认值、有类型、有开关界面，主进程无一处读取**。
 * 所以这里从 `startProjectWatcher` 真跑一轮工程发现，断言的是
 * "**边沿亮了、事件广播了、队列里攒下了、设置项真的参与了判定**"。
 *
 * ## 夹具说明
 *  - `LOCALAPPDATA` 指到临时目录 + 手写一份 VCC 清单：让发现链**只**看见测试工程，
 *    不去登记用户真实的 8 个工程（`readVccManifest` 优先读环境变量，不 mock 它就会读到真那份）。
 *  - 运行状态用**桥接心跳**（`Temp/AVCABridge/bridge.json`）造，比独占锁文件轻；
 *    心跳必须**新鲜**（`BRIDGE_STALE_MS` 10 秒），所以每次 detect 前重写一次文件。
 *  - `pollMs: 0` 关掉轮询，时序才由测试推进（`running-wiring.spec.ts` 同法）。
 *  - 注入空的进程探测结果，避免真实 Unity 进程进入临时数据库；心跳探测保持真实。
 */

let root = ''
let appHome = ''
let db: Db
let handlers: Map<string, (...args: unknown[]) => unknown>
let broadcasts: Array<{ event: string; payload: unknown }>
const apis: Array<{ refresh(): Promise<ProjectInfo[]>; detect(): Promise<ProjectInfo[]>; dispose(): void }> = []
const watcherOptions = { pollMs: 0, probe: async () => ({ projects: [], error: null, queried: true }) }

function makeRegistrar(): IpcRegistrar {
  handlers = new Map()
  broadcasts = []
  return {
    ipc: { handle(channel, fn) { handlers.set(channel, fn as (...args: unknown[]) => unknown) } },
    broadcast(event, payload) {
      broadcasts.push({ event, payload })
    }
  }
}

function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split(/\r?\n/)
    .filter((l) => !/^\s*\/\//.test(l))
    .join('\n')
}

/** 建一个"看得见是 Unity 工程"的目录（ProjectVersion.txt 是发现链的硬前提） */
function makeProject(name: string): string {
  const dir = path.join(root, 'projects', name)
  fs.mkdirSync(path.join(dir, 'ProjectSettings'), { recursive: true })
  fs.mkdirSync(path.join(dir, 'Assets'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'ProjectSettings', 'ProjectVersion.txt'), 'm_EditorVersion: 2022.3.22f1', 'utf8')
  return dir
}

/** 把 VCC/ALCOM 清单写成"只有这一个工程" */
function setManifest(projects: string[]): void {
  const file = path.join(process.env.LOCALAPPDATA as string, 'VRChatCreatorCompanion', 'settings.json')
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify({ userProjects: projects, defaultProjectPath: projects[0] ?? null }), 'utf8')
}

/** 装没装桥接：判据只看 `Packages/com.avca.bridge/package.json` 在不在 */
function installBridgeFixture(dir: string): void {
  const target = path.join(dir, 'Packages', 'com.avca.bridge')
  fs.mkdirSync(target, { recursive: true })
  fs.writeFileSync(path.join(target, 'package.json'), JSON.stringify({ name: 'com.avca.bridge' }), 'utf8')
}

function writeFreshHeartbeat(dir: string, name: string): void {
  const box = path.join(dir, 'Temp', 'AVCABridge')
  fs.mkdirSync(box, { recursive: true })
  fs.writeFileSync(
    path.join(box, 'bridge.json'),
    JSON.stringify({
      protocolVersion: BRIDGE_PROTOCOL_VERSION,
      pid: process.pid,
      projectPath: dir,
      projectName: name,
      unityVersion: '2022.3.22f1',
      bridgeVersion: '0.1.0',
      isPlaying: false,
      isCompiling: false,
      isUpdating: false,
      isPlayingOrWillChangePlaymode: false,
      activeScene: null,
      busyReason: null,
      queueLength: 0,
      heartbeatUtc: Date.now()
    }),
    'utf8'
  )
}

function firstSeen(): BridgeFirstSeenEvent[] {
  return broadcasts.filter((b) => b.event === 'project:first-seen').map((b) => b.payload as BridgeFirstSeenEvent)
}

function rowIdOf(dir: string): string {
  const row = db.prepare(`SELECT id FROM project WHERE path = ? OR path = ?`).get(dir, path.win32.normalize(dir)) as
    | { id: string }
    | undefined
  if (!row) throw new Error(`夹具：库里没有这个工程 ${dir}`)
  return row.id
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'avca-bridge-ask-'))
  /** 运行时目录必须指向临时：否则 electron-store 的 settings.json 落在共享目录，并行文件互相盖 */
  appHome = path.join(root, 'app')
  setAppPathsForTest(appHome)
  vi.stubEnv('LOCALAPPDATA', path.join(root, 'Local'))
  vi.spyOn(os, 'homedir').mockReturnValue(root)
  /** 每一项都显式写死：不依赖 DEFAULTS，也不受别的用例残留影响 */
  setSettings({ bridgeAutoInstall: false, projectRoots: [], autoSwitchBehavior: 'never' })
  __resetBridgeAsk()
  db = openDatabase(path.join(root, 'library.db'))
})

afterEach(async () => {
  for (const a of apis) a.dispose()
  apis.length = 0
  __resetBridgeAsk()
  vi.useRealTimers()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  closeDatabase()
  for (let i = 0; i < 5; i++) {
    try {
      fs.rmSync(root, { recursive: true, force: true })
      return
    } catch {
      await new Promise((r) => setTimeout(r, 200))
    }
  }
})

describe('显式旧桥接询问：第一次发现工程', () => {
  it('⭐ 新工程被发现 → 广播 project:first-seen，decision=ask，detected=vcc', async () => {
    const dir = makeProject('shinano-Main2')
    setManifest([dir])
    const api = startProjectWatcher(makeRegistrar(), watcherOptions)
    apis.push(api)
    await api.refresh()

    const ev = firstSeen()
    expect(ev.length, `第一次发现却没有广播（或广播了多条）：${JSON.stringify(ev)}`).toBe(1)
    expect(ev[0].decision, '没答过、全局开关也关着 → 该问，不该自动装').toBe('ask')
    expect(ev[0].detected).toBe('vcc')
    expect(ev[0].projectPath, 'payload 里的路径要和库里那行一致').toBe(dir)
    expect(ev[0].projectId).toBe(rowIdOf(dir))
    expect(ev[0].name).toBe('shinano-Main2')
  })

  it('⭐ 同一条还要**攒进队列**：广播是发后即忘的，主进程第一轮发现时窗口还没建', async () => {
    const dir = makeProject('shinano-Main2')
    setManifest([dir])
    const api = startProjectWatcher(makeRegistrar(), watcherOptions)
    apis.push(api)
    await api.refresh()

    const seen = pendingBridgeAsks()
    expect(seen.length, '队列里没有 → 渲染层 boot() 时取不到，⑦ 在首次安装这一次就不生效').toBe(1)
    expect(seen[0].decision).toBe('ask')
    /**
     * ⚠ 看过 ≠ 有着落：**不许看一眼就清空**。
     * 上一版是 drain 语义，活体里改一次 i18n 文案 → 整页刷新 → 第二个工程的弹窗直接没了，
     * 而"第一次发现"的边沿早消耗掉了，等于这个工程永远不再被问。
     */
    expect(pendingBridgeAsks().length, '取看就把队列清了').toBe(1)
    /** 只有"答了/装成了"才出队 */
    dropBridgeAsk(seen[0].projectId)
    expect(pendingBridgeAsks(), '答过之后还留在队里，下次刷新会再问一遍').toEqual([])
  })

  it('⭐ `bridgeAutoInstall` 开着 → 不问了，decision=auto（这条设置从 M1 起是死的，别再让它死回去）', async () => {
    const dir = makeProject('shinano-Main2')
    setManifest([dir])
    setSettings({ bridgeAutoInstall: true })
    const api = startProjectWatcher(makeRegistrar(), watcherOptions)
    apis.push(api)
    await api.refresh()

    const ev = firstSeen()
    expect(ev.length).toBe(1)
    expect(ev[0].decision, '全局开关开着还 ask，等于设置页说了不算').toBe('auto')
  })

  it('已经装了桥接的工程 → 什么都不发（不重复装，也不盖掉用户自己改过的桥接）', async () => {
    const dir = makeProject('shinano-Main2')
    installBridgeFixture(dir)
    setManifest([dir])
    const api = startProjectWatcher(makeRegistrar(), watcherOptions)
    apis.push(api)
    await api.refresh()

    expect(firstSeen(), '桥接本来就装着，不该打扰用户').toEqual([])
    expect(pendingBridgeAsks()).toEqual([])
  })

  it('⭐ 边沿不是状态：第二轮 refresh 不许再发（探测每 3 秒一轮，否则问到用户关软件）', async () => {
    const dir = makeProject('shinano-Main2')
    setManifest([dir])
    const api = startProjectWatcher(makeRegistrar(), watcherOptions)
    apis.push(api)
    await api.refresh()
    expect(firstSeen().length).toBe(1)

    broadcasts.length = 0
    __resetBridgeAsk()
    await api.refresh()
    await api.refresh()
    expect(firstSeen(), '工程行早就在库里了，不该再算"第一次发现"').toEqual([])
    expect(pendingBridgeAsks()).toEqual([])
  })

  it('扫盘发现的工程 detected=scan（两种来源都要能问）', async () => {
    const dir = makeProject('ScannedOnly')
    setManifest([])
    setSettings({ projectRoots: [path.join(root, 'projects')] })
    const api = startProjectWatcher(makeRegistrar(), watcherOptions)
    apis.push(api)
    await api.refresh()

    const ev = firstSeen()
    expect(ev.length).toBe(1)
    expect(ev[0].detected).toBe('scan')
    expect(ev[0].decision).toBe('ask')
  })
})

describe('显式旧桥接询问：答过之后的两个时机', () => {
  it('⭐ 答过「以后都自动安装」→ 它开始运行时真的执行（只挂第一次发现的话这答案永远不会被跑）', async () => {
    const dir = makeProject('shinano-Main2')
    setManifest([dir])
    const api = startProjectWatcher(makeRegistrar(), watcherOptions)
    apis.push(api)
    await api.refresh()

    const id = rowIdOf(dir)
    setBridgeAsk(db, id, 'always')
    broadcasts.length = 0
    __resetBridgeAsk()

    writeFreshHeartbeat(dir, 'shinano-Main2')
    const list = await api.detect()
    expect(list.find((p) => p.name === 'shinano-Main2')?.running, '夹具：心跳没让探测认出运行中').toBe(true)

    const ev = firstSeen()
    expect(ev.length, '答过 always、工程开起来了，却没有自动装的时机').toBe(1)
    expect(ev[0].decision).toBe('auto')
    expect(ev[0].projectId).toBe(id)
    /** 运行边沿不是"从哪发现的"，不该带 detected */
    expect(ev[0].detected, '运行边沿不该冒充成 vcc/scan').toBeUndefined()
  })

  it('答过「暂不」→ 运行时也不出声（不弹、也不装）', async () => {
    const dir = makeProject('shinano-Main2')
    setManifest([dir])
    const api = startProjectWatcher(makeRegistrar(), watcherOptions)
    apis.push(api)
    await api.refresh()
    setBridgeAsk(db, rowIdOf(dir), 'never')
    broadcasts.length = 0
    __resetBridgeAsk()

    writeFreshHeartbeat(dir, 'shinano-Main2')
    await api.detect()
    expect(firstSeen()).toEqual([])
    expect(pendingBridgeAsks()).toEqual([])
  })

  it('没答过 → 光是"它开起来了"不足以弹窗（Unity 每次启动都弹一次是骚扰）', async () => {
    const dir = makeProject('shinano-Main2')
    setManifest([dir])
    const api = startProjectWatcher(makeRegistrar(), watcherOptions)
    apis.push(api)
    await api.refresh()
    broadcasts.length = 0
    __resetBridgeAsk()

    writeFreshHeartbeat(dir, 'shinano-Main2')
    await api.detect()
    expect(firstSeen(), '只有第一次发现那一刻才该问').toEqual([])
  })

  it('答过 always 但桥接已经装着 → 静默（不重复装）', async () => {
    const dir = makeProject('shinano-Main2')
    setManifest([dir])
    const api = startProjectWatcher(makeRegistrar(), watcherOptions)
    apis.push(api)
    await api.refresh()
    setBridgeAsk(db, rowIdOf(dir), 'always')
    installBridgeFixture(dir)
    broadcasts.length = 0
    __resetBridgeAsk()

    writeFreshHeartbeat(dir, 'shinano-Main2')
    await api.detect()
    expect(firstSeen()).toEqual([])
  })

  it('答案真的落到 setting 表（裁定 Q7：不动 schema，键 bridgeAsk:<id>）', async () => {
    const dir = makeProject('shinano-Main2')
    setManifest([dir])
    const api = startProjectWatcher(makeRegistrar(), watcherOptions)
    apis.push(api)
    await api.refresh()
    const id = rowIdOf(dir)
    expect(getBridgeAsk(db, id)).toBeNull()
    setBridgeAsk(db, id, 'never')
    expect(getBridgeAsk(db, id)).toBe('never')
    const cols = db.prepare(`PRAGMA table_info(project)`).all() as Array<{ name: string }>
    expect(cols.map((c) => c.name), '这一轮没为 bridgeAsk 加列').not.toContain('bridge_ask')
  })
})

describe('自动连接的生产接线与旧接口兼容', () => {
  /**
   * 行为用例已经能证明判定生效；这一组是**第二道闸**：
   * 防止以后有人把 `getSettings().bridgeAutoInstall` 那一行删掉、
   * 或者把事件名/通道改得只剩半边（M6 的 `autoSwitchBehavior` 就是这么死过一次第二次）。
   */
  const api = stripComments(fs.readFileSync(path.join(process.cwd(), 'src/main/project/api.ts'), 'utf8'))

  it('主进程读 `bridgeAutoInstall`（不是只在设置页里显示一下）', () => {
    expect(api).toContain('bridgeAutoInstall')
    expect(api).toMatch(/getSettings\(\)\s*\.\s*bridgeAutoInstall/)
  })

  it('主进程调 `bridgeAskDecision`，并把结论广播成 project:first-seen', () => {
    expect(api).toContain('bridgeAskDecision(')
    expect(api).toContain(`broadcast('project:first-seen'`)
    expect(api).toContain('pushBridgeAsk(')
  })

  it('两个边沿都接上了：第一次发现 + 开始运行', () => {
    expect(api).toMatch(/firstSighting:\s*true/)
    expect(api).toMatch(/running:\s*true/)
  })

  it('旧 pending/done IPC 仍可显式调用，正常启动改为读取连接快照', () => {
    /**
     * 这条是"半边接线"的专用闸。
     * 事件通道最容易出的事故是：主进程发了、界面没收；或 preload 加了、渲染层没调 ——
     * 每一段单看都"实现了"，串起来却是断的。
     */
    const read = (rel: string): string => stripComments(fs.readFileSync(path.join(process.cwd(), rel), 'utf8'))
    expect(read('src/shared/ipc.ts')).toContain("BridgeAskPending: 'unity:bridge-ask-pending'")
    expect(read('src/main/bridge/ipc.ts')).toContain(`registrar.ipc.handle('unity:bridge-ask-pending'`)
    expect(read('src/preload/index.ts')).toContain("invoke('unity:bridge-ask-pending')")
    const ui = read('src/renderer/stores/ui.ts')
    const bootAt = ui.indexOf('async boot()')
    expect(bootAt).toBeGreaterThan(-1)
    expect(ui.slice(bootAt, bootAt + 1200)).toContain('window.a.unity.connection()')
    expect(ui).not.toContain('window.a.unity.pendingBridgeAsk()')
    /** 装成了要能告诉主进程出队，否则每次刷新界面都重装一遍 */
    expect(read('src/shared/ipc.ts')).toContain("BridgeAskDone: 'unity:bridge-ask-done'")
    expect(read('src/main/bridge/ipc.ts')).toContain(`registrar.ipc.handle('unity:bridge-ask-done'`)
    /**
     * 用户**当面答过**之后，主进程攒的那条要作废（不然后果同上：重载界面又弹一遍已经答过的）。
     * ⚠ 必须**限定在答案处理器那一段里**查：全文件 `toContain('dropBridgeAsk(id)')` 是假绿 ——
     * `unity:bridge-ask-done` 那个 handler 里也有同样一句，变异掉答案处理器这一处它照样过。
     */
    const bipc = read('src/main/bridge/ipc.ts')
    const from = bipc.indexOf(`registrar.ipc.handle('unity:answer-bridge-ask'`)
    expect(from, '答案处理器不见了').toBeGreaterThan(-1)
    const block = bipc.slice(from, from + 1200)
    expect(block.slice(0, block.search(/\n {2}\}\)/)), '答过之后没出队').toContain('dropBridgeAsk(')
    expect(read('src/preload/index.ts')).toContain("invoke('unity:bridge-ask-done'")
    expect(read('src/renderer/stores/ui.ts')).toContain('window.a.unity.bridgeAskDone(')
  })

  it('生产 watcher 交给自动连接控制器，正常 App 不挂安装询问', () => {
    const read = (rel: string): string => stripComments(fs.readFileSync(path.join(process.cwd(), rel), 'utf8'))
    expect(read('src/shared/ipc.ts')).toContain("ProjectFirstSeen: 'project:first-seen'")
    const main = read('src/main/index.ts')
    const watcherAt = main.indexOf('projectApi = startProjectWatcher(')
    expect(watcherAt).toBeGreaterThan(-1)
    const watcher = main.slice(watcherAt, main.indexOf('})', watcherAt) + 2)
    expect(watcher).toContain('automaticConnections: true')
    expect(watcher).toMatch(/onDetected:\s*projects\s*=>\s*\{/)
    expect(watcher).toContain('connections?.update(projects)')
    expect(api).toMatch(/if\s*\(disposed\s*\|\|\s*opts\.automaticConnections\)\s*return/)
    const ui = read('src/renderer/stores/ui.ts')
    expect(ui).toContain(`window.a.on('unity:connection-changed'`)
    expect(ui).not.toContain(`window.a.on('project:first-seen'`)
    const app = read('src/renderer/App.tsx')
    expect(app).not.toContain('BridgeAskDialog')
    expect(app).toContain('<ImportTargetPicker />')
  })

  it('显式安装成功仍会清旧队列，向导只显示自动连接阶段和重试', () => {
    /**
     * 队列的语义是"还没有着落的问题"，出队时机原本只有两个：用户答了、自动装成了。
     * 第 7 轮活体里第三条路露出来了：向导第 ③ 步给两个工程装完桥接、走完向导，
     * 弹窗照旧问「这个工程还没装 A 的桥接」—— 手动装成没出队，也没人替渲染层摘本地那份。
     *
     * ⚠ 和上面那条一样的规矩：**限定在 install-bridge 这个 handler 的 `if (r.ok)` 分支里查**，
     *   全文件 toContain('dropBridgeAsk(') 是假绿（答案处理器里本来就有这句）。
     */
    const read = (rel: string): string => stripComments(fs.readFileSync(path.join(process.cwd(), rel), 'utf8'))
    const bipc = read('src/main/bridge/ipc.ts')
    const from = bipc.indexOf(`registrar.ipc.handle('unity:install-bridge'`)
    expect(from, '装桥接的 handler 不见了').toBeGreaterThan(-1)
    const block = bipc.slice(from, from + 1400)
    const okAt = block.indexOf('if (r.ok)')
    const retAt = block.indexOf('return r')
    expect(okAt, 'handler 里没有成功分支').toBeGreaterThan(-1)
    expect(retAt, '找不到 handler 的返回').toBeGreaterThan(okAt)
    expect(block.slice(okAt, retAt), '装成了却不出队 → 队列语义破了').toContain('dropBridgeAsk(id)')

    /** 本地那份也要摘：主进程出队管的是"刷新之后"，当前这一屏靠渲染层自己 */
    expect(read('src/renderer/stores/ui.ts')).toContain('settleBridgeAsk(projectId)')
    const wizard = read('src/renderer/components/FirstRunWizard.tsx')
    expect(wizard).toContain('useUi((s) => s.connection)')
    expect(wizard).toContain("t('wizard.step3.automatic')")
    expect(wizard).toContain('<ConnectionBadge phase={p.phase}')
    expect(wizard).toContain('retryConnection(p.projectId)')
    expect(wizard).not.toContain('window.a.unity.installBridge(')
    expect(wizard).not.toContain('installSelected(')
    expect(wizard).not.toContain('type="checkbox"')
    expect(read('src/renderer/pages/Project.tsx')).not.toContain('window.a.unity.installBridge(')
  })

  it('⭐ M7 Q10 · 「剩下都不再问」走的是 per-project never，不是全局静音', () => {
    const read = (rel: string): string => stripComments(fs.readFileSync(path.join(process.cwd(), rel), 'utf8'))
    const queue = read('src/main/bridge/askQueue.ts')
    const from = queue.indexOf('export function silenceRestBridgeAsks')
    expect(from).toBeGreaterThan(-1)
    const body = queue.slice(from, from + 900)
    /** 只准写"每个 id 各来一次"，不准出现任何"从此都不问"那种模块级标志 */
    expect(body).toContain('pending.delete')
    expect(body).not.toMatch(/muted|silencedAll|globalNever/)
    expect(queue.match(/^let /gm) ?? [], 'askQueue 里不许多出模块级可变状态').toEqual([])
    // The current dialog handles a whole selection with temporary skips; batch behavior is
    // exercised in renderer/bridge-ask-batch.spec.ts. This test covers the legacy IPC only.
  })
})
