#!/usr/bin/env node
/**
 * M7 · 第 7 轮 ⑧ —— **打包版**真机首启六条（`docs/M7-DESIGN.md` §6.2）。
 *
 * ## 为什么单独一个驱动，不复用 ③④⑤ 那几次 CDP 手点
 *
 * 那三次跑的是 dev 版（`npm run dev`），而"dev 全绿不等于打包版能用"这个项目已经吃过四次亏：
 * asar 路径、worker 依赖、i18n 走 extraResources、`.node` 用 unpacked 那一份 —— 每一样都能
 * 让某条路在打包版里静默换一种坏法。所以这里**只起 `dist\win-unpacked\Atrium.exe`**，
 * 并且起之前硬查一遍 asar 是不是比源码新（旧包测出来的绿毫无意义）。
 *
 * ## 六个 stage（顺序有讲究，别乱序跑）
 *
 *   launch    §6.2 1/2/3/4 前半：空 APP_HOME 第一次打开落在第 ① 步 → 指到"已有素材"的树出二选一、
 *             点接管之后**整棵树 md5 一字不变** → 第 ③ 步三个工程默认全勾、勾掉一个之后
 *             **只有勾上的那两个**长出 `Packages/`、`Assets/` 不动 → 第 ④ 步走完重启**不再出现向导**。
 *   password  §6.2 5：真造一个 `-mhe`（头部也加密）的 7z，走命令行 `--ingest` 这条路进来 →
 *             界面要密码 → 勾「记住这个密码」→ 提交 → **杀掉进程再起** → 同一个包**不再问**；
 *             然后把 `password_vault` 那行删掉 → 再起 → **必须重新问**（证明"记住"真的是数据而不是运气）。
 *   skip      §6.2 4 后半：清空沙盒运行目录 → 起 → 点「稍后配置」→ 进主界面但侧栏那条入口还在 →
 *             重启 → 仍然不拦，入口仍在。
 *   asks      §6.2 6：8 个假工程（他真机第一轮就是 8 个）→ 全新安装走完向导但跳过第 ③ 步 →
 *             8 条待答一次排队：逐条 + 「剩下 N 个都不再问」→ 库里**恰好 8 行** per-project never、
 *             没有任何"全局静音"键 → 重启之后一条都不弹。
 *
 *   node tools/live-m7-packaged.cjs --stage=launch
 *   node tools/live-m7-packaged.cjs --stage=password
 *   node tools/live-m7-packaged.cjs --stage=skip
 *   node tools/live-m7-packaged.cjs --stage=asks
 *   node tools/live-m7-packaged.cjs --all
 *
 * 可选：`AVCA_LIVE_ROOT`（默认 `D:\avca-m7-live`）/ `AVCA_CDP_PORT`（默认 **9241**，9222 会被 adb.exe 占）
 *      / `AVCA_SHOT_DIR`（默认 `docs/screenshots`）
 *
 * ## 红线（这个文件里每一道都是本轮真撞过之后加的）
 *
 * 1. 沙盒根目录名里没有 `avca`/`m7`/`sandbox` 就**拒绝启动**（打包版不走 `tools/dev.cjs`，
 *    那道护栏管不到 exe —— 所以这里自己再设一道，`AVCA_APP_HOME` 与 `LOCALAPPDATA` 都要过）。
 * 2. 起实例之前先确认**没有真 Unity 编辑器**开着工程（命令行里带 `-projectPath` 的那些）。
 *    Unity Hub 与它自带的 `unity.exe serve` 不算（不带 `-projectPath`）。
 * 3. 只写沙盒：`AVCA_APP_HOME` + `LOCALAPPDATA` 双重定向之后，`%APPDATA%\A\library.db`、
 *    `E:\vrc\A`、`E:\ALCOMprojects` 一律**一个字节都不写**（本脚本连读都不读它们的内容，
 *    只在开头核对"存在 + 大小没变"）。
 * 4. 判据一律打在**会红的断言**上，只打印数字不算核对（第 4 轮记过这条）。
 */
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const cp = require('node:child_process')
const crypto = require('node:crypto')
const { DatabaseSync } = require('node:sqlite')

const HERE = path.resolve(__dirname, '..')
const ROOT = process.env.AVCA_LIVE_ROOT || 'D:\\avca-m7-live'
const APP_HOME = path.join(ROOT, 'AppData')
const LOCAL = path.join(ROOT, 'LocalAppData')
const DB = path.join(APP_HOME, 'library.db')
const SETTINGS = path.join(APP_HOME, 'settings.json')
const LOG = path.join(APP_HOME, 'logs', 'main.log')
const PROJ_ROOT = path.join(ROOT, 'projects')
const OLDLIB = path.join(ROOT, 'oldlib')
const NEWLIB = path.join(ROOT, 'newlib')
const PWDIR = path.join(ROOT, 'pw')
const PWFIX = path.join(PWDIR, 'secret-pack')
const PWARCHIVE = path.join(PWDIR, 'secret-pack.7z')
const PORT = process.env.AVCA_CDP_PORT || '9241'
const EXE = process.env.AVCA_APP_EXE || path.join(HERE, 'dist', 'win-unpacked', 'Atrium.exe')
const ASAR = path.join(HERE, 'dist', 'win-unpacked', 'resources', 'app.asar')
const SHOT_DIR = process.env.AVCA_SHOT_DIR || path.join(HERE, 'docs', 'screenshots')
const SEVENZ = path.join(EXE.replace(/Atrium\.exe$/, ''), 'resources', 'bin', '7z.exe')
const PASSWORD = 'M7-live-42-测试'

const argv = process.argv.slice(2)
const stageOf = (d) => {
  const a = argv.find((x) => x.startsWith('--stage='))
  return a ? a.split('=')[1] : d
}
const ALL = argv.includes('--all')
const STAGE = stageOf(ALL ? 'all' : 'launch')

/* ---------------------------------------------------------------- 红线闸门 */

function die(msg) {
  console.error('⛔ ' + msg)
  process.exit(1)
}
const SANDBOXISH = /avca|m7|sandbox/i
if (!SANDBOXISH.test(ROOT)) die('沙盒根路径里没有 avca/m7/sandbox：' + ROOT)
for (const p of [APP_HOME, LOCAL]) {
  if (!SANDBOXISH.test(p)) die('重定向目标不含 avca/sandbox，拒绝用它起实例：' + p)
}
if (!fs.existsSync(EXE)) die('打包版不在：' + EXE + '（先 npm run build）')
if (!fs.existsSync(ASAR)) die('asar 不在：' + ASAR)

/** 旧包测出来的绿没有意义：asar 必须比 src/ 与 resources/ 里最新的文件新 */
function newestSourceTime(dir) {
  let best = 0
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) best = Math.max(best, newestSourceTime(p))
    else if (/\.(ts|tsx|json|css)$/.test(e.name)) best = Math.max(best, fs.statSync(p).mtimeMs)
  }
  return best
}
const srcNew = Math.max(newestSourceTime(path.join(HERE, 'src')), fs.statSync(path.join(HERE, 'resources', 'unity-bridge')).mtimeMs)
if (fs.statSync(ASAR).mtimeMs < srcNew) {
  die('asar 比源码旧（打包版里没有本轮代码）→ 先 npm run build 再跑本脚本')
}

/**
 * 真 Unity 编辑器开没开：两道都查。
 *  1. 进程：名字是 `Unity.exe` 且命令行带 `-projectPath`（Hub 与它自带的 `unity.exe serve` 不带，不算）；
 *  2. 盘上：他那批真工程的 `Temp/UnityLockFile` 在不在 —— 进程名换了花样也拦得住。
 * 第二道只读，不碰工程里任何东西。
 */
function realUnityEditors() {
  let out = ''
  try {
    out = cp.execFileSync(
      'powershell',
      [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-Command',
        "Get-CimInstance Win32_Process | Where-Object { $_.Name -match '^unity\\.exe$' -and $_.CommandLine -match 'projectPath' } | ForEach-Object { \"$($_.ProcessId)|$($_.CommandLine)\" }"
      ],
      { encoding: 'utf8' }
    )
  } catch (e) {
    console.log('  ⚠ 查 Unity 进程失败（当作未知，先问一句）：' + String(e.message).slice(0, 80))
    return ['查询失败']
  }
  const found = out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)
  for (const dir of ['E:\\ALCOMprojects']) {
    if (!fs.existsSync(dir)) continue
    for (const name of fs.readdirSync(dir)) {
      const lock = path.join(dir, name, 'Temp', 'UnityLockFile')
      if (fs.existsSync(lock)) found.push('锁文件：' + lock)
    }
  }
  return found
}

/* ---------------------------------------------------------------- 记账与断言 */

const fails = []
let checks = 0
function ok(cond, label, detail) {
  checks++
  if (cond) console.log('  ✅ ' + label + (detail ? '　' + detail : ''))
  else {
    console.log('  ❌ ' + label + (detail ? '　' + detail : ''))
    fails.push(label)
  }
}
/** 拿到值才能比的断言：fn 抛错算失败，不炸整场 */
function tryOk(label, fn, show) {
  let got = null
  let err = null
  try {
    got = fn()
  } catch (e) {
    err = e
  }
  ok(!err && got === true, label, err ? '抛错：' + String(err.message).slice(0, 140) : show ? String(show(got)) : '')
}

/* ---------------------------------------------------------------- 小工具 */

function sleepSync(ms) {
  const sab = new SharedArrayBuffer(4)
  Atomics.wait(new Int32Array(sab), 0, 0, ms)
}
function sh(cmd, args, opts) {
  return cp.execFileSync(cmd, args, { cwd: HERE, encoding: 'utf8', ...opts })
}
function evalInPage(expr) {
  return sh(
    process.execPath,
    [path.join(__dirname, 'cdp-eval.cjs'), expr],
    { env: { ...process.env, AVCA_CDP_PORT: PORT }, maxBuffer: 16 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] }
  ).trim()
}
function ej(expr) {
  const raw = evalInPage(expr)
  try {
    return JSON.parse(raw)
  } catch {
    return raw
  }
}
function body() {
  try {
    return String(evalInPage('document.body.innerText'))
  } catch {
    return ''
  }
}
function shot(name) {
  const out = path.join(SHOT_DIR, name)
  fs.mkdirSync(SHOT_DIR, { recursive: true })
  try {
    sh(process.execPath, [path.join(__dirname, 'cdp-shot.cjs'), out], { env: { ...process.env, AVCA_CDP_PORT: PORT } })
    console.log('  📷 ' + path.basename(out))
  } catch (e) {
    console.log('  ⚠ 截图失败（不盖住真判据）：' + String(e.message || e).slice(0, 90))
  }
}

/* 页面侧动作全部走真 DOM（点真按钮、真填受控 input），不碰 React 内部 */
const jsClick = (txt) =>
  "(()=>{const t=" +
  JSON.stringify(txt) +
  ";const els=[...document.querySelectorAll('button,[role=button]')];" +
  "const hit=els.find(e=>(e.innerText||'').trim()===t)||els.find(e=>(e.innerText||'').trim().startsWith(t));" +
  "if(!hit)return 'NOTFOUND';if(hit.disabled)return 'DISABLED';hit.click();return 'CLICKED';})()"
const jsType = (placeholder, value) =>
  "(()=>{const i=[...document.querySelectorAll('input')].find(x=>x.placeholder===" +
  JSON.stringify(placeholder) +
  ");if(!i)return 'NOINPUT';" +
  "const d=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value');d.set.call(i," +
  JSON.stringify(value) +
  ");i.dispatchEvent(new Event('input',{bubbles:true}));return i.value;})()"
/** 找到写着 label 的那一行，按它的勾选框到目标状态（返回点击后的 checked） */
const jsRowCheck = (label, want) =>
  "(()=>{const li=[...document.querySelectorAll('li')].find(x=>(x.innerText||'').indexOf(" +
  JSON.stringify(label) +
  ")>=0);if(!li)return 'NOROW';const c=li.querySelector('input[type=checkbox]');if(!c)return 'NOCHECK';" +
  "if(!!c.checked!=="+
  String(want) +
  ")c.click();return !!c.checked;})()"
const jsCountChecked = () =>
  "(()=>{const s=new Set();[...document.querySelectorAll('li')].forEach(li=>{const c=li.querySelector('input[type=checkbox]');if(c&&c.checked)s.add(li.innerText.trim().split('\\n')[0]);});return JSON.stringify([...s]);})()"
const jsDialogText = () =>
  "(()=>{const d=[...document.querySelectorAll('*')].find(e=>e.getAttribute&&e.getAttribute('role')==='dialog');return d?d.innerText.slice(0,900):'NODIALOG';})()"

function click(txt) {
  return ej(jsClick(txt))
}
function waitUntil(label, fn, tries, step) {
  tries = tries || 30
  step = step || 1500
  for (let i = 0; i < tries; i++) {
    let v = null
    try {
      v = fn()
    } catch (e) {
      v = null
    }
    if (v) return v
    sleepSync(step)
  }
  throw new Error('等不到：' + label)
}
const waitBody = (needle, label, tries) => waitUntil(label || '屏上出现「' + needle + '」', () => body().indexOf(needle) >= 0, tries, 1200)

/* 磁盘与库的证据 */
function md5Tree(dir) {
  const out = {}
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name)
      if (e.isDirectory()) walk(p)
      else out[path.relative(dir, p).replace(/\\/g, '/')] = crypto.createHash('md5').update(fs.readFileSync(p)).digest('hex')
    }
  }
  if (fs.existsSync(dir)) walk(dir)
  return out
}
function readSettings() {
  try {
    return JSON.parse(fs.readFileSync(SETTINGS, 'utf8'))
  } catch (e) {
    return { __err: String(e.message) }
  }
}
function dbAll(sql) {
  const d = new DatabaseSync(DB, { readOnly: true })
  try {
    return d.prepare(sql).all()
  } finally {
    d.close()
  }
}
/**
 * 等主进程那轮工程发现落库（第 ③ 步只在挂载时拉一次清单，
 * 拉早了屏上是「没发现 Unity 工程」而它**不会自己再拉** —— 那就是个假故障，所以要等）。
 */
function waitProjectsDiscovered(n, tries) {
  return waitUntil(
    '工程发现落库（要 ' + n + ' 行）',
    () => {
      if (!fs.existsSync(DB)) return false
      const r = dbAll('SELECT COUNT(*) AS n FROM project')
      return Number(r[0] && r[0].n) >= n ? Number(r[0].n) : false
    },
    tries || 30,
    1500
  )
}
function dbRunWrite(sql) {
  const d = new DatabaseSync(DB)
  try {
    d.exec('PRAGMA busy_timeout = 5000')
    d.prepare(sql).run()
  } finally {
    d.close()
  }
}
function logSize() {
  try {
    return fs.statSync(LOG).size
  } catch {
    return 0
  }
}
function logSince(from) {
  if (!fs.existsSync(LOG)) return ''
  const t = Buffer.from(fs.readFileSync(LOG)).slice(from).toString('utf8')
  return t
}
function waitLog(re, what, tries) {
  const from = logSize()
  for (let i = 0; i < (tries || 30); i++) {
    const m = re.exec(logSince(from))
    if (m) return m[0]
    sleepSync(1200)
  }
  throw new Error('等不到日志：' + what + '（' + re + '）；新日志末尾：\n' + logSince(from).slice(-500))
}

/* 起停 */
let appChild = null
function startApp(why) {
  const env = { ...process.env, AVCA_APP_HOME: APP_HOME, LOCALAPPDATA: LOCAL, AVCA_CDP_PORT: PORT }
  appChild = cp.spawn(EXE, ['--remote-debugging-port=' + PORT], { cwd: HERE, detached: true, stdio: 'ignore', env })
  appChild.unref()
  console.log('  起打包版（' + why + '，端口 ' + PORT + '）')
  for (let i = 0; i < 45; i++) {
    try {
      const t = evalInPage('document.title')
      if (t) {
        console.log('  标题：' + t)
        return
      }
    } catch {
      /* 还没起来 */
    }
    sleepSync(1200)
  }
  throw new Error('打包版起不来（CDP 连不上端口 ' + PORT + '）')
}
function stopApp() {
  try {
    sh('taskkill', ['/IM', 'Atrium.exe', '/F'], { encoding: 'utf8', stdio: 'ignore' })
  } catch {
    /* 没在跑 */
  }
  try {
    if (appChild) appChild.kill('SIGKILL')
  } catch {
    /* 已经没了 */
  }
  appChild = null
  sleepSync(1200)
}
/** 命令行摄取：走的是文档里那条"命令行"用户路径（second-instance 转发 argv） */
function ingestViaCli(file) {
  const p = path.resolve(file).replace(/\//g, '\\')
  const c = cp.spawn(EXE, ['--ingest', p], { cwd: HERE, detached: true, stdio: 'ignore', env: { ...process.env, AVCA_APP_HOME: APP_HOME, LOCALAPPDATA: LOCAL, AVCA_REQUIRE_SANDBOX_HOME: '1' } })
  c.unref()
  console.log('  用命令行投递：--ingest ' + p)
  return p
}

/* 沙盒重置 */
function freshTree(projectCount) {
  stopApp()
  sh(process.execPath, [path.join(__dirname, 'make-m7-live-tree.cjs'), '--fresh'], {
    env: { ...process.env, AVCA_M7_ROOT: ROOT, AVCA_M7_PROJECT_COUNT: String(projectCount || 3) }
  })
    .split(/\r?\n/)
    .forEach((l) => console.log('  ' + l))
  fs.mkdirSync(NEWLIB, { recursive: true })
  /** 密码包那棵临时树每次重建（它只待在沙盒里） */
  fs.rmSync(PWDIR, { recursive: true, force: true })
}

/** 造一个**真的** -mhe 7z，并先自证它确实是加密包（不然后面"不再问"证明不了任何事） */
function makeRealEncryptedArchive() {
  fs.mkdirSync(PWFIX, { recursive: true })
  fs.writeFileSync(path.join(PWFIX, 'readme.txt'), '这是 M7 ⑧ 的头部加密测试包\n', 'utf8')
  fs.writeFileSync(path.join(PWFIX, 'data.bin'), Buffer.from('avca-m7-mhe-' + 'x'.repeat(4096)))
  fs.rmSync(PWARCHIVE, { force: true })
  if (!fs.existsSync(SEVENZ)) die('打包版自带的 7z.exe 不在：' + SEVENZ)
  sh(SEVENZ, ['a', '-t7z', '-mx=1', '-mhe=on', '-p' + PASSWORD, PWARCHIVE, PWFIX], { stdio: 'ignore' })
  if (!fs.existsSync(PWARCHIVE)) die('造不出 -mhe 包')
  /** 正确密码能测过 */
  let good = true
  try {
    sh(SEVENZ, ['t', '-p' + PASSWORD, PWARCHIVE], { stdio: 'ignore' })
  } catch {
    good = false
  }
  /** 错密码必须失败 */
  let badFailed = false
  try {
    sh(SEVENZ, ['t', '-pWRONG-PASSWORD', PWARCHIVE], { stdio: 'ignore' })
  } catch {
    badFailed = true
  }
  /** 不带密码连**清单**都列不出来（-mhe 的意义就在这） */
  let listingHidden = false
  try {
    const o = sh(SEVENZ, ['l', PWARCHIVE], { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env } })
    listingHidden = !/readme\.txt/.test(o)
  } catch {
    listingHidden = true
  }
  console.log('  -mhe 包自证：对密码通过=' + good + '，错密码失败=' + badFailed + '，不带密码看不到文件名=' + listingHidden)
  if (!good || !badFailed || !listingHidden) die('这个包不是真头部加密，后面的验证没有意义')
  return PWARCHIVE
}

/* ---------------------------------------------------------------- stage: launch（§6.2 1/2/3/4 前半） */

function stageLaunch() {
  console.log('\n=== stage launch · §6.2 第 1/2/3/4 条（前半） ===')
  freshTree(3)
  const before = md5Tree(OLDLIB)
  ok(Object.keys(before).length >= 4, '沙盒"已有素材"的树有东西可比', Object.keys(before).length + ' 个文件')

  startApp('全新安装第一次打开')
  waitUntil('界面渲染出来', () => body().length > 40, 40, 1200)

  /* 第 1 条：第一次打开必须落在向导第 ① 步 */
  const b1 = body()
  ok(b1.indexOf('首次配置') >= 0, '① 第一次打开落在向导（屏上有「首次配置」）')
  ok(b1.indexOf('① 素材库存哪儿') >= 0, '① 停在第 ① 步（屏上有「① 素材库存哪儿」）')
  ok(b1.indexOf('收件箱') < 0, '① 这一刻**没有**画主界面（屏上找不到「收件箱」）')
  shot('m7-pkg-01-step1.png')

  /* 第 2 条：指到已有素材的树 → 二选一；点接管之后一个文件都不动 */
  console.log('  贴路径 + 点「看这个目录」：' + OLDLIB)
  ok(String(ej(jsType('或者把路径贴在这里', OLDLIB))) === OLDLIB, '② 手输路径进了输入框')
  ok(String(click('看这个目录')) === 'CLICKED', '② 点了「看这个目录」')
  waitBody('这里已经有素材了', '② 出现接管/建空库二选一')
  const b2 = body()
  ok(b2.indexOf('顶层目录') >= 0 && b2.indexOf('A 吃得下的文件') >= 0, '② 探测数字上了屏（顶层目录 / 文件数）')
  ok(b2.indexOf('剩余空间') >= 0, '② 剩余空间也报了（D 盘读得到）')
  shot('m7-pkg-02-ask-adopt.png')

  ok(String(click('接管这个库')) === 'CLICKED', '② 点了「接管这个库」')
  /* 接管之后：向导必须**继续**（sticky），并且自动进第 ② 步 */
  waitBody('② 素材从哪儿来', '② 落完库根之后向导没把自己关掉（进到第 ② 步）')
  const after = md5Tree(OLDLIB)
  const same = JSON.stringify(before) === JSON.stringify(after)
  ok(same, '⭐ ② 接管之后**整棵树 md5 一字不变**（一个文件都不搬、不改名）', Object.keys(after).length + ' 个文件逐一比过')
  const st1 = readSettings()
  ok(st1.libraryMode === 'adopt', '② settings.json 里 libraryMode = adopt', JSON.stringify(st1.libraryMode))
  ok(st1.autoArchive === false, '⭐ ② 接管顺手关掉「高置信度自动归档」', 'autoArchive=' + st1.autoArchive)
  ok(String(st1.libraryRoot || '').replace(/\\/g, '/').indexOf('/oldlib') >= 0, '② 库根指向那棵树', st1.libraryRoot)

  /* 第 3 条：一屏列 3 个、默认全勾；勾掉一个 → 只有勾上的动盘 */
  console.log('  等工程发现落库：' + waitProjectsDiscovered(3) + ' 行')
  ok(String(click('下一步')) === 'CLICKED', '③ 从第 ② 步进到第 ③ 步')
  waitBody('③ 给 Unity 工程装桥接', '③ 到第 ③ 步')
  /* ej 已经把页面返回的 JSON 串解开了，这里不能再 String()+JSON.parse 一遍（第一跑就是这么炸的） */
  const pickedRaw = ej(jsCountChecked())
  const picked3 = Array.isArray(pickedRaw) ? pickedRaw : []
  ok(Array.isArray(pickedRaw) && picked3.length === 3, '③ 三个工程默认全勾（Q9 乙）', picked3.join(' / ') || '探针没拿到数组：' + String(pickedRaw).slice(0, 60))
  const rows = body()
  ok(['Alpha-M7LiveTest', 'Beta-M7LiveTest', 'Gamma-M7LiveTest'].every((n) => rows.indexOf(n) >= 0), '③ 三个假工程都列出来了')
  ok(rows.indexOf('2022.3.22f1') >= 0, '③ 每行带着 Unity 版本')
  const assetsBefore = md5Tree(PROJ_ROOT)
  ok(String(ej(jsRowCheck('Gamma-M7LiveTest', false))) === 'false', '③ 把 Gamma 的勾取消')
  shot('m7-pkg-03-step3.png')
  ok(String(click('装勾上的这些')) === 'CLICKED', '③ 点了「装勾上的这些」')
  waitBody('装了', '③ 结果行出来')
  const b3 = body()
  ok(/Alpha-M7LiveTest · 装了 \d+ 个文件/.test(b3), '③ 逐条报了 Alpha 的目标路径')
  const pkg = (n) => path.join(PROJ_ROOT, n, 'Packages', 'com.avca.bridge', 'package.json')
  ok(fs.existsSync(pkg('Alpha-M7LiveTest')) && fs.existsSync(pkg('Beta-M7LiveTest')), '③ 只有勾上的两个长出 Packages/com.avca.bridge')
  ok(!fs.existsSync(path.join(PROJ_ROOT, 'Gamma-M7LiveTest', 'Packages')), '⭐ ③ 没勾的那个连 Packages 目录都没建')
  const assetsAfter = md5Tree(PROJ_ROOT)
  const onlyBridge = Object.keys(assetsAfter).filter((k) => !assetsBefore[k])
  const allUnderPackages = onlyBridge.every((k) => /(^|\/)Packages\//.test(k))
  ok(allUnderPackages, '⭐ ③ 新增文件**全部**在 Packages/ 下（Assets/ 一字没动）', onlyBridge.length + ' 个新增')
  ok(
    Object.keys(assetsBefore)
      .filter((k) => /(^|\/)Assets\//.test(k))
      .every((k) => assetsAfter[k] === assetsBefore[k]),
    '③ 原有 Assets/ 内容 md5 逐个相同'
  )

  /* 第 4 条前半：走完 → 重启 → 不再出现向导 */
  ok(String(click('下一步')) === 'CLICKED', '④ 进第 ④ 步')
  waitBody('④ 收尾', '④ 到第 ④ 步')
  const b4 = body()
  ok(b4.indexOf('走之前确认一下') >= 0, '④ 有确认清单')
  ok(b4.indexOf('库根') >= 0 && b4.indexOf('接管') >= 0, '④ 清单里写着库根与"接管"')
  ok(b4.indexOf('Ctrl+Alt+A') >= 0, '④ 热键显示成 Ctrl+Alt+A（不是契约串原文）')
  ok(String(click('不用，我手动开')) === 'CLICKED', '④ 答了「不用，我手动开」（默认 false，不擅自动启动项）')
  ok(b4.indexOf('会动磁盘') >= 0, '④ 清单里"装了桥接"那条标了「会动磁盘」')
  shot('m7-pkg-04-summary.png')
  ok(String(click('开始使用')) === 'CLICKED', '④ 点了「开始使用」')
  waitBody('收件箱', '④ 走完落到主界面')
  const st2 = readSettings()
  ok(st2.onboardingDone === true, '④ onboardingDone 写成 true', JSON.stringify(st2.onboardingDone))
  ok(st2.onboardingSkippedAt === null || st2.onboardingSkippedAt === undefined, '④ 走完不留"跳过"的痕')
  stopApp()
  startApp('走完向导之后重启')
  waitUntil('界面渲染出来', () => body().length > 40, 40, 1200)
  const b5 = body()
  ok(b5.indexOf('首次配置') < 0, '⭐ ④ 重启之后不再出现向导')
  ok(b5.indexOf('收件箱') >= 0, '④ 重启直接进主界面')
  stopApp()
}

/**
 * 走一遍向导把沙盒配好（接管 oldlib）。给 password 那一场当前置 ——
 * 每场自带前置，重跑才不会被上一场的残留假失败/假成功。
 */
function configureLibrary() {
  freshTree(3)
  startApp('配库（接管 oldlib）')
  waitUntil('界面渲染出来', () => body().length > 40, 40, 1200)
  ok(String(ej(jsType('或者把路径贴在这里', OLDLIB))) === OLDLIB, '前置 · 贴 oldlib 路径')
  ok(String(click('看这个目录')) === 'CLICKED', '前置 · 点「看这个目录」')
  waitBody('这里已经有素材了', '前置 · 出二选一')
  ok(String(click('接管这个库')) === 'CLICKED', '前置 · 点「接管这个库」')
  waitBody('② 素材从哪儿来', '前置 · 进到第 ② 步')
  ok(String(click('下一步')) === 'CLICKED', '前置 · 进第 ③ 步')
  waitBody('③ 给 Unity 工程装桥接', '前置 · 到第 ③ 步')
  ok(String(click('下一步')) === 'CLICKED', '前置 · 第 ③ 步整步跳过')
  waitBody('④ 收尾', '前置 · 到第 ④ 步')
  ok(String(click('不用，我手动开')) === 'CLICKED', '前置 · 答「不用，我手动开」')
  ok(String(click('开始使用')) === 'CLICKED', '前置 · 开始使用')
  waitBody('收件箱', '前置 · 配完落到主界面')
  const st = readSettings()
  ok(
    st.libraryMode === 'adopt' && st.autoArchive === false && st.onboardingDone === true,
    '前置 · 沙盒配成"接管 + 不自动归档 + 已走完向导"',
    JSON.stringify([st.libraryMode, st.autoArchive, st.onboardingDone])
  )
  stopApp()
}
/** 屏幕上有没有在问密码（给摄取链留出跑的时间） */
function passwordPromptShown(rounds) {
  for (let i = 0; i < (rounds || 24); i++) {
    if (body().indexOf('这个压缩包需要密码') >= 0) return true
    sleepSync(1000)
  }
  return false
}

/* ---------------------------------------------------------------- stage: password（§6.2 第 5 条） */

function stagePassword() {
  console.log('\n=== stage password · §6.2 第 5 条（真 -mhe 包：记住 → 重启 → 不再问） ===')
  /**
   * 自己把沙盒配好（**接管** oldlib，于是 `autoArchive=false`）：
   * 不自动归档那张卡才停在"等你确认"、源文件留在原地，后面"重启再撞同一个包"才有同一个包可撞。
   * 每一场都重配一遍，不复用上一场的库状态 —— 否则重跑时"库里已经记着密码"会让第一条假失败。
   */
  configureLibrary()
  const archive = makeRealEncryptedArchive()

  startApp('密码保管：第一次')
  waitUntil('界面渲染出来', () => body().length > 40, 40, 1200)
  /** 偏移要在投递**之前**取：投完再取就已经越过那一行了（第一跑就是这么假失败的） */
  const from1 = logSize()
  ingestViaCli(archive)
  waitBody('这个压缩包需要密码', '⑤ 第一次：界面真的在问密码')
  shot('m7-pkg-05-ask-password.png')

  ok(String(ej(jsType('****', PASSWORD))) === PASSWORD, '⑤ 密码填进输入框')
  const chk = ej(
    "(()=>{const l=[...document.querySelectorAll('label')].find(x=>(x.innerText||'').indexOf('记住这个密码')>=0);if(!l)return 'NOLABEL';const c=l.querySelector('input[type=checkbox]');if(!c)return 'NOCHECK';if(!c.checked)c.click();return !!c.checked;})()"
  )
  ok(chk === true, '⭐ ⑤ 勾上「记住这个密码」（默认是没勾的，界面也写着"只存在这台机器上，用你的 Windows 账户加密"）')
  ok(body().indexOf('只存在这台机器上') >= 0, '⑤ 那句"只存这台机器"上了屏')
  ok(String(click('重试')) === 'CLICKED', '⑤ 点了「重试」提交')
  waitUntil('⑤ 密码这条过了', () => body().indexOf('这个压缩包需要密码') < 0, 30, 1200)

  const rows = dbAll('SELECT id, hint, platform, item_id, author, length(password_enc) AS n, password_enc FROM password_vault')
  ok(rows.length === 1, '⑤ 库里恰好一行记住的密码', rows.length + ' 行')
  if (rows.length) {
    const enc = Buffer.from(rows[0].password_enc)
    ok(enc.toString('utf8').indexOf(PASSWORD) < 0, '⭐ ⑤ 存的那一字节不是明文密码', '密文 ' + enc.length + ' 字节，platform=' + rows[0].platform)
    ok(rows[0].hint.indexOf('secret-pack.7z') >= 0, '⑤ hint 是文件名（列表靠它认包）', rows[0].hint)
  }
  const win1 = logSince(from1)
  ok(win1.indexOf('字节密文') >= 0, '⑤ 日志只报了密文字节数')
  ok(win1.indexOf(PASSWORD) < 0, '⭐ ⑤ 这一场新写的日志里没有密码本身')
  stopApp()

  /* 重启 → 同一个包必须不再问 */
  startApp('密码保管：重启之后第二次撞见同一个包')
  waitUntil('界面渲染出来', () => body().length > 40, 40, 1200)
  const from2 = logSize()
  ingestViaCli(archive)
  ok(passwordPromptShown(24) === false, '⭐ ⑤ 重启之后同一个包**不再问密码**')
  const win2 = logSince(from2)
  ok(/\[vault\] 用记住的密码重试/.test(win2), '⑤ 这一场的新日志里写着它用了记住的那条')
  ok(win2.indexOf(PASSWORD) < 0, '⑤ 这一轮的日志里也没有密码本身')
  console.log('   第二轮这段日志：' + win2.split(/\r?\n/).filter(Boolean).slice(-3).join(' / ').slice(0, 220))
  stopApp()

  /* 删掉那一行 → 必须重新问（证明"不再问"是数据而不是运气） */
  dbRunWrite('DELETE FROM password_vault')
  ok(dbAll('SELECT COUNT(*) AS n FROM password_vault')[0].n === 0, '⑤ 沙盒库里那行已删（删的是沙盒，不是他的库）')
  startApp('密码保管：删掉记住的那行之后')
  waitUntil('界面渲染出来', () => body().length > 40, 40, 1200)
  ingestViaCli(archive)
  ok(passwordPromptShown(24) === true, '⭐ ⑤ 删掉那行之后**重新问密码**（"记住"真的是库里那条数据，不是缓存里的运气）')
  stopApp()
}

/* ---------------------------------------------------------------- stage: skip（§6.2 第 4 条后半） */

function stageSkip() {
  console.log('\n=== stage skip · §6.2 第 4 条后半（稍后配置 → 不拦人，但入口还在） ===')
  freshTree(3)
  startApp('跳过向导那一次')
  waitUntil('界面渲染出来', () => body().length > 40, 40, 1200)
  ok(body().indexOf('首次配置') >= 0, '⑥ 空 APP_HOME 起来就是向导')
  ok(String(click('稍后配置')) === 'CLICKED', '⑥ 点了「稍后配置」')
  waitBody('收件箱', '⑥ 跳过之后进主界面')
  const b = body()
  ok(b.indexOf('库还没配好') >= 0, '⭐ ⑥ 侧栏那条「库还没配好」还在（改主意的人找得到入口）')
  shot('m7-pkg-06-skip-entry.png')
  const st = readSettings()
  ok(st.onboardingDone !== true, '⑥ 「稍后配置」没写成"已完成"', 'onboardingDone=' + JSON.stringify(st.onboardingDone))
  ok(!!st.onboardingSkippedAt, '⑥ 写的是 onboardingSkippedAt', st.onboardingSkippedAt)
  stopApp()

  startApp('跳过之后重启')
  waitUntil('界面渲染出来', () => body().length > 40, 40, 1200)
  const b2 = body()
  ok(b2.indexOf('首次配置') < 0, '⑥ 重启之后不再拦人')
  ok(b2.indexOf('库还没配好') >= 0, '⭐ ⑥ 重启之后入口仍然在')
  ok(String(click('库还没配好')) === 'CLICKED', '⑥ 点那条入口')
  waitBody('首次配置', '⑥ 点入口回到向导')
  const st2 = readSettings()
  ok(!st2.onboardingSkippedAt, '⑥ 回到向导时"跳过"的痕迹被擦掉（否则永远回不来）', JSON.stringify(st2.onboardingSkippedAt))
  stopApp()
}

/* ---------------------------------------------------------------- stage: asks（§6.2 第 6 条：一次冒一批） */

function stageAsks() {
  console.log('\n=== stage asks · §6.2 第 6 条（8 个工程一次冒出来，问完为止） ===')
  freshTree(8)
  startApp('八个工程的全新安装')
  waitUntil('界面渲染出来', () => body().length > 40, 40, 1200)
  ok(body().indexOf('① 素材库存哪儿') >= 0, '⑦ 落在第 ① 步')
  /* 用一个空目录当库根（探测=空 → 直接建空库，不问） */
  ok(String(ej(jsType('或者把路径贴在这里', NEWLIB))) === NEWLIB, '⑦ 贴一个空目录')
  ok(String(click('看这个目录')) === 'CLICKED', '⑦ 点了「看这个目录」')
  waitBody('② 素材从哪儿来', '⑦ 空目录自动按"建空库"落定并进第 ② 步')
  const st = readSettings()
  ok(st.libraryMode === 'fresh', '⑦ 处理方式记成 fresh', JSON.stringify(st.libraryMode))
  console.log('  等八个工程发现落库：' + waitProjectsDiscovered(8) + ' 行')
  ok(String(click('下一步')) === 'CLICKED', '⑦ 进第 ③ 步')
  waitBody('③ 给 Unity 工程装桥接', '⑦ 到第 ③ 步')
  ok(body().indexOf('Delta-M7LiveTest') >= 0, '⑦ 八个假工程都列上了（第 8 个也在）')
  /* 故意**跳过**第 ③ 步：这一条测的就是运行期那批弹窗 */
  ok(String(click('下一步')) === 'CLICKED', '⑦ 第 ③ 步什么都不装，直接下一步')
  waitBody('④ 收尾', '⑦ 到第 ④ 步')
  ok(String(click('不用，我手动开')) === 'CLICKED', '⑦ 答「不用，我手动开」')
  ok(String(click('开始使用')) === 'CLICKED', '⑦ 点「开始使用」')
  waitBody('收件箱', '⑦ 落到主界面')

  /* 八条待答：先逐条答两条（证明会自己轮下一条），再用「剩下 N 个都不再问」收掉后面那批 */
  waitBody('刚发现工程', '⑦ 第一条弹窗出现')
  /**
   * 先把"弹窗探针找得到 role=dialog"钉住 —— 后面那句"队列空了"判的是 `NODIALOG`，
   * 探针本身失灵的话它就恒为真（这是本项目反复记过的那类假绿：断言之前先确认要比的值真的存在）。
   */
  ok(
    String(ej(jsDialogText())).indexOf('刚发现工程') >= 0,
    '⑦ 弹窗探针找得到 role=dialog 那一块（不然"队列空了"那条是假绿）',
    String(ej(jsDialogText())).slice(0, 40).replace(/\n/g, ' / ')
  )
  const seen = new Set()
  const askedName = () => {
    const m = /刚发现工程「(.+?)」/.exec(body())
    if (m) seen.add(m[1])
    return m ? m[1] : ''
  }
  askedName()
  ok(body().indexOf('另外还有 7 个工程要问') >= 0, '⭐ ⑦ 第一条上写着「另外还有 7 个工程要问」（一次冒一批的形状）', body().match(/另外还有[^\n]*/)?.[0])
  ok(String(click('暂不')) === 'CLICKED', '⑦ 第一条答「暂不」')
  /**
   * 轮询里**每一轮都先记下屏幕上这条的名字**，再判断数字。
   * 第一版只在"还没轮到"的分支里记，条件一成立就 return true 走人 ——
   * 于是第二条的名字从来没被采到，`seen.size >= 2` 当场假失败
   * （库里恰好 8 行、八个不同 id 那些硬证据倒是过的，所以红的是探针不是产品）。
   */
  const waitAskWithRest = (n, label) =>
    waitUntil(
      label,
      () => {
        askedName()
        const m = /另外还有 (\d+) 个/.exec(body())
        return !!m && Number(m[1]) === n
      },
      20,
      1200
    )
  waitAskWithRest(6, '⑦ 轮到第二条')
  ok(seen.size >= 2, '⑦ 两条弹窗是**不同**的工程（队列真的在轮，不是同一条反复问）', [...seen].join(' / '))
  ok(String(click('暂不')) === 'CLICKED', '⑦ 第二条也答「暂不」')
  waitAskWithRest(5, '⑦ 轮到第三条')
  ok(seen.size >= 3, '⑦ 三条弹窗是三个**不同**的工程（队列在轮，不是同一条反复问）', [...seen].join(' / '))
  shot('m7-pkg-07-third-ask.png')
  ok(String(click('剩下')) === 'CLICKED', '⑦ 第三条点「剩下 5 个都不再问」')
  const afterSilence = body()
  ok(afterSilence.indexOf('另外还有') < 0, '⭐ ⑦ 点完之后"另外还有"那行和那颗按钮一起消失（剩下就是屏幕上这条）')
  ok(afterSilence.indexOf('刚发现工程') >= 0, '⑦ 屏幕上这条**没被替用户答掉**')
  ok(String(click('暂不')) === 'CLICKED', '⑦ 最后这条自己答「暂不」')
  sleepSync(2500)
  ok(String(ej(jsDialogText())) === 'NODIALOG', '⑦ 队列空了（弹窗关掉）')
  const rows = dbAll("SELECT key, value_json FROM setting WHERE key LIKE 'bridgeAsk:%'")
  ok(rows.length === 8, '⭐ ⑦ 库里**恰好 8 行** bridgeAsk:<id>（每行都是那个工程自己的答案，不是全局标志）', rows.length + ' 行')
  ok(new Set(rows.map((r) => r.key)).size === 8, '⑦ 八个不同的工程 id', rows.map((r) => r.key).join(' ').slice(0, 120))
  ok(rows.every((r) => String(r.value_json).indexOf('never') >= 0), '⑦ 八行写的都是 never')
  const globalish = dbAll("SELECT key FROM setting WHERE key NOT LIKE 'bridgeAsk:%'")
  ok(globalish.length === 0, '⑦ 没有任何"全局静音"键', globalish.map((r) => r.key).join(','))
  shot('m7-pkg-07-after.png')
  stopApp()

  startApp('八个工程答完之后的重启')
  waitUntil('界面渲染出来', () => body().length > 40, 40, 1200)
  sleepSync(4000)
  const t3 = String(ej(jsDialogText()))
  ok(t3 === 'NODIALOG' || t3.indexOf('刚发现工程') < 0, '⭐ ⑦ 重启之后一条都不再弹（八条都真的答过了）')
  stopApp()
}

/* ---------------------------------------------------------------- 跑 */

const GUARDS = { launch: stageLaunch, password: stagePassword, skip: stageSkip, asks: stageAsks }
const ORDER = ['launch', 'password', 'skip', 'asks']

function main() {
  const unis = realUnityEditors()
  if (unis.length) die('真 Unity 编辑器开着工程，拒绝起沙盒实例：\n    ' + unis.join('\n    ').slice(0, 400))
  console.log('真 Unity 编辑器：没开着 ✔（只跑了 Hub/serve，不带 -projectPath）')
  console.log('沙盒：' + ROOT + '　AVCA_APP_HOME=' + APP_HOME + '　LOCALAPPDATA=' + LOCAL)
  console.log('被测的 exe：' + EXE)
  console.log('asar：' + ASAR + '（' + new Date(fs.statSync(ASAR).mtimeMs).toISOString() + '，比源码新 ✔）\n')

  const list = ALL ? ORDER : [STAGE]
  for (const k of list) {
    if (!GUARDS[k]) die('不认识的 stage：' + k + '（launch|password|skip|asks|all）')
    try {
      GUARDS[k]()
    } catch (e) {
      console.log('  💥 ' + k + ' 这一场炸了：' + String(e && e.message).slice(0, 400))
      fails.push(k + ' 崩：' + String(e && e.message).slice(0, 120))
      stopApp()
    }
  }

  console.log('\n=== 小结 ===')
  console.log('这一场跑了：' + list.join(' → '))
  console.log('判据 ' + checks + ' 条，红 ' + fails.length + ' 条')
  for (const f of fails) console.log('  ❌ ' + f)
  if (!fails.length) {
    console.log(
      ALL
        ? '§6.2 那六条在**打包版**上全部跑过，凭据与截图在 ' + SHOT_DIR
        : '这一场的判据全绿（六条要四场跑完才算齐：' + ORDER.join('/') + '，或者直接 --all）'
    )
  }
  process.exit(fails.length ? 1 : 0)
}
main()
