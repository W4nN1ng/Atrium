#!/usr/bin/env node
/**
 * §8 真 Unity 那一轮重跑之前，把沙盒库里那 5 张 .unitypackage 卡清掉。
 *
 * 为什么清：包重造过（包内条目从 `.prefab/.anim/.fbx` 换成了 Unity 收得下的
 * `.txt/.json/.shader`），库里 `package_entry` 那几行还是旧路径。
 * 导入本身是**重新解析磁盘上的包**（`preflight` 里 `parseUnitypackage`），所以旧行不影响导入，
 * 但详情面板"包内条目"会显示对不上的路径 —— 拿这种现场当证据不合格。
 *
 * ⚠ 只许动沙盒（`D:\avca-r4-live`）。`import_log` 是历史，**留着不删**（⑥ 反查靠它）。
 *
 * 用法：node tools/live-s8-reset.cjs
 */
const path = require('node:path')
const { DatabaseSync } = require('node:sqlite')

const APP = process.env.AVCA_APP_HOME || 'D:\\avca-r4-live\\AppData\\Roaming\\A'
if (!/avca-r4-live/i.test(APP)) {
  console.error('拒绝：AVCA_APP_HOME 必须指向 D:\\avca-r4-live（拿到的是 ' + APP + '）')
  process.exit(1)
}
const db = new DatabaseSync(path.join(APP, 'library.db'))
const rows = db.prepare(`SELECT id, group_id AS g, name FROM asset WHERE kind='unitypackage'`).all()
if (!rows.length) {
  console.log('沙盒库里没有 .unitypackage 卡，不用清')
  process.exit(0)
}
db.exec('BEGIN')
for (const r of rows) {
  db.prepare(`DELETE FROM package_entry WHERE asset_id = ?`).run(r.id)
  db.prepare(`DELETE FROM dependency WHERE asset_id = ?`).run(r.id)
  db.prepare(`DELETE FROM variant WHERE asset_id = ?`).run(r.id)
  db.prepare(`DELETE FROM asset_tag WHERE asset_id = ?`).run(r.id)
  db.prepare(`DELETE FROM search_alias WHERE asset_id = ?`).run(r.id)
  db.prepare(`DELETE FROM journal WHERE payload_json LIKE '%' || ? || '%'`).run(r.id)
  db.prepare(`DELETE FROM asset WHERE id = ?`).run(r.id)
  console.log('清了 ' + r.name + '（' + r.id + '）')
}
db.prepare(`DELETE FROM tag WHERE id NOT IN (SELECT tag_id FROM asset_tag)`).run()
if (rows[0].g) db.prepare(`DELETE FROM asset_group WHERE id NOT IN (SELECT group_id FROM asset WHERE group_id IS NOT NULL)`).run()
db.exec('COMMIT')
console.log('库里还剩素材 ' + JSON.stringify(db.prepare(`SELECT COUNT(*) n FROM asset`).get()) + '、import_log ' + JSON.stringify(db.prepare(`SELECT COUNT(*) n FROM import_log`).get()))
db.close()
