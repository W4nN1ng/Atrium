/**
 * 只读：把这 13 组的**原始路径与形态字段**原样打出来（不做任何归纳），
 * 用来定"同一产品两形态"的可判据。用法：node tools/probe-40-forms.cjs [db]
 */
const Database = require('better-sqlite3')
const path = require('node:path')

const DB = process.argv[2] || path.join(process.env.APPDATA, 'A', 'library.db')
const db = new Database(DB, { readonly: true })
const q = (s, ...a) => db.prepare(s).all(...a)

const ARCHIVE = /\.(zip|rar|7z|tar|gz|tgz|bz2|xz)$/i
const seg = (p) => String(p ?? '').replace(/\\/g, '/').split('/').filter(Boolean)
const last = (p) => seg(p).pop() ?? ''
const parent = (p) => seg(p).slice(0, -1).pop() ?? ''

const members = new Map()
for (const a of q('select * from asset where group_id is not null')) {
  if (!members.has(a.group_id)) members.set(a.group_id, [])
  members.get(a.group_id).push(a)
}

let n = 0
for (const [gid, ms] of members) {
  const dirs = new Set(
    ms.map((m) => {
      const p = String(m.library_path || m.source_path || '').replace(/\\/g, '/')
      const i = p.lastIndexOf('/')
      return i > 1 ? p.slice(0, i).toLowerCase() : '(none)'
    })
  )
  if (dirs.size < 2) continue
  const g = q('select * from asset_group where id = ?', gid)[0]
  n++
  console.log(`\n${'='.repeat(80)}`)
  console.log(`#${n}  [${g.group_key}] 「${g.name}」`)
  for (const m of ms) {
    const raw = String(m.library_path || m.source_path || '')
    const L = last(raw)
    const P = parent(raw)
    const isArc = ARCHIVE.test(L)
    console.log(`   name="${m.name}"`)
    console.log(`     library_path ${m.library_path === null ? '(null)' : m.library_path}`)
    console.log(`     source_path  ${m.source_path === null ? '(null)' : m.source_path}`)
    console.log(`     last="${L}"  isArchiveExt=${isArc}  parentDir="${P}"`)
    console.log(`     kind=${m.kind}  storage_mode=${m.storage_mode}  content_type=${m.content_type}`)
    // 关键判据：父目录名是否等于"去掉压缩扩展名后的自身名"
    const stripped = L.replace(ARCHIVE, '')
    console.log(`     parentDir==strippedSelf? ${P === stripped}   (stripped="${stripped}")`)
  }
}
console.log(`\n跨目录组共 ${n} 个`)
db.close()
