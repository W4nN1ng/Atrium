// 列出 npmmirror 上 better-sqlite3 与 electron 的实际可用产物名。
// 用法: node tools/probe3.cjs
async function json(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(30000) })
  if (!res.ok) throw new Error('HTTP ' + res.status)
  return res.json()
}

;(async () => {
  for (const version of ['v11.10.0', 'v12.4.1', 'v13.0.3']) {
    try {
      const list = await json('https://registry.npmmirror.com/-/binary/better-sqlite3/' + version + '/')
      const files = list.map((e) => e.name).filter((n) => /win32-x64/.test(n))
      console.log(version + ' win32-x64: ' + (files.join(', ') || '(none)'))
    } catch (e) {
      console.log(version + ' ERR ' + e.message)
    }
  }
  try {
    const root = await json('https://registry.npmmirror.com/-/binary/better-sqlite3/')
    const names = root.map((e) => e.name)
    console.log('available versions (tail 12): ' + names.slice(-12).join(' '))
  } catch (e) {
    console.log('root ERR ' + e.message)
  }
  for (const ev of ['33.4.11', '34.5.8', '35.7.7']) {
    try {
      const list = await json('https://registry.npmmirror.com/-/binary/electron/' + ev + '/')
      const want = list.map((e) => e.name).filter((n) => /win32-x64|headers/.test(n))
      console.log('electron ' + ev + ': ' + want.join(', '))
    } catch (e) {
      console.log('electron ' + ev + ' ERR ' + e.message)
    }
  }
})()
