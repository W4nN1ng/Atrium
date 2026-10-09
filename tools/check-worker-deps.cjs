/**
 * 构建期检查：worker 的 bundle 里不许有裸 require。
 *
 * 起因（M2 末）：worker_threads 读不了 asar，worker.js 被解到 app.asar.unpacked，
 * 它的 require('hash-wasm') 就再也回不到 asar 里的 node_modules → 打包版一摄取就崩，
 * 而 dev 全绿（都在磁盘上）。M3 又给 worker 加了 tar（unitypackage 解析），同一个坑。
 *
 * 所以 electron-vite 一构建完就跑这个：扫 out/main/worker.js 和它同目录的 chunk，
 * 出现任何非 node 内置模块的 require 就 fail build。
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

if (!fs.existsSync(OUT)) {
  console.error('没有 out/main，先跑 electron-vite build')
  process.exit(1)
}

const files = fs.readdirSync(OUT).filter((f) => f.endsWith('.js'))
let bad = 0
for (const f of files) {
  // index.js 在 asar 里，require 能正常解析；只有 worker.js 及其共享 chunk 受限
  if (f === 'index.js') continue
  const hits = bareRequires(path.join(OUT, f))
  // better-sqlite3 是故意的：原生 .node 不能内联，靠 asarUnpack 解决
  const real = hits.filter((h) => h !== 'better-sqlite3' && h !== 'electron')
  if (real.length) {
    bad++
    console.error(`✗ ${f} 还有裸 require：${real.join(', ')}`)
    console.error('  → 加进 electron.vite.config.ts 的 externalizeDepsPlugin({ exclude: [...] })')
    console.error('    （worker_threads 读不了 asar，这些包必须内联进 bundle）')
  } else {
    console.log(`✓ ${f} 自包含（${hits.length ? '仅原生/electron' : '无外部依赖'}）`)
  }
}
process.exit(bad ? 1 : 0)
