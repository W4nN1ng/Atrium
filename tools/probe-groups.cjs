/**
 * 只读探针：asset_group 里有多少组是**跨目录**的（#40 的存量损害面）。
 * 用法：node tools/probe-groups.cjs [db路径]
 */
const Database = require('better-sqlite3')
const path = require('node:path')
const os = require('node:os')

const DB = process.argv[2] || path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'A', 'library.db')
const db = new Database(DB, { readonly: true })

const rows = db
  .prepare(
    `select g.id, g.group_key, g.category, a.id as aid, a.name,
            coalesce(a.library_path, a.source_path) as p,
            a.parent_asset_id, a.is_bundle, a.needs_review
       from asset_group g join asset a on a.group_id = g.id`
  )
  .all()

const groups = new Map()
for (const r of rows) {
  if (!groups.has(r.id)) groups.set(r.id, { key: r.group_key, cat: r.category, members: [] })
  const dir = r.p ? path.dirname(String(r.p).replace(/\\/g, '/')).toLowerCase() : '(无路径)'
  groups.get(r.id).members.push({ id: r.aid, name: r.name, dir, p: r.p })
}

const multi = [...groups.entries()].filter(([, g]) => g.members.length >= 2)
const cross = multi.filter(([, g]) => new Set(g.members.map((m) => m.dir)).size > 1)

console.log(`组总数 ${groups.length}，成员≥2 的组 ${multi.length}，其中跨目录 ${cross.length}`)
console.log(`跨目录组里的成员行数 ${cross.reduce((a, [, g]) => a + g.members.length, 0)}`)
console.log('')
for (const [id, g] of cross.sort((a, b) => b[1].members.length - a[1].members.length)) {
  const dirs = [...new Set(g.members.map((m) => m.dir))]
  console.log(`[${g.key}]  ${g.cat}  成员${g.members.length} / 目录${dirs.length}  group=${id}`)
  for (const d of dirs) console.log(`    ${d.replace(/^e:\/vrc\/a\/?/, '')}`)
}
