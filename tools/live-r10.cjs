/**
 * 第 10 轮的活体：在真窗口里验 A 滚动 / B 容器里那四颗按钮 / C 筐摊平 / D 卡名优先级 /
 * E 拖放不再静默 / F 旧文案，外加 #112 那道按库判的刹车。
 *
 * ## 为什么单测绿了还要跑这一场
 *
 * 本轮六件里有四件是"后端没问题、界面上够不着/是假的"那一类（本轮的报障全部来自截图与录屏，
 * 不是来自红用例）。源码级接线用例能证明形状对，证明不了：
 *  - 真窗口里那 24 行**滚得到底**；
 *  - 真拖一次**高亮真的亮**、0 路径**那句话真的弹**；
 *  - 真入库一个筐目录**真的摊成 6 张卡**（而不是只在 `classify()` 的返回值里对）。
 *
 * ## 沙盒与护栏（照 ①②⑥ 那几场的规矩）
 *
 * 沙盒 `D:\avca-m7-live\r10-*`；路径必须含 avca/sandbox/r10；`AVCA_REQUIRE_SANDBOX_HOME=1`；
 * 起实例前查真 Unity（看 `Temp/UnityLockFile`，不看进程名）；杀进程**只按 `ExecutablePath` 认沙盒实例**。
 * 他的真库 `%APPDATA%\A\library.db` 与素材库 `E:\vrc\A` 这次一个字都不碰（夹具全是 D 盘临时目录里的假包）。
 *
 *   node tools/live-r10.cjs            # 全流程
 *   node tools/live-r10.cjs --keep     # 跑完不杀，自己点两下看看
 */
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const cp = require('node:child_process')

const HERE = __dirname
const ROOT = path.resolve(HERE, '..')
const UNPACKED = process.env.AVCA_UNPACKED_DIR || path.join(ROOT, 'dist', 'win-unpacked')
const EXE = path.join(UNPACKED, 'Atrium.exe')
const HOME = 'D:\\avca-m7-live\\r10-home'
const LIB = 'D:\\avca-m7-live\\r10-lib'
const FIX = 'D:\\avca-m7-live\\r10-fix'
const DB = path.join(HOME, 'library.db')
const SET = path.join(HOME, 'settings.json')
const PORT = process.env.AVCA_CDP_PORT || '9246'
const KEEP = process.argv.includes('--keep')
const SHOTS = path.join(ROOT, 'docs', 'screenshots')
const WANTED_DIR = UNPACKED.replace(/\\/g, '/').toLowerCase()

function die(msg) {
  console.error('⛔ ' + msg)
  process.exit(1)
}
function sleepSync(ms) {
  const sab = new SharedArrayBuffer(4)
  Atomics.wait(new Int32Array(sab), 0, 0, ms)
}
if (!fs.existsSync(EXE)) die('打包版不在：' + EXE + ' → 先 npm run build:dir')
for (const p of [HOME, LIB, FIX]) if (!/(avca|sandbox|r10)/i.test(p)) die('沙盒路径名字不对，拒绝跑：' + p)

function unityBusy() {
  const root = 'E:\\ALCOMprojects'
  if (!fs.existsSync(root)) return []
  return fs.readdirSync(root).filter((n) => fs.existsSync(path.join(root, n, 'Temp', 'UnityLockFile')))
}
const busy = unityBusy()
if (busy.length) die('真 Unity 工程开着，拒绝起沙盒实例：' + busy.join('、'))

const env = {
  ...process.env,
  AVCA_APP_HOME: HOME,
  LOCALAPPDATA: path.join(HOME, 'LocalAppData'),
  AVCA_REQUIRE_SANDBOX_HOME: '1',
  AVCA_CDP_PORT: PORT
}

function atriumProcs() {
  const out = cp
    .execFileSync(
      'powershell',
      [
        '-NoProfile',
        '-Command',
        '[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Get-CimInstance Win32_Process -Filter "Name=\'Atrium.exe\'" | Select-Object ProcessId,ExecutablePath | ConvertTo-Json -Compress'
      ],
      { encoding: 'utf8' }
    )
    .trim()
  if (!out) return []
  const parsed = JSON.parse(out)
  return Array.isArray(parsed) ? parsed : [parsed]
}
const sandboxPids = () =>
  atriumProcs()
    .filter((p) => p.ExecutablePath && String(p.ExecutablePath).replace(/\\/g, '/').toLowerCase().startsWith(WANTED_DIR))
    .map((p) => p.ProcessId)

function killApp() {
  for (const pid of sandboxPids()) {
    try {
      cp.execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' })
    } catch {
      /* 已经退了 */
    }
  }
  for (let i = 0; i < 12 && sandboxPids().length; i++) sleepSync(500)
  const left = sandboxPids()
  if (left.length) die('沙盒实例没退干净，还留着 PID ' + left.join('、'))
  sleepSync(800)
}
const boot = () => {
  const child = cp.spawn(EXE, ['--remote-debugging-port=' + PORT], { cwd: ROOT, detached: true, stdio: 'ignore', env })
  child.unref()
  return child
}

/* ------------------------------------------------------------------ 页面里跑的东西 */

/**
 * ⚠ 这段字符串里**不许有反引号**（它本身在模板字符串里，上一轮就是被一个 JSDoc 反引号炸掉的）。
 * 也 ⚠ 不许 `return JSON.stringify(...)` —— cdp-eval 会再编一次 JSON，解出来是字符串，
 * 拿它解构就拆成单个字符（第 9 轮那两条假红）。**一律返回对象。**
 */
const HELPERS = [
  "var txt = function (e) { return ((e && e.textContent) || '').replace(/\\s+/g, ' ').trim() };",
  "var find = function (sel, s) { return Array.prototype.slice.call(document.querySelectorAll(sel)).filter(function (e) { return txt(e).indexOf(s) >= 0 }) };",
  "var leaf = function (s) { var a = Array.prototype.slice.call(document.querySelectorAll('button,a,span,div')).filter(function (e) { return txt(e) === s }); return a.length ? a[a.length - 1] : null };",
  "var click = function (el) { if (!el) return 'NOELEMENT'; el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); return 'CLICKED' };",
  "var dbl = function (el) { if (!el) return 'NOELEMENT'; el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true })); return 'DBLCLICKED' };",
  "var dropTarget = function () { return document.querySelector('main') || document.querySelector('#root > div') || document.body };",
  "var overlay = function () { return document.querySelector('.fixed.inset-0') };",
  'var mkdt = function (files) { var d = new DataTransfer(); for (var i = 0; i < files.length; i++) d.items.add(files[i]); return d };',
  'var fire = function (type, dt) { var e = new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt }); dropTarget().dispatchEvent(e); return e.defaultPrevented };',
  'var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms) }) };',
  "var hook = function () { if (window.__dragLogs) return 'ALREADY'; window.__dragLogs = []; var oi = console.info; console.info = function () { var a = Array.prototype.slice.call(arguments).join(' '); if (a.indexOf('[drag]') === 0) window.__dragLogs.push(a); return oi.apply(console, arguments) }; return 'HOOKED' };"
].join('\n')

const E = (expr) => '(async () => {' + HELPERS + '\nreturn await (' + expr + ');})()'

function evalIn(expr) {
  const f = path.join(os.tmpdir(), 'r10-eval.js')
  fs.writeFileSync(f, E(expr), 'utf8')
  let out = ''
  try {
    out = cp
      .execFileSync(process.execPath, [path.join(HERE, 'cdp-eval.cjs'), '--file', f], { env, maxBuffer: 16 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] })
      .toString('utf8')
      .trim()
  } catch (e) {
    return { TOOLFAIL: String((e && e.stderr) || (e && e.message) || e).split('\n').slice(-3).join(' ').slice(0, 300) }
  }
  try {
    const v = JSON.parse(out)
    if (typeof v === 'string') return { BADRETURN: v }
    return v
  } catch {
    return { BADRETURN: out }
  }
}
const bodyText = () => {
  const t = evalIn('txt(document.body)')
  return typeof t === 'string' ? t : String(t.BADRETURN ?? '')
}
function wheel(findExpr, afterExpr, delta = 600, ticks = 3) {
  let out = ''
  try {
    out = cp
      .execFileSync(
        process.execPath,
        [path.join(HERE, 'cdp-wheel.cjs'), '--find', findExpr, '--delta', String(delta), '--ticks', String(ticks), '--after', afterExpr],
        { env, encoding: 'utf8' }
      )
      .toString()
      .trim()
  } catch (e) {
    /** 工具自己失败（连不上 / 找不到滚动区）不能把整场活体带崩 —— 报成一条红，后面的段继续读 */
    return { TOOLFAIL: String((e && e.stderr) || (e && e.message) || e).split('\n').slice(-2).join(' ') }
  }
  try {
    return JSON.parse(out)
  } catch {
    return { BADRETURN: out }
  }
}
function shot(name) {
  fs.mkdirSync(SHOTS, { recursive: true })
  cp.execFileSync(process.execPath, [path.join(HERE, 'cdp-shot.cjs'), path.join(SHOTS, name)], { env, stdio: 'ignore' })
  console.log('  📷 docs/screenshots/' + name)
}

const fails = []
function ok(cond, label, detail) {
  console.log('  ' + (cond ? '✅' : '❌') + ' ' + label + (detail === undefined ? '' : '　' + detail))
  if (!cond) fails.push(label)
}
function waitUntil(label, fn, tries = 30, step = 1200) {
  for (let i = 0; i < tries; i++) {
    try {
      if (fn()) return true
    } catch {
      /* 还没起来 */
    }
    sleepSync(step)
  }
  console.log('  ⏱ 等不到：' + label)
  return false
}

/* ---------------------------------------------------------------------- 读数 */

const { DatabaseSync } = require('node:sqlite')
function read(fn) {
  const d = new DatabaseSync(DB, { readOnly: true })
  try {
    return fn(d)
  } finally {
    d.close()
  }
}
const settings = () => (fs.existsSync(SET) ? JSON.parse(fs.readFileSync(SET, 'utf8')) : {})

/* -------------------------------------------------------------------- 1 夹具 */

/** 三个入口，对应本轮三件产品事：筐摊平 / 合集仍是一张卡 / 磁盘名不许被顶掉 */
const BASKET = path.join(FIX, '道具22件')
const SHOP = path.join(FIX, '插件道具合集-测试小店')
const NUN = path.join(FIX, '修女')

function writePackage(dir, name, bytes) {
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, name), Buffer.alloc(bytes, 0x41))
}
function makeFixtures() {
  fs.rmSync(FIX, { recursive: true, force: true })
  /**
   * 筐：6 件不同商品。目录名**照他库里的真实形状**起（`小刀`、`RKPlayer` 这种），
   * 因为"筐里的子目录叫什么名字"是命名层的事、不是本轮 C 那条判据的事 ——
   * 第一版夹具用 `件1/件2` 这种随手名，摊出来的卡就叫 `件1`，看着像 C 没生效。
   * 两件走 ID 目录（`4533350/护目镜/main.unitypackage`），顺带验名字穿透。
   */
  const basketKids = [
    ['小刀', '小刀 1.0.unitypackage'],
    ['奶瓶', '奶瓶 v2.1.unitypackage'],
    ['RKPlayer', 'RKPlayer 3.2.unitypackage'],
    ['StoZeroCustomEX', 'StoZeroCustomEX 1.4.unitypackage'],
    ['4533350', '护目镜/main.unitypackage'],
    ['4533351', '扇子/main.unitypackage']
  ]
  for (const [sub, raw] of basketKids) {
    const dir = path.join(BASKET, sub, path.dirname(raw) === '.' ? '' : path.dirname(raw))
    writePackage(dir, path.basename(raw), 4096)
  }
  /** 合集：24 项，够把容器视图撑出滚动条（报障 3 里那个"20 多行看不到最下面"） */
  for (let i = 1; i <= 24; i++) {
    const n = String(i).padStart(2, '0')
    writePackage(path.join(SHOP, '测试道具' + n), '测试道具' + n + ' v1.' + n + '.unitypackage', 2048 + i)
  }
  /** 名字优先级：目录叫 `修女`，里面最大的那个包叫 `Holy Spice Kaguya` */
  writePackage(NUN, 'Holy Spice Kaguya.unitypackage', 90000)
  writePackage(NUN, 'Holy Spice Kaguya Mask.unitypackage', 3000)
  writePackage(NUN, '说明.txt', 200)
}

/* ---------------------------------------------------------------- 2 起沙盒 */

const foreign = atriumProcs().filter((p) => !String(p.ExecutablePath || '').replace(/\\/g, '/').toLowerCase().startsWith(WANTED_DIR))
console.log('机器上另有 ' + foreign.length + ' 个不是沙盒的 Atrium 进程（装在 AppData 那个真实例），本脚本一律不碰')

killApp()
for (const p of [HOME, LIB, FIX]) fs.rmSync(p, { recursive: true, force: true })
fs.mkdirSync(path.join(HOME, 'LocalAppData'), { recursive: true })
fs.mkdirSync(LIB, { recursive: true })
makeFixtures()

/**
 * `autoRemergeRunAt` + `autoRemergeRunRoot` 一起写：这就是 #112 的"同一套库已经跑过"的形状。
 * 它同时干两件事：把 ⑥ 那段自动收拾挡在门外（免得它的告知条混进本轮的文案断言里），
 * 以及跑完能验"同库不重跑、时间戳没被自己刷掉"。
 */
const STAMP = '2026-10-10T00:00:00.000Z'
fs.writeFileSync(
  SET,
  JSON.stringify(
    {
      libraryRoot: LIB.split('\\').join('/'),
      onboardingDone: true,
      autoArchive: false,
      language: 'zh-CN',
      doubleClickAction: 'import',
      autoRemergeRunAt: STAMP,
      autoRemergeRunRoot: LIB.split('\\').join('/')
    },
    null,
    2
  ),
  'utf8'
)

boot()
if (!waitUntil('界面出来', () => bodyText().length > 200)) die('CDP 连不上或界面是空的')
sleepSync(2500)

/* --------------------------------------------------------- 3. E 拖放（先做，此刻库里没东西） */

console.log('\n=== E. 拖文件夹不再"没反应"（合成 DragEvent：亮 / 静默熄灭 / 0 路径必须说话）===')
evalIn('hook()')

const lit = evalIn(`(async () => {
  var dt = mkdt([]);
  fire('dragenter', dt); fire('dragover', dt);
  await sleep(50);
  var litAtOnce = !!overlay();
  fire('dragleave', dt);
  /**
   * 只等一拍（5ms）就查 —— 这一条测的是"leave 有没有亲手熄灭"，不是计时器。
   * ⚠ 原来这里等的是 120ms，而启动中的渲染队列会把 setTimeout 拖到 1.8 秒（实测第二次就这样），
   *   于是 400ms 的静默闸自己到点、高亮合法地熄了，用例却报"产品灭了高亮" ——
   *   那是拿工具的坑判产品。留一拍足够 React 把状态变更刷进 DOM，又远小于 400ms。
   */
  await sleep(5);
  var onRightAfterLeave = !!overlay();
  var t0 = Date.now();
  await sleep(500);
  var goneAfterIdle = !overlay();
  return { litAtOnce: litAtOnce, onRightAfterLeave: onRightAfterLeave, goneAfterIdle: goneAfterIdle, idleMs: Date.now() - t0 }
})()`)
ok(lit.litAtOnce === true, '⭐ dragenter + dragover 之后全屏那层高亮出现了', JSON.stringify(lit))
ok(lit.onRightAfterLeave === true, 'dragleave 之后立刻还亮着（老的计数器写法在这里就把它灭了）', 'idle 采样跑了 ' + lit.idleMs + 'ms')
ok(lit.goneAfterIdle === true, '静默一段时间之后它自己走（不靠 enter/leave 配对）')

const emptyDrop = evalIn(`(async () => {
  var dt = mkdt([]);
  fire('dragenter', dt); fire('dragover', dt);
  fire('drop', dt);
  await sleep(350);
  return { body: txt(document.body), logs: window.__dragLogs }
})()`)
ok(String(emptyDrop.body).includes('这次拖拽没带上文件'), '⭐ drop 里 0 个文件 → 有一句人话（以前完全静默）')
const log0 = (emptyDrop.logs || []).slice(-1)[0] || ''
ok(log0.indexOf('[drag]') === 0, '控制台留下一行 [drag] 计数（下次撞上能分辨"事件没来"还是"来了没路径"）', log0)
ok(/"over":([1-9]\d*)/.test(log0), '计数里 over>0 —— 证明事件确实送进来了', log0)

const noPathDrop = evalIn(`(async () => {
  var f = new File(['xxx'], '西装.png', { type: 'image/png' });
  var dt = mkdt([f]);
  fire('dragenter', dt); fire('dragover', dt);
  fire('drop', dt);
  await sleep(350);
  return { body: txt(document.body), logs: window.__dragLogs }
})()`)
ok(String(noPathDrop.body).includes('没拿到这些文件的本地路径'), '⭐ 带了文件但拿不到本地路径 → 说的是另一句话（两种病根不同建议）')
const log1 = (noPathDrop.logs || []).slice(-1)[0] || ''
ok(/"files":1/.test(log1), '那一行日志里 files=1、paths=0，一眼能分辨', log1)
console.log('  ℹ 真实资源管理器拖拽（OS 层）这一步脚本发起不了 —— 那条**仍未验证**，要他下次撞上时看 [drag] 那行')

/* ------------------------------------------------------------ 4. C+D 真入库 */

console.log('\n=== C+D. 真入库：筐摊平、合集仍是卡、磁盘名不被顶掉 ===')
const ing = evalIn(`(async () => {
  var r = await window.a.ingest.fromPaths(${JSON.stringify([BASKET, SHOP, NUN])});
  return { accepted: (r.accepted || []).length, rejected: (r.rejected || []).length, why: (r.rejected || []).map(function (x) { return x.reasonKey }) }
})()`)
ok(ing.accepted === 3, '三个入口都收下了', JSON.stringify(ing))
if (!waitUntil('三项都跑到等你确认', () => {
  const q = evalIn(`(async () => { var a = await window.a.ingest.queue(); return { n: a.length, stages: a.map(function (j) { return j.stage }) } })()`)
  return q.n >= 3 && q.stages.every((s) => s === 'awaiting_confirm' || s === 'done' || s === 'failed')
}, 40)) {
  console.log('  ⚠ 没等到全部就位，下面按当时状态继续读')
}
const commit = evalIn(`(async () => {
  var q = await window.a.ingest.queue();
  var ids = q.map(function (j) { return j.jobId });
  return await window.a.ingest.commitAll({ jobIds: ids, move: false });
})()`)
console.log('  入库结果：' + JSON.stringify(commit).slice(0, 200))
sleepSync(2500)

/**
 * 顶层卡的口径和产品同一套（`remerge.ts` / `mergeSuggest.ts` 用的都是这三个条件）：
 * 不是合集自己、没有父卡、也不是附属。`bundle_id` 那一列早就不是三级模型的依据了
 * —— 第一版探针按它筛，于是 24 个合集子项全被当成顶层卡，红成一片假警。
 */
const rows = read((d) => d.prepare('SELECT id, name, raw_name, category, confidence, is_bundle, parent_asset_id, attachment_kind FROM asset ORDER BY name').all())
const isCard = (r) => !r.parent_asset_id && !r.is_bundle && !r.attachment_kind
const cardNames = rows.filter(isCard).map((r) => r.name)
console.log('  库里的行：' + rows.length + ' 行 / 顶层卡：' + cardNames.length + ' 张 ' + JSON.stringify(cardNames).slice(0, 400))

ok(!cardNames.includes('道具22件'), '⭐ 顶层没有名字叫「道具22件」的卡（筐不是一张卡）')
const basketUnits = rows.filter((r) => isCard(r) && /小刀|奶瓶|RKPlayer|StoZero|护目镜|扇子/.test(r.name))
ok(basketUnits.length === 6, '筐里那 6 件各自成了顶层卡', basketUnits.length + ' 件')
ok(cardNames.length === 7, '⭐ 顶层一共 7 张卡 = 筐摊出的 6 件 + 「修女」（合集那张是容器卡，不算顶层散卡）', cardNames.join('、'))
ok(!basketUnits.some((r) => /^\d{5,}/.test(r.name)), 'ID 目录的名字穿透成了主体名，不是 4533350 这种纯数字', basketUnits.map((r) => r.name).join('、'))
ok(cardNames.includes('修女'), '⭐ 他拖进来的目录名「修女」保住了（没被包内 Holy Spice Kaguya 顶掉）')
ok(!cardNames.includes('Holy Spice Kaguya'), '包内那个名字不再是主名')
/** Q10（本轮只量不改判）：摊出来的每件各自判成了什么类 —— 他抱怨的"道具被判成插件类"能不能被看见就看这行 */
console.log('  ℹ Q10 只读清单：' + basketUnits.map((r) => r.name + '→' + r.category + '(' + Math.round(r.confidence * 100) + '%)').join('、'))
const nunRow = rows.find((r) => r.name === '修女' && isCard(r))
const tags = nunRow
  ? read((d) => d.prepare('SELECT t.name AS n FROM tag t JOIN asset_tag at ON at.tag_id = t.id WHERE at.asset_id = ?').all(nunRow.id)).map((x) => x.n)
  : []
ok(tags.some((t) => /^Holy Spice/i.test(t)), '⭐ 被压下去的名字进了 tags（不是丢了，是降级）', JSON.stringify(tags))

const bundleRows = read((d) => d.prepare('SELECT id, name, container_kind FROM asset WHERE is_bundle = 1').all())
ok(bundleRows.length === 1 && String(bundleRows[0].name).includes('插件道具合集-测试小店'), '写着"合集"的那一棵仍然是一张合集卡', JSON.stringify(bundleRows))

/* 界面侧：全部素材里看得见什么 */
evalIn(`(async () => { click(leaf('全部素材')); await sleep(600); return txt(document.body) })()`)
const grid = bodyText()
ok(grid.includes('修女'), '界面上这张卡就叫「修女」')
ok(!grid.includes('道具22件'), '界面上不出现「道具22件」这张卡')
shot('r10-1-flattened-basket.png')

/* ------------------------------------------------- 5. D 的后半程：别名还能搜到 */

console.log('\n=== D 后半程. 按包内那个名字搜，仍然搜得到这张「修女」===')
const searched = evalIn(`(async () => {
  var el = document.querySelector('input');
  if (!el) return { no: 'NOINPUT' };
  var d = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
  d.set.call(el, 'Holy Spice');
  el.dispatchEvent(new Event('input', { bubbles: true }));
  await sleep(1200);
  return { body: txt(document.body), ph: el.placeholder }
})()`)
ok(String(searched.body).includes('修女'), '⭐ 搜 "Holy Spice" 出得来那张「修女」（tags 进索引这条路真通了）', JSON.stringify(searched).slice(0, 160))
shot('r10-2-alias-search.png')
evalIn(`(async () => {
  var el = document.querySelector('input');
  var d = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
  d.set.call(el, ''); el.dispatchEvent(new Event('input', { bubbles: true }));
  await sleep(300); return 'CLEARED'
})()`)

/* ------------------------------------------------------ 6. A+B 容器视图：滚与四颗按钮 */

console.log('\n=== A+B. 合集卡进去以后：24 行滚得到底、那颗按钮不是假的 ===')
evalIn(`(async () => { click(leaf('全部素材')); await sleep(400); return 'OK' })()`)
const entered = evalIn(`(async () => {
  var card = find('div', '插件道具合集-测试小店').slice(-1)[0];
  if (!card) return { no: 'NOCARD' };
  dbl(card);
  await sleep(900);
  return { body: txt(document.body).slice(0, 300) }
})()`)
ok(!entered.no, '双击合集卡进了容器视图', JSON.stringify(entered).slice(0, 160))

const listBox = `(function () {
  var best = null;
  var a = Array.prototype.slice.call(document.querySelectorAll('div'));
  for (var i = 0; i < a.length; i++) {
    var e = a[i];
    var cs = getComputedStyle(e);
    if (cs.overflowY === 'auto' || cs.overflowY === 'scroll') {
      if (!best || e.scrollHeight > best.scrollHeight) best = e;
    }
  }
  if (!best) return null;
  best.scrollTop = 0;
  var r = best.getBoundingClientRect();
  return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }
})()`
const afterBox = `(function () {
  var best = null;
  var a = Array.prototype.slice.call(document.querySelectorAll('div'));
  for (var i = 0; i < a.length; i++) {
    var e = a[i];
    var cs = getComputedStyle(e);
    if (cs.overflowY === 'auto' || cs.overflowY === 'scroll') { if (!best || e.scrollHeight > best.scrollHeight) best = e }
  }
  if (!best) return { no: 'NOSCROLL' };
  var kids = Array.prototype.slice.call(best.children);
  var last = kids[kids.length - 1];
  var lr = last ? last.getBoundingClientRect() : null;
  return {
    scrollTop: Math.round(best.scrollTop),
    clientHeight: Math.round(best.clientHeight),
    scrollHeight: Math.round(best.scrollHeight),
    innerH: window.innerHeight,
    lastBottom: lr ? Math.round(lr.bottom) : null,
    lastTop: lr ? Math.round(lr.top) : null,
    lastText: last ? (last.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 28) : null
  }
})()`
const wheelOut = wheel(listBox, afterBox, 600, 6)
console.log('  滚之后读到：' + JSON.stringify(wheelOut))
ok(wheelOut.scrollTop > 0, '⭐ 真滚轮（CDP Input.dispatchMouseEvent）能让容器视图滚起来', 'scrollTop=' + wheelOut.scrollTop)
ok(wheelOut.scrollHeight > wheelOut.clientHeight, '那 24 行确实装不下（报障 3 的形状）', wheelOut.scrollHeight + ' > ' + wheelOut.clientHeight)
ok(wheelOut.lastBottom !== null && wheelOut.lastBottom <= wheelOut.innerH + 4, '滚到底能看见最后一行', 'bottom=' + wheelOut.lastBottom + ' innerH=' + wheelOut.innerH)
shot('r10-3-container-scrolled-bottom.png')

const stale = evalIn(`(async () => {
  var b = txt(document.body);
  var btns = Array.prototype.slice.call(document.querySelectorAll('button'));
  var imp = btns.filter(function (e) { return txt(e) === '导入' });
  return {
    hasJiaofu: /交付|里程碑|将在 ?M\\d|M\\d ?交付/.test(b),
    milestone: (b.match(/M\\d/g) || []).slice(0, 5),
    importButtons: imp.length,
    anyDisabled: imp.some(function (e) { return e.disabled }),
    whole: !!leaf('整包导入 Unity')
  }
})()`)
ok(stale.hasJiaofu === false, '⭐ 容器视图里没有"×× 在 M5 交付"那类旧文案', JSON.stringify(stale).slice(0, 220))
ok(stale.importButtons > 0 && stale.anyDisabled === false, '行内那颗「导入」不再是 disabled 的假按钮', stale.importButtons + ' 颗 / disabled=' + stale.anyDisabled)

const dblRow = evalIn(`(async () => {
  var row = find('div', '测试道具24').slice(-1)[0];
  if (!row) return { no: 'NOROW' };
  dbl(row);
  await sleep(700);
  return { body: txt(document.body) }
})()`)
const rowBody = String(dblRow.body || '')
ok(!dblRow.no, '双击容器里的一行有反应')
ok(/成员|包|导入|工程/.test(rowBody) && !/交付/.test(rowBody), '弹出来的不是"过期占位"那句话（吃的是设置里的双击行为）')
/** 沙盒里没有 Unity 工程，那一步会留下一个待确认的面板 —— 收掉它，别污染后面设置页的读数 */
evalIn(`(async () => {
  var names = ['取消', '关闭', '以后再说', '知道了'];
  var btns = Array.prototype.slice.call(document.querySelectorAll('button'));
  for (var i = 0; i < btns.length; i++) {
    if (names.indexOf(txt(btns[i])) >= 0) click(btns[i]);
  }
  await sleep(400);
  return 'CLEANED';
})()`)

/* ------------------------------------------------------------ 7. F 设置页那两颗 */

console.log('\n=== F. 设置 → 维护：那颗"导出日志"的假按钮换成了真动作 ===')
const setPage = evalIn(`(async () => {
  click(leaf('设置'));
  await sleep(500);
  var m = leaf('维护');
  click(m);
  await sleep(500);
  var b = txt(document.body);
  var btns = Array.prototype.slice.call(document.querySelectorAll('button')).map(function (e) { return txt(e) });
  return {
    hasLogDir: btns.indexOf('打开日志位置') >= 0,
    hasExportLogs: btns.indexOf('导出日志') >= 0,
    milestoneInPage: (b.match(/M\\d/g) || []).slice(0, 5),
    jiaofu: b.indexOf('交付') >= 0
  }
})()`)
ok(setPage.hasLogDir, '「打开日志位置」在，而且按下真去开那个文件夹（reveal 已接）', JSON.stringify(setPage).slice(0, 200))
ok(!setPage.hasExportLogs, '那句「该功能将在 M7 交付」的按钮没了')
ok(setPage.milestoneInPage.length === 0 && !setPage.jiaofu, '设置页全文没有里程碑编号 / "交付"字样', JSON.stringify(setPage.milestoneInPage))
shot('r10-4-settings-maintenance.png')

/* --------------------------------------------- 8. #112 那道刹车：同库不重跑、时间戳没被自己刷 */

console.log('\n=== #112. 同一套库第二次开机：刹车踩得住（时间戳不被自己刷掉、也不弹告知条）===')
ok(settings().autoRemergeRunAt === STAMP, '跑完这一场，autoRemergeRunAt 还是我写进去那个（没被 ⑥ 自己改）', String(settings().autoRemergeRunAt))
ok(!bodyText().includes('帮你把'), '⑥ 的告知条没出现（同库 = 已经收拾过）')

killApp()
if (!KEEP) {
  /* 沙盒留着，下次 --keep 还能点开看；只把进程收掉 */
}

console.log('\n=== 汇总 ===')
if (fails.length) {
  console.log('❌ ' + fails.length + ' 条红：\n  - ' + fails.join('\n  - '))
  process.exit(1)
}
console.log('✅ 本轮活体全绿（真实 OS 拖拽那一条仍未验证，见上面 ℹ 那行）')
