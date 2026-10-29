/**
 * 构建期检查：worker 的 bundle 里不许有裸 require。
 *
 * 起因（M2 末）：worker_threads 读不了 asar，worker.js 被解到 app.asar.unpacked，
 * 它的 require('hash-wasm') 就再也回不到 asar 里的 node_modules → 打包版一摄取就崩，
 * 而 dev 全绿（都在磁盘上）。M3 又给 worker 加了 tar（unitypackage 解析），同一个坑。
 *
 * 所以 electron-vite 一构建完就跑这个：从 out/main/worker.js 出发，只扫描它
 * 实际 require 的本地 chunk 闭包。主进程专用的动态 chunk（例如 VPM 运行时）不在
 * worker 图里，主进程仍能通过 Electron 的 asar require 解析 node_modules；
 * 把它们一起扫会误报，也会逼着把所有主进程依赖都内联。
 */
const fs = require('node:fs')
const path = require('node:path')
const Module = require('module')

const OUT = path.resolve(__dirname, '..', 'out', 'main')
const BUILTIN = new Set(Module.builtinModules)

function bareRequires(file) {
  const src = fs.readFileSync(file, 'utf8')
  const hits = new Set()
  for (const m of src.matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)) {
    const spec = m[1]
    if (spec.startsWith('.') || spec.startsWith('/')) continue
    const root = spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0]
    if (BUILTIN.has(root) || BUILTIN.has('node:' + root)) continue
    if (spec.startsWith('node:')) continue
    hits.add(spec)
  }
  return Array.from(hits)
}

/** 只跟随相对 require，得到 worker 真正会加载的 chunk 闭包。 */
function workerGraph(entry) {
  const visited = new Set()
  const queue = [entry]
  while (queue.length) {
    const file = path.resolve(queue.pop())
    if (visited.has(file)) continue
    if (!file.startsWith(OUT + path.sep) || !file.endsWith('.js')) continue
    if (!fs.existsSync(file)) continue
    visited.add(file)
    const src = fs.readFileSync(file, 'utf8')
    for (const m of src.matchAll(/require\(\s*['"](\.[^'"]+)['"]\s*\)/g)) {
      const target = path.resolve(path.dirname(file), m[1])
      if (fs.existsSync(target)) queue.push(target)
    }
  }
  return Array.from(visited).sort()
}

if (!fs.existsSync(OUT)) {
  console.error('没有 out/main，先跑 electron-vite build')
  process.exit(1)
}

const entries = ['worker.js', 'intake.js'].map((name) => path.join(OUT, name))
if (entries.some((entry) => !fs.existsSync(entry))) {
  console.error('缺少 out/main/worker.js 或 intake.js，先跑 electron-vite build')
  process.exit(1)
}

const files = [...new Set(entries.flatMap(workerGraph))].sort()
let bad = 0
for (const file of files) {
  const name = path.relative(OUT, file)
  const hits = bareRequires(file)
  // better-sqlite3 是故意的：原生 .node 不能内联，靠 asarUnpack 解决。
  // electron/electron-log 只会在主进程 chunk 出现；worker 图里出现就是错误。
  const real = hits.filter((h) => h !== 'better-sqlite3' && h !== 'electron')
  if (real.length) {
    bad++
    console.error(`✗ ${name} 还有裸 require：${real.join(', ')}`)
    console.error('  → 加进 electron.vite.config.ts 的 externalizeDepsPlugin({ exclude: [...] })')
    console.error('    （worker_threads 读不了 asar，这些包必须内联进 bundle）')
  } else {
    console.log(`✓ ${name} 自包含（${hits.length ? '仅原生/electron' : '无外部依赖'}）`)
  }
}
if (!bad) {
  console.log(`✓ worker/intake 依赖图共 ${files.length} 个文件，全部自包含`)
}
process.exit(bad ? 1 : 0)
