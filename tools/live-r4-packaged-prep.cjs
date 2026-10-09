/**
 * 第 2 轮活体的前置整理（只动沙盒 `D:\avca-r4-live`，不碰真库）：
 *  1. 把上一几轮活体**误登记进沙盒库的 8 个真工程**删掉 —— 它们让顶栏下拉变长、
 *     也让探测去读他真工程的 `Temp/`（§13.4 那类越界）。沙盒活体只需要沙盒工程。
 *  2. 写一份沙盒自己的 VCC 清单（配合 `LOCALAPPDATA` 重定向），
 *     这样 `readVccManifest` 只看得到沙盒工程，不会再把真工程捞回来。
 *
 * 用法：node tools/live-r4-packaged-prep.cjs
 */
const fs = require('node:fs')
const path = require('node:path')
const { DatabaseSync } = require('node:sqlite')

const ROOT = process.env.AVCA_LIVE_ROOT || 'D:\\avca-r4-live'
/** 和 `resolveAppHome` 同一道闸：路径里必须有 avca / sandbox 字样才肯往里写 */
if (!/(avca|sandbox)/i.test(path.basename(ROOT))) {
  console.error(`拒绝：沙盒根目录名不对（${ROOT}）`)
  process.exit(1)
}
const APP = path.join(ROOT, 'AppData', 'Roaming', 'A')
const DB = path.join(APP, 'library.db')
/**
 * `AVCA_PREP_ALLOW_EMPTY=1`：这个沙盒**不需要任何 Unity 工程**（③ 搬文件那条链用不上），
 * 于是把库里的工程行全删掉、清单写成空 —— 这样打包版起来不会被 ⑦ 的弹窗挡住，
 * 探测也不会去读他真工程的 `Temp/`（§13.4 那类越界）。
 */
const ALLOW_EMPTY = process.env.AVCA_PREP_ALLOW_EMPTY === '1'
const MANIFEST = fs.existsSync(path.join(ROOT, 'live-manifest.json'))
  ? JSON.parse(fs.readFileSync(path.join(ROOT, 'live-manifest.json'), 'utf8'))
  : {}
const SANDBOX_PROJ = path.win32.normalize(String(MANIFEST.projectPath ?? ''))
if (!ALLOW_EMPTY) {
  if (!SANDBOX_PROJ) {
    console.error('拒绝：live-manifest.json 里没有 projectPath（要空沙盒就带 AVCA_PREP_ALLOW_EMPTY=1）')
    process.exit(1)
  }
  if (!/livetest$/i.test(path.basename(SANDBOX_PROJ))) {
    console.error('拒绝：沙盒工程名必须以 LiveTest 结尾（和 fake-unity-live.cjs 同一道防呆）')
    process.exit(1)
  }
}

const db = new DatabaseSync(DB)
db.exec('PRAGMA foreign_keys = ON')

const rows = db.prepare(`SELECT id, name, path FROM project`).all()
const mine = rows.filter((r) => path.win32.normalize(r.path).toLowerCase() === SANDBOX_PROJ.toLowerCase())
const others = rows.filter((r) => !mine.includes(r))
console.log(`库里 ${rows.length} 个工程；沙盒的 ${mine.length} 个；要删的 ${others.length} 个：${others.map((r) => r.name).join('、') || '（无）'}`)
if (!ALLOW_EMPTY && !mine.length) {
  console.error('拒绝：沙盒库里连沙盒工程都没有，先跑 make-r4-live-tree.cjs')
  process.exit(1)
}

for (const r of others) {
  const logs = db.prepare(`DELETE FROM import_log WHERE project_id = ?`).run(r.id)
  const fp = db.prepare(`DELETE FROM setting WHERE key IN (?, ?)`).run('bridgeAsk:' + r.id, 'projectGuids:' + r.id)
  const del = db.prepare(`DELETE FROM project WHERE id = ?`).run(r.id)
  console.log(`  删 ${r.name}：import_log ${logs.changes} 行 · setting ${fp.changes} 键 · project ${del.changes} 行`)
}
console.log('剩下的工程：', db.prepare(`SELECT name FROM project`).all().map((r) => r.name).join('、'))
db.close()

/** 沙盒自己的 VCC 清单：只列沙盒工程（空沙盒就一个都不列） */
const vcc = path.join(ROOT, 'AppData', 'Local', 'VRChatCreatorCompanion')
fs.mkdirSync(vcc, { recursive: true })
const list = ALLOW_EMPTY ? [] : [SANDBOX_PROJ]
fs.writeFileSync(
  path.join(vcc, 'settings.json'),
  JSON.stringify({ userProjects: list, defaultProjectPath: list[0] ?? null }, null, 2),
  'utf8'
)
console.log('沙盒 VCC 清单：', path.join(vcc, 'settings.json'))
console.log('\n起打包版：')
console.log(`  AVCA_APP_HOME=${APP}`)
console.log(`  LOCALAPPDATA=${path.join(ROOT, 'AppData', 'Local')}`)
console.log(`  dist\\win-unpacked\\Atrium.exe --remote-debugging-port=9227`)
