// 探测 npmmirror 二进制镜像是否托管 Electron 与 better-sqlite3 的预编译产物。
// 用法: node tools/probe2.cjs
const urls = [
  ['listing better-sqlite3', 'https://registry.npmmirror.com/-/binary/better-sqlite3/'],
  ['bs electron-v130 win', 'https://registry.npmmirror.com/-/binary/better-sqlite3/v11.10.0/better-sqlite3-v11.10.0-electron-v130-win32-x64.tar.gz'],
  ['bs node-v137 win', 'https://registry.npmmirror.com/-/binary/better-sqlite3/v11.10.0/better-sqlite3-v11.10.0-node-v137-win32-x64.tar.gz'],
  ['listing electron 33.4.11', 'https://registry.npmmirror.com/-/binary/electron/33.4.11/'],
  ['cdn electron zip', 'https://cdn.npmmirror.com/binaries/electron/33.4.11/electron-v33.4.11-win32-x64.zip'],
  ['npm tarball sql.js', 'https://registry.npmjs.org/sql.js/-/sql.js-1.10.3.tgz'],
  ['raw github abi table', 'https://raw.githubusercontent.com/electron/node-abi/main/abi_registry.json']
]

async function run() {
  for (const [label, url] of urls) {
    const started = Date.now()
    try {
      const res = await fetch(url, {
        method: 'GET',
        headers: { range: 'bytes=0-200' },
        signal: AbortSignal.timeout(25000)
      })
      const buf = new Uint8Array(await res.arrayBuffer())
      const head = new TextDecoder().decode(buf.slice(0, 160)).replace(/\s+/g, ' ')
      const secs = ((Date.now() - started) / 1000).toFixed(1)
      console.log(label.padEnd(24) + ' HTTP ' + res.status + '  ' + secs + 's  ' + head.slice(0, 110))
    } catch (e) {
      const why = e.cause ? String(e.cause.code || e.cause.message) : String(e.message)
      console.log(label.padEnd(24) + ' FAIL ' + why)
    }
  }
}

run()
