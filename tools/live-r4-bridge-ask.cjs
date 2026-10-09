#!/usr/bin/env node
/**
 * R4 ⑦ 活体：第一次发现一个新工程，到底会不会弹那个三按钮窗。
 *
 * ## 为什么单测不够、必须真跑一次
 * 判据和接线都有用例了（`tests/shared/bridge-ask.spec.ts` + `tests/project/bridge-ask-wiring.spec.ts`），
 * 但 ⑦ 最容易出的事故在**时序**上：主进程第一轮工程发现是同步跑完的，
 * 那时窗口和渲染层的 `on('project:first-seen')` 都还不存在。
 * 队列 + boot 时 drain 这条路只有真起一个实例才验得出来 —— 所以这个脚本
 * 起来之前会**先把沙盒库和 settings 清空**，让那两个工程真的算"第一次被发现"。
 *
 * ## 四步（要两个进程：先 --prep，再手动起 dev，然后 stage 1→4）
 *   node tools/live-r4-bridge-ask.cjs --prep
 *   AVCA_APP_HOME=D:\avca-ask-live\AppData\Roaming\A LOCALAPPDATA=D:\avca-ask-live\AppData\Local \
 *     node tools/dev.cjs --remote-debugging-port=9226
 *   node tools/live-r4-bridge-ask.cjs --stage=1   # 弹窗出现（队列里第一条）→ 点「以后都自动安装」
 *   node tools/live-r4-bridge-ask.cjs --stage=2   # 第二条接着问 → 点「暂不」
 *   node tools/live-r4-bridge-ask.cjs --stage=3   # 删掉 A 的桥接 + 假心跳 → 运行时静默重装
 *   node tools/live-r4-bridge-ask.cjs --stage=4   # B 答过暂不 → 开着也不装、也不问
 *
 * ⚠ 只碰 `D:\avca-ask-live`；路径不对直接拒绝。
 * ⚠ 起实例前先确认他的 Unity 没开着（沙盒照样会发现工程并做只读探测）。
 *   本脚本额外把 `LOCALAPPDATA` 指到沙盒，让 A 看到的 VCC 清单**只有**这两个假工程 ——
 *   不再顺手把他 8 个真工程登记进沙盒库。
 */
const fs = require('node:fs')
const path = require('node:path')
const cp = require('node:child_process')
const { DatabaseSync } = require('node:sqlite')

const ROOT = process.env.AVCA_LIVE_ROOT || 'D:\\avca-ask-live'
if (!/(avca-.*-live|sandbox)$/i.test(ROOT)) {
  console.error(`拒绝：沙盒根目录名不对（${ROOT}）`)
  process.exit(1)
}
const APP = path.join(ROOT, 'AppData', 'Roaming', 'A')
const LOCAL = path.join(ROOT, 'AppData', 'Local')
const DB = path.join(APP, 'library.db')
const LOG = path.join(APP, 'logs', 'main.log')
const SETTINGS = path.join(APP, 'settings.json')
const PROJ_ROOT = path.join(ROOT, 'projects')
const A = path.join(PROJ_ROOT, 'R4-AskA')
const B = path.join(PROJ_ROOT, 'R4-AskB')
for (const p of [A, B]) {
  if (!/[\\/]R4-Ask[AB]$/.test(p)) {
    console.error('拒绝：工程目录必须是沙盒下的 R4-AskA / R4-AskB')
    process.exit(1)
  }
}
const PORT = process.env.AVCA_CDP_PORT || '9226'
const ENV = { ...process.env, AVCA_CDP_PORT: PORT }
const HERE = path.resolve(__dirname, '..')
const STAGE = (process.argv.find((a) => /^--stage=/.test(a)) || '').split('=')[1]
const PREP = process.argv.includes('--prep')

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let failures = 0
function check(what, ok, detail) {
  console.log(`  ${ok ? '✅' : '❌'} ${what}${detail === undefined ? '' : '：' + JSON.stringify(detail)}`)
  if (!ok) failures++
  return ok
}
function sh(cmd, args) {
  return cp.execFileSync(cmd, args, { encoding: 'utf8', env: ENV })
}
const evalInPage = (expr) => sh(process.execPath, [path.resolve(HERE, 'tools/cdp-eval.cjs'), expr])
const shot = (out) => sh(process.execPath, [path.resolve(HERE, 'tools/cdp-shot.cjs'), out])
/**
 * 把 JS **语句**包成 IIFE 丢进页面跑，再把 cdp-eval 打出来的 JSON 读回来。
 *
 * 两个坑都在这仓库踩过：
 *  - 直接写 `return ...` 会 "Illegal return statement"（cdp-eval 按表达式求值）；
 *  - cdp-eval 对非字符串结果打的是 `JSON.stringify(v, null, 2)` ——
 *    **不 parse 的话拿回来是一整段文本**，`d.open` 永远是 undefined，
 *    活体会把"弹窗明明在屏幕上"判成"没弹"（这一版第一次跑就踩中了）。
 */
function ej(body) {
  const raw = evalInPage(`(() => {${body}})()`)
  try {
    return JSON.parse(raw)
  } catch {
    return raw
  }
}

function bridgePkg(dir) {
  return path.join(dir, 'Packages', 'com.avca.bridge', 'package.json')
}
function makeProject(dir, version) {
  fs.mkdirSync(path.join(dir, 'ProjectSettings'), { recursive: true })
  fs.mkdirSync(path.join(dir, 'Assets'), { recursive: true })
  fs.writeFileSync(
    path.join(dir, 'ProjectSettings', 'ProjectVersion.txt'),
    'm_EditorVersion: ' + version + '\n',
    'utf8'
  )
}
/** 假心跳：让三路探测里的"桥接"这一路认它在运行（不需要真 Unity） */
function writeHeartbeat(dir, name) {
  const box = path.join(dir, 'Temp', 'AVCABridge')
  fs.mkdirSync(box, { recursive: true })
  fs.writeFileSync(
    path.join(box, 'bridge.json'),
    JSON.stringify({
      protocolVersion: 1,
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
/** 心跳是有时效的（10 秒），等的时候得续期，否则探测会翻回"已关闭" */
function keepAlive(dirs) {
  const t = setInterval(() => {
    for (const [d, n] of dirs) {
      try {
        writeHeartbeat(d, n)
      } catch {
        /* 目录被删了就算了 */
      }
    }
  }, 4000)
  return () => clearInterval(t)
}

function db() {
  const h = new DatabaseSync(DB, { readOnly: true })
  h.exec('PRAGMA busy_timeout = 5000')
  return h
}
function projectRow(name) {
  const h = db()
  try {
    return h.prepare(`SELECT id, path, is_running FROM project WHERE name = ?`).get(name)
  } finally {
    h.close()
  }
}
function askAnswer(name) {
  const row = projectRow(name)
  if (!row) return { row: null, answer: '__没有这行工程__' }
  const h = db()
  try {
    const s = h.prepare(`SELECT value_json FROM setting WHERE key = ?`).get('bridgeAsk:' + row.id)
    return { row, answer: s ? JSON.parse(s.value_json) : null }
  } finally {
    h.close()
  }
}

/** 页面上有没有那个三按钮窗，以及它在问哪个工程 */
function dialog() {
  return ej(`
    const el = document.querySelector('[role="dialog"]')
    if (!el) return { open: false, text: '' }
    const text = el.innerText.replace(/\\s+/g, ' ').slice(0, 500)
    /** 认"这三个按钮都在"才算 ⑦ 的窗：别的确认窗（改分类/选成员）也是 role=dialog */
    return { open: /以后都自动安装/.test(text) && /暂不/.test(text), text }
  `)
}
function clickButton(label) {
  return ej(`
    const want = ${JSON.stringify(label)}
    const btns = Array.from(document.querySelectorAll('button'))
    let best = null
    for (const b of btns) {
      const s = (b.innerText || '').trim()
      if (s === want || (s.includes(want) && (!best || s.length < (best.innerText || '').length))) best = b
    }
    if (!best) return { ok: false, have: btns.map((b) => (b.innerText || '').trim()).filter(Boolean).slice(0, 12) }
    best.click()
    return { ok: true, clicked: (best.innerText || '').trim() }
  `)
}
function logTail(pattern) {
  if (!fs.existsSync(LOG)) return null
  const lines = fs.readFileSync(LOG, 'utf8').split(/\r?\n/)
  for (let i = lines.length - 1; i >= 0; i--) if (pattern.test(lines[i])) return lines[i]
  return null
}

// ---------------------------------------------------------------- prep

if (PREP) {
  console.log('清理并重建沙盒：' + ROOT)
  try {
    sh('powershell', [
      '-ExecutionPolicy',
      'Bypass',
      '-Command',
      "Get-CimInstance Win32_Process -Filter \"Name='electron.exe'\" | Where-Object { $_.CommandLine -like '*avca-ask-live*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"
    ])
  } catch {
    /* 没在跑 */
  }
  for (const p of [APP, LOCAL, PROJ_ROOT, path.join(ROOT, 'library')]) fs.mkdirSync(p, { recursive: true })
  /** 库和 settings 全清：不清的话这两个工程就不是"第一次发现"，⑦ 根本不该弹 */
  for (const f of ['library.db', 'library.db-wal', 'library.db-shm', 'settings.json', 'inbox.json']) {
    const p = path.join(APP, f)
    if (fs.existsSync(p)) fs.rmSync(p)
  }
  for (const d of [A, B]) if (fs.existsSync(d)) fs.rmSync(d, { recursive: true, force: true })
  makeProject(A, '2022.3.22f1')
  makeProject(B, '2022.3.22f1')

  fs.writeFileSync(
    SETTINGS,
    JSON.stringify(
      {
        language: 'zh-CN',
        theme: 'dark',
        libraryRoot: path.join(ROOT, 'library'),
        /** 缓存/备份绝不落 C: —— 这里全指到沙盒 */
        extractRoot: path.join(ROOT, '_extracted'),
        staging: path.join(ROOT, '_staging'),
        projectRoots: [],
        /** 这一轮故意不开全局自动装：让"弹窗"先发生，自动装靠答「以后都自动安装」触发 */
        bridgeAutoInstall: false,
        autoSwitchBehavior: 'never',
        autoLaunchAsked: true,
        minimizeToTray: false
      },
      null,
      2
    ),
    'utf8'
  )
  /** ALCOM/VCC 清单也重定向到沙盒：只列这两个假工程 */
  const vcc = path.join(LOCAL, 'VRChatCreatorCompanion')
  fs.mkdirSync(vcc, { recursive: true })
  fs.writeFileSync(path.join(vcc, 'settings.json'), JSON.stringify({ userProjects: [A, B], defaultProjectPath: A }, null, 2), 'utf8')

  console.log('夹具就绪：')
  console.log('  AVCA_APP_HOME=' + APP)
  console.log('  LOCALAPPDATA=' + LOCAL)
  console.log('  工程：' + A + ' / ' + B)
  console.log('  A 的桥接已装？' + fs.existsSync(bridgePkg(A)) + ' · B 的桥接已装？' + fs.existsSync(bridgePkg(B)))
  console.log('\n起实例：node tools/dev.cjs --remote-debugging-port=' + PORT + '（带上面两个环境变量）')
  process.exit(0)
}

// ---------------------------------------------------------------- stages

async function main() {
  if (!fs.existsSync(DB)) {
    console.error('沙盒库里没有 library.db —— 实例起了吗？先跑 --prep 再起 dev')
    process.exit(1)
  }
  const out = (n) => path.join(ROOT, 'ask-' + n + '.png')

  if (STAGE === '1') {
    console.log('stage 1 · 第一次发现要弹窗（而且这一条是主进程**攒下来等界面来取**的）')
    let d = null
    for (let i = 0; i < 40; i++) {
      d = dialog()
      if (d.open) break
      await sleep(1000)
    }
    check('三按钮窗出现', !!d.open, d.text)
    check('窗里写清了"只对这个工程"和两个开关的位置', /以后都自动安装/.test(d.text) && /设置 → Unity/.test(d.text))
    /** 「另外还有」只出现在**第一条**上：那时队里还压着第二条。答完第一条之后再查就查不到了 */
    check('界面写清了"另外还有 1 个要问"', /另外还有/.test(d.text), /另外还有[^。]*。/.exec(d.text)?.[0])
    const asked = /R4-AskA/.test(d.text) ? 'R4-AskA' : /R4-AskB/.test(d.text) ? 'R4-AskB' : null
    check('问的是沙盒那两个假工程之一', !!asked, asked)
    shot(out('1-dialog'))
    if (!asked) {
      console.log('❌ 不知道在问哪个工程，停下来')
      process.exit(1)
    }
    const other = asked === 'R4-AskA' ? 'R4-AskB' : 'R4-AskA'
    const click = clickButton('以后都自动安装')
    check('点了「以后都自动安装（只这个工程）」', click.ok, click)
    /** 自动装完：文件真的落进 Packages/，且**不是** Assets/ */
    let installed = false
    for (let i = 0; i < 30; i++) {
      installed = fs.existsSync(bridgePkg(path.join(PROJ_ROOT, asked)))
      if (installed) break
      await sleep(1000)
    }
    check(`${asked} 的桥接真的装上了`, installed, bridgePkg(path.join(PROJ_ROOT, asked)))
    check(
      '只往 Packages/ 写，Assets/ 一个字节没动',
      fs.readdirSync(path.join(PROJ_ROOT, asked, 'Assets')).length === 0,
      fs.readdirSync(path.join(PROJ_ROOT, asked, 'Assets'))
    )
    const a1 = askAnswer(asked)
    check('答案真的写进了 setting（bridgeAsk:<id>）', a1.answer === 'always', a1.answer)
    /** 队列：第二条要接着问，而且要说清"还有一个" */
    let d2 = null
    for (let i = 0; i < 30; i++) {
      d2 = dialog()
      if (d2.open && new RegExp(other).test(d2.text)) break
      await sleep(1000)
    }
    check(`第一条答完，第二条（${other}）接着问`, !!d2.open && new RegExp(other).test(d2.text), d2.text)
    check('队里只剩这一条时不再写"另外还有"', !/另外还有/.test(d2.text), d2.text.slice(0, 60))
    shot(out('1b-second'))
    fs.writeFileSync(path.join(ROOT, 'ask-who.json'), JSON.stringify({ first: asked, second: other }, null, 2), 'utf8')
  }

  if (STAGE === '2') {
    console.log('stage 2 · 第二条点「暂不」')
    const who = JSON.parse(fs.readFileSync(path.join(ROOT, 'ask-who.json'), 'utf8'))
    const d = dialog()
    check('还在问第二个工程', d.open && new RegExp(who.second).test(d.text), d.text)
    const click = clickButton('暂不')
    check('点了「暂不」', click.ok, click)
    let gone = false
    for (let i = 0; i < 20; i++) {
      gone = !dialog().open
      if (gone) break
      await sleep(1000)
    }
    check('答完就没有再弹第三个', gone)
    const a2 = askAnswer(who.second)
    check('「暂不」真的落库了', a2.answer === 'never', a2.answer)
    check(
      `${who.second} 一个桥接文件都没装（答了暂不就不该动盘）`,
      !fs.existsSync(path.join(PROJ_ROOT, who.second, 'Packages', 'com.avca.bridge')),
      fs.existsSync(path.join(PROJ_ROOT, who.second, 'Packages'))
        ? fs.readdirSync(path.join(PROJ_ROOT, who.second, 'Packages'))
        : '没有 Packages 目录'
    )
    shot(out('2-after-never'))
  }

  if (STAGE === '3') {
    console.log('stage 3 · 答过「以后都自动安装」的工程，Unity 一开就静默重装')
    const who = JSON.parse(fs.readFileSync(path.join(ROOT, 'ask-who.json'), 'utf8'))
    const dir = path.join(PROJ_ROOT, who.first)
    /** 模拟"桥接不见了"（用户自己删了 / 换了台机器同步过来少了文件） */
    fs.rmSync(path.join(dir, 'Packages', 'com.avca.bridge'), { recursive: true, force: true })
    check('前置：先把它的桥接删掉', !fs.existsSync(bridgePkg(dir)))
    const stop = keepAlive([[dir, who.first]])
    try {
      writeHeartbeat(dir, who.first)
      let back = false
      for (let i = 0; i < 40; i++) {
        back = fs.existsSync(bridgePkg(dir))
        if (back) break
        await sleep(2000)
      }
      const row = projectRow(who.first)
      check('探测认出它在运行', !!row && row.is_running === 1, row && { is_running: row.is_running })
      check('桥接被**自动**装回来了（没人点过按钮）', back)
      const line = logTail(/开始运行.*auto|bridge-ask.*auto/)
      check('日志里有那条自动装的边沿记录', !!line, line)
      const d = dialog()
      check('自动装这条路不出弹窗', !d.open, d.text)
      shot(out('3-auto-reinstall'))
    } finally {
      stop()
      try {
        fs.rmSync(path.join(dir, 'Temp', 'AVCABridge'), { recursive: true, force: true })
      } catch {
        /* 留着也无妨 */
      }
    }
  }

  if (STAGE === '4') {
    console.log('stage 4 · 答过「暂不」的工程：开着也不装、也不再问')
    const who = JSON.parse(fs.readFileSync(path.join(ROOT, 'ask-who.json'), 'utf8'))
    const dir = path.join(PROJ_ROOT, who.second)
    const stop = keepAlive([[dir, who.second]])
    try {
      writeHeartbeat(dir, who.second)
      let seen = null
      for (let i = 0; i < 15; i++) {
        seen = projectRow(who.second)
        if (seen && seen.is_running === 1) break
        await sleep(2000)
      }
      check('探测认出了它在运行（不然这一步等于没测）', !!seen && seen.is_running === 1, seen)
      check(
        '没有偷偷给它装桥接',
        !fs.existsSync(path.join(dir, 'Packages', 'com.avca.bridge')),
        fs.existsSync(path.join(dir, 'Packages')) ? fs.readdirSync(path.join(dir, 'Packages')) : '无 Packages'
      )
      check('也没有再弹窗', !dialog().open, dialog().text)
      shot(out('4-never-stays-quiet'))
    } finally {
      stop()
      try {
        fs.rmSync(path.join(dir, 'Temp', 'AVCABridge'), { recursive: true, force: true })
      } catch {
        /* 同上 */
      }
    }
  }

  if (STAGE === '5') {
    console.log('stage 5 · 还没答就把界面整页刷新：弹窗必须回来（队列不是"看过就没"）')
    const before = dialog()
    check('前置：弹窗在屏幕上', before.open, before.text.slice(0, 60))
    const who = /R4-AskA/.test(before.text) ? 'R4-AskA' : /R4-AskB/.test(before.text) ? 'R4-AskB' : null
    evalInPage('location.reload(); "reloading"')
    let after = null
    for (let i = 0; i < 45; i++) {
      await sleep(1000)
      try {
        after = dialog()
      } catch {
        after = null
      }
      if (after && after.open) break
    }
    check('刷新之后又问了同一个工程', !!after && after.open && new RegExp(String(who)).test(after.text), after && after.text.slice(0, 60))
    shot(out('5-after-reload'))
  }

  if (!STAGE) {
    console.error('给个 --stage=1..4')
    process.exit(2)
  }
  console.log(failures ? `\n❌ ${failures} 条没过` : '\n✅ 这一轮全过')
  process.exit(failures ? 1 : 0)
}

void main()
