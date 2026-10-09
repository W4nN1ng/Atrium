/**
 * 只读探针（+ 往 E:\vrc\test 下写一个临时目录）：
 * 证实 / 证伪 `worker.ts` 里 digUnitypackages 的定位方式对嵌套成员是否成立。
 *
 * 代码里的两步是：
 *   抽取：extractZip(file, dest, { only: [member...] })   → unzip.ts 用 safeJoin(destDir, 完整相对路径) 落盘
 *   定位：path.join(dest, path.basename(member))          → 只看最后一段
 * 这个脚本用真实包跑一遍，看两种路径是否相等。不写 C 盘。
 */
const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')

const FILE = process.argv[2] || 'E:\\vrc\\A\\衣服\\衣服TwinkleSpica\\TS_MaterialPack_1.zip'
const OUT = process.argv[3] || 'E:\\vrc\\test\\dig-probe'
const SEVEN = path.resolve(__dirname, '..', 'resources', 'bin', '7z.exe')

const out = execFileSync(SEVEN, ['l', '-slt', '-ba', '--', FILE], {
  encoding: 'utf8',
  maxBuffer: 64 * 1024 * 1024,
  stdio: ['ignore', 'pipe', 'pipe']
})
const members = out
  .split(/\r?\n/)
  .filter((l) => /^Path = /.test(l))
  .map((l) => l.slice(7).trim())
  .filter((n) => n && !/[/\\]$/.test(n))
const ups = members.filter((n) => /\.unitypackage$/i.test(n))

console.log(`包：${FILE}`)
console.log(`成员 ${members.length} 条，其中 .unitypackage ${ups.length} 个：`)
for (const u of ups) console.log('   ', u)
if (!ups.length) {
  console.log('这个包里没有内层包，换一个')
  process.exit(0)
}

fs.rmSync(OUT, { recursive: true, force: true })
fs.mkdirSync(OUT, { recursive: true })

/** 照 extractArchive 的调用形状：只抽这一个成员 */
execFileSync(SEVEN, ['x', `-o${OUT}`, '-y', '--', FILE, ...ups], {
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'pipe']
})

function tree(dir, base = dir) {
  const out = []
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const f = path.join(dir, e.name)
    if (e.isDirectory()) out.push(...tree(f, base))
    else out.push(path.relative(base, f).replace(/\\/g, '/') + `   (${fs.statSync(f).size} B)`)
  }
  return out
}
console.log(`\n抽到 ${OUT} 之后，磁盘上实际长这样：`)
for (const t of tree(OUT)) console.log('   ', t)

console.log('\n两种定位法各自会去找哪条路径（存在吗）：')
for (const u of ups) {
  const asBasename = path.join(OUT, path.basename(u))
  const asRelative = path.join(OUT, u.replace(/\\/g, path.sep))
  console.log(`   成员 ${u}`)
  console.log(`      basename 定位 → ${asBasename}  ${fs.existsSync(asBasename) ? '✓ 找得到' : '✗ 找不到（现在的代码走这条）'}`)
  console.log(`      relPath 定位  → ${asRelative}  ${fs.existsSync(asRelative) ? '✓ 找得到' : '✗ 找不到'}`)
}
fs.rmSync(OUT, { recursive: true, force: true })
