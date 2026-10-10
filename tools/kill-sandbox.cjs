/**
 * 只杀从 `dist/win-unpacked`（或 `AVCA_UNPACKED_DIR` 指过去的那个目录）起来的 Atrium，
 * **按 `ExecutablePath` 认人**，装在 `AppData\Local\Programs\Atrium` 的那个真实例一个都不碰。
 *
 * ## 为什么要单独一个脚本
 *
 * `tools/killdev.ps1` 按"进程名 + 完整路径"匹配，够用；但它杀掉的是**所有**从仓库里跑起来的实例。
 * 2026-10-10 那次是反过来：打包版被系统层面锁住（`EBUSY: ... Atrium.exe`），
 * 按名字查不到持有者，`electron-builder` 直接失败，得先确认"到底有没有沙盒实例残留、
 * 有几个是用户自己的"再动手。所以留这么个只读优先、动手前先把两类数量打印出来的小工具。
 *
 *   node tools/kill-sandbox.cjs
 *   AVCA_UNPACKED_DIR='C:\程序\A素材管家\dist-r9b\win-unpacked' node tools/kill-sandbox.cjs
 *
 * ⚠ PowerShell 的控制台码页是 cp936，不带 `[Console]::OutputEncoding=UTF8` 时
 * 中文路径回来是乱码，`startsWith` 永远比不中 → 一个都杀不掉（表现成"目录删不掉 EPERM"）。
 */
const cp = require('node:child_process')
const path = require('node:path')
const ROOT = path.resolve(__dirname, '..')
const UNPACKED = process.env.AVCA_UNPACKED_DIR || path.join(ROOT, 'dist', 'win-unpacked')
const want = UNPACKED.replace(/\\/g, '/').toLowerCase()

const out = cp
  .execFileSync(
    'powershell',
    [
      '-NoProfile',
      '-Command',
      "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Get-CimInstance Win32_Process -Filter \"Name='Atrium.exe'\" | Select-Object ProcessId,ExecutablePath | ConvertTo-Json -Compress"
    ],
    { encoding: 'utf8' }
  )
  .trim()
let list = out ? JSON.parse(out) : []
if (!Array.isArray(list)) list = [list]
const mine = list.filter((p) => String(p.ExecutablePath || '').replace(/\\/g, '/').toLowerCase().startsWith(want))
console.log('沙盒实例 ' + mine.length + ' 个 / 别的实例 ' + (list.length - mine.length) + ' 个（后者不动）')
for (const p of mine) {
  try {
    cp.execFileSync('taskkill', ['/PID', String(p.ProcessId), '/T', '/F'], { stdio: 'ignore' })
  } catch {
    /* 已经退了 */
  }
}
