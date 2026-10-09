#!/usr/bin/env node
/**
 * R4 ③ 沙盒活体：把「改分类 → 预览 → 搬文件 → Ctrl+Z」在**真程序里点一遍**并取证。
 *
 * 验的是这五件事（都是单元测试看不见的那一层）：
 *  1. 详情面板改分类之后**先出预览卡**，卡上写"现在在 / 要搬到 / 几个文件 · 多大"；
 *  2. 点「搬过去」才动盘：文件真在新分类目录下、库里三列真改了；
 *  3. 点「撤销」一次做完两半：文件回原位、库里路径回原值，**素材记录还在**（这条最要紧）；
 *  4. 「只登记不搬」那件走的是**不弹卡 + 把原因说出来**那条路，文件一个都没动；
 *  5. 搬完之后用新分类的词在搜索框里**当场搜得到**（这就是那条"改分类不重建索引"的 bug）。
 *
 * 走的是用户实际路径：真点卡片、真改那两个下拉（native select 的 change 事件）、
 * 真点「保存 / 搬过去 / 撤销」、真读搜索框。IPC 只用在投料与入库那两步
 * （和手拖文件夹 + 点「全部入库」是同一个 handler）。
 *
 * ⚠ 只碰沙盒：库根 / APPHOME / 投料区全在 `AVCA_LIVE_ROOT` 下，目录名不对直接拒绝。
 * ⚠ 跑之前确认他的 Unity 没开着（见 docs/BRIDGE.md §13.4）。
 *
 * 用法：
 *   node tools/make-r4-move-tree.cjs
 *   AVCA_APP_HOME=<沙盒 APPHOME> node tools/dev.cjs --remote-debugging-port=9225   # 另开一个终端
 *   node tools/live-r4-move.cjs
 */
const fs = require('node:fs')
const path = require('node:path')
const cp = require('node:child_process')
const { DatabaseSync } = require('node:sqlite')

const ROOT = process.env.AVCA_LIVE_ROOT || 'D:\\avca-r4-move'
if (!/avca-r4-move$/i.test(path.basename(ROOT))) {
  console.error(`拒绝：沙盒根目录名不对（${ROOT}）`)
  process.exit(1)
}
const MANIFEST = JSON.parse(fs.readFileSync(path.join(ROOT, 'live-manifest.json'), 'utf8'))
const DB = path.join(ROOT, 'AppData', 'Roaming', 'A', 'library.db')
const LIB = MANIFEST.libraryRoot
const PORT = process.env.AVCA_CDP_PORT || '9225'
const ENV = { ...process.env, AVCA_CDP_PORT: PORT }
const SHOT_DIR = process.env.AVCA_SHOT_DIR || ROOT

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function evalInPage(expr) {
  return cp
    .execFileSync(process.execPath, [path.resolve(__dirname, 'cdp-eval.cjs'), expr], {
      cwd: path.resolve(__dirname, '..'),
      encoding: 'utf8',
      env: ENV,
      maxBuffer: 16 * 1024 * 1024
    })
    .trim()
}

function evalJson(expr) {
  const raw = evalInPage(expr)
  try {
    return JSON.parse(raw)
  } catch {
    return raw
  }
}

function shot(name) {
  const out = path.join(SHOT_DIR, name)
  cp.execFileSync(process.execPath, [path.resolve(__dirname, 'cdp-shot.cjs'), out], { cwd: path.resolve(__dirname, '..'), env: ENV })
  console.log('  📷 ' + out)
}

async function waitCdp(tries = 60) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = evalInPage('document.title')
      if (r) return r
    } catch {
      /* 还没起来 */
    }
    await sleep(1500)
  }
  throw new Error('CDP 连不上（A 起来了吗？端口 ' + PORT + '）')
}

async function waitInPage(expr, what, tries = 40, step = 700) {
  for (let i = 0; i < tries; i++) {
    let v = null
    try {
      v = evalInPage(`(() => { ${expr} })()`)
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
  const { tag = 'button', maxLen = 40, startsWith = false } = opts
  return evalJson(`(() => {
    const want = ${JSON.stringify(text)}
    const nodes = [...document.querySelectorAll(${JSON.stringify(tag)})]
    const hit = nodes.filter(n => {
      const t = (n.textContent || '').trim()
      ${startsWith ? 'if (!t.startsWith(want)) return false' : ''}
      return t.includes(want) && t.length < want.length + ${maxLen}
    })
    if (!hit[0]) return JSON.stringify({ ok: false, why: '找不到元素：' + want, pool: nodes.length })
    hit[0].click()
    return JSON.stringify({ ok: true, text: hit[0].textContent.trim().slice(0, 60) })
  })()`)
}

/**
 * 按显示名里的关键字点卡（单选，不是 ctrl+点）。
 * ⚠ 名字是**清洗过**的显示名，所以只按关键字匹配，别按全等。
 */
function clickCard(kw) {
  return evalJson(`(() => {
    const cards = [...document.querySelectorAll('.card')]
    const el = cards.find(n => (n.textContent || '').includes(${JSON.stringify(kw)}))
    if (!el) return JSON.stringify({ ok: false, why: '网格里没有含「${kw}」的卡', seen: cards.map(c => (c.textContent || '').trim().slice(0, 18)) })
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: false }))
    return JSON.stringify({ ok: true, name: (el.textContent || '').trim().slice(0, 24) })
  })()`)
}

/**
 * 改详情面板里的分类下拉。
 *
 * 为什么用 native setter + dispatch('change')：React 受控的 <select> 直接改 `.value`
 * 不会触发 onChange，界面状态根本不跟着变 —— 那是"测试桩自己造的假故障"。
 * 这两个下拉在详情面板（aside）里就是第 0、第 1 个 select。
 */
function setCategorySelects(catKey, subKey) {
  return evalJson(`(() => {
    const aside = [...document.querySelectorAll('aside')].find(a => a.querySelector('select'))
    if (!aside) return JSON.stringify({ ok: false, why: '详情面板没出现（先点一张卡）' })
    const sels = [...aside.querySelectorAll('select')]
    if (sels.length < 2) return JSON.stringify({ ok: false, why: '详情面板里不足两个下拉', seen: sels.length })
    const set = (el, v) => {
      const proto = Object.getPrototypeOf(el)
      const d = Object.getOwnPropertyDescriptor(proto, 'value')
      d.set.call(el, v)
      el.dispatchEvent(new Event('change', { bubbles: true }))
    }
    set(sels[0], ${JSON.stringify(catKey)})
    set(sels[1], ${JSON.stringify(subKey)})
    return JSON.stringify({
      ok: true,
      cat: sels[0].value,
      sub: sels[1].value,
      catText: sels[0].selectedOptions[0] ? sels[0].selectedOptions[0].textContent.trim() : '',
      subText: sels[1].selectedOptions[0] ? sels[1].selectedOptions[0].textContent.trim() : ''
    })
  })()`)
}

/** 投料 + 入库：前三件真的搬进库（move=true），第四件只登记（move=false） */
async function ingestAndCommit() {
  const ing = evalJson(`(async () => {
    const r = await window.a.ingest.fromPaths(${JSON.stringify([...MANIFEST.archived, MANIFEST.indexed])})
    return JSON.stringify({ accepted: (r.accepted || []).length, rejected: (r.rejected || []).map(x => x.code) })
  })()`)
  console.log('  摄取：' + JSON.stringify(ing))
  let jobs = []
  for (let i = 0; i < 40; i++) {
    jobs = evalJson(`(async () => JSON.stringify((await window.a.ingest.queue() || []).map(j => ({ id: j.jobId, name: j.item && j.item.name, stage: j.stage }))) )()`)
    if (!Array.isArray(jobs)) break
    if (jobs.length >= 4 && jobs.every((j) => j.stage === 'awaiting_confirm')) break
    await sleep(1500)
  }
  console.log('  收件箱：' + JSON.stringify(jobs))
  const moveIds = jobs.slice(0, 3).map((j) => j.id)
  const holdId = jobs[3] ? jobs[3].id : null
  const a = evalJson(`(async () => JSON.stringify(await window.a.ingest.commitAll({ jobIds: ${JSON.stringify(moveIds)}, move: true })))()`)
  console.log('  入库（归档，真的搬文件）：' + JSON.stringify(a))
  await sleep(2000)
  if (holdId) {
    const b = evalJson(`(async () => JSON.stringify(await window.a.ingest.commitAll({ jobIds: [${JSON.stringify(holdId)}], move: false })))()`)
    console.log('  入库（只登记不搬）：' + JSON.stringify(b))
  }
  await sleep(2000)
}

/** 只读取证：某个名字的那行素材现在在哪、什么模式、分类是什么 */
function readRow(like) {
  const db = new DatabaseSync(DB, { readOnly: true })
  try {
    return db
      .prepare(
        `SELECT id, name, category, subcategory, storage_mode, library_path, source_path
         FROM asset WHERE name LIKE ? AND parent_asset_id IS NULL ORDER BY updated_at DESC LIMIT 1`
      )
      .all(like)[0] || null
  } finally {
    db.close()
  }
}

function journalTail(limit = 6) {
  const db = new DatabaseSync(DB, { readOnly: true })
  try {
    return db.prepare(`SELECT id, op, status, undone, json_extract(payload_json,'$.label') AS label FROM journal ORDER BY id DESC LIMIT ?`).all(limit)
  } finally {
    db.close()
  }
}

/** 一棵目录里有哪些文件（相对路径），用来把"东西到底在哪"打在日志上 */
function listTree(dir) {
  if (!fs.existsSync(dir)) return null
  const out = []
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const f = path.join(d, e.name)
      if (e.isDirectory()) walk(f)
      else out.push(path.relative(dir, f) + ' · ' + fs.statSync(f).size)
    }
  }
  walk(dir)
  return out
}

async function main() {
  console.log('== 0. 等 A 起来 ==')
  console.log('  标题：' + (await waitCdp()))

  console.log('== 1. 投料 + 入库（三件归档、一件只登记） ==')
  const already = readRow('%')
  already ? console.log('  库里已经有素材（' + already.name + '），跳过投料') : await ingestAndCommit()

  const moved = readRow('%MatCap%') || readRow('%Vol%')
  if (!moved) throw new Error('没找到要搬的那张卡（MatCap）—— 入库没成功？')
  console.log('  要搬的这张：' + JSON.stringify(moved))
  const indexed = readRow('%Indexed%')
  console.log('  只登记的那张：' + JSON.stringify(indexed))

  /** 目标分类：拿一个和现在不同的，且二级分类存在的 */
  const cats = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'resources', 'lexicon', 'categories.json'), 'utf8')).categories
  const target = cats.find((c) => c.key !== moved.category && c.subcategories.length)
  const targetSub = target.subcategories[0].key
  console.log('  改成：' + target.key + '（' + target.label['zh-CN'] + '）/ ' + targetSub + '（' + target.subcategories[0].label['zh-CN'] + '）')

  const oldDir = moved.library_path
  const expectNewDir = path.join(LIB, target.label['zh-CN'], target.subcategories[0].label['zh-CN'], moved.name)
  console.log('  预期新位置：' + expectNewDir)
  console.log('  旧位置里有：' + JSON.stringify(listTree(oldDir)))

  console.log('== 2. 网格里点那张卡，改分类下拉 ==')
  console.log('  ' + JSON.stringify(clickByText('全部素材', { tag: '.nav-item, a, button, div' })))
  await sleep(1500)
  clickByText('平铺')
  await sleep(1200)
  const card = clickCard(moved.name.slice(0, 8))
  console.log('  点卡：' + JSON.stringify(card))
  if (card && card.ok === false) throw new Error('点不到那张卡：' + card.why)
  await sleep(1200)
  const sel = setCategorySelects(target.key, targetSub)
  console.log('  下拉：' + JSON.stringify(sel))
  if (!sel.ok) throw new Error('分类下拉没改成：' + sel.why)
  await sleep(600)
  shot('r4-move-01-category-changed.png')

  console.log('== 3. 点「保存」→ 预览卡应该出现，而文件此刻还不能动 ==')
  console.log('  ' + JSON.stringify(clickByText('保存')))
  const previewUp = await waitInPage(`return /改分类：/.test(document.body.innerText) ? 'true' : 'false'`, '预览卡出现')
  if (!previewUp) throw new Error('预览卡没出现（那这条链就是断的）')
  await sleep(500)
  shot('r4-move-02-preview.png')
  const preview = evalJson(`(() => {
    const m = document.body.innerText
    return JSON.stringify({
      title: (m.match(/改分类：[^\\n]*/) || [null])[0],
      now: (m.match(/现在在[^\\n]*/) || [null])[0],
      to: (m.match(/要搬到[^\\n]*/) || [null])[0],
      size: (m.match(/\\d+ 个文件[^\\n]*/) || [null])[0],
      undo: (m.match(/Ctrl\\+Z[^\\n]*/) || [null])[0],
      buttons: [...document.querySelectorAll('button')].map(b => (b.textContent || '').trim()).filter(t => /搬过去|只改记录|取消/.test(t))
    })
  })()`)
  console.log('  预览卡：' + JSON.stringify(preview, null, 1))
  if (fs.existsSync(expectNewDir)) throw new Error('预览阶段就把目录建出来了 —— 预览不是只读的')

  console.log('== 4. 点「搬过去」 ==')
  console.log('  ' + JSON.stringify(clickByText('搬过去')))
  const done = await waitInPage(`return /已搬好/.test(document.body.innerText) ? 'true' : 'false'`, '「已搬好」的 toast')
  await sleep(400)
  shot('r4-move-03-moved.png')
  const after = readRow('%MatCap%') || readRow('%Vol%')
  console.log('  搬之后库里那行：' + JSON.stringify(after))
  console.log('  新位置里有：' + JSON.stringify(listTree(after.library_path)))
  console.log('  旧位置还在吗：' + fs.existsSync(oldDir) + '（里面 ' + JSON.stringify(listTree(oldDir)) + '）')
  console.log('  toast 等到：' + done)
  console.log('  journal 尾巴：' + JSON.stringify(journalTail(4)))

  console.log('== 5. 用新分类的词搜（那条"改分类不重建索引"的 bug 就在这） ==')
  const word = target.label['zh-CN']
  const searched = evalJson(`(async () => {
    const r = await window.a.assets.list({ search: ${JSON.stringify(word)}, limit: 200 })
    return JSON.stringify({ total: r.total, hit: (r.cards || []).some(c => c.id === ${JSON.stringify(after.id)}) })
  })()`)
  console.log('  搜「' + word + '」：' + JSON.stringify(searched))

  console.log('== 6. 点「撤销」：文件回原位 + 库里路径回原值 + 素材记录还在 ==')
  console.log('  ' + JSON.stringify(clickByText('撤销')))
  const undone = await waitInPage(`return /搬回原位|已撤销/.test(document.body.innerText) ? 'true' : 'false'`, '撤销的 toast')
  await sleep(500)
  shot('r4-move-04-undone.png')
  const back = readRow('%MatCap%') || readRow('%Vol%')
  console.log('  撤销后库里那行：' + JSON.stringify(back))
  console.log('  旧位置里有：' + JSON.stringify(listTree(oldDir)))
  console.log('  新位置还在吗：' + fs.existsSync(expectNewDir))
  console.log('  toast 等到：' + undone)
  if (!back) throw new Error('撤销之后素材记录没了 —— 这就是那条被堵住的数据丢失')
  if (back.category !== moved.category) throw new Error('撤销后分类没回原值：' + back.category)

  console.log('== 7. 只登记不搬那件：不该弹卡，且必须把原因说出来 ==')
  const ic = clickCard(indexed.name.slice(0, 10))
  console.log('  点卡：' + JSON.stringify(ic))
  await sleep(1200)
  const other = cats.find((c) => c.key !== indexed.category && c.subcategories.length)
  const isel = setCategorySelects(other.key, other.subcategories[0].key)
  console.log('  下拉：' + JSON.stringify(isel))
  console.log('  ' + JSON.stringify(clickByText('保存')))
  await sleep(1800)
  /**
   * ⚠ 这两句**必须紧跟在点"保存"之后**：toast 4.2 秒就淡出，
   * 而截图（`shot`）与读库各要一两秒 —— 打包版那一轮把探针排在后面，
   * 报出来一句"界面没说原因"的**假故障**（实际那句当时显示过）。
   * 顺序：点保存 → 立刻扫整页文本 → 再截图 → 再读库。
   */
  const reasonShown = evalInPage(`(() => { const m = document.body.innerText; return /已保存（文件没动）：[^\\n]{4,}/.test(m) ? 'yes' : 'no' })()`)
  const reasonText = evalInPage(`(() => { const m = document.body.innerText; return (m.match(/已保存（文件没动）：[^\\n]*/) || ['（没找到）'])[0] })()`)
  console.log('  界面 toast 里有没有原因：' + reasonShown)
  console.log('  toast 原文：' + reasonText)
  const noDialog = evalInPage(`(() => /改分类：/.test(document.body.innerText) ? 'yes' : 'no')()`)
  console.log('  弹卡了吗：' + noDialog + '（该是 no）')
  shot('r4-move-05-indexed-toast.png')
  const iAfter = readRow('%Indexed%')
  console.log('  那行现在：' + JSON.stringify(iAfter))
  console.log('  投料区那个目录还在吗：' + fs.existsSync(MANIFEST.indexed) + '（该是 true，一个文件都没动）')
  if (reasonShown !== 'yes') throw new Error('「只登记不搬」那件没说原因 —— 界面上只剩一句"已保存"，用户不知道文件为什么没动')
  if (noDialog !== 'no') throw new Error('不该弹确认卡却弹了')

  console.log('\n完成。截图在 ' + SHOT_DIR)
}

main().catch((e) => {
  console.error('\nFAILED: ' + (e && e.message ? e.message : e))
  process.exit(1)
})
