/**
 * 只读检查真库现在的 schema 版本与 import_log 列（不改任何东西）。
 * A 在跑时也能读：用 node:sqlite 的 readOnly，并且**不写**任何文件。
 */
const { DatabaseSync } = require('node:sqlite')

const path = require('node:path')

/**
 * 默认从 `APPDATA` 推，**不写死任何人的用户名**（这仓库要公开，`C:\Users\<数字>\` 那种路径
 * 写进代码就是把本机用户名印到 README 级别的产物里）。要指别处就传参数。
 */
const file = process.argv[2] || path.join(process.env.APPDATA || '', 'A', 'library.db')
const db = new DatabaseSync(file, { readOnly: true })
const uv = db.prepare('PRAGMA user_version').get().user_version
const journal = db.prepare('PRAGMA journal_mode').get().journal_mode
console.log('文件        ', file)
console.log('user_version', uv)
console.log('journal_mode', journal)
const cols = db.prepare(`PRAGMA table_info(import_log)`).all().map((c) => c.name)
console.log('import_log 列', cols.join(', '))
const has = (n) => (cols.includes(n) ? '有' : '没有')
console.log(`  container_asset_id=${has('container_asset_id')} member_rel_path=${has('member_rel_path')} origin_archive=${has('origin_archive')}`)
const rows = db.prepare('SELECT COUNT(*) AS n FROM asset').get().n
console.log('asset 行    ', rows)
const logs = db.prepare(`SELECT COUNT(*) AS n FROM import_log`).get().n
const last = db.prepare(`SELECT id, op, created_at FROM journal ORDER BY id DESC LIMIT 3`).all()
console.log('import_log 行', logs)
console.log('journal 最后 3 条', last.map((r) => `${r.id}/${r.op}/${new Date(r.created_at).toLocaleString('zh-CN')}`).join('  '))
db.close()
