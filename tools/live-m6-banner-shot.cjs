/**
 * M6 ⑦ 活体辅助：把横幅/决策那 10 秒抓成截图 + 日志证据。
 *
 * 为什么要脚本而不是手点：横幅按规格 10 秒自动淡出，而每次 CDP 往返就要 1–2 秒，
 * 人肉"触发 → 截图"每次都踩在窗口外面（实测连错两次，误以为横幅没画）。
 *
 * 三个用例（`--case=`）走同一条骨架：
 *   杀掉假 Unity → 等 A 判成"已关闭"（心跳 10 秒过期 + 3 秒轮询）→ 按需清冷却 →
 *   重新起假 Unity（边沿出现）→ 轮询 DOM 直到目标文字出现 → 截图。
 *
 *  - `switch`    唯一命中 → 横幅「已识别为 …，自动打开 …」。
 *  - `ambiguous` Q1 平手留痕：临时往沙盒库塞一个同关键词同优先级的集合，横幅要写出候选名单，
 *                截完自动删掉那行（不留脏数据，出错也要删）。
 *  - `cooldown`  5 分钟防打扰：故意**不**清冷却，横幅不该出现，判据改从 main.log 那行
 *                `skip —— cooldown` 拿（截图照样拍，用来证明"页面上确实没有横幅"）。
 *
 * ⚠ 只碰沙盒（`AVCA_LIVE_ROOT` 下那个库），路径不对直接拒绝。
 * ⚠ **跑之前先确认他的 Unity 没开着**：沙盒实例照样会发现真工程（清单来自 VCC manifest，
 *   只读探测），而对"运行中的工程"它要发一条 `list_project_assets` —— 那就落到
 *   `E:\ALCOMprojects\…\Temp\AVCABridge\` 里去了（终态会被读走删掉，但已经不是沙盒）。
 *   2026-10-06 19:06 就撞过一次，经过与后果见 `docs/BRIDGE.md` §13.4。
 * 用法：node tools/live-m6-banner-shot.cjs [输出png] [--case=switch|ambiguous|cooldown]
 */
const fs = require('node:fs')
const path = require('node:path')
const cp = require('node:child_process')
const { DatabaseSync } = require('node:sqlite')

const ROOT = process.env.AVCA_LIVE_ROOT || 'D:\\avca-m5b-live'
if (!/avca-m5b-live|avca-live|sandbox/i.test(ROOT)) {
  console.error(`拒绝：沙盒根目录名不对（${ROOT}）`)
  process.exit(1)
}
const DB = path.join(ROOT, 'AppData', 'Roaming', 'A', 'library.db')
const LOG = path.join(ROOT, 'AppData', 'Roaming', 'A', 'logs', 'main.log')
const PROJ = path.join(ROOT, 'projects', 'Shinano-LiveTest')
const FAKE = path.resolve(__dirname, 'fake-unity-live.cjs')
const OUT = process.argv[2] || path.join(ROOT, 'm6-banner.png')
const CASE = (process.argv.find((a) => a.startsWith('--case=')) || '--case=switch').split('=')[1]
/**
 * CDP 端口。`cdp-eval/cdp-shot` 默认 9222，而沙盒活体起在 9224 ——
 * 忘了带环境变量就会拿一整轮 40 秒去撞 "fetch failed"（18:34 那轮白跑一次），
 * 所以这里把端口写死成默认值并**显式传给子进程**。
 */
const PORT = process.env.AVCA_CDP_PORT || '9224'
const ENV = { ...process.env, AVCA_CDP_PORT: PORT }

/** 轮询要等的横幅文字。cooldown 等的是永不相等的模式（那一支的判据在日志里） */
const WATCH = {
  switch: /已识别为/,
  ambiguous: /同时命中/,
  cooldown: /__no-banner-expected__/
}
const WAIT_MS = { switch: 40000, ambiguous: 40000, cooldown: 20000 }

/** 平手用例临时塞的集合：固定 id + 带标记的名字，好认也好删 */
const DUP_ID = 'M6LIVEAMBIG000000000001'
const DUP_NAME = 'M6-live-平手用例（临时）'

function sh(cmd, args) {
  return cp.execFileSync(cmd, args, { encoding: 'utf8', env: ENV })
}

function evalInPage(expr) {
  return sh(process.execPath, [path.resolve(__dirname, 'cdp-eval.cjs'), expr])
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function openDb() {
  const db = new DatabaseSync(DB)
  db.exec('PRAGMA busy_timeout = 5000')
  return db
}

function killFakeUnity() {
  try {
    sh('powershell', [
      '-ExecutionPolicy', 'Bypass', '-Command',
      "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { $_.CommandLine -like '*fake-unity-live*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"
    ])
  } catch (e) {
    console.log('（没找到在跑的假 Unity：' + (e.message || '').slice(0, 60) + '）')
  }
}

/** 平手用例：加一个和 Shinano 同关键词、同优先级的集合，让仲裁真的走到平手 */
function addAmbiguousCollection() {
  const db = openDb()
  try {
    const src = db.prepare("SELECT priority FROM collection WHERE name='Shinano'").get()
    if (!src) {
      console.error('沙盒库里没有 Shinano 集合 —— 先跑补建（④）再来')
      process.exit(1)
    }
    db.prepare('DELETE FROM collection WHERE id = ?').run(DUP_ID)
    db.prepare(
      'INSERT INTO collection (id, name, icon, sort_order, rule_json, is_auto, priority) VALUES (?, ?, NULL, 900, ?, 1, ?)'
    ).run(DUP_ID, DUP_NAME, JSON.stringify({ keywords: ['Shinano'], matchMode: 'any', priority: src.priority }), src.priority)
    console.log('已塞入平手用的临时集合')
  } finally {
    db.close()
  }
}

function removeAmbiguousCollection() {
  const db = openDb()
  try {
    const r = db.prepare('DELETE FROM collection WHERE id = ?').run(DUP_ID)
    console.log(`临时集合已删除（${Number(r.changes)} 行）`)
  } finally {
    db.close()
  }
}

/**
 * 这轮之后新增的日志。
 * ⚠ 偏移量一律按**字节**算（文件大小），所以读回来也要先拿 Buffer 再切：
 *  日志里有中文，`readFileSync(…, 'utf8').slice(字节数)` 是**字符**下标，会直接切过头返回空串
 *  （第一版就这么把已经生效的 cooldown 判成"没验证成"）。切完把可能被截断的第一行丢掉。
 */
function logSince(sinceByte) {
  if (!fs.existsSync(LOG)) return ''
  const lines = Buffer.from(fs.readFileSync(LOG)).slice(sinceByte).toString('utf8').split(/\r?\n/)
  /** 恰好落在行首时不能把第一条真日志当残行丢掉 */
  if (lines.length && lines[0] && !lines[0].startsWith('[')) lines.shift()
  return lines.join('\n')
}

/** 决策日志里那几行：截图看不到的那一半（凭什么切的 / 为什么没切）落在字面上 */
function tailDecisions(sinceByte) {
  if (!fs.existsSync(LOG)) return '（没有 main.log）'
  const lines = logSince(sinceByte).split(/\r?\n/).filter((l) => /auto-switch|\[fingerprint\]|状态变化/.test(l))
  return lines.length ? lines.join('\n') : '（这轮没有新决策日志）'
}

async function main() {
  if (!WATCH[CASE]) {
    console.error(`未知用例 ${CASE}（可选 switch / ambiguous / cooldown）`)
    process.exit(1)
  }
  const logMark = fs.existsSync(LOG) ? fs.statSync(LOG).size : 0

  killFakeUnity()
  console.log('等 A 判定"已关闭"…')
  await sleep(14000)

  if (CASE === 'ambiguous') addAmbiguousCollection()

  const db = openDb()
  if (CASE === 'cooldown') {
    const row = db.prepare('SELECT last_auto_switch_at FROM project WHERE name=?').get('Shinano-LiveTest')
    const ageS = row && row.last_auto_switch_at !== null ? Math.round((Date.now() - Number(row.last_auto_switch_at)) / 1000) : null
    console.log(`冷却用例：保留时间戳不清（上次真切换距今 ${ageS === null ? '从没切过' : ageS + 's'}）`)
    /** 时间戳过期或为空都测不出冷却，直接停手，别拿"没弹横幅"冒充验证通过 */
    if (ageS === null || ageS > 280) {
      console.error('⚠ 上次切换太久了（或从没切过）—— 这轮测不出冷却。先跑一次 --case=switch')
      db.close()
      if (CASE === 'ambiguous') removeAmbiguousCollection()
      process.exit(2)
    }
  } else {
    db.prepare('UPDATE project SET last_auto_switch_at = NULL').run()
    console.log('冷却已清')
  }
  db.close()

  /** detached：脚本退出后它还得活着继续写心跳 */
  const child = cp.spawn(process.execPath, [FAKE, PROJ], { detached: true, stdio: 'ignore' })
  child.unref()
  console.log(`假 Unity 已重启，用例=${CASE}，盯页面…`)

  const re = WATCH[CASE]
  const deadline = Date.now() + WAIT_MS[CASE]
  let hit = false
  while (Date.now() < deadline && !hit) {
    await sleep(400)
    try {
      const r = evalInPage(`(() => ${re.toString()}.test(document.body.innerText) ? 'YES' : 'no')()`)
      if (r.includes('YES')) {
        hit = true
        sh(process.execPath, [path.resolve(__dirname, 'cdp-shot.cjs'), OUT])
        console.log('抓到了 → ' + OUT)
      }
    } catch {
      /* CDP 偶尔会断一下，下一轮再看 */
    }
  }

  if (CASE === 'cooldown') {
    /** 这一支"页面上没有横幅"才通过：判据 = 日志里那行 cooldown */
    const body = logSince(logMark)
    const ok = !hit && /cooldown/.test(body)
    sh(process.execPath, [path.resolve(__dirname, 'cdp-shot.cjs'), OUT])
    console.log((ok ? '冷却生效：横幅没出现（截图 ' + OUT + '），日志里有 skip —— cooldown' : '⚠ 这条没验证成：' + (hit ? '横幅居然出现了' : '日志里没看到 cooldown')))
    if (!ok) process.exitCode = 1
  } else if (!hit) {
    console.log(`没等到横幅文字（${Math.round(WAIT_MS[CASE] / 1000)} 秒）—— 这就是真问题，不是截图时机`)
    process.exitCode = 1
  }

  if (CASE === 'ambiguous') removeAmbiguousCollection()
  console.log('--- 本轮决策日志 ---\n' + tailDecisions(logMark))
}

main().catch((e) => {
  if (CASE === 'ambiguous') {
    try {
      removeAmbiguousCollection()
    } catch {
      /* 尽力清理，失败也别盖住真正的报错 */
    }
  }
  console.error('FAILED: ' + (e && e.message ? e.message : e))
  process.exit(1)
})
