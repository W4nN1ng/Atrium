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
console.log('✅ 版本号与源码一致，且 asar 不比源码旧')

function newest(d) {
  let best = 0
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name)
    if (e.isDirectory()) best = Math.max(best, newest(p))
    else if (/\.(ts|tsx|json|css)$/.test(e.name)) best = Math.max(best, fs.statSync(p).mtimeMs)
  }
  return best
}
