const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const path = require('node:path')

app.disableHardwareAcceleration()
app.commandLine.appendSwitch('disable-gpu')
app.commandLine.appendSwitch('disable-gpu-compositing')
app.commandLine.appendSwitch('in-process-gpu')
app.commandLine.appendSwitch('no-sandbox')

const wait = (ms) => new Promise((r) => setTimeout(r, ms))

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1180,
    height: 900,
    show: false,
    backgroundColor: '#101014',
    webPreferences: { offscreen: true, backgroundThrottling: false }
  })
  const shots = []
  const shot = async (name) => {
    const image = await win.webContents.capturePage()
    const file = path.join(__dirname, `verify-${name}.png`)
    fs.writeFileSync(file, image.toPNG())
    shots.push(file)
  }
  const run = (code) => win.webContents.executeJavaScript(code, true)

  await win.loadFile(path.join(__dirname, 'verify.html'))
  await wait(1500)

  const report = { shots, steps: [] }

  // 1) 列表是否显示 3 个工程（R18）
  report.steps.push({
    step: 'list-rows',
    value: await run(`document.querySelectorAll('[data-vpm-project]').length`)
  })
  report.steps.push({
    step: 'names',
    value: await run(
      `[...document.querySelectorAll('[data-vpm-project]')].map(el => el.querySelector('.text-\\\\[17px\\\\]')?.textContent ?? el.textContent.slice(0,12))`
    )
  })
  await shot('1-list')

  // 2) 打开第一行的 ⋯ 菜单（R13 portal）
  await run(`
    (() => {
      const btn = [...document.querySelectorAll('[data-vpm-project] button')].find(b => b.textContent.trim() === '⋯')
      if (btn) btn.click()
      return Boolean(btn)
    })()
  `)
  await wait(400)
  report.steps.push({
    step: 'menu-items',
    value: await run(
      `[...document.querySelectorAll('[data-menu-panel] button')].map(b => b.textContent.trim())`
    )
  })
  report.steps.push({
    step: 'menu-in-body',
    value: await run(`Boolean(document.body.querySelector('[data-menu-panel]'))`)
  })
  await shot('2-menu')

  // 3) 点「删除项目」→ 弹窗（R17）
  await run(`
    (() => {
      const item = [...document.querySelectorAll('[data-menu-panel] button')].find(b => b.textContent.trim() === '删除项目')
      if (item) item.click()
      return Boolean(item)
    })()
  `)
  await wait(500)
  report.steps.push({
    step: 'dialog-title',
    value: await run(`document.querySelector('[role="dialog"]')?.textContent?.slice(0, 80) ?? null`)
  })
  report.steps.push({
    step: 'has-checkbox',
    value: await run(`Boolean(document.querySelector('[role="dialog"] input[type=checkbox]'))`)
  })
  await shot('3-dialog')

  // 4) 确认删除 → 应该调 trash 而不是 remove
  await run(`
    (() => {
      const dialog = document.querySelector('[role="dialog"]')
      if (!dialog) return false
      const btn = [...dialog.querySelectorAll('button')].find(b => b.textContent.trim() === '删除项目')
      if (btn) btn.click()
      return Boolean(btn)
    })()
  `)
  await wait(800)
  report.steps.push({ step: 'log', value: await run(`window.__log`) })
  report.steps.push({
    step: 'rows-after-delete',
    value: await run(`document.querySelectorAll('[data-vpm-project]').length`)
  })
  await shot('4-after-delete')

  console.log(JSON.stringify(report, null, 2))
  win.destroy()
  app.exit(0)
})
