#!/usr/bin/env node
/**
 * 从三份语言文件里**删掉**一批 key（配 `tools/add-i18n-keys.cjs` 的反向操作）。
 *
 * ## 为什么会要这个
 *
 * 第 10 轮 F「旧文案大扫除」扫出 8 条**没人引用的死文案**（`importDeferred`、`m1Stopped`、
 * `undo.fsLater`…）—— 它们的值里写着「在 M2 交付」「在 M5 交付」这类里程碑话术。
 * 死文案比活文案更危险：它不会出现在界面上，所以没人会去修它，
 * 而 `tests/renderer/i18n.spec.ts` 只查"用到的 key 存不存在"，从不查"存在的 key 有没有人用"。
 * 一条"界面不许写里程碑"的用例要能跑，前提是先把这些尸体清掉。
 *
 *   node tools/i18n-prune.cjs keys.json          # keys.json = ["library.importDeferred", ...]
 *   node tools/i18n-prune.cjs --dry-run keys.json
 *
 * ⚠ 删完必须跑 `npx vitest run tests/renderer/i18n.spec.ts`：三份文件的 key 数必须仍然一致，
 *   而且不许还有代码引用被删掉的 key（那条用例是"用到的必须存在"，反方向靠这个工具自己打印）。
 */
const fs = require('node:fs')
const path = require('node:path')

const argv = process.argv.slice(2)
const dry = argv.includes('--dry-run')
const file = argv.find((a) => !a.startsWith('--'))
if (!file) {
  console.error('用法：node tools/i18n-prune.cjs [--dry-run] <keys.json>')
  process.exit(2)
}
const keys = JSON.parse(fs.readFileSync(file, 'utf8'))
if (!Array.isArray(keys) || !keys.length) {
  console.error('keys.json 得是一个非空的字符串数组')
  process.exit(2)
}

const ROOT = path.resolve(__dirname, '..')
const I18N = path.join(ROOT, 'src', 'renderer', 'i18n')
const LOCALES = ['zh-CN', 'en', 'ja']

/** 被删的 key 有没有还被代码引用着 —— 有就是"删掉一句还在显示的话"，必须停手 */
function codeRefs(key) {
  const dirs = ['src/renderer', 'src/main', 'src/shared', 'src/preload']
  const hits = []
  const walk = (d) => {
    for (const e of fs.readdirSync(path.join(ROOT, d), { withFileTypes: true })) {
      const p = path.join(d, e.name)
      if (e.isDirectory()) walk(p)
      else if (/\.(ts|tsx)$/.test(e.name)) {
        const src = fs.readFileSync(path.join(ROOT, p), 'utf8')
        if (src.includes(key)) hits.push(p)
      }
    }
  }
  for (const d of dirs) if (fs.existsSync(path.join(ROOT, d))) walk(d)
  return hits
}

let removed = 0
const stillUsed = []
for (const key of keys) {
  const refs = codeRefs(key)
  if (refs.length) stillUsed.push(`${key} → ${refs.join(', ')}`)
}
if (stillUsed.length) {
  console.error('⛔ 这些 key 还有代码在用，删了界面就会显示 key 名：')
  for (const s of stillUsed) console.error('   ' + s)
  console.error('   要么先改代码，要么把它从删除清单里拿掉。')
  process.exit(1)
}

for (const loc of LOCALES) {
  const p = path.join(I18N, `${loc}.json`)
  const data = JSON.parse(fs.readFileSync(p, 'utf8'))
  const gone = []
  for (const key of keys) {
    const parts = key.split('.')
    let node = data
    for (let i = 0; i < parts.length - 1; i++) {
      if (!node || typeof node !== 'object') {
        node = null
        break
      }
      node = node[parts[i]]
    }
    if (node && typeof node === 'object' && node[parts[parts.length - 1]] !== undefined) {
      if (!dry) delete node[parts[parts.length - 1]]
      gone.push(key)
    } else {
      console.log(`  ${loc}: ${key} 本来就不在`)
    }
  }
  if (!dry && gone.length) fs.writeFileSync(p, JSON.stringify(data, null, 2) + '\n')
  console.log(`${loc}: ${dry ? '将删除' : '已删除'} ${gone.length} 条${gone.length ? '\n  ' + gone.join('\n  ') : ''}`)
  removed += gone.length
}
console.log(`合计 ${removed} 条（三份文件各 ${removed / LOCALES.length} 条 —— 数目不等就说明三份文件的 key 已经漂了）`)
