#!/usr/bin/env node
/**
 * M5-B ⑦ 沙盒活体用的**假 Unity**：一个真的在监听文件信箱的对端。
 *
 * 它存在的理由只有一条：成员选择面板的"这一批的冲突汇总"那一步，
 * 必须先过 `preflight` 的两道门（桥接已装 + 心跳新鲜），而 `preflight` 的冲突
 * 又是**问工程**要答案（`resolve_guids`）。没有对端，画面上就只能看到一条错误，
 * 面板第二步到底画没画对**永远验不到**（本仓库渲染层零 DOM 测试）。
 *
 * ⚠ 它不是真 Unity：`import_unitypackage` 是照着包里的 `pathname` 把文件**铺进 Assets/**，
 * 不走 AssetDatabase、不生成GUID 依赖、不重序列化。所以这一轮能证明的是
 * **A 这一侧的整条链**（抽取 → 预扫描 → 串行发命令 → 记账 → 清副本 → 倒序撤销）
 * 和**界面画法**；真 Unity 下的导入结果仍算未验证。
 *
 * 严格照 §2.5 的契约行事：终态才删 inbox 的命令文件、结果一律 tmp+rename 覆写
 * `outbox/<id>.json`、导入期间持续推 progress（不然 A 侧按"导入中断"处理是对的）。
 *
 * 用法：node tools/fake-unity-live.cjs <工程路径>
 */
const fs = require('node:fs')
const path = require('node:path')
const tar = require('tar')

const PROJ = process.argv[2]
if (!PROJ) {
  console.error('用法：node tools/fake-unity-live.cjs <工程路径>')
  process.exit(1)
}
if (!/LiveTest$/i.test(path.basename(PROJ))) {
  /** 防呆：这个假对端只许对着沙盒工程，不许指到任何真工程上 */
  console.error(`拒绝：工程名必须是沙盒的 *LiveTest（拿到的是 ${PROJ}）`)
  process.exit(1)
}

const DIR = path.join(PROJ, 'Temp', 'AVCABridge')
const INBOX = path.join(DIR, 'inbox')
const OUTBOX = path.join(DIR, 'outbox')
const LOG = path.join(PROJ, '..', '..', 'fake-unity.log')
const PROTOCOL_VERSION = 1

fs.mkdirSync(INBOX, { recursive: true })
fs.mkdirSync(OUTBOX, { recursive: true })

function logLine(s) {
  try {
    fs.appendFileSync(LOG, `[${new Date().toISOString()}] ${s}\n`)
  } catch {
    /* 日志写不进不该影响应答 */
  }
}

function writeJsonAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.tmp`
  try {
    fs.writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8')
    fs.renameSync(tmp, file)
  } catch (e) {
    /**
     * Windows 上这一秒可能读到 EPERM：读方（A 侧的 chokidar / File.ReadAllText）
     * 正好握着目标文件。实测假对端跑到第 30 分钟就是这么死一次的（心跳写 bridge.json）。
     * 心跳每 500ms 一次，**丢掉一轮不算错**，所以这里只留日志、下次再写。
     */
    try {
      fs.rmSync(tmp, { force: true })
    } catch {
      /* 连临时文件都删不掉就更不用管了 */
    }
    logLine(`写失败（下轮重试）：${path.basename(file)} —— ${e.code || e.message}`)
  }
}

// ---------------------------------------------------------------- 工程的"资产台账"

/** guid → Assets/ 相对路径。真 Unity 靠 .meta，这里同样**从盘上的 .meta 读** */
function assetIndex() {
  const map = new Map()
  const assetsDir = path.join(PROJ, 'Assets')
  const walk = (dir) => {
    let names
    try {
      names = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const n of names) {
      const full = path.join(dir, n.name)
      if (n.isDirectory()) {
        walk(full)
        continue
      }
      if (!n.name.endsWith('.meta')) continue
      let text = ''
      try {
        text = fs.readFileSync(full, 'utf8')
      } catch {
        continue
      }
      const m = /^guid:\s*([0-9a-f]{32})/m.exec(text)
      if (!m) continue
      map.set(m[1], path.relative(assetsDir, full.slice(0, -'.meta'.length)).split(path.sep).join('/'))
    }
  }
  walk(assetsDir)
  return map
}

/**
 * 读一个 .unitypackage（gzip+tar）里每个 GUID 的目标路径与内容。
 *
 * 解到临时目录再读，而不是用 `tar.t` 的流式回调：sync 模式下拿不到条目内容，
 * 而这里要的就是内容（`asset` 那一段才是真正铺进 Assets/ 的字节）。
 * 包很小（沙盒里 3 个包一共几 KB），多解一次不值得优化。
 */
function unpackPackage(file) {
  const tmp = path.join(path.dirname(file), `.unpack-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`)
  fs.mkdirSync(tmp, { recursive: true })
  try {
    tar.x({ file, cwd: tmp, sync: true })
    const res = []
    for (const guidRaw of fs.readdirSync(tmp)) {
      const dir = path.join(tmp, guidRaw)
      if (!fs.statSync(dir).isDirectory()) continue
      const guid = guidRaw.replace(/^\.\//, '')
      const read = (n) => {
        try {
          return fs.readFileSync(path.join(dir, n))
        } catch {
          return null
        }
      }
      const pathname = read('pathname')
      if (!pathname) continue
      res.push({ guid, unityPath: pathname.toString('utf8').trim(), asset: read('asset'), meta: read('asset.meta') })
    }
    return res
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
}

// ---------------------------------------------------------------- 各命令的应答

function respond(cmd) {
  const payload = cmd.payload || {}
  switch (cmd.type) {
    case 'resolve_guids': {
      const index = assetIndex()
      const resolved = {}
      for (const g of payload.guids || []) {
        /** 真桥接回的是 `Assets/...` 全路径（不是相对 Assets 的），界面直接把这串给用户看 */
        const rel = index.get(g)
        resolved[g] = rel ? 'Assets/' + rel : null
      }
      return { status: 'ok', data: { resolved } }
    }
    case 'import_unitypackage': {
      const items = fs.existsSync(payload.path) ? unpackPackage(payload.path) : []
      const wanted = new Set(payload.guids || [])
      const index = assetIndex()
      const created = []
      const overwritten = []
      for (const it of items) {
        if (wanted.size && !wanted.has(it.guid)) continue
        const rel = it.unityPath.replace(/^Assets[\\/]/i, '')
        const dest = path.join(PROJ, 'Assets', rel)
        const existed = index.has(it.guid) || fs.existsSync(dest)
        fs.mkdirSync(path.dirname(dest), { recursive: true })
        fs.writeFileSync(dest, it.asset ?? '')
        fs.writeFileSync(
          `${dest}.meta`,
          `fileFormatVersion: 2\nguid: ${it.guid}\n` +
            /**
             * 包里的 `.meta` 现在**自带 guid**（真 Unity 要，见 make-m5b-live-tree），所以那两行
             * 都得摘掉再拼 —— 留着会写出两条 `guid:`，看着像这个对端把 GUID 写乱了。
             * GUID 只有一个来源：tar 里那个目录名（`it.guid`）。
             */
            (it.meta ? it.meta.toString('utf8').replace(/^(fileFormatVersion|guid):.*$/gm, '').replace(/^\s+/, '') : '')
        )
        /** 只把"这次新建的"记进白名单 —— 撤销时删的就是这份清单（§6.3 前后差集） */
        if (existed) overwritten.push(it.guid)
        else created.push(it.guid)
      }
      return { status: 'ok', data: { createdGuids: created, overwrittenGuids: overwritten, importedPaths: items.map((i) => i.unityPath) } }
    }
    case 'delete_guids': {
      const allow = new Set(payload.allow || [])
      const index = assetIndex()
      const deleted = []
      for (const g of payload.guids || []) {
        if (!allow.has(g)) continue
        const rel = index.get(g)
        if (!rel) continue
        const abs = path.join(PROJ, 'Assets', rel)
        /** 双保险：绝不允许删到 Assets/ 外面（和真桥接同一条红线） */
        if (!abs.startsWith(path.join(PROJ, 'Assets'))) continue
        try {
          fs.rmSync(abs, { force: true })
          fs.rmSync(`${abs}.meta`, { force: true })
          deleted.push(rel)
        } catch (e) {
          logLine(`删除失败 ${rel}: ${e.message}`)
        }
      }
      return { status: 'ok', data: { deleted } }
    }
    case 'get_status':
      /** 跟假 Play 开关保持一致：A 侧有的路径读心跳、有的路径读这条应答，两边不许各说一套 */
      return { status: 'ok', data: { isPlaying: playBusy() !== null, isCompiling: false, activeScene: 'Assets/Sandbox.unity' } }
    case 'list_project_assets':
      return { status: 'ok', data: { assets: [...assetIndex().entries()].map(([guid, assetPath]) => ({ guid, assetPath })) } }
    case 'open_folder':
      return { status: 'ok', data: {} }
    case 'refresh':
      return { status: 'ok', data: {} }
    default:
      return { status: 'ok', data: {} }
  }
}

/** 导入要装成"忙一会儿"的样子：先 progress 两条再终态，否则进度条那条路没走过 */
const SLOW = new Set(['import_unitypackage', 'delete_guids'])

/**
 * ⭐ 假 Play 模式：`<工程>/Temp/AVCABridge/play.txt` 存在就是"正在 Play"。
 *
 * 为什么要这个开关：§8-5 那条"Play 模式下点导入 → 排队 → 退出后自动执行"，
 * A 侧的排队逻辑只有离线单测（`tests/unity/*`），真机从来没点过。
 * 用这个开关可以先在假对端上把**A 这一侧**证完（busy 怎么报、退避几步、界面那句话画不画、
 * 忙完了有没有自己跑起来），再去真 Unity 上验**桥接那一侧**（`IsBusy()` 真会翻）。
 * 两边的判据分开写，谁也别冒充谁。
 *
 * 文件内容：一个数字 = "忙到那个 epoch 毫秒为止"；别的（或空）= 忙到文件被删。
 * 照 §2.5 的契约：**忙的时候不许消费命令**，只回写 `busy` + `busyReason`（照 C# 那句原文）。
 */
const PLAY_FLAG = path.join(DIR, 'play.txt')
function playBusy() {
  let raw
  try {
    raw = fs.readFileSync(PLAY_FLAG, 'utf8').trim()
  } catch {
    return null
  }
  const until = Number(raw)
  /**
   * ⚠ 只有**像 epoch 毫秒的数**（≥ 1e12，即 2001 年之后）才当"忙到那一刻"。
   * 第一版写的是 `until > 0`，驱动塞了个占位用的 `1` 进去 → 被读成"忙到 1970-01-01"
   * → 立刻判不忙，心跳的 isPlaying 一直是 false，看起来像开关没生效。
   * 现在：空 / `1` / 任何小数字 = "忙到文件被删为止"。
   */
  if (Number.isFinite(until) && until >= 1e12) return Date.now() < until ? until : null
  return Infinity
}
const BUSY_REASON = 'Unity 正在运行 Play 模式'


// ---------------------------------------------------------------- 轮询

const seen = new Map()

function poll() {
  let names = []
  try {
    names = fs.readdirSync(INBOX)
  } catch {
    return
  }
  for (const n of names) {
    if (!n.toLowerCase().endsWith('.json')) continue
    const id = n.slice(0, -5)
    const abs = path.join(INBOX, n)
    let cmd
    try {
      cmd = JSON.parse(fs.readFileSync(abs, 'utf8'))
    } catch {
      continue
    }
    if (seen.get(id) === cmd.createdAt) continue
    /**
     * 忙：**不消费命令**，只回写 busy（照 §2.5 / C# 的原文那句）。
     * 故意不写进 `seen` —— 真桥接也是每 500ms 重写同一份 busy，A 那边按退避序列重投，
     * 忙的一刻假对端要一直说忙；忙过了下一刻就要真的执行这条命令。
     */
    if (playBusy() !== null) {
      writeJsonAtomic(path.join(OUTBOX, `${id}.json`), { id, status: 'busy', busyReason: BUSY_REASON, message: BUSY_REASON })
      if (!seen.get(id + ':busy')) logLine(`忙（Play）：${cmd.type} id=${id} 回 busy，命令留在 inbox 不消费`)
      seen.set(id + ':busy', true)
      continue
    }
    seen.set(id, cmd.createdAt)
    logLine(`收到 ${cmd.type} id=${id} payload=${JSON.stringify(cmd.payload).slice(0, 180)}`)

    const out = path.join(OUTBOX, `${id}.json`)
    const delay = (ms) => new Promise((r) => setTimeout(r, ms))
    void (async () => {
      if (SLOW.has(cmd.type)) {
        writeJsonAtomic(out, { id, status: 'progress', progress: 0.2, message: '读取包内容' })
        await delay(220)
        writeJsonAtomic(out, { id, status: 'progress', progress: 0.7, message: '写入 Assets' })
        await delay(220)
      }
      let reply
      try {
        reply = respond(cmd)
      } catch (e) {
        reply = { status: 'error', message: String(e && e.message ? e.message : e) }
      }
      writeJsonAtomic(out, { id, status: reply.status, data: reply.data, message: reply.message })
      /** §2.5：只有终态才删命令文件 */
      try {
        fs.rmSync(abs, { force: true })
      } catch {
        /* 下次 Tick 再删 */
      }
      logLine(`回 ${cmd.type} → ${reply.status}`)
    })()
  }
}

function heartbeat() {
  const busy = playBusy() !== null
  writeJsonAtomic(path.join(DIR, 'bridge.json'), {
    protocolVersion: PROTOCOL_VERSION,
    pid: process.pid,
    projectPath: PROJ,
    projectName: path.basename(PROJ),
    unityVersion: '2022.3.22f1',
    bridgeVersion: '1.0.0-live',
    /** 假 Play 开关打开时这几个字段要跟着变 —— A 侧"运行中 / 忙"的判定读的就是它们 */
    isPlaying: busy,
    isCompiling: false,
    isUpdating: false,
    isPlayingOrWillChangePlaymode: busy,
    activeScene: busy ? 'Assets/Sandbox.unity' : null,
    busyReason: busy ? BUSY_REASON : null,
    queueLength: 0,
    heartbeatUtc: Date.now()
  })
}

logLine(`假 Unity 起来了：${PROJ} pid=${process.pid}`)
heartbeat()
setInterval(heartbeat, 500)
setInterval(poll, 60)
console.log(`假 Unity 在跑：${PROJ}（心跳 500ms / 轮询 60ms，日志 ${LOG}）`)
