#!/usr/bin/env node
/**
 * M7 · 首启向导活体的夹具（第 7 轮 ④/⑧）。
 *
 * ## 为什么单独一个造树工具
 *
 * 向导第 ③ 步要的是"发现一批 Unity 工程"，而这台机器上真正的 8 个工程在 `E:\ALCOMprojects` ——
 * **一个都不许拿来测**。所以沙盒里要自己造三个假工程，并且把 `LOCALAPPDATA` 里的
 * VCC/ALCOM 清单也换成只写这三个的假清单（发现链优先读环境变量指过去的那份，
 * `bridge-ask-wiring.spec.ts` 的夹具就是这么办的）。
 *
 * ## 造出来的形状
 *
 * ```
 * D:\avca-m7-live\
 *   AppData\                       AVCA_APP_HOME（settings.json / library.db / logs…）
 *   LocalAppData\VRChatCreatorCompanion\settings.json   假 VCC 清单：只列下面三个
 *   projects\Alpha-M7LiveTest\     ProjectSettings\ProjectVersion.txt + Assets\
 *   projects\Beta-M7LiveTest\
 *   projects\Gamma-M7LiveTest\
 *   oldlib\                        "已经有素材的目录"：3 个顶层目录 + 2 个 .unitypackage + 1 个 .txt
 *   watched\                       第 ② 步要加的监视文件夹
 * ```
 *
 * ## 红线
 *
 * 根目录名里必须有 `m7` 或 `avca`，否则拒绝执行 —— 这个工具会**删** `AppData` 与 `projects`，
 * 指错地方就是删用户的库（`services/paths.ts` 头部记过一次真事故）。
 *
 * 用法：
 *   node tools/make-m7-live-tree.cjs            # 造（存在就覆盖内容）
 *   node tools/make-m7-live-tree.cjs --fresh    # 先删干净再造（模拟全新安装）
 *   node tools/make-m7-live-tree.cjs --print    # 只打路径，不写盘
 */
const fs = require('node:fs')
const path = require('node:path')

const ROOT = process.env.AVCA_M7_ROOT || 'D:\\avca-m7-live'
const FRESH = process.argv.includes('--fresh')
const PRINT = process.argv.includes('--print')

if (!/avca|m7/i.test(ROOT)) {
  console.error('[m7-tree] 拒绝执行：根目录里没有 avca/m7 字样 → ' + ROOT)
  process.exit(2)
}

const P = {
  root: ROOT,
  appHome: path.join(ROOT, 'AppData'),
  local: path.join(ROOT, 'LocalAppData'),
  vcc: path.join(ROOT, 'LocalAppData', 'VRChatCreatorCompanion', 'settings.json'),
  projects: path.join(ROOT, 'projects'),
  oldlib: path.join(ROOT, 'oldlib'),
  watched: path.join(ROOT, 'watched')
}

const PROJECTS_BASE = ['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon', 'Zeta', 'Eta', 'Theta', 'Iota']
/**
 * 默认 3 个（④ 那次），⑧ 的第 6 条要的是"一次冒一批" —— 他真机第一轮是 8 个，
 * 所以 `AVCA_M7_PROJECT_COUNT=8` 造 8 个假工程。名字一律带 `-M7LiveTest` 后缀，
 * `fake-unity-live.cjs` 的防呆认这个后缀。
 */
const COUNT = Math.max(1, Math.min(PROJECTS_BASE.length, Number(process.env.AVCA_M7_PROJECT_COUNT || 3) || 3))
const PROJECTS = PROJECTS_BASE.slice(0, COUNT).map((n) => `${n}-M7LiveTest`)
const UNITY_VERSION = 'm_EditorVersion: 2022.3.22f1'

function rmrf(p) {
  try {
    fs.rmSync(p, { recursive: true, force: true })
  } catch (e) {
    console.error('[m7-tree] 删不掉 ' + p + '：' + e.message)
  }
}

function write(p, content) {
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, content, 'utf8')
}

function makeProject(name) {
  const dir = path.join(P.projects, name)
  fs.mkdirSync(path.join(dir, 'Assets'), { recursive: true })
  write(path.join(dir, 'ProjectSettings', 'ProjectVersion.txt'), UNITY_VERSION + '\n')
  /** 一个真会被 A 认出来的东西：Packages/ 故意不建，第 ③ 步"装没装"的判据才是干净的 */
  write(path.join(dir, 'Assets', 'Scene.unity'), '%YAML 1.1\n--- !u!1 &1\n')
  return dir
}

/** "已经有素材的目录"：探测要数得出顶层目录与受支持文件 */
function makeOldlib() {
  write(path.join(P.oldlib, 'Shinano', 'pack_a.unitypackage'), 'A'.repeat(2048))
  write(path.join(P.oldlib, 'Manuka', 'pack_b.unitypackage'), 'B'.repeat(1024))
  write(path.join(P.oldlib, 'Grimoir', 'readme.txt'), '散着放的一坨\n')
  write(path.join(P.oldlib, 'notes.txt'), '顶层文件\n')
  fs.mkdirSync(path.join(P.oldlib, 'Empty'), { recursive: true })
}

if (PRINT) {
  console.log(
    [
      'AVCA_APP_HOME=' + P.appHome,
      'LOCALAPPDATA=' + P.local,
      'projects=' + P.projects + ' (' + PROJECTS.join(', ') + ')',
      'oldlib=' + P.oldlib,
      'watched=' + P.watched
    ].join('\n')
  )
  process.exit(0)
}

if (FRESH) {
  /** 只删自己造的那几样；`AppData` 里没有它就不算全新安装 */
  rmrf(P.appHome)
  rmrf(P.projects)
  rmrf(P.oldlib)
  rmrf(P.local)
  console.log('[m7-tree] --fresh：旧的 AppData / projects / oldlib / LocalAppData 已删')
}

for (const n of PROJECTS) makeProject(n)
makeOldlib()
fs.mkdirSync(P.watched, { recursive: true })
write(P.vcc, JSON.stringify({ userProjects: PROJECTS.map((n) => path.join(P.projects, n)), defaultProjectPath: path.join(P.projects, PROJECTS[0]) }, null, 2))
fs.mkdirSync(P.appHome, { recursive: true })

console.log('[m7-tree] 造好了：')
console.log('  AVCA_APP_HOME=' + P.appHome)
console.log('  LOCALAPPDATA=' + P.local)
console.log('  假工程 ' + PROJECTS.length + ' 个：' + PROJECTS.join(' / '))
console.log('  已有素材的树 ' + P.oldlib + '（顶层 4 个目录 + 2 个 .unitypackage + 2 个 .txt）')
