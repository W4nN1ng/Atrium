/**
 * M5-B ⑦ 沙盒活体的**盘上/库上取证**（只读，不改任何东西）。
 *
 * 为什么单独一个脚本而不是在 bash 里 `node -e`：这台机器上带反斜杠和中文的
 * 内联脚本会被 shell 吃掉转义（项目备忘里踩过两次），写文件是唯一稳的。
 *
 * 用法：node tools/probe-m5b-live-state.cjs
 */
const fs = require('node:fs')
const path = require('node:path')
const { DatabaseSync } = require('node:sqlite')

const ROOT = process.env.AVCA_LIVE_ROOT || 'D:\\avca-m5b-live'
const A = path.join(ROOT, 'AppData', 'Roaming', 'A')
const PROJ = path.join(ROOT, 'projects', 'Shinano-LiveTest')
const EXTRACT = path.join(ROOT, '_extracted')

function tree(dir, depth = 0, out = []) {
  let names = []
  try {
    names = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    out.push('  '.repeat(depth) + '（读不到：' + dir + '）')
    return out
  }
  for (const n of names) {
    const full = path.join(dir, n.name)
    let size = ''
    try {
      size = n.isFile() ? ' ' + fs.statSync(full).size + 'B' : ''
    } catch {
      /* 刚被删掉也算数 */
    }
    out.push('  '.repeat(depth) + (n.isDirectory() ? n.name + '/' : n.name) + size)
    if (n.isDirectory() && depth < 4) tree(full, depth + 1, out)
  }
  return out
}

console.log('=== 抽取根 ' + EXTRACT + '（导完应该只剩空壳或什么都没有）===')
const ex = tree(EXTRACT)
console.log(ex.length ? ex.join('\n') : '（空的）')

console.log('\n=== 假工程 Assets/（导入真的落了文件）===')
console.log(tree(path.join(PROJ, 'Assets')).join('\n'))

console.log('\n=== 备份目录 ' + path.join(A, 'backups', 'rollback') + ' ===')
console.log(tree(path.join(A, 'backups', 'rollback')).join('\n') || '（没有）')

console.log('\n=== 沙盒库 import_log / journal ===')
const db = new DatabaseSync(path.join(A, 'library.db'), { readOnly: true })
const logs = db
  .prepare(
    `SELECT id, batch_id, asset_id, unitypackage_path, container_asset_id, member_rel_path, origin_archive,
            status, kind, created_guids_json, overwritten_json, backup_dir
     FROM import_log ORDER BY id`
  )
  .all()
for (const r of logs) {
  console.log(
    `#${r.id} batch=${String(r.batch_id).slice(0, 10)} status=${r.status} kind=${r.kind}\n` +
      `    member=${r.member_rel_path}\n` +
      `    container=${r.container_asset_id} origin_archive=${r.origin_archive}\n` +
      `    临时路径=${r.unitypackage_path}\n` +
      `    created=${r.created_guids_json} overwritten=${r.overwritten_json}\n` +
      `    backup=${r.backup_dir}`
  )
}
console.log('journal（导入相关）：')
for (const j of db.prepare(`SELECT id, op, created_at, payload_json FROM journal WHERE op IN ('import','unity_rollback') ORDER BY id`).all()) {
  const p = JSON.parse(j.payload_json || '{}')
  console.log(`  #${j.id} ${j.op} importLogId=${p.importLogId ?? '-'} batchId=${p.batchId ?? '-'} ${new Date(j.created_at).toLocaleTimeString('zh-CN')}`)
}
console.log('V5 三列有没有值：', logs.length ? (logs.every((r) => r.container_asset_id && r.member_rel_path && r.origin_archive) ? '全有' : '有空值') : '没有导入记录')
db.close()

console.log('\n=== 假 Unity 那侧看到的命令顺序 ===')
try {
  const log = fs.readFileSync(path.join(ROOT, 'fake-unity.log'), 'utf8').split(/\r?\n/)
  for (const l of log) if (/收到 /.test(l)) console.log('  ' + l.replace(/^\[\d{4}-\d\d-\d\dT/, '').slice(0, 150))
} catch (e) {
  console.log('  读不到日志：' + e.message)
}
