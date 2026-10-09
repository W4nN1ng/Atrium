/**
 * 把 7-Zip 的 7z.exe + 7z.dll 抽到 resources/bin，让 RAR/7z 支持自带、不依赖用户装了什么。
 *
 * 为什么不用 7zip-bin 就完事：它只给 7za.exe，而 **7za 不含 RAR 解码器**
 * （规格里 "7zip-bin + node-7z 处理 rar/7z" 这步是行不通的）。
 * 完整 7z.exe + 7z.dll 才有 Rar 处理器。
 *
 * 用法：node tools/fetch-7z.cjs
 */
const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')

const ROOT = path.resolve(__dirname, '..')
const CACHE = path.join(ROOT, 'vendor', 'cache')
const OUT = path.join(ROOT, 'resources', 'bin')
const VERSION = '25.01'
const FILE = '7z2501-x64.exe'
const URLS = [
  `https://7-zip.org/a/${FILE}`,
  `https://github.com/ip7z/7zip/releases/download/${VERSION}/${FILE}`
]
const SEVEN_A = path.join(ROOT, 'node_modules', '7zip-bin', 'win', 'x64', '7za.exe')

async function download(url, dest) {
  const res = await fetch(url, { signal: AbortSignal.timeout(300000), redirect: 'follow' })
  if (!res.ok || !res.body) throw new Error('HTTP ' + res.status)
  const tmp = dest + '.part'
  const ws = fs.createWriteStream(tmp)
  const { Readable } = require('node:stream')
  const { pipeline } = require('node:stream/promises')
  await pipeline(Readable.fromWeb(res.body), ws)
  fs.renameSync(tmp, dest)
  console.log('downloaded', path.basename(dest), (fs.statSync(dest).size / 1048576).toFixed(1) + ' MB')
}

async function main() {
  fs.mkdirSync(CACHE, { recursive: true })
  fs.mkdirSync(OUT, { recursive: true })
  const exe = path.join(CACHE, FILE)
  if (!fs.existsSync(exe)) {
    let lastErr = null
    for (const url of URLS) {
      try {
        await download(url, exe)
        lastErr = null
        break
      } catch (e) {
        lastErr = e
        console.log('failed', url, '->', e.message)
      }
    }
    if (lastErr) throw new Error('所有源都失败：' + lastErr.message)
  } else {
    console.log('cached', FILE)
  }

  const work = path.join(CACHE, '7z-extract')
  fs.rmSync(work, { recursive: true, force: true })
  fs.mkdirSync(work, { recursive: true })
  // 用 7zip-bin 的 7za 解开这个 NSIS 自解压包
  execFileSync(SEVEN_A, ['x', '-y', `-o${work}`, exe], { stdio: 'inherit' })

  const want = ['7z.exe', '7z.dll', '7-zip.dll', '7zr.exe']
  const found = []
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name)
      if (e.isDirectory()) walk(p)
      else if (want.includes(e.name)) found.push(p)
    }
  }
  walk(work)

  if (!found.length) {
    throw new Error('解出来的文件里没有 7z.exe / 7z.dll，看看 ' + work + ' 里到底有什么')
  }
  for (const f of found) {
    const dest = path.join(OUT, path.basename(f))
    fs.copyFileSync(f, dest)
    console.log('installed', path.basename(dest), (fs.statSync(dest).size / 1048576).toFixed(1) + ' MB')
  }

  // 立刻自检：能不能列出 rar
  const seven = path.join(OUT, '7z.exe')
  if (fs.existsSync(seven)) {
    const out = execFileSync(seven, ['i'], { encoding: 'utf8' })
    const hasRar = /Rar/i.test(out)
    console.log('7z.exe 支持的格式里含 RAR：' + (hasRar ? '是 ✓' : '否 ✗'))
    if (!hasRar) throw new Error('这个 7z.exe 不带 RAR 解码器，自带方案不成立')
  }
  console.log('完成。记得 electron-builder 的 extraResources 已经把 resources/bin 带上。')
}

main().catch((e) => {
  console.error('失败：' + e.message)
  console.error('退路：运行时探测用户已装的 7-Zip / WinRAR（这台机器 C:\\Program Files\\WinRAR\\UnRAR.exe 在）')
  process.exit(1)
})
