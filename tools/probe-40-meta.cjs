/**
 * 只读：跨目录组里每条素材的标签与元数据，用来判定拆簇后 variant 怎么重建。
 * 用法：node tools/probe-40-meta.cjs [db]
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

const members = new Map()
for (const a of q('select * from asset where group_id is not null')) {
  const d = dirOf(a)
  const k = a.group_id
  if (!members.has(k)) members.set(k, [])
  members.get(k).push({ ...a, _dir: d })
}

let n = 0
for (const [gid, ms] of members) {
  const dirs = new Set(ms.map((m) => m._dir))
  if (dirs.size < 2) continue
  const g = q('select * from asset_group where id = ?', gid)[0]
  n++
  console.log(`\n${'='.repeat(76)}\n组 #${n} [${g.group_key}] 「${g.name}」  簇数=${dirs.size}`)
  for (const m of ms) {
    const tags = q(
      `select t.kind, t.name as value, at.source from asset_tag at join tag t on t.id = at.tag_id where at.asset_id = ?`,
      m.id
    )
    const av = tags.filter((t) => t.kind === 'avatar').map((t) => t.value)
    console.log(`  - ${m.name}`)
    console.log(`      dir=${m._dir}`)
    console.log(`      avatar_tags=[${av.join(',')}]  asset.version=${m.version ?? 'null'}  locale=${m.locale_tag ?? 'null'}`)
    console.log(`      other_tags=[${tags.filter((t) => t.kind !== 'avatar').map((t) => `${t.kind}:${t.value}`).join(',')}]`)
    console.log(`      kind=${m.kind} contentType=${m.content_type} attachment=${m.attachment_kind ?? 'null'} storage=${m.storage_mode}`)
  }
}
console.log(`\n跨目录组共 ${n} 个`)
db.close()
