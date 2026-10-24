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
    width: 980,
    height: 900,
    show: false,
    backgroundColor: '#101014',
    webPreferences: { offscreen: true, backgroundThrottling: false }
  })
  try {
    await win.loadFile(path.join(__dirname, 'index.html'))
  } catch (error) {
    console.log('load failed', String(error))
  }
  await new Promise((resolve) => setTimeout(resolve, 2500))
  const image = await win.webContents.capturePage()
  const out = path.join(__dirname, 'ui.png')
  fs.writeFileSync(out, image.toPNG())
  console.log('captured', out, image.getSize())
  win.destroy()
  app.exit(0)
})
