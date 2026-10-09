#!/usr/bin/env node
/**
 * R4 ② 沙盒活体：把规格 §8-4 那条验收**在真程序里点一遍**并截图。
 *
 *   「多选 5 个 .unitypackage → 一键导入 → 串行执行 → 进度可见 → 全部成功」
 *
 * 为什么要脚本而不是手点：进度队列跑完只要一两秒（假 Unity 秒回终态），
 * 手点截图必然踩在窗口外面 —— M6 那次横幅截图连错两轮就是这个原因。
 *
 * 走的是**用户实际路径**：真 IPC 摄取 → 真入库 → 真点卡片选中 → 真点工具栏按钮 →
 * 真点汇总卡上的"继续并备份" → 真点"整批退回"。中间只在两处用了 IPC：
 * 选导入目标（顶栏那个下拉点起来更慢，但走的是同一个 `unity:set-target`）
 * 和摄取入库（收件箱的"全部入库"按钮要按筛选算 jobIds，这里直接给同一份 jobIds）。
 *
 * ⚠ 只碰沙盒：库根/APPDATA/工程/抽取根全在 `AVCA_LIVE_ROOT` 下，路径不对直接拒绝。
 * ⚠ 跑之前确认他的 Unity 没开着（沙盒实例会发现真工程，见 docs/BRIDGE.md §13.4）。
 *
 * 用法：node tools/live-r4-batch.cjs
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
const MANIFEST = JSON.parse(fs.readFileSync(path.join(ROOT, 'live-manifest.json'), 'utf8'))
const PORT = process.env.AVCA_CDP_PORT || '9224'
const ENV = { ...process.env, AVCA_CDP_PORT: PORT }
const SHOT_DIR = process.env.AVCA_SHOT_DIR || ROOT

const CARDS = MANIFEST.cards.map((c) => c.file)
const NAMES = CARDS.map((f) => path.basename(f, '.unitypackage'))

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

function shot(name) {
  const out = path.join(SHOT_DIR, name)
  cp.execFileSync(process.execPath, [path.resolve(__dirname, 'cdp-shot.cjs'), out], { cwd: path.resolve(__dirname, '..'), env: ENV })
  console.log('  📷 ' + out)
}

/** 页面里跑一段 JS 并把返回值 JSON 解析回来（cdp-eval 打印的是字符串或 JSON） */
function evalJson(expr) {
  const raw = evalInPage(expr)
  try {
    return JSON.parse(raw)
  } catch {
    return raw
  }
}

async function waitCdp(tries = 40) {
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

/** 轮询一个页面里的布尔表达式，等到真为止 */
async function waitInPage(expr, what, tries = 40, step = 700) {
  for (let i = 0; i < tries; i++) {
    let v = null
    try {
      v = evalInPage(`(() => { ${expr} })()`)
    } catch (e) {
      /* CDP 偶尔断一下 */
    }
    if (v === 'true' || v === true) return true
    await sleep(step)
  }
  console.log('  ⚠ 等不到：' + what)
  return false
}

/**
 * 点某个带这段文字的元素。
 *
 * ⚠ 默认只认 `button`：以前这里在 `button, a, div, span…` 里挑第一个命中的，
 * 结果工具栏那个 div 的 textContent 也"包含"按钮文字，于是 `.click()` 点在了外层容器上 ——
 * 表现就是"按钮明明在屏幕上、点了没反应"。要点非按钮再传 `tag`。
 *
 * `maxLen` 是"这个元素别大到把整页都包进去"的护栏。顶栏工程下拉那一行的文字是
 * `Shinano-R4LiveTestD:\avca-r4-live\…桥接已连接`（70 字），默认 40 会把它滤掉，
 * 所以那种地方要显式放宽。
 */
function clickByText(text, opts = {}) {
  const { exact = false, index = 0, tag = 'button', maxLen = 40, startsWith = false } = opts
  return evalJson(
    `(() => {
      const want = ${JSON.stringify(text)}
      const nodes = [...document.querySelectorAll(${JSON.stringify(tag)})]
      const hit = nodes.filter(n => {
        const t = (n.textContent || '').trim()
        ${startsWith ? 'if (!t.startsWith(want)) return false' : ''}
        return ${exact ? 't === want' : `t.includes(want) && t.length < want.length + ${maxLen}`}
      })
      if (!hit[${index}]) return JSON.stringify({ ok: false, why: '找不到元素：' + want, count: hit.length, pool: nodes.length })
      hit[${index}].click()
      return JSON.stringify({ ok: true, text: hit[${index}].textContent.trim().slice(0, 60) })
    })()`
  )
}

/**
 * 按**下标**点卡片（第一张普通点，其余 ctrl+点 = 多选）。
 * 不按下标名匹配是因为显示名会被清洗：`Shinano_Hair.unitypackage` → 「Shinano」，
 * 而两张 Shinano 卡的显示名一模一样 —— 按名字点会点歪（这本身就是产品行为，不是 bug）。
 */
function clickCardByIndex(i, additive) {
  return evalJson(`(() => {
    const cards = [...document.querySelectorAll('.card')]
    const el = cards[${i}]
    if (!el) return JSON.stringify({ ok: false, why: '没有第 ${i} 张卡', seen: cards.length })
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: ${additive ? 'true' : 'false'} }))
    return JSON.stringify({ ok: true, name: (el.textContent || '').trim().slice(0, 24) })
  })()`)
}

/** 投料 + 等算完 + 点"全部入库"（字段名是 jobId 不是 id，照 CommitAll.tsx 的写法来） */
async function ingestFive() {
  const ing = evalJson(`(async () => {
    const r = await window.a.ingest.fromPaths(${JSON.stringify(CARDS)})
    return JSON.stringify({ accepted: (r.accepted || []).length, rejected: (r.rejected || []).length })
  })()`)
  console.log('  摄取：' + JSON.stringify(ing))
  let stages = null
  for (let i = 0; i < 30; i++) {
    stages = evalJson(`(async () => {
      const q = await window.a.ingest.queue()
      return JSON.stringify((q || []).map(j => ({ id: j.jobId, stage: j.stage })))
    })()`)
    const list = Array.isArray(stages) ? stages : []
    if (list.length === 5 && list.every((j) => j.stage === 'awaiting_confirm')) break
    await sleep(1500)
  }
  console.log('  收件箱：' + JSON.stringify(stages))
  const committed = evalJson(`(async () => {
    const q = await window.a.ingest.queue()
    const jobIds = (q || []).filter(j => j.stage === 'awaiting_confirm').map(j => j.jobId)
    const s = await window.a.ingest.commitAll({ jobIds, move: false })
    return JSON.stringify({ jobs: jobIds.length, summary: s })
  })()`)
  console.log('  入库：' + JSON.stringify(committed))
}

/**
 * 把顶栏那个工程下拉关掉。
 *
 * 判据不能是"页面里出现了工程名"—— 顶栏按钮自己就写着工程名。
 * 真正的信号是**存在一个以工程名开头、且不带「导入目标：」前缀的按钮**，
 * 那才是下拉里的条目。上一版没分清，截图右上角糊了一列工程名。
 */
async function closePicker() {
  for (let i = 0; i < 3; i++) {
    const open = evalInPage(`(() => {
      const hit = [...document.querySelectorAll('button')].some(b => /^Shinano-R4LiveTest/.test((b.textContent || '').trim()))
      return hit ? 'yes' : 'no'
    })()`)
    if (open !== 'yes') return
    console.log('  下拉开着，关掉它（截图别糊一层工程列表）')
    clickByText('导入目标')
    await sleep(600)
  }
}

async function main() {
  console.log('== 0. 等 A 起来 ==')
  console.log('  标题：' + (await waitCdp()))
  /**
   * 上一轮跑完对话框是开着的（脚本不点"关闭"），而 `importSelected` 有"一次只跑一批"的闸门
   * —— 不先关掉的话这一轮第一步就被自己的守卫挡住，看起来像"按钮点不动"。
   */
  if (evalInPage(`(() => /批量导入 ·/.test(document.body.innerText) ? 'yes' : 'no')()`) === 'yes') {
    console.log('  上一轮的批量导入面板还开着 → 先关掉：' + JSON.stringify(clickByText('关闭')))
    await sleep(800)
  }

  /** —— 1. 选导入目标：真点顶栏那个切换器 —— */
  console.log('== 1. 选导入目标（顶栏真点） ==')
  /**
   * 为什么不用 IPC 的 `unity:set-target`：那只改主进程，渲染层 store 里的
   * `unity.targetProjectId` 要由 `setUnityTarget` 这个 action 同步。
   * 直接调 IPC 的话界面会以为"没选目标"，批量导入第一步就退回 ——
   * 那是**测试桩自己造的假故障**，点真按钮才测得到真路径。
   *
   * ⚠ 选下拉里那一项必须按**开头**匹配：顶栏那个开关按钮自己的文字是
   * 「导入目标：Shinano-R4LiveTest」，也"包含"工程名 —— 上一版按包含匹配就点到了开关上，
   * 于是下拉被打开、再也没关掉，截图右上角糊着一列工程名。
   */
  const already = evalInPage(`(() => /导入目标：Shinano-R4LiveTest/.test(document.body.innerText) ? 'true' : 'false')()`)
  if (already === 'true') {
    console.log('  顶栏已经选中沙盒工程（上一轮留下的），不重复点')
    await closePicker()
  } else {
    let chosen = false
    for (let attempt = 0; attempt < 4 && !chosen; attempt++) {
      clickByText('导入目标')
      await sleep(900)
      const hit = clickByText('Shinano-R4LiveTest', { maxLen: 80, startsWith: true })
      if (hit && hit.ok) {
        chosen = true
        console.log('  选中：' + JSON.stringify(hit.text))
      } else {
        console.log('  下拉里没有条目，再开一次（第 ' + (attempt + 1) + ' 次）')
      }
    }
  }
  const picked = await waitInPage(
    `return /导入目标：Shinano-R4LiveTest/.test(document.body.innerText) ? 'true' : 'false'`,
    '顶栏显示已选中沙盒工程'
  )
  if (!picked) throw new Error('顶栏目标没选中，后面全是白测')

  /** —— 2. 摄取 5 张卡并入库（走真 IPC，等价于拖进窗口 + 点"全部入库"） —— */
  console.log('== 2. 摄取 5 张散装卡 ==')
  /** 这一脚本要能重跑：已经在库了就别再投一遍（重复摄取会被判"已登记"，反而把日志搅乱） */
  const pre = new DatabaseSync(DB, { readOnly: true })
    .prepare(
      `SELECT COUNT(*) AS n FROM asset WHERE (library_path LIKE ? OR source_path LIKE ?) AND parent_asset_id IS NULL`
    )
    .get(`${ROOT}%`, `${ROOT}%`)
  pre && pre.n >= 5
    ? console.log('  库里已经有 ' + pre.n + ' 张卡，跳过摄取')
    : await ingestFive()
  await sleep(1500)

  /** —— 3. 打开「全部素材」并框选 5 张卡 —— */
  console.log('== 3. 框选 5 张卡 ==')
  console.log('  ' + JSON.stringify(clickByText('全部素材', { tag: '.nav-item, a, button, div' })))
  await sleep(1500)
  /**
   * 先切「平铺」：聚合视图会把同名卡并成一张（两张 Shinano 在真库里就是同一组），
   * 那会让"框选 5 张"变成"框选 3 张"—— 那是视图语义，不是批量导入的 bug。
   */
  clickByText('平铺', { index: 0 })
  await sleep(1200)
  await waitInPage(
    `return document.querySelectorAll('.card').length >= 5 ? 'true' : 'false'`,
    '5 张卡出现在网格里'
  )
  for (let i = 0; i < 5; i++) {
    const r = clickCardByIndex(i, i > 0)
    if (r && r.ok === false) console.log('  ⚠ ' + r.why)
    else console.log('  点了第 ' + (i + 1) + ' 张：' + JSON.stringify(r.name))
    await sleep(250)
  }
  const sel = evalJson(`(() => {
    const chips = [...document.querySelectorAll('.chip')].map(n => n.textContent.trim())
    return JSON.stringify({ chips, selected: document.querySelectorAll('.card-selected').length })
  })()`)
  console.log('  选中：' + JSON.stringify(sel))
  shot('r4-01-selected.png')

  /** —— 4. 点工具栏的「导入 Unity（N）」 —— */
  console.log('== 4. 点「导入 Unity」按钮 ==')
  const btn = evalJson(`(() => {
    const b = [...document.querySelectorAll('button')].find(x => /导入 Unity/.test(x.textContent || ''))
    return JSON.stringify({ text: b ? b.textContent.trim() : null, disabled: b ? b.disabled : null })
  })()`)
  console.log('  按钮：' + JSON.stringify(btn))
  if (!btn.text) throw new Error('工具栏没出现批量导入按钮 —— 选中数不够或判据没通过')
  clickByText('导入 Unity', { index: 0 })
  const dialogUp = await waitInPage(
    `return /批量导入/.test(document.body.innerText) ? 'true' : 'false'`,
    '批量导入的汇总卡出现'
  )
  if (!dialogUp) throw new Error('汇总卡没出现')
  await sleep(800)
  shot('r4-02-plan.png')
  const planText = evalJson(`(() => {
    const m = document.body.innerText
    const line = (m.match(/这批 \\d+ 个包[^\\n]*/) || [null])[0]
    const skipped = (m.match(/\\d+ 张卡被跳过[^\\n]*/) || [null])[0]
    return JSON.stringify({ line, skipped })
  })()`)
  console.log('  汇总：' + JSON.stringify(planText))

  /** —— 5. 点「继续并备份」→ 抓进度与结果 —— */
  console.log('== 5. 继续并备份（串行跑 5 个包） ==')
  /**
   * 记下"跑之前 import_log 到哪一行"：这一脚本可以反复跑，
   * 不划界的话第 6 步会把上几轮那批也算进来，"批次数=1"就成了假结论。
   */
  const mark = new DatabaseSync(DB, { readOnly: true }).prepare(`SELECT COALESCE(MAX(id), 0) AS m FROM import_log`).get().m
  const clicked = clickByText('继续并备份', { index: 0 })
  console.log('  ' + JSON.stringify(clicked))
  /** 进度窗口很短：先抢一张"跑到一半"的，再等结果 */
  await sleep(350)
  shot('r4-03-progress.png')
  const done = await waitInPage(
    `return /这批：成功/.test(document.body.innerText) ? 'true' : 'false'`,
    '结果卡出现',
    60,
    400
  )
  if (!done) throw new Error('结果卡没出现（导入没跑完？看 fake-unity.log）')
  await sleep(500)
  shot('r4-04-result.png')
  const resultText = evalJson(`(() => {
    const m = document.body.innerText
    return JSON.stringify({
      outcome: (m.match(/这批：成功[^\\n]*/) || [null])[0],
      rows: (m.match(/成功（新 \\d+ · 覆盖 \\d+）/g) || []).length,
      notRun: (m.match(/未执行/g) || []).length
    })
  })()`)
  console.log('  结果：' + JSON.stringify(resultText))

  /** —— 6. 库侧取证：一条 batch_id、五条各自的 asset_id —— */
  console.log('== 6. 库侧取证（只读） ==')
  const db = new DatabaseSync(DB, { readOnly: true })
  const rows = db
    .prepare(
      `SELECT batch_id, asset_id, container_asset_id, member_rel_path, status,
              json_array_length(created_guids_json) AS created,
              json_array_length(overwritten_json) AS overwritten
       FROM import_log WHERE id > ? ORDER BY id`
    )
    .all(mark)
  const batches = new Set(rows.map((r) => r.batch_id))
  const assets = new Set(rows.map((r) => r.asset_id))
  console.table(rows)
  console.log('  批次数=' + batches.size + '（应为 1）· 不同素材数=' + assets.size + '（应为 5）')
  /** 备份过的事实在库里，不在界面上：撞车那条必须有 overwritten 且新建数为 0 */
  const collided = rows.filter((r) => Number(r.overwritten) > 0)
  console.log('  撞车并备份的那条：' + JSON.stringify(collided))

  /** —— 7. 整批退回 —— */
  console.log('== 7. 整批退回 ==')
  const back = clickByText('整批退回', { index: 0 })
  console.log('  ' + JSON.stringify(back))
  await sleep(2500)
  shot('r4-05-rollback.png')
  const db2 = new DatabaseSync(DB, { readOnly: true })
  const after = db2.prepare(`SELECT status, COUNT(*) AS n FROM import_log WHERE id > ? GROUP BY status`).all(mark)
  const backupDirs = db2
    .prepare(`SELECT DISTINCT backup_dir FROM import_log WHERE id > ? AND backup_dir IS NOT NULL`)
    .all(mark)
  db.close()
  db2.close()
  console.log('  退回后的 import_log：' + JSON.stringify(after))
  console.log('  备份目录（撞车那条该有一个，且文件真的在里面）：' + JSON.stringify(backupDirs))
  const projAssets = path.join(MANIFEST.projectPath, 'Assets')
  const left = []
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.isDirectory()) walk(path.join(d, e.name))
      else left.push(path.relative(projAssets, path.join(d, e.name)))
    }
  }
  walk(projAssets)
  console.log('  工程 Assets 里剩下的文件：' + JSON.stringify(left))

  console.log('\n完成。截图在 ' + SHOT_DIR)
}

main().catch((e) => {
  console.error('\nFAILED: ' + (e && e.message ? e.message : e))
  process.exit(1)
})
