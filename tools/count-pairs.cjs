/** 只读统计：库里有多少"包 + 同名已解压目录"并排放着（收编时会撞成重复的形态） */
const fs = require('node:fs')
const path = require('node:path')
const R = process.argv[2] || 'E:/vrc/A'
const pairs = []
;(function w(d) {
  let l
  try {
    l = fs.readdirSync(d, { withFileTypes: true })
  } catch {
    return
  }
  const dirs = new Set(l.filter((e) => e.isDirectory()).map((e) => e.name))
  for (const e of l) {
    if (!e.isFile()) continue
    const base = e.name.replace(/\.(zip|rar|7z|unitypackage|tar|gz)$/i, '')
    if (base !== e.name && dirs.has(base)) pairs.push(path.join(d, base))
  }
  for (const e of l) if (e.isDirectory()) w(path.join(d, e.name))
})(R)
console.log('「包 + 同名已解压目录」并排的对数：' + pairs.length)
for (const p of pairs.slice(0, 14)) console.log('  ' + path.relative(R, p))
