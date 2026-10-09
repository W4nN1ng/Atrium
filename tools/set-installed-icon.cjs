/**
 * 把仓库里画好的图标换进**已安装的那一份**，并把两条快捷方式的图标指过去。
 *
 * 为什么需要这个工具：安装器现在装不上（覆盖安装报退出码 2，见 docs/VERIFY-UNVERIFIED.md §13），
 * 而图标这件事不该等它。装好的程序读的是 `<安装目录>\resources\icon.{ico,png}`
 * （electron-builder 的 extraResources 拷进去的），窗口和托盘图标运行时也从那儿取，
 * 所以直接换这两个文件 + 改 .lnk 的 IconLocation，桌面/任务栏/窗口/托盘就都是新的了。
 *
 * 这只治本机这一份。**别人装的 Setup 里还是旧图标**，直到安装器修好、重出包为止。
 *
 * 用法：node tools/set-installed-icon.cjs
 *      （`--dry` 只报要改什么，不动文件）
 */
const fs = require('node:fs')
const path = require('path')
const cp = require('node:child_process')
const crypto = require('node:crypto')

const ROOT = path.resolve(__dirname, '..')
const DRY = process.argv.includes('--dry')
const INST = path.join(process.env.LOCALAPPDATA, 'Programs', 'Atrium')
const RES = path.join(INST, 'resources')
const ICO = path.join(RES, 'icon.ico')

const h = (p) => (fs.existsSync(p) ? crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex').slice(0, 12) : '(不存在)')

if (!fs.existsSync(RES)) {
  console.error('⛔ 没找到安装目录：' + RES + '（这台机器还没装过？）')
  process.exit(1)
}

for (const f of ['icon.ico', 'icon.png']) {
  const src = path.join(ROOT, 'build', f)
  const dst = path.join(RES, f)
  const from = h(dst)
  const to = h(src)
  console.log(`${f}：${from} → ${to}${from === to ? '（已经是新的，跳过）' : ''}`)
  if (from === to || DRY) continue
  fs.copyFileSync(src, dst)
}

if (DRY) {
  console.log('（--dry：没动文件，也没动快捷方式）')
  process.exit(0)
}

/**
 * .lnk 只能走 PowerShell 的 WScript.Shell COM。
 * 写成临时 .ps1 再执行，是因为这台机器上 PowerShell 5.1 读"无 BOM 的 UTF-8 + 中文"会解析坏，
 * 而且路径里有中文目录名 —— 命令行内联传中文同样不可靠（tools/make-shortcut.cjs 是同样的理由）。
 */
const LNK = [
  path.join(process.env.USERPROFILE, 'Desktop', 'Atrium.lnk'),
  path.join(process.env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Atrium.lnk')
]

const ps = [
  '$ErrorActionPreference = "Stop"',
  `$ico = '${ICO.replace(/'/g, "''")}'`,
  '$sh = New-Object -ComObject WScript.Shell'
]
for (const p of LNK) {
  const q = p.replace(/'/g, "''")
  ps.push(`if (Test-Path '${q}') {`)
  ps.push(`  $l = $sh.CreateShortcut('${q}')`)
  ps.push(`  $l.IconLocation = "$ico,0"`)
  ps.push('  $l.Save()')
  ps.push(`  Write-Output ("已改 " + (Split-Path '${q}' -Leaf) + " -> " + $l.IconLocation)`)
  ps.push('} else {')
  ps.push(`  Write-Output ("没有这个快捷方式，跳过：${q}")`)
  ps.push('}')
}
// 让 shell 重读图标缓存，不然桌面上可能还挂着旧的那张
ps.push('ie4uinit.exe -show | Out-Null')

const tmp = path.join(process.env.TEMP, 'avca-set-icon.ps1')
fs.writeFileSync(tmp, '﻿' + ps.join('\n'), 'utf8')
try {
  console.log(cp.execFileSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', tmp], { encoding: 'utf8' }).trim())
} finally {
  fs.unlinkSync(tmp)
}

console.log('\n核对：')
console.log('  resources/icon.ico =', h(ICO), ' 仓库 build/icon.ico =', h(path.join(ROOT, 'build', 'icon.ico')))
