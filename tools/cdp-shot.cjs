/**
 * 用 CDP 截图，不走 PrintWindow。
 *
 * 为什么不用 tools/shot.ps1：窗口被别的应用挡住时 Chromium 会跳过绘制，
 * PrintWindow 拿回来的是上一帧的旧画面 —— 实测把 4 个素材入库之后，
 * 截图里还是入库前的收件箱列表，DOM 查询却已经是新页面，差点误判成"UI 没刷新"。
 * Page.captureScreenshot 直接从渲染进程取帧，挡不挡住都是当前画面。
 *
 *   node tools/cdp-shot.cjs out.png
 */
const fs = require('node:fs')
const path = require('node:path')

const PORT = process.env.AVCA_CDP_PORT || '9222'
const out = process.argv[2] || path.join(process.env.TEMP || '.', 'atrium-cdp.png')

async function main() {
  const res = await fetch(`http://127.0.0.1:${PORT}/json`)
  const list = await res.json()
  const page = list.find((t) => t.type === 'page' && /localhost|file:/.test(t.url) && t.webSocketDebuggerUrl)
  if (!page) throw new Error('没有 Atrium 的 page target（localhost:5173 或 file:）：dev 是不是没带 --remote-debugging-port 起？')
  /** 每张截图都留下"这是哪个实例"：端口上挂着别的进程时，证据不能冒充自己的（撞过一次） */
  console.error('[cdp-shot] target =', page.url)

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
      msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result)
    }
  })
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true })
    ws.addEventListener('error', () => reject(new Error('CDP 连接失败')), { once: true })
  })

  await send('Page.enable', {})
  /**
   * 先把窗口顶到最前再截。
   *
   * Chromium 在窗口被挡住 / 不在前台时会**跳过绘制**，`Page.captureScreenshot`
   * 就永远等不到下一帧（实测直接超时，`fromSurface:false` 也救不回来）。
   * 而 `SetForegroundWindow` 从外部调会被系统的焦点保护挡掉（实测 foreground=False），
   * 只有进程自己 `setAlwaysOnTop(true) + show() + focus()` 才作数 ——
   * 所以走应用里的 `system:nudge-front`（那个通道只在带 --remote-debugging-port 时注册）。
   * 等 500ms 是给一次重绘留出时间，太短会截到半帧。
   */
  let nudged = false
  try {
    const r = await send('Runtime.evaluate', {
      expression: 'window.a.system.nudgeFront(true).then(() => "raised")',
      awaitPromise: true,
      returnByValue: true
    })
    nudged = r && r.result && r.result.value === 'raised'
  } catch {
    /* 不带调试口的正式包会走到这里：那就按老办法硬截 */
  }
  if (nudged) await new Promise((r) => setTimeout(r, 500))
  // 窗口被挡住时 Chromium 会冻结绘制，普通截图会一直等下一帧（实测卡死），
  // 所以先把页面切回 active，再用 fromSurface:false 走离屏渲染。
  try {
    await send('Page.setWebLifecycleState', { state: 'active' })
  } catch {
    /* 老版本没这个域，忽略 */
  }
  const shot = await withTimeout(
    send('Page.captureScreenshot', { format: 'png', fromSurface: false, captureBeyondViewport: false }),
    15000,
    'captureScreenshot 超时（页面一帧都挤不出来）'
  )
  if (nudged) {
    try {
      await send('Runtime.evaluate', { expression: 'window.a.system.nudgeFront(false)', returnByValue: true })
    } catch {
      /* 恢复失败不影响截图结果 */
    }
  }
  fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true })
  fs.writeFileSync(path.resolve(out), Buffer.from(shot.data, 'base64'))
  console.log(`OK ${shot.data.length} b64 bytes -> ${out}`)
  ws.close()
}

function withTimeout(p, ms, why) {
  return Promise.race([
    p,
    new Promise((_, reject) => setTimeout(() => reject(new Error(why)), ms))
  ])
}

main().catch((e) => {
  console.error(String(e && e.message ? e.message : e))
  process.exit(1)
})
