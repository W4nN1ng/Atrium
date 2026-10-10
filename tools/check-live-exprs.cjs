/**
 * 静态检查活体脚本里"注入页面去跑的表达式"拼出来到底是不是合法 JS。
 *
 * ## 为什么会要这么个东西
 *
 * 第 9 轮 ① 的 `tools/live-r9-review.cjs` 第一次跑，报的是「界面没起来 / CDP 连不上」。
 * 真相是拼出来的表达式本身有 SyntaxError：
 *  - 箭头函数不带花括号时函数体只能是一个表达式，而拼进去的 HELPERS 是一串 `const …` 声明；
 *  - 后来一次机械改写又给每条表达式多带了一个引号。
 * 两种错的表现**一模一样**：`waitUntil` 里的 try/catch 把异常吞了，判据不红、只是永远等不到，
 * 最后报一句"界面是空的" —— 把工具的 bug 说成了产品的问题。
 *
 * 所以这里不启动应用，只把每个表达式按脚本自己的拼法拼成整段代码交给 `new Function` 验语法。
 * 三十个表达式跑不到 1 秒，能省掉一整场假故障。
 *
 *   node tools/check-live-exprs.cjs                       # 默认查 live-r9-review.cjs
 *   node tools/check-live-exprs.cjs tools/live-r9-review.cjs
 *
 * ⚠ 它认的是 `evalIn(E('…'))` 这个形状。别的活体脚本要用，得先照那个形状写（HELPERS + E 两段）。
 */
const fs = require('node:fs')
const path = require('node:path')

const target = process.argv[2] || 'tools/live-r9-review.cjs'
const file = path.resolve(__dirname, '..', target)
if (!fs.existsSync(file)) {
  console.error('⛔ 文件不在：' + file)
  process.exit(1)
}
const src = fs.readFileSync(file, 'utf8')
const parts = src.split('const HELPERS = `')
if (parts.length < 2) {
  console.error('⛔ ' + target + ' 里没有 `const HELPERS = \\``，这个检查器帮不上忙')
  process.exit(1)
}
const HELPERS = parts[1].split('`\n')[0]

const bad = []
/**
 * 两种写法都要认：
 *  - `evalIn(E('…'))` —— 表达式在调用点就拼好（live-r9-review.cjs）；
 *  - `evalIn('…')` —— 由 evalIn 内部统一套 E（live-r9-remerge.cjs）。
 * 只认前者的话，检查器会对着后一种脚本报"检查了 0 个表达式，红 0 条" ——
 * **一条都没查的绿，比红更坏**（它长得和通过一模一样）。
 */
const RES = [/evalIn\(E\('(.*?)'\)\)/g, /evalIn\('(?!E\()((?:[^'\\]|\\.)*)'\)/g]
let n = 0
for (const re of RES) {
  let m
  while ((m = re.exec(src))) {
    n++
    const expr = m[1].replace(/\\'/g, "'")
    try {
      // eslint-disable-next-line no-new-func
      new Function('(function(){' + HELPERS + 'return (' + expr + ');})()')
    } catch (e) {
      bad.push('  ❌ ' + expr.slice(0, 70) + '　→ ' + e.message)
    }
    /** 改写脚本留下的多余转义：语法可能碰巧成立，但表达式一定不是作者想发的那条 */
    if (m[1].includes("\\'")) bad.push('  ⚠ 残留转义：' + expr.slice(0, 70))
  }
}
if (!n) bad.push('  ❌ 一个表达式都没匹配到 —— 检查器和脚本的写法脱钩了，别把"红 0 条"当成通过')
console.log(target + '：检查了 ' + n + ' 个注入表达式，红 ' + bad.length + ' 条')
for (const b of bad) console.log(b)
process.exit(bad.length ? 1 : 0)
