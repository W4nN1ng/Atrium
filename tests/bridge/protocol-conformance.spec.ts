import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import type { BridgeCommandType, BridgeHeartbeat, BridgeResult } from '../../src/shared/types'

/**
 * **A 侧与 C# 侧的协议字面量对账。**
 *
 * ## 为什么必须单独测这个
 *
 * 桥接的 JSON 是**两边各自手写**的：A 侧用 `JSON.stringify` / TS 类型，
 * C# 侧是自造的极简 `JsonRead`（零第三方依赖，规格 §10-2 要求）。
 * 于是"字段名拼错一个字母"不会编译报错、不会类型报错 ——
 * 它在真机上的表现是**命令发出去永远没有回应**，或者心跳读出来全是默认值。
 * 这是最难查的一类问题，而它**完全可以在离线用字符串对账抓住**。
 *
 * ⚠ 这个文件的断言方式是"从 C# 源码里抠字面量，和 TS 的类型/常量比"。
 * 抠取规则失效时（比如 C# 换了写法）测试会**失败**而不是静默通过 ——
 * 所以下面对"抠到了几个"也做了下界断言。
 */

const CS = path.resolve(__dirname, '../../resources/unity-bridge/com.avca.bridge/Editor/AVCABridge.cs')
const csSrc = fs.readFileSync(CS, 'utf8')

/** C# 里 `switch (type)` 处理的命令名 */
function csCommandTypes(): Set<string> {
  const out = new Set<string>()
  for (const m of csSrc.matchAll(/case\s+"([a-z_]+)"\s*:/g)) out.add(m[1])
  return out
}

/** C# 里 `JsonRead.<Kind>(<expr>, "key"...)` 读的全部键名 */
function csJsonReadKeys(): Set<string> {
  const out = new Set<string>()
  for (const m of csSrc.matchAll(/JsonRead\.(?:String|Bool|Int|StringArray|Object|Array)\([^,)]+,\s*"([A-Za-z_]+)"/g)) {
    out.add(m[1])
  }
  return out
}

/** C# 写结果/心跳时用的 JSON 键名（`sb.Append(",...\"key\":")` 与 JsonWrite.Quote 附近的字面量） */
function csWrittenKeys(): Set<string> {
  const out = new Set<string>()
  for (const m of csSrc.matchAll(/Append\(",\\"([A-Za-z_]+)\\"/g)) out.add(m[1])
  for (const m of csSrc.matchAll(/Append\('\}'\)/g)) void m
  return out
}

/** A 侧 `BridgeCommandType` 联合类型的成员 */
const TS_COMMAND_TYPES: BridgeCommandType[] = [
  'ping',
  'get_status',
  'get_preview_targets',
  'get_preview_candidates',
  'render_preview',
  'resolve_guids',
  'import_unitypackage',
  'import_files',
  'delete_guids',
  'list_project_assets',
  'refresh',
  'open_folder'
]

/** A 侧 `BridgeResultStatus` 的成员 */
const TS_RESULT_STATUS = ['ok', 'progress', 'busy', 'error', 'cancelled']

/**
 * A 侧真的会写出去的命令（有调用点；其余是桥接支持但 A 暂未用的）。
 * 2026-10-06 M6 ② 起 `list_project_assets` 从"桥接支持但没人发"变成真会发
 * （`src/main/project/fingerprint.ts` 拿它读工程指纹），所以加进来 ——
 * 这张清单的意义就是"发出去的一定有人接"。
 */
const A_ACTUALLY_SENDS = ['resolve_guids', 'import_unitypackage', 'delete_guids', 'refresh', 'list_project_assets', 'get_preview_targets', 'get_preview_candidates', 'render_preview']

/** 剥掉 `//` 行注释与 `/* *\/` 块注释，只留代码 —— 判断"代码顺序"必须这么做 */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split(/\r?\n/)
    .filter((l) => !/^\s*\/\//.test(l))
    .join('\n')
}

const CS_CODE = stripComments(csSrc)

describe('命令名对账（A 发出 ↔ C# 处理）', () => {
  it('C# 处理全部已声明命令（抠取规则失效会让这条先红）', () => {
    const cs = csCommandTypes()
    expect(cs.size, `抠到的是：${[...cs].join(', ')}`).toBe(TS_COMMAND_TYPES.length)
  })

  it('两边命令名完全一致，包括原有命令和物品预览命令', () => {
    const cs = csCommandTypes()
    const ts = new Set<string>(TS_COMMAND_TYPES)
    /** A 声明了但 C# 不处理 → 发出去没人接 */
    const tsOnly = [...ts].filter((t) => !cs.has(t))
    /** C# 处理了但 A 的类型里没有 → 永远发不出去（或者拼错了） */
    const csOnly = [...cs].filter((t) => !ts.has(t))
    expect(tsOnly, `A 声明了但 C# 不处理：${tsOnly.join(', ')}`).toEqual([])
    expect(csOnly, `C# 处理了但 A 类型里没有：${csOnly.join(', ')}`).toEqual([])
  })

  it('A 真的在用的那几条命令，C# 都有对应分支', () => {
    const cs = csCommandTypes()
    for (const t of A_ACTUALLY_SENDS) {
      expect(cs.has(t), `A 会发 ${t}，但 C# 的 switch 里没有这个 case`).toBe(true)
    }
  })
})

describe('payload 键名对账（A 写 ↔ C# 读）', () => {
  it('C# 抠到了 payload 键（抠取规则失效会让这条先红）', () => {
    const keys = csJsonReadKeys()
    expect(keys.size).toBeGreaterThanOrEqual(5)
  })

  it('C# 读的每个 payload 键，A 都真的写了', () => {
    const keys = csJsonReadKeys()
    /**
     * A 侧 `import/coordinator.ts` 写出去的 payload 键（含桥接支持但 A 暂未用的
     * `sources` / `destFolder` / `assetPath` —— 那几条是 M5-B 的入口，C# 先支持是对的）。
     */
    const aWrites = new Set([
      'guids',
      'allow',
      'path',
      'backupOverwritten',
      // 以下三条 A 目前不发，但 C# 必须支持（协议完整性；M5-B 会用）
      'sources',
      'destFolder',
      'assetPath',
      // 信封字段（不是 payload，但同一套 JsonRead 读）
      'type',
      'payload',
      'protocolVersion',
      'dependencies'
    ])
    const orphan = [...keys].filter((k) => !aWrites.has(k))
    expect(orphan, `C# 在读这些键，但 A 侧不会写：${orphan.join(', ')}`).toEqual([])
  })

  it('A 写 import_unitypackage 时用的键名与 C# 读的一致', () => {
    const coord = fs.readFileSync(path.resolve(__dirname, '../../src/main/import/coordinator.ts'), 'utf8')
    /** A 侧那段 payload 就在 coordinator 里，直接查它有没有写这三个键 */
    expect(coord).toContain('path: packagePath')
    expect(coord).toContain('guids: pre.guids')
    expect(coord).toContain('backupOverwritten:')
    const keys = csJsonReadKeys()
    expect(keys.has('path')).toBe(true)
    expect(keys.has('guids')).toBe(true)
    expect(keys.has('backupOverwritten')).toBe(true)
  })
})

describe('结果信封字段对账（C# 写 ↔ A 读）', () => {
  it('C# 写的 id / status / progress / message / data 都是 A 侧 BridgeResult 的字段', () => {
    const aFields: Array<keyof BridgeResult> = ['id', 'status', 'progress', 'message', 'busyReason', 'data']
    /** C# 里这些键都是以 Append(",\"key\"") 的形式拼出去的 */
    for (const f of aFields) {
      expect(csSrc, `C# 没有写出 ${f} 这个键`).toContain(`\\"${f}\\"`)
    }
  })

  it('C# 用的 status 取值都在 A 侧 BridgeResultStatus 里（写错一个 A 就永远等不到终态）', () => {
    /**
     * 抠法：先把 C# 里**所有**双引号字符串抓出来，再和"状态关键词"求交集。
     *
     * 不能写成"抓所有三元表达式的两个分支" —— 第一版那么写，把 C# 里
     * `Bool()` 之类的 `true` / `false` 也抓进来了，报出
     * `C# 写了 A 不认识的 status：true, false` 这种噪声。
     * 关键词白名单既能抓到真错（比如把 `error` 拼成 `err`），又不会误报。
     */
    const QUOTED = new Set<string>()
    for (const m of csSrc.matchAll(/"([A-Za-z_]+)"/g)) QUOTED.add(m[1])

    const KEYWORDS = ['ok', 'error', 'progress', 'busy', 'cancelled']
    const writtenKeywords = KEYWORDS.filter((k) => QUOTED.has(k))

    expect(
      writtenKeywords.length,
      `C# 里连一个状态关键词都没出现，抠取规则失效了：${[...QUOTED].slice(0, 20).join(', ')}`
    ).toBeGreaterThanOrEqual(4)

    /** 所有出现的关键词都必须是 A 认识的 —— 拼错会在这里露出来 */
    const unknown = writtenKeywords.filter((s) => !TS_RESULT_STATUS.includes(s))
    expect(unknown, `C# 写了 A 不认识的 status：${unknown.join(', ')}`).toEqual([])

    /** A 判定"终态"只认这三个，所以桥接必须真的写得出它们 */
    for (const need of ['ok', 'error', 'cancelled'] as const) {
      expect(writtenKeywords, `C# 从没写过终态 ${need}，A 会一直等下去`).toContain(need)
    }

    /**
     * 反向保护：状态关键词**不许**有拼写变体。
     * 比如有人加了 `"canceled"`（一个 l）或 `"fail"`，A 不认识，
     * 那条命令在 A 眼里就永远没到终态 —— 只能超时。
     */
    const TYPOS = ['canceled', 'fail', 'failed', 'success', 'done', 'timeout', 'rejected']
    const found = TYPOS.filter((t) => QUOTED.has(t))
    expect(found, `C# 里出现了 A 不认识的状态拼法：${found.join(', ')}`).toEqual([])
  })

  it('⭐ C# **必须真的写得出 `busy`** —— 否则 Play 模式下导入会失败而不是排队', () => {
    /**
     * 这条是**被本文件抓出来的真 bug 的回归**（2026-10-06）。
     *
     * 修之前 C# 里 `busy` 只出现在 `IsBusy()` / 心跳的 `busyReason` 里，
     * **从来没被写进 outbox**。后果：Unity 忙的时候 A 侧收到的是**沉默**，
     * 等到 ack 超时（10 秒）后报"桥接没有回应"、命令**失败** ——
     * 而不是按 §2.5 排队重试。A 侧那整套 1s→2s→5s→10s→30s 退避在生产里
     * 永远不会被触发，验收 §8-5（Play 模式下点导入要排队、退出 Play 后自动执行）过不去。
     *
     * 规格 §2.5 原文：「不消费命令，直接写回 `busy` + `busyReason`」。
     */
    const writesBusy = /WriteResult\([^)]*"busy"/.test(csSrc)
    expect(writesBusy, 'C# 没有把 busy 写进 outbox —— 忙时 A 只会收到沉默并最终判定失败').toBe(true)
    /** 而且 busy 结果要带 busyReason（A 拿它显示"Unity 正在运行/编译"） */
    expect(csSrc).toMatch(/busyReason/)
    /**
     * ⚠ 这里必须查**调用**，不能只查函数名。
     * 第一版我只断言了 `csSrc` 里含 `ReportBusyToPending` ——
     * 那把 `IsBusy()` 分支里的调用删掉、只留空函数定义，测试**照样通过**。
     * 实测验证过：删掉调用后它仍然绿，等于没测。所以下面查的是带分号的调用行。
     */
    expect(csSrc, 'ReportBusyToPending 只有定义、没有被调用').toMatch(/^\s+ReportBusyToPending\(\);/m)
    /** 调用必须发生在 IsBusy() 分支之后（顺序错了会在别的状态下误报 busy） */
    const idxBusyBranch = csSrc.indexOf('if (IsBusy())')
    const idxCall = csSrc.search(/^\s+ReportBusyToPending\(\);/m)
    expect(idxBusyBranch).toBeGreaterThan(-1)
    expect(idxCall).toBeGreaterThan(idxBusyBranch)
  })

  it('忙时**不删** inbox 里的命令（没执行的东西不能被当成已消费）', () => {
    /** `ReportBusyToPending` 里不许出现 TryDelete —— 删了 A 就没法退避重投 */
    const body = /private static void ReportBusyToPending\(\)[\s\S]*?\n        \}/.exec(csSrc)
    expect(body, '没抠到 ReportBusyToPending 的函数体').toBeTruthy()
    expect(body![0]).not.toContain('TryDelete')
    expect(body![0], '写 busy 不该顺手写终态').not.toContain('CompleteCurrent')
  })

  it('**正在导入时不许写 busy**（否则 A 会把正常进行的导入当成被拒）', () => {
    /**
     * `_current != null` 与 `IsBusy()` 必须分开处理：前者是"已经在跑"，
     * 后者是"没法接新活"。混在一起会在导入过程中反复告诉 A"我忙"，
     * 而 A 的 busy 处理是**重投**，于是同一份包被重复提交。
     *
     * ⚠ 判位置必须用**剥掉注释**的源码：这段代码在注释里被大段引用过
     * （就是为了解释下面那条死锁），用 raw 源码 `indexOf` 会命中注释里的副本。
     * 这正是下面那条死锁用例第一次跑红的真实原因 —— 不是代码顺序错，是我的抠取中招。
     */
    const idxCurrent = CS_CODE.search(/^\s+if \(_current != null\) return;/m)
    const idxBusy = CS_CODE.search(/^\s+if \(IsBusy\(\)\)/m)
    expect(idxCurrent, '没抠到 _current 守卫').toBeGreaterThan(-1)
    expect(idxBusy, '没抠到 IsBusy 判定').toBeGreaterThan(-1)
    expect(idxCurrent, '_current 守卫必须在 IsBusy 之前').toBeLessThan(idxBusy)
  })

  it('⭐ `RefreshQueue()` 必须在忙判定**之前**（顺序错了会死锁，§8-5 直接失败）', async () => {
    /**
     * 这条是 2026-10-06 在真机上撞到的**死锁**的回归。
     *
     * 曾经的顺序：
     * ```
     * if (IsBusy()) { ReportBusyToPending(); return; }  // 内部 RefreshQueue → Queue 变 1
     * if (Queue.Count > 0) return;                      // 从此永远在这里返回
     * RefreshQueue();                                   // 再也跑不到
     * ```
     *
     * 死锁链条：Unity 进 Play → A 发来命令 → `ReportBusyToPending()` 把命令读进
     * `Queue`（同时回 busy）→ 用户退出 Play → 不再忙，但 `Queue.Count > 0`
     * → **直接 return**，`RefreshQueue()` 永远调不到 → **那条命令永远不被处理**。
     *
     * 表现：用户看到"已排队 · 第 6 次重试"，退出 Play 之后**什么都没发生**，
     * 导入永远不完成。这正是 §8-5 要验的那条路。
     */
    const idxRefresh = CS_CODE.search(/^\s+RefreshQueue\(\);/m)
    const idxBusy = CS_CODE.search(/^\s+if \(IsBusy\(\)\)/m)
    expect(idxRefresh, '没抠到 Tick 里的 RefreshQueue 调用').toBeGreaterThan(-1)
    expect(idxBusy, '没抠到 IsBusy 判定').toBeGreaterThan(-1)
    expect(idxRefresh, 'RefreshQueue 必须在 IsBusy 之前').toBeLessThan(idxBusy)
    /** 那个会造成死锁的"提前返回"必须不再存在 */
    expect(CS_CODE, '又写回了 `if (Queue.Count > 0) return;` —— 那会重新引入死锁').not.toMatch(
      /^\s+if \(Queue\.Count > 0\) return;/m
    )
  })

  it('busy 之后命令最终成功（A 侧退避重投端到端）', async () => {
    /**
     * ⚠ **这条验不了那个死锁，别把它当成死锁的回归。**
     *
     * 我本来以为它能：名字就写着"端到端跑一遍"。实测发现**复现不了** ——
     * 把 C# 改回会死锁的旧顺序之后，这条**照样通过**，只有上面那条静态顺序断言会红。
     *
     * 原因是 `FakeUnity` 的行为与真桥接不同：它**一看到 inbox 文件就立刻消费并回答**，
     * 没有真桥接那套 `Queue` + `if (Queue.Count > 0) return;` 守卫结构。
     * 而那个死锁恰恰出在守卫上 —— 假对端结构里根本没有它，自然复现不出来。
     *
     * 所以这条验的是**另一件也有价值的事**：A 侧的 busy 退避重投确实能
     * 在"前两次忙、后面放行"的情况下走到成功。死锁的防回归靠上面那条静态断言
     * （它验的是真桥接的源码顺序）。
     *
     * 教训同"假回归用例"那条：**写了"端到端"不等于真的覆盖了那个 bug**，
     * 必须把修复回退掉、确认用例真的会红，否则就会把没有覆盖的东西记成已覆盖。
     */
    const { BridgeManager } = await import('../../src/main/bridge/manager')
    const { FakeUnity } = await import('./fake-unity')
    const os = await import('node:os')
    const fsMod = await import('node:fs')
    const pathMod = await import('node:path')

    const dir = fsMod.mkdtempSync(pathMod.join(os.tmpdir(), 'avca-busyretry-'))
    const proj = pathMod.join(dir, 'P')
    fsMod.mkdirSync(proj, { recursive: true })
    const m = new BridgeManager()
    const fk = new FakeUnity(proj)
    fk.heartbeat()
    fk.start()
    m.watch(proj)

    /** 前两次回 busy（模拟 Play 模式），之后放行 */
    let busyLeft = 2
    fk.onCommand(() => {
      if (busyLeft > 0) {
        busyLeft--
        return { status: 'busy', busyReason: 'Unity 正在运行 Play 模式' }
      }
      return { status: 'ok', data: { pong: true } }
    })

    try {
      const r = await m.execute(proj, 'ping', {}, { label: 'ping', ackTimeoutMs: 20000 })
      expect(r.status, '前两次 busy 之后必须走到成功').toBe('ok')
      expect(r.data).toEqual({ pong: true })
    } finally {
      m.dispose()
      fk.stop()
      for (let i = 0; i < 5; i++) {
        try {
          fsMod.rmSync(dir, { recursive: true, force: true })
          break
        } catch {
          await new Promise((res) => setTimeout(res, 150))
        }
      }
    }
  }, 60_000)
})

describe('心跳字段对账（C# 写 ↔ A 读）', () => {
  it('C# 写的心跳键覆盖 A 侧 BridgeHeartbeat 的每个字段', () => {
    const hbFields: Array<keyof BridgeHeartbeat> = [
      'protocolVersion',
      'pid',
      'projectPath',
      'projectName',
      'unityVersion',
      'bridgeVersion',
      'isPlaying',
      'isCompiling',
      'isUpdating',
      'isPlayingOrWillChangePlaymode',
      'activeScene',
      'busyReason',
      'queueLength',
      'heartbeatUtc'
    ]
    const missing = hbFields.filter((f) => !csSrc.includes(`\\"${f}\\"`))
    /** 少写一个字段，A 读出来就是 undefined —— 界面上表现为"桥接状态不全" */
    expect(missing, `C# 的心跳里缺这些字段：${missing.join(', ')}`).toEqual([])
  })

  it('协议版本号两边一致（对不上时 A 会判定桥接不可用）', () => {
    /** C# 里 `public const int ProtocolVersion = 1;` */
    const m = /ProtocolVersion\s*=\s*(\d+)/.exec(csSrc)
    expect(m, '没抠到 C# 的 ProtocolVersion').toBeTruthy()
    const csVer = Number(m![1])
    const tsSrc = fs.readFileSync(path.resolve(__dirname, '../../src/shared/types.ts'), 'utf8')
    const tm = /BRIDGE_PROTOCOL_VERSION\s*=\s*(\d+)/.exec(tsSrc)
    expect(tm, '没抠到 A 的 BRIDGE_PROTOCOL_VERSION').toBeTruthy()
    expect(csVer).toBe(Number(tm![1]))
  })
})

describe('协议常量对账（周期 / 上限）', () => {
  it('Tick 500ms 节流与心跳 2 秒，两边写的是同一组数', () => {
    /** C# 侧 */
    expect(csSrc).toMatch(/TickThrottleSeconds\s*=\s*0\.5/)
    expect(csSrc).toMatch(/HeartbeatSeconds\s*=\s*2\.0/)
    /** A 侧 */
    const consts = fs.readFileSync(path.resolve(__dirname, '../../src/shared/constants.ts'), 'utf8')
    /** A 用 10 秒判陈旧 = 5 个心跳周期，留足冗余 */
    expect(consts).toMatch(/BRIDGE_STALE_MS\s*=\s*10000/)
    /** busy 退避序列固定（§2.5） */
    expect(consts).toMatch(/BUSY_BACKOFF_MS\s*=\s*\[1000,\s*2000,\s*5000,\s*10000,\s*30000,\s*30000\]/)
  })

  it('C# 引用的每个 Unity API 都能在编译检查里通过（交叉引用 compile-check）', () => {
    /**
     * 这条不做静态断言（编译检查已经覆盖），只断言"关键 API 真的出现在源码里" ——
     * 免得有人把 `FileUtil.CopyFileOrDirectory` 换成手写 meta 之后没人发现。
     */
    for (const api of [
      'AssetDatabase.ImportPackage',
      'AssetDatabase.GUIDToAssetPath',
      'AssetDatabase.importPackageCompleted',
      'AssetDatabase.importPackageFailed',
      'AssetDatabase.importPackageCancelled',
      'FileUtil.CopyFileOrDirectory',
      'AssetDatabase.Refresh',
      'EditorApplication.update',
      'EditorApplication.timeSinceStartup',
      'EditorGUIUtility.PingObject'
    ]) {
      expect(csSrc, `桥接里没有用到 ${api}`).toContain(api)
    }
  })
})
