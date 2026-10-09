/**
 * 库快照：把整棵目录树按 (相对路径去盘符, 大小) 存成多重集，用于收编前后对比。
 *
 * 为什么不用 basename 匹配：那招实测过，等于没测（同名文件到处都是，"找不到原件 0" 是自欺欺人）。
 * 名字+大小的多重集才能证明"没丢、没复制出第二份"。
 *
 * 用法：node tools/lib-snapshot.cjs <目录> <输出文件>
 */
const fs = require('node:fs')
const path = require('node:path')

const root = process.argv[2]
const out = process.argv[3]
if (!root || !out) {
  console.error('用法：node tools/lib-snapshot.cjs <目录> <输出文件>')
  process.exit(2)
}

const rows = []
let dirs = 0
function walk(d, depth) {
  if (depth > 12) return
  let list = []
  try {
    list = fs.readdirSync(d, { withFileTypes: true })
  } catch (e) {
    rows.push(`UNREADABLE ${d} ${e.code || ''}`)
    return
  }
  for (const e of list) {
    const abs = path.join(d, e.name)
    if (e.isDirectory()) {
      dirs++
      walk(abs, depth + 1)
      continue
    }
    if (e.isSymbolicLink && e.isSymbolicLink()) {
      rows.push(`SYMLINK ${abs}`)
      continue
    }
    let st
    try {
      st = fs.statSync(abs)
    } catch {
      rows.push(`UNSTAT ${abs}`)
      continue
    }
    const rel = path.relative(root, abs).replace(/\\/g, '/')
    rows.push(`${st.size}\t${rel}`)
  }
}

walk(root, 0)
rows.sort()
const total = rows.reduce((a, r) => a + (Number(r.split('\t')[0]) || 0), 0)
fs.writeFileSync(
  out,
  `# root=${root} at=${new Date().toISOString()} files=${rows.length} dirs=${dirs} bytes=${total}\n` +
    rows.join('\n') +
    '\n',
  'utf8'
)
console.log(`快照写入 ${out}：${rows.length} 个文件、${dirs} 个目录、共 ${(total / 1073741824).toFixed(2)} GB`)
