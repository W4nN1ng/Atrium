const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const path = require('node:path')

app.disableHardwareAcceleration()
app.commandLine.appendSwitch('disable-gpu')
app.commandLine.appendSwitch('disable-gpu-compositing')
app.commandLine.appendSwitch('in-process-gpu')
app.commandLine.appendSwitch('no-sandbox')

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1060,
    height: 920,
    show: false,
    backgroundColor: '#101014',
    webPreferences: { offscreen: true, backgroundThrottling: false }
  })
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
  const shot = async (name) => {
    const image = await win.webContents.capturePage()
    const file = path.resolve(__dirname, '..', '..', 'docs', 'screenshots', name)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, image.toPNG())
    console.log('captured', file, image.getSize())
  }
  await win.loadFile(path.join(__dirname, 'templates.html'))
  await wait(1200)
  await shot('vpm-p8f-templates.png')

  await win.webContents.executeJavaScript(
    `(() => {
      const btn = [...document.querySelectorAll('button')].find(b => b.textContent?.trim() === '新建模板')
      if (btn) btn.click()
      return Boolean(btn)
    })()`,
    true
  )
  await wait(500)
  await shot('vpm-p8f-editor.png')
  win.destroy()
  app.exit(0)
})
