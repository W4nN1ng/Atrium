// 往三份语言文件里合并一批 key（保留已有内容，只补不删）。
// 用法：node tools/add-i18n-keys.cjs patch.json
// patch.json = { "zh-CN": { "a": { "b": "文案" } }, "en": {...}, "ja": {...} }
const fs = require('node:fs')
const path = require('node:path')

const patchFile = process.argv[2]
if (!patchFile) {
  console.error('用法：node tools/add-i18n-keys.cjs <patch.json>')
  process.exit(2)
}

const ROOT = path.resolve(__dirname, '..')
const I18N = path.join(ROOT, 'src', 'renderer', 'i18n')
const patch = JSON.parse(fs.readFileSync(patchFile, 'utf8'))

function deepMerge(dst, src, prefix) {
  let added = 0
  for (const [k, v] of Object.entries(src)) {
    if (v && typeof v === 'object') {
      if (!dst[k] || typeof dst[k] !== 'object') dst[k] = {}
      added += deepMerge(dst[k], v, prefix ? `${prefix}.${k}` : k)
    } else {
      const key = prefix ? `${prefix}.${k}` : k
      if (dst[k] === undefined) {
        dst[k] = v
        added++
        console.log(`  + ${key}`)
      } else if (dst[k] !== v) {
        console.log(`  = ${key}（已存在，保留旧文案）`)
      }
    }
  }
  return added
}

for (const [loc, body] of Object.entries(patch)) {
  const file = path.join(I18N, `${loc}.json`)
  if (!fs.existsSync(file)) {
    console.error(`没有这个语言文件：${file}`)
    process.exit(2)
  }
  const data = JSON.parse(fs.readFileSync(file, 'utf8'))
  console.log(`${loc}:`)
  const n = deepMerge(data, body, '')
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n')
  console.log(`  共新增 ${n} 条`)
}
