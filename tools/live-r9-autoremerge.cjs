/**
 * 第 9 轮 ⑥ 的活体：在真窗口里验「自动并完 + 事后告知」那一整套。
 *
 * ## 为什么必须单独跑这一场（它验的是 ② 那场反过来的一件事）
 *
 * ② 那场验的是"界面上点得到"；这一轮把确认那一步整个取消了，于是三件新的事只能靠真窗口才看得见：
 *
 *  1. **一次都不点，库里真的并好了** —— 单测能证明 `maybeAutoRemerge` 会调那两个 IPC，
 *     证明不了 boot 那一刻设置项、向导状态、库根三样真的凑齐了。
 *  2. **告知条出现在正确的时机，并且自己会走** —— 展开时不许被计时器收走，
 *     这条只能在真窗口里等 14 秒才知道。
 *  3. **刹车真的踩得住**（⑥ 最要紧的一条）：撤销之后重启，程序不能再把同一批卡并第二遍。
 *     这里用 E/F 两步做**对照**：两步只差 settings.json 里那个时间戳，
 *     E 不动、F 动 —— 才能证明拦住它的确实是那道闸，不是"恰好没跑起来"。
 *
 * ## 沙盒与护栏（照 ①② 那两场的规矩）
 *
 * 沙盒 `D:\avca-m7-live\r9c-home` + `r9c-lib`；路径必须含 avca/sandbox/r9；
 * `AVCA_REQUIRE_SANDBOX_HOME=1`；起实例前查真 Unity（看 `Temp/UnityLockFile`，不看进程名）；
 * 杀进程**只按 `ExecutablePath` 认沙盒实例**。真库那一次（任务 #97）不在这里跑。
 *
 *   node tools/live-r9-autoremerge.cjs          # 全流程
 *   node tools/live-r9-autoremerge.cjs --keep   # 跑完不杀，自己点两下看看
 */
const fs = require('node:fs')
const path = require('node:path')
const cp = require('node:child_process')

const HERE = __dirname
const ROOT = path.resolve(HERE, '..')
const UNPACKED = process.env.AVCA_UNPACKED_DIR || path.join(ROOT, 'dist', 'win-unpacked')
const EXE = path.join(UNPACKED, 'Atrium.exe')
const HOME = 'D:\\avca-m7-live\\r9c-home'
const LIB = 'D:\\avca-m7-live\\r9c-lib'
const DB = path.join(HOME, 'library.db')
const SET = path.join(HOME, 'settings.json')
const PORT = process.env.AVCA_CDP_PORT || '9245'
const KEEP = process.argv.includes('--keep')
const SHOTS = path.join(ROOT, 'docs', 'screenshots')
const WANTED_DIR = UNPACKED.replace(/\\/g, '/').toLowerCase()
/** 告知条自己收起的时间（比 NOTICE_AUTO_DISMISS_MS 多等几秒） */
const AUTO_DISMISS_WAIT = 15000

function die(msg) {
  console.error('⛔ ' + msg)
  process.exit(1)
}
function sleepSync(ms) {
  const sab = new SharedArrayBuffer(4)
  Atomics.wait(new Int32Array(sab), 0, 0, ms)
}
if (!fs.existsSync(EXE)) die('打包版不在：' + EXE + ' → 先 npx electron-builder --win --dir')
for (const p of [HOME, LIB]) if (!/(avca|sandbox|r9)/i.test(p)) die('沙盒路径名字不对，拒绝跑：' + p)

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
  let parsed = JSON.parse(out)
  if (!Array.isArray(parsed)) parsed = [parsed]
  return parsed
}
function sandboxPids() {
  return atriumProcs()
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
  for (let i = 0; i < 12 && sandboxPids().length; i++) sleepSync(500)
  const left = sandboxPids()
  if (left.length) die('沙盒实例没退干净，还留着 PID ' + left.join('、'))
  sleepSync(800)
}
function boot() {
  const child = cp.spawn(EXE, ['--remote-debugging-port=' + PORT], { cwd: ROOT, detached: true, stdio: 'ignore', env })
  child.unref()
  return child
}

const HELPERS = `
  const txt = (e) => (e && e.textContent || '').replace(/\\s+/g,' ').trim();
  const find = (sel, s) => [...document.querySelectorAll(sel)].filter(e => txt(e).includes(s));
  const click = (el) => { if (!el) return 'NOELEMENT'; el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); return 'CLICKED'; };
  // 告知条是 App 顶层 div 的后代，find("div","帮你把") 会把所有祖先一起带回来（文档序：外层在前）。
  // **取最后一个**才是条子自己 —— ② 那场就是拿 [0] 点到了外层容器的第一颗按钮（「检查一遍」）。
  const banner = () => { const ds = find("div","帮你把"); return ds[ds.length - 1] || null; };
  const clickInBanner = (label) => { const b = banner(); if (!b) return 'NOBANNER'; const btn = [...b.querySelectorAll("button")].filter(e => txt(e) === label)[0]; return btn ? click(btn) : 'NOBTN:' + [...b.querySelectorAll("button")].map(txt).join('|'); };
`
const E = (expr) => '(function(){' + HELPERS + 'return (' + expr + ');})()'

function evalIn(expr) {
  const f = path.join(require('os').tmpdir(), 'r9c-eval.js')
  fs.writeFileSync(f, E(expr), 'utf8')
  const out = cp
    .execFileSync(process.execPath, [path.join(HERE, 'cdp-eval.cjs'), '--file', f], {
      env,
      maxBuffer: 16 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe']
    })
    .toString('utf8')
    .trim()
  try {
    return JSON.parse(out)
  } catch {
    return out
  }
}
function bodyText() {
  const t = evalIn('txt(document.body)')
  return typeof t === 'string' ? t : String(t)
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
function waitUntil(label, fn, tries = 25, step = 1200) {
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

/* ------------------------------------------------------------------ 读数 */

const { DatabaseSync } = require('node:sqlite')
function read(fn) {
  const d = new DatabaseSync(DB, { readOnly: true })
  try {
    return fn(d)
  } finally {
    d.close()
  }
}
const groupsAll = () => read((d) => Number(d.prepare('SELECT COUNT(*) AS n FROM asset_group').get().n))
const libero = () =>
  read((d) => ({
    groups: Number(d.prepare(`SELECT COUNT(*) AS n FROM asset_group WHERE group_key LIKE 'libero%'`).get().n),
    key: String(d.prepare(`SELECT group_key AS k FROM asset_group WHERE group_key LIKE 'libero%' ORDER BY created_at LIMIT 1`).get().k),
    gids: Number(d.prepare(`SELECT COUNT(DISTINCT group_id) AS n FROM asset`).get().n),
    paths: Number(d.prepare('SELECT COUNT(DISTINCT library_path) AS n FROM asset').get().n),
    journal: Number(d.prepare(`SELECT COUNT(*) AS n FROM journal WHERE op='remerge'`).get().n)
  }))
const settings = () => (fs.existsSync(SET) ? JSON.parse(fs.readFileSync(SET, 'utf8')) : {})
const bannerUp = () => bodyText().includes('帮你把')

/* ---------------------------------------------------------------- 1. 沙盒 */

const foreign = atriumProcs().filter((p) => !String(p.ExecutablePath || '').replace(/\\/g, '/').toLowerCase().startsWith(WANTED_DIR))
console.log('机器上另有 ' + foreign.length + ' 个不是沙盒的 Atrium 进程（装在 AppData 那个真实例），本脚本一律不碰')

killApp()
fs.rmSync(HOME, { recursive: true, force: true })
fs.rmSync(LIB, { recursive: true, force: true })
fs.mkdirSync(path.join(HOME, 'LocalAppData'), { recursive: true })
fs.mkdirSync(LIB, { recursive: true })

console.log('\n=== A. 库根还没配的那次启动：判据就该拦住，一次都不许跑 ===')
boot()
if (!waitUntil('library.db 出现', () => fs.existsSync(DB), 25)) die('沙盒库没建出来：' + DB)
sleepSync(4000)
ok(!settings().autoRemergeRunAt, '⭐ 没配库根时不跑，也不落时间戳（一落就把这件事永久跳过了）', JSON.stringify(settings().autoRemergeRunAt ?? null))
ok(!bannerUp(), '那次启动也没冒告知条')
killApp()

/* ------------------------------------------------------- 2. 灌一棵老键的树 */

console.log('\n=== B. 灌一棵 Libero 同形的树（20 行 / 13 组，组键是 §B2 之前的老写法），然后什么都不点 ===')
const RAW = [
  'Libero[Selestia_ATTITUDE The Royal Bunny]_1.01.unitypackage',
  'Libero[Airi_ATTITUDE The Royal Bunny]_1.03.unitypackage',
  'Libero[Milltina_ATTITUDE The Royal Bunny]_1.02.unitypackage',
  'Libero[Shinra_ATTITUDE The Royal Bunny]_1.01.unitypackage',
  'Libero[Shinano_ATTITUDE The Royal Bunny]_1.00.unitypackage',
  'Libero[Manuka_ATTITUDE The Royal Bunny]_1.03.unitypackage',
  'Libero[Sio_ATTITUDE The Royal Bunny]_1.02.unitypackage',
  'Libero[Moe_ATTITUDE The Royal Bunny]_1.04.unitypackage',
  'Libero[Ichigo_ATTITUDE The Royal Bunny]_1.01.unitypackage',
  'Libero[Ramune_ATTITUDE The Royal Bunny]_1.00.unitypackage',
  'Libero[Lumina_ATTITUDE The Royal Bunny]_1.00.unitypackage',
  'Libero[Misaki_ATTITUDE The Royal Bunny]_1.00.unitypackage',
  'Libero[Sion_ATTITUDE The Royal Bunny]_1.01.unitypackage',
  'Libero[Kumaly_ATTITUDE The Royal Bunny]_1.00.unitypackage',
  'Libero[Lasyusha_ATTITUDE The Royal Bunny]_1.01.unitypackage',
  'Libero[Chiffon&Chocolat_ATTITUDE The Royal Bunny]_1.02.unitypackage',
  'Libero[Milfy&Eku_ATTITUDE The Royal Bunny]_1.01.unitypackage',
  'Libero[Nemesis&Elusion_ATTITUDE The Royal Bunny]_1.00.unitypackage',
  'Libero[Rurune&Mizuki_ATTITUDE The Royal Bunny]_1.00.unitypackage',
  'Libero[KipfelMame_ATTITUDE]_1.00.unitypackage'
]
const EIGHT = new Set(['Selestia', 'Airi', 'Milltina', 'Shinra', 'Shinano', 'Manuka', 'Sio', 'Moe'])
const modelOf = (raw) => /\[([^_\]]+)/.exec(raw)?.[1] ?? ''
const DIR = path.join(LIB, 'clothing', '名流')
fs.mkdirSync(DIR, { recursive: true })

let seq = 0
const gid = () => 'GRP' + String(++seq).padStart(4, '0')
const aid = () => 'AST' + String(++seq).padStart(4, '0')
const db0 = new DatabaseSync(DB)
const now = Date.now()
db0.prepare('DELETE FROM variant').run()
db0.prepare('DELETE FROM asset').run()
db0.prepare('DELETE FROM asset_group').run()
db0.prepare('DELETE FROM journal').run()
function insGroup(id, key, name) {
  db0
    .prepare(
      `INSERT INTO asset_group (id, group_key, name, category, subcategory, created_at, updated_at, dir_key)
       VALUES (?,?,?,?,NULL,?,?,?)`
    )
    .run(id, key, name, 'clothing', now, now, DIR.split('\\').join('/').toLowerCase())
}
function insAsset(id, raw, groupId) {
  const p = (DIR + '\\' + raw).split('\\').join('/')
  fs.writeFileSync(path.join(DIR, raw), raw + ' fixture\n')
  db0
    .prepare(
      `INSERT INTO asset (id,name,raw_name,category,confidence,status,library_path,storage_mode,kind,size_bytes,
                          is_bundle,needs_review,group_id,created_at,updated_at)
       VALUES (?,?,?,'clothing',0.9,'classified',?,'indexed','archive',2048,0,0,?,?,?)`
    )
    .run(id, 'Libero', raw, p, groupId, now, now)
}
function insVariant(id, groupId, assetId, value) {
  db0.prepare(`INSERT INTO variant (id,group_id,asset_id,variant_kind,variant_value) VALUES (?,?,?,?,?)`).run(id, groupId, assetId, 'avatar', value)
}
const big = gid()
insGroup(big, 'libero attitude the royal bunny', 'Libero')
const assetIds = []
for (const raw of RAW) {
  const model = modelOf(raw)
  const id = aid()
  assetIds.push(id)
  if (EIGHT.has(model)) {
    insAsset(id, raw, big)
    insVariant('VAR' + seq, big, id, model)
    continue
  }
  const g = gid()
  insGroup(g, `libero ${model.toLowerCase()} attitude the royal bunny`, 'Libero')
  insAsset(id, raw, g)
  insVariant('VAR' + seq, g, id, 'UNIVERSAL')
}
insVariant('VARstale', big, assetIds[0], 'ramune')
db0.close()

const base = libero()
const baseVariants = read((d) => Number(d.prepare('SELECT COUNT(*) AS n FROM variant').get().n))
ok(base.groups === 13 && base.gids === 13, '沙盒起点：13 个组、13 个不同的 group_id', 'groups=' + base.groups + ' gids=' + base.gids)

/** 手动写 settings：库根配好、向导走完、**没有** autoRemergeRunAt —— 这就是"升级后第一次启动"的样子 */
fs.writeFileSync(SET, JSON.stringify({ libraryRoot: LIB.split('\\').join('/'), onboardingDone: true, autoArchive: false, language: 'zh-CN' }, null, 2), 'utf8')

boot()
if (!waitUntil('界面出来', () => bodyText().length > 200)) die('CDP 连不上或界面是空的')
console.log('  —— 下面这些判定**全部在一次点击都没有发生之前**读 ——')
if (!waitUntil('告知条自己出现', () => bannerUp(), 25)) {
  die('开机之后什么都没点，告知条没自己出来（= 自动跑那一步没生效，或跑了却没说）')
}
/**
 * ⚠ 抓文本和点「看看改了什么」**必须在同一个来回里做完**。
 * 第一次跑是分成两次 evalIn 的，中间那几个读数加一张截图把 12 秒的自动收起用光了，
 * 再去点就是 NOBANNER —— 那是脚本慢，不是产品没响应。活体的规矩：不能拿工具的坑判产品。
 *
 * ⚠ 第二次的两条红也是工具的坑，不是产品的：表达式里 `return JSON.stringify([...])` 之后，
 * `cdp-eval` 又把返回值 JSON 编了一次，`evalIn` 解出来是个**字符串**，
 * 拿它去解构成 `[autoText, clickedDetail]` 就拆成了单个字符 —— 断言当场红，
 * 而那次点击其实成功了（同一条表达式里的 `clickInBanner` 真的执行了，C 段的明细出来了）。
 * 所以这里直接返回**对象**，并且返回值形状不对时 loudly 报出来，不再悄悄拿到空串。
 */
const grab = evalIn('(() => { const t = txt(document.body); const r = clickInBanner("看看改了什么"); return { text: t, clicked: r } })()')
let autoText = ''
let clickedDetail = ''
if (grab && typeof grab === 'object' && !Array.isArray(grab)) {
  autoText = String(grab.text ?? '')
  clickedDetail = String(grab.clicked ?? '')
} else {
  clickedDetail = 'BADRETURN:' + String(grab).slice(0, 80)
}
const line = (autoText.match(/帮你把[^。]{0,40}/) || [''])[0]
ok(/帮你把 12 张.*（1 处）/.test(autoText), '⭐ 没点任何东西，告知条自己出现了，数字是真库形状（12 张 / 1 处）', line)
ok(String(clickedDetail).startsWith('CLICKED'), '趁条子还在，点到了那颗「看看改了什么」', String(clickedDetail))
const after = libero()
ok(after.groups === 1 && after.key === 'libero attitude', '库里真的自己并好了：1 组 + 新键', after.groups + ' 组 key=' + after.key)
ok(after.gids === 1, '20 张卡的 group_id 全指向同一个组', 'distinct=' + after.gids)
ok(after.paths === base.paths, '⭐ 一个文件都没搬：library_path 去重条数一字不变', base.paths + ' → ' + after.paths)
ok(!!settings().autoRemergeRunAt, '时间戳落了（这台机器不会再自动跑第二次）', String(settings().autoRemergeRunAt))
const pos = evalIn('(() => { const b = banner(); return b ? getComputedStyle(b).position : "NOBANNER" })()')
ok(pos === 'static', '告知条不悬浮、不遮控件（position 是 static，挡不到任何操作）', String(pos))

console.log('--- C. 明细：展开之后不许自己收起 ---')
if (!waitUntil('明细出来', () => bodyText().includes('并进来 12 张'), 12)) die('展开了却看不到明细（上面点击回报 = ' + clickedDetail + '）')
const detail = (bodyText().match(/Libero：并进来 12 张[^]{0,60}/) || [''])[0]
ok(/Libero：并进来 12 张/.test(bodyText()), '明细那句是「并进来 12 张」，不是「一共 20 张」', detail.slice(0, 60))
shot('r9c-01-auto-notice-expanded.png')
console.log('  等 ' + AUTO_DISMISS_WAIT + ' 毫秒，看展开着的条子会不会自己溜走…')
sleepSync(AUTO_DISMISS_WAIT)
ok(bannerUp(), '⭐ 正在读的时候程序没替他收起（等满 15 秒条子还在）')

console.log('--- D0. 那道闸在打包版里拦得住"撤错批次"（拿一个假批次走同一条 IPC） ---')
/**
 * ⑥ 那个「撤销」的安全垫是"只撤这一批"。前面几步只能证明**靶子有效**那条路走得通，
 * 拒绝那条路（撤错目标）在界面上永远不会自己撞上 —— 所以这里直接拿一个不存在的批次
 * 走**同一个通道**，看它是不是真的一行都不动。
 * `cdp-eval` 带 `awaitPromise`，所以 IPC 的 Promise 能在这里等回来。
 */
const bogus = evalIn('window.a.journal.undoLast("01BOGUSBOGUSBOGUSBOGUS01")')
const bogusObj = bogus && typeof bogus === 'object' ? bogus : {}
ok(bogusObj.ok === false && bogusObj.undone === 0, '假批次被拒：ok=false、一步都没撤', JSON.stringify(bogusObj).slice(0, 140))
ok(String(bogusObj.messageKey || '').includes('undoStale'), '拒的时候说的是"这一步过期了"，不是"没有可撤销的操作"', String(bogusObj.messageKey))
ok(groupsAll() === 1, '⭐ 拒绝就是真拒绝：库里还并着，一行都没动', 'groups=' + groupsAll())

console.log('--- D. 条子里那颗「撤销」：撤的就是这一次 ---')
const clickedUndo = String(evalIn('clickInBanner("撤销")'))
ok(clickedUndo.startsWith('CLICKED'), '点到了条子里那颗「撤销」（不是外层容器的第一颗按钮）', clickedUndo)
if (!waitUntil('组数回到 13', () => groupsAll() === 13, 20)) die('撤销之后组数没回到 13：现在 ' + groupsAll())
const undone = libero()
const varsBack = read((d) => Number(d.prepare('SELECT COUNT(*) AS n FROM variant').get().n))
ok(undone.gids === 13, '20 张卡回到 13 个组', 'distinct=' + undone.gids)
ok(undone.paths === base.paths, '撤销同样一个文件都没搬', undone.paths + ' 条路径')
ok(varsBack === baseVariants, '变体行一条不多一条不少', baseVariants + ' → ' + varsBack)
ok(!bannerUp(), '撤完条子自己关了（留着说"已合并"就是谎话）')
shot('r9c-03-after-undo.png')

console.log('--- E. 重启：刹车踩得住（撤销之后不能再并第二遍） ---')
killApp()
boot()
if (!waitUntil('界面出来', () => bodyText().length > 200)) die('重启后 CDP 连不上')
sleepSync(8000)
ok(groupsAll() === 13, '⭐ 重启后还是 13 个组 —— 程序没有跟用户抢方向盘', 'groups=' + groupsAll())
ok(!bannerUp(), '重启后也没再冒告知条')

console.log('--- F. 对照：把那个时间戳抹掉，别的东西一个字没改，它就该自己并 ---')
killApp()
const st = settings()
delete st.autoRemergeRunAt
fs.writeFileSync(SET, JSON.stringify(st, null, 2), 'utf8')
boot()
if (!waitUntil('告知条又出现', () => bannerUp(), 25)) die('抹掉时间戳之后它也没自动跑 —— E 那条"没跑"就失去对照意义了')
ok(groupsAll() === 1, '⭐ E/F 只差那个时间戳：抹掉就立刻并上了，证明拦住 E 的确实是那道闸', 'groups=' + groupsAll())
console.log('  这次什么都不点，等它自己收起…')
sleepSync(AUTO_DISMISS_WAIT + 3000)
ok(!bannerUp(), '没理它的话它自己走了（不挡路，不用谁去点掉）')
ok(groupsAll() === 1, '条子收起之后库里还并着 —— 收起只是不显示，不是把合并撤回')
shot('r9c-04-after-autocollapse.png')

/* ------------------------------------------------------------------ 3. 收尾 */

const files = fs.readdirSync(DIR).length
ok(files === RAW.length, '沙盒目录里还是那 20 个文件（一个没搬、也没多出东西）', files + ' 个')
ok(!!settings().autoRemergeRunAt, '收尾时时间戳又在（F 那次也算跑过一次）')

if (!KEEP) killApp()
console.log('\n=== 小结 ===')
console.log('红 ' + fails.length + ' 条')
for (const f of fails) console.log('  ❌ ' + f)
process.exit(fails.length ? 1 : 0)
