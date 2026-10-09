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
 *   - ⚠ **upload_url 带 URI 模板**（`…/releases/{id}/assets{?name,label}`），必须先把 `{…}` 剥掉再拼 `?name=`。
 *     不剥的话 GitHub 回 `400 Multipart form data required`，换 multipart 打法回 `422 Bad Size` ——
 *     **两句报错都在把人往 Content-Type 上带，其实和打法无关**（2026-10-09 第一次真发就在这儿绕了一圈，
 *     最后拿 2 KB 探针打在草稿 Release 上、打完删草稿才定位到）。裸字节 + octet-stream 是通的。
 *   - 重跑要幂等：Release 已存在就改成 patch 正文；同名资产已存在且字节数一致就跳过。
 *   - ⚠ **换掉已经公开发布过的二进制必须显式带 `--replace-assets`**，只想改正文带 `--body-only`。
 *     2026-10-09 就是"只想更新正文"跑了一遍，工具按"字节数不一致 → 删掉重传"把发布页上的
 *     Setup 换成了另一个构建，而正文里的指纹还写着旧的那串 —— 页面当场自相矛盾。
 *   - ⚠ 这台机器上 `fetch failed` **不等于请求没到 GitHub**。今天就撞过：两次报网络失败，
 *     其实第一次已经落库，后面两次被 `already_exists` 挡回，脚本却判成"上传失败"。
 *     所以失败之后先回查远端字节数，对得上就算成功（代码里做了）。
 *
 * 用法
 *   node tools/gh-release.cjs                       # 只读体检
 *   node tools/gh-release.cjs --create --body-only  # 只改正文
 *   node tools/gh-release.cjs --create              # 正文 + 补缺失的资产（不一致会停下）
 *   node tools/gh-release.cjs --create --replace-assets   # 明确要换已发布的包
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
        /** GitHub 对没有 User-Agent 的写请求直接 403（"Request forbidden by administrative rules"） */
        'User-Agent': 'atrium-release-tool',
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

/**
 * 传一个资产。两种打法按顺序试，**第一个 201 的就停下**：
 *   raw  —— 官方文档那种：body 是裸字节 + `Content-Type: application/octet-stream`
 *   form —— multipart 表单（字段名 `file`）
 * 2026-10-09 第一次真发这台机器上 raw 被回 `400 {"message":"Multipart form data required"}`
 * （`Content-Type` 明明设对了），所以留了这条兜底而不是赌一种打法。
 * 返回 { ok, method, json }；两种都失败才 ok=false。
 */
async function uploadAsset(tok, rawUploadUrl, fileName, buf) {
  /**
   * ⚠ **必须先剥掉 URI 模板**。API 给的 upload_url 长这样：
   *   https://uploads.github.com/repos/<o>/<r>/releases/<id>/assets{?name,label}
   * 直接往后面拼 `?name=x` 会打成 `assets{?name,label}?name=x`，
   * GitHub 回的却是 `400 Multipart form data required`（multipart 打法回 `422 Bad Size`）——
   * **两句报错都在把人往错的方向带**。2026-10-09 第一次真发就卡在这儿，
   * 拿 2 KB 探针打在草稿上、把模板剥掉立刻 201，才确认和 Content-Type、和打法都无关。
   */
  const uploadUrl = rawUploadUrl.replace(/\/assets\{[^}]*\}/, '/assets').replace(/\{[^}]*\}/g, '')
  const target = uploadUrl + '?name=' + encodeURIComponent(fileName)
  const tries = [
    {
      method: 'raw',
      headers: { Authorization: 'Bearer ' + tok, 'User-Agent': 'atrium-release-tool', 'Content-Type': 'application/octet-stream' },
      body: buf
    },
    {
      method: 'form',
      headers: { Authorization: 'Bearer ' + tok, 'User-Agent': 'atrium-release-tool' },
      // 不设 Content-Type：FormData 自己带 boundary，手设会把 boundary 冲掉
      body: (() => {
        const fd = new FormData()
        fd.append('file', new Blob([buf], { type: 'application/octet-stream' }), fileName)
        return fd
      })()
    }
  ]
  let last = null
  for (const t of tries) {
    let res = null
    for (let i = 0; i < 3; i++) {
      try {
        res = await fetch(uploadUrl + '?name=' + encodeURIComponent(fileName), {
          method: 'POST',
          headers: t.headers,
          body: t.body,
          redirect: 'follow'
        })
        break
      } catch (e) {
        console.log('    上传第 ' + (i + 1) + ' 次网络失败（' + e.message + '），重试')
        await new Promise((r) => setTimeout(r, 2000 * (i + 1)))
      }
    }
    if (!res) continue
    const text = await res.text()
    let json = null
    try {
      json = text ? JSON.parse(text) : null
    } catch {
      json = { raw: text.slice(0, 300) }
    }
    console.log('    ' + t.method + ' → HTTP ' + res.status + (res.status === 201 ? ' ✅' : ' ' + JSON.stringify(json).slice(0, 160)))
    if (res.status === 201) return { ok: true, method: t.method, json }
    last = { method: t.method, json }
  }
  return { ok: false, json: last && last.json }
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
  /** 只改正文，一个资产都不碰（2026-10-09 之后必须有这一档，理由见文件头纪律第 6 条） */
  const bodyOnly = argv.includes('--body-only')
  /** 换掉已经公开发布过的二进制，要显式说一声 */
  const replaceAssets = argv.includes('--replace-assets')
  const bi = argv.indexOf('--body-file')
  const bodyFile = bi >= 0 ? argv[bi + 1] : 'docs/release-body-0.2.0.md'

  console.log('仓库 https://api.github.com/repos/' + OWNER + '/' + REPO)
  const fails = []
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

  const existing = rel.json.assets || []
  if (bodyOnly) {
    console.log('  （--body-only：只改正文，一个资产都没碰）')
    for (const x of existing) console.log(`    挂着的是 ${x.name} ${x.size} 字节 ${x.digest || ''}`)
    return
  }
  const used = []
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
      if (!replaceAssets) {
        console.log(`  ⛔ ${fileName} 远端是 ${same.size} 字节、本地 ${size} 字节 —— **这是已经公开发布过的二进制**，`)
        console.log('     删掉重传会让"下载页上那份"和"正文里那串指纹"对不上，还可能删完了传不上去（今天就撞过一次）。')
        console.log('     确认要换：加 --replace-assets。只想改正文：加 --body-only。')
        fails.push(fileName + ' 与远端不一致，没动')
        continue
      }
      console.log(`  ${fileName} 已存在但字节数不同（远端 ${same.size} / 本地 ${size}）→ 删掉重传`)
      const d = await req('DELETE', `https://api.github.com${same.url.replace(/^https?:\/\/api\.github\.com/, '')}`, tok)
      if (d.status !== 204) console.log('    ⚠ 删除返回 HTTP ' + d.status + '，继续试着传')
    }
    console.log(`  传 ${fileName}（${(size / 1048576).toFixed(1)} MB）…`)
    const buf = fs.readFileSync(p)
    let up = await uploadAsset(tok, rel.json.upload_url, fileName, buf)
    /**
     * 这台机器上 `fetch failed` 不等于"请求没到 GitHub"—— 2026-10-09 就是：两次报网络失败，
     * 其实第一次已经落库，于是后面两次都被 `already_exists` 挡回来，而脚本以为"传失败了"。
     * 所以失败之后**先回去看一眼远端**，字节数对得上就当成功。
     */
    if (!up.ok && /already_exists/.test(JSON.stringify(up.json || {}))) {
      const re = await req('GET', `https://api.github.com/repos/${OWNER}/${REPO}/releases/tags/${TAG}`, tok)
      const now = ((re.json && re.json.assets) || []).find((x) => x.name === fileName)
      if (now && now.size === size) {
        console.log('  ⚠ 报 already_exists，但远端这份的字节数与本地一致 → 判为**已经传上去了**')
        up = { ok: true, method: '（上一轮网络报错但其实已落库）', json: now }
      }
    }
    if (!up.ok) {
      fails.push(fileName + ' 上传失败')
      console.error('  ❌ 上传失败 ' + fileName + '：' + JSON.stringify(up.json).slice(0, 300))
      continue
    }
    used.push(fileName + '=' + up.method)
    console.log(`  ✅ 已上传 ${fileName}（用 ${up.method} 那种打法）→ ${up.json.browser_download_url}`)
  }
  if (used.length) console.log('  上传打法：' + used.join('、'))

  const after = await req('GET', `https://api.github.com/repos/${OWNER}/${REPO}/releases/tags/${TAG}`, tok)
  console.log('\n发布页 ' + (after.json && after.json.html_url))
  for (const x of (after.json && after.json.assets) || []) {
    console.log(`  ${x.name}  ${(x.size / 1048576).toFixed(1)} MB  ${x.digest || ''}  下载数 ${x.download_count}`)
  }
  if (fails.length) {
    console.log('\n红 ' + fails.length + ' 条：' + fails.join('；'))
    process.exit(1)
  }
}

main().catch((e) => die(e && e.stack ? e.stack : String(e)))
