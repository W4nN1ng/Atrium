#!/usr/bin/env node
/**
 * 第 4 轮 · M5-B 挂着的两条欠账之一：**一个容器里 >8 个成员，必须自动切两批、一次只抽一批**。
 *
 * 为什么值得单独写一个驱动（`live-r4-batch.cjs` 那条测的是**跨卡**批量，N 张卡各一个包）：
 * 这条是**一张卡里 10 个包**，走的是成员选择面板那条三步链
 * （勾选 → 这一批的冲突汇总 → 这一批的结果 → 才问要不要下一批）。
 * `IMPORT_BATCH_MAX = 8`，10 个成员要切成 8 + 2；离线单测钉的是**怎么切**
 * （`tests/shared/member-pick.spec.ts`），真程序里"两批一批一批走、第二批没抽之前第一批先落地"
 * 这一段只有活体能证明 —— 本仓库渲染层零 DOM 测试。
 *
 * 五个 stage：
 *   --stage=batch      全 10 个 → 8 + 2 两批一路导到底 → 取证 → 按批退回
 *   --stage=stop       全 10 个 → 导完第一批 → 点「就导到这儿」→ 剩下的**不许被抽出来**
 *   --stage=play       假 Play（假对端装忙）：A 侧的排队 / 界面那句 / 退出后自动执行
 *   --stage=real       ⭐ 真 Unity：包真被收下、GUID 与目录 .meta、冲突备份、逐字节还原
 *   --stage=play-real  ⭐ 真 Unity + 真 Play：`IsBusy()` 真会翻，A 收到的是 busy 不是 error
 *
 * ⚠ 对端是 `tools/fake-unity-live.cjs`（假 Unity）：它照契约收发文件信箱，
 *   但 `import_unitypackage` 只是按 pathname 把文件铺进 `Assets/`，**不走 AssetDatabase**。
 *   所以这一轮证的是 A 这一侧的链路 + 界面画法；真 Unity 下导入结果算另一条欠账。
 * ⚠ 全程只碰 `D:\avca-m5b-live`（库根 / 假工程 / 抽取根 / APPDATA 都在里面），
 *   碰到别的目录名一律拒绝。
 *
 * 前置（按顺序，见 docs/VERIFY-UNVERIFIED.md §10 的复现块）：
 *   AVCA_M5B_MEMBERS=10 node tools/make-m5b-live-tree.cjs
 *   node tools/fake-unity-live.cjs D:\\avca-m5b-live\\projects\\Shinano-LiveTest
 *   AVCA_APP_HOME=D:\\avca-m5b-live\\AppData\\Roaming\\A LOCALAPPDATA=D:\\avca-m5b-live\\AppData\\Local \
 *     dist\\win-unpacked\\Atrium.exe --remote-debugging-port=9226
 *   AVCA_CDP_PORT=9226 node tools/live-r4-members.cjs --stage=batch
 */
const fs = require('node:fs')
const path = require('node:path')
const cp = require('node:child_process')
const { DatabaseSync } = require('node:sqlite')

const ROOT = process.env.AVCA_LIVE_ROOT || 'D:\\avca-m5b-live'
if (!/avca-m5b-live|avca-live|sandbox/i.test(path.basename(ROOT))) {
  console.error(`拒绝：沙盒根目录名不对（${ROOT}）—— 这个脚本只许往沙盒里写`)
  process.exit(1)
}
const HERE = path.resolve(__dirname, '..')
const PORT = process.env.AVCA_CDP_PORT || '9226'
const ENV = { ...process.env, AVCA_CDP_PORT: PORT }
const SHOT_DIR = process.env.AVCA_SHOT_DIR || ROOT
const STAGE = (process.argv.find((a) => /^--stage=/.test(a)) || '--stage=batch').split('=')[1]
const DB = path.join(ROOT, 'AppData', 'Roaming', 'A', 'library.db')
const MANIFEST = JSON.parse(fs.readFileSync(path.join(ROOT, 'live-manifest.json'), 'utf8'))
const CONTAINER = MANIFEST.container
const PROJ = MANIFEST.projectPath
const EXTRACT = MANIFEST.extractRoot
const MEMBERS = MANIFEST.members.map((m) => m.file)
const BATCH_MAX = Number(process.env.AVCA_BATCH_MAX || 8)
/** 卡片显示名会被清洗（下划线→空格），这里按"包含 PosePack"认那张卡 */
const CARD_HINT = 'PosePack'
/** 假 Play 开关（`fake-unity-live.cjs` 认这个文件）与 A 自己的日志 */
const PLAY_FLAG = path.join(PROJ, 'Temp', 'AVCABridge', 'play.txt')
const MAIN_LOG = path.join(ROOT, 'AppData', 'Roaming', 'A', 'logs', 'main.log')
function logTail(file, n) {
  try {
    return fs.readFileSync(file, 'utf8').split(/\r?\n/).slice(-n).join('\n')
  } catch {
    return ''
  }
}
/** 整份日志按行读（活体只认**本次点下去之后**新增的那些行，旧行不能混进来） */
function logLines(file) {
  try {
    return fs.readFileSync(file, 'utf8').split(/\r?\n/)
  } catch {
    return []
  }
}
/**
 * 本次点下去之后的"排队中"日志行 —— 按**每行开头的时间戳**筛，不按行号切。
 * ⚠ 第一版按行号切，把上一轮那三行算了进来，于是已经修好的第一步退避
 *   又被读成 2000ms → 驱动自己报了一次假失败（第 4 轮活体踩过）。
 */
function queuedLinesSince(clickAt) {
  const d = new Date(clickAt)
  const pad = (n) => String(n).padStart(2, '0')
  const since = `[${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  const rows = logLines(MAIN_LOG).filter((l) => l.includes('排队中') && l.slice(0, 20) >= since)
  return { since, rows }
}
/** 从"排队中，等 Nms"那些行里抠出退避序列 */
function backoffOf(rows) {
  return rows.map((l) => Number((/等 (\d+)ms/.exec(l) || [])[1])).filter(Boolean)
}
/**
 * ⚠ 顶层那张容器卡的 `name` **不是** `Shinano_PosePack` —— 分类器把合集的显示名取成了
 * 某个成员的名字（实测这一版造出来的卡叫「Manuka Dress」，`raw_name` 才是 `.zip` 的名字）。
 * 所以 DOM 那边不许按 `PosePack` 找，必须先从库里把顶层行的 `name` 读出来再按它找。
 * 这是活体第一跑撞的坑，写成硬规矩免得下次又按容器名点空。
 */
let containerId = ''
let containerName = ''

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function evalInPage(expr) {
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
  const raw = evalInPage(expr)
  try {
    return JSON.parse(raw)
  } catch {
    return raw
  }
}
function shot(name) {
  const out = path.join(SHOT_DIR, name)
  cp.execFileSync(process.execPath, [path.join(__dirname, 'cdp-shot.cjs'), out], { cwd: HERE, env: ENV })
  console.log('  📷 ' + out)
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
  throw new Error('CDP 连不上（端口 ' + PORT + '）')
}
function clickByText(text, opts = {}) {
  const { tag = 'button', maxLen = 40, exact = false, startsWith = false, index = 0 } = opts
  return ej(`(() => {
    const want = ${JSON.stringify(text)}
    const nodes = [...document.querySelectorAll(${JSON.stringify(tag)})]
    const hit = nodes.filter(n => {
      const t = (n.textContent || '').trim()
      ${startsWith ? 'if (!t.startsWith(want)) return false' : ''}
      return ${exact ? 't === want' : `t.includes(want) && t.length < want.length + ${maxLen}`}
    })
    if (!hit[${index}]) return JSON.stringify({ ok: false, why: '找不到：' + want, pool: nodes.length })
    hit[${index}].click()
    return JSON.stringify({ ok: true, text: hit[${index}].textContent.trim().slice(0, 60) })
  })()`)
}
/** 轮询页面里一个布尔表达式；等不到只报不炸（调用方决定怎么处理） */
async function waitBody(re, what, tries = 60, step = 1000) {
  for (let i = 0; i < tries; i++) {
    const t = evalInPage('document.body.innerText') || ''
    if (re.test(t)) return t
    await sleep(step)
  }
  throw new Error(`等不到：${what}（正则 ${re}）。屏幕末尾：` + String(evalInPage('document.body.innerText')).slice(-300))
}
function bodyText() {
  return evalInPage('document.body.innerText') || ''
}

/** 抽取根里现在有哪些 .unitypackage（一次只抽一批 = 这里最多只能看到一批的量） */
function extractedPackages() {
  if (!fs.existsSync(EXTRACT)) return []
  const out = []
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, e.name)
      if (e.isDirectory()) walk(full)
      else if (e.name.toLowerCase().endsWith('.unitypackage')) out.push(path.relative(EXTRACT, full))
    }
  }
  walk(EXTRACT)
  return out
}
function db() {
  return new DatabaseSync(DB, { readOnly: true })
}
function memberRows() {
  const d = db()
  try {
    return d
      .prepare(
        `SELECT id, batch_id, member_rel_path, status, created_guids_json, overwritten_json, backup_dir
           FROM import_log WHERE member_rel_path IS NOT NULL ORDER BY id`
      )
      .all()
      .map((r) => ({ ...r }))
  } finally {
    d.close()
  }
}
/**
 * ⚠ `import_log` 是**累积**的（撤销只把 status 改成 rolledback，行不删）。
 * 第一版直接数"表里有几行带 member_rel_path"，于是 `--stage=stop` 复跑时把上一轮那 10 行
 * 一起数进来，报"停手之后还有 18 行"—— 看着像第二批被偷偷导了，其实是记账读法错了。
 * 所有断言都必须打在**本轮新增的行**上：开局抓一次快照当标记。
 */
let marker = null
function newMemberRows() {
  if (!marker) throw new Error('没抓 import_log 的开局快照（marker 为空）—— 断言会数到上一轮的行')
  const seen = new Set(marker)
  return memberRows().filter((r) => !seen.has(r.id))
}
function markRows() {
  marker = memberRows().map((r) => r.id)
  console.log('  （import_log 开局已有 ' + marker.length + ' 行，本轮只看新增的）')
}
function projectFiles() {
  const a = path.join(PROJ, 'Assets')
  if (!fs.existsSync(a)) return []
  const out = []
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, e.name)
      if (e.isDirectory()) walk(full)
      else if (!e.name.endsWith('.meta')) out.push(path.relative(a, full))
    }
  }
  walk(a)
  return out.sort()
}

/** —— 通用前置：库里有那张容器卡、顶栏选中沙盒工程、面板是干净的 —— */
async function prepare() {
  console.log('== 0. 等 A 起来 ==')
  console.log('  标题：' + (await waitCdp()))
  console.log('  成员 ' + MEMBERS.length + ' 个 · 一批最多 ' + BATCH_MAX + ' → 该切 ' + Math.ceil(MEMBERS.length / BATCH_MAX) + ' 批')
  /** 上一轮留着的面板会把自己"一次只跑一批"的闸门挡在自己前面 —— 先归零 */
  if (/选要导入的包|批量导入|选包导入/.test(bodyText())) {
    console.log('  关掉上一轮残留的面板：' + JSON.stringify(clickByText('关闭')))
    await sleep(900)
  }

  console.log('== 1. 库里要有那张容器卡（没有就摄取 + 只登记入库） ==')
  const readTop = () => {
    const d = db()
    try {
      /** 按 raw_name 认（`.zip` 的名字），`parent_asset_id IS NULL` 才是那张卡 —— 子项行的 raw_name 也是它 */
      return (
        d
          .prepare(`SELECT id, name FROM asset WHERE raw_name LIKE ? AND parent_asset_id IS NULL ORDER BY id LIMIT 1`)
          .get(`%${CARD_HINT}%`) || null
      )
    } finally {
      d.close()
    }
  }
  let row = readTop()
  if (row) {
    console.log('  已经有卡（显示名「' + row.name + '」），跳过摄取（这脚本要能重跑）')
  } else {
    if (!fs.existsSync(CONTAINER)) throw new Error('容器不在：' + CONTAINER)
    const ing = ej(`(async () => {
      const r = await window.a.ingest.fromPaths(${JSON.stringify([CONTAINER])})
      return JSON.stringify({ accepted: (r.accepted || []).length, rejected: (r.rejected || []).map(x => x.reason || x.reasonKey) })
    })()`)
    console.log('  摄取：' + JSON.stringify(ing))
    for (let i = 0; i < 40; i++) {
      const q = ej(`(async () => JSON.stringify(((await window.a.ingest.queue()) || []).map(j => ({ id: j.jobId, stage: j.stage }))))()`)
      const list = Array.isArray(q) ? q : []
      if (list.length && list.every((j) => j.stage === 'awaiting_confirm')) {
        const c = ej(`(async () => JSON.stringify(await window.a.ingest.commitAll({ jobIds: ${JSON.stringify(list.map((j) => j.id))}, move: false })))()`)
        console.log('  入库（只登记、不动盘）：' + JSON.stringify(c))
        break
      }
      await sleep(1500)
    }
    await sleep(2500)
    row = readTop()
    if (!row) throw new Error('摄完了库里还是没有那张顶层容器行（分类链没认出容器？）')
  }
  containerId = row.id
  containerName = row.name
  console.log('  ⭐ 卡片：id=' + containerId.slice(-8) + ' 显示名=「' + containerName + '」')

  console.log('== 2. 顶栏选导入目标（真点，不用 IPC 后门） ==')
  const targetName = path.basename(PROJ)
  if (new RegExp('导入目标：' + targetName).test(bodyText())) {
    console.log('  已经选中 ' + targetName)
  } else {
    for (let attempt = 0; attempt < 4; attempt++) {
      clickByText('导入目标')
      await sleep(900)
      /** ⚠ 必须按开头匹配：开关自己的文字也"包含"工程名，按包含会点到开关、下拉永远关不掉 */
      const hit = clickByText(targetName, { maxLen: 90, startsWith: true })
      if (hit && hit.ok) break
      console.log('  下拉里没有条目，再开一次（第 ' + (attempt + 1) + ' 次）')
    }
  }
  await waitBody(new RegExp('导入目标：' + targetName), '顶栏显示已选中沙盒工程')
  console.log('  ✅ 目标 = ' + targetName)
}

/** 打开成员面板并全选（真路径：双击容器卡进内部 → 「选包导入 Unity」） */
async function openPanelAndPickAll() {
  console.log('== 3. 双击那张容器卡进内部 → 点「选包导入 Unity」 ==')
  clickByText('全部素材', { exact: true })
  await sleep(1500)
  clickByText('平铺')
  await sleep(900)
  const opened = ej(`(() => {
    const cards = [...document.querySelectorAll('.card')]
    const i = cards.findIndex(c => (c.textContent || '').includes(${JSON.stringify(containerName)}))
    if (i < 0) return JSON.stringify({ ok: false, why: '看不到那张容器卡', want: ${JSON.stringify(containerName)}, seen: cards.map(c => (c.textContent||'').trim().slice(0,18)) })
    cards[i].dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
    return JSON.stringify({ ok: true, i, name: cards[i].textContent.trim().slice(0, 40) })
  })()`)
  console.log('  双击：' + JSON.stringify(opened))
  if (!opened.ok) throw new Error(opened.why)
  /** 进内部之后才有那颗「选包导入 Unity」（`BundleDetail`），普通素材卡上没有 */
  const t = await waitBody(/选包导入 Unity|整包导入 Unity/, '容器内部视图')
  console.log('  进去了，看到：' + (/选包导入 Unity/.test(t) ? '「选包导入 Unity」' : '只有「整包导入 Unity」'))
  console.log('  点「选包导入 Unity」：' + JSON.stringify(clickByText('选包导入 Unity')))
  const t2 = await waitBody(/选要导入的包/, '成员面板打开')
  const found = /找到 (\d+) 个 \.unitypackage/.exec(t2)
  console.log('  面板说：' + (found ? found[0] : '（没找到那句"找到 N 个"）'))
  if (!found || Number(found[1]) !== MEMBERS.length) {
    throw new Error(`面板列出的成员数不对：${found ? found[1] : '没列'}（该是 ${MEMBERS.length}）`)
  }
  console.log('  点「全选」：' + JSON.stringify(clickByText('全选')))
  await sleep(1200)
  const picked = /已勾 (\d+) 个[^\n]*分 (\d+) 批/.exec(bodyText())
  console.log('  ⭐ 勾完这句：' + (picked ? picked[0] : '（没看到"已勾 N 个 · 分 M 批"）'))
  if (!picked || Number(picked[1]) !== MEMBERS.length) throw new Error('全选没勾满 ' + MEMBERS.length + ' 个')
  if (Number(picked[2]) !== Math.ceil(MEMBERS.length / BATCH_MAX)) {
    throw new Error(`分批数不对：${picked[2]} 批（${MEMBERS.length} 个成员、一批最多 ${BATCH_MAX} 个 → 该 ${Math.ceil(MEMBERS.length / BATCH_MAX)} 批）`)
  }
  if (!/一次最多 8 个/.test(bodyText())) console.log('  ⚠ 没看到那句"一次最多 8 个：会分 N 批…"（画法上的欠，不是链路坏）')
  shot('r4-members-01-picked.png')
}

/** 走完"这一批的冲突汇总 → 结果" */
async function runOneBatch(expectPkgs, tag, tries = 90) {
  const t1 = await waitBody(/抽取并检查这|继续下一批/, '能开始这一批')
  if (/抽取并检查这/.test(t1)) {
    console.log(`  点「抽取并检查这 N 个」：${JSON.stringify(clickByText('抽取并检查这'))}`)
  } else {
    console.log(`  点「继续下一批」：${JSON.stringify(clickByText('继续下一批'))}`)
  }
  /** 真 Unity 那一档要等它刷资源，计划页可能十几秒才出来 —— `tries` 由调用方给 */
  const plan = await waitBody(/这批 \d+ 个包/, `第 ${tag} 批的冲突汇总`, tries, 1500)
  const m = /这批 (\d+) 个包/.exec(plan)
  console.log('  ⭐ 计划页：' + (m ? m[0] : '（没数出包数）'))
  if (!m || Number(m[1]) !== expectPkgs) throw new Error(`第 ${tag} 批计划里是 ${m ? m[1] : '?'} 个包，该是 ${expectPkgs}`)
  /** 一次只抽一批：这一刻抽取根里最多只能有这一批的文件 */
  const ext = extractedPackages()
  console.log('  抽取根此刻有 ' + ext.length + ' 个 .unitypackage：' + JSON.stringify(ext.slice(0, 3)) + (ext.length > 3 ? '…' : ''))
  if (ext.length > expectPkgs) throw new Error(`抽多了：这一批只该 ${expectPkgs} 个，根里有 ${ext.length} 个（"一次只抽一批"没成立）`)
  shot(`r4-members-0${tag}-plan.png`)

  /** 有冲突就选"继续并备份"，没冲突那颗是灰的 —— 两颗都试，按返回值说话 */
  const backup = clickByText('继续并备份被覆盖文件')
  if (!backup || !backup.ok) {
    console.log('  备份那颗点不到（这批没冲突）→ 改点「继续（不备份）」：' + JSON.stringify(clickByText('继续（不备份）')))
  } else {
    console.log('  点了「继续并备份被覆盖文件」')
  }
  const res = await waitBody(/这批：成功 \d+ 个/, `第 ${tag} 批的结果卡`, tries, 1500)
  const o = /这批：成功 (\d+) 个、失败 (\d+) 个、没执行 (\d+) 个/.exec(res)
  console.log('  ⭐ 结果：' + (o ? o[0] : '（文案没读全）'))
  if (!o) throw new Error('结果卡文案读不出来')
  if (Number(o[2]) !== 0) throw new Error(`第 ${tag} 批有失败：${o[0]}`)
  if (Number(o[1]) !== expectPkgs) throw new Error(`第 ${tag} 批成功数不对：${o[0]}（该 ${expectPkgs}）`)
  shot(`r4-members-0${tag}-result.png`)
  return { ok: Number(o[1]), failed: Number(o[2]), notRun: Number(o[3]) }
}

async function stageBatch() {
  await prepare()
  markRows()
  await openPanelAndPickAll()

  console.log('== 4. 第一批（8 个） ==')
  const b1 = await runOneBatch(Math.min(BATCH_MAX, MEMBERS.length), 2)

  console.log('== 5. 第二批（剩 ' + (MEMBERS.length - BATCH_MAX) + ' 个） ==')
  if (!/还剩 1 批/.test(bodyText())) throw new Error('第一批跑完没出现「继续下一批（还剩 1 批）」—— 分批状态机没走到第二批')
  console.log('  ' + (/继续下一批[^\n]*/.exec(bodyText()) || ['（没读到那句）'])[0])
  const b2 = await runOneBatch(MEMBERS.length - BATCH_MAX, 3)

  console.log('== 6. 库侧取证（只读，只看本轮新增的行） ==')
  const rows = newMemberRows()
  const batches = [...new Set(rows.map((r) => r.batch_id))]
  console.log('  import_log 里带 member_rel_path 的行：' + rows.length + ' 行 / 批次 ' + batches.length + ' 个')
  const uniq = [...new Set(rows.map((r) => r.member_rel_path))]
  console.log('  覆盖到的成员：' + uniq.length + ' 个（该 ' + MEMBERS.length + '）')
  for (const r of rows.slice(0, 3)) console.log('    ' + r.member_rel_path + '  batch=' + String(r.batch_id).slice(-6) + '  status=' + r.status + '  created=' + (r.created_guids_json || '').slice(0, 24))
  if (rows.length !== MEMBERS.length) throw new Error(`成员行数不对：${rows.length}（该 ${MEMBERS.length}）`)
  if (batches.length !== 2) throw new Error(`批次数不对：${batches.length}（10 个成员、一批 8 → 该 2 个 batch_id）`)
  if (uniq.length !== MEMBERS.length) throw new Error(`有成员没落账：只记了 ${uniq.length} 个`)
  const perBatch = batches.map((b) => rows.filter((r) => r.batch_id === b).length)
  console.log('  ⭐ 每批行数：' + JSON.stringify(perBatch) + '（该 [8, 2]）')
  if (perBatch.sort((a, c) => c - a).join(',') !== `${BATCH_MAX},${MEMBERS.length - BATCH_MAX}`) {
    throw new Error('每批的行数形状不对：' + JSON.stringify(perBatch))
  }

  console.log('== 7. 工程侧取证：10 个成员的条目真铺进 Assets/ 了 ==')
  const files = projectFiles()
  console.log('  Assets/ 下 ' + files.length + ' 个文件（不含 .meta）')
  const wantPaths = MANIFEST.members.flatMap((m) => m.entries.map((e) => e.unityPath.replace(/^Assets[\\/]/i, '')))
  const missing = wantPaths.filter((p) => !files.includes(p.split('/').join(path.sep)))
  console.log('  该有 ' + wantPaths.length + ' 个，缺 ' + missing.length + (missing.length ? '：' + JSON.stringify(missing.slice(0, 5)) : ''))
  if (missing.length) throw new Error('有成员没落地：' + JSON.stringify(missing.slice(0, 5)))
  /** 预置那枚"撞车"资源：Ponytail.prefab 是覆盖，不是新建 —— 覆盖必须走备份 */
  const collide = rows.find((r) => (r.overwritten_json || '').length > 4)
  console.log('  有冲突那行的 overwritten：' + (collide ? String(collide.overwritten_json).slice(0, 60) + ' / backup=' + (collide.backup_dir || '（无）') : '（没找到）'))
  if (collide && !collide.backup_dir) throw new Error('报了"会被覆盖"却没留备份目录 —— 那句"已备份"就是撒谎')

  console.log('== 8. 「整批退回」：先按界面给的那一批撤 ==')
  /**
   * ⚠ 这颗按钮撤的是**当前结果卡那一批**（`rollbackBatch(o.batchId)`，o 是最后一次的 outcome），
   * 不是一整轮 10 个。一批一条 batch_id 是 M5-B ④ 定的账目形状，不是这里漏写。
   * 界面在第二批之后**再没有入口能撤第一批** —— 这一条记成本轮翻出来的 UX 欠账（第 6 轮 M7 裁定要不要补）。
   */
  if (!/整批退回/.test(bodyText())) throw new Error('第二批的结果卡上没有「整批退回」入口（画法变了？）')
  console.log('  点「整批退回」（撤的是最后那一批 ' + (MEMBERS.length - BATCH_MAX) + ' 个）：' + JSON.stringify(clickByText('整批退回')))
  const rb = await waitBody(/已退回|退回 \d+|撤销|删除 \d+|没有/, '整批退回的回话', 30, 1000)
  const line = /(已退回[^\n]{0,80}|退回[^\n]{0,80}|撤销[^\n]{0,80}|删除[^\n]{0,80})/.exec(rb)
  console.log('  ⭐ 回话：' + (line ? line[0] : '（没读到具体那句，屏末：' + rb.slice(-120) + '）'))
  shot('r4-members-04-rolledback.png')
  await sleep(2000)
  const rows2 = newMemberRows()
  const byStatus = {}
  for (const r of rows2) byStatus[r.status] = (byStatus[r.status] || 0) + 1
  console.log('  import_log 状态分布：' + JSON.stringify(byStatus))
  const lastBatch = rows2[rows2.length - 1].batch_id
  const lastRows = rows2.filter((r) => r.batch_id === lastBatch)
  console.log('  最后那一批 ' + lastRows.length + ' 行的状态：' + JSON.stringify(lastRows.map((r) => r.status)))
  if (!lastRows.every((r) => r.status === 'rolledback')) {
    throw new Error('最后那一批没全写成 rolledback：' + JSON.stringify(lastRows.map((r) => r.status)))
  }
  const stillThere = projectFiles().filter((f) => {
    const rel = f.split(path.sep).join('/')
    return MANIFEST.members
      .filter((m) => lastRows.some((r) => r.member_rel_path === m.file))
      .flatMap((m) => m.entries.map((e) => e.unityPath))
      .includes(rel)
  })
  console.log('  那一批的文件还留在 Assets/ 里吗：' + JSON.stringify(stillThere) + '（该是空）')

  console.log('== 9. 第一批（8 个）只能从 IPC 撤 —— 界面已经没有入口了 ==')
  /**
   * 这一步**不是用户路径**：`window.a.unity.rollbackBatch(<第一批的 batchId>)`。
   * 用它是因为要把"能不能撤干净"这件事证完，同时把"界面缺入口"这条留在报告里 ——
   * 拿后门的结果冒充界面能用，就是撒谎。
   */
  const firstBatch = [...new Set(rows2.map((r) => r.batch_id))].find((b) => b !== lastBatch)
  const r2 = ej(`(async () => JSON.stringify(await window.a.unity.rollbackBatch(${JSON.stringify(firstBatch)})))()`)
  console.log('  撤第一批 batch=' + String(firstBatch).slice(-6) + ' → ' + JSON.stringify(r2).slice(0, 220))
  await sleep(1500)
  const rows3 = newMemberRows()
  const notBack = rows3.filter((r) => r.status !== 'rolledback')
  console.log('  ⭐ 现在 ' + rows3.length + ' 行里还没退掉的：' + notBack.length + '（该是 0）')
  const left = projectFiles().filter((f) => wantPaths.includes(f))
  console.log('  两批都退完之后 Assets/ 里还剩这批的 ' + left.length + ' 个文件（该是 0，被覆盖那份除外）')
  console.log('  抽取根还剩 ' + extractedPackages().length + ' 个 .unitypackage（该是 0）')
  console.log('\n（batch）10 个成员 = 8 + 2 两批一路走完、一次只抽一批、账与文件都对得上；退回按批各撤一次。')
}

async function stageStop() {
  await prepare()
  markRows()
  await openPanelAndPickAll()

  console.log('== 4. 只导第一批，然后点「就导到这儿」 ==')
  const b1 = await runOneBatch(Math.min(BATCH_MAX, MEMBERS.length), 2)
  if (!/还剩 1 批/.test(bodyText())) throw new Error('没出现「继续下一批」，谈不上"停"')
  const before = extractedPackages()
  console.log('  点「就导到这儿」：' + JSON.stringify(clickByText('就导到这儿')))
  await sleep(2500)
  const after = extractedPackages()
  console.log('  抽取根：停之前 ' + before.length + ' 个 → 之后 ' + after.length + ' 个')
  console.log('  面板还在吗：' + (/选要导入的包/.test(bodyText()) ? '在' : '已关'))
  const rows = newMemberRows()
  const uniq = [...new Set(rows.map((r) => r.member_rel_path))]
  console.log('  ⭐ import_log 有 ' + rows.length + ' 行 / ' + uniq.length + ' 个成员（该正好是第一批的 ' + BATCH_MAX + ' 个）')
  const never = MEMBERS.filter((m) => !uniq.includes(m))
  console.log('  从没导过的成员：' + JSON.stringify(never))
  if (rows.length !== BATCH_MAX) throw new Error(`停手之后还有 ${rows.length} 行 —— 剩下的批次被偷偷抽导了`)
  if (never.length !== MEMBERS.length - BATCH_MAX) throw new Error('第二批的成员出现在账上了：' + JSON.stringify(never))
  if (after.length) console.log('  ⚠ 停止之后抽取根还剩 ' + after.length + ' 个副本（清理时机是不是该在停手时也走一遍）')
  shot('r4-members-05-stopped.png')
  console.log('\n（stop）第一批导完就停手：剩下的 ' + never.length + ' 个既没抽也没导，账上只有 ' + BATCH_MAX + ' 行。')
}

/**
 * §8-5「Play 模式下点导入 → 排队 → 退出后自动执行」—— **A 这一侧**的分量。
 *
 * 忙是假对端装的（`<工程>/Temp/AVCABridge/play.txt` 一在就回 `busy` + 那句 C# 原文的
 * `busyReason`，而且**不消费命令**）。这一条证的是：
 *  1. A 收到 busy 不算失败、按固定退避序列重试（凭 A 自己写的日志 `[bridge] … 排队中…第 N 次重试`）；
 *  2. 界面上有那句"已排队 · 第 N 次重试 · X 秒后再试"，用户看得见（不是"正在导入"几分钟不动）；
 *  3. 忙一解除**自己就导完了，不需要用户再点一次**；
 *  4. 期间库里一行都没有（真没导），事后一次不少。
 * ⚠ 这不等于"真 Unity 的 Play 模式会回 busy" —— 那是 `AVCABridge.cs:IsBusy()` 的事，
 *   只有真编辑器能证，判据分开写，谁也不许冒充谁。
 */
async function stagePlay() {
  const N = 2
  await prepare()
  markRows()
  const inboxDir = path.join(PROJ, 'Temp', 'AVCABridge')
  const clearFlag = () => fs.rmSync(PLAY_FLAG, { force: true })
  clearFlag()

  console.log('== 3. 开面板，只勾前 ' + N + ' 个成员（多了退避一轮太久） ==')
  clickByText('全部素材', { exact: true })
  await sleep(1500)
  const opened = ej(`(() => {
    const cards = [...document.querySelectorAll('.card')]
    const i = cards.findIndex(c => (c.textContent || '').includes(${JSON.stringify(containerName)}))
    if (i < 0) return JSON.stringify({ ok: false, why: '看不到那张容器卡' })
    cards[i].dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
    return JSON.stringify({ ok: true, i })
  })()`)
  if (!opened.ok) throw new Error(opened.why)
  await waitBody(/选包导入 Unity/, '容器内部视图')
  console.log('  点「选包导入 Unity」：' + JSON.stringify(clickByText('选包导入 Unity')))
  await waitBody(/选要导入的包/, '成员面板')
  console.log('  先清空再勾前 ' + N + ' 个：' + JSON.stringify(clickByText('清空')))
  await sleep(700)
  const ticked = ej(`(() => {
    /**
     * ⚠ 不能按"全文档的 input[type=checkbox]"下标勾：那一页里一共有 21 个复选框
     * （列表/侧栏也有），勾到的根本不是成员行 —— 活体第一跑就是"已勾 0 个"，
     * 因为勾在了别处。成员行的特征是 label 里写着 xxx.unitypackage 这个文件名。
     */
    const rows = [...document.querySelectorAll('label')].filter(l => /\\.unitypackage/i.test(l.textContent || ''))
    for (let i = 0; i < ${N} && i < rows.length; i++) {
      const b = rows[i].querySelector('input[type=checkbox]')
      if (b && !b.checked) b.click()
    }
    return JSON.stringify({
      rows: rows.length,
      checked: rows.filter(r => { const b = r.querySelector('input[type=checkbox]'); return b && b.checked }).map(r => (r.textContent || '').trim().slice(0, 28))
    })
  })()`)
  console.log('  ' + JSON.stringify(ticked))
  if (ticked.checked.length !== N) throw new Error('勾不上：只勾到 ' + ticked.checked.length + ' 个成员行')
  await sleep(600)
  const pickedNote = /(已勾 \d+ 个[^\n]*)/.exec(bodyText())
  console.log('  面板那句：' + (pickedNote ? pickedNote[1] : '（没读到"已勾 N 个"）'))
  console.log('  点「抽取并检查这 ' + N + ' 个」：' + JSON.stringify(clickByText('抽取并检查这')))
  await waitBody(/这批 \d+ 个包/, '计划页')
  console.log('  计划页：' + ((/这批 \d+ 个包[^\n]*/.exec(bodyText()) || ['（没读到）'])[0]))

  console.log('== 4. 把假对端切到"正在 Play"，然后点导 ==')
  /** 写 'until-deleted'：不是数字 → 假对端按"忙到文件被删为止"处理（epoch 得 ≥1e12 才当时刻用） */
  fs.writeFileSync(PLAY_FLAG, 'until-deleted', 'utf8')
  console.log('  写了 ' + PLAY_FLAG + '（= Play 模式开着）')
  /** 心跳每 500ms 重写一次，刚写完文件那一刻读到的还是旧的一份 —— 要等它翻过来 */
  let hb = null
  for (let i = 0; i < 12; i++) {
    hb = JSON.parse(fs.readFileSync(path.join(inboxDir, 'bridge.json'), 'utf8'))
    if (hb.isPlaying) break
    await sleep(400)
  }
  console.log('  心跳现在报：isPlaying=' + hb.isPlaying + ' · busyReason=' + hb.busyReason)
  if (!hb.isPlaying) throw new Error('心跳没报 isPlaying（等了 ~5 秒），假对端的开关没生效')
  const clickAt = Date.now()
  /**
   * ⚠ 这批 0 冲突 → 「继续（不备份）」那颗是 **disabled** 的（`!summary.withConflicts`），
   * 对 disabled 按钮调 `.click()` 什么都不发生 —— 第一版点了它，于是"永远等不到排队"，
   * 看着像排队没实现。要点启用中的那颗（备份开着时是「继续并备份被覆盖文件」）。
   */
  const go = clickByText('继续并备份被覆盖文件')
  console.log('  点「继续并备份被覆盖文件」：' + JSON.stringify(go))
  if (!go || !go.ok) console.log('  退一步点「继续（不备份）」：' + JSON.stringify(clickByText('继续（不备份）')))

  console.log('== 5. 界面上必须看得见"已排队"，而不是"正在导入"干等 ==')
  const q = await waitBody(/已排队（Unity 正在运行 Play 模式）/, '那句"已排队（原因）· 第 N 次重试 · X 秒后再试"', 25, 800)
  const note = /(已排队[^\n]*|排队中[^\n]*)/.exec(q)
  console.log('  ⭐ ' + (note ? note[0] : '（没读到）'))
  shot('r4-members-06-queued.png')
  await sleep(4200)
  const note2 = /(已排队[^\n]*)/.exec(bodyText())
  console.log('  几秒后再看（重试次数要涨上去）：' + (note2 ? note2[1] : '（没了？）'))
  shot('r4-members-07-queued-retry.png')

  console.log('== 6. 期间库里一行都不许多（真没导进去） ==')
  const during = newMemberRows()
  console.log('  此刻新增行：' + during.length + '（该是 0）')
  if (during.length) throw new Error('忙的时候就已经落账了：' + JSON.stringify(during.map((r) => r.member_rel_path)))

  console.log('== 7. 退出 Play（删开关），不许用户再点一次就该自己跑完 ==')
  clearFlag()
  const res = await waitBody(/这批：成功 \d+ 个/, '结果卡（忙完之后自动执行）', 60, 1500)
  const o = /这批：成功 (\d+) 个、失败 (\d+) 个、没执行 (\d+) 个/.exec(res)
  console.log('  ⭐ ' + (o ? o[0] : '（文案没读全）'))
  const secs = Math.round((Date.now() - clickAt) / 1000)
  console.log('  从点「继续」到跑完：' + secs + ' 秒（含排队重试的退避）')
  shot('r4-members-08-after-play.png')
  if (!o || Number(o[1]) !== N) throw new Error('忙完之后没自动导全：' + (o ? o[0] : '没结果'))
  const rows = newMemberRows()
  console.log('  新增 ' + rows.length + ' 行 / 状态 ' + JSON.stringify([...new Set(rows.map((r) => r.status))]))
  if (rows.length !== N) throw new Error('账上的行数不对：' + rows.length)

  console.log('== 8. A 自己写的退避日志（固定序列那条） ==')
  const { since, rows: busyLines } = queuedLinesSince(clickAt)
  console.log(`  本次的排队行（时间戳 ≥ ${since}…，共 ${busyLines.length} 条）：`)
  for (const l of busyLines.slice(-6)) console.log('    ' + l.replace(/^\[[^\]]+\]\s*/, '').slice(0, 150))
  if (busyLines.length < 2) throw new Error('本次只看到 ' + busyLines.length + ' 行排队日志，退避重试至少该有两轮')
  const delays = backoffOf(busyLines)
  console.log('  ⭐ 退避到的毫秒序列：' + JSON.stringify(delays))
  /** `BUSY_BACKOFF_MS = [1000,2000,5000,10000,30000,30000]`，第一条就是 1s */
  /** 序列定死是 1s→2s→5s→10s→30s：第一步不是 1000ms 就是那个下标 bug 回来了（第 4 轮就是这么发现的） */
  if (delays[0] !== 1000) throw new Error(`第一次退避是 ${delays[0]}ms，规格 §2.5 定死的第一档是 1000ms`)

  console.log('== 9. 收尾：把这 ' + N + ' 个退回，沙盒留着下次能重跑 ==')
  console.log('  点「整批退回」：' + JSON.stringify(clickByText('整批退回')))
  await sleep(3500)
  const after = newMemberRows()
  console.log('  退回之后状态：' + JSON.stringify([...new Set(after.map((r) => r.status))]))
  console.log('\n（play）busy 不是失败：界面看得见排队、期间不落账、退出 Play 自己跑完、退避日志按序列走。')
}

/**
 * ⭐ 真 Unity 那一档：**真的 2022.3.22f1 打开沙盒工程**，把成员一路导进去。
 *
 * 和假对端的分工要分清 —— 假对端证的是 A 侧链路，这一条证的是：
 *  1. 心跳来自真编辑器（`bridgeVersion 1.0.0`、pid 是 Unity 的），不是我们那个 `1.0.0-live`；
 *  2. 包**真的被 Unity 收下**了：文件落进 `Assets/`，`.meta` 里的 GUID 就是包里那一条；
 *     中途新建的**目录**的 `.meta` 是 Unity 自己生成的（`folderAsset: yes`，GUID 不是包里的）；
 *  3. 预扫描报的"会被覆盖"是真的：预置那枚同路径同 GUID 的资源被列出来、被备份、
 *     内容先被改掉再导 —— 撤销之后必须逐字节等于**被改过的那份**（不是包里那份）；
 *  4. >8 成员在真编辑器下照样切两批、串行跑完。
 *
 * ⚠ 跑之前 `AVCA_M5B_TEXT_ENTRIES=1` 那档是必须的：假 `.prefab/.anim` 真 Unity 会拒收，
 *   那时 `createdGuids` 空是 Unity 的问题，不是 A 的。
 */
async function stageReal() {
  const inboxDir = path.join(PROJ, 'Temp', 'AVCABridge')
  await prepare()
  markRows()

  console.log('== R0. 心跳必须是真编辑器写的 ==')
  const hbRaw = fs.readFileSync(path.join(inboxDir, 'bridge.json'), 'utf8')
  const hb = JSON.parse(hbRaw)
  console.log('  ' + JSON.stringify({ bridgeVersion: hb.bridgeVersion, unityVersion: hb.unityVersion, pid: hb.pid, projectName: hb.projectName }))
  if (hb.bridgeVersion === '1.0.0-live') throw new Error('心跳来自假对端 —— 真 Unity 没起来或假对端还活着，这一轮不算')
  if (!/2022\.3/.test(String(hb.unityVersion))) throw new Error('unityVersion 不像真编辑器：' + hb.unityVersion)
  /**
   * ⚠ 这里给 `tasklist` 传的是**单斜杠** `/FI`：bash 里要写 `//FI` 是因为 MSYS 会把
   * 单斜杠参数当路径转掉，而 `execFileSync` 直接交给 Windows，转成 `//FI` 反而报
   * "无效参数/选项"（活体第一跑就栽在这儿）。
   */
  const alive = cp.execFileSync('tasklist', ['/FI', 'PID eq ' + hb.pid, '/FO', 'CSV', '/NH'], { encoding: 'utf8' })
  console.log('  pid ' + hb.pid + ' 在跑吗：' + String(alive).trim().slice(0, 80))
  if (!String(alive).includes('Unity.exe')) throw new Error('心跳里的 pid 不是活着的 Unity.exe')

  /** 记下游码：撤销之后要逐字节比"还原的是被改过的那份" */
  const collideGuid = MANIFEST.members[0].entries[0].guid
  const collideEntry = MANIFEST.members[0].entries[0].unityPath
  const collideAbs = path.join(PROJ, 'Assets', collideEntry.replace(/^Assets[\\/]/i, ''))
  console.log('  预置撞车资源：' + collideAbs + '（guid ' + collideGuid.slice(0, 8) + '…）')
  if (!fs.existsSync(collideAbs)) throw new Error('预置的撞车资源不在，冲突这条测不了（重造沙盒时忘了 TEXT_ENTRIES 一致性？）')
  const tampered = '这是用户在工程里改过的内容 2026-10-07 —— 撤销之后必须一字不差回到这里\n'
  fs.writeFileSync(collideAbs, tampered, 'utf8')
  console.log('  先把它的内容改掉（不比这一步就是自证：还原成包里那份也叫"成功"）')

  await openPanelAndPickAll()

  console.log('== R1. 第一批（真编辑器要刷资源、编译，慢是正常） ==')
  const b1 = await runOneBatch(Math.min(BATCH_MAX, MEMBERS.length), 2, 240)
  console.log('== R2. 第二批 ==')
  const b2 = await runOneBatch(MEMBERS.length - BATCH_MAX, 3, 240)

  console.log('== R3. 盘上取证：条目真落地、GUID 就是包里那条 ==')
  const rows = newMemberRows()
  const allCreated = rows.flatMap((r) => JSON.parse(r.created_guids_json || '[]'))
  const allOverwritten = rows.flatMap((r) => JSON.parse(r.overwritten_json || '[]'))
  console.log('  10 行账 / created ' + allCreated.length + ' 个 GUID / overwritten ' + allOverwritten.length + ' 个')
  const hex32 = /^[0-9a-f]{32}$/
  if (!allCreated.every((g) => hex32.test(g))) throw new Error('createdGuids 里有不是 32 位十六进制的：' + JSON.stringify(allCreated.slice(0, 4)))
  let checked = 0
  for (const m of MANIFEST.members) {
    for (const e of m.entries) {
      const rel = e.unityPath.replace(/^Assets[\\/]/i, '')
      const abs = path.join(PROJ, 'Assets', rel)
      if (!fs.existsSync(abs)) throw new Error('条目没落地：' + e.unityPath)
      const meta = fs.readFileSync(abs + '.meta', 'utf8')
      const g = (/^guid:\s*([0-9a-f]{32})/m.exec(meta) || [])[1]
      if (g !== e.guid) throw new Error(`.meta 里的 GUID 不是包里那条：${e.unityPath} → ${g}（该 ${e.guid}）`)
      checked++
    }
  }
  console.log('  ⭐ 逐条核过 ' + checked + ' 个条目：文件在、.meta 的 GUID 就是包里的')
  /** 目录的 .meta 是 Unity 自己生成的：folderAsset: yes 且 GUID 不在包里 */
  const dirMeta = path.join(PROJ, 'Assets', 'Shinano', 'Pose', 'Shinano_Pose01_anim.json.meta')
  const parentMeta = fs.readFileSync(path.join(PROJ, 'Assets', 'Shinano', 'Pose.meta'), 'utf8')
  console.log('  新建目录的 .meta（Pose）：' + parentMeta.replace(/\s+/g, ' ').slice(0, 90))
  if (!/folderAsset:\s*yes/.test(parentMeta)) throw new Error('目录 .meta 没有 folderAsset: yes —— 不是 Unity 生成的那份')
  const pkgGuids = new Set(MANIFEST.members.flatMap((m) => m.entries.map((e) => e.guid)))
  const dg = (/^guid:\s*([0-9a-f]{32})/m.exec(parentMeta) || [])[1]
  if (pkgGuids.has(dg)) throw new Error('目录 GUID 竟然来自包里 —— 那份 .meta 是抄的，不是 Unity 生成的')
  console.log('  ⭐ 目录 GUID ' + dg.slice(0, 8) + '… 不在包里 = Unity 自己给的（剪贴板式手写 .meta 那条禁令的反证）')
  if (!fs.existsSync(dirMeta)) throw new Error('条目 .meta 不在：' + dirMeta)

  console.log('== R4. 冲突那条：被覆盖的要真被备份下来 ==')
  const collideRow = rows.find((r) => (r.overwritten_json || '').includes(collideGuid))
  if (!collideRow) throw new Error('预置那枚资源没被列进 overwritten —— 冲突预扫描在真 Unity 下没报出来')
  console.log('  撞车那行：' + collideRow.member_rel_path + ' / backup=' + collideRow.backup_dir)
  if (!collideRow.backup_dir) throw new Error('报了覆盖却没备份目录')

  console.log('== R5. 「整批退回」这一批，然后 IPC 撤第一批；被改过的内容要逐字节还原 ==')
  const lastBatch = rows[rows.length - 1].batch_id
  console.log('  点「整批退回」：' + JSON.stringify(clickByText('整批退回')))
  /** ⚠ 要点到终态：真 Unity 删资源要等资产库刷新，固定 sleep 会留下"看着撤了其实没撤完"的现场（P4 就踩过） */
  let stillOk = []
  for (let i = 0; i < 45; i++) {
    await sleep(2000)
    stillOk = newMemberRows().filter((r) => r.status === 'ok' && r.batch_id === lastBatch)
    if (!stillOk.length) break
  }
  console.log('  最后那一批还没撤的行：' + stillOk.length + '（该是 0）')
  if (stillOk.length) throw new Error('「整批退回」没走到终态：还有 ' + stillOk.length + ' 行是 ok')
  const afterRows = newMemberRows()
  const firstBatch = [...new Set(afterRows.map((r) => r.batch_id))].find((b) => b !== lastBatch)
  const r2 = ej(`(async () => JSON.stringify(await window.a.unity.rollbackBatch(${JSON.stringify(firstBatch)})))()`)
  console.log('  IPC 撤第一批 batch=' + String(firstBatch).slice(-6) + ' → attempted=' + r2.attempted + ' rolledBack=' + r2.rolledBack)
  /**
   * ⭐ 硬断言而不是打印计数：撤销必须**每一行**都写成 rolledback。
   *   第一版这里只把数字打出来就往下走，"看起来核过"和"断言过"是两件事。
   */
  let notBack = newMemberRows().filter((x) => x.status !== 'rolledback')
  for (let i = 0; i < 45 && notBack.length; i++) {
    await sleep(2000)
    notBack = newMemberRows().filter((x) => x.status !== 'rolledback')
  }
  console.log('  ⭐ 10 行里还没撤掉的：' + notBack.length + '（该是 0）')
  if (notBack.length) throw new Error('撤不干净：' + JSON.stringify(notBack.map((x) => [x.member_rel_path, x.status])))
  const back = fs.readFileSync(collideAbs, 'utf8')
  console.log('  ⭐ 被覆盖那份还原后的内容逐字节等于"用户改过的那份"吗：' + (back === tampered))
  if (back !== tampered) {
    throw new Error('还原错了：撤销把包里的内容写回来了，用户改的东西丢了')
  }
  const collideRel = collideEntry.replace(/^Assets[\\/]/i, '').split('/').join(path.sep)
  const stillFiles = projectFiles().filter((f) =>
    MANIFEST.members.flatMap((m) => m.entries.map((e) => e.unityPath.replace(/^Assets[\\/]/i, '').split('/').join(path.sep))).includes(f)
  )
  console.log('  撤完之后这批新建的还剩 ' + stillFiles.length + ' 个（该只剩预置那枚撞车资源，它是"被覆盖还原"不是"新建"）')
  /**
   * ⚠ 第一版这里报了个假故障：说"还剩 1 个"。其实那 1 个就是预置的撞车资源 ——
   *   排除它时用了正斜杠比 `projectFiles()` 返回的反斜杠（同一个坑第 3 轮刚记过一次）。
   *   判"在不在清单里"一律先把两边都 `split('/').join(path.sep)`。
   */
  const residue = stillFiles.filter((f) => f !== collideRel)
  if (residue.length) throw new Error('撤销没把这次新建的资源删干净：' + JSON.stringify(residue))
  /** 真 Unity 的另一条残留：A 只删这次新建的**资源**，空目录与它们的 .meta 留在工程里（记进 §10，不是本轮要修的） */
  const dirsNow = projectFiles().length
  console.log('  工程里现在还剩 ' + dirsNow + ' 个文件（含 .meta 的统计见 probe）—— 空目录的 .meta 没跟着删，是本轮记下的一条残留')
  console.log('\n（real）真 Unity 下 10 个成员两批导完：文件与 GUID 逐条核过、目录 .meta 是 Unity 生成的、冲突备份 + 逐字节还原都成立。')
}

/**
 * §8-5 在**真编辑器**上的一条：`IsBusy()` 真会翻，A 收到的是 busy 而不是 error。
 *
 * 进 Play 靠沙盒里那个 `Assets/Editor/AvcaSandboxPlayTrigger.cs`（`play.txt` 一在就进、
 * 一删就退）—— 人手点 Play 没法自动化重跑，所以给它一个文件信号。
 * 这脚本只在沙盒工程里，不属于桥接包。
 */
async function stagePlayReal() {
  const inboxDir = path.join(PROJ, 'Temp', 'AVCABridge')
  await prepare()
  markRows()
  fs.rmSync(PLAY_FLAG, { force: true })
  await sleep(2500)

  console.log('== P0. 挑 3 个成员（真编辑器一条条导，多了要等很久） ==')
  clickByText('全部素材', { exact: true })
  await sleep(1500)
  ej(`(() => {
    const cards = [...document.querySelectorAll('.card')]
    const i = cards.findIndex(c => (c.textContent || '').includes(${JSON.stringify(containerName)}))
    if (i >= 0) cards[i].dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
    return JSON.stringify({ ok: i >= 0 })
  })()`)
  await waitBody(/选包导入 Unity/, '容器内部视图')
  console.log('  ' + JSON.stringify(clickByText('选包导入 Unity')))
  await waitBody(/选要导入的包/, '成员面板')
  console.log('  清空：' + JSON.stringify(clickByText('清空')))
  await sleep(700)
  const pickedN = 3
  const ticked = ej(`(() => {
    const rows = [...document.querySelectorAll('label')].filter(l => /\\.unitypackage/i.test(l.textContent || ''))
    for (let i = 0; i < ${pickedN} && i < rows.length; i++) {
      const b = rows[i].querySelector('input[type=checkbox]')
      if (b && !b.checked) b.click()
    }
    return JSON.stringify({ rows: rows.length, checked: rows.filter(r => { const b = r.querySelector('input[type=checkbox]'); return b && b.checked }).length })
  })()`)
  console.log('  勾了 ' + ticked.checked + ' 个')
  console.log('  抽取并检查：' + JSON.stringify(clickByText('抽取并检查这')))
  await waitBody(/这批 \d+ 个包/, '计划页', 60)

  console.log('== P1. 写 play.txt → 等 Unity 真进 Play（心跳里 isPlaying 要翻） ==')
  fs.writeFileSync(PLAY_FLAG, 'until-deleted', 'utf8')
  let hb = null
  for (let i = 0; i < 60; i++) {
    try {
      hb = JSON.parse(fs.readFileSync(path.join(inboxDir, 'bridge.json'), 'utf8'))
    } catch {
      /* 还没来得及写 */
    }
    if (hb && hb.isPlaying) break
    await sleep(1000)
  }
  console.log('  心跳：isPlaying=' + (hb && hb.isPlaying) + ' · busyReason=' + (hb && hb.busyReason) + ' · bridgeVersion=' + (hb && hb.bridgeVersion))
  if (!hb || !hb.isPlaying) throw new Error('等了 60 秒真编辑器没进 Play —— 沙盒那个开关脚本没生效（编译失败？工程没开？）')

  console.log('== P2. Play 里点导 → A 该显示排队，而不是报错 ==')
  const clickAt = Date.now()
  const go = clickByText('继续并备份被覆盖文件')
  if (!go || !go.ok) console.log('  改点「继续（不备份）」：' + JSON.stringify(clickByText('继续（不备份）')))
  else console.log('  点了「继续并备份被覆盖文件」')
  const q = await waitBody(/已排队/, '界面上那句"已排队（原因）· 第 N 次重试"', 40, 1000)
  console.log('  ⭐ ' + ((/已排队[^\n]*/.exec(q) || ['（没读到）'])[0]))
  shot('r4-real-01-queued-in-play.png')
  const during = newMemberRows()
  console.log('  排队期间库里新增：' + during.length + '（该是 0）')
  if (during.length) throw new Error('Play 里就把包导进去了 —— 那 §8-5 的"排队"是假的')

  console.log('== P3. 删 play.txt → Unity 自己退出 Play → A 不用用户再点就继续 ==')
  fs.rmSync(PLAY_FLAG, { force: true })
  for (let i = 0; i < 60; i++) {
    try {
      hb = JSON.parse(fs.readFileSync(path.join(inboxDir, 'bridge.json'), 'utf8'))
    } catch {
      /* ignore */
    }
    if (hb && !hb.isPlaying) break
    await sleep(1000)
  }
  console.log('  心跳 isPlaying 回到 ' + (hb && hb.isPlaying))
  const res = await waitBody(/这批：成功 \d+ 个/, '结果卡（退出 Play 后自动跑完）', 180, 2000)
  console.log('  ⭐ ' + ((/这批：成功 \d+ 个、失败 \d+ 个、没执行 \d+ 个/.exec(res) || ['（文案没读全）'])[0]))
  shot('r4-real-02-after-play.png')
  const { since, rows: tail } = queuedLinesSince(clickAt)
  console.log(`  A 日志里本次的排队行（时间戳 ≥ ${since}…，共 ${tail.length} 条）：`)
  for (const l of tail.slice(-6)) console.log('    ' + l.replace(/^\[[^\]]+\]\s*/, '').slice(0, 150))
  /** ⭐ "第一步是 1 秒"这条同时钉在真编辑器的活体上（下标 bug 就是在这儿被看见的） */
  const delays = backoffOf(tail)
  console.log('  ⭐ 本次退避序列：' + JSON.stringify(delays))
  if (!tail.length) throw new Error('本次一条"排队中"日志都没有 —— 真 Play 里 A 大概根本没收到 busy')
  if (delays[0] !== 1000) throw new Error(`第一次退避是 ${delays[0]}ms，规格 §2.5 定死的第一档是 1000ms`)
  const rows = newMemberRows()
  console.log('  库里新增 ' + rows.length + ' 行 / 状态 ' + JSON.stringify([...new Set(rows.map((r) => r.status))]))
  if (rows.length !== pickedN) throw new Error('退 Play 之后没把 ' + pickedN + ' 个都补上：只有 ' + rows.length + ' 行')
  console.log('== P4. 收尾：整批退回（要等到终态，不许点一下就完事） ==')
  console.log('  ' + JSON.stringify(clickByText('整批退回')))
  /**
   * ⚠ 第一版这里只 `sleep(8000)` 就打印收尾，于是留下一批"看着撤了其实没撤完"的沙盒：
   *   真 Unity 的 `delete_guids` 要等资产库刷新，一批 3 个成员实测超过 8 秒，
   *   而我紧接着又关了 A —— 那 3 个成员的文件就这么留在工程里了。
   *   **收尾不验终态 = 这一条没验**（撤销本身在 `--stage=real` 的 R5 里是验过的，别把两件事混了）。
   */
  let rolled = null
  for (let i = 0; i < 60; i++) {
    await sleep(2000)
    rolled = newMemberRows().filter((r) => r.status === 'ok')
    if (!rolled.length) break
  }
  const leftFiles = projectFiles().filter((f) =>
    MANIFEST.members.flatMap((m) => m.entries.map((e) => e.unityPath.replace(/^Assets[\\/]/i, '').split('/').join(path.sep))).includes(f)
  )
  console.log('  还没撤掉的行：' + rolled.length + '（该是 0）／工程里这批的文件还剩 ' + leftFiles.length + ' 个（该只剩预置那枚）')
  if (rolled.length) throw new Error('整批退回没走到终态：还有 ' + rolled.length + ' 行是 ok')
  console.log('\n（play-real）真 Play：IsBusy() 翻、A 收到 busy 不是 error、界面看得见排队、期间不落账、退出后自动跑完。')
}

const RUN = { batch: stageBatch, stop: stageStop, play: stagePlay, real: stageReal, 'play-real': stagePlayReal }
if (!RUN[STAGE]) {
  console.error('--stage 只认 batch / stop / play / real / play-real，给了：' + STAGE)
  process.exit(2)
}
if (!fs.existsSync(DB)) {
  console.error(`沙盒库不存在：${DB}（A 起过一次了吗？）`)
  process.exit(2)
}
RUN[STAGE]()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('\nFAILED: ' + (e && e.message ? e.message : e))
    try {
      shot('r4-members-99-fail.png')
    } catch {
      /* 截图失败不该盖住真正的报错 */
    }
    process.exit(1)
  })
