/**
 * 扫真库，把「方括号槽位第一段」的 token 频次列出来（§B4「从库中学习模型名」的取数部分）。
 * 只读，不动任何文件。用法：node tools/scan-avatar-tokens.cjs [库根]
 *
 * 为什么单独有个脚本：词表要补哪些模型名不能靠我拍脑袋，得看库里真出现过什么。
 * 05 §B4 要求"出现频次 ≥3 且不在词表里"，但真库里 20 个 Libero 是 20 个**不同**模型各出现 1 次，
 * 按 ≥3 一个都捞不着 —— 所以这里同时按「系列名」聚合，把同一系列下的模型名整串列出来。
 */
const fs = require('node:fs')
const path = require('node:path')

const ROOT = process.argv[2] || 'E:\\vrc\\A'
const OPEN = '[[(\\uFF08{\\u3010\\uFF3B\\uFF5B]'
const CLOSE = '[\\])\\uFF09}\\u3011\\uFF3D\\uFF5D]'
const INNER = '[^\\[\\]()\\uFF08\\uFF09{}\\u3010\\u3011\\uFF3B\\uFF3D\\uFF5B\\uFF5D]{1,120}'
const BR = new RegExp('(' + OPEN + ')(' + INNER + ')(' + CLOSE + ')', 'g')
const SEP = /[_\uFF3F]+/
const COMP = /[&\uFF06+\uFF0B\u3001,\uFF0C]/

const freq = new Map()
const bySeries = new Map()
let files = 0
let dirs = 0

function scan(name) {
  BR.lastIndex = 0
  for (let m = BR.exec(name); m; m = BR.exec(name)) {
    const content = m[2].trim()
    const segs = content.split(SEP).map((s) => s.trim()).filter(Boolean)
    if (!segs.length) continue
    const head = segs[0]
    const series = segs.slice(1).join(' ')
    for (const piece of head.split(COMP).map((s) => s.trim()).filter(Boolean)) {
      if (piece.length < 2 || piece.length > 24) continue
      if (/^[0-9.\s]+$/.test(piece)) continue
      freq.set(piece, (freq.get(piece) || 0) + 1)
      if (series) {
        const list = bySeries.get(series) || new Set()
        list.add(piece)
        bySeries.set(series, list)
      }
    }
  }
}

const stack = [ROOT]
while (stack.length) {
  const d = stack.pop()
  let list
  try {
    list = fs.readdirSync(d, { withFileTypes: true })
  } catch {
    continue
  }
  for (const e of list) {
    if (e.isDirectory()) {
      dirs++
      stack.push(path.join(d, e.name))
    } else files++
    scan(e.name)
  }
}

const rows = [...freq.entries()].sort((a, b) => b[1] - a[1])
console.log('dirs=' + dirs + ' files=' + files)
console.log('distinct bracket-slot head tokens: ' + rows.length)
console.log('--- freq >= 2 ---')
for (const [t, n] of rows) if (n >= 2) console.log(String(n).padStart(4) + '  ' + t)
console.log('--- series with >= 3 distinct model tokens ---')
for (const [series, set] of [...bySeries.entries()].sort((a, b) => b[1].size - a[1].size)) {
  if (set.size >= 3) console.log(set.size + ' x [' + series + '] => ' + [...set].sort().join(', '))
}
console.log('--- all head tokens (freq 1) ---')
console.log(rows.filter(([, n]) => n === 1).map(([t]) => t).sort().join(', '))
