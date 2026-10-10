/**
 * 第 9 轮 ① 的活体：在真窗口里把「待复核」的出口走一遍。
 *
 * 为什么必须单独跑这一场：`assets:set-review` 后端到前端**早就通了**，
 * 但渲染层只有合集详情那颗按钮在调它 —— 单卡根本没有出口。
 * 这种"通道在、没人按"的缺陷，单测和 tsc 都看不出来（它们只证明代码能跑，不证明用户点得到）。
 *
 * 沙盒：`D:\avca-m7-live\r9-home`（运行目录）+ `D:\avca-m7-live\r9-lib`（库根）。
 * 三道护栏照第 7 轮的规矩：路径必须含 avca/sandbox、`AVCA_REQUIRE_SANDBOX_HOME=1`、
 * 起实例之前查真 Unity（**看 Temp/UnityLockFile，不看进程名**）。
 *
 * 数据是**直接写沙盒库**造的（3 张单卡待复核 + 1 张待复核合集卡带 1 个成员 + 1 张干净卡 + 1 条附属）。
 * 这不是偷懒也不是作弊，但要写清楚：`needs_review` 这一列怎么被**写上**的，
 * 由 `tests/library/commit*.spec.ts` 那批用例管；这一场测的是**怎么把它清掉**的用户路径，
 * 而且只测一条判据之外的东西：**点得到、点完数真的掉、没有哪一行是清不掉的死账**。
 *
 *   node tools/live-r9-review.cjs            # 全流程
 *   node tools/live-r9-review.cjs --keep     # 跑完不杀进程（自己点两下看看）
 */
const fs = require('node:fs')
const path = require('node:path')
const cp = require('node:child_process')

const HERE = __dirname
const ROOT = path.resolve(HERE, '..')
const EXE = path.join(ROOT, 'dist', 'win-unpacked', 'Atrium.exe')
const HOME = 'D:\\avca-m7-live\\r9-home'
const LIB = 'D:\\avca-m7-live\\r9-lib'
const DB = path.join(HOME, 'library.db')
const PORT = process.env.AVCA_CDP_PORT || '9243'
const KEEP = process.argv.includes('--keep')
const SHOTS = path.join(ROOT, 'docs', 'screenshots')

function die(msg) {
  console.error('⛔ ' + msg)
  process.exit(1)
}
function sleepSync(ms) {
  const sab = new SharedArrayBuffer(4)
  Atomics.wait(new Int32Array(sab), 0, 0, ms)
}
if (!fs.existsSync(EXE)) die('打包版不在：' + EXE + ' → 先 npm run build:dir')
for (const p of [HOME, LIB]) if (!/(avca|sandbox|r9)/i.test(p)) die('沙盒路径名字不对，拒绝跑：' + p)

/** 真 Unity 开着就不许起实例（沙盒实例照样会发现真工程，见 BRIDGE.md §13.4） */
function unityBusy() {
  const root = 'E:\\ALCOMprojects'
  if (!fs.existsSync(root)) return []
  const out = []
  for (const name of fs.readdirSync(root)) {
    if (fs.existsSync(path.join(root, name, 'Temp', 'UnityLockFile'))) out.push(name)
  }
  return out
}
const busy = unityBusy()
if (busy.length) die('真 Unity 工程开着，拒绝起沙盒实例：' + busy.join('、'))

const env = { ...process.env, AVCA_APP_HOME: HOME, LOCALAPPDATA: path.join(HOME, 'LocalAppData'), AVCA_REQUIRE_SANDBOX_HOME: '1', AVCA_CDP_PORT: PORT }
fs.mkdirSync(path.join(HOME, 'LocalAppData'), { recursive: true })

function boot() {
  const child = cp.spawn(EXE, ['--remote-debugging-port=' + PORT], { cwd: ROOT, detached: true, stdio: 'ignore', env })
  child.unref()
  return child
}
/**
 * **只杀这一个沙盒实例**，不按镜像名杀。
 *
 * 原来这里是 `taskkill /IM Atrium.exe /F` —— 那会把他桌面上正在用的那个真 Atrium 一起带走
 * （第 8 轮就差点这么干）。两场活体都改成：按 `ExecutablePath` 认人，
 * 只杀从 `dist/win-unpacked` 起来的进程；他的装在 `AppData\Local\Programs\Atrium` 下，不碰。
 * 沙盒实例和他的实例各用各的 userData（`AVCA_APP_HOME` 在 `requestSingleInstanceLock` 之前就定好了），
 * 所以并存不会互相顶掉。
 */
const WANTED_DIR = path.join(ROOT, 'dist', 'win-unpacked').replace(/\\/g, '/').toLowerCase()
function atriumProcs() {
  const out = cp
    .execFileSync(
      'powershell',
      [
        '-NoProfile',
        '-Command',
        /**
         * `[Console]::OutputEncoding=UTF8` 不是可选的装饰：这台机器的控制台默认码页是 cp936，
         * 不钉这一句时 `C:\程序\...` 回来是乱码，`startsWith` 永远比不中 →
         * **一个都杀不掉**，表现成"沙盒目录删不掉（EPERM）"。
         * 第一次跑就撞上了：看着像权限问题，其实是编码问题。
         */
        '[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Get-CimInstance Win32_Process -Filter "Name=\'Atrium.exe\'" | Select-Object ProcessId,ExecutablePath | ConvertTo-Json -Compress'
      ],
      { encoding: 'utf8' }
    )
    .trim()
  if (!out) return []
  let parsed = JSON.parse(out)
  if (!Array.isArray(parsed)) parsed = [parsed]
  return parsed
}
function sandboxPids() {
  return atriumProcs()
    /** 路径取不到（空/被拒）时**宁可不杀**：认不准就动手，杀错的就是用户正在用的那个窗口 */
    .filter((p) => p.ExecutablePath && String(p.ExecutablePath).replace(/\\/g, '/').toLowerCase().startsWith(WANTED_DIR))
    .map((p) => p.ProcessId)
}
function killApp() {
  for (const pid of sandboxPids()) {
    try {
      cp.execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' })
    } catch {
      /* 已经退了 */
    }
  }
  /** 等到真没了再走：Electron 的 crashpad / GPU 子进程会晚退几秒，固定 sleep 骗过不止一次 */
  for (let i = 0; i < 12 && sandboxPids().length; i++) sleepSync(500)
  const left = sandboxPids()
  if (left.length) die('沙盒实例没退干净，还留着 PID ' + left.join('、') + '（后面的判据全会因为"读的是上一个实例"而失真）')
  sleepSync(800)
}
/** 在渲染进程里跑一段 JS（写临时文件传，中文内联在命令行会被 shell 吃掉） */
function evalIn(expr) {
  const f = path.join(require('os').tmpdir(), 'r9-eval.js')
  fs.writeFileSync(f, expr, 'utf8')
  const out = cp.execFileSync(process.execPath, [path.join(HERE, 'cdp-eval.cjs'), '--file', f], {
    env,
    maxBuffer: 16 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe']
  }).toString('utf8').trim()
  try {
    return JSON.parse(out)
  } catch {
    return out
  }
}
function shot(name) {
  fs.mkdirSync(SHOTS, { recursive: true })
  cp.execFileSync(process.execPath, [path.join(HERE, 'cdp-shot.cjs'), path.join(SHOTS, name)], { env, stdio: 'ignore' })
  console.log('  📷 docs/screenshots/' + name)
}

const fails = []
function ok(cond, label, detail) {
  console.log('  ' + (cond ? '✅' : '❌') + ' ' + label + (detail ? '　' + detail : ''))
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

/**
 * 页面里通用的小工具：按文字找元素 / 点它 / 读侧栏那个数。
 *
 * ⚠ 选择器都是**照着真 DOM 核过**的，不是猜的：
 *  - 侧栏那一项是 `button.nav-item`，里面的计数是 `<Badge>` → 渲染成 `span.chip`（不是 `.badge`）；
 *  - 卡是 `div.card`（列表模式才是别的类），默认 layout=grid 所以这里用 `.card`；
 *  - 卡片 onClick 认 `e.ctrlKey`，所以多选要用带 ctrlKey 的 MouseEvent 合成事件。
 */
const HELPERS = `
  const txt = (e) => (e && e.textContent || '').replace(/\\s+/g,' ').trim();
  const find = (sel, s) => [...document.querySelectorAll(sel)].filter(e => txt(e).includes(s));
  const findHead = (sel, s) => [...document.querySelectorAll(sel)].filter(e => txt(e).startsWith(s));
  const badgeOf = (label) => {
    const item = find('.nav-item', label)[0];
    if (!item) return -1;
    const b = item.querySelector('.chip');
    return b ? parseInt(txt(b).replace(/\\D/g,''), 10) : 0;
  };
  const click = (el) => { if (!el) return 'NOELEMENT'; el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); return 'CLICKED'; };
  const clickText = (sel, s, ctrl) => {
    const el = find(sel, s)[0];
    if (!el) return 'NOELEMENT:' + s;
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: !!ctrl }));
    return 'CLICKED:' + txt(el).slice(0, 40);
  };
  const clickHead = (sel, s) => click(findHead(sel, s)[0]) + ':' + s;
  const dblText = (sel, s) => {
    const el = find(sel, s)[0];
    if (!el) return 'NOELEMENT:' + s;
    el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
    return 'DBLCLICKED:' + txt(el).slice(0, 30);
  };
  /** 勾某一行前面的那颗复选框（合集成员列表）。用 :scope> 是为了拿到"行"而不是整页 */
  const checkRow = (s) => {
    const rows = [...document.querySelectorAll('div')].filter((d) => d.querySelector(':scope > input[type=checkbox]') && txt(d).includes(s));
    if (!rows.length) return 'NOROW:' + s;
    const box = rows[0].querySelector('input[type=checkbox]');
    box.click();
    return 'CHECKED:' + txt(rows[0]).slice(0, 30);
  };
`

/**
 * 把一段"页面里要算的表达式"和 HELPERS 拼成一个**能跑**的函数体。
 * 必须是 `(function(){ 声明…; return 表达式 })()`：箭头函数不带花括号时函数体只能是一个表达式，
 * 而 HELPERS 是一串 `const …` 声明 —— 原来那种 `'(()=>' + HELPERS + 'x).()'` 拼出来直接 SyntaxError，
 * 被 `waitUntil` 的 try/catch 吞掉，表现成"界面没起来"（判据挂掉的方式是沉默，最难查）。
 */
const E = (expr) => '(function(){' + HELPERS + 'return (' + expr + ');})()'

/* ------------------------------------------------------------------ 1. 造沙盒 */

/** 先说清楚"外面还有几个不是我们的实例"，免得出问题时大家以为是脚本动的 */
const foreign = atriumProcs().filter((p) => !String(p.ExecutablePath || '').replace(/\\/g, '/').toLowerCase().startsWith(WANTED_DIR))
console.log('机器上另有 ' + foreign.length + ' 个不是沙盒的 Atrium 进程（装在 AppData 的那个），本脚本一律不碰')

killApp()
fs.rmSync(HOME, { recursive: true, force: true })
fs.rmSync(LIB, { recursive: true, force: true })
fs.mkdirSync(path.join(HOME, 'LocalAppData'), { recursive: true })
fs.mkdirSync(LIB, { recursive: true })
console.log('=== ① 第一次起进程：只为了让它把沙盒库建出来 ===')
boot()
if (!waitUntil('library.db 出现', () => fs.existsSync(DB), 25, 1200)) die('沙盒库没建出来：' + DB)
sleepSync(3000)
killApp()

/** 写库根 + 跳过首启向导，省掉一整段无关流程 */
fs.writeFileSync(
  path.join(HOME, 'settings.json'),
  JSON.stringify({ libraryRoot: LIB.split('\\').join('/'), onboardingDone: true, autoArchive: false, language: 'zh-CN' }, null, 2),
  'utf8'
)

console.log('=== ② 灌 7 行夹具（3 单卡待复核 + 1 张待复核合集卡带 1 个成员 + 1 干净 + 1 附属） ===')
const { DatabaseSync } = require('node:sqlite')
const db = new DatabaseSync(DB)
const now = Date.now()
/** 每张卡都造一个真的目录 + 文件，否则详情面板会挂着"路径不存在"那条红字，判据就不干净 */
function seed(id, name, opts = {}) {
  const dir = path.join(LIB, 'clothing', id)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'readme.txt'), id + ' fixture\n')
  db
    .prepare(
      `INSERT INTO asset (id,name,raw_name,category,confidence,status,library_path,storage_mode,kind,size_bytes,
                          is_bundle,needs_review,parent_asset_id,attachment_kind,created_at,updated_at)
       VALUES (?,?,?,?,?,'classified',?,'indexed','archive',1024,?,?,?,?,?,?)`
    )
    .run(
      id,
      name,
      name + '.zip',
      'clothing',
      opts.review ? 0.62 : 0.91,
      dir.split('\\').join('/'),
      opts.bundle ? 1 : 0,
      opts.review ? 1 : 0,
      opts.parent || null,
      opts.att || null,
      now,
      now
    )
}
db.prepare('DELETE FROM asset').run()
seed('r9a', 'R9 待复核甲', { review: true })
seed('r9b', 'R9 待复核乙', { review: true })
seed('r9c', 'R9 待复核丙', { review: true })
seed('r9bundle', 'R9 合集卡', { review: true, bundle: true })
/** 合集里必须真有个成员：那颗「标记已复核」要勾了成员才按得动，空合集验不了 */
seed('r9child', 'R9 合集成员', { review: true, parent: 'r9bundle' })
seed('r9clean', 'R9 干净卡', {})
/**
 * 附属那条是**故意留的陷阱**：它 needs_review=1 但挂在主体下面。
 * 侧栏那个数的口径是 `needs_review=1 AND parent IS NULL AND attachment_kind IS NULL`
 * （`src/main/db/index.ts:140`），列表那边是 `parent_asset_id IS NULL` ——
 * 两边都不该捞到它。它要是冒出来了，就是"用户数两遍"那个老毛病换了个地方长回来。
 */
seed('r9att', 'R9 附属（贴图）', { review: true, parent: 'r9clean', att: 'texture' })
db.close()
console.log('  灌完：待复核口径内 4 张卡（3 单卡 + 1 合集卡）+ 1 张干净 + 1 条附属 + 1 个合集成员')

/* ------------------------------------------------------------------ 2. 真点 */

console.log('\n=== ③ 起进程，在真窗口里走用户路径 ===')
boot()
if (!waitUntil('界面出来', () => typeof evalIn(E('txt(document.body)')) === 'string' && evalIn(E('txt(document.body)')).length > 40)) {
  die('CDP 连不上或界面是空的')
}
sleepSync(1500)

const readBadge = () => evalIn(E('badgeOf("待复核")'))
const cardIds = () => evalIn(E('find(".card","R9").map(txt).map(s=>s.slice(0,10))'))

console.log('--- 进「待复核」视图 ---')
evalIn(E('clickText(".nav-item","待复核")'))
waitUntil('4 张卡', () => cardIds().length === 4, 20)
ok(readBadge() === 4, '侧栏「待复核」计数 = 4（3 单卡 + 1 合集卡）', '读到 ' + readBadge())
ok(Array.isArray(cardIds()) && cardIds().length === 4, '列表里 4 张卡（那条附属没单独冒出来）', JSON.stringify(cardIds()))
shot('r9-01-review-view.png')

console.log('--- A1 · 单卡详情面板那颗「标记已复核」 ---')
evalIn(E('clickText(".card","R9 待复核甲")'))
sleepSync(1500)
const btnTexts = evalIn(E('find("button","标记已复核").map(txt)'))
ok(Array.isArray(btnTexts) && btnTexts.includes('标记已复核'), '⭐ 单卡详情面板出现了「标记已复核」（这就是本轮补的出口）', JSON.stringify(btnTexts))
ok(Array.isArray(btnTexts) && !btnTexts.some((s) => s.startsWith('标记已复核（')), '只选一张时工具栏那颗不出（同一个意图不留两个入口）', JSON.stringify(btnTexts))
shot('r9-02-single-card-button.png')
evalIn(E('click(find("button","标记已复核").filter(e=>txt(e)==="标记已复核")[0])'))
waitUntil('侧栏掉到 3', () => readBadge() === 3, 20)
const dbAfter1 = (() => {
  const d = new DatabaseSync(DB, { readOnly: true })
  const r = d.prepare('SELECT needs_review FROM asset WHERE id=?').get('r9a').needs_review
  d.close()
  return r
})()
ok(dbAfter1 === 0, '库里那一行真的被改了（不是只改了界面）', 'needs_review=' + dbAfter1)
ok(readBadge() === 3, '侧栏计数跟着掉到 3', '读到 ' + readBadge())
shot('r9-03-after-single.png')

console.log('--- A2 · 多选批量 + 二次确认的条数 ---')
evalIn(E('clickText(".card","R9 待复核乙",true)'))
sleepSync(900)
evalIn(E('clickText(".card","R9 待复核丙",true)'))
sleepSync(900)
const screenLabel = evalIn(E('findHead("button","这一屏全部标记已复核（").map(txt)'))
ok(
  Array.isArray(screenLabel) && screenLabel.length === 1 && screenLabel[0] === '这一屏全部标记已复核（2）',
  '「这一屏全部」写的是 2（合集卡不算在内，它有自己的那颗）',
  JSON.stringify(screenLabel)
)
const batchLabel = evalIn(E('findHead("button","标记已复核（").map(txt)'))
ok(Array.isArray(batchLabel) && batchLabel.length === 1 && batchLabel[0] === '标记已复核（2）', '工具栏出现「标记已复核（2）」', JSON.stringify(batchLabel))
shot('r9-04-batch-button.png')
evalIn(E('clickHead("button","标记已复核（")'))
waitUntil('确认框出来', () => evalIn(E('txt(document.body).includes("要把这些标成已复核吗")')) === true, 12)
const modalText = evalIn(E('txt(document.body)'))
ok(typeof modalText === 'string' && modalText.includes('将把 2 条'), '确认框写的条数是 2（不是选中数凑的）', JSON.stringify(String(modalText).match(/将把[^。]*。/)))
shot('r9-05-confirm-modal.png')
evalIn(E('clickText("button","确认标记")'))
waitUntil('侧栏掉到 1', () => readBadge() === 1, 20)
ok(readBadge() === 1, '批量点完只剩合集那一张', '读到 ' + readBadge())

console.log('--- 合集卡不许有第二个入口 ---')
evalIn(E('clickText(".card","R9 合集卡")'))
sleepSync(1500)
const bundleBtn = evalIn(E('find("button","标记已复核").length'))
ok(bundleBtn === 0, '⭐ 合集卡详情里**没有**那颗按钮（同一个意图不留两个入口）', '找到 ' + bundleBtn + ' 个')
shot('r9-06-bundle-no-button.png')

console.log('--- Q3 乙的反悔路径：干净卡上给"重新排进待复核" ---')
evalIn(E('clickText(".nav-item","全部素材")'))
sleepSync(1200)
evalIn(E('clickText(".card","R9 干净卡")'))
sleepSync(1500)
const undoLink = evalIn(E('find("button","重新排进待复核").length'))
ok(undoLink >= 1, '干净卡详情里有次要链接「重新排进待复核」', '找到 ' + undoLink + ' 个')
evalIn(E('clickText("button","重新排进待复核")'))
waitUntil('侧栏回到 2', () => readBadge() === 2, 20)
ok(readBadge() === 2, '点下去之后侧栏从 1 变回 2（反悔方式真的存在）', '读到 ' + readBadge())
shot('r9-07-reopened.png')

console.log('--- ⭐ 合集那条不是死账（本轮顺手查出来的第二个出口问题） ---')
/**
 * 合集卡自己的 `needs_review` 入库时是 `items.some(...)`（`commit.ts:540`），
 * 而 `BundleDetail` 原来那颗只清**成员行**、不清容器行，也不刷侧栏 ——
 * 于是成员全清完，这张卡还留在「待复核」里，而单卡那颗按钮对 `isBundle` 一律不出。
 * 两头一夹就是进得去出不来。这一段验的就是那条改法真的把口子接上了。
 */
evalIn(E('clickText(".nav-item","待复核")'))
sleepSync(1200)
evalIn(E('dblText(".card","R9 合集卡")'))
if (!waitUntil('进得去合集二级列表', () => evalIn(E('find("div","R9 合集成员").length>0 ')) === true, 15)) {
  ok(false, '双击合集卡进不到成员列表（后面那条死账判据没法验）')
} else {
  ok(true, '双击合集卡进到成员列表', '')
  evalIn(E('checkRow("R9 合集成员")'))
  sleepSync(800)
  evalIn(E('clickText("button","标记已复核")'))
  waitUntil('侧栏掉到 1', () => readBadge() === 1, 20)
  ok(readBadge() === 1, '⭐ 容器那一行跟着掉了（合集卡不再是清不掉的死账）', '读到 ' + readBadge())
  shot('r9-08-bundle-cleared.png')
  const d3 = new DatabaseSync(DB, { readOnly: true })
  const pair = ['r9bundle', 'r9child'].map((id) => d3.prepare('SELECT needs_review FROM asset WHERE id=?').get(id).needs_review)
  d3.close()
  ok(pair.join(',') === '0,0', '库里容器行和成员行都清了', 'needs_review=' + pair.join(','))
}

console.log('--- 收尾：最后一张单卡也能清掉（这一屏不该有出不去的行） ---')
evalIn(E('clickText(".nav-item","待复核")'))
sleepSync(1200)
evalIn(E('clickText(".card","R9 干净卡")'))
sleepSync(1500)
evalIn(E('click(find("button","标记已复核").filter(e=>txt(e)==="标记已复核")[0])'))
waitUntil('侧栏归零', () => readBadge() === 0, 20)
ok(readBadge() === 0, '⭐ 待复核清零：这场里每一行都有出口', '读到 ' + readBadge())
shot('r9-09-all-clear.png')

/* ------------------------------------------------------------------ 3. 收尾 */

console.log('\n--- 只读复核：素材目录里除了夹具没多出别的东西 ---')
const files = []
;(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name)
    if (e.isDirectory()) walk(p)
    else files.push(p)
  }
})(LIB)
ok(files.length === 7, '沙盒库根 7 个文件（每行夹具一个 readme.txt），没多没少 —— 复核只翻标记、不搬文件', files.length + ' 个')
const d2 = new DatabaseSync(DB, { readOnly: true })
const rows = d2.prepare('SELECT id, needs_review, library_path FROM asset ORDER BY id').all()
d2.close()
console.log('  最终 needs_review：' + rows.map((r) => r.id + '=' + r.needs_review).join(' '))
const byId = Object.fromEntries(rows.map((r) => [r.id, r]))
ok(byId.r9a.needs_review === 0, 'r9a 仍是已复核（关掉重开没被写回去）')
/** 附属那条从头到尾没人动它：它不进计数、不进列表，也就不会被"这一屏全部"顺手抹掉 */
ok(byId.r9att.needs_review === 1, '⭐ 那条附属没被批量顺手清掉（它压根不在这颗按钮的作用范围里）', 'needs_review=' + byId.r9att.needs_review)
ok(rows.every((r) => r.library_path.startsWith(LIB.split('\\').join('/'))), '每行的 library_path 都还在沙盒里（没有一次真搬盘）')

if (!KEEP) killApp()
console.log('\n=== 小结 ===')
console.log('红 ' + fails.length + ' 条')
for (const f of fails) console.log('  ❌ ' + f)
process.exit(fails.length ? 1 : 0)
