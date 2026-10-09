const fs = require('node:fs')
const path = require('node:path')

function driveOf(p) {
  const m = /^([a-zA-Z]):/.exec(p.replace(/\\/g, '/'))
  return m ? m[1].toLowerCase() : ''
}

const real = fs.mkdtempSync(path.join(process.env.TEMP, 'avca-drive-'))
console.log('真临时目录:', real, '→ driveOf =', JSON.stringify(driveOf(real)))

const forms = [
  real,
  '\\\\?\\' + real,
  '//?/' + real.replace(/\\/g, '/'),
  path.resolve(real),
  real.replace(/\\/g, '/')
]
for (const f of forms) {
  let mkdir = 'ok'
  try {
    fs.mkdirSync(path.join(f, 'sub'))
  } catch (e) {
    mkdir = e.code || e.message
  }
  let exists = false
  try {
    exists = fs.existsSync(path.join(f, 'sub'))
  } catch (e) {
    exists = 'err'
  }
  console.log(JSON.stringify(f), '| driveOf=', JSON.stringify(driveOf(f)), '| resolve=', JSON.stringify(path.resolve(f)), '| mkdir=', mkdir, '| exists=', exists)
}
try {
  fs.rmSync(real, { recursive: true, force: true })
} catch {}
