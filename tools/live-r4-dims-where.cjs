#!/usr/bin/env node
/**
 * R4 ⑤ + ⑥ 沙盒活体：变体分列与跨工程反查在**真程序**里各点一遍。
 *
 * ⑤ 要看见的：两张 `Grimoir_SHINANO` / `Grimoir_MANUKA` 归并成一张卡之后，
 *    卡片徽章写「2 变体」、下面多出一行「适配模型 ×2」；列表视图那一列也分得出来。
 * ⑥ 要看见的：详情面板里「在哪些工程装过（N）」真列出工程名 + 包数 + 时间，
 *    并且那句口径（只认 A 导过的那几次）在界面上看得见。
 *    退回过的次数单独一条 —— 这个沙盒里那 5 张卡上一轮"整批退回"之后全是这种形状。
 *
 * 用的是 R4 ② 那个沙盒（`D:\avca-r4-live`）：它已经有 5 张真 .unitypackage 卡、
 * 一个装了桥接的假工程、和 20 条 import_log（全是 rolledback）。
 *
 * ⚠ 要跑两步外部进程：
 *   AVCA_APP_HOME=D:\avca-r4-live\AppData\Roaming\A node tools/dev.cjs --remote-debugging-port=9225
 *   node tools/fake-unity-live.cjs D:\avca-r4-live\projects\Shinano-R4LiveTest
 * ⚠ 跑之前确认他的 Unity 没开着（docs/BRIDGE.md §13.4）。
 *
 * 用法：node tools/live-r4-dims-where.cjs
 */
const fs = require('node:fs')
const path = require('node:path')
const cp = require('node:child_process')
const { DatabaseSync } = require('node:sqlite')

const ROOT = process.env.AVCA_LIVE_ROOT || 'D:\\avca-r4-live'
if (!/avca-r4-live$/i.test(path.basename(ROOT))) {
  console.error(`拒绝：沙盒根目录名不对（${ROOT}）`)
  process.exit(1)
}
const DB = path.join(ROOT, 'AppData', 'Roaming', 'A', 'library.db')
const DROP = path.join(ROOT, 'drop-dims')
const PORT = process.env.AVCA_CDP_PORT || '9225'
const ENV = { ...process.env, AVCA_CDP_PORT: PORT }
const HERE = path.resolve(__dirname, '..')

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

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
async function waitInPage(expr, what, tries = 40, step = 700) {
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
  const { tag = 'button', maxLen = 40, exact = false, startsWith = false } = opts
  return ej(`(() => {
    const want = ${JSON.stringify(text)}
    const nodes = [...document.querySelectorAll(${JSON.stringify(tag)})]
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
function clickCard(kw) {
  return ej(`(() => {
    const cards = [...document.querySelectorAll('.card')]
    const el = cards.find(n => (n.textContent || '').includes(${JSON.stringify(kw)}))
    if (!el) return JSON.stringify({ ok: false, seen: cards.map(c => (c.textContent || '').trim().slice(0, 20)) })
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    return JSON.stringify({ ok: true, text: (el.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 80) })
  })()`)
}
/**
 * 列表视图里没有 `.card`：一行是一个 div，点它才选得中（⑥ 必须先选中素材，详情面板才出反查块）。
 * 和取行文字一样，按 textContent 最短挑出真正那一行，别点到外层容器。
 */
function clickRow(kw) {
  return ej(`(() => {
    const hits = [...document.querySelectorAll('div')].filter(d => (d.textContent || '').includes(${JSON.stringify(kw)}) && d.children.length >= 3)
    const row = hits.sort((a, b) => (a.textContent || '').length - (b.textContent || '').length)[0]
    if (!row) return JSON.stringify({ ok: false, why: '列表里找不到：' + ${JSON.stringify(kw)} })
    row.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    return JSON.stringify({ ok: true, text: (row.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 60) })
  })()`)
}
/** 卡片视图点卡片、列表视图点行，两种视图都能选中素材 */
function selectAsset(kw) {
  const c = clickCard(kw)
  if (c && c.ok) return c
  return clickRow(kw)
}

/**
 * 造两张同系列不同 avatar 的散装目录：归并成一组之后才有"分列"可看。
 * 两处坑：
 *  - 两份内容必须不一样。字节相同 → hash 相同 → 第二份被判成重复，压根不入库。
 *  - 版本故意写成 V1.0 / V1.1。版本不同仍然并成一张卡（版本归并），
 *    于是"适配模型 ×2"和"版本 ×2"两列能同时出现，比只出一列更能说明分列在工作。
 */
function makeDropPair() {
  const specs = [
    { name: 'Grimoir_SHINANO_V1.0', fill: 0x41 },
    { name: 'Grimoir_MANUKA_V1.1', fill: 0x42 }
  ]
  return specs.map(({ name, fill }) => {
    const d = path.join(DROP, name)
    fs.mkdirSync(d, { recursive: true })
    fs.writeFileSync(path.join(d, 'body.fbx'), Buffer.alloc(512, fill))
    return d
  })
}

async function main() {
  console.log('== 0. 等 A 起来 ==')
  if (!(await waitInPage('return document.title ? "true" : "false"', 'CDP 连上', 30))) throw new Error('CDP 连不上（端口 ' + PORT + '）')
  console.log('  标题：' + ev('document.title'))

  console.log('== 1. 投两张 Grimoir（同系列不同 avatar）==')
  const pair = makeDropPair()
  const already = new DatabaseSync(DB, { readOnly: true }).prepare(`SELECT COUNT(*) n FROM asset WHERE name LIKE '%Grimoir%'`).get().n
  if (Number(already) >= 2) {
    console.log('  库里已经有 ' + already + ' 张 Grimoir，跳过投料')
  } else {
    const ing = ej(`(async () => JSON.stringify(await window.a.ingest.fromPaths(${JSON.stringify(pair)})))()`)
    console.log('  摄取：' + JSON.stringify(ing))
    let jobs = []
    for (let i = 0; i < 30; i++) {
      jobs = ej(`(async () => JSON.stringify((await window.a.ingest.queue() || []).map(j => ({ id: j.jobId, stage: j.stage }))))()`)
      if (Array.isArray(jobs) && jobs.length >= 2 && jobs.every((j) => j.stage === 'awaiting_confirm')) break
      await sleep(1500)
    }
    const ids = (Array.isArray(jobs) ? jobs : []).filter((j) => j.stage === 'awaiting_confirm').map((j) => j.id)
    const c = ej(`(async () => JSON.stringify(await window.a.ingest.commitAll({ jobIds: ${JSON.stringify(ids)}, move: false })))()`)
    console.log('  入库（只登记，不动盘）：' + JSON.stringify(c))
    await sleep(2500)
  }

  console.log('== 2. ⑤ 聚合视图：那张卡上有没有"适配模型 ×2" ==')
  // 卡片显示名被解析成了目录里的文件名（'body'），raw_name 只在 title 属性里，
  // 所以按"带变体徽章"来找 —— 这个沙盒里只有 Grimoir 那一对会并成 2 变体
  const FIND_CARD = `const el = [...document.querySelectorAll('.card')].find(n => (n.textContent || '').includes('变体'))`
  console.log('  ' + JSON.stringify(clickByText('全部素材', { exact: true })))
  await sleep(1500)
  clickByText('聚合')
  await sleep(1200)
  const card = ej(`(() => {
    ${FIND_CARD}
    if (!el) return JSON.stringify({ ok: false, seen: [...document.querySelectorAll('.card')].map(c => (c.textContent || '').trim().replace(/\\s+/g,' ').slice(0, 24)) })
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    return JSON.stringify({ ok: true, text: (el.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 80) })
  })()`)
  console.log('  卡片文字：' + JSON.stringify(card))
  const ro = new DatabaseSync(DB, { readOnly: true })
  const dims = ro
    .prepare(
      `SELECT group_concat(variant_kind || char(31) || variant_value, char(30)) d
         FROM variant
        WHERE group_id = (SELECT group_id FROM asset WHERE raw_name LIKE 'Grimoir_%' LIMIT 1)`
    )
    .get()
  ro.close()
  const flat = String(dims && dims.d).replace(/\u001f/g, '=').replace(/\u001e/g, ' | ')
  console.log('  库里的 dims：' + flat)
  shot('r4-dims-01-grouped-card.png')
  const badge = ej(`(() => {
    ${FIND_CARD}
    if (!el) return JSON.stringify({ ok: false })
    return JSON.stringify({
      ok: true,
      badge: [...el.querySelectorAll('span')].map(s => (s.textContent || '').trim()).filter(x => /变体|适配模型|模型/.test(x)),
      chips: [...el.querySelectorAll('.chip')].map(s => (s.textContent || '').trim())
    })
  })()`)
  console.log('  徽章/芯片：' + JSON.stringify(badge))

  console.log('== 3. ⑤ 列表视图：那一列分列了没有 ==')
  console.log('  ' + JSON.stringify(clickByText('列表')))
  await sleep(1200)
  const rowText = ej(`(() => {
    // 列表视图一行是一个 div，里面并排着名称/类别/大小等单元格。
    // 外层容器也"包含 Grimoir"，所以按 textContent 最短来挑出真正那一行
    const hits = [...document.querySelectorAll('div')].filter(d => (d.textContent || '').includes('Grimoir') && d.children.length >= 3)
    const row = hits.sort((a, b) => (a.textContent || '').length - (b.textContent || '').length)[0]
    return JSON.stringify(row ? { kids: row.children.length, text: (row.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 140) } : null)
  })()`)
  console.log('  行文字：' + JSON.stringify(rowText))
  shot('r4-dims-02-list-row.png')

  console.log('== 4. 选导入目标（顶栏真点）==')
  const already2 = ev(`(() => /导入目标：Shinano-R4LiveTest/.test(document.body.innerText) ? 'yes' : 'no')()`)
  if (already2 !== 'yes') {
    clickByText('导入目标')
    await sleep(900)
    console.log('  ' + JSON.stringify(clickByText('Shinano-R4LiveTest', { maxLen: 80, startsWith: true })))
  } else console.log('  顶栏已经选中沙盒工程')
  await sleep(800)

  console.log('== 5. ⑥ 先看一张"只被退回过"的卡（上一轮整批退回留下的形状）==')
  // 点名 'Shinano Face'：只写 'Shinano' 会撞上刚投进去的 Grimoir_SHINANO 那张
  console.log('  选中：' + JSON.stringify(selectAsset('Shinano Face')))
  await sleep(1500)
  const rolled = ej(`(() => {
    const m = document.body.innerText
    const i = m.indexOf('在哪些工程装过')
    return JSON.stringify(i < 0 ? null : m.slice(i, i + 300).replace(/\\n+/g, ' / '))
  })()`)
  console.log('  反查块：' + JSON.stringify(rolled))
  shot('r4-where-01-rolledback.png')

  console.log('== 6. ⑥ 真导一次（假 Unity 在听），再看反查块 ==')
  const mark = new DatabaseSync(DB, { readOnly: true }).prepare(`SELECT COALESCE(MAX(id),0) m FROM import_log`).get().m
  const imp = clickByText('导入到 Unity')
  console.log('  点导入：' + JSON.stringify(imp))
  // 撞见就弹了冲突框（同 GUID 之前装过又退回、盘上可能还有残file），点"继续"往下走。
  // ⚠ 按钮文案是「继续（不备份）」/「继续并备份被覆盖文件」，不是"继续导入"——
  //    打包版那一轮只试"继续导入"和精确匹配的"继续"，两个都没点到，冲突框一直挂着，
  //    于是报"等不到导入结果"（看着像 ⑥ 坏了，其实是脚本没点下去）。
  for (let i = 0; i < 10; i++) {
    /** 逐个试（`clickByText` 返回的是 `{ok:false}` 这种**真值对象**，不能用 `||` 串） */
    let c = null
    for (const label of ['继续并备份被覆盖文件', '继续（不备份）', '继续导入']) {
      c = clickByText(label)
      if (c && c.ok) break
      c = null
    }
    if (!c) {
      const q = clickByText('继续', { exact: true })
      if (q && q.ok) c = q
    }
    if (c) {
      console.log('  冲突框：' + JSON.stringify(c))
      break
    }
    await sleep(700)
  }
  const done = await waitInPage(`return /已导入|导入完成|新建 \\d+ 个资源|成功/.test(document.body.innerText) ? 'true' : 'false'`, '导入结果', 40, 800)
  await sleep(1500)
  // 反查块要重新读一遍：导入完 detail 会重取，但保险起见再点一次同一行/卡
  selectAsset('Shinano Face')
  await sleep(1200)
  shot('r4-where-02-imported.png')
  const db2 = new DatabaseSync(DB, { readOnly: true })
  const logs = db2.prepare(`SELECT status, kind, COUNT(*) n, SUM(COALESCE(json_array_length(created_guids_json),0)) created FROM import_log WHERE id > ? GROUP BY status, kind`).all(mark)
  console.log('  这轮的 import_log：' + JSON.stringify(logs) + '（等到位：' + done + '）')
  const where = ej(`(() => {
    const m = document.body.innerText
    const i = m.indexOf('在哪些工程装过')
    return JSON.stringify(i < 0 ? null : m.slice(i, i + 340).replace(/\\n+/g, ' / '))
  })()`)
  console.log('  反查块：' + JSON.stringify(where))
  db2.close()

  console.log('\n完成。截图在 ' + ROOT)
}

main().catch((e) => {
  console.error('\nFAILED: ' + (e && e.message ? e.message : e))
  process.exit(1)
})
