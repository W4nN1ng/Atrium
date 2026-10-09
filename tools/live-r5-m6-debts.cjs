#!/usr/bin/env node
/**
 * 第 5 轮 · M6 那四条"只有真机能答"的欠账。
 *
 * 为什么这几条值得单独一个驱动：它们全都不是"算错了"那一类，而是**时序与外部世界**那一类 ——
 * 判据在纯函数里早就有单测（`shared/projectMatch.ts` / `shared/bridgeAsk.ts`），
 * 欠的是"边沿真的亮了吗、答案真的被下一次读到了吗、窗口真的浮上来了吗"。
 *
 * 三个 case（`--case=`），每个都自带前置（沙盒里造工程、起 A、跑完关 A）：
 *
 *   none     §8-11 真 none：**库里有一个能匹配的集合**（不是"集合表是空的所以谁都不切"那种退化 none），
 *            开一个不沾任何关键词的工程 → 只更新顶栏、不切集合、不弹窗。
 *   always   「以后都自动安装」的**第二次命中**：答过一次之后**把 A 整个重启一次**（新主进程、重新发现同一工程），
 *            看那条答案是不是**按路径**找回来的，并且这次**不该再弹窗**。
 *            —— 第 2 轮的 stage 3 用假心跳证过"删掉桥接会自动重装"，但它没重启过进程，
 *            所以"换一次进程还认不认得"这件事一直悬着（project id 是按路径还是每次新发一个，只有这么测才知道）。
 *   wake     §8-14 + 托盘置顶 1.2 秒：窗口收进托盘 → 工程边沿出现 → 用 Win32 逐 100ms 采样：
 *            可见 0→1、`WS_EX_TOPMOST` 在约 1.2 秒里为真、**然后自己取消**（不许永远压着 Unity）；
 *            顺带第二条口径：窗口本来就开着的时候**一下都不许置顶**（那是骚扰）。
 *            ⚠ 前台归属那一条用的是真 Windows 焦点保护，但"压在真 Unity 窗口之上"这一半
 *              前台替身是别的应用，不算等价，剩下的那半记在文档里。
 *
 * ⚠ 只碰 `D:\avca-m5b-live`（库根/日志/备份/工程目录都在里面），路径不对直接拒绝。
 * ⚠ 起 A 之前先确认他的 Unity 没开着（沙盒实例照样会发现真工程；这条红线见 `docs/BRIDGE.md` §13.4）。
 *   这三条都不需要真 Unity —— 运行边沿用假对端的心跳造，置顶与托盘量的是真 Win32 状态。
 *
 * 用法：
 *   node tools/live-r5-m6-debts.cjs --case=none
 *   node tools/live-r5-m6-debts.cjs --case=always
 *   node tools/live-r5-m6-debts.cjs --case=wake
 * 可选：AVCA_LIVE_ROOT / AVCA_CDP_PORT（默认 9226）/ AVCA_APP_EXE（默认仓库 dist\win-unpacked\Atrium.exe）
 */
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const cp = require('node:child_process')
const { DatabaseSync } = require('node:sqlite')

const ROOT = process.env.AVCA_LIVE_ROOT || 'D:\\avca-m5b-live'
if (!/avca-m5b-live|avca-live|sandbox/i.test(path.basename(ROOT))) {
  console.error(`拒绝：沙盒根目录名不对（${ROOT}）`)
  process.exit(1)
}
const HERE = path.resolve(__dirname, '..')
const APP = path.join(ROOT, 'AppData', 'Roaming', 'A')
const DB = path.join(APP, 'library.db')
const LOG = path.join(APP, 'logs', 'main.log')
const PROJ_ROOT = path.join(ROOT, 'projects')
const PORT = process.env.AVCA_CDP_PORT || '9226'
const EXE = process.env.AVCA_APP_EXE || path.join(HERE, 'dist', 'win-unpacked', 'Atrium.exe')
const TEMPLATE = path.join(HERE, 'resources', 'unity-bridge', 'com.avca.bridge')
const CASE = (process.argv.find((a) => /^--case=/.test(a)) || '--case=none').split('=')[1]
const SHOT_DIR = process.env.AVCA_SHOT_DIR || ROOT
const TOPMOST_PS = path.join(__dirname, 'topmost.ps1')

/** 三个 case 各用各的沙盒工程，名字不许沾集合关键词（none 那条要的正是"谁都匹配不上"） */
const NEUTRAL = 'Nothing-LiveTest'
const ASK = 'AskSecond-LiveTest'
const WAKE = 'WakeMe-LiveTest'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const ENV = { ...process.env, AVCA_CDP_PORT: PORT }

function evalInPage(expr) {
  return cp
    .execFileSync(process.execPath, [path.join(__dirname, 'cdp-eval.cjs'), expr], {
      cwd: HERE,
      encoding: 'utf8',
      env: ENV,
      maxBuffer: 16 * 1024 * 1024
    })
    .trim()
}
function ej(expr) {
  const raw = evalInPage(expr)
  try {
    return JSON.parse(raw)
  } catch {
    return raw
  }
}
function shot(name) {
  const out = path.join(SHOT_DIR, name)
  try {
    cp.execFileSync(process.execPath, [path.join(__dirname, 'cdp-shot.cjs'), out], { cwd: HERE, env: ENV })
    console.log('  📷 ' + out)
  } catch (e) {
    console.log('  ⚠ 截图失败（不盖住真判据）：' + (e.message || '').slice(0, 80))
  }
}
function body() {
  try {
    return evalInPage('document.body.innerText') || ''
  } catch {
    return ''
  }
}
function ps(args, opts = {}) {
  return cp.execFileSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', TOPMOST_PS, ...args], {
    encoding: 'utf8',
    ...opts
  })
}
function db() {
  const d = new DatabaseSync(DB)
  d.exec('PRAGMA busy_timeout = 5000')
  return d
}
function logSize() {
  try {
    return fs.statSync(LOG).size
  } catch {
    return 0
  }
}
/** 这之后的新日志（按**字节**偏移取，日志里有中文，字符下标会切过头） */
function logSince(n) {
  if (!fs.existsSync(LOG)) return ''
  const lines = Buffer.from(fs.readFileSync(LOG)).slice(n).toString('utf8').split(/\r?\n/)
  if (lines.length && lines[0] && !lines[0].startsWith('[')) lines.shift()
  return lines.join('\n')
}
/**
 * 某个时刻之后的日志行（按每行开头那个 `[YYYY-MM-DD HH:mm:ss.SSS]` 比）。
 * ⚠ 别用"字节偏移 + 之后再 startFake"那一套：自动装可能发生在**重启后第一轮探测**里，
 *   比驱动起假对端还早，按偏移取会把已经生效的行整段漏掉（第 5 轮第一跑就是这么报了个假故障）。
 * ⚠ 比的是**带左方括号**的前缀：日志行是 `[2026-10-08 18:52:31.123]`，
 *   而 `[`(0x5B) 比 `2`(0x32) 大 —— 少了那个括号，`>=` 对每一行都成立，
 *   于是上一轮的日志全被算进这一轮，判据"看着过了"其实是抄的旧账（本轮真踩过，第二次犯"只打印不断言"那一类）。
 */
function linesSince(ts) {
  if (!fs.existsSync(LOG)) return []
  const d = new Date(ts)
  const pad = (n, w = 2) => String(n).padStart(w, '0')
  const since = `[${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  return fs
    .readFileSync(LOG, 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.startsWith('[') && l.slice(0, since.length) >= since)
}
async function waitLog(re, what, tries = 40, step = 2000) {
  const from = logSize()
  for (let i = 0; i < tries; i++) {
    const t = logSince(from)
    const m = re.exec(t)
    if (m) return m[0]
    await sleep(step)
  }
  throw new Error(`等不到日志：${what}（${re}）；这段新日志末尾：\n` + logSince(from).slice(-400))
}
function killFake() {
  try {
    cp.execFileSync('powershell', [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-Command',
      "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { $_.CommandLine -like '*fake-unity-live*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"
    ])
  } catch {
    /* 本来就没在跑 */
  }
}
let fakeChild = null
function startFake(dir) {
  fakeChild = cp.spawn(process.execPath, [path.join(__dirname, 'fake-unity-live.cjs'), dir], {
    cwd: HERE,
    stdio: 'ignore',
    detached: true
  })
  fakeChild.unref()
  console.log('  起了假对端：' + dir)
}
function stopFake() {
  try {
    if (fakeChild) fakeChild.kill('SIGKILL')
  } catch {
    /* 已经没了 */
  }
  fakeChild = null
  killFake()
}
let appChild = null
function startApp(why) {
  if (!fs.existsSync(EXE)) throw new Error('打包版不在：' + EXE)
  appChild = cp.spawn(EXE, ['--remote-debugging-port=' + PORT], {
    cwd: HERE,
    detached: true,
    stdio: 'ignore',
    env: { ...process.env, AVCA_APP_HOME: APP, LOCALAPPDATA: path.join(ROOT, 'AppData', 'Local') }
  })
  appChild.unref()
  console.log(`  起 A（${why}，端口 ${PORT}）`)
  for (let i = 0; i < 40; i++) {
    try {
      const t = evalInPage('document.title')
      if (t) {
        console.log('  标题：' + t)
        return
      }
    } catch {
      /* 还没起来 */
    }
    sleepSync(1500)
  }
  throw new Error('A 起不来（CDP 连不上）')
}
/** startApp 里等 CDP 用的是同步轮询（整条链都是同步的，别混 async） */
function sleepSync(ms) {
  const sab = new SharedArrayBuffer(4)
  Atomics.wait(new Int32Array(sab), 0, 0, ms)
}
function stopApp() {
  try {
    cp.execFileSync('taskkill', ['/IM', 'Atrium.exe', '/F'], { encoding: 'utf8' })
  } catch {
    /* 没在跑 */
  }
  appChild = null
}

/** 造一个最小"看起来是工程"的目录：ProjectVersion.txt + Assets + Packages（可带桥接） */
function ensureProject(name, opts = {}) {
  const dir = path.join(PROJ_ROOT, name)
  fs.mkdirSync(path.join(dir, 'Assets'), { recursive: true })
  fs.mkdirSync(path.join(dir, 'Packages'), { recursive: true })
  fs.mkdirSync(path.join(dir, 'ProjectSettings'), { recursive: true })
  fs.mkdirSync(path.join(dir, 'Temp'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'ProjectSettings', 'ProjectVersion.txt'), 'm_EditorVersion: 2022.3.22f1\n')
  const manifest = path.join(dir, 'Packages', 'manifest.json')
  const deps = {}
  if (opts.withBridge && fs.existsSync(path.join(TEMPLATE, 'package.json'))) {
    fs.cpSync(TEMPLATE, path.join(dir, 'Packages', 'com.avca.bridge'), { recursive: true })
    deps['com.avca.bridge'] = 'file:com.avca.bridge'
  }
  fs.writeFileSync(manifest, JSON.stringify({ dependencies: deps }, null, 2))
  return dir
}
function bridgePkg(dir) {
  return path.join(dir, 'Packages', 'com.avca.bridge', 'package.json')
}
function projectRow(name) {
  const d = db()
  try {
    const r = d.prepare('SELECT id, name, path, is_running FROM project WHERE name = ?').get(name)
    return r ? { ...r } : null
  } finally {
    d.close()
  }
}
function setSettings(patch) {
  const r = ej(`(async () => JSON.stringify(await window.a.settings.setMany(${JSON.stringify(patch)})))()`)
  console.log('  设了 ' + JSON.stringify(Object.keys(patch)) + ' → ' + JSON.stringify(r).slice(0, 120))
}

/** 顶栏那一条的原文（"导入目标：xxx" 或工程页的状态），用来证明"顶栏照常更新" */
function headerText() {
  return ej(`(() => {
    const m = document.body.innerText
    const hit = m.match(/导入目标：[^\\n]{0,60}/)
    return JSON.stringify(hit ? hit[0] : '（没找到导入目标那句）')
  })()`)
}
function sidebarText() {
  return ej(`(() => {
    const nav = document.querySelector('aside') || document.querySelector('nav')
    return JSON.stringify((nav ? nav.innerText : '（没有侧栏）').replace(/\\s+/g, ' ').slice(0, 220))
  })()`)
}
const checks = []
function check(name, ok, extra) {
  checks.push({ name, ok: !!ok })
  console.log('  ' + (ok ? '✅' : '❌') + ' ' + name + (extra !== undefined && !ok ? ' —— 实际：' + JSON.stringify(extra).slice(0, 240) : ''))
}

// ---------------------------------------------------------------- 三个 case

async function caseNone() {
  console.log('== 前置：库里要**有一个能匹配的集合**，工程名要谁都沾不上 ==')
  const dir = ensureProject(NEUTRAL, { withBridge: true })
  const d = db()
  try {
    let c = d.prepare("SELECT id, name FROM collection WHERE name = 'Shinano'").get()
    if (!c) {
      d.prepare(
        'INSERT INTO collection (id, name, icon, sort_order, rule_json, is_auto, priority) VALUES (?, ?, NULL, 900, ?, 1, 100)'
      ).run('M5LIVENONE00000000000001', 'Shinano', JSON.stringify({ keywords: ['Shinano'], matchMode: 'any', priority: 100 }))
      console.log('  塞了一个 Shinano 集合（不然"谁都匹配不上"是因为集合表空，那是退化的 none，不算这一条）')
      c = { id: 'M5LIVENONE00000000000001', name: 'Shinano' }
    } else {
      console.log('  集合 Shinano 已存在')
    }
    d.prepare('UPDATE project SET last_auto_switch_at = NULL').run()
  } finally {
    d.close()
  }
  startApp('none')
  try {
    setSettings({ autoSwitchBehavior: 'when_matched', bridgeAutoInstall: false, autoLaunchAsked: true })
    killFake()
    console.log('== 1. 先让 A 把假对端那批工程判成"已关闭" ==')
    await sleep(13000)

    console.log('== 2. 开那个无关工程（假心跳 = 真"未运行→运行中"边沿） ==')
    const from = logSize()
    startFake(dir)
    const line = await waitLog(/未自动切换[^\n]*/, 'auto-switch 的 none 那一支')
    console.log('  ⭐ 日志：' + line.replace(/^\[[^\]]+\]\s*/, ''))
    const all = logSince(from).split(/\r?\n/).filter((l) => /auto-switch|状态变化/.test(l))
    console.log('  这一轮的相关日志：')
    for (const l of all.slice(-8)) console.log('    ' + l.replace(/^\[[^\]]+\]\s*/, '').slice(0, 150))
    check('切集合的判据走的是 none（不是 never / cooldown）', /none/.test(line), line)
    await sleep(2500)

    console.log('== 3. 顶栏照常更新、但没有"已识别为…"、视图没切 ==')
    /**
     * ⚠ "顶栏照常显示该实例"量的**不是**那颗「导入目标」：目标要用户自己选，没选就一直是"未选择"
     *   （第一版拿它当判据，报了个假故障）。规格这句指的是运行状态本身：
     *   判据 = `unity:list-projects` 里这个工程 running 为真，再切到「当前工程」页看屏幕上画没画出来。
     */
    const list = ej(`(async () => JSON.stringify(((await window.a.unity.listProjects()) || []).map(p => ({ name: p.name, running: p.running, hasBridge: p.bridgeReady }))))()`)
    console.log('  工程状态（IPC 那份）：' + JSON.stringify(list))
    const mine = Array.isArray(list) ? list.find((p) => p.name === NEUTRAL) : null
    check('顶栏那份数据认出了这个工程（running=true，照常更新）', !!mine && mine.running === true, mine)
    const t = body()
    check('没画"已识别为 … 自动打开 …"那条横幅', !/已识别为/.test(t), (/已识别为[^\n]*/.exec(t) || [''])[0])
    check('没弹任何切换/集合相关的窗', !/自动打开|切到集合/.test(t), (/自动打开[^\n]*/.exec(t) || [''])[0])
    const row = projectRow(NEUTRAL)
    check('库里这个工程 is_running = 1', !!row && row.is_running === 1, row)
    console.log('  切到「当前工程」页，屏幕上要看得见它 + 运行中：')
    /** 侧栏那一条可能是 button 也可能是 div/a —— 按"整段文字正好等于它"来点，避免点到容器 */
    const nav = ej(`(() => {
      const want = ${JSON.stringify('当前工程')}
      const nodes = [...document.querySelectorAll('button, a, div, span')].filter(n => (n.textContent || '').trim() === want)
      if (!nodes.length) return JSON.stringify({ ok: false, why: '侧栏里没有那条' })
      nodes[nodes.length - 1].click()
      return JSON.stringify({ ok: true, tag: nodes[nodes.length - 1].tagName, tried: nodes.length })
    })()`)
    console.log('  ' + JSON.stringify(nav))
    await sleep(1800)
    const proj = body()
    check('「当前工程」页写得出这个工程名', proj.includes(NEUTRAL), proj.slice(0, 200))
    check('并且标着运行中（不是只更新库、屏幕上什么都没有）', /运行中/.test(proj), (/运行中|未运行/.exec(proj) || ['（两个词都没有）'])[0])
    shot('r5-none-01-neutral-project.png')
    const cur = ej(`(() => {
      const on = [...document.querySelectorAll('aside [aria-current], aside .active, nav .active')]
      return JSON.stringify({ marked: on.map(n => (n.textContent || '').trim().slice(0, 20)), shinanoInAside: [...document.querySelectorAll('aside a, aside button')].map(n => (n.textContent||'').trim()).filter(s => s === 'Shinano').length })
    })()`)
    console.log('  侧栏：' + JSON.stringify(cur))
    check('没有切进 Shinano 那个集合的视图（集合存在但没被选中）', !(Array.isArray(cur.marked) && cur.marked.includes('Shinano')), cur)
    console.log('  侧栏原文：' + sidebarText())

  } finally {
    stopFake()
    stopApp()
  }
}

async function caseAlways() {
  console.log('== 前置：造一个没装桥接的工程（要的就是"第一次要问"那个形状） ==')
  const dir = ensureProject(ASK, { withBridge: false })
  fs.rmSync(path.join(dir, 'Packages', 'com.avca.bridge'), { recursive: true, force: true })
  const d = db()
  try {
    /** 重跑要干净：把这个工程的行与答案都清掉，让第一次发现真的是"第一次" */
    const row = d.prepare('SELECT id FROM project WHERE path = ?').get(dir)
    if (row) {
      d.prepare('DELETE FROM setting WHERE key = ?').run('bridgeAsk:' + row.id)
      d.prepare('DELETE FROM project WHERE id = ?').run(row.id)
      console.log('  清掉了上一次的 project 行与答案（id ' + String(row.id).slice(-6) + '）')
    }
    /** ⚠ SQLite 里双引号是**标识符**不是字符串（`LIKE "%always%"` 会报 no such column）—— 一律单引号 */
    d.prepare(`DELETE FROM setting WHERE key LIKE 'bridgeAsk:%' AND value_json LIKE '%always%'`).run()
  } finally {
    d.close()
  }
  startApp('always · 第一次')
  try {
    setSettings({ bridgeAutoInstall: false, autoLaunchAsked: true })
    killFake()
    await sleep(13000)
    console.log('== 1. 第一次发现 → 弹窗 → 答「以后都自动安装」 ==')
    const from1 = logSize()
    startFake(dir)
    let opened = false
    for (let i = 0; i < 30 && !opened; i++) {
      opened = /以后都自动安装/.test(body()) && /暂不/.test(body())
      if (!opened) await sleep(1000)
    }
    check('弹窗真的出现了（三按钮那张）', opened, body().slice(-260))
    shot('r5-always-01-first-ask.png')
    const clicked = ej(`(() => {
      const b = [...document.querySelectorAll('button')].find(x => (x.textContent || '').includes('以后都自动安装'))
      if (!b) return JSON.stringify({ ok: false })
      b.click()
      return JSON.stringify({ ok: true, text: b.textContent.trim().slice(0, 40) })
    })()`)
    console.log('  点了「以后都自动安装」：' + JSON.stringify(clicked))
    let installed = false
    for (let i = 0; i < 30 && !installed; i++) {
      installed = fs.existsSync(bridgePkg(dir))
      if (!installed) await sleep(1000)
    }
    check('桥接真被装进 Packages/（不是只写了库）', installed, dir)
    const first = projectRow(ASK)
    console.log('  工程行：' + JSON.stringify(first))
    const st = db()
    let ans = null
    try {
      ans = st.prepare(`SELECT key, value_json FROM setting WHERE key LIKE 'bridgeAsk:%'`).all()
    } finally {
      st.close()
    }
    console.log('  答案落在 setting：' + JSON.stringify(ans))
    check('答案按这个工程的 id 存了', !!first && ans.some((r) => r.key === 'bridgeAsk:' + first.id && /always/.test(r.value_json)), ans)
    console.log('  这轮日志：' + (await waitLog(/bridge-ask[^\n]*/, 'bridge-ask 那条', 5, 500).catch(() => '（没有）')))

    console.log('== 2. ⭐ 把 A 整个关掉再起来 —— "第二次打开同一工程"要的就是这个 ==')
    stopFake()
    fs.rmSync(bridgePkg(dir), { force: true })
    fs.rmSync(path.join(dir, 'Packages', 'com.avca.bridge'), { recursive: true, force: true })
    console.log('  把桥接删了（模拟用户自己删/换机器同步少了文件）：' + !fs.existsSync(bridgePkg(dir)))
    /**
     * ⚠ 还要把**心跳**一起清掉：上一轮假对端留下的 `bridge.json` 可能还是新鲜的，
     *   那样 A 一启动就当场把桥接装回去了 —— 看着也对，但测的就不是"第二次打开这个工程"，
     *   而是"启动时看到它已经在跑"。清干净，让运行边沿只能由下面那次 startFake 造出来。
     */
    fs.rmSync(path.join(dir, 'Temp', 'AVCABridge'), { recursive: true, force: true })
    console.log('  心跳也清了（Temp/AVCABridge 不存在：' + !fs.existsSync(path.join(dir, 'Temp', 'AVCABridge')) + '）')
    stopApp()
    await sleep(3000)
    const restartAt = Date.now()
    startApp('always · 第二次（新主进程）')
    setSettings({ bridgeAutoInstall: false, autoLaunchAsked: true })
    killFake()
    await sleep(13000)
    const second = projectRow(ASK)
    console.log('  重启后这个工程的行：' + JSON.stringify(second))
    check('重启之后**还是同一行**（按路径命中，不是每次新发一个 id）', !!first && !!second && second.id === first.id, { first: first && first.id, second: second && second.id })
    const from2 = restartAt
    startFake(dir)
    let back = false
    for (let i = 0; i < 40 && !back; i++) {
      back = fs.existsSync(bridgePkg(dir))
      if (!back) await sleep(2000)
    }
    check('没点任何按钮，桥接被自动装回来了', back)
    await sleep(1500)
    check('这次**没有**再弹窗', !/以后都自动安装/.test(body()), body().slice(-240))
    /**
     * 自动装那一步的日志原文是 `[bridge] 已为 <工程> 安装桥接`（`bridge/ipc.ts:323`），
     * 第一版正则里只写了英文 install 与"自动装"，一个都没沾上 → 报了个假故障。
     * 顺带把"本来就装着"那种排除掉：那等于什么都没做。
     */
    const auto = linesSince(from2).filter((l) => /安装桥接|bridge-ask|已安装到/.test(l))
    console.log('  重启之后这一路的日志：')
    for (const l of auto.slice(-8)) console.log('    ' + l.slice(0, 170))
    check('日志里有「开始运行 → auto」那条边沿（答案被按路径读回来了）', auto.some((l) => /开始运行.*→ auto/.test(l)), auto)
    check(
      '并且真的复制了文件（"已安装到 …（N 个文件）"，不是"本来就装着"）',
      auto.some((l) => /已安装到/.test(l) && /个文件/.test(l)) && auto.some((l) => /安装桥接/.test(l) && !/本来就装着/.test(l)),
      auto
    )
    shot('r5-always-02-after-restart.png')
  } finally {
    stopFake()
    stopApp()
  }
}

/** 解析 topmost.ps1 的 sample 输出（`t;visible;minimized;topmost;isFg;fgTitle;hwnd`） */
function parseSamples(out) {
  const rows = []
  for (const l of String(out).split(/\r?\n/)) {
    const p = l.split(';')
    if (p.length < 5) continue
    const t = Number(p[0])
    if (!Number.isFinite(t)) continue
    rows.push({ t, visible: p[1] === 'True', minimized: p[2] === 'True', topmost: p[3] === 'True', isFg: p[4] === 'True', fg: p[5] })
  }
  return rows
}

async function caseWake() {
  console.log('== 前置：造一个工程 + 把 A 设成"关窗收到托盘" ==')
  const dir = ensureProject(WAKE, { withBridge: true })
  /** 5 分钟防打扰的冷却要清掉，否则这一轮什么都不会发生（上一轮跑过就撞上过这个） */
  const dc = db()
  try {
    dc.prepare('UPDATE project SET last_auto_switch_at = NULL').run()
  } finally {
    dc.close()
  }
  startApp('wake')
  try {
    /**
     * ⚠ 行为要设成 `always`，不是 `when_matched`：第一版用 `when_matched` + 一个谁都匹配不上的工程名，
     *   边沿真的亮了（`工程运行状态变化 → 已打开`）、`auto-switch` 也真的判了 `none`，
     *   但**不唤醒** —— 因为 `when_matched` 下"没匹配到集合"就是 `skip`，压根没有要弹的东西。
     *   那不是缺陷，恰恰是"别骚扰"那条设计。要量唤醒得走 `always` 的 `wake-only` 那一支
     *   （`autoSwitch.ts:79`：behavior=always 且没匹配上 → 只把窗口叫醒、不切集合）。
     */
    setSettings({ minimizeToTray: true, autoSwitchBehavior: 'always', autoLaunchAsked: true })
    killFake()
    await sleep(13000)
    const before = parseSamples(ps(['-Action', 'find']))
    console.log('  ' + JSON.stringify(before))
    check('窗口现在是可见的', before.length && before[0].visible, before)

    console.log('== 1. 点 X（WM_CLOSE）→ 应该收进托盘而不是退出 ==')
    console.log('  ' + ps(['-Action', 'close']).trim())
    await sleep(3000)
    const hidden = parseSamples(ps(['-Action', 'find']))
    console.log('  ' + JSON.stringify(hidden))
    check('窗口真的藏起来了（进程还在、visible=false）', hidden.length && !hidden[0].visible, hidden)
    const alive = cp.execFileSync('tasklist', ['/FI', 'IMAGENAME eq Atrium.exe', '/FO', 'CSV', '/NH'], { encoding: 'utf8' })
    check('A 还在跑（关窗没退出）', String(alive).includes('Atrium.exe'), String(alive).trim().slice(0, 90))

    console.log('== 2. 一边采样一边让工程"开起来" → 量置顶的那 1.2 秒 ==')
    const from = logSize()
    const sampler = cp.spawn(
      'powershell',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', TOPMOST_PS, '-Action', 'sample', '-Seconds', '14', '-IntervalMs', '100'],
      { encoding: 'utf8', cwd: HERE }
    )
    let sampleOut = ''
    sampler.stdout.on('data', (b) => {
      sampleOut += String(b)
    })
    await sleep(1200)
    startFake(dir)
    const wakeLine = await waitLog(/已从托盘唤醒主窗口|已识别为|woken/, '唤醒那条日志', 45, 1000)
    console.log('  ⭐ 日志：' + wakeLine.replace(/^\[[^\]]+\]\s*/, ''))
    await new Promise((r) => setTimeout(r, 12000))
    try {
      sampler.kill()
    } catch {
      /* 自然结束 */
    }
    const rows = parseSamples(sampleOut)
    console.log('  采到 ' + rows.length + ' 个样本（每 100ms 一个）')
    const firstVis = rows.find((r) => r.visible)
    const tops = rows.filter((r) => r.topmost)
    const last = rows[rows.length - 1]
    if (rows.length) {
      console.log('  第一个样本 ' + JSON.stringify(rows[0]))
      console.log('  置顶为真的样本 ' + tops.length + ' 个：' + JSON.stringify(tops.slice(0, 3)) + (tops.length > 3 ? '…' : ''))
      console.log('  最后一个样本 ' + JSON.stringify(last))
    }
    check('窗口从托盘里回来了', !!firstVis, rows.slice(0, 4))
    check('置顶确实亮过（至少 1 个样本 WS_EX_TOPMOST=true）', tops.length > 0, tops.length)
    const span = tops.length ? tops[tops.length - 1].t - tops[0].t + 100 : 0
    console.log('  ⭐ 置顶持续约 ' + span + 'ms（规格 Q6 裁的 1200ms，允许 ±400ms 采样抖动）')
    check('置顶时长在 1.2 秒附近', span >= 800 && span <= 1600, span)
    check('置顶自己取消了（最后一个样本 topmost=false，不永远压着 Unity）', !!last && !last.topmost, last)
    check('唤醒那条日志有落（"检测到 Unity 工程启动，已从托盘唤醒主窗口"）', /托盘唤醒/.test(wakeLine), wakeLine)
    const lines = logSince(from).split(/\r?\n/).filter((l) => /window|auto-switch|状态变化/.test(l))
    for (const l of lines.slice(-6)) console.log('    ' + l.replace(/^\[[^\]]+\]\s*/, '').slice(0, 150))
    const fg = rows.filter((r) => r.isFg)
    console.log(
      '  前台归属：唤醒期间 ' + fg.length + '/' + rows.length + ' 个样本 A 自己在前台' +
        (fg.length ? '（第一个在前 ' + fg[0].t + 'ms）' : ' —— 焦点保护没让 focus() 抢到，这条按实测记')
    )
    const fgs = [...new Set(rows.map((r) => r.fg))].slice(0, 4)
    console.log('  期间前台窗口是：' + JSON.stringify(fgs))

    console.log('== 3. 窗口本来就开着 → 第二次边沿**一下都不许置顶**（骚扰那条） ==')
    killFake()
    await sleep(13000)
    const visibleNow = parseSamples(ps(['-Action', 'find']))
    check('前置：窗口现在是可见的', visibleNow.length && visibleNow[0].visible, visibleNow)
    const s2 = cp.spawn(
      'powershell',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', TOPMOST_PS, '-Action', 'sample', '-Seconds', '9', '-IntervalMs', '100'],
      { encoding: 'utf8', cwd: HERE }
    )
    let out2 = ''
    s2.stdout.on('data', (b) => {
      out2 += String(b)
    })
    await sleep(1000)
    startFake(dir)
    await sleep(9000)
    try {
      s2.kill()
    } catch {
      /* 自然结束 */
    }
    const rows2 = parseSamples(out2)
    const tops2 = rows2.filter((r) => r.topmost)
    console.log('  采到 ' + rows2.length + ' 个样本，其中置顶为真 ' + tops2.length + ' 个')
    check('已可见时不闪置顶（0 个 topmost=true 样本）', tops2.length === 0, rows2.slice(0, 5))
    const already = logSince(from).match(/already-visible|本来就开着|不闪置顶/g)
    console.log('  日志里那条 already-visible 的口径：' + JSON.stringify(already || '（没打，只有 DOM 判据）'))
    shot('r5-wake-01-after-woken.png')
  } finally {
    stopFake()
    stopApp()
  }
}

const RUN = { none: caseNone, always: caseAlways, wake: caseWake }
if (!RUN[CASE]) {
  console.error('--case 只认 none / always / wake，给了：' + CASE)
  process.exit(2)
}
if (!fs.existsSync(DB)) {
  console.error(`沙盒库不存在：${DB}（先在 m5b 沙盒起过一次 A 吗）`)
  process.exit(2)
}
if (!fs.existsSync(path.join(TEMPLATE, 'package.json'))) {
  console.error('桥接模板不在：' + TEMPLATE)
  process.exit(2)
}
;(async () => {
  try {
    if (cp.execFileSync('tasklist', ['/FI', 'IMAGENAME eq Unity.exe', '/FO', 'CSV', '/NH'], { encoding: 'utf8' }).includes('Unity.exe')) {
      console.error('⛔ 他的 Unity 正在跑 —— 沙盒实例会发现真工程，先让他关掉（docs/BRIDGE.md §13.4）')
      process.exit(2)
    }
  } catch {
    /* tasklist 失败不该拦住，下面还有 CDP 与路径防呆 */
  }
  const t0 = Date.now()
  await RUN[CASE]()
  const bad = checks.filter((c) => !c.ok)
  console.log('\n=== ' + CASE + '：' + (checks.length - bad.length) + '/' + checks.length + ' 条判据通过（' + Math.round((Date.now() - t0) / 1000) + ' 秒）===')
  for (const b of bad) console.log('  ❌ ' + b.name)
  console.log('截图与日志在 ' + ROOT + '；A 与假对端都已关掉。')
  process.exit(bad.length ? 1 : 0)
})().catch((e) => {
  console.error('\nFAILED: ' + (e && e.message ? e.message : e))
  try {
    stopFake()
    shot('r5-' + CASE + '-99-fail.png')
  } catch {
    /* 已经无所谓了 */
  }
  stopApp()
  process.exit(1)
})
