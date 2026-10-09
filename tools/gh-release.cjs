/**
 * 建 GitHub Release 并上传两个 exe —— 走 REST，这台机器没有 gh。
 *
 * 纪律（这一条是给别人复用时的护栏，别拆）：
 *   - token 只从环境变量 GH_TOKEN 拿，拿不到就用系统里已存的 git 凭证（git credential fill），
 *     **两条路都不许把它打印出来、写进文件、写进 git config**。日志里只打长度。
 *   - 默认 **只读**（--check）。真的建 Release 必须显式带 --create，而且这是公开发布，
 *     得他先点头。
 *   - api.github.com 在这台机器上时通时不通 → 每个请求包重试（指数退避），-L 语义用
 *     fetch 的 redirect:'follow' 顶替。
 *   - 上传二进制必须 Content-Type: application/octet-stream，按表单传会 422。
 *   - 重跑要幂等：Release 已存在就改成 patch 正文；同名资产已存在且字节数一致就跳过，
 *     不一致才删掉重传（GitHub 不允许同名资产）。
 *
 * 用法
 *   node tools/gh-release.cjs                       # 只读体检
 *   node tools/gh-release.cjs --create --body-file docs/release-body-0.2.0.md
 */
const fs = require('node:fs')
const path = require('node:path')
const cp = require('node:child_process')

const OWNER = 'W4nN1ng'
const REPO = 'Atrium'
const TAG = 'v0.2.0'
const NAME = 'Atrium 0.2.0'
const HERE = __dirname
const ROOT = path.resolve(HERE, '..')

const ASSETS = ['dist/Atrium-Setup-0.2.0.exe', 'dist/Atrium-portable-0.2.0.exe']

function die(msg) {
  console.error('✗ ' + msg)
  process.exit(1)
}

/** token：GH_TOKEN 优先，否则问系统的凭证管理器。任何一条路径都不打印内容。 */
function token() {
  const env = (process.env.GH_TOKEN || process.env.GITHUB_TOKEN || '').trim()
  if (env) {
    console.log('  token 来源：环境变量（长度 ' + env.length + '）')
    return env
  }
  const r = cp.spawnSync('git', ['credential', 'fill'], {
    input: 'protocol=https\nhost=github.com\n\n',
    encoding: 'utf8'
  })
  if (r.status !== 0) die('拿不到 git 凭证：' + (r.stderr || '').trim())
  const m = /^password=(.*)$/m.exec(r.stdout || '')
  if (!m || !m[1].trim()) die('git 凭证里没有 password 字段（这台机器可能只存了 ssh key）')
  console.log('  token 来源：系统 git 凭证（长度 ' + m[1].trim().length + '，不打印）')
  return m[1].trim()
}

/** 带重试的请求。返回 {status, json}；网络层失败重试 5 次后 die。 */
async function req(method, url, tok, opts = {}) {
  let lastErr = null
  for (let i = 0; i < 5; i++) {
    try {
      const headers = {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28'
      }
      if (tok) headers.Authorization = 'Bearer ' + tok
      if (opts.json) headers['Content-Type'] = 'application/json'
      if (opts.body) headers['Content-Type'] = 'application/octet-stream'
      const res = await fetch(url, {
        method,
        headers,
        body: opts.json ? JSON.stringify(opts.json) : opts.body,
        redirect: 'follow'
      })
      const text = await res.text()
      let json = null
      try {
        json = text ? JSON.parse(text) : null
      } catch {
        json = { raw: text.slice(0, 400) }
      }
      if (res.status >= 500) {
        lastErr = new Error(method + ' ' + res.status)
        break // 5xx 也重试
      }
      return { status: res.status, json }
    } catch (e) {
      lastErr = e
      const wait = 1500 * (i + 1)
      console.log('  第 ' + (i + 1) + ' 次失败（' + e.message + '），' + wait + 'ms 后重试')
      await new Promise((r) => setTimeout(r, wait))
    }
  }
  die('请求打不通：' + method + ' ' + url + ' —— ' + (lastErr && lastErr.message))
}

/** 正文：去掉开头那行 `# Atrium 0.2.0`（Release 标题已经写过一次了） */
function bodyOf(file) {
  const raw = fs.readFileSync(path.join(ROOT, file), 'utf8')
  const lines = raw.split(/\r?\n/)
  if (lines[0] && lines[0].startsWith('# ')) lines.splice(0, 2)
  const body = lines.join('\n').trim() + '\n'
  console.log('  正文来自 ' + file + '，' + body.length + ' 字符，首行：' + body.split('\n')[0])
  return body
}

async function main() {
  const argv = process.argv.slice(2)
  const create = argv.includes('--create')
  const bi = argv.indexOf('--body-file')
  const bodyFile = bi >= 0 ? argv[bi + 1] : 'docs/release-body-0.2.0.md'

  console.log('仓库 https://api.github.com/repos/' + OWNER + '/' + REPO)
  const tok = token()

  const repo = await req('GET', `https://api.github.com/repos/${OWNER}/${REPO}`, tok)
  if (repo.status !== 200) die('读不到仓库：HTTP ' + repo.status + ' ' + JSON.stringify(repo.json).slice(0, 200))
  console.log(`  ✅ 认证到的账号 ${repo.json.owner && repo.json.owner.login}，私有=${repo.json.private}，` +
    `默认分支=${repo.json.default_branch}，size=${repo.json.size}KB`)

  const tagRef = await req('GET', `https://api.github.com/repos/${OWNER}/${REPO}/git/ref/tags/${TAG}`, tok)
  console.log('  tag ' + TAG + (tagRef.status === 200 ? ' 存在 → ' + tagRef.json.object.sha.slice(0, 8) : ' 不存在（HTTP ' + tagRef.status + '）'))

  let rel = await req('GET', `https://api.github.com/repos/${OWNER}/${REPO}/releases/tags/${TAG}`, tok)
  console.log('  Release(' + TAG + ')：' + (rel.status === 200 ? '已存在 id=' + rel.json.id : '还没有'))

  for (const a of ASSETS) {
    const p = path.join(ROOT, a)
    if (!fs.existsSync(p)) die('产物不存在：' + a + ' → 先 npm run build')
    console.log(`  产物 ${a}  ${(fs.statSync(p).size / 1048576).toFixed(1)} MB`)
  }

  if (!create) {
    console.log('\n只读体检结束（没建 Release、没传任何东西）。要真的发：加 --create，并且先让他点头。')
    return
  }

  const body = bodyOf(bodyFile)
  if (rel.status === 200) {
    const u = await req('PATCH', `https://api.github.com/repos/${OWNER}/${REPO}/releases/${rel.json.id}`, tok, {
      json: { tag_name: TAG, name: NAME, body }
    })
    if (u.status !== 200) die('更新 Release 失败：HTTP ' + u.status + ' ' + JSON.stringify(u.json).slice(0, 300))
    console.log('  ✅ Release 正文已更新 → ' + u.json.html_url)
  } else {
    if (tagRef.status !== 200) die('tag ' + TAG + ' 没推到远端，先 git push origin main --follow-tags')
    const c = await req('POST', `https://api.github.com/repos/${OWNER}/${REPO}/releases`, tok, {
      json: { tag_name: TAG, name: NAME, body, draft: false, prerelease: false, target_commitish: 'main' }
    })
    if (c.status !== 201) die('建 Release 失败：HTTP ' + c.status + ' ' + JSON.stringify(c.json).slice(0, 300))
    rel = { status: 200, json: c.json }
    console.log('  ✅ Release 已创建 → ' + c.json.html_url)
  }

  const uploadUrl = rel.json.upload_url.replace('{name}', '').replace('{label}', '')
  const existing = rel.json.assets || []
  for (const a of ASSETS) {
    const p = path.join(ROOT, a)
    const fileName = path.basename(p)
    const size = fs.statSync(p).size
    const same = existing.find((x) => x.name === fileName)
    if (same && same.size === size) {
      console.log(`  ↷ ${fileName} 已在（${size} 字节，一致），跳过`)
      continue
    }
    if (same) {
      console.log(`  ${fileName} 已存在但字节数不同（远端 ${same.size} / 本地 ${size}）→ 删掉重传`)
      const d = await req('DELETE', `https://api.github.com${same.url.replace(/^https?:\/\/api\.github\.com/, '')}`, tok)
      if (d.status !== 204) console.log('    ⚠ 删除返回 HTTP ' + d.status + '，继续试着传')
    }
    const buf = fs.readFileSync(p)
    const up = await req('POST', `${rel.json.upload_url}?name=${encodeURIComponent(fileName)}`, tok, { body: buf })
    if (up.status !== 201) die('上传失败 ' + fileName + '：HTTP ' + up.status + ' ' + JSON.stringify(up.json).slice(0, 300))
    console.log(`  ✅ 已上传 ${fileName}（${(size / 1048576).toFixed(1)} MB）→ ${up.json.browser_download_url}`)
  }

  const after = await req('GET', `https://api.github.com/repos/${OWNER}/${REPO}/releases/tags/${TAG}`, tok)
  console.log('\n发布页 ' + (after.json && after.json.html_url))
  for (const x of (after.json && after.json.assets) || []) {
    console.log(`  ${x.name}  ${(x.size / 1048576).toFixed(1)} MB  下载数 ${x.download_count}`)
  }
}

main().catch((e) => die(e && e.stack ? e.stack : String(e)))
