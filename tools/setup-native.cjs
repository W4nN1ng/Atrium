/**
 * 原生依赖安装脚本（这台机器专用，绕开 GitHub）。
 *
 * 背景（已实测）：
 *  - github.com 的 release 资源在这台机器上直接超时 → Electron 本体、better-sqlite3 预编译包
 *    这两个默认下载源都拿不到；
 *  - 本机有 VS2022 的 MSVC 但没有 Windows SDK（C:/Program Files (x86)/Windows Kits/10 不存在）
 *    → 源码编译这条路也走不通；
 *  - registry.npmjs.org 取整份 packument 会超时（实测 136 秒），所以 .npmrc 固定走 npmmirror；
 *  - npmmirror 上有 electron-v33.4.11-win32-x64.zip，也有 better-sqlite3 12.4.1 的
 *    node-v137（系统 Node 24，跑 vitest 用）和 electron-v130（Electron 33，跑应用用）。
 *
 * 用法：
 *   node tools/setup-native.cjs all        # 首次配置（Electron 本体 + Electron 版 .node）
 *   node tools/setup-native.cjs electron   # 切到 Electron 版 .node（npm run dev / build 前）
 *   node tools/setup-native.cjs node       # 切到 Node 版 .node（vitest 用）
 */
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { pipeline } = require('node:stream/promises')
const { Readable } = require('node:stream')

const ROOT = path.resolve(__dirname, '..')
const NM = path.join(ROOT, 'node_modules')
const VENDOR = path.join(ROOT, 'vendor')
const CACHE = path.join(VENDOR, 'cache')
const PREBUILDS = path.join(VENDOR, 'prebuilds')

const SQLITE_VERSION = '12.4.1'
const SQLITE_MIRROR = 'https://registry.npmmirror.com/-/binary/better-sqlite3'
const ELECTRON_MIRRORS = [
  'https://registry.npmmirror.com/-/binary/electron',
  'https://cdn.npmmirror.com/binaries/electron'
]

function log(msg) {
  console.log('[setup-native] ' + msg)
}

function ensureDirs() {
  for (const d of [VENDOR, CACHE, PREBUILDS]) fs.mkdirSync(d, { recursive: true })
}

async function download(url, dest) {
  if (fs.existsSync(dest) && fs.statSync(dest).size > 1024) {
    log('cached ' + path.basename(dest))
    return dest
  }
  log('GET ' + url)
  const res = await fetch(url, { signal: AbortSignal.timeout(900000), redirect: 'follow' })
  if (!res.ok || !res.body) {
    try {
      fs.existsSync(dest) && fs.rmSync(dest)
    } catch {}
    throw new Error('HTTP ' + res.status + ' for ' + url)
  }
  const tmp = dest + '.part'
  await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(tmp))
  fs.renameSync(tmp, dest)
  log('saved ' + path.relative(ROOT, dest) + ' (' + (fs.statSync(dest).size / 1048576).toFixed(1) + ' MB)')
  return dest
}

/**
 * yauzl 懒枚举解压：每写完一个条目必须再 readEntry()，否则只会解出第一个文件。
 * （上一版就是漏了这一步，导致 dist 里只有 LICENSES.chromium.html 还报"成功"）
 */
async function extractZip(zipPath, destDir) {
  const yauzl = require('yauzl')
  fs.mkdirSync(destDir, { recursive: true })
  await new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true }, (err, zipfile) => {
      if (err) return reject(err)
      let entries = 0
      zipfile.on('entry', (entry) => {
        const target = path.join(destDir, entry.fileName)
        const rel = path.relative(destDir, target)
        if (rel.startsWith('..') || path.isAbsolute(rel)) {
          entries++
          return zipfile.readEntry()
        }
        if (/[\/\\]$/.test(entry.fileName)) {
          fs.mkdirSync(target, { recursive: true })
          entries++
          return zipfile.readEntry()
        }
        fs.mkdirSync(path.dirname(target), { recursive: true })
        zipfile.openReadStream(entry, (e, stream) => {
          if (e) return reject(e)
          const ws = fs.createWriteStream(target)
          stream.on('error', reject)
          ws.on('error', reject)
          ws.on('close', () => {
            entries++
            zipfile.readEntry()
          })
          stream.pipe(ws)
        })
      })
      zipfile.on('end', () => {
        log('解压完成，条目数 ' + entries)
        resolve()
      })
      zipfile.on('error', reject)
      zipfile.readEntry()
    })
  })
}

/** 从预编译 tar.gz 里取 build/Release/better_sqlite3.node */
async function extractSqliteNode(tgzPath, outPath) {
  const tar = require('tar')
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'avca-bs-'))
  try {
    await tar.x({ file: tgzPath, cwd: tmp, strict: false })
    const found = []
    const walk = (dir) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name)
        if (e.isDirectory()) walk(p)
        else if (e.name === 'better_sqlite3.node') found.push(p)
      }
    }
    walk(tmp)
    if (!found.length) throw new Error('better_sqlite3.node 不在 tarball 里: ' + tgzPath)
    fs.mkdirSync(path.dirname(outPath), { recursive: true })
    fs.copyFileSync(found[0], outPath)
    return outPath
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
}

function electronVersion() {
  return require(path.join(NM, 'electron', 'package.json')).version
}

function electronAbi(version) {
  const abi = require('node-abi')
  const got = abi.getAbi(version, 'electron')
  if (!got) throw new Error('node-abi 不认识 Electron ' + version)
  return got
}

async function ensureElectronDist() {
  const distDir = path.join(NM, 'electron', 'dist')
  const exe = path.join(distDir, 'electron.exe')
  if (fs.existsSync(exe)) {
    log('electron.exe 已就位')
    return
  }
  const version = electronVersion()
  let zipPath = null
  let lastErr = null
  for (const base of ELECTRON_MIRRORS) {
    for (const dir of ['v' + version, version]) {
      const name = `electron-v${version}-win32-x64.zip`
      try {
        zipPath = await download(`${base}/${dir}/${name}`, path.join(CACHE, name))
      } catch (e) {
        lastErr = e
      }
      if (zipPath) break
    }
    if (zipPath) break
  }
  if (!zipPath) throw new Error('Electron 发行包下载失败：' + (lastErr && lastErr.message))
  log('解压 Electron 到 node_modules/electron/dist（约 200 个条目，稍等）')
  await extractZip(zipPath, distDir)
  fs.writeFileSync(path.join(NM, 'electron', 'path.txt'), 'electron.exe', 'utf8')
  if (!fs.existsSync(exe)) {
    throw new Error('解压后仍找不到 electron.exe（请检查 zip 内容）')
  }
}

async function stageSqlitePrebuilt(runtime, abi) {
  const name = `better-sqlite3-v${SQLITE_VERSION}-${runtime}-v${abi}-win32-x64.tar.gz`
  const nodeFile = path.join(PREBUILDS, `${runtime}-v${abi}.node`)
  if (!fs.existsSync(nodeFile)) {
    const tgz = path.join(CACHE, name)
    if (!fs.existsSync(tgz)) await download(`${SQLITE_MIRROR}/v${SQLITE_VERSION}/${name}`, tgz)
    await extractSqliteNode(tgz, nodeFile)
  }
  return nodeFile
}

async function installSqliteFor(runtime, abi) {
  const src = await stageSqlitePrebuilt(runtime, abi)
  const destDir = path.join(NM, 'better-sqlite3', 'build', 'Release')
  fs.mkdirSync(destDir, { recursive: true })
  const dest = path.join(destDir, 'better_sqlite3.node')
  try {
    fs.copyFileSync(src, dest)
  } catch (e) {
    const code = e && e.code ? e.code : ''
    if (code === 'EBUSY' || code === 'EPERM' || code === 'EACCES') {
      throw new Error(
        'better_sqlite3.node 被占用了（Windows 会锁住已加载的模块）。' +
          '先跑 powershell -File tools/killdev.ps1 停掉正在运行的 A，再重试。当前想装的是 ' +
          runtime +
          '-v' +
          abi
      )
    }
    throw e
  }
  log(`better-sqlite3 -> ${runtime}-v${abi} (${(fs.statSync(dest).size / 1048576).toFixed(1)} MB)`)
  return dest
}

/** 真的 require 一次，确认 .node 能被当前 runtime 加载 */
function verifyUnderNode() {
  delete require.cache[require.resolve(path.join(NM, 'better-sqlite3'))]
  const Database = require(path.join(NM, 'better-sqlite3'))
  const db = new Database(':memory:')
  db.exec('CREATE TABLE t(x)')
  db.prepare('INSERT INTO t VALUES (?)').run(1)
  const n = db.prepare('SELECT COUNT(*) AS n FROM t').get().n
  db.close()
  if (Number(n) !== 1) throw new Error('better-sqlite3 自检失败')
  log('better-sqlite3 在当前 Node 下可加载 ✓')
}

async function main() {
  const mode = process.argv[2] || 'all'
  ensureDirs()
  const nodeAbi = Number(process.versions.modules)

  if (mode === 'electron' || mode === 'all') {
    await ensureElectronDist()
    const version = electronVersion()
    const abi = electronAbi(version)
    await installSqliteFor('electron', abi)
    fs.writeFileSync(
      path.join(PREBUILDS, 'active.json'),
      JSON.stringify({ runtime: 'electron', abi, electronVersion: version }, null, 2)
    )
    log(`OK：Electron ${version} / ABI ${abi}，可以 npm run dev`)
    log('（注意：此时 node_modules 里的 .node 是 Electron 版，直接跑 npm test 会失败，先跑 npm run native:node）')
  } else if (mode === 'node') {
    await installSqliteFor('node', nodeAbi)
    fs.writeFileSync(
      path.join(PREBUILDS, 'active.json'),
      JSON.stringify({ runtime: 'node', abi: nodeAbi }, null, 2)
    )
    verifyUnderNode()
    log(`OK：Node ${process.version} / ABI ${nodeAbi}，可以 npm test`)
  } else {
    throw new Error('未知参数：' + mode)
  }
}

main().catch((e) => {
  console.error('[setup-native] 失败：' + e.message)
  console.error('  → 若镜像上没有对应 ABI 的预编译包，运行 node tools/probe3.cjs 看有哪些变体，')
  console.error('    再调整 package.json 里 better-sqlite3 / electron 的版本。')
  process.exit(1)
})
