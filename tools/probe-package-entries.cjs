/**
 * 只读：检查真库 package_entry 表是否被 `./` 前缀 bug 污染。
 * 用法：node tools/probe-package-entries.cjs [db]
 */
const Database = require('better-sqlite3')
const path = require('node:path')

const DB = process.argv[2] || path.join(process.env.APPDATA, 'A', 'library.db')
const db = new Database(DB, { readonly: true })
const q = (s, ...a) => db.prepare(s).all(...a)
const one = (s, ...a) => db.prepare(s).get(...a)

console.log('DB =', DB)
console.log('package_entry 总行数 =', one('select count(*) c from package_entry').c)

/** 合法 GUID 是 32 位十六进制；bug 的表现是 guid 变成 '.' 或空 */
const bad = q(
  `select guid, count(*) n from package_entry
    where guid is null or guid = '' or guid = '.' or length(guid) != 32
       or guid glob '*[^0-9a-f]*'
    group by guid order by n desc limit 20`
)
console.log(`\n非法 GUID 的行数 = ${bad.reduce((s, r) => s + r.n, 0)}（${bad.length} 种取值）`)
for (const r of bad) console.log(`  guid=${JSON.stringify(r.guid)} × ${r.n}`)

console.log('\n按条目数排前 10 的素材（bug 会把一个包压成 1 条）:')
for (const r of q(
  `select pe.asset_id as id, count(*) n, a.name as name
     from package_entry pe left join asset a on a.id = pe.asset_id
    group by pe.asset_id order by n desc limit 10`
)) {
  console.log(`  ${r.n} 条  ${r.name ?? '(素材行已不在)'}  ${r.id}`)
}

console.log('\n有 unity_path 但 guid 非法的样例:')
for (const r of q(
  `select guid, unity_path from package_entry
    where (guid is null or guid = '' or guid = '.' or length(guid) != 32) limit 10`
)) {
  console.log(`  guid=${JSON.stringify(r.guid)}  path=${r.unity_path}`)
}
db.close()
