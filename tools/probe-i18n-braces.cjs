/**
 * 找出三语文案里**写成单花括号**的插值占位符 —— i18next 只认 `{{name}}`，
 * 写成 `{name}` 的话界面上会原样显示大括号，等于参数白传（2026-10-06 沙盒活体抓到 4 条）。
 *
 * 用法：node tools/probe-i18n-braces.cjs
 */
const fs = require('node:fs')
const path = require('node:path')

const DIR = path.join(process.cwd(), 'src', 'renderer', 'i18n')
/** 这些是**故意**写字面量大括号的（模板说明、JSON 示例），不算错 */
const ALLOW = ['dirTemplateHint']

let bad = 0
for (const lang of ['zh-CN', 'en', 'ja']) {
  const file = path.join(DIR, `${lang}.json`)
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/)
  lines.forEach((line, i) => {
    const m = /^\s*"([^"]+)"\s*:\s*"(.*)",?$/.exec(line.trimEnd())
    if (!m) return
    const [, key, value] = m
    if (ALLOW.includes(key)) return
    /** 去掉合法的 {{...}}，剩下的 {word} 就是写错了的 */
    const rest = value.replace(/\{\{[^}]*\}\}/g, '')
    const hits = rest.match(/\{[a-zA-Z_][a-zA-Z0-9_]*\}/g)
    if (hits) {
      bad++
      console.log(`${lang}:${i + 1}  ${key}  →  ${hits.join(' ')}   |   ${value.slice(0, 90)}`)
    }
  })
}
console.log(bad ? `\n共 ${bad} 处会被原样显示在界面上` : '没有单花括号的占位符')
