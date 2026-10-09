/**
 * 甲轨②：59 条「待复核」的只读调查。
 * 不写库、不动盘 —— 只 SELECT，并把每组的判据字段原样吐出来。
 */
const Database = require('better-sqlite3')
const path = require('node:path')

const DB = process.env.AVCA_DB || path.join(process.env.APPDATA, 'A', 'library.db')
const db = new Database(DB, { readonly: true })

const rows = db
  .prepare(
    `select id, name, raw_name, category, subcategory, confidence, content_type, kind,
            storage_mode, size_bytes, library_path, source_path, variant_raw, source_item_id,
            source_platform, notes, created_at
       from asset
      where needs_review=1 and parent_asset_id is null
      order by category, subcategory, name`
  )
  .all()

const dir = (r) => {
  const p = r.library_path || r.source_path || ''
  return p.replace(/^E:[\\/]vrc[\\/]A[\\/]/, '').replace(/\\\\/g, '/')
}
const MB = (n) => ((n ?? 0) / 1048576).toFixed(1)

console.log(`DB = ${DB}`)
console.log(`待复核（顶层）= ${rows.length} 条\n`)

// 分组键：一级/二级 + 置信度档
const byCat = new Map()
for (const r of rows) {
  const k = `${r.category ?? '(null)'}/${r.subcategory ?? '-'}`
  if (!byCat.has(k)) byCat.set(k, [])
  byCat.get(k).push(r)
}

for (const [k, list] of [...byCat.entries()].sort((a, b) => b[1].length - a[1].length)) {
  console.log(`### ${k}  (${list.length} 条)`)
  for (const r of list) {
    console.log(
      [
        `${(r.confidence * 100).toFixed(0)}%`.padStart(4),
        (r.content_type || '-').padEnd(10),
        (r.kind || '-').padEnd(9),
        (r.storage_mode || '-').padEnd(9),
        `${MB(r.size_bytes)}M`.padStart(9),
        r.name,
        '   << ',
        dir(r) || '(无路径)',
        r.variant_raw ? `  [vr=${r.variant_raw}]` : ''
      ].join(' ')
    )
  }
  console.log('')
}

// 汇总：置信度分布 / 无路径 / 分类为 null
const agg = {
  nullCategory: rows.filter((r) => !r.category).length,
  noLibraryPath: rows.filter((r) => !r.library_path).length,
  low: rows.filter((r) => r.confidence < 0.3).length,
  mid: rows.filter((r) => r.confidence >= 0.3 && r.confidence < 0.6).length,
  high: rows.filter((r) => r.confidence >= 0.6).length,
  indexed: rows.filter((r) => r.storage_mode === 'indexed').length,
  archived: rows.filter((r) => r.storage_mode === 'archived').length,
  zeroSize: rows.filter((r) => !r.size_bytes).length,
  totalMB: +rows.reduce((a, r) => a + (r.size_bytes ?? 0), 0).toFixed(0) / 1048576
}
console.log('### 汇总', JSON.stringify(agg))
