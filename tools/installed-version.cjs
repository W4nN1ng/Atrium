#!/usr/bin/env node
/**
 * 读**这台机器上装着的 Atrium 到底是哪个版本** —— 答案只从注册表来。
 *
 * ## 为什么专门写这个工具
 *
 * 他 2026-10-10 定的收尾规矩（`docs/PROMPT-R10-BUGFIX.md` §6）：一轮结束时本机 Atrium 必须是最新的，
 * 而**报版本必须报注册表的 `DisplayVersion`，不许看 exe 的文件属性** ——
 * 那个属性是 Electron 的 `33.4.11`，不是应用版本（这条踩过一次）。
 * 也别用"起一下看看"去问：打包版 Electron 不认 `--version`，它会按普通启动跑起来、
 * 带着他的真数据目录（2026-10-09 撞过两次，见 `tools/pkg-version.cjs` 头部那段注释）。
 *
 * `reg.exe` 的中文输出按 ANSI 码页来，直接 capture 会变问号；所以这里**只取 ASCII 字段**，
 * 并且用 `-Encoding` 无关的方式按行找 `REG_SZ` 后面的值。
 *
 *   node tools/installed-version.cjs                 # 打出来装的是哪个版本
 *   node tools/installed-version.cjs --expect=0.4.0  # 对不上就 exit 1（收尾闸门用这条）
 */
const cp = require('node:child_process')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..')
const UNINSTALL = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall'

function reg(args) {
  let buf = Buffer.alloc(0)
  try {
    buf = cp.execFileSync('reg.exe', args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
  } catch (e) {
    /** reg.exe 找不到键时返回非 0，输出仍然在 e.stdout 里（也可能什么都没有） */
    buf = (e && e.stdout) || Buffer.alloc(0)
  }
  /**
   * ⚠ `reg.exe` **被重定向时输出的是 UTF-16LE**（在控制台里看是 ANSI/GBK）。
   * 按 utf8 读回来每个字符后面都跟一个 0x00，`/^HKEY_/` 一条都匹配不上 ——
   * 表现就是"注册表里找不到 Atrium"，而它明明装着。看到 0x00 就当 UTF-16 解。
   */
  if (!buf.length) return ''
  const isUtf16 = buf.length > 2 && buf[1] === 0 && buf[3] === 0
  return (isUtf16 ? buf.toString('utf16le') : buf.toString('utf8'))
}

/** `HKCU` / `HKLM` 是简写，`reg.exe` 打出来的是 `HKEY_CURRENT_USER` / `HKEY_LOCAL_MACHINE` ——
 *  拿简写去 `startsWith` 会一条都不匹配（第一版就这么"找不到 Atrium"，而它明明装着）。 */
function longForm(hive) {
  return hive.replace(/^HKCU\\/i, 'HKEY_CURRENT_USER\\').replace(/^HKLM\\/i, 'HKEY_LOCAL_MACHINE\\')
}

/** `reg query <父键>` 的输出里，每一行以父键路径开头的就是子键 */
function subkeys(parent) {
  const want = longForm(parent).toUpperCase()
  const out = reg(['query', parent])
  return out
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => /^HKEY_/i.test(l) && l.toUpperCase().startsWith(want))
}

function valuesOf(keyPath) {
  const out = reg(['query', keyPath])
  const v = {}
  for (const line of out.split(/\r?\n/)) {
    const m = /^\s{4}(\S+)\s+REG_(?:SZ|DWORD|MULTI_SZ)\s+(.*)$/.exec(line)
    if (m) v[m[1]] = m[2].trim()
  }
  return v
}

function installed() {
  const found = []
  for (const hive of [UNINSTALL, 'HKLM\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall', 'HKLM\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall']) {
    for (const k of subkeys(hive)) {
      const v = valuesOf(k)
      const name = v.DisplayName || ''
      if (!/atrium/i.test(name) && !/atrium/i.test(k)) continue
      found.push({ hive: k, DisplayName: name, DisplayVersion: v.DisplayVersion || null, Publisher: v.Publisher || null, InstallLocation: v.InstallLocation || null })
    }
  }
  return found
}

const arg = (process.argv.find((a) => a.startsWith('--expect=')) || '').split('=')[1]
const list = installed()
if (!list.length) {
  console.log('⛔ 注册表里找不到 Atrium 的卸载项 —— 这台机器可能装的是免安装版（dist\\win-unpacked），或者根本没装')
  process.exit(1)
}
for (const it of list) {
  console.log(`  DisplayName    : ${it.DisplayName}`)
  console.log(`  DisplayVersion : ${it.DisplayVersion}`)
  console.log(`  InstallLocation: ${it.InstallLocation}`)
  console.log(`  键：${it.hive}`)
}

if (arg) {
  const repo = require(path.join(ROOT, 'package.json')).version
  console.log(`\n仓库 package.json 写的是 ${repo}，期望注册表是 ${arg}`)
  const hit = list.some((x) => x.DisplayVersion === arg)
  if (!hit) {
    console.log('⛔ 注册表里没有这个版本 —— 本机装的还不是它')
    process.exit(1)
  }
  if (repo !== arg) console.log('⚠ 期望值和仓库版本不一致（包是拿哪个 package.json 打的，自己确认一下）')
  console.log(`✅ 本机 Atrium 现在确实是 v${arg}`)
}
