/**
 * 只读探针：查两件事的实情，不改任何东西。
 *   ① 「待复核」59 条到底是什么状态、有没有用户路径能把 needs_review 清掉
 *   ② Libero 那一堆为什么没并成一张卡（group_key / dir_key / 父目录 / 变体数）
 *
 * A 在跑也能读：node:sqlite 的 readOnly，不写任何文件。
 *   node tools/probe-review-and-merge.cjs
 */
const path = require('node:path')
const { DatabaseSync } = require('node:sqlite')

const DB = path.join(process.env.APPDATA, 'A', 'library.db')
const db = new DatabaseSync(DB, { readOnly: true })
const q = (sql, ...a) => db.prepare(sql).all(...a)

console.log('库：' + DB + '（只读）\n')

console.log('=== ① needs_review 的形状 ===')
const nr = q(
  `SELECT status, COUNT(*) n, SUM(needs_review) with_flag FROM asset
     WHERE parent_asset_id IS NULL GROUP BY status ORDER BY status`
)
console.table(nr)
const nr2 = q(
  `SELECT needs_review, COUNT(*) n FROM asset WHERE parent_asset_id IS NULL GROUP BY needs_review`
)
console.log('顶层素材按 needs_review 分组：', JSON.stringify(nr2))
const conf = q(
  `SELECT CAST(confidence*10 AS INT)/10.0 bucket, COUNT(*) n FROM asset
     WHERE parent_asset_id IS NULL AND needs_review=1 GROUP BY bucket ORDER BY bucket`
)
console.log('待复核的置信度分布：', conf.map((r) => r.bucket + '→' + r.n).join('  '))
const sample = q(
  `SELECT a.name, a.category, a.subcategory, a.confidence, a.status,
          (SELECT COUNT(*) FROM asset ch WHERE ch.parent_asset_id=a.id) kids,
          g.group_key, g.dir_key
     FROM asset a LEFT JOIN asset_group g ON g.id=a.group_id
    WHERE a.parent_asset_id IS NULL AND a.needs_review=1 ORDER BY a.name LIMIT 12`
)
console.table(sample)

console.log('\n=== ② Libero 这一族 ===')
const lib = q(
  `SELECT a.id, a.name, a.category, a.subcategory, a.status, a.needs_review,
          a.parent_asset_id pid, a.group_id gid, g.group_key, g.dir_key,
          a.library_path,
          (SELECT COUNT(*) FROM variant v WHERE v.asset_id=a.id) variants,
          (SELECT COUNT(*) FROM asset_tag at2 JOIN tag tg ON tg.id=at2.tag_id WHERE at2.asset_id=a.id) tags
     FROM asset a LEFT JOIN asset_group g ON g.id=a.group_id
    WHERE a.name LIKE 'Libero%' ORDER BY g.group_key, a.name, a.library_path`
)
console.log('Libero* 行数：' + lib.length)
for (const r of lib) {
  console.log(
    `  [${(r.group_key || '无组').padEnd(12)}] dir=${String(r.dir_key || 'NULL').padEnd(28)} ` +
      `名=${(r.name || '').slice(0, 34).padEnd(36)} 分类=${r.category}/${r.subcategory || '-'} ` +
      `变体=${r.variants} 父=${r.pid ? '有' : '顶层'} 待复核=${r.needs_review}`
  )
}
const byGroup = q(
  `SELECT g.id, g.group_key, g.category, g.dir_key, COUNT(a.id) members,
          SUM(CASE WHEN a.parent_asset_id IS NULL THEN 1 ELSE 0 END) tops
     FROM asset_group g JOIN asset a ON a.group_id=g.id
    WHERE g.group_key LIKE 'libero%' GROUP BY g.id ORDER BY members DESC`
)
console.log('\nLibero 相关的组（组内成员数 / 其中顶层卡数）：')
console.table(byGroup)

console.log('\n=== ③ 同组却分散在多个目录的组（裁定"必须同目录"的那批） ===')
const spread = q(
  `SELECT g.group_key, COUNT(DISTINCT COALESCE(g2.dir_key,'?')) dirs, COUNT(a.id) members
     FROM asset_group g JOIN asset a ON a.group_id=g.id LEFT JOIN asset_group g2 ON g2.id=a.group_id
    GROUP BY g.group_key HAVING dirs>1 ORDER BY members DESC LIMIT 10`
)
console.table(spread)

console.log('\n=== ④ 建议合并那条横幅的口径能命中几条（twinklespica 有横幅、Libero 没有） ===')
const sug = q(
  `SELECT g.group_key, g.dir_key, COUNT(*) n FROM asset a JOIN asset_group g ON g.id=a.group_id
    WHERE a.parent_asset_id IS NULL GROUP BY g.group_key, g.dir_key HAVING n>=2 ORDER BY n DESC LIMIT 12`
)
console.table(sug)

db.close()
