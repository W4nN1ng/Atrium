#!/usr/bin/env node
/**
 * R4 ④ 沙盒活体：口语同义词在**真程序**里到底生不生效 + 存在哪儿。
 *
 * 验这些事（单测看不见的那一层）：
 *  1. 搜「饰品」/ 拼音 `shipin` 能命中一张归在「配饰」下、名字里没这两个字的卡；
 *  2. 设置 → 分类 那块新面板真能加词、真能存盘；
 *  3. **存完立刻可搜**（不用重启）—— 这条是 `categories:save` 从死通道接活之后才成立的；
 *  4. 单字会被当场拒绝（不然存进去也不进索引 = 白加）；
 *  5. ⭐ 第 3 轮加的两条：**内置表一个字节都不许被写**，用户的改动必须落在
 *     `AVCA_APP_HOME` 下的 `categories.user.json`。第 2 轮打包版实测到的缺陷就是这条 ——
 *     那时它写的是安装目录里那份 `resources\lexicon\categories.json`，升级/重装会整份重写，
 *     用户加的口语词跟着没。
 *
 * 三种跑法（`--stage=`，默认 `add`）：
 *   AVCA_APP_HOME=… [AVCA_INSTALL_DIR=…dist\win-unpacked] node tools/live-r4-synonyms.cjs --stage=add
 *   … --stage=upgrade     # 把安装目录那份内置表换成仓库里 pristine 的一份（= 模拟升级重写 win-unpacked），
 *                         #   重启程序再跑这一段：**那个词还得搜得到**才是本轮的验收线
 *   … --stage=cleanup     # 把测试词删掉、确认增量文件跟着空掉，不留测试痕迹
 *
 * ⚠ 必须带 `AVCA_APP_HOME`：这一段会真的写分类改动，没有重定向就写进他真目录了（脚本直接拒绝跑）。
 * ⚠ **汉字查询在检索里按单字 OR 召回**（本轮实测到的，害我第一版写出一条假绿）：
 *   乱造的「猫猫头不存在词」和真加过的「猫猫头测试词」返回**同样两张卡**（"头"→「头饰」那条口语、
 *   "型"→「模型」那一类）。所以"搜 X 命中几张"**不能**当"这条口语在不在表里"的判据 ——
 *   判表里有没有用 `categories:list`（`--stage=upgrade` 那么做），
 *   判生不生效用 `--stage=ascii`（纯 ASCII 词整体成一个 token，加/删双向都干净）。
 * ⚠ dev 模式下存分类表会让渲染进程重载一次（Vite 盯着项目目录里的 resources/）。
 *   表现：点完保存，界面跳回收件箱、toast 不见了 —— 这是开发服务器的行为，不是产品 bug。
 *   第 3 轮之后**内置表本来就不该被写**，那次重载也就不存在了（打包版全程没有）。
 *
 * 用法：AVCA_APP_HOME=<沙盒>\\AppData\\Roaming\\A node tools/live-r4-synonyms.cjs
 */
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const crypto = require('node:crypto')
const cp = require('node:child_process')

const ROOT = path.resolve(__dirname, '..')
const PORT = process.env.AVCA_CDP_PORT || '9225'
const ENV = { ...process.env, AVCA_CDP_PORT: PORT }
const SHOT_DIR = process.env.AVCA_SHOT_DIR || 'D:\\avca-r4-move'
const TEST_WORD = '猫猫头测试词'
const NODE_KEY = 'accessory'
/** "升级到 v2" 时从内置表里**删掉**的那个老口语（仓库里只有 `accessory` 带它，查过） */
const DROP_SYN = '饰品'
/** "升级到 v2" 时**新加**进内置表的口语：它必须照样生效，证明增量没有把新表盖住 */
const UPGRADE_MARK = '升级模拟新增词'
const STAGE = (process.argv.find((a) => /^--stage=/.test(a)) || '--stage=add').split('=')[1]

/**
 * 两处落点：`P.root()` 下的增量文件 + 那份**只读**的内置表。
 * 打包版传 `AVCA_INSTALL_DIR` 指到 `win-unpacked`，dev 不传就是仓库里那份。
 */
const APP_HOME = process.env.AVCA_APP_HOME || ''
const DELTA_FILE = APP_HOME ? path.join(APP_HOME, 'categories.user.json') : ''
const BUILTIN_FILE = process.env.AVCA_INSTALL_DIR
  ? path.join(process.env.AVCA_INSTALL_DIR, 'resources', 'lexicon', 'categories.json')
  : path.join(ROOT, 'resources', 'lexicon', 'categories.json')
/** 模拟升级时要盖回去的那份 pristine 内置表（仓库里的 = 安装包里的） */
const PRISTINE_FILE = path.join(ROOT, 'resources', 'lexicon', 'categories.json')
const STATE = path.join(os.tmpdir(), 'avca-syn-live-state.json')

const sha1 = (f) => crypto.createHash('sha1').update(fs.readFileSync(f)).digest('hex').slice(0, 12)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function ev(expr) {
  return cp
    .execFileSync(process.execPath, [path.join(__dirname, 'cdp-eval.cjs'), expr], {
      cwd: ROOT,
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
  const out = path.join(SHOT_DIR, name)
  cp.execFileSync(process.execPath, [path.join(__dirname, 'cdp-shot.cjs'), out], { cwd: ROOT, env: ENV })
  console.log('  📷 ' + out)
}
async function waitCdp(tries = 60) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = ev('document.title')
      if (r) return r
    } catch {
      /* 还没起来 */
    }
    await sleep(1500)
  }
  throw new Error('CDP 连不上（端口 ' + PORT + '）')
}
function clickByText(text, opts = {}) {
  const { tag = 'button', maxLen = 40, exact = false } = opts
  return ej(`(() => {
    const want = ${JSON.stringify(text)}
    const nodes = [...document.querySelectorAll(${JSON.stringify(tag)})]
    const hit = nodes.filter(n => {
      const t = (n.textContent || '').trim()
      return ${exact ? 't === want' : `t.includes(want) && t.length < want.length + ${maxLen}`}
    })
    if (!hit[0]) return JSON.stringify({ ok: false, why: '找不到：' + want, pool: nodes.length })
    hit[0].click()
    return JSON.stringify({ ok: true, text: hit[0].textContent.trim().slice(0, 40) })
  })()`)
}

/**
 * 点设置页里那一排标签。
 *
 * ⚠ 不能按"页面上有没有'分类'这两个字的按钮"来点：侧栏也有一条 `nav.categories = 分类`，
 * 而第一版更糟 —— 按包含匹配点到了侧栏那个**容器 div**（它的 textContent 是"当前工程设置"），
 * 于是根本没导航过去，后面全白测。这里按"哪个 nav 里有 Unity 标签"认出设置页那一排。
 */
function clickSettingsTab(text) {
  return ej(`(() => {
    const navs = [...document.querySelectorAll('nav')]
    const box = navs.find(n => (n.textContent || '').includes('Unity'))
    if (!box) return JSON.stringify({ ok: false, why: '没找到设置页那排标签（现在在设置页吗？）', navs: navs.length })
    const hit = [...box.querySelectorAll('button')].find(b => (b.textContent || '').trim() === ${JSON.stringify(text)})
    if (!hit) return JSON.stringify({ ok: false, why: '标签里没有：' + ${JSON.stringify(text)} })
    hit.click()
    return JSON.stringify({ ok: true, text: hit.textContent.trim() })
  })()`)
}

/** 往搜索框里打字（React 受控 input，必须走原生 setter + input 事件，直接改 .value 不触发 onChange） */
function typeSearch(word) {
  return ej(`(() => {
    const el = [...document.querySelectorAll('input')].find(i => (i.placeholder || '').includes('搜索'))
    if (!el) return JSON.stringify({ ok: false, why: '没有搜索框' })
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value').set.call(el, ${JSON.stringify(word)})
    el.dispatchEvent(new Event('input', { bubbles: true }))
    return JSON.stringify({ ok: true, value: el.value })
  })()`)
}

const cardNames = () =>
  ej(`(() => JSON.stringify([...document.querySelectorAll('.card')].map(n => (n.textContent || '').trim().slice(0, 20))))()`)

/**
 * 直接问主进程要**合并之后**的那份分类表（`categories:list` 就是 `loadCategories()`）。
 *
 * 为什么要有这个：一条口语能不能搜到一张卡，判据不在分类表一处 —— 库里已有的**目录别名**
 * （`dirAliases`）、已学规则、素材自己的备注都会参与命中。拿"命中数变没变"去反推
 * "内置表读的是哪一份"是错的方向（第一版就是这么写出过一条假绿）。
 * 要看合并结果本身，就只能读判据那一份。
 */
function mergedSynonyms(key) {
  const r = ej(`(async () => {
    const c = await window.a.categories.list()
    const a = c.categories.find(x => x.key === ${JSON.stringify(key)})
    return JSON.stringify({ syn: (a && a.synonyms) || [], count: c.categories.length })
  })()`)
  if (!r || !Array.isArray(r.syn)) throw new Error('读不到合并出来的分类表：' + JSON.stringify(r))
  return r
}

async function stageAdd() {
  console.log('== 0. 等 A 起来 ==')
  console.log('  标题：' + (await waitCdp()))
  /** 保存之前先记下内置表的哈希：这一轮要钉的就是"它一个字节都不许变" */
  const builtinBefore = sha1(BUILTIN_FILE)
  console.log('  内置表（' + BUILTIN_FILE + '）保存前哈希：' + builtinBefore)

  console.log('== 1. 进「全部素材」，看库里有什么 ==')
  console.log('  ' + JSON.stringify(clickByText('全部素材', { exact: true })))
  await sleep(1500)
  clickByText('平铺')
  await sleep(1000)
  typeSearch('')
  await sleep(800)
  console.log('  卡：' + JSON.stringify(cardNames()))

  console.log('== 2. 搜「饰品」（这三个字不在任何卡的名字里，也不在标签里） ==')
  console.log('  ' + JSON.stringify(typeSearch('饰品')))
  await sleep(1200)
  const byZh = cardNames()
  console.log('  命中：' + JSON.stringify(byZh))
  shot('r4-syn-01-search-jinshi.png')

  console.log('== 3. 搜拼音 shipin（同一条口语的另一种写法） ==')
  console.log('  ' + JSON.stringify(typeSearch('shipin')))
  await sleep(1200)
  const byPy = cardNames()
  console.log('  命中：' + JSON.stringify(byPy))
  shot('r4-syn-02-search-shipin.png')

  console.log('== 4. 设置 → 分类：那块新面板 ==')
  typeSearch('')
  await sleep(500)
  console.log('  ' + JSON.stringify(clickByText('设置', { exact: true })))
  await sleep(1500)
  console.log('  ' + JSON.stringify(clickSettingsTab('分类')))
  await sleep(1200)
  const panel = ej(`(() => {
    const m = document.body.innerText
    return JSON.stringify({
      hasTitle: m.includes('分类口语叫法'),
      hasKanjiHint: m.includes('束縛') || m.includes('备注'),
      firstRow: (m.match(/分类口语叫法[\\s\\S]{0,200}/) || [null])[0]
    })
  })()`)
  console.log('  面板：' + JSON.stringify(panel, null, 1))
  shot('r4-syn-03-settings-panel.png')
  if (!panel.hasTitle) throw new Error('设置页没有「分类口语叫法」那块面板')

  console.log('== 5. 选「配饰」，加一个测试词，保存 ==')
  const picked = ej(`(() => {
    const box = [...document.querySelectorAll('div')].find(d => (d.textContent || '').trim().startsWith('分类口语叫法'))
    if (!box) return JSON.stringify({ ok: false, why: '找不到面板容器' })
    const sel = box.querySelector('select')
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(sel), 'value').set.call(sel, 'accessory')
    sel.dispatchEvent(new Event('change', { bubbles: true }))
    return JSON.stringify({ ok: true, value: sel.value })
  })()`)
  console.log('  选分类：' + JSON.stringify(picked))
  await sleep(1000)
  const added = ej(`(() => {
    const box = [...document.querySelectorAll('div')].find(d => (d.textContent || '').trim().startsWith('分类口语叫法'))
    const inputs = [...box.querySelectorAll('input')]
    if (!inputs.length) return JSON.stringify({ ok: false, why: '面板里没有输入框' })
    /* 第一行是「配饰」自己那行 */
    const el = inputs[0]
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value').set.call(el, ${JSON.stringify(TEST_WORD)})
    el.dispatchEvent(new Event('input', { bubbles: true }))
    return JSON.stringify({ ok: true, value: el.value, inputs: inputs.length })
  })()`)
  console.log('  填词：' + JSON.stringify(added))
  await sleep(400)
  console.log('  点添加：' + JSON.stringify(clickByText('添加')))
  await sleep(800)
  shot('r4-syn-04-added.png')
  const dirty = ev(`(() => /有改动没保存/.test(document.body.innerText) ? 'yes' : 'no')()`)
  console.log('  显示"有改动没保存"了吗：' + dirty)
  console.log('  点保存：' + JSON.stringify(clickByText('保存')))
  await sleep(2500)
  const savedToast = ev(`(() => /已保存，检索索引已经跟着重建/.test(document.body.innerText) ? 'yes' : 'no')()`)
  console.log('  存完的 toast：' + savedToast)
  shot('r4-syn-05-saved.png')

  console.log('== 5b. ⭐ 落点（第 3 轮那两条：内置表只读、改动在运行时目录） ==')
  const builtinAfter = sha1(BUILTIN_FILE)
  console.log('  内置表保存前 ' + builtinBefore + ' → 保存后 ' + builtinAfter)
  if (builtinAfter !== builtinBefore) {
    throw new Error('内置表被写了 —— 第 2 轮那条缺陷（存安装目录、升级即丢）还没修好')
  }
  if (!fs.existsSync(DELTA_FILE)) throw new Error(`没写出增量文件：${DELTA_FILE}`)
  const delta = JSON.parse(fs.readFileSync(DELTA_FILE, 'utf8'))
  const node = (delta.synonyms || {})[NODE_KEY] || {}
  console.log('  增量文件：' + DELTA_FILE)
  console.log('  schema=' + delta.schema + '，' + NODE_KEY + ' = ' + JSON.stringify(node))
  if (!(node.add || []).includes(TEST_WORD)) throw new Error('增量里没有那个词（存到别处去了）')
  if ((node.remove || []).length) console.log('  ⚠ remove 不应该是空的？' + JSON.stringify(node.remove))
  fs.writeFileSync(
    STATE,
    JSON.stringify(
      {
        builtinSha: builtinBefore,
        word: TEST_WORD,
        node: NODE_KEY,
        /** 「饰品」在**旧**内置表里是「配饰」的口语，升级那一版会把它删掉 —— 记下命中数好比较 */
        dropSyn: '饰品',
        dropSynBefore: Array.isArray(byZh) ? byZh.length : -1,
        at: new Date().toISOString()
      },
      null,
      2
    )
  )
  console.log('  状态记在 ' + STATE)

  console.log('== 6. 回库里搜那个刚加的词（不重启就该搜得到） ==')
  console.log('  ' + JSON.stringify(clickByText('全部素材', { exact: true })))
  await sleep(1500)
  console.log('  ' + JSON.stringify(typeSearch(TEST_WORD)))
  await sleep(1500)
  const fresh = cardNames()
  console.log('  命中：' + JSON.stringify(fresh))
  shot('r4-syn-06-new-word.png')

  console.log('\n（add）结果汇总：')
  console.log('  搜「饰品」命中 ' + (Array.isArray(byZh) ? byZh.length : '?') + ' 张：' + JSON.stringify(byZh))
  console.log('  搜 shipin 命中 ' + (Array.isArray(byPy) ? byPy.length : '?') + ' 张：' + JSON.stringify(byPy))
  console.log('  新词命中：' + JSON.stringify(fresh))
  console.log('  截图在 ' + SHOT_DIR)
  console.log('  ⚠ 词留着没删 —— 跑完 --stage=upgrade 再跑 --stage=cleanup 收尾')
}

/**
 * 造一次"升级到 v2"：把安装目录里那份内置表换成**改过的内容** ——
 * 删掉「配饰」原有的口语「饰品」、加进「升级模拟新增词」。
 * `electron-builder` 每次发布重写整个 `win-unpacked` 干的就是这件事（换成新版本的内容）。
 *
 * ⚠ 这一步不需要 A 在跑（先杀掉再起都行），但它必须**在 --stage=add 之后**跑，
 *   而且跑完要**重启**打包版再跑 --stage=upgrade —— 不重启的话主进程还在用内存里那份旧表，测了不算。
 */
async function stageMakeV2() {
  const cfg = JSON.parse(fs.readFileSync(PRISTINE_FILE, 'utf8'))
  const node = cfg.categories.find((c) => c.key === NODE_KEY)
  if (!node) throw new Error('内置表里没有 ' + NODE_KEY)
  if (!(node.synonyms || []).includes(DROP_SYN)) throw new Error(`内置表里 ${NODE_KEY} 没有「${DROP_SYN}」，删不动`)
  node.synonyms = node.synonyms.filter((s) => s !== DROP_SYN).concat([UPGRADE_MARK])
  fs.mkdirSync(path.dirname(BUILTIN_FILE), { recursive: true })
  fs.writeFileSync(BUILTIN_FILE, JSON.stringify(cfg, null, 2) + '\n', 'utf8')
  console.log('  把 ' + BUILTIN_FILE)
  console.log('  换成"v2"：删掉口语「' + DROP_SYN + '」、加上「' + UPGRADE_MARK + '」')
  console.log('  新哈希 ' + sha1(BUILTIN_FILE) + '（仓库 pristine ' + sha1(PRISTINE_FILE) + '）')
  console.log('  下一步：重启打包版 → 跑 --stage=upgrade')
}

/**
 * **升级之后**这一段（第 3 轮的验收线）：用户的改动还在、新内置表也生效、被删的口语确实没了。
 */
async function stageUpgrade() {
  console.log('== U0. 等 A 起来 ==')
  console.log('  标题：' + (await waitCdp()))
  const state = fs.existsSync(STATE) ? JSON.parse(fs.readFileSync(STATE, 'utf8')) : null
  if (!state) throw new Error(`没有 ${STATE} —— 先跑 --stage=add`)
  if (state.word !== TEST_WORD) throw new Error('状态里的测试词和现在不是同一个：' + state.word)

  const now = sha1(BUILTIN_FILE)
  console.log('  内置表：add 之前 ' + state.builtinSha + ' → 现在 ' + now)
  if (now === state.builtinSha) {
    throw new Error('内置表内容没变 —— "升级"没造出来（先跑 --stage=make-v2 并重启程序），这一段测了不算')
  }
  console.log('  ✅ 内置表确实被换成了另一份内容（= 升级重写了 win-unpacked 里那份）')

  console.log('== U1. ⭐ 用户自己加的词升级之后还搜得到吗 ==')
  console.log('  ' + JSON.stringify(clickByText('全部素材', { exact: true })))
  await sleep(1500)
  console.log('  ' + JSON.stringify(typeSearch(TEST_WORD)))
  await sleep(1600)
  const hits = cardNames()
  console.log('  命中：' + JSON.stringify(hits))
  shot('r4-syn-07-after-upgrade.png')
  if (!Array.isArray(hits) || !hits.length) {
    throw new Error('升级之后那个词搜不到了 —— 增量没叠在内置表上，用户的改动照样丢')
  }
  console.log('  ✅ 用户的加减存在运行时目录的增量里，升级不丢')

  console.log('== U2. 内置表读的是新那份：删掉的口语必须从**合并结果**里消失 ==')
  console.log('  ' + JSON.stringify(typeSearch(DROP_SYN)))
  await sleep(1600)
  const dropped = cardNames()
  console.log('  ⚠ 「' + DROP_SYN + '」命中 ' + JSON.stringify(dropped) + ' —— 命中数**不能**当判据：')
  console.log('    一条口语进检索有好几个来源（内置表、用户增量、库里已有的目录别名、已学规则），')
  console.log('    删掉内置表那一份之后照样有命中是正常现象。第一版拿命中数减少当断言，' +
    (Array.isArray(state.dropSynBefore) ? '' : '而 dropSynBefore 是 undefined，比较式恒假 → **假绿**；') +
    '判据改成下面直接读合并出来的那张表。')
  shot('r4-syn-08-dropped-synonym.png')

  const merged = mergedSynonyms(NODE_KEY)
  console.log('  主进程合并出来的 ' + NODE_KEY + '.synonyms：' + JSON.stringify(merged.syn))
  if (merged.syn.includes(DROP_SYN)) {
    throw new Error('新版内置表删掉的口语还在合并结果里 —— 读的根本不是新表（或增量把整份旧表带回来了）')
  }
  if (!merged.syn.includes(UPGRADE_MARK)) {
    throw new Error('新版内置表加的口语没进合并结果 —— 存成整份拷贝就会这样：用户的旧副本盖在新表上')
  }
  if (!merged.syn.includes(TEST_WORD)) throw new Error('用户加的词没进合并结果 —— 增量没叠上去')
  console.log('  ✅ 三件事同时成立：旧表被换掉、新表生效、用户的加减还在')

  console.log('== U3. 新版内置表新加的口语也要生效（增量不许把新表盖住） ==')
  console.log('  ' + JSON.stringify(typeSearch(UPGRADE_MARK)))
  await sleep(1600)
  const added = cardNames()
  console.log('  命中：' + JSON.stringify(added))
  if (!Array.isArray(added) || !added.length) {
    throw new Error('新版本内置表加的口语搜不到 —— 存整份拷贝就会这样（用户的旧副本盖在新表上）')
  }
  console.log('  ✅ 升级新增的内容照样生效')

  console.log('== U4. 增量文件里只有那一条用户改动（没有整份表） ==')
  const deltaRaw = fs.existsSync(DELTA_FILE) ? fs.readFileSync(DELTA_FILE, 'utf8') : ''
  console.log('  ' + DELTA_FILE + '：' + deltaRaw.replace(/\s+/g, ' ').slice(0, 200))
  console.log('  字节数 ' + deltaRaw.length + '（内置表那份是 ' + fs.statSync(BUILTIN_FILE).size + ' 字节）')
}

/** 收尾：删掉测试词、确认增量文件跟着空掉，不留测试痕迹（单字那条也在这里验） */
async function stageCleanup() {
  console.log('== 0. 等 A 起来 ==')
  console.log('  标题：' + (await waitCdp()))
  const builtinBefore = sha1(BUILTIN_FILE)

  console.log('== 7. 单字该被当场拒绝 ==')
  console.log('  ' + JSON.stringify(clickByText('设置', { exact: true })))
  await sleep(1200)
  console.log('  ' + JSON.stringify(clickSettingsTab('分类')))
  await sleep(1200)
  ej(`(() => {
    const box = [...document.querySelectorAll('div')].find(d => (d.textContent || '').trim().startsWith('分类口语叫法'))
    const el = box.querySelectorAll('input')[0]
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value').set.call(el, '猫')
    el.dispatchEvent(new Event('input', { bubbles: true }))
    return 'ok'
  })()`)
  await sleep(400)
  console.log('  点添加：' + JSON.stringify(clickByText('添加')))
  await sleep(900)
  const rejected = ev(`(() => { const m = document.body.innerText; return (m.match(/[^\\n]*个字[^\\n]*/) || ['（没看到拒绝文案）'])[0] })()`)
  console.log('  拒绝文案：' + rejected)
  shot('r4-syn-09-single-char-rejected.png')

  console.log('== 8. 把测试词删掉再存一次 ==')
  const removed = ej(`(() => {
    const box = [...document.querySelectorAll('div')].find(d => (d.textContent || '').trim().startsWith('分类口语叫法'))
    if (!box) return JSON.stringify({ ok: false, why: '找不到面板' })
    /** 重新进设置页时选中的分类会回到第一个（模型），不先挑回「配饰」是看不到那个 chip 的 */
    const sel = box.querySelector('select')
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(sel), 'value').set.call(sel, ${JSON.stringify(NODE_KEY)})
    sel.dispatchEvent(new Event('change', { bubbles: true }))
    return JSON.stringify({ ok: true, value: sel.value })
  })()`)
  console.log('  挑回配饰：' + JSON.stringify(removed))
  await sleep(700)
  const chipGone = ej(`(() => {
    const box = [...document.querySelectorAll('div')].find(d => (d.textContent || '').trim().startsWith('分类口语叫法'))
    /** chip 是 span.chip（里面套着 × 按钮），按按钮找是找不到的 —— 第一版就栽在这儿 */
    const chip = [...box.querySelectorAll('span.chip, .chip')].find(s => (s.textContent || '').includes(${JSON.stringify(TEST_WORD)}))
    if (!chip) return JSON.stringify({ ok: false, why: '没有那个词的 chip（可能上一轮已经删掉了）' })
    const x = chip.querySelector('button')
    if (!x) return JSON.stringify({ ok: false, why: 'chip 里没有删除按钮' })
    x.click()
    return JSON.stringify({ ok: true })
  })()`)
  console.log('  删 chip：' + JSON.stringify(chipGone))
  await sleep(800)
  console.log('  点保存：' + JSON.stringify(clickByText('保存')))
  await sleep(2500)

  const builtinAfter = sha1(BUILTIN_FILE)
  console.log('  内置表 ' + builtinBefore + ' → ' + builtinAfter + '（该一模一样）')
  if (builtinAfter !== builtinBefore) throw new Error('收尾这一步又把内置表写了')
  const stillOnDisk = fs.existsSync(DELTA_FILE) && JSON.stringify(fs.readFileSync(DELTA_FILE, 'utf8')).includes(TEST_WORD)
  console.log('  增量文件里还留着测试词吗：' + stillOnDisk + '（该是 false）')
  if (stillOnDisk) throw new Error('测试痕迹没清干净：' + DELTA_FILE)
  console.log('  删干净之后那个词还能搜到吗（⚠ 这条只当观察，不当判据 —— 见文件头那条 CJK 单字召回）：')
  console.log('  ' + JSON.stringify(clickByText('全部素材', { exact: true })))
  await sleep(1500)
  console.log('  ' + JSON.stringify(typeSearch(TEST_WORD)))
  await sleep(1500)
  console.log('  命中：' + JSON.stringify(cardNames()))
  typeSearch('')
  shot('r4-syn-10-cleaned.png')
  fs.rmSync(STATE, { force: true })
  console.log('\n（cleanup）跑完 `git status` 里 resources/lexicon 必须是干净的。')
  console.log('  要判"删词有没有立刻生效"，跑 --stage=ascii（纯 ASCII 词，没有单字召回的噪音）。')
}

/**
 * 用**纯 ASCII** 的口语词做一次"加了就搜得到 / 删了就搜不到"的双向验证。
 *
 * 为什么汉字词测不出这件事：`实测（2026-10-07，本轮）` —— 汉字查询在检索里按**单字** OR 召回，
 * 所以「猫猫头不存在词」这种乱造的词照样返回两张卡（'头' 命中「头饰」那条口语、'型' 命中「模型」那类）。
 * 拿汉字词的命中数当"口语生效没有"的判据 = 必然看错。ASCII 词没有这个问题：
 * 它整体成一个 token，命中与不命中才真的对应"这条口语在不在表里"。
 */
async function stageAscii() {
  const W = 'avkxqword'
  console.log('== 0. 等 A 起来 ==')
  console.log('  标题：' + (await waitCdp()))
  const searchHit = async (w) => {
    clickByText('全部素材', { exact: true })
    await sleep(1400)
    typeSearch(w)
    await sleep(1500)
    const r = ej(`(async () => {
      const r = await window.a.assets.list({ search: ${JSON.stringify(w)}, limit: 30 })
      return JSON.stringify({ total: r.total, cards: (r.cards || []).map(x => x.name + '/' + x.category) })
    })()`)
    typeSearch('')
    return r
  }

  console.log('== A1. 删之前先确认这个 ASCII 词搜不到（基线） ==')
  const base = await searchHit(W)
  console.log('  ' + JSON.stringify(base))
  if (base.total !== 0) throw new Error('基线就不干净：还没加词就已经有命中（' + JSON.stringify(base) + '）')

  console.log('== A2. 设置 → 分类：加「' + W + '」到配饰，保存 ==')
  console.log('  ' + JSON.stringify(clickByText('设置', { exact: true })))
  await sleep(1400)
  console.log('  ' + JSON.stringify(clickSettingsTab('分类')))
  await sleep(1200)
  ej(`(() => {
    const box = [...document.querySelectorAll('div')].find(d => (d.textContent || '').trim().startsWith('分类口语叫法'))
    const sel = box.querySelector('select')
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(sel), 'value').set.call(sel, ${JSON.stringify(NODE_KEY)})
    sel.dispatchEvent(new Event('change', { bubbles: true }))
    return 'ok'
  })()`)
  await sleep(800)
  ej(`(() => {
    const box = [...document.querySelectorAll('div')].find(d => (d.textContent || '').trim().startsWith('分类口语叫法'))
    const el = box.querySelectorAll('input')[0]
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value').set.call(el, ${JSON.stringify(W)})
    el.dispatchEvent(new Event('input', { bubbles: true }))
    return 'ok'
  })()`)
  await sleep(400)
  console.log('  点添加：' + JSON.stringify(clickByText('添加')))
  await sleep(700)
  console.log('  点保存：' + JSON.stringify(clickByText('保存')))
  await sleep(2500)

  console.log('== A3. 不重启就该搜到（这是"加词生效"的判据） ==')
  const afterAdd = await searchHit(W)
  console.log('  ' + JSON.stringify(afterAdd))
  if (!afterAdd.total) throw new Error('加了口语却搜不到 —— categories:save 之后索引没重建')

  console.log('== A4. 删掉那个词、保存，再搜（这是"删词生效"的判据） ==')
  console.log('  ' + JSON.stringify(clickByText('设置', { exact: true })))
  await sleep(1400)
  console.log('  ' + JSON.stringify(clickSettingsTab('分类')))
  await sleep(1200)
  const del = ej(`(() => {
    const box = [...document.querySelectorAll('div')].find(d => (d.textContent || '').trim().startsWith('分类口语叫法'))
    const sel = box.querySelector('select')
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(sel), 'value').set.call(sel, ${JSON.stringify(NODE_KEY)})
    sel.dispatchEvent(new Event('change', { bubbles: true }))
    setTimeout(() => {
      const b2 = [...document.querySelectorAll('div')].find(d => (d.textContent || '').trim().startsWith('分类口语叫法'))
      const chip = [...b2.querySelectorAll('span.chip, .chip')].find(s => (s.textContent || '').includes(${JSON.stringify(W)}))
      if (chip) chip.querySelector('button').click()
    }, 300)
    return JSON.stringify({ ok: true })
  })()`)
  console.log('  删 chip：' + JSON.stringify(del))
  await sleep(1200)
  console.log('  点保存：' + JSON.stringify(clickByText('保存')))
  await sleep(2500)
  const afterDel = await searchHit(W)
  console.log('  ' + JSON.stringify(afterDel))
  const merged = mergedSynonyms(NODE_KEY)
  console.log('  合并表里还有它吗：' + merged.syn.includes(W) + '（该是 false）')
  shot('r4-syn-11-ascii.png')
  if (afterDel.total !== 0) {
    throw new Error(
      '⚠ 真缺陷：删掉口语之后合并表已经没有它了（' +
        JSON.stringify(merged.syn) +
        '），但检索还命中 ' +
        afterDel.total +
        ' 张 —— 删词那条路没重建索引'
    )
  }
  console.log('  ✅ 加词与删词都不必重启就生效')
}

const STAGES = { add: stageAdd, 'make-v2': stageMakeV2, upgrade: stageUpgrade, ascii: stageAscii, cleanup: stageCleanup }
if (STAGE !== 'all' && !STAGES[STAGE]) {
  console.error('--stage 只认 add / upgrade / cleanup / all，给了：' + STAGE)
  process.exit(2)
}
/** 这一轮会真的写分类改动：没有 AVCA_APP_HOME 重定向就一律拒绝跑（不许写他真目录） */
if (!APP_HOME || !/(avca|sandbox)/i.test(APP_HOME)) {
  console.error('必须带 AVCA_APP_HOME 指向沙盒目录（路径里要有 avca / sandbox —— 这一轮会写 categories.user.json）')
  process.exit(2)
}

;(async () => {
  if (STAGE === 'all') {
    await stageAdd()
    await stageCleanup()
  } else {
    await STAGES[STAGE]()
  }
})().catch((e) => {
  console.error('\nFAILED: ' + (e && e.message ? e.message : e))
  process.exit(1)
})
