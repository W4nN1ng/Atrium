/**
 * 创建桌面快捷方式（Atrium）。
 *
 * 为什么要用 Node 生成一份临时 .ps1：这台机器上 PowerShell 5.1 读"无 BOM 的 UTF-8 + 中文字面量"
 * 会解析坏，而项目路径本身含中文。Node 里拼好路径、写成 UTF-8 BOM 的脚本再执行，最稳。
 *
 * 用法：node tools/make-shortcut.cjs
 */
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')

const ROOT = path.resolve(__dirname, '..')
const UNPACKED = path.join(ROOT, 'dist', 'win-unpacked')
const TARGET = path.join(UNPACKED, 'Atrium.exe')
const ICON = path.join(UNPACKED, 'resources', 'icon.ico')

for (const [label, p] of [['Atrium.exe', TARGET], ['icon.ico', ICON]]) {
  if (!fs.existsSync(p)) {
    console.error('缺少 ' + label + '：' + p)
    console.error('→ 先跑 npm run build:dir 生成免安装版')
    process.exit(1)
  }
}

const q = (s) => s.replace(/'/g, "''")

const ps = [
  '$ErrorActionPreference = "Stop"',
  '$desktop = [Environment]::GetFolderPath("Desktop")',
  '$lnkPath = Join-Path $desktop "Atrium.lnk"',
  '$shell = New-Object -ComObject WScript.Shell',
  '$lnk = $shell.CreateShortcut($lnkPath)',
  `$lnk.TargetPath = '${q(TARGET)}'`,
  `$lnk.WorkingDirectory = '${q(UNPACKED)}'`,
  // exe 本身没内嵌图标（打包时关掉了 signAndEditExecutable，因为 winCodeSign 要建符号链接），
  // 所以快捷方式显式指向 icon.ico
  `$lnk.IconLocation = '${q(ICON)},0'`,
  '$lnk.Description = "Atrium - VRChat asset manager"',
  '$lnk.Save()',
  'Write-Output ("created: " + $lnkPath)',
  'Write-Output ("target : " + $lnk.TargetPath)',
  'Write-Output ("icon   : " + $lnk.IconLocation)',
  '$sig = \'[DllImport("shell32.dll", CharSet=CharSet.Auto)] public static extern void SHChangeNotify(int wEventId, int uFlags, IntPtr dwItem1, IntPtr dwItem2);\'',
  '$t = Add-Type -MemberDefinition $sig -Name Notif -Namespace Win -PassThru',
  '[Win.Notif]::SHChangeNotify(0x08000000, 0x1000, [IntPtr]::Zero, [IntPtr]::Zero)',
  'Write-Output "desktop refreshed"'
].join('\r\n')

const tmp = path.join(os.tmpdir(), 'atrium-shortcut.ps1')
// UTF-8 BOM：PS 5.1 靠它才会按 UTF-8 读，中文路径不会被当 GBK 拆坏
fs.writeFileSync(tmp, '\ufeff' + ps, 'utf8')

try {
  const out = execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', tmp], {
    encoding: 'utf8'
  })
  console.log(out.trim())
} catch (e) {
  console.error('建快捷方式失败：' + (e.stderr ? String(e.stderr) : e.message))
  process.exit(1)
}
