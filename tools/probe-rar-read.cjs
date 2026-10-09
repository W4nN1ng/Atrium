/**
 * 只读探针：M5-B 的"能不能读 rar"这条不是假设 —— 拿真库里真实的 .rar 逐个问 A 自带的 7z。
 * 用法：node tools/probe-rar-read.cjs [N]
 */
const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')

const LIB = 'E:\\vrc\\A'
const SEVEN = path.resolve(__dirname, '..', 'resources', 'bin', '7z.exe')
const N = Number(process.argv[2] || 99)

const rars = []
;(function w(dir, depth) {
  if (depth < 0 || rars.length >= N) return
  let ents
  try {
    ents = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const e of ents) {
    if (rars.length >= N) return
    const f = path.join(dir, e.name)
    if (e.isDirectory()) w(f, depth - 1)
    else if (/\.rar$/i.test(e.name)) rars.push(f)
  }
})(LIB, 8)

const UP_RE = /\.unitypackage$/i

function list(file) {
  const out = execFileSync(SEVEN, ['l', '-slt', '-ba', '--', file], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe']
  })
  return out
    .split(/\r?\n/)
    .filter((l) => /^Path = /.test(l))
    .map((l) => l.slice(7).trim())
    .filter((n) => n && !n.includes('=') && !/[/\\]$/.test(n))
    .filter((n) => path.normalize(n) !== path.normalize(file))
}

let ok = 0
let enc = 0
let bad = 0
let withUp = 0
console.log(`库里找到 ${rars.length} 个 .rar（上限 ${N}），用 ${path.basename(SEVEN)} 列清单：\n`)
for (const f of rars) {
  const mb = (fs.statSync(f).size / 1048576).toFixed(0)
  try {
    const names = list(f)
    const ups = names.filter((n) => UP_RE.test(n))
    if (ups.length) withUp++
    ok++
    console.log(`  ✓ ${String(names.length).padStart(4)} 成员 ${ups.length ? `含 ${ups.length} 个包` : '无内层包    '} ${mb.padStart(4)} MB  ${path.basename(f).slice(0, 46)}`)
  } catch (e) {
    const msg = String(e && e.stdout ? e.stdout : (e && e.message) || '')
    if (/wrong password|encrypted|corrupt/i.test(msg)) {
      enc++
      console.log(`  🔒 加密/需密码              ${mb.padStart(4)} MB  ${path.basename(f).slice(0, 46)}`)
    } else {
      bad++
      console.log(`  ✗ 列不出来                  ${mb.padStart(4)} MB  ${path.basename(f).slice(0, 46)}  ${msg.replace(/\s+/g, ' ').slice(0, 60)}`)
    }
  }
}
console.log(`\n小结：能列 ${ok} 个（其中 ${withUp} 个内含 .unitypackage）、加密 ${enc} 个、失败 ${bad} 个`)
console.log(`对照：7za.exe（7zip-bin 自带）**不含 RAR 解码器**，所以这条只能用 resources/bin/7z.exe + 7z.dll`)
