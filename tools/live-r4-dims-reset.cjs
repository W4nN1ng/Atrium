#!/usr/bin/env node
/**
 * 把沙盒里那一对 Grimoir 测试素材清掉，好让修好分类器之后重新投一遍。
 *
 * ⚠ 只许动 `D:\avca-r4-live` 这个**我自己造的沙盒**（素材是脚本捏的 body.fbx，入库时 move:false
 *    所以盘上文件还在原处，没搬过）。真库 `E:\vrc\A` / `%APPDATA%\A\library.db` 一律拒绝。
 *
 * 用法：node tools/tmp-reset-grimoir.cjs
 */
const path = require('node:path')
const { DatabaseSync } = require('node:sqlite')

const APP = process.env.AVCA_APP_HOME || 'D:\\avca-r4-live\\AppData\\Roaming\\A'
if (!/avca-r4-live/i.test(APP)) {
  console.error('拒绝：AVCA_APP_HOME 必须指向 D:\\avca-r4-live（拿到的是 ' + APP + '）')
  process.exit(1)
}
const db = new DatabaseSync(path.join(APP, 'library.db'))
const ids = db.prepare(`SELECT id, group_id AS g FROM asset WHERE raw_name LIKE 'Grimoir_%'`).all()
if (!ids.length) {
  console.log('沙盒里没有 Grimoir 测试素材，不用清')
  db.close()
  process.exit(0)
}
const gid = ids[0].g
db.exec('BEGIN')
for (const r of ids) {
  db.prepare(`DELETE FROM variant WHERE asset_id = ?`).run(r.id)
  db.prepare(`DELETE FROM asset_tag WHERE asset_id = ?`).run(r.id)
  // journal 没有 asset_id 列（只有 payload_json），留着就会成为"撤一次指向已消失素材"的幽灵记录
  db.prepare(`DELETE FROM journal WHERE payload_json LIKE '%' || ? || '%'`).run(r.id)
  db.prepare(`DELETE FROM asset WHERE id = ?`).run(r.id)
  console.log('清了素材 ' + r.id + '（' + (r.g || '无组') + '）')
}
if (gid) {
  db.prepare(`DELETE FROM asset_group WHERE id = ?`).run(gid)
  console.log('清了组 ' + gid)
}
// 顺手清掉没人引用的 avatar 标签（别的素材还在用的标签一行都不动）
db.prepare(`DELETE FROM tag WHERE kind='avatar' AND id NOT IN (SELECT tag_id FROM asset_tag)`).run()
db.exec('COMMIT')
const left = db.prepare(`SELECT COUNT(*) n FROM asset`).get().n
console.log('库里还剩 ' + left + ' 行素材')
db.close()
