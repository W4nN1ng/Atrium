#!/usr/bin/env node
/**
 * 在**打包产物**里查一段代码 / 一句话到底在不在 —— 只读进内存，不落任何文件。
 *
 * ## 为什么要这么个工具（不这么查会怎样）
 *
 * 2026-10-10 15:05 我拿 `fs.readFileSync(app.asar).includes('toast.undoStale')` 想确认
 * ⑥ 那道"只撤这一批"的闸被打进了包，结果是"不在"，而 `onlyBatchId` "在" ——
 * 整包按字节搜**根本判断不了某个字符串属于哪个文件**：asar 是"头部 JSON + 内容首尾相接"，
 * 同一段中文既可能来自 `out/main/index.js`，也可能来自被打进渲染层的 i18n JSON，
 * 而 esbuild 会把非 ASCII 转义成 `\uXXXX`，所以"搜不到中文"既可能是没打进去、也可能只是编码不同。
 *
 * ⇒ 只能**解析头部**，按 offset/size 把单个文件读出来，再对它自己搜。这个工具就是干这个的。
 *
 * ⚠ 别用 `npx asar extract-file`：那个子命令**把文件解到当前目录**，
 *   在仓库根跑过一次，直接把仓库自己的 `package.json` 覆盖了（`tools/pkg-version.cjs` 头注记着）。
 *
 *   node tools/asar-grep.cjs toast.undoStale
 *   node tools/asar-grep.cjs --file out/main/index.js '只撤这一批'
 *   node tools/asar-grep.cjs --dir dist-r9b remerge.autoDone
 *   node tools/asar-grep.cjs --list            # 只看包了哪些文件
 */
const fs = require('node:fs')
const path = require('node:path')

const argv = process.argv.slice(2)
let target = path.join('dist', 'win-unpacked')
let onlyFile = null
let listOnly = false
const needles = []
for (let i = 0; i < argv.length; i++) {
  const a = argv[i]
  if (a === '--dir') target = argv[++i]
  else if (a === '--file') onlyFile = argv[++i]
  else if (a === '--list') listOnly = true
  else needles.push(a)
}
const asarPath = path.resolve(target, 'resources', 'app.asar')
if (!fs.existsSync(asarPath)) {
  console.error('⛔ 读不到 ' + asarPath + '（先 npx electron-builder --win --dir）')
  process.exit(1)
}
if (!listOnly && !needles.length) {
  console.error('用法：node tools/asar-grep.cjs [--dir 产物目录] [--file 包内路径] <要找的串>…')
  process.exit(2)
}

const buf = fs.readFileSync(asarPath)
/**
 * asar 头部布局（和 `tools/pkg-version.cjs` 那份一致，实测对得上）：
 *   [0..3]=4 [4..7]=块长 [8..11]=次级长 [12..15]=JSON 字符串长度 [16..]=JSON
 * 数据区紧跟在头部块后面，偏移量都是相对数据区起点的。
 */
const jsonLen = buf.readUInt32LE(12)
const header = JSON.parse(buf.subarray(16, 16 + jsonLen).toString('utf8'))
const base = 8 + buf.readUInt32LE(4)

/** 摊平成 `out/main/index.js` 这种路径 */
function walk(node, prefix, out) {
  for (const [name, entry] of Object.entries((node && node.files) || {})) {
    const p = prefix ? prefix + '/' + name : name
    if (entry && entry.files) walk(entry, p, out)
    else if (entry && typeof entry.size === 'number') {
      /**
       * ⚠ `unpacked: true` 的条目**不在 .asar 里面** —— 它是 `app.asar.unpacked/` 下的一个真文件。
       * 2026-10-10 我第一次写这个工具时没管这个标志，于是拿 `NaN` 偏移去切缓冲区，
       * 结果报"主进程里没有 `health:apply-remerge`"（那是 0.3.0 就发出去的东西），
       * 差点判成"打包版不含本轮改动、活体白跑一场"。
       * 真实原因有两个，都得防：大文件被 electron-builder 拆出去了；
       * 而我当时比的"文件大小"是 `readFileSync(...).length`（**字符数**，一个中文 3 字节），
       * 和头部里的字节数天然差一截。
       */
      out.push({
        path: p,
        size: entry.size,
        offset: entry.unpacked ? null : Number(entry.offset),
        unpacked: !!entry.unpacked
      })
    }
  }
  return out
}
const files = walk(header, '', [])
const UNPACKED_DIR = asarPath.replace(/\.asar$/, '.asar.unpacked')
function readEntry(f) {
  if (f.unpacked) return fs.readFileSync(path.join(UNPACKED_DIR, ...f.path.split('/')))
  return buf.subarray(base + f.offset, base + f.offset + f.size)
}
if (listOnly) {
  console.log(`包里 ${files.length} 个文件：`)
  for (const f of files) console.log(`  ${f.path}  ${f.size} B${f.unpacked ? '  ← 拆在 app.asar.unpacked/ 里' : ''}`)
  process.exit(0)
}

/** 中文在打包产物里常被转义成 \uXXXX，两种写法都找一遍，别拿"搜不到中文"当"没打进去" */
function escaped(s) {
  return s.replace(/[^\x20-\x7e]/g, (c) => '\\u' + c.codePointAt(0).toString(16).padStart(4, '0'))
}

const hits = []
const scanned = []
for (const f of files) {
  if (onlyFile && f.path !== onlyFile) continue
  if (/\.(node|dll|exe|png|ico|icns|woff2?)$/i.test(f.path)) continue
  const text = readEntry(f).toString('utf8')
  scanned.push(f.path)
  for (const needle of needles) {
    const plain = text.includes(needle)
    const viaEscape = !plain && /[^\x20-\x7e]/.test(needle) && text.includes(escaped(needle))
    if (plain || viaEscape) hits.push(`${f.path} :: ${needle}${viaEscape ? '（转义形式）' : ''}`)
  }
}

if (onlyFile && !scanned.length) {
  console.error(`⛔ 包里没有 ${onlyFile} —— 路径写错了，或者它压根没被打进去（--list 看清单）`)
  process.exit(1)
}
console.log(`产物 ${asarPath}（包里比对了 ${scanned.length} 个文本文件）`)
for (const n of needles) {
  const found = hits.filter((h) => h.includes(' :: ' + n))
  console.log((found.length ? '  ✅ ' : '  ❌ ') + JSON.stringify(n))
  for (const h of found) console.log('      在 ' + h)
}
process.exit(needles.every((n) => hits.some((h) => h.includes(n))) ? 0 : 1)
