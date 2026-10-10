/** 扫：三份语言文件里还有没有"把 A 当产品名用"的值（排除 Ctrl+A、E:\vrc\A、M5-A 这类合法用法） */
const fs = require('node:fs')
const path = require('node:path')
const I18N = path.resolve(__dirname, '../src/renderer/i18n')

const ALLOW = /(Ctrl\+A|Alt\+A|Shift\+A|E:?[\\/]?vrc[\\/]?A|Atriumdate|M\d-[AB]\b|\bA-\d|A__extract|\.avca|A 盘|A-\d)/

for (const loc of ['zh-CN', 'en', 'ja']) {
  const data = JSON.parse(fs.readFileSync(path.join(I18N, `${loc}.json`), 'utf8'))
  const out = []
  const walk = (o, p) => {
    for (const [k, v] of Object.entries(o)) {
      const key = p ? `${p}.${k}` : k
      if (v && typeof v === 'object') walk(v, key)
      else if (typeof v === 'string') {
        // 去掉合法用法之后再找"裸 A 当主语/宾语"
        const s = v.replace(ALLOW.global ? new RegExp(ALLOW.source, 'g') : ALLOW, '·')
        const hits = []
        if (loc === 'en') {
          /**
           * ⚠ 动词列表后面**必须有 `\b`**：少了它，`to` 会咬住 `toast`、`in` 会咬住 `inventory`，
           * 于是 "A toast reports what was done" 被报成内部代号（实测误报过一条）。
           * 权威口径是 `tests/renderer/i18n-hygiene.spec.ts`（它会红），这个工具只是给人看的粗扫。
           */
          for (const m of s.matchAll(/(^|[^A-Za-z0-9_])A(?=\s+(is|are|has|have|had|can|can't|cannot|won't|will|must|needs?|does|doesn't|only|knows|handles|queues|archives|moves|picks|selects|stopped|works|still|in|on|to|for|自身|自己的)\b)/g)) hits.push(m[0].trim())
          for (const m of s.matchAll(/\bA's\b/g)) hits.push("A's")
          for (const m of s.matchAll(/(start|open|through|via|in|use)\sA\b(?![\w.])/g)) hits.push(m[0])
        } else if (loc === 'ja') {
          for (const m of s.matchAll(/(^|[^A-Za-z0-9_])A(?=[はがをにもの])/g)) hits.push(m[0].trim())
        } else {
          for (const m of s.matchAll(/(^|[^A-Za-z0-9_\\/:.])A(?=[ 不没得叫让就才将又只必该手怎这自])/g)) hits.push(m[0].trim())
        }
        if (hits.length) out.push(`${key}　[${hits.join(' ')}]　${v}`)
      }
    }
  }
  walk(data, '')
  console.log(`\n=== ${loc}：还剩 ${out.length} 条`)
  for (const s of out) console.log('   ' + s.slice(0, 200))
}
