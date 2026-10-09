/**
 * 一次性修：把三语文案里写成**单花括号**的插值占位符改成 i18next 认的 `{{name}}`。
 *
 * 为什么用脚本而不是手改：同一个 key 三份文件 ×4 个 key = 12 处，手改必漏一处，
 * 而漏掉的那份语言就是"界面上出现 `{freeGB}`"那种用户看得见的 bug。
 *
 * 用法：node tools/fix-i18n-braces.cjs          # 改
 *      node tools/probe-i18n-braces.cjs        # 改完复查（应为"没有"）
 */
const fs = require('node:fs')
const path = require('node:path')

const DIR = path.join(process.cwd(), 'src', 'renderer', 'i18n')
/** 这些 key 的值里就是写字面量大括号的说明文字，不许动 */
const ALLOW = ['dirTemplateHint']

let changed = 0
for (const lang of ['zh-CN', 'en', 'ja']) {
  const file = path.join(DIR, `${lang}.json`)
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/)
  const out = lines.map((line) => {
    const m = /^(\s*")([^"]+)("\s*:\s")(.*)(",?)$/.exec(line)
    if (!m) return line
    const [, pre, key, mid, value, tail] = m
    if (ALLOW.includes(key)) return line
    /** 先保护合法的 {{...}}，再把剩下的 {word} 升级成 {{word}} */
    const fixed = value
      .replace(/\{\{[^}]*\}\}/g, (s) => s.replace(/\{/g, '\u0001').replace(/\}/g, '\u0002'))
      .replace(/\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g, '{{$1}}')
      .replace(/\u0001/g, '{')
      .replace(/\u0002/g, '}')
    if (fixed !== value) changed++
    return pre + key + mid + fixed + tail
  })
  fs.writeFileSync(file, out.join('\n'), 'utf8')
}
console.log(`改了 ${changed} 行`)
