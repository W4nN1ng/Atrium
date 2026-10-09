// 一次性改名脚本：产品名改成 Atrium。跑完可删。
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.join(__dirname, '..')

// 1) index.html 的 <title>
const html = path.join(ROOT, 'src', 'renderer', 'index.html')
let h = fs.readFileSync(html, 'utf8')
h = h.replace(/<title>[^<]*<\/title>/, '<title>Atrium</title>')
fs.writeFileSync(html, h, 'utf8')
console.log('index.html title -> Atrium')

// 2) 三份语言文件的可见产品名
const NAMES = {
  'zh-CN': { appName: 'Atrium', trayQuit: '退出 Atrium' },
  en: { appName: 'Atrium', trayQuit: 'Quit Atrium' },
  ja: { appName: 'Atrium', trayQuit: 'Atrium を終了' }
}
for (const [loc, patch] of Object.entries(NAMES)) {
  const p = path.join(ROOT, 'src', 'renderer', 'i18n', `${loc}.json`)
  const j = JSON.parse(fs.readFileSync(p, 'utf8'))
  Object.assign(j.common, patch)
  fs.writeFileSync(p, JSON.stringify(j, null, 2) + '\n', 'utf8')
  console.log(loc, '->', j.common.appName, '/', j.common.trayQuit)
}

// 3) 确认没有残留的旧产品名（源码里不该再有 "A 素材管家"）
const hits = []
const walk = (dir) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name === 'dist' || e.name === 'out') continue
      walk(p)
    } else if (/\.(ts|tsx|html|json|yml|cjs|py)$/.test(e.name)) {
      const s = fs.readFileSync(p, 'utf8')
      if (s.includes('A 素材管家')) hits.push(path.relative(ROOT, p))
    }
  }
}
walk(ROOT)
console.log(hits.length ? '仍含旧名的文件：' + hits.join(', ') : '源码里已无旧产品名残留')
