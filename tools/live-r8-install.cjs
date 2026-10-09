#!/usr/bin/env node
/**
 * 第 8 轮 ⑤ —— **真装** `Atrium-Setup-0.2.0.exe` 到这台机器，并验"覆盖安装之后用户改动不丢"。
 *
 * ## 为什么这一场值得单独一个工具，而且门槛拉满
 *
 * 前面所有活体都靠 `AVCA_APP_HOME` 把数据目录挪进沙盒；这一场**恰恰不能挪** ——
 * 要测的就是"真装 + 真数据目录 + 覆盖安装"这三件事凑在一起会不会丢东西。
 * 所以它是本仓库唯一一个**会打开他真库**的活体工具，闸门按这个前提设计：
 *
 *  1. 必须显式带环境变量 `AVCA_REAL_INSTALL=1` 才允许安装（`snapshot` / `diff` 两场是只读的，不用带）；
 *  2. 起实例之前查真 Unity 编辑器（进程带 `-projectPath` **或** 真工程里有 `Temp/UnityLockFile`）；
 *  3. 装之前先把 `library.db` / `settings.json` / `categories.user.json` **复制到沙盒**
 *     （不往 `%APPDATA%\A` 里添东西，那边已经有六个 `.bak-*` 了）；
 *  4. 全程**不摄取、不导入、不搬文件、不改任何设置** —— 代码里就没有这些调用路径，
 *     只启动、只读屏、只关进程；
 *  5. 跑完逐表对指纹：`asset` / `variant` / `journal` / `import_log` / `setting` / `password_vault` /
 *     `learning` / `collection` / `tag` 必须**一字不差**；`project` 表允许 `last_seen` 与 `is_running` 变
 *     （那是任何一次正常启动都会做的事），**其它列一变就报红**。
 *
 * ## 用法（顺序就是这里的顺序）
 *
 *   node tools/live-r8-install.cjs --stage=snapshot          # 只读：装之前的指纹
 *   AVCA_REAL_INSTALL=1 node tools/live-r8-install.cjs --stage=install
 *   node tools/live-r8-install.cjs --stage=diff              # 只读：装完之后对账
 *   AVCA_REAL_INSTALL=1 node tools/live-r8-install.cjs --stage=overwrite   # 再覆盖装一次
 *   node tools/live-r8-install.cjs --stage=diff              # 只读：覆盖之后再对账
 *
 * 可选：`AVCA_SETUP_EXE`（默认 `dist\Atrium-Setup-0.2.0.exe`）/ `AVCA_INSTALL_DIR`
 *      （默认 `%LOCALAPPDATA%\Programs\Atrium`）/ `AVCA_CDP_PORT`（默认 **9242**）
 *      / `AVCA_BACKUP_DIR`（默认 `D:\avca-m7-live\real-backup`）
 */
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const cp = require('node:child_process')
const crypto = require('node:crypto')
const { DatabaseSync } = require('node:sqlite')

const HERE = path.resolve(__dirname, '..')
const A = path.join(process.env.APPDATA, 'A')
const DB = path.join(A, 'library.db')
const SETTINGS = path.join(A, 'settings.json')
const CATEGORIES_USER = path.join(A, 'categories.user.json')
const SNAPSHOT = path.join(os.tmpdir(), 'avca-r8-snapshot.json')
const SETUP = process.env.AVCA_SETUP_EXE || path.join(HERE, 'dist', 'Atrium-Setup-0.2.0.exe')
const INSTALL_DIR = process.env.AVCA_INSTALL_DIR || path.join(process.env.LOCALAPPDATA, 'Programs', 'Atrium')
const INSTALLED_EXE = path.join(INSTALL_DIR, 'Atrium.exe')
const PORT = process.env.AVCA_CDP_PORT || '9242'
const BACKUP_DIR = process.env.AVCA_BACKUP_DIR || 'D:\\avca-m7-live\\real-backup'
const STAGE = (process.argv.find((a) => a.startsWith('--stage=')) || '--stage=snapshot').split('=')[1]

function die(msg) {
  console.error('⛔ ' + msg)
  process.exit(1)
}
function sh(cmd, args, opts) {
  return cp.execFileSync(cmd, args, { cwd: HERE, encoding: 'utf8', ...opts })
}
function sleepSync(ms) {
  const sab = new SharedArrayBuffer(4)
  Atomics.wait(new Int32Array(sab), 0, 0, ms)
}
const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex').slice(0, 16)

/* ---------------------------------------------------------------- 只读指纹 */

/** 允许变的表与列：任何一次正常启动都会刷 project 的这两列，别的都不许动 */
const VOLATILE = { project: new Set(['last_seen', 'is_running']) }

function fingerprint() {
  if (!fs.existsSync(DB)) die('真库不在：' + DB)
  const db = new DatabaseSync(DB, { readOnly: true })
  const out = { at: new Date().toISOString(), tables: {}, rows: {}, vol_rows: {}, user_version: null }
  try {
    out.user_version = Number(db.prepare('PRAGMA user_version').get().user_version)
    const names = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
      .all()
      .map((r) => r.name)
    for (const t of names) {
      const rows = db.prepare(`SELECT * FROM ${t}`).all()
      out.rows[t] = rows.length
      out.tables[t] = sha(Buffer.from(JSON.stringify(rows), 'utf8'))
      /**
       * "允许变"的那几张表要把整表存进指纹，否则逐列比对时拿不到"变之前是什么"
       * （只存哈希的话，diff 阶段只能重读一遍当前表 —— 那比的是自己跟自己）。
       * project 表就 9 行，存得起。
       */
      if (VOLATILE[t]) out.vol_rows[t] = rows
    }
  } finally {
    db.close()
  }
  const one = (p) => (fs.existsSync(p) ? { size: fs.statSync(p).size, hash: sha(fs.readFileSync(p)), mtime: fs.statSync(p).mtimeMs } : null)
  out.files = { library_db: one(DB), settings: one(SETTINGS), categories_user: one(CATEGORIES_USER) }
  try {
    const s = JSON.parse(fs.readFileSync(SETTINGS, 'utf8'))
    out.settings_keys = {
      libraryRoot: s.libraryRoot ?? null,
      libraryMode: s.libraryMode ?? null,
      autoArchive: s.autoArchive ?? null,
      onboardingDone: s.onboardingDone ?? null,
      onboardingSkippedAt: s.onboardingSkippedAt ?? null,
      watchedFolders: (s.watchedFolders || []).length,
      bridgeAutoInstall: s.bridgeAutoInstall ?? null,
      autoLaunch: s.autoLaunch ?? null,
      language: s.language ?? null
    }
    out.settings_all_keys = Object.keys(s).sort()
  } catch (e) {
    out.settings_keys = { __err: String(e.message) }
  }
  return out
}

function saveSnapshot() {
  const f = fingerprint()
  fs.writeFileSync(SNAPSHOT, JSON.stringify(f, null, 2))
  console.log('指纹存到 ' + SNAPSHOT)
  console.log('  user_version=' + f.user_version + '　library.db=' + f.files.library_db.size + ' 字节 #' + f.files.library_db.hash)
  console.log('  表行数：' + Object.entries(f.rows).map(([k, v]) => k + '=' + v).join(' '))
  console.log('  settings 关键字段：' + JSON.stringify(f.settings_keys))
  return f
}

function diffSnapshots(before, after) {
  const bad = []
  const notes = []
  const okLines = []
  for (const t of Object.keys(after.tables)) {
    if (before.tables[t] === undefined) {
      bad.push(`指纹里没有的表出现了：${t}`)
      continue
    }
    if (before.tables[t] === after.tables[t]) {
      okLines.push(`${t}（${after.rows[t]} 行）一字不差`)
      continue
    }
    if (!VOLATILE[t]) {
      bad.push(`${t} 变了（${before.rows[t]} → ${after.rows[t]} 行，哈希 ${before.tables[t]} → ${after.tables[t]}）`)
      continue
    }
    notes.push(`${t} 变了 —— 这一张是"允许变"的，逐列看下面`)
    /** 逐列比对用的是**指纹里存着的旧行**（`vol_rows`），不是重读一遍当前表 —— 那比的是自己跟自己 */
    const b = before.vol_rows[t] || []
    const a = after.vol_rows[t] || []
    const cols = Object.keys(a[0] || b[0] || {})
    const mapB = new Map(b.map((r) => [r.id ?? r.path ?? JSON.stringify(r), r]))
    for (const row of a) {
      const old = mapB.get(row.id ?? row.path ?? JSON.stringify(row))
      if (!old) {
        bad.push(`${t} 多了一行：${row.name ?? row.id}`)
        continue
      }
      for (const c of cols) {
        if (JSON.stringify(old[c]) === JSON.stringify(row[c])) continue
        if (!VOLATILE[t].has(c)) bad.push(`${t}.${c} 变了：${JSON.stringify(old[c])} → ${JSON.stringify(row[c])}（行 ${row.name}）`)
        else notes.push(`${t}.${c} 按预期刷新：${JSON.stringify(old[c])} → ${JSON.stringify(row[c])}（行 ${row.name}）`)
      }
    }
    if (b.length !== a.length) bad.push(`${t} 行数变了：${b.length} → ${a.length}`)
  }
  for (const k of Object.keys(after.files)) {
    const b = before.files[k]
    const a = after.files[k]
    if (!b && !a) continue
    if (!!b !== !!a) bad.push(`${k} 出现/消失了`)
    else if (b.hash !== a.hash) notes.push(`${k} 内容变了（#${b.hash} → #${a.hash}，${b.size} → ${a.size} 字节）`)
  }
  console.log('\n--- 逐表对账 ---')
  for (const l of okLines) console.log('  ✅ ' + l)
  for (const n of notes) console.log('  · ' + n)
  for (const m of bad) console.log('  ❌ ' + m)
  return bad.length === 0
}

/* ---------------------------------------------------------------- 闸门 */

function unityBusy() {
  let out = ''
  try {
    out = sh(
      'powershell',
      [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-Command',
        "Get-CimInstance Win32_Process | Where-Object { $_.Name -match '^unity\\.exe$' -and $_.CommandLine -match 'projectPath' } | ForEach-Object { \"$($_.ProcessId)\" }"
      ],
      { encoding: 'utf8' }
    )
  } catch (e) {
    return ['查 Unity 进程失败：' + String(e.message).slice(0, 80)]
  }
  const found = out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)
  const root = 'E:\\ALCOMprojects'
  if (fs.existsSync(root)) {
    for (const name of fs.readdirSync(root)) {
      const lock = path.join(root, name, 'Temp', 'UnityLockFile')
      if (fs.existsSync(lock)) found.push('锁文件：' + name)
    }
  }
  return found
}

function backupRealData() {
  fs.mkdirSync(BACKUP_DIR, { recursive: true })
  if (!/avca|sandbox|m7/i.test(BACKUP_DIR)) die('备份目录名字里没有 avca/m7/sandbox：' + BACKUP_DIR)
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 13)
  const dest = path.join(BACKUP_DIR, 'pre-' + STAGE + '-' + stamp)
  fs.mkdirSync(dest, { recursive: true })
  for (const f of [DB, DB + '-wal', SETTINGS, CATEGORIES_USER]) {
    if (!fs.existsSync(f)) continue
    fs.copyFileSync(f, path.join(dest, path.basename(f)))
    console.log('  备份 ' + path.basename(f) + ' → ' + dest)
  }
  return dest
}

function runInstaller(why) {
  if (process.env.AVCA_REAL_INSTALL !== '1') die('这一步会真装到这台机器（' + why + '）。确认就带 AVCA_REAL_INSTALL=1 再跑')
  if (!fs.existsSync(SETUP)) die('安装包不在：' + SETUP + '（先 npm run build）')
  const unis = unityBusy()
  if (unis.length) die('真 Unity 编辑器开着，拒绝起安装版：\n    ' + unis.join('\n    ').slice(0, 300))
  console.log('真 Unity：没开着 ✔')
  backupRealData()
  console.log('  跑安装器（' + why + '）：' + path.basename(SETUP) + ' /S')
  try {
    sh(SETUP, ['/S'], { stdio: ['ignore', 'pipe', 'pipe'], timeout: 300000 })
  } catch (e) {
    die('安装器返回非 0：' + String(e.message).slice(0, 300))
  }
  for (let i = 0; i < 30; i++) {
    if (fs.existsSync(INSTALLED_EXE)) break
    sleepSync(1000)
  }
  if (!fs.existsSync(INSTALLED_EXE)) die('装完了但找不到 ' + INSTALLED_EXE)
  return INSTALLED_EXE
}

/** 起安装版一次：只读屏 + 关进程，代码里没有任何摄取/导入/改设置的路径 */
function bootAndInspect() {
  /**
   * 这一场的前提就是"不重定向"，所以这里**不是删掉环境变量**（删了 `LOCALAPPDATA`
   * 会让 Electron 去找一个奇怪的数据目录，测的就不是真装了），而是**断言它是真的**：
   * 路径里不许出现 avca / sandbox，`AVCA_APP_HOME` 必须没设。
   */
  if (process.env.AVCA_APP_HOME) die('AVCA_APP_HOME 还设着（' + process.env.AVCA_APP_HOME + '）—— 这一场要的是真数据目录，先 unset')
  for (const k of ['APPDATA', 'LOCALAPPDATA']) {
    const v = process.env[k] || ''
    if (/avca|sandbox|m7-live/i.test(v)) die(k + ' 指向的是沙盒：' + v + ' —— 这一场要的是真数据目录')
  }
  const env = { ...process.env, AVCA_CDP_PORT: PORT }
  const child = cp.spawn(INSTALLED_EXE, ['--remote-debugging-port=' + PORT], { cwd: HERE, detached: true, stdio: 'ignore', env })
  child.unref()
  console.log('  起安装版（端口 ' + PORT + '，**没有**任何重定向 —— 它打开的是真库）')
  const evalIn = (expr) =>
    sh(process.execPath, [path.join(__dirname, 'cdp-eval.cjs'), expr], {
      env: { ...process.env, AVCA_CDP_PORT: PORT },
      maxBuffer: 16 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe']
    }).trim()
  let text = ''
  for (let i = 0; i < 40; i++) {
    try {
      text = evalIn('document.body.innerText')
      if (text && text.length > 40) break
    } catch {
      /* 还没起来 */
    }
    sleepSync(1500)
  }
  if (!text) {
    try {
      sh('taskkill', ['/IM', 'Atrium.exe', '/F'], { stdio: 'ignore' })
    } catch {
      /* 没在跑 */
    }
    die('安装版起不来（CDP 连不上端口 ' + PORT + '）')
  }
  const title = (() => {
    try {
      return evalIn('document.title')
    } catch {
      return ''
    }
  })()
  try {
    sh('taskkill', ['/IM', 'Atrium.exe', '/F'], { stdio: 'ignore' })
  } catch {
    /* 已经退了 */
  }
  sleepSync(2500)
  return { text, title }
}

/* ---------------------------------------------------------------- 各 stage */

const fails = []
function ok(cond, label, detail) {
  console.log('  ' + (cond ? '✅' : '❌') + ' ' + label + (detail ? '　' + detail : ''))
  if (!cond) fails.push(label)
}

function stageSnapshot() {
  console.log('=== stage snapshot · 装之前的指纹（只读） ===')
  saveSnapshot()
}

function stageInstall() {
  console.log('=== stage install · 真装 Setup.exe + 起一次看首启 ===')
  if (!fs.existsSync(SNAPSHOT)) die('先跑 --stage=snapshot（没有基线就没法对账）')
  runInstaller('第一次安装')
  const before = JSON.parse(fs.readFileSync(SNAPSHOT, 'utf8'))
  const { text, title } = bootAndInspect()
  console.log('  窗口标题：' + title)
  ok(text.indexOf('首次配置') < 0, '⭐ 老用户（库根早就配过）**没有被首启向导拦住**')
  ok(text.indexOf('库还没配好') < 0, '侧栏没有"库还没配好"（库根是设好的）')
  ok(text.indexOf('收件箱') >= 0, '进的是主界面（屏上有「收件箱」）')
  ok(/0\.2\.0/.test(text), '⭐ 右上角徽章写的是 v0.2.0（内部代号 R4/M7 不再上界面）', (text.match(/v\d\.\d\.\d[^\n]*/) || ['没找到版本号'])[0])
  ok(/库根目录[:：]\s*E:/.test(text) || /E:[\\/]vrc/.test(text), '状态栏显示的还是他的真库根', (text.match(/库根目录[^\n]*/) || ['—'])[0])
  const after = fingerprint()
  ok(diffSnapshots(before, after), '装完 + 起过一次之后逐表对账：除 project 的 last_seen/is_running 外一字不差')
  fs.writeFileSync(SNAPSHOT, JSON.stringify(after, null, 2))
  console.log('  （指纹已更新为安装后的基线，供 --stage=overwrite 对比）')
}

function stageOverwrite() {
  console.log('=== stage overwrite · 覆盖安装同一个包，验用户改动不丢 ===')
  if (!fs.existsSync(SNAPSHOT)) die('先跑 --stage=snapshot / install')
  if (!fs.existsSync(INSTALLED_EXE)) die('还没装过：' + INSTALLED_EXE)
  const before = JSON.parse(fs.readFileSync(SNAPSHOT, 'utf8'))
  runInstaller('覆盖安装')
  const { text } = bootAndInspect()
  ok(text.indexOf('首次配置') < 0, '⭐ 覆盖安装之后**没有被当成全新安装**（不弹向导）')
  ok(/0\.2\.0/.test(text), '覆盖安装之后版本还是 v0.2.0')
  const after = fingerprint()
  const same = diffSnapshots(before, after)
  ok(same, '⭐ 覆盖安装之后用户改动全在（口语增量 / 设置 / 已学规则 / 密码库 / 素材记录）')
  const keysBefore = JSON.stringify(before.settings_keys)
  const keysAfter = JSON.stringify(after.settings_keys)
  ok(keysBefore === keysAfter, 'settings.json 里那九个关键字段一字不变', keysBefore === keysAfter ? '' : keysBefore + ' → ' + keysAfter)
  ok(
    before.files.categories_user && after.files.categories_user
      ? before.files.categories_user.hash === after.files.categories_user.hash
      : !before.files.categories_user && !after.files.categories_user,
    '用户口语增量文件（categories.user.json）没被覆盖安装改写',
    (before.files.categories_user ? before.files.categories_user.size + ' 字节 #' + before.files.categories_user.hash : '本来就没有') +
      ' → ' + (after.files.categories_user ? after.files.categories_user.size + ' 字节 #' + after.files.categories_user.hash : '没有')
  )
}

function stageDiff() {
  console.log('=== stage diff · 只读：现在的真库 vs 指纹基线 ===')
  if (!fs.existsSync(SNAPSHOT)) die('没有基线指纹，先跑 --stage=snapshot')
  const before = JSON.parse(fs.readFileSync(SNAPSHOT, 'utf8'))
  const after = fingerprint()
  ok(diffSnapshots(before, after), '对账通过')
}

function main() {
  const stages = { snapshot: stageSnapshot, install: stageInstall, overwrite: stageOverwrite, diff: stageDiff }
  const fn = stages[STAGE]
  if (!fn) die('不认识的 stage：' + STAGE + '（snapshot|install|overwrite|diff）')
  try {
    fn()
  } catch (e) {
    console.log('  💥 ' + String(e && e.message).slice(0, 500))
    fails.push(STAGE + ' 崩：' + String(e && e.message).slice(0, 140))
  }
  console.log('\n=== 小结 ===')
  console.log('红 ' + fails.length + ' 条')
  for (const f of fails) console.log('  ❌ ' + f)
  process.exit(fails.length ? 1 : 0)
}
main()
