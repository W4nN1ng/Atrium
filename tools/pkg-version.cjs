#!/usr/bin/env node
/**
 * 读**打包产物**里的版本号 —— 不启动进程。
 *
 * ## 为什么要专门这么一个小工具
 *
 * 2026-10-09 17:24 我想知道 `dist\win-unpacked\Atrium.exe` 打出来的是 0.1.0 还是 0.2.0，
 * 顺手敲了 `Atrium.exe --version`。**打包版 Electron 不认这个参数**（`--version` 只有
 * 默认 app 与显式处理它的 app 才有），于是它按普通启动跑起来了 ——
 * 带着用户的真实数据目录：日志第一行 `数据库就绪 C:\Users\…\A\library.db`，
 * 随后 `工程发现：登记 9 个`，`project` 表九行的 `last_seen` 被刷成当时那一刻。
 * 这是**当天第二次**因为"直接起 exe 而没重定向"碰到他的真库（第一次记在 `docs/M7-DESIGN.md` §10）。
 *
 * 所以：想知道版本就调这个；`tools/dev.cjs` 那道闸管不到直接起 exe 的情况，
 * 应用自己也加了一道（`AVCA_REQUIRE_SANDBOX_HOME=1` → 运行时目录不像沙盒就拒绝启动）。
 *
 * ⚠ 也别用 `npx asar extract-file <包> package.json` 去读包里的 package.json ——
 * 2026-10-09 19:17 我这么干过一次：这个子命令**把文件解到当前目录**，在仓库根跑就直接
 * 覆盖了仓库自己的 `package.json`（靠 git 还原的）。这个工具改成**只读进内存**，不落任何文件。
 *
 * 2026-10-09 顺手加了两条，都是那次"产物比源码旧"踩出来的：
 *  - asar 里的 `license` 必须和仓库 package.json 一致（发 MIT 的包，里面还写着 UNLICENSED 就笑了）
 *  - 不该有的生产依赖不许被打进包（`sharp` 挂在 dependencies 里半年没人用，包就白背了几十 MB 的 libvips）
 *
 *   node tools/pkg-version.cjs                 # 默认 dist\win-unpacked
 *   node tools/pkg-version.cjs dist\win-unpacked
 */
const fs = require('node:fs')
const path = require('node:path')

const dir = path.resolve(process.argv[2] || path.join('dist', 'win-unpacked'))
const asar = path.join(dir, 'resources', 'app.asar')
if (!fs.existsSync(asar)) {
  console.error(`读不到 ${asar}（先 npm run build）`)
  process.exit(1)
}
const b = fs.readFileSync(asar)
/** package.json 在 asar 里是原样存的，所以 `"version": "x.y.z"` 能直接搜到（冒号两边可能有空格） */
const head = b.subarray(0, Math.min(b.length, 2_000_000)).toString('utf8')
const m = /"name":\s*"([^"]+)"[\s\S]{0,400}?"version":\s*"([^"]+)"/.exec(head)
if (!m) {
  console.error('asar 里没找到 name/version —— 这个产物不对劲，别发')
  process.exit(1)
}
const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'))
const built = new Date(fs.statSync(asar).mtimeMs).toISOString()
console.log(`产物 ${dir}`)
console.log(`  asar 里的应用：${m[1]}  版本 ${m[2]}  （asar 构建于 ${built}）`)
console.log(`  仓库 package.json：${pkg.name}  版本 ${pkg.version}`)
if (m[2] !== pkg.version) {
  console.error(` 版本不一致：产物是 ${m[2]}，源码是 ${pkg.version} —— 这是旧包，别拿它测、也别发`)
  process.exit(1)
}
const srcNewest = newest(path.join(__dirname, '..', 'src'))
if (fs.statSync(asar).mtimeMs < srcNewest) {
  console.error('⛔ asar 比 src/ 里最新的源码旧 —— 这个产物不含本轮改动，先 npm run build')
  process.exit(1)
}

/** 包里 package.json 的 license：从匹配到的 version 位置往后找第一个 license 字段 */
const lm = /"license":\s*"([^"]+)"/.exec(head.slice(m.index))
const inPkg = lm ? lm[1] : '(读不到)'
console.log(`  asar 里的 license：${inPkg}  ／  仓库里：${pkg.license}`)
if (lm && lm[1] !== pkg.license) {
  console.error(`⛔ 许可元数据不一致：发出去的包写着 ${lm[1]}，仓库和 README 写着 ${pkg.license}`)
  process.exit(1)
}

/**
 * 包里到底打了哪些 node_modules 顶层包 —— **必须解析 asar 头部**，不能用字符串找。
 *
 * 2026-10-09 我先写的是 `head.includes('node_modules\\sharp')`，拿合成假包一测**根本不红**：
 * asar 头部是嵌套 JSON（`{"files":{"node_modules":{"files":{"sharp":…}}}}`），
 * 全文件里根本没有 `node_modules\sharp` 这样一个连续子串（`asar list` 打出来的路径是它自己拼的）。
 * 那条断言当时是空的，写下来就为了记着：**"跑出来是绿的"不等于"它会红"**。
 *
 * 头部布局（实测 1041 字节的合成包对上了）：
 *   [0..3]=4  [4..7]=块长  [8..11]=次级长  [12..15]=JSON 字符串长度  [16..]=JSON
 */
function asarHeader(buf) {
  const len = buf.readUInt32LE(12)
  const json = buf.subarray(16, 16 + len).toString('utf8')
  if (!json.startsWith('{')) return null
  try {
    return JSON.parse(json)
  } catch {
    return null
  }
}

/** 收集 node_modules 下的顶层包名（@scope 那种目录摊平成 @scope/包名） */
function bundledPackages(header) {
  const nm = header && header.files && header.files.node_modules
  if (!nm || !nm.files) return []
  const out = new Set()
  for (const [k, v] of Object.entries(nm.files)) {
    if (!k.startsWith('@')) {
      out.add(k)
      continue
    }
    for (const sub of Object.keys((v && v.files) || {})) out.add(k + '/' + sub)
    if (!Object.keys((v && v.files) || {}).length) out.add(k)
  }
  return [...out].sort()
}

const header = asarHeader(b)
if (!header) {
  console.error('⛔ 解析不了 asar 头部 —— 这个产物不对劲，别发')
  process.exit(1)
}
/**
 * 允许在包里的名单 = dependencies 的**传递闭包**（从 package-lock 的依赖边走）。
 * 直接拿 dependencies 比是错的：asar 里本来就有 78 个 transitive 包，
 * 2026-10-09 我第一版就这么误报了一屏"多出来的东西"。
 */
const allowed = closure(pkg)
const bundled = bundledPackages(header)
const extra = bundled.filter((n) => !allowed.has(n))
console.log(`  asar 里 node_modules 顶层包：${bundled.length} 个（dependencies 闭包 ${allowed.size} 个）`)
if (extra.length) {
  console.error('⛔ 包里有 dependencies 闭包之外的东西：' + extra.join('、'))
  console.error('   要么是把没用的依赖删掉重打包，要么这个包真该在生产依赖里（补进 dependencies 再重打包）')
  process.exit(1)
}
console.log('✅ 版本号、许可元数据与依赖清单都和源码一致，且 asar 不比源码旧')

/** dependencies 的传递闭包；lock 里嵌套安装的包也要能走进去 */
function closure(p) {
  const lockFile = path.join(__dirname, '..', 'package-lock.json')
  if (!fs.existsSync(lockFile)) {
    console.error('⛔ 读不到 package-lock.json，没法算依赖闭包 —— 别在这个状态下发包')
    process.exit(1)
  }
  const nodes = JSON.parse(fs.readFileSync(lockFile, 'utf8')).packages || {}
  /** 依赖名先按"就近嵌套"找，再退回顶层 —— 只找顶层会漏（fast-uri 就是这么误报的） */
  const resolve = (fromKey, name) => {
    const nested = (fromKey === '' ? '' : fromKey) + '/node_modules/' + name
    if (nodes[nested]) return nested
    const top = 'node_modules/' + name
    if (nodes[top]) return top
    return null
  }
  const out = new Set()
  const seen = new Set()
  const q = []
  for (const d of Object.keys(p.dependencies || {})) {
    const k = resolve('', d)
    out.add(d)
    if (k && !seen.has(k)) q.push(k)
  }
  while (q.length) {
    const key = q.pop()
    if (seen.has(key)) continue
    seen.add(key)
    const entry = nodes[key] || {}
    const name = key.slice(key.lastIndexOf('node_modules/') + 13)
    out.add(name)
    for (const d of Object.keys(entry.dependencies || {})) {
      const k = resolve(key, d)
      if (k && !seen.has(k)) q.push(k)
    }
  }
  return out
}




function newest(d) {
  let best = 0
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name)
    if (e.isDirectory()) best = Math.max(best, newest(p))
    else if (/\.(ts|tsx|json|css)$/.test(e.name)) best = Math.max(best, fs.statSync(p).mtimeMs)
  }
  return best
}
