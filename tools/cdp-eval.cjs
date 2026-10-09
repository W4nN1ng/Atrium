/**
 * 在跑起来的 Atrium 渲染进程里执行一段 JS，把结果打出来。
 * 用 Node 自带的 WebSocket，不引第三方包。
 *
 *   node tools/cdp-eval.cjs "document.title"
 *   node tools/cdp-eval.cjs --file some-script.js
 *   node tools/cdp-eval.cjs --targets
 *
 * 需要 dev 起在 --remote-debugging-port=9222（见 package.json 的 dev:debug）。
 * 这是验收工具：真点按钮、真走 IPC，比只看单测更接近用户实际路径。
 */
const fs = require('node:fs')

const PORT = process.env.AVCA_CDP_PORT || '9222'
const arg = process.argv[2]

async function targets() {
  const res = await fetch(`http://127.0.0.1:${PORT}/json`)
  return await res.json()
}

async function main() {
  if (!arg) {
    console.error('用法：node tools/cdp-eval.cjs "<表达式>" | --file <path> | --targets')
    process.exit(2)
  }
  const list = await targets()
  if (arg === '--targets') {
    for (const t of list) console.log(`${t.type}\t${t.url}\t${t.title}`)
    return
  }
  const expr = arg === '--file' ? fs.readFileSync(process.argv[3], 'utf8') : arg

  const page =
    list.find((t) => t.type === 'page' && /localhost|file:/.test(t.url) && t.webSocketDebuggerUrl) ||
    list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl)
  if (!page) {
    console.error('没找到 page target，是不是没开 --remote-debugging-port？')
    process.exit(1)
  }
  /** 每次求值都留下"这是哪个实例"（端口被别的进程占过时，证据不能冒充自己的） */
  console.error('[cdp-eval] target =', page.url)

  const ws = new WebSocket(page.webSocketDebuggerUrl)
  let id = 0
  const pending = new Map()

  const send = (method, params) =>
    new Promise((resolve, reject) => {
      const mid = ++id
      pending.set(mid, { resolve, reject })
      ws.send(JSON.stringify({ id: mid, method, params }))
    })

  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data)
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id)
      pending.delete(msg.id)
      if (msg.error) reject(new Error(JSON.stringify(msg.error)))
      else resolve(msg.result)
    }
  })

  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true })
    ws.addEventListener('error', () => reject(new Error('CDP 连接失败')), { once: true })
  })

  // 按"表达式"求值：需要多语句就自己写成 (() => { ... })()，别在这里猜语法
  const r = await send('Runtime.evaluate', {
    expression: expr,
    awaitPromise: true,
    returnByValue: true
  })

  if (r.exceptionDetails) {
    console.error('页面里抛错了：', r.exceptionDetails.exception?.description || r.exceptionDetails.text)
    process.exitCode = 1
  } else {
    const v = r.result?.value
    console.log(typeof v === 'string' ? v : JSON.stringify(v, null, 2))
  }
  ws.close()
}

main().catch((e) => {
  console.error(String(e && e.message ? e.message : e))
  process.exit(1)
})
