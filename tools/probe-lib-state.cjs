/**
 * 只读库状态体检：确认 V4(#40 dir_key) 迁移是否落库、归并是否还有跨目录误并。
 * 不写库、不动盘 —— 全程 readonly:true 且只 SELECT。
 * 用法：node tools/probe-lib-state.cjs [db路径]
 */
const Database = require('better-sqlite3')
const path = require('node:path')

const DB = process.argv[2] || process.env.AVCA_DB || path.join(process.env.APPDATA, 'A', 'library.db')
const db = new Database(DB, { readonly: true })
const q = (sql, ...a) => db.prepare(sql).all(...a)
const one = (sql, ...a) => db.prepare(sql).get(...a)
const MB = (n) => ((n ?? 0) / 1048576).toFixed(1)
const dirOf = (r) => {
  const p = (r.library_path || r.source_path || '').replace(/\\/g, '/')
  const i = p.lastIndexOf('/')
  return i > 0 ? p.slice(0, i).toLowerCase() : ''
}

console.log(`DB = ${DB}`)
const cols = {
  asset: q('pragma table_info(asset)').map((c) => c.name),
  asset_group: q('pragma table_info(asset_group)').map((c) => c.name)
}
const hasDirKey = cols.asset_group.includes('dir_key')

console.log(`\n== 1. 版本与迁移 ==`)
console.log('  user_version =', one('pragma user_version').user_version)
console.log('  asset 列检查:',
  ['parent_asset_id', 'is_bundle', 'container_kind', 'attachment_kind', 'variant_raw']
    .map((c) => `${c}=${cols.asset.includes(c) ? '✓' : '✗'}`).join(' '))
console.log(`  asset_group.dir_key = ${hasDirKey ? '✓ 已落库' : '✗ 缺失 → V4 未应用，#40 修复未生效'}`)

console.log(`\n== 2. 素材总量 ==`)
console.log('  asset 总行数:', one('select count(*) c from asset').c)
console.log('  status:', q(`select status, count(*) c from asset group by status order by c desc`)
  .map((r) => `${r.status}=${r.c}`).join(' '))
console.log('  角色分布:')
for (const r of q(`select
    case when parent_asset_id is null and is_bundle=1 then '容器(顶层)'
         when parent_asset_id is null and attachment_kind is not null then '附属(顶层,不该有)'
         when parent_asset_id is null then '独立素材'
         when is_bundle=1 then '子项容器'
         when attachment_kind is not null then '附属'
         else '子项/变体' end role, count(*) c
  from asset group by role order by c desc`)) console.log(`    ${r.role}: ${r.c}`)
const nr = one('select count(*) c from asset where needs_review=1').c
console.log(`  needs_review=1: ${nr} | 其中顶层: ${one('select count(*) c from asset where needs_review=1 and parent_asset_id is null').c}`)

console.log(`\n== 3. #40/归并：组内是否跨目录 ==`)
const groups = q(
  `select g.id, g.group_key, g.name${hasDirKey ? ', g.dir_key' : ', NULL as dir_key'} from asset_group g`
)
console.log(`  asset_group 行数: ${groups.length}`)
const multi = []
for (const g of groups) {
  const members = q('select id, library_path, source_path from asset where group_id = ?', g.id)
  if (members.length < 2) continue
  const dirs = [...new Set(members.map(dirOf).filter(Boolean))]
  if (dirs.length > 1) multi.push({ g, dirs, n: members.length })
}
console.log(`  ⚠ 成员落在多个目录的组: ${multi.length} 组 / ${multi.reduce((s, m) => s + m.n, 0)} 行`)
for (const m of multi.slice(0, 20)) {
  console.log(`    - [${m.g.group_key}] ${m.g.name} (${m.n} 行) dir_key=${m.g.dir_key}`)
  for (const d of m.dirs) console.log(`        ${d}`)
}
if (multi.length > 20) console.log(`    …另有 ${multi.length - 20} 组`)

console.log(`\n== 4. 集合 / 工程 / 导入记录 ==`)
console.log('  collection:', one('select count(*) c from collection').c,
  '| collection_asset:', one('select count(*) c from collection_asset').c,
  '| bundle:', one('select count(*) c from bundle').c)
console.log('  project:', one('select count(*) c from project').c)
for (const r of q('select name, path, is_running, bridge_version, unity_version from project order by name'))
  console.log(`    ${r.name}  running=${r.is_running} unity=${r.unity_version ?? '-'} bridge=${r.bridge_version ?? '-'}  ${r.path}`)
console.log('  import_log:', one('select count(*) c from import_log').c,
  '| journal:', one('select count(*) c from journal').c,
  '| package_entry:', one('select count(*) c from package_entry').c,
  '| dependency:', one('select count(*) c from dependency').c)

console.log(`\n== 5. 顶层卡（用户实际看到的）==`)
const top = q(`select id, name, category, subcategory, confidence, is_bundle, container_kind, needs_review, size_bytes,
    (select count(*) from asset c where c.parent_asset_id = asset.id) children
  from asset where parent_asset_id is null order by is_bundle desc, size_bytes desc`)
console.log(`  顶层共 ${top.length} 行：容器 ${top.filter((t) => t.is_bundle).length} / 独立 ${top.length - top.filter((t) => t.is_bundle).length}`)
for (const t of top.slice(0, 15))
  console.log(`    ${t.is_bundle ? '[容器]' : '      '} ${t.name} [${t.category}/${t.subcategory ?? '-'}] ${(t.confidence * 100).toFixed(0)}%`
    + `${t.is_bundle ? ` ${t.container_kind} 子${t.children}` : ''} ${MB(t.size_bytes)}MB${t.needs_review ? ' ⚑待复核' : ''}`)
db.close()
