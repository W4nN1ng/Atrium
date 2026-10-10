/**
 * 只读探针 ②：Libero 那 20 张卡，逐行看 raw_name / group_key / avatar 标签 / avatar 变体，
 * 用来确认"模型名进了归并键"这条根因（不改任何东西）。
 *   node tools/probe-libero-key.cjs
 */
const path = require('node:path')
const { DatabaseSync } = require('node:sqlite')

const db = new DatabaseSync(path.join(process.env.APPDATA, 'A', 'library.db'), { readOnly: true })
const rows = db
  .prepare(
    `SELECT a.id, a.name, a.raw_name, a.confidence, a.needs_review, g.group_key, g.dir_key,
            (SELECT group_concat(t.name, '|') FROM asset_tag at2 JOIN tag t ON t.id=at2.tag_id
              WHERE at2.asset_id=a.id AND t.kind='avatar') avatar_tags,
            (SELECT group_concat(t.name, '|') FROM asset_tag at2 JOIN tag t ON t.id=at2.tag_id
              WHERE at2.asset_id=a.id AND (t.kind IS NULL OR t.kind<>'avatar')) other_tags,
            (SELECT COUNT(*) FROM variant v WHERE v.asset_id=a.id AND v.variant_kind='avatar') av_vars
       FROM asset a LEFT JOIN asset_group g ON g.id=a.group_id
      WHERE a.name LIKE 'Libero%' AND a.parent_asset_id IS NULL
      ORDER BY g.group_key`
  )
  .all()

console.log('顶层 Libero 卡：' + rows.length + ' 张\n')
for (const r of rows) {
  console.log('key   = ' + (r.group_key || '(无组)'))
  console.log('  名字   = ' + r.name + '   raw=' + (r.raw_name || '').slice(0, 74))
  console.log('  模型标 = ' + (r.avatar_tags || '(没有)') + '   avatar 变体行=' + r.av_vars)
  console.log('  其它标 = ' + String(r.other_tags || '(没有)').slice(0, 90))
  console.log('  置信度 = ' + Number(r.confidence).toFixed(2) + '  待复核=' + r.needs_review + '  目录=' + (r.dir_key || 'NULL'))
  console.log('')
}

/** 关键一问：group_key 里多出来的那段，是不是正好等于该行的 avatar 标签？ */
let hit = 0
let miss = 0
for (const r of rows) {
  const key = String(r.group_key || '')
  const tags = String(r.avatar_tags || '').split('|').filter(Boolean)
  const extra = tags.filter((t) => key.toLowerCase().includes(t.toLowerCase()))
  if (extra.length) hit++
  else miss++
}
console.log('group_key 里含 avatar 标签的卡：' + hit + ' 张；不含的：' + miss + ' 张')

/** 同目录同前缀的组数（本该并成一张的散卡组数） */
const grp = db
  .prepare(
    `SELECT g.dir_key, SUBSTR(g.group_key,1,INSTR(g.group_key||' ',' ')-1) head, COUNT(DISTINCT g.id) groups, COUNT(*) cards
       FROM asset a JOIN asset_group g ON g.id=a.group_id
      WHERE a.parent_asset_id IS NULL AND g.dir_key IS NOT NULL
      GROUP BY g.dir_key, head HAVING groups>1 ORDER BY groups DESC LIMIT 12`
  )
  .all()
console.log('\n同一目录里"同一个词头、却裂成多个组"的情况（这就是散卡的形状）：')
console.table(grp)
db.close()
