/** 一次性核对：发布页正文 == 本地文件？正文里的指纹 == 远端资产真实指纹？术语清干净了？ */
const fs = require('node:fs')
const cp = require('node:child_process')
const https = require('node:https')

/**
 * 版本从 `package.json` 取（和 `tools/gh-release.cjs` 同一个来源）。
 * 原来这里连着三处硬编码 `0.2.0`（tag、正文文件名、指纹正则），
 * 发 0.3.0 时如果忘了改，它会拿 0.2.0 的页面去比 0.3.0 的正文 ——
 * **报出来的还是"✅ 一致"**，因为两边都来自同一个旧文件。
 */
const VERSION = process.env.AVCA_RELEASE_VERSION || JSON.parse(fs.readFileSync('package.json', 'utf8')).version
const TAG = 'v' + VERSION

const r = cp.spawnSync('git', ['credential', 'fill'], { input: 'protocol=https\nhost=github.com\n\n', encoding: 'utf8' })
const tok = /^password=(.*)$/m.exec(r.stdout)[1].trim()

https.get(
  'https://api.github.com/repos/W4nN1ng/Atrium/releases/tags/' + TAG,
  { headers: { Authorization: 'Bearer ' + tok, 'User-Agent': 'verify' } },
  (res) => {
    res.setEncoding('utf8')
    let b = ''
    res.on('data', (d) => (b += d))
    res.on('end', () => {
      const j = JSON.parse(b)
      const L = fs.readFileSync(`docs/release-body-${VERSION}.md`, 'utf8').split(/\r?\n/)
      if (L[0].startsWith('# ')) L.splice(0, 2)
      const want = L.join('\n').trim() + '\n'
      console.log('正文与本地逐字一致：', want === j.body ? '✅' : '❌ 差 ' + (j.body.length - want.length) + ' 字符')
      const jargon = /schema|IPC|pHash|DPAPI|GUID|asar|变异|单元测试|代号/.exec(j.body)
      console.log('术语残留：', jargon ? '❌ 还有 ' + jargon[0] : '✅ 没有')

      const dig = {}
      for (const a of j.assets) dig[a.name.replace(/\.exe$/, '')] = (a.digest || '').replace('sha256:', '')
      const claimed = [
        ...j.body.matchAll(
          new RegExp(
            /**
             * 文件名与指纹之间的分隔符要**同时认** `：` 和 ` — `。
             *
             * 2026-10-17 之前这里只认破折号（`\`file\` — \`hash\``），
             * 而 **v0.4.1 起正文改用了中文冒号**（`\`file\`：\`hash\``）。
             * 结果是从 0.4.1 开始的每一次发版，这个工具都报
             * "正文里列了 0 串指纹 / ⚠ 远端有 X 但正文没写指纹"——
             * 不是正文有问题，是正则过期了，而且它**不报错、只是静悄悄地什么也没验**。
             * 我因为它在 0.5.0 和 0.7.0 各误判过一次，所以这次把两种写法都认。
             */
            '`(Atrium-\\w+-' + VERSION.replace(/\./g, '\\.') + '\\.exe)`\\s*(?:：|—|–|:)\\s*`([a-f0-9]{64})`',
            'g'
          )
        )
      ]
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
