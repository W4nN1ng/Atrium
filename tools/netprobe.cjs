/**
 * 网络可达性探针：用 Node 自己的 TLS 栈（和 npm / node-gyp 同源），
 * 逐个 HEAD 关键下载源，判断依赖能不能装上。
 * 用法: node tools/netprobe.cjs
 */
const https = require('node:https')
const { URL } = require('node:url')

const targets = [
  ['npm registry', 'https://registry.npmjs.org/better-sqlite3'],
  ['npmmirror registry', 'https://registry.npmmirror.com/better-sqlite3'],
  ['nodejs.org dist', 'https://nodejs.org/dist/v24.21.0/SHASUMS256.txt'],
  ['npmmirror node.lib', 'https://npmmirror.com/mirrors/node/v24.21.0/win-x64/node.lib'],
  ['electron binary (github)', 'https://github.com/electron/electron/releases/download/v33.4.11/electron-v33.4.11-win32-x64.zip'],
  ['npmmirror electron zip', 'https://npmmirror.com/mirrors/electron/33.4.11/electron-v33.4.11-win32-x64.zip'],
  ['better-sqlite3 prebuild (github)', 'https://github.com/WiseLibs/better-sqlite3/releases/download/v11.10.0/better-sqlite3-v11.10.0-electron-v130-win32-x64.tar.gz'],
  ['github objects cdn', 'https://objects.githubusercontent.com/'],
  ['7-zip.org', 'https://7-zip.org/a/7z2409-x64.exe']
]

function probe(name, url, redirects) {
  return new Promise((resolve) => {
    if (redirects > 4) return resolve(name + ' -> too many redirects')
    const u = new URL(url)
    const req = https.request(
      {
        method: 'GET',
        hostname: u.hostname,
        path: u.pathname + u.search,
        timeout: 20000,
        headers: { 'user-agent': 'a-asset-manager-netprobe/1.0', range: 'bytes=0-64' }
      },
      (res) => {
        res.resume()
        res.on('end', () => resolve(name + ' -> HTTP ' + res.statusCode))
      }
    )
    req.on('error', (e) => resolve(name + ' -> ERROR ' + (e.code || e.message)))
    req.on('timeout', () => {
      req.destroy()
      resolve(name + ' -> TIMEOUT')
    })
    req.on('response', (res) => {
      const loc = res.headers.location
      if (loc && res.statusCode >= 300 && res.statusCode < 400) {
        res.resume()
        res.on('end', () => resolve(probe(name, new URL(loc, url).href, redirects + 1)))
      }
    })
    req.end()
  })
}

;(async () => {
  const out = []
  for (const [name, url] of targets) out.push(await probe(name, url, 0))
  console.log(out.join('\n'))
})()
