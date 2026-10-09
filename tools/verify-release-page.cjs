/** 一次性核对：发布页正文 == 本地文件？正文里的指纹 == 远端资产真实指纹？术语清干净了？ */
const fs = require('node:fs')
const cp = require('node:child_process')
const https = require('node:https')

const r = cp.spawnSync('git', ['credential', 'fill'], { input: 'protocol=https\nhost=github.com\n\n', encoding: 'utf8' })
const tok = /^password=(.*)$/m.exec(r.stdout)[1].trim()

https.get(
  'https://api.github.com/repos/W4nN1ng/Atrium/releases/tags/v0.2.0',
  { headers: { Authorization: 'Bearer ' + tok, 'User-Agent': 'verify' } },
  (res) => {
    res.setEncoding('utf8')
    let b = ''
    res.on('data', (d) => (b += d))
    res.on('end', () => {
      const j = JSON.parse(b)
      const L = fs.readFileSync('docs/release-body-0.2.0.md', 'utf8').split(/\r?\n/)
      if (L[0].startsWith('# ')) L.splice(0, 2)
      const want = L.join('\n').trim() + '\n'
      console.log('正文与本地逐字一致：', want === j.body ? '✅' : '❌ 差 ' + (j.body.length - want.length) + ' 字符')
      const jargon = /schema|IPC|pHash|DPAPI|GUID|asar|变异|单元测试|代号/.exec(j.body)
      console.log('术语残留：', jargon ? '❌ 还有 ' + jargon[0] : '✅ 没有')

      const dig = {}
      for (const a of j.assets) dig[a.name.replace(/\.exe$/, '')] = (a.digest || '').replace('sha256:', '')
      const claimed = [...j.body.matchAll(/`(Atrium-\w+-0\.2\.0\.exe)` — `([a-f0-9]{64})`/g)]
      console.log('正文里列了 ' + claimed.length + ' 串指纹：')
      for (const m of claimed) {
        const name = m[1].replace(/\.exe$/, '')
        const real = dig[name]
        console.log('  ' + m[1] + ' → ' + (real === m[2] ? '✅ 与远端资产一致' : '❌ 远端是 ' + (real || '(没这个资产)')))
      }
      for (const k of Object.keys(dig)) {
        if (!claimed.some((m) => m[1].replace(/\.exe$/, '') === k)) console.log('  ⚠ 远端有 ' + k + ' 但正文没写指纹')
      }
    })
  }
)
