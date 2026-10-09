#!/usr/bin/env node
/**
 * 真 Unity 下**连点两次「整批退回」**：第二次必须被拒，且不许把第一次的账改写成"删除 0 个"。
 *
 * 这条是 2026-10-07 那轮活体抓到的原事故形：撤销要 await 桥接回话，
 * 从"读到 status='ok'"到"写回 rolledback"中间没有占位，两次点击都会读到同一个 `ok`，
 * 于是同一批 GUID 被删两遍（第二条桥接回 `failed`），后跑那次把 message 覆盖成
 * 「撤销：删除 0 个新建资源」。修法是先原子抢权（`WHERE id=? AND status='ok'`）。
 *
 * 跑法（要真 Unity + dev 起着，见 docs/VERIFY-UNVERIFIED.md §5）：
 *   node tools/live-s8-double-rollback.cjs
 */
const fs = require('node:fs')
const path = require('node:path')
const cp = require('node:child_process')
const { DatabaseSync } = require('node:sqlite')

const ROOT = process.env.AVCA_LIVE_ROOT || 'D:\\avca-r4-live'
if (!/avca-r4-live$/i.test(path.basename(ROOT))) {
  console.error('拒绝：沙盒根目录名不对（' + ROOT + '）')
  process.exit(1)
}
const DB = path.join(ROOT, 'AppData', 'Roaming', 'A', 'library.db')
const PORT = process.env.AVCA_CDP_PORT || '9225'
const ENV = { ...process.env, AVCA_CDP_PORT: PORT }
const HERE = path.resolve(__dirname, '..')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
function ej(expr) {
  const raw = cp
    .execFileSync(process.execPath, [path.join(__dirname, 'cdp-eval.cjs'), expr], { cwd: HERE, encoding: 'utf8', env: ENV, maxBuffer: 16 * 1024 * 1024 })
    .trim()
  try {
    return JSON.parse(raw)
  } catch {
    return raw
  }
}
function click(text) {
  return ej(`(() => {
    const hit = [...document.querySelectorAll('button')].filter(b => (b.textContent || '').trim().includes(${JSON.stringify(text)}))
      .sort((a, b) => (a.textContent || '').length - (b.textContent || '').length)
    if (!hit[0]) return JSON.stringify({ ok: false, why: '没有这个按钮：' + ${JSON.stringify(text)} })
    hit[0].click()
    return JSON.stringify({ ok: true, text: hit[0].textContent.trim().slice(0, 30) })
  })()`)
}
async function wait(expr, what, tries = 60, step = 1000) {
  for (let i = 0; i < tries; i++) {
    let v = null
    try {
      v = ej(`(() => { ${expr} })()`)
    } catch {
      /* CDP 偶尔断一下 */
    }
    if (v === 'true' || v === true) return true
    await sleep(step)
  }
  console.log('  ⚠ 等不到：' + what)
  return false
}

/** 撤销是**原地改那一行**，所以判进度只能按 id 比大小（ULID 字典序=时间序） */
function maxId() {
  const d = new DatabaseSync(DB, { readOnly: true })
  const m = String(d.prepare(`SELECT COALESCE(MAX(id),'0') m FROM import_log`).get().m)
  d.close()
  return m
}
function countNewOk(afterId) {
  const d = new DatabaseSync(DB, { readOnly: true })
  const n = Number(d.prepare(`SELECT COUNT(*) n FROM import_log WHERE id > ? AND status='ok'`).get(afterId).n)
  d.close()
  return n
}

async function main() {
  console.log('== 0. 先把上一轮残留的面板关掉 ==')
  /**
   * 跨轮残留会伪装成功能坏了：上一批的结果卡还挂着（右下角那个「关闭」），
   * 这时点「导入 Unity（5）」会被"已经有一批在跑"那道闸直接挡掉，
   * 看着像汇总卡出不来。（R4 ② 那轮就记过同一条。）
   */
  for (let i = 0; i < 6; i++) {
    const r = click('关闭')
    if (!r || !r.ok) break
    await sleep(500)
  }
  console.log('  关掉残留：' + JSON.stringify({ stillThere: click('关闭') && click('关闭').ok === true }))
  await sleep(800)

  console.log('== 1. 进「全部素材」、选 5 张 .unitypackage 卡 ==')
  console.log('  ' + JSON.stringify(click('全部素材')))
  await sleep(1500)
  click('网格')
  await sleep(900)
  const idx = ej(`JSON.stringify([...document.querySelectorAll('.card')]
    .map((c, i) => ({ i, t: (c.textContent || '').trim().replace(/\\s+/g, ' ') }))
    .filter(o => !/body/i.test(o.t)).map(o => o.i).slice(0, 5))`)
  const list = Array.isArray(idx) ? idx : []
  console.log('  下标：' + JSON.stringify(list))
  for (const i of list) {
    ej(`(() => { const el=[...document.querySelectorAll('.card')][${i}]; if(el) el.dispatchEvent(new MouseEvent('click',{bubbles:true,ctrlKey:true})); return JSON.stringify({ok:!!el}) })()`)
    await sleep(250)
  }
  const before = maxId()
  console.log('  点导入：' + JSON.stringify(click('导入 Unity')))
  /**
   * 别用"页面上有没有'批量导入'四个字"判断汇总卡出没出 —— 上一批的结果卡还挂着同样的字，
   * 会一上来就"等到了"，然后什么都还没发生（这一版就是这么空跑过一次，差点把假绿当结论）。
   * 改成等那个**按钮真的在**，再等库里真的多出 5 行 ok。
   */
  const dialogUp = await wait(
    `return [...document.querySelectorAll('button')].some(b => (b.textContent || '').includes('继续并备份')) ? 'true' : 'false'`,
    '汇总卡上的「继续并备份」按钮',
    40
  )
  console.log('  汇总卡：' + dialogUp)
  await sleep(600)
  console.log('  点继续：' + JSON.stringify(click('继续并备份')))
  let okRows = 0
  for (let i = 0; i < 90; i++) {
    await sleep(1000)
    okRows = countNewOk(before)
    if (okRows >= 5) break
  }
  console.log('  这一批落了 ' + okRows + ' 行 ok（等的是库里真长出来的行，不是页面文字）')
  await sleep(2500)
  console.log('== 2. 连点两次「整批退回」（间隔 < 50ms）==')
  const two = ej(`(() => {
    const btn = [...document.querySelectorAll('button')].filter(b => (b.textContent || '').trim().includes('整批退回'))
      .sort((a, b) => (a.textContent || '').length - (b.textContent || '').length)[0]
    if (!btn) return JSON.stringify({ ok: false, why: '没有「整批退回」按钮' })
    btn.click()
    btn.click()
    return JSON.stringify({ ok: true })
  })()`)
  console.log('  ' + JSON.stringify(two))
  if (!two || !two.ok) {
    console.log('❌ 连点没做成（按钮不在），这一轮不算验过')
    process.exit(1)
  }
  await sleep(12000)
  const body = ej(`(() => {
    const m = document.body.innerText
    const hit = m.match(/[^\\n]*(正在撤销|已经撤过|还在进行中)[^\\n]*/)
    return JSON.stringify({ refused: hit ? hit[0].trim().slice(0, 90) : null })
  })()`)
  console.log('  界面有没有说"第二次被拒"：' + JSON.stringify(body))

  console.log('== 3. 库里这一批的账 ==')
  const d = new DatabaseSync(DB, { readOnly: true })
  const batch = d.prepare(`SELECT batch_id FROM import_log WHERE batch_id IS NOT NULL ORDER BY id DESC LIMIT 1`).get().batch_id
  const rows = d.prepare(`SELECT status, created_guids_json cg, message FROM import_log WHERE batch_id = ? ORDER BY id`).all(batch)
  d.close()
  console.log('  batch=' + batch)
  for (const r of rows) console.log('   ' + r.status + ' | cg=' + r.cg + ' | ' + (r.message ?? ''))
  const created = rows.filter((r) => r.cg && r.cg !== '[]')
  const lied = created.filter((r) => /删除 0 个新建资源/.test(r.message ?? ''))
  console.log(
    lied.length === 0
      ? '\n✅ 有 created_guids 的行没有一条被写成"删除 0 个"（第二次撤销被抢权挡在门外）'
      : '\n❌ 还是被覆盖了：' + JSON.stringify(lied)
  )
  process.exit(lied.length ? 1 : 0)
}

main().catch((e) => {
  console.error('FAILED: ' + (e && e.message ? e.message : e))
  process.exit(1)
})
