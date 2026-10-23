/**
 * P8-E 离屏可访问性探针：菜单焦点/方向键/Esc、弹窗焦点陷阱/Esc、100%/125% 横向溢出。
 *
 * 运行前先按 tools/preview/README.md 编 verify.js + 拷 app.css。
 * 这不是 DOM 回归框架，只用于本机证据；真屏幕阅读器/真实 DPI 仍需人验。
 */
const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const path = require('node:path')

app.disableHardwareAcceleration()
app.commandLine.appendSwitch('disable-gpu')
app.commandLine.appendSwitch('disable-gpu-compositing')
app.commandLine.appendSwitch('in-process-gpu')
app.commandLine.appendSwitch('no-sandbox')

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const checks = []
function check(name, ok, detail) {
  checks.push({ name, ok: Boolean(ok), detail: detail ?? null })
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1180,
    height: 900,
    show: false,
    backgroundColor: '#101014',
    webPreferences: { offscreen: true, backgroundThrottling: false }
  })
  const run = (code) => win.webContents.executeJavaScript(code, true)
  const key = async (keyCode) => {
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode })
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode })
    await wait(120)
  }
  const shot = async (name) => {
    const image = await win.webContents.capturePage()
    const file = path.resolve(__dirname, '..', '..', 'docs', 'screenshots', name)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, image.toPNG())
    return image.getSize()
  }

  await win.loadFile(path.join(__dirname, 'verify.html'))
  await wait(1400)

  // 1) ⋯ 菜单：打开后焦点在第一个 menuitem，方向键可移动，Esc 回锚点
  await run(`(() => {
    const btn = [...document.querySelectorAll('[data-vpm-project] button')].find(b => b.textContent.trim() === '⋯')
    if (btn) btn.click()
    return Boolean(btn)
  })()`)
  await wait(350)
  check('menu role', (await run(`document.querySelector('[data-menu-panel]')?.getAttribute('role')`)) === 'menu')
  check('menu first focus', (await run(`document.activeElement?.getAttribute('role')`)) === 'menuitem')
  const firstItem = await run(`document.activeElement?.textContent?.trim() ?? null`)
  await key('Down')
  const afterDown = await run(`document.activeElement?.textContent?.trim() ?? null`)
  check('menu ArrowDown moves', afterDown && afterDown !== firstItem, { firstItem, afterDown })
  await key('Escape')
  check('menu Escape closes', (await run(`Boolean(document.querySelector('[data-menu-panel]'))`)) === false)
  check(
    'menu Escape restores anchor',
    (await run(`document.activeElement?.textContent?.trim() ?? null`)) === '⋯'
  )

  // 2) 菜单 End 聚焦最后一项；用 DOM 激活（原生 button 的原生 Enter/Space 由静态测试保证）
  await run(`(() => {
    const btn = [...document.querySelectorAll('[data-vpm-project] button')].find(b => b.textContent.trim() === '⋯')
    if (btn) btn.click()
    return Boolean(btn)
  })()`)
  await wait(300)
  await key('End')
  check(
    'menu End focuses last item',
    (await run(`document.activeElement?.textContent?.trim() ?? null`)) === '删除项目'
  )
  check(
    'menu item is a native button',
    (await run(`document.activeElement?.tagName ?? null`)) === 'BUTTON'
  )
  await run(`document.activeElement?.click()`)
  await wait(450)
  check('dialog opens', (await run(`Boolean(document.querySelector('[role="dialog"]'))`)) === true)
  check(
    'dialog focus inside',
    (await run(`Boolean(document.activeElement?.closest('[role="dialog"]'))`)) === true
  )
  await key('Tab')
  check(
    'dialog Tab stays inside',
    (await run(`Boolean(document.activeElement?.closest('[role="dialog"]'))`)) === true
  )
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Tab', modifiers: ['shift'] })
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Tab', modifiers: ['shift'] })
  await wait(120)
  check(
    'dialog Shift+Tab stays inside',
    (await run(`Boolean(document.activeElement?.closest('[role="dialog"]'))`)) === true
  )
  await key('Escape')
  check('dialog Escape closes', (await run(`Boolean(document.querySelector('[role="dialog"]'))`)) === false)

  // 3) 100% / 125% 横向溢出与截图
  win.webContents.setZoomFactor(1)
  await wait(300)
  const overflow100 = await run(`document.documentElement.scrollWidth - window.innerWidth`)
  const size100 = await shot('vpm-p8e-100.png')
  check('100% no horizontal overflow', overflow100 <= 2, { overflow100, size100 })

  win.webContents.setZoomFactor(1.25)
  await wait(500)
  const overflow125 = await run(`document.documentElement.scrollWidth - window.innerWidth`)
  const size125 = await shot('vpm-p8e-125.png')
  check('125% no horizontal overflow', overflow125 <= 2, { overflow125, size125 })

  console.log(JSON.stringify({ checks, shots: ['vpm-p8e-100.png', 'vpm-p8e-125.png'] }, null, 2))
  const failed = checks.filter((item) => !item.ok)
  win.destroy()
  app.exit(failed.length ? 1 : 0)
})
