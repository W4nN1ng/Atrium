/**
 * 用 CDP 的 **Input.dispatchMouseEvent（type: mouseWheel）** 在真窗口里滚一下。
 *
 * ## 为什么要单独一个工具，而不是在页面里 `dispatchEvent(new WheelEvent(...))`
 *
 * 页面里派发的 WheelEvent 是**不受信事件**，Chromium 的滚轮滚动由输入管线驱动，
 * 合成事件不会真的滚 —— 拿它当证据会把"工具不行"误判成"产品滚不动"。
 * `Input.dispatchMouseEvent` 走的是同一条输入管线，是真滚。
 *
 *   node tools/cdp-wheel.cjs --find "<表达式，返回 {x,y}>" [--delta 600] [--ticks 3] \
 *                            --after "<表达式，滚完之后读什么>"
 *
 * 需要实例带 `--remote-debugging-port`（见 `AVCA_CDP_PORT`）。
 */
const PORT = process.env.AVCA_CDP_PORT || '9222'

function argOf(flag, need = true) {
  const i = process.argv.indexOf(flag)
  if (i < 0) {
    if (need) {
      console.error('缺参数：' + flag)
      process.exit(2)
    }
    return null
  }
  return process.argv[i + 1]
}

async function pageTarget() {
  const res = await fetch(`http://127.0.0.1:${PORT}/json`)
  const list = await res.json()
  return (
    list.find((t) => t.type === 'page' && /localhost|file:/.test(t.url) && t.webSocketDebuggerUrl) ||
    list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl)
  )
}

function client(wsUrl) {
  const ws = new WebSocket(wsUrl)
  let id = 0
  const pending = new Map()
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data)
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id)
      pending.delete(msg.id)
      if (msg.error) reject(new Error(JSON.stringify(msg.error)))
      else resolve(msg.result)
    }
  })
  const send = (method, params) =>
    new Promise((resolve, reject) => {
      const mid = ++id
      pending.set(mid, { resolve, reject })
      ws.send(JSON.stringify({ id: mid, method, params }))
    })
  const open = new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true })
    ws.addEventListener('error', () => reject(new Error('CDP 连接失败')), { once: true })
  })
  return { send, open, close: () => ws.close() }
}

async function main() {
  const find = argOf('--find')
  const after = argOf('--after', false)
  const delta = Number(argOf('--delta', false) || '600')
  const ticks = Number(argOf('--ticks', false) || '3')
  const page = await pageTarget()
  if (!page) {
    console.error('没找到 page target，是不是没开 --remote-debugging-port？')
    process.exit(1)
  }
  const c = client(page.webSocketDebuggerUrl)
  await c.open

  /** `--find` / `--after` 传的是**表达式**，所以外面包一层 `return (...)`，不是裸语句块 */
  const ev = async (expression) => {
    const r = await c.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text)
    return r.result?.value
  }

  const at = await ev('(() => { return (' + find + ') })()')
  if (!at || typeof at.x !== 'number' || typeof at.y !== 'number') {
    console.error('--find 没返回 {x,y}，拿到的是：' + JSON.stringify(at))
    process.exit(1)
  }
  for (let i = 0; i < ticks; i++) {
    await c.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: at.x, y: at.y, deltaX: 0, deltaY: delta })
    await new Promise((r) => setTimeout(r, 120))
  }
  const out = after ? await ev('(() => { return (' + after + ') })()') : { scrolled: true }
  console.log(JSON.stringify(out, null, 2))
  c.close()
}

main().catch((e) => {
  console.error('⛔ ' + e.message)
  process.exit(1)
})
