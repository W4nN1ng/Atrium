/**
 * 只读：把 13 个跨目录组的成员、variant 行、分类全吐出来，用于定拆分策略。
 * 用法：node tools/probe-40-detail.cjs [db]
 */
const Database = require('better-sqlite3')
const path = require('node:path')

const DB = process.argv[2] || path.join(process.env.APPDATA, 'A', 'library.db')
const db = new Database(DB, { readonly: true })
const q = (s, ...a) => db.prepare(s).all(...a)
const dirOf = (r) => {
  const p = (r.library_path || r.source_path || '').replace(/\\/g, '/')
  const i = p.lastIndexOf('/')
  return i > 1 ? p.slice(0, i).toLowerCase() : null
}

const groups = q('select * from asset_group order by group_key')
let bad = 0
const counts = { avatar: 0, version: 0, locale: 0, install_method: 0, other: 0 }

for (const g of groups) {
  const members = q('select * from asset where group_id = ?', g.id)
  if (members.length < 2) continue
  const byDir = new Map()
  for (const m of members) {
    const d = dirOf(m)
    if (!byDir.has(d)) byDir.set(d, [])
    byDir.get(d).push(m)
  }
  if (byDir.size < 2) continue
  bad++
  console.log(`\n${'='.repeat(78)}`)
  console.log(`组 #${bad}  [${g.group_key}]  「${g.name}」`)
  console.log(`  组分类: ${g.category}/${g.subcategory ?? '-'}   dir_key=${g.dir_key}`)
  const variants = q('select * from variant where group_id = ?', g.id)
  for (const v of variants) counts[v.variant_kind] = (counts[v.variant_kind] ?? 0) + 1
  console.log(`  variant 行 ${variants.length} 条: ${variants.map((v) => `${v.variant_kind}=${v.variant_value}`).join(' | ') || '(无)'}`)
  console.log(`  → 会拆成 ${byDir.size} 个目录簇:`)
  for (const [d, ms] of byDir) {
    console.log(`      [${d}]`)
    for (const m of ms) {
      const myVariants = variants.filter((v) => v.asset_id === m.id)
      console.log(`        - ${m.name}  [${m.category}/${m.subcategory ?? '-'}] ${(m.confidence * 100).toFixed(0)}%`
        + ` parent=${m.parent_asset_id ? 'yes' : 'null'} bundle=${m.is_bundle}`
        + (myVariants.length ? `  variants: ${myVariants.map((v) => `${v.variant_kind}=${v.variant_value}`).join(',')}` : ''))
      console.log(`            ${m.library_path || m.source_path}`)
    }
  }
}

console.log(`\n${'='.repeat(78)}`)
console.log(`跨目录组共 ${bad} 个`)
console.log(`这些组里 variant 行按 kind 统计:`, counts)
console.log(`\n全库 variant 行按 kind 统计:`)
for (const r of q('select variant_kind, count(*) c from variant group by variant_kind order by c desc')) {
  console.log(`  ${r.variant_kind}: ${r.c}`)
}
db.close()
