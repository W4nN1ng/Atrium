#!/usr/bin/env node
/**
 * §8 那批"只有真 Unity 才能验"的验收项 —— 用**真的** 2022.3.22f1 打开**沙盒工程**跑一遍。
 *
 * 为什么必须真 Unity：之前所有活体的对端都是 `tools/fake-unity-live.cjs`，
 * 它照契约收发文件信箱、从 `.meta` 读 GUID、把包铺进 Assets/，
 * 但**不走 AssetDatabase、不生成 GUID、不重序列化**。
 * 所以 §8-1..8-7 那七条一直只能标"未验证"（docs/BRIDGE.md §8.8）。
 *
 * ⚠ 只许对着沙盒工程：`D:\avca-r4-live\projects\Shinano-R4LiveTest`。
 *    他的 8 个真工程和 `E:\vrc\A` 一个字节都不许碰。
 *
 * 跑法（要两个外部进程先起来）：
 *   "E:\unity\2022.3.22f1\Editor\Unity.exe" -projectPath "D:\avca-r4-live\projects\Shinano-R4LiveTest" -logFile "D:\avca-r4-live\unity-s8.log"
 *   AVCA_APP_HOME="D:\avca-r4-live\AppData\Roaming\A" node tools/dev.cjs --remote-debugging-port=9225
 *   node tools/live-s8-real-unity.cjs --stage=1        # §8-1 心跳
 *   ... --stage=2   # §8-3 单包导入真落地（Assets/ 出现文件 + .meta，GUID 是真的）
 *   ... --stage=3   # §8-6 冲突预扫描列出将覆盖的文件 + 选"备份后继续"
 *   ... --stage=4   # §8-7 撤销：新建的被删掉、被覆盖的从备份还原（逐字节比）
 *   ... --stage=5   # §8-4 多选 5 张卡串行导入 + 进度可见 + 整批退回
 *   ... --stage=7   # §8-2 关 Unity → 10 秒内标退出；重开 → 自动重连
 */
const fs = require('node:fs')
const path = require('node:path')
const cp = require('node:child_process')
const crypto = require('node:crypto')
const { DatabaseSync } = require('node:sqlite')

const ROOT = process.env.AVCA_LIVE_ROOT || 'D:\\avca-r4-live'
if (!/avca-r4-live$/i.test(path.basename(ROOT))) {
  console.error(`拒绝：沙盒根目录名不对（${ROOT}）`)
  process.exit(1)
}
const PROJ = path.join(ROOT, 'projects', 'Shinano-R4LiveTest')
if (!/LiveTest$/i.test(path.basename(PROJ))) {
  console.error('拒绝：工程名必须是沙盒的 *LiveTest')
  process.exit(1)
}
const MAIL = path.join(PROJ, 'Temp', 'AVCABridge')
const BRIDGE = path.join(MAIL, 'bridge.json')
const ASSETS = path.join(PROJ, 'Assets')
const DB = path.join(ROOT, 'AppData', 'Roaming', 'A', 'library.db')
const ALOG = path.join(ROOT, 'dev-s8.log')
const PORT = process.env.AVCA_CDP_PORT || '9225'
const ENV = { ...process.env, AVCA_CDP_PORT: PORT }
const HERE = path.resolve(__dirname, '..')
const STAGE = (process.argv.find((a) => /^--stage=/.test(a)) || '--stage=1').split('=')[1]
/** ②③④ 三档要对同一张卡下手：2 建、3 撞、4 撤 */
const CARD = process.env.AVCA_S8_CARD || 'Shinano Hair'
/** ③ 改过工程里哪几份内容，④ 就拿这份去比还原 */
const MODFILE = path.join(ROOT, 's8-modified.json')

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let failures = 0
function check(what, ok, detail) {
  console.log(`  ${ok ? '✅' : '❌'} ${what}${detail === undefined ? '' : '：' + JSON.stringify(detail)}`)
  if (!ok) failures++
  return ok
}

function ev(expr) {
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
  const raw = ev(expr)
  try {
    return JSON.parse(raw)
  } catch {
    return raw
  }
}
function shot(name) {
  const out = path.join(ROOT, name)
  cp.execFileSync(process.execPath, [path.join(__dirname, 'cdp-shot.cjs'), out], { cwd: HERE, env: ENV })
  console.log('  📷 ' + out)
}
async function waitInPage(expr, what, tries = 40, step = 800) {
  for (let i = 0; i < tries; i++) {
    let v = null
    try {
      v = ev(`(() => { ${expr} })()`)
    } catch {
      /* CDP 偶尔断一下 */
    }
    if (v === 'true' || v === true) return true
    await sleep(step)
  }
  console.log('  ⚠ 等不到：' + what)
  return false
}
function clickByText(text, opts = {}) {
  const { maxLen = 40, exact = false, startsWith = false } = opts
  return ej(`(() => {
    const want = ${JSON.stringify(text)}
    const nodes = [...document.querySelectorAll('button,div,span,a')]
    const hit = nodes.filter(n => {
      const t = (n.textContent || '').trim()
      ${startsWith ? 'if (!t.startsWith(want)) return false' : ''}
      return ${exact ? 't === want' : `t.includes(want) && t.length < want.length + ${maxLen}`}
    })
    if (!hit[0]) return JSON.stringify({ ok: false, why: '找不到：' + want, pool: nodes.length })
    hit[0].click()
    return JSON.stringify({ ok: true, text: hit[0].textContent.trim().slice(0, 50) })
  })()`)
}
/** 按文字选中一张卡（卡片视图）或一行（列表视图） */
function selectAsset(kw) {
  const byCard = ej(`(() => {
    const el = [...document.querySelectorAll('.card')].find(n => (n.textContent || '').includes(${JSON.stringify(kw)}))
    if (!el) return JSON.stringify({ ok: false })
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    return JSON.stringify({ ok: true, text: (el.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 40) })
  })()`)
  if (byCard && byCard.ok) return byCard
  return ej(`(() => {
    const hits = [...document.querySelectorAll('div')].filter(d => (d.textContent || '').includes(${JSON.stringify(kw)}) && d.children.length >= 3)
    const row = hits.sort((a, b) => (a.textContent || '').length - (b.textContent || '').length)[0]
    if (!row) return JSON.stringify({ ok: false, why: '找不到：' + ${JSON.stringify(kw)} })
    row.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    return JSON.stringify({ ok: true, text: (row.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 40) })
  })()`)
}
function ctrlClickCard(i) {
  return ej(`(() => {
    const el = [...document.querySelectorAll('.card')][${i}]
    if (!el) return JSON.stringify({ ok: false, why: '没有第 ${i} 张卡' })
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true }))
    return JSON.stringify({ ok: true, name: (el.textContent || '').trim().slice(0, 20) })
  })()`)
}

/** 工程侧的台账：Assets/ 下每个文件的相对路径 + 字节数 + 内容 sha1 */
function tree(dir) {
  const out = new Map()
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name)
      if (e.isDirectory()) walk(p)
      else {
        const buf = fs.existsSync(p) ? fs.readFileSync(p) : Buffer.alloc(0)
        out.set(path.relative(dir, p).split(path.sep).join('/'), {
          bytes: buf.length,
          sha1: crypto.createHash('sha1').update(buf).digest('hex').slice(0, 12)
        })
      }
    }
  }
  if (fs.existsSync(dir)) walk(dir)
  return out
}
function bridge() {
  try {
    return JSON.parse(fs.readFileSync(BRIDGE, 'utf8'))
  } catch {
    return null
  }
}
function db() {
  return new DatabaseSync(DB, { readOnly: true })
}
function lastLogRow(afterId) {
  const d = db()
  const rows = d
    .prepare(`SELECT id, asset_id, status, kind, batch_id, created_guids_json, overwritten_json, backup_dir, finished_at
                FROM import_log WHERE id > ? ORDER BY id`).all(afterId)
  d.close()
  return rows
}
function maxLogId() {
  const d = db()
  /**
   * ⚠ `import_log.id` 是 **ULID 文本**，不是自增整数。
   * 上一版在这里 `Number(m)` → NaN → `WHERE id > NULL` 恒不成立 →
   * 明明导成功了三条断言全报"没有行"（真 Unity 第一轮就是这么被我自己判死的）。
   * ULID 按字典序就是时间序，原样传字符串即可。
   */
  const m = d.prepare(`SELECT COALESCE(MAX(id),'0') m FROM import_log`).get().m
  d.close()
  return String(m)
}
/**
 * 只点 `button`，而且点文字最短的那个。
 * 顶栏那个开关在 DOM 里套了三层（div.relative > button.btn > span.muted），
 * 文字三层都一样 —— 按"第一个命中"会点到外层 div，**什么也不会发生**（实测踩过）。
 */
function clickButton(text) {
  return ej(`(() => {
    const want = ${JSON.stringify(text)}
    const hit = [...document.querySelectorAll('button')].filter(b => (b.textContent || '').trim().includes(want))
      .sort((a, b) => (a.textContent || '').length - (b.textContent || '').length)
    if (!hit[0]) return JSON.stringify({ ok: false, why: '没有这个按钮：' + want })
    hit[0].click()
    return JSON.stringify({ ok: true, text: hit[0].textContent.trim().slice(0, 40) })
  })()`)
}
/** 只看按钮在不在，**不点**（点一下就是真发一次撤销，见 stage5 那段） */
function hasButton(text) {
  return ej(`(() => {
    const hit = [...document.querySelectorAll('button')].filter(b => (b.textContent || '').trim().includes(${JSON.stringify(text)}))
    return JSON.stringify({ ok: hit.length > 0, texts: hit.map(b => (b.textContent || '').trim().slice(0, 30)) })
  })()`).ok === true
}
/** 进「全部素材」—— 每个 stage 都得先归零，否则收件箱空列表上什么都点不到 */
async function gotoLibrary() {
  const r = clickByText('全部素材', { exact: true })
  await sleep(1200)
  const n = ej(`JSON.stringify(document.querySelectorAll('.card').length)`)
  console.log('  进全部素材：' + JSON.stringify(r) + '，卡片数 ' + n)
}
async function ensureTarget() {
  const has = ev(`(() => /导入目标：Shinano-R4LiveTest/.test(document.body.innerText) ? 'yes' : 'no')()`)
  if (has === 'yes') return console.log('  顶栏已选中沙盒工程')
  console.log('  开下拉：' + JSON.stringify(clickButton('导入目标')))
  await sleep(900)
  console.log('  选目标：' + JSON.stringify(clickByText('Shinano-R4LiveTest', { maxLen: 80, startsWith: true })))
  await sleep(700)
}

async function stage1() {
  console.log('== §8-1 桥接心跳：真 Unity 每 2 秒刷一次 bridge.json ==')
  const a = bridge()
  check('bridge.json 在（说明 [InitializeOnLoad] 真跑起来了）', !!a, a && { bridgeVersion: a.bridgeVersion, pid: a.pid, unity: a.unityVersion })
  if (!a) return
  await sleep(4500)
  const b = bridge()
  const dt = b.heartbeatUtc - a.heartbeatUtc
  check('heartbeatUtc 在往前走', dt > 0, { 间隔ms: dt })
  check('间隔在 2 秒 ±1 秒这一档（不是卡死也不是狂刷）', dt > 1000 && dt < 5000, { 间隔ms: dt })
  check('工程路径/名字对得上沙盒', b.projectPath && b.projectPath.toLowerCase().includes('avca-r4-live'), { projectPath: b.projectPath })
  const mtime = fs.statSync(BRIDGE).mtimeMs
  check('文件 mtime 也是新的（不是只改了内存）', Date.now() - mtime < 15000, { 距今ms: Math.round(Date.now() - mtime) })
  let log = ''
  try {
    log = fs.readFileSync(ALOG, 'utf8')
  } catch {
    /* 日志名不对就跳过这条 */
  }
  /**
   * 真 Unity 下三路探测会一起点头，日志写的是「依据：bridge+lockfile+wmi」；
   * 假对端那一轮只有 bridge。所以这里判"以 bridge 开头"，别把三路一致当成不匹配。
   */
  check('A 侧日志认它是"已打开"（bridge 这一路真参与了判定）', /Shinano-R4LiveTest → 已打开（依据：bridge/.test(log), log ? undefined : 'dev 日志没读到')
}

async function stage2() {
  console.log('== §8-3 单包导入：真 AssetDatabase.ImportPackage 落地 ==')
  await gotoLibrary()
  await ensureTarget()
  console.log('  选中：' + JSON.stringify(selectAsset(CARD)))
  await sleep(1200)
  const before = tree(ASSETS)
  const mark = maxLogId()
  console.log('  点导入：' + JSON.stringify(clickButton('导入到 Unity')))
  const ok = await waitInPage(`return /已导入|新建 \\d+ 个资源|导入失败/.test(document.body.innerText) ? 'true' : 'false'`, '导入结果', 150, 1000)
  await sleep(1500)
  shot('s8-02-imported.png')
  const rows = lastLogRow(mark)
  check('界面给了结果条', ok && rows.length > 0, rows.map((r) => ({ st: r.status, kind: r.kind })))
  const good = rows.find((r) => r.status === 'ok')
  const guids = good && good.created_guids_json ? JSON.parse(good.created_guids_json) : []
  check('import_log 有 ok 行', !!good, good && { id: good.id, batch: good.batch_id })
  check('created_guids 非空', guids.length > 0, { 个数: guids.length, 样例: guids[0] })
  check('GUID 是真 Unity 的 32 位十六进制（假对端给的是包里抄来的，这里要确认是重新序列化出来的）',
    guids.every((g) => /^[0-9a-f]{32}$/.test(g)), { 样例: guids[0] })
  const after = tree(ASSETS)
  const added = [...after.keys()].filter((k) => !before.has(k))
  check('Assets/ 真长出文件了', added.length > 0, { 新增: added.length, 样例: added.slice(0, 3) })
  check('而且 .meta 也是 Unity 生成的（不是我们抄进包里的）',
    added.some((k) => k.endsWith('.meta')), { meta数: added.filter((k) => k.endsWith('.meta')).length })
  console.log('  Assets/ 现在：' + JSON.stringify([...after.entries()].slice(0, 6)))
}

async function stage3() {
  console.log('== §8-6 冲突预扫描：再导一次同一个包，要先列出将覆盖谁 ==')
  /**
   * 先把工程里那几份内容**改掉**，再触发第二次导入。
   * 不改的话备份内容 == 包内容，④ 那条"逐字节比还原"就成了自证：还原错了也照样一致。
   */
  const cur = tree(ASSETS)
  const modified = {}
  for (const [k, v] of cur.entries()) {
    if (k.endsWith('.meta')) continue
    const abs = path.join(ASSETS, k.split('/').join(path.sep))
    const marker = [String.fromCharCode(10), '// MODIFIED-IN-PROJECT-BY-LIVE-TEST', String.fromCharCode(10)].join('')
    fs.writeFileSync(abs, fs.readFileSync(abs, 'utf8') + marker)
    const now = crypto.createHash('sha1').update(fs.readFileSync(abs)).digest('hex').slice(0, 12)
    modified[k] = now
    if (now === v.sha1) check('改工程内容这一步本身生效了（' + k + '）', false, { 改前改后一样: now })
  }
  fs.writeFileSync(MODFILE, JSON.stringify(modified, null, 1))
  console.log('  已在工程里改掉 ' + Object.keys(modified).length + ' 份内容（④ 拿这个比还原）')
  await gotoLibrary()
  await ensureTarget()
  console.log('  选中：' + JSON.stringify(selectAsset(CARD)))
  await sleep(1200)
  const mark = maxLogId()
  console.log('  点导入：' + JSON.stringify(clickButton('导入到 Unity')))
  const dialog = await waitInPage(`return /会覆盖工程里/.test(document.body.innerText) ? 'true' : 'false'`, '冲突对话框', 30, 800)
  const txt = ej(`(() => {
    const m = document.body.innerText
    const i = m.indexOf('这个包会覆盖')
    return JSON.stringify(i < 0 ? null : m.slice(i, i + 420).replace(/\\n+/g, ' / '))
  })()`)
  check('弹出冲突框并写了覆盖数', dialog, txt)
  shot('s8-03-conflict.png')
  const btns = ej(`JSON.stringify([...document.querySelectorAll('button')].map(b => (b.textContent || '').trim()).filter(t => /继续|取消|备份/.test(t)))`)
  check('两个选择都在：继续（不备份）/ 继续并备份被覆盖文件', /继续并备份/.test(String(btns)) && /继续（不备份）/.test(String(btns)), btns)
  console.log('  点「继续并备份」：' + JSON.stringify(clickButton('继续并备份')))
  const done = await waitInPage(`return /已导入|已撤销|导入失败/.test(document.body.innerText) ? 'true' : 'false'`, '第二次导入结果', 150, 1000)
  await sleep(1200)
  const rows = lastLogRow(mark)
  const good = rows.find((r) => r.status === 'ok')
  const over = good && good.overwritten_json ? JSON.parse(good.overwritten_json) : []
  check('第二次导入完成', done && !!good, rows.map((r) => r.status))
  check('overwritten 列出了被覆盖的文件（不是空数组）', over.length > 0, { 个数: over.length, 样例: over[0] })
  check('备份目录真存在且里面有东西', !!good && !!good.backup_dir && fs.existsSync(good.backup_dir), {
    backup_dir: good && good.backup_dir,
    文件数: good && good.backup_dir && fs.existsSync(good.backup_dir) ? fs.readdirSync(good.backup_dir).length : 0
  })
  shot('s8-03-after-conflict.png')
}

async function stage4() {
  console.log('== §8-7 撤销导入：新建的删干净、被覆盖的逐字节还原 ==')
  await gotoLibrary()
  await ensureTarget()
  console.log('  选中：' + JSON.stringify(selectAsset(CARD)))
  await sleep(1200)
  const d = db()
  const last = d.prepare(`SELECT id, created_guids_json, overwritten_json, backup_dir FROM import_log WHERE status='ok' ORDER BY id DESC LIMIT 1`).get()
  d.close()
  if (!last) return check('找不到可撤销的 ok 行（先跑 --stage=3）', false)
  const created = JSON.parse(last.created_guids_json || '[]')
  const over = JSON.parse(last.overwritten_json || '[]')
  const before = tree(ASSETS)
  /** ③ 那一步留下的"工程里被改过的内容"，还原之后必须一字不差地回来 */
  const modified = fs.existsSync(MODFILE) ? JSON.parse(fs.readFileSync(MODFILE, 'utf8')) : {}
  console.log('  点撤销：' + JSON.stringify(clickButton('撤销这次导入')))
  const done = await waitInPage(`return /已撤销|撤销导入失败/.test(document.body.innerText) ? 'true' : 'false'`, '撤销结果', 120, 900)
  await sleep(1200)
  shot('s8-04-rolledback.png')
  const after = tree(ASSETS)
  const gone = [...before.keys()].filter((k) => !after.has(k))
  check('界面说了已撤销', done)
  const d2 = db()
  /**
   * 撤销是**原地把那一行改成 rolledback**（同一行、同一条 message 写着删了几个/还原了几个），
   * 不插新行。上一版按 `id > last.id` 数新行 → 恒为 0，把成功的撤销判成失败。
   */
  const rb = d2.prepare(`SELECT status, message FROM import_log WHERE id = ?`).get(last.id)
  d2.close()
  check('import_log 那一行改成了 rolledback，并写了删/还原几个', rb && rb.status === 'rolledback', rb)
  if (created.length) {
    check('本次新建的资源真从 Assets/ 消失了（按 createdGuids 白名单反查删的）', gone.length > 0, {
      删掉: gone.length,
      样例: gone.slice(0, 3)
    })
  } else {
    console.log('  · 这一轮 createdGuids 是空的（第二次导入全是覆盖），"删新建"那条没东西可判')
  }
  if (over.length) {
    /**
     * 备份清单是 `manifest.json`：guid → 工程内路径 → 备份文件名。
     * 逐字节比的是"③ 之前被我们改过的那一份"，不是包里那份 ——
     * 两次导入内容相同的话，比包内容等于什么都没测（还原错了也过）。
     */
    const mf = JSON.parse(fs.readFileSync(path.join(last.backup_dir, 'manifest.json'), 'utf8'))
    let same = 0
    let diff = 0
    const detail = []
    for (const it of mf.saved || []) {
      /** manifest 里写的是 `Assets/...`，而 tree() 的键是相对 Assets/ 的 —— 前缀要剥掉 */
      const key = String(it.assetPath).split(path.sep).join('/').replace(/^Assets\//, '')
      const now = after.get(key)
      const want = modified[key]
      const bak = path.join(last.backup_dir, it.file)
      const bakSha = crypto.createHash('sha1').update(fs.readFileSync(bak)).digest('hex').slice(0, 12)
      const okNow = !!now && now.sha1 === bakSha && !!want && want === now.sha1
      if (okNow) same++
      else {
        diff++
        detail.push({ key, 现在: now && now.sha1, 备份: bakSha, 改过那份: want })
      }
    }
    check('被覆盖的文件全部还原成备份里那份（逐字节比 ' + mf.saved.length + ' 个）', diff === 0 && same > 0, {
      一致: same,
      不一致: diff,
      样例: detail.slice(0, 3)
    })
  } else {
    console.log('  · 这一轮 overwritten 是空的，还原那条没东西可比（要它就先跑 --stage=3）')
  }
}

async function stage5() {
  console.log('== §8-4 多选 5 张卡 → 串行导入 → 进度可见 → 整批退回 ==')
  await gotoLibrary()
  await ensureTarget()
  clickByText('网格')
  await sleep(900)
  const cards = ej(`JSON.stringify([...document.querySelectorAll('.card')].map(c => (c.textContent || '').trim().replace(/\\s+/g,' ').slice(0, 18)))`)
  console.log('  卡片：' + cards)
  /**
   * 沙盒里 6 张卡，其中显示名叫 `body` 的那张是**散装目录**（里面只有一个 .fbx，
   * 没有可直接导入的 .unitypackage）—— 按名字跳过它，剩下 5 张正好是 5 个包。
   */
  const idx = ej(`JSON.stringify([...document.querySelectorAll('.card')]
    .map((c, i) => ({ i, t: (c.textContent || '').trim().replace(/\\s+/g, ' ') }))
    .filter(o => !/body/i.test(o.t)).map(o => o.i).slice(0, 5))`)
  const list = Array.isArray(idx) ? idx : []
  console.log('  要选的下标：' + JSON.stringify(list))
  const picked = []
  for (const i of list) {
    const r = ctrlClickCard(i)
    if (r && r.ok) picked.push(r.name)
    await sleep(250)
  }
  const sel = ej(`JSON.stringify({ n: document.querySelectorAll('.card-selected').length, picked: ${JSON.stringify(picked)} })`)
  /** ej 已经把结果 parse 成对象了，上一版拿正则去 match `String(对象)` 恒为 false（假失败） */
  check(list.length + ' 张卡选中了', !!sel && sel.n === list.length, sel)
  shot('s8-05-selected.png')
  const btn = ej(`(() => { const b = [...document.querySelectorAll('button')].find(x => /导入 Unity/.test(x.textContent || '')); return JSON.stringify({ text: b ? b.textContent.trim() : null, disabled: b ? b.disabled : null }) })()`)
  check('工具栏出现批量导入按钮', !!(btn && btn.text), btn)
  clickButton('导入 Unity')
  const up = await waitInPage(`return /批量导入/.test(document.body.innerText) ? 'true' : 'false'`, '汇总卡', 25)
  check('汇总卡出现', up)
  await sleep(600)
  shot('s8-05-plan.png')
  const beforeBatch = tree(ASSETS)
  clickButton('继续并备份')
  /** 进度可见：一边跑一边采样，要求"最多一条在跑"且行数确实在动 */
  let runningMax = 0
  let samples = 0
  let rowsSeen = 0
  for (let i = 0; i < 120; i++) {
    const s = ej(`(() => {
      const m = document.body.innerText
      const running = (m.match(/正在导入|进行中/g) || []).length
      const done = (m.match(/已导入|成功/g) || []).length
      return JSON.stringify({ running, done, has: /批量导入/.test(m) })
    })()`)
    if (s && typeof s === 'object') {
      samples++
      runningMax = Math.max(runningMax, s.running)
      rowsSeen = Math.max(rowsSeen, s.done)
    }
    const body = ev(`(() => document.body.innerText.slice(0, 4000))()`)
    /** 至少采 6 次再允许收工：上一档留下的"已导入"横幅还在页面上，一上来就 break 等于没采 */
    if (i >= 6 && /已导入|失败|完成|全部|结果/.test(String(body))) break
    await sleep(700)
  }
  check('进度是真的在动（采到 ' + samples + ' 次，完成数最高 ' + rowsSeen + '）', samples > 1 && rowsSeen > 0, { runningMax, rowsSeen })
  await sleep(1500)
  shot('s8-05-result.png')
  const d = db()
  const batch = d.prepare(`SELECT batch_id, COUNT(*) n FROM import_log WHERE status='ok' AND id > (SELECT COALESCE(MAX(id),0) - 20 FROM import_log) GROUP BY batch_id ORDER BY COUNT(*) DESC LIMIT 1`).get()
  const rows = d.prepare(`SELECT status, COUNT(*) n FROM import_log GROUP BY status`).all()
  d.close()
  check('这一批是一个 batch_id 串起来的', !!batch && Number(batch.n) >= 2, batch)
  console.log('  import_log 现状：' + JSON.stringify(rows))
  /**
   * 批量结果卡上是「整批退回」，单包详情面板上是「撤销这次导入」—— 哪个在点哪个。
   *
   * ⚠ **只能点一次**：上一版这里先 `clickButton(...).ok` 探一下、再点一次落实，
   * 于是连着发了两次撤销 —— 真机上就是这两次把同一批资源删了两遍，
   * 第二次桥接回 `failed`、并把那行的 message 覆盖成"删除 0 个新建资源"。
   * 现在改成"探按钮文字用 `hasButton`（不点），点只在最后做一次"。
   */
  const backBtn = hasButton('整批退回') ? '整批退回' : '撤销这次导入'
  console.log('  点退回（用的是：' + backBtn + '）：' + JSON.stringify(clickButton(backBtn)))
  const back = await waitInPage(`return /已撤销|撤销导入失败/.test(document.body.innerText) ? 'true' : 'false'`, '退回结果', 120)
  await sleep(1500)
  shot('s8-05-rollback.png')
  /**
   * 判"这一批新增的都没了"，不判"Assets/ 空"—— ②③④ 那几档留下的文件本来就该还在，
   * 拿"空"当标准会把正确行为测成红。
   */
  const left = tree(ASSETS)
  const stillHere = [...beforeBatch.keys()].filter((k) => !left.has(k))
  const batchFiles = [...left.keys()].filter((k) => !beforeBatch.has(k))
  check('整批退回把这一批新增的文件全删掉了（工程里其余资源一根毛都没动）',
    stillHere.length === 0 && batchFiles.length === 0,
    { 这批残留: batchFiles.length, 误删别处: stillHere.length })
  console.log('  （界面回执：' + back + '）')
}

async function stage7() {
  console.log('== §8-2 关 Unity → 10 秒内标退出；重开 → 自动重连 ==')
  const b = bridge()
  if (!b) return check('bridge.json 读不到，先跑 --stage=1', false)
  const pid = b.pid
  console.log('  要关的 Unity pid：' + pid)
  try {
    cp.execSync(`taskkill /PID ${pid}`, { encoding: 'utf8' })
  } catch (e) {
    console.log('  taskkill（不带 /F，让它自己收尾）：' + String(e.message).slice(0, 80))
  }
  let dead = false
  let waited = 0
  for (let i = 0; i < 30; i++) {
    await sleep(1000)
    waited += 1000
    const now = bridge()
    const fresh = now && Date.now() - now.heartbeatUtc < 6000
    if (!fresh) {
      dead = true
      break
    }
  }
  check('心跳停了（10 秒这一档内）', dead, { 等了ms: waited })
  let log = ''
  try {
    log = fs.readFileSync(ALOG, 'utf8')
  } catch {
    /* 忽略 */
  }
  check('A 侧日志认到"未运行"', /未运行|运行状态变化/.test(log), log ? undefined : '读不到 dev 日志')
  const gone = clickByText('导入目标')
  await sleep(800)
  const topText = ev(`(() => { const m = document.body.innerText.match(/导入目标：[^\\n]{0,40}/); return m ? m[0] : '（顶栏没写目标）' })()`)
  console.log('  顶栏现在：' + topText + '（点了一下目标菜单：' + JSON.stringify(gone) + '）')
  shot('s8-07-unity-closed.png')
  console.log('  重开 Unity（这一步要等它自己起完）…')
  const child = cp.spawn('E:\\unity\\2022.3.22f1\\Editor\\Unity.exe', ['-projectPath', PROJ, '-logFile', path.join(ROOT, 'unity-s8-reopen.log')], {
    detached: true,
    stdio: 'ignore'
  })
  child.unref()
  let back2 = false
  for (let i = 0; i < 90; i++) {
    await sleep(2000)
    const now = bridge()
    if (now && Date.now() - now.heartbeatUtc < 6000) {
      back2 = true
      break
    }
  }
  check('重开之后桥接又活了（自动重连）', back2, bridge() && { pid: bridge().pid, bridgeVersion: bridge().bridgeVersion })
  await sleep(6000)
  let log2 = ''
  try {
    log2 = fs.readFileSync(ALOG, 'utf8')
  } catch {
    /* 忽略 */
  }
  check('A 又标回"已打开（依据：bridge）"', /已打开（依据：bridge）/.test(log2.split('未运行').pop() || log2))
  shot('s8-07-unity-reopened.png')
}

const STAGES = { 1: stage1, 2: stage2, 3: stage3, 4: stage4, 5: stage5, 7: stage7 }

;(async () => {
  const fn = STAGES[STAGE]
  if (!fn) {
    console.error('没有这一档：' + STAGE)
    process.exit(2)
  }
  if (!bridge()) {
    console.error('❌ 读不到 ' + BRIDGE + ' —— 真 Unity 是不是没开？（见文件头的跑法）')
    process.exit(1)
  }
  await fn()
  console.log(failures ? `\n有 ${failures} 条没过（这一档不算通过）` : '\n这一档全过')
  process.exit(failures ? 1 : 0)
})().catch((e) => {
  console.error('FAILED: ' + (e && e.message ? e.message : e))
  process.exit(1)
})
