/**
 * 第 9 轮 ② 的活体：在真窗口里把 B4「存量重并」走一遍 —— 检查 → 看清预览 → 合并 → Ctrl+Z 退回。
 *
 * ## 为什么必须单独跑这一场
 *
 * ① 那一轮学到的是"通道在、没人按"；这一轮要防的是它的镜像：**功能做完了、界面点不到**。
 * 单测能证明 `planRemerge/applyRemerge` 算得对，证明不了设置页里那三颗按钮
 * 真的连到了主进程、真的刷得动界面、真的能一次撤销回来。
 *
 * ## 沙盒与护栏
 *
 * 沙盒：`D:\avca-m7-live\r9b-home`（运行目录）+ `r9b-lib`（库根）。
 * 三道闸照 ① 那场的规矩：路径必须含 avca/sandbox/r9、`AVCA_REQUIRE_SANDBOX_HOME=1`、
 * 起实例之前查真 Unity（**看 Temp/UnityLockFile，不看进程名**）。
 * 杀进程**只按 `ExecutablePath` 认沙盒实例**（① 那场第一次跑就是拿镜像名杀，
 * 差点把用户正在用的真实例一起带走）。
 *
 * 真库那一次按 Q6 乙**不在这里跑**：这一场只证明"界面这条路走得通 + 撤销真的回得去"。
 *
 *   node tools/live-r9-remerge.cjs          # 全流程
 *   node tools/live-r9-remerge.cjs --keep   # 跑完不杀，自己点两下看看
 */
const fs = require('node:fs')
const path = require('node:path')
const cp = require('node:child_process')

const HERE = __dirname
const ROOT = path.resolve(HERE, '..')
/**
 * 默认打在 `dist/win-unpacked`。留一个环境变量口子是有原因的：
 * 2026-10-10 那次 `dist/win-unpacked/Atrium.exe` 被系统层面锁住（EBUSY，
 * 按进程名 / 按模块都查不到持有者，像是 Defender 在扫那个 188 MB 的新副本），
 * 于是改用 `-c.directories.output=dist-r9b` 出一份到别处再验。
 * 换目录不影响结论：跑的是同一份 `out/` 打出来的 asar。
 */
const UNPACKED = process.env.AVCA_UNPACKED_DIR || path.join(ROOT, 'dist', 'win-unpacked')
const EXE = path.join(UNPACKED, 'Atrium.exe')
const HOME = 'D:\\avca-m7-live\\r9b-home'
const LIB = 'D:\\avca-m7-live\\r9b-lib'
const DB = path.join(HOME, 'library.db')
const PORT = process.env.AVCA_CDP_PORT || '9244'
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
if (!fs.existsSync(EXE)) die('打包版不在：' + EXE + ' → 先 npx electron-builder --win --dir')
for (const p of [HOME, LIB]) if (!/(avca|sandbox|r9)/i.test(p)) die('沙盒路径名字不对，拒绝跑：' + p)

/** 真 Unity 开着就不许起实例（沙盒实例照样会发现真工程，BRIDGE.md §13.4 出过一次事故） */
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
        /** cp936 码页下中文路径会变乱码，`startsWith` 永远比不中 —— 必须钉 UTF-8（① 撞过） */
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
/** 页面里要跑的表达式：HELPERS + 一个表达式，拼成合法 IIFE（箭头函数不带花括号时函数体只能是一个表达式） */
const HELPERS = `
  const txt = (e) => (e && e.textContent || '').replace(/\\s+/g,' ').trim();
  const find = (sel, s) => [...document.querySelectorAll(sel)].filter(e => txt(e).includes(s));
  const findExact = (sel, s) => [...document.querySelectorAll(sel)].filter(e => txt(e) === s);
  const click = (el) => { if (!el) return 'NOELEMENT'; el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); return 'CLICKED'; };
  const clickText = (sel, s) => click(find(sel, s)[0]);
  const clickExact = (sel, s) => click(findExact(sel, s)[0]);
`
const E = (expr) => '(function(){' + HELPERS + 'return (' + expr + ');})()'

function evalIn(expr) {
  const f = path.join(require('os').tmpdir(), 'r9b-eval.js')
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

/* ---------------------------------------------------------------- 1. 造沙盒 */

const foreign = atriumProcs().filter((p) => !String(p.ExecutablePath || '').replace(/\\/g, '/').toLowerCase().startsWith(WANTED_DIR))
console.log('机器上另有 ' + foreign.length + ' 个不是沙盒的 Atrium 进程（装在 AppData 的那个），本脚本一律不碰')

killApp()
fs.rmSync(HOME, { recursive: true, force: true })
fs.rmSync(LIB, { recursive: true, force: true })
fs.mkdirSync(path.join(HOME, 'LocalAppData'), { recursive: true })
fs.mkdirSync(LIB, { recursive: true })
console.log('=== ① 第一次起进程：只为了让它把沙盒库建出来 ===')
boot()
if (!waitUntil('library.db 出现', () => fs.existsSync(DB), 25)) die('沙盒库没建出来：' + DB)
sleepSync(3000)
killApp()

fs.writeFileSync(
  path.join(HOME, 'settings.json'),
  JSON.stringify({ libraryRoot: LIB.split('\\').join('/'), onboardingDone: true, autoArchive: false, language: 'zh-CN' }, null, 2),
  'utf8'
)

console.log('=== ② 灌一棵 Libero 同形的树（20 行 / 13 组，组键是 §B2 之前的老写法） ===')
const { DatabaseSync } = require('node:sqlite')
const db = new DatabaseSync(DB)
const now = Date.now()

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
function insGroup(id, key, name) {
  db.prepare(
    `INSERT INTO asset_group (id, group_key, name, category, subcategory, created_at, updated_at, dir_key)
     VALUES (?,?,?,?,NULL,?,?,?)`
  ).run(id, key, name, 'clothing', now, now, DIR.split('\\').join('/').toLowerCase())
}
function insAsset(id, raw, groupId) {
  const p = (DIR + '\\' + raw).split('\\').join('/')
  fs.writeFileSync(path.join(DIR, raw), raw + ' fixture\n')
  db.prepare(
    `INSERT INTO asset (id,name,raw_name,category,confidence,status,library_path,storage_mode,kind,size_bytes,
                        is_bundle,needs_review,group_id,created_at,updated_at)
     VALUES (?,?,?,'clothing',0.9,'classified',?,'indexed','archive',2048,0,0,?,?,?)`
  ).run(id, 'Libero', raw, p, groupId, now, now)
}
function insVariant(id, groupId, assetId, value, kind) {
  db.prepare(`INSERT INTO variant (id,group_id,asset_id,variant_kind,variant_value) VALUES (?,?,?,?,?)`).run(id, groupId, assetId, kind ?? 'avatar', value)
}

db.prepare('DELETE FROM variant').run()
db.prepare('DELETE FROM asset').run()
db.prepare('DELETE FROM asset_group').run()
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
/** 共用组上再留一条老写法 `ramune`（真库里就长这样），顺带验查重 */
insVariant('VARstale', big, assetIds[0], 'ramune')
db.close()
console.log('  灌完：20 行 / 13 组，组键全是老写法（其中 8 行共用一个组）')

/* ------------------------------------------------------------------ 2. 真点 */

console.log('\n=== ③ 起进程，在设置页里走用户路径 ===')
boot()
if (!waitUntil('界面出来', () => typeof evalIn('txt(document.body)') === 'string' && String(evalIn('txt(document.body)')).length > 200)) {
  die('CDP 连不上或界面是空的')
}
sleepSync(1500)
evalIn('clickText(".nav-item","设置")')
sleepSync(1200)
/**
 * 设置页是分标签的（常规 / 库 / 分类 / Unity集成 / **维护** / 关于），
 * 存量清理那几块都在「维护」下面 —— 第一次跑就是没点这个标签，
 * 报成"面板没挂上"，其实是被折叠在另一个标签里。
 */
evalIn('clickText("button","维护")')
if (!waitUntil('找得到「检查一遍」那颗按钮', () => evalIn('find("button","检查一遍").length') > 0, 20)) {
  die('「维护」标签里没有 B4 那颗按钮 —— 面板没挂上，或者文案漂了')
}
ok(true, '设置页里能看见「把同一件衣服重新并成一张卡」这一栏', String(evalIn('find(".nav-item, h3, div","把同一件衣服重新并成一张卡").length')) + ' 处命中')

console.log('--- 第一步：检查一遍（只读） ---')
const groupsBefore = (() => {
  const d = new DatabaseSync(DB, { readOnly: true })
  const n = d.prepare('SELECT COUNT(*) AS n FROM asset_group').get().n
  const v = d.prepare('SELECT COUNT(*) AS n FROM variant').get().n
  const p = d.prepare('SELECT COUNT(DISTINCT library_path) AS n FROM asset').get().n
  d.close()
  return { groups: n, variants: v, paths: p }
})()
const clickedScan = String(evalIn('clickText("button","检查一遍")'))
ok(clickedScan.startsWith('CLICKED'), '「检查一遍」那颗真的被点到了', clickedScan)
if (!waitUntil('预览出来', () => evalIn('txt(document.body).includes("张并成 1 张")') === true, 15)) {
  die('点了「检查一遍」没看见预览')
}
const badge = String(evalIn('find("span","张并成 1 张").map(txt)')).slice(0, 120)
ok(badge.includes('20 张并成 1 张'), '⭐ 预览报的是「20 张并成 1 张」（真库形状：13 组塌成 1 组）', badge)
const lines = evalIn('find("div","→").map(txt).filter(s=>s.startsWith("libero")&&s.length<140)')
ok(
  Array.isArray(lines) && lines.some((s) => s.includes('libero ichigo attitude the royal bunny') && s.includes('libero attitude')),
  '逐条写清"从哪个键 → 到哪个键"',
  '共 ' + (lines || []).length + ' 行，例：' + JSON.stringify((lines || []).slice(0, 2))
)
shot('r9b-01-preview.png')

const afterScan = (() => {
  const d = new DatabaseSync(DB, { readOnly: true })
  const n = d.prepare('SELECT COUNT(*) AS n FROM asset_group').get().n
  d.close()
  return n
})()
ok(afterScan === groupsBefore.groups, '「检查一遍」真的只读（组数没变）', groupsBefore.groups + ' → ' + afterScan)

console.log('--- 第二步：合并 ---')
/**
 * ⚠ 把点击的**返回值**当成断言。
 * 第一次在 `dist/win-unpacked` 上跑这一场时，"点了合并没回报"卡了 24 秒才失败，
 * 而日志里连一条 remerge 都没有 —— 因为原来这行把 `clickText` 的返回丢掉了，
 * `NOELEMENT:合并（` 和 `CLICKED` 长得一样安静。逐步探针重跑同样的路径是成功的，
 * 所以判它是脚本没点着（不是产品没响应），但**没有证据的"判它是脚本问题"就是猜**。
 * 从现在起：点没点着，当场报。
 */
const clickedMerge = String(evalIn('clickText("button","合并（")'))
ok(clickedMerge.startsWith('CLICKED'), '「合并（1 处）」那颗真的被点到了', clickedMerge)
if (!waitUntil('提示条出来', () => evalIn('txt(document.body).includes("合并完：")') === true, 20)) {
  die('点了「合并」没有回报（上面那条点击返回值 = ' + clickedMerge + '）')
}
sleepSync(2500)
const after = (() => {
  const d = new DatabaseSync(DB, { readOnly: true })
  const groups = d.prepare(`SELECT COUNT(*) AS n FROM asset_group WHERE group_key LIKE 'libero%'`).get().n
  const key = d.prepare(`SELECT group_key AS k FROM asset_group WHERE group_key LIKE 'libero%'`).get().k
  const gids = d.prepare(`SELECT COUNT(DISTINCT group_id) AS n FROM asset WHERE name='Libero'`).get().n
  const vars = d.prepare(`SELECT variant_value AS v FROM variant WHERE variant_kind='avatar'`).all().map((r) => r.v)
  const paths = d.prepare('SELECT COUNT(DISTINCT library_path) AS n FROM asset').get().n
  const journal = d.prepare(`SELECT COUNT(*) AS n FROM journal WHERE op='remerge'`).get().n
  d.close()
  return { groups, key, gids, vars, paths, journal }
})()
ok(after.groups === 1 && after.key === 'libero attitude', '⭐ 库里真的塌成一组，组键换成了新规则算出来的那个', after.groups + ' 组 / key=' + after.key)
ok(after.gids === 1, '20 张卡的 group_id 全指向同一个组', 'distinct=' + after.gids)
ok(after.paths === groupsBefore.paths, '⭐ 一个文件都没搬：library_path 的去重条数一字不变', groupsBefore.paths + ' → ' + after.paths)
ok(after.vars.includes('Ichigo') && !after.vars.includes('UNIVERSAL'), '模型变体补齐了、通用占位没往里灌', '变体 ' + after.vars.length + ' 条')
ok(new Set(after.vars.map((v) => String(v).toLowerCase())).size === after.vars.length, '⭐ 同一个模型没有两种写法（老写法 ramune 挡住了新的 Ramune）', after.vars.join(','))
ok(after.journal === 1, '撤销账只有一条 remerge（Ctrl+Z 一次就够）', 'journal=' + after.journal)
shot('r9b-02-after-merge.png')

console.log('--- 第三步：界面上那颗「撤销」真的回得去 ---')
/**
 * 点提示条里那颗「撤销」。
 *
 * ⚠ 必须挑**最里面**那个 div：`querySelectorAll('div')` 是文档序，
 * `find("div","合并完：")[0]` 拿到的是最外层的祖先容器，从它下面找 button
 * 会先找到「检查一遍」—— 第一次跑就是这么"撤销失败"的，其实根本没点到撤销。
 */
const undoClicked = evalIn(
  '(() => { const d = find("div","合并完：").filter(x => !x.querySelector("div"))[0]; return d ? click(d.querySelector("button")) : "NONOTE" })()'
)
ok(String(undoClicked).includes('CLICKED'), '点到了提示条里那颗「撤销」（不是外层容器的第一颗按钮）', String(undoClicked))
if (!waitUntil('组数回到 13', () => {
  const d = new DatabaseSync(DB, { readOnly: true })
  const n = d.prepare('SELECT COUNT(*) AS n FROM asset_group').get().n
  d.close()
  return n === groupsBefore.groups
}, 20)) die('撤销之后组数没回到 13')
const back = (() => {
  const d = new DatabaseSync(DB, { readOnly: true })
  const key = d.prepare(`SELECT group_key AS k FROM asset_group WHERE group_key LIKE 'libero%' ORDER BY created_at LIMIT 1`).get().k
  const vars = d.prepare(`SELECT COUNT(*) AS n FROM variant`).get().n
  const gids = d.prepare(`SELECT COUNT(DISTINCT group_id) AS n FROM asset WHERE name='Libero'`).get().n
  d.close()
  return { key, vars, gids }
})()
ok(back.key === 'libero attitude the royal bunny', '⭐ 老组键原样回来了（撤销不是"再算一遍"，是用账本里的旧值）', 'key=' + back.key)
ok(back.vars === groupsBefore.variants, '变体行一条不多一条不少', groupsBefore.variants + ' → ' + back.vars)
ok(back.gids === 13, '20 张卡回到 13 个组', 'distinct=' + back.gids)
shot('r9b-03-after-undo.png')

/* ------------------------------------------------------------------ 3. 收尾 */

const files = fs.readdirSync(DIR).length
ok(files === RAW.length, '沙盒目录里还是那 20 个文件（一个没搬、也没多出东西）', files + ' 个')

if (!KEEP) killApp()
console.log('\n=== 小结 ===')
console.log('红 ' + fails.length + ' 条')
for (const f of fails) console.log('  ❌ ' + f)
process.exit(fails.length ? 1 : 0)
