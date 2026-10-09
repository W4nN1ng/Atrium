/**
 * 写本机开发用的设置（避免在 bash 里内联转义反斜杠路径，那玩意儿在这台机器上必翻车）。
 * 用法:
 *   node tools/set-settings.cjs language=ja libraryRoot=E:\\vrc\\A_Library
 * 不带参数时只打印当前设置。
 */
const fs = require('node:fs')
const path = require('node:path')

const file = path.join(process.env.APPDATA, 'A', 'settings.json')

function read() {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return {}
  }
}

const pairs = process.argv.slice(2)
if (!pairs.length) {
  console.log(file)
  console.log(JSON.stringify(read(), null, 2))
  process.exit(0)
}

const cur = read()
for (const p of pairs) {
  const i = p.indexOf('=')
  if (i < 0) {
    console.log('跳过无效参数：' + p)
    continue
  }
  const key = p.slice(0, i)
  let value = p.slice(i + 1)
  if (value === 'true') value = true
  else if (value === 'false') value = false
  else if (value === 'null') value = null
  else if (/^-?\d+(\.\d+)?$/.test(value)) value = Number(value)
  cur[key] = value
  console.log('set ' + key + ' = ' + JSON.stringify(value))
}

fs.mkdirSync(path.dirname(file), { recursive: true })
fs.writeFileSync(file, JSON.stringify(cur, null, 2), 'utf8')
console.log('wrote ' + file)
