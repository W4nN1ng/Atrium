const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { DatabaseSync } = require('node:sqlite')

const home = path.join(os.homedir(), 'AppData', 'Roaming')
for (const d of ['A', 'Atrium', 'a-manager']) {
  const p = path.join(home, d, 'library.db')
  console.log(p, fs.existsSync(p) ? (fs.statSync(p).size / 1048576).toFixed(1) + ' MB' : '不在')
}
const p = path.join(home, 'A', 'library.db')
if (!fs.existsSync(p)) process.exit(0)
const db = new DatabaseSync(p, { readOnly: true })
const bundles = db.prepare(`SELECT id,name,raw_name,category,library_path,created_at FROM asset WHERE is_bundle = 1 ORDER BY created_at DESC LIMIT 12`).all()
console.log('\n合集卡', bundles.length, '张（最新在前）：')
for (const b of bundles) console.log('  ', b.name, '|', b.raw_name, '|', b.category, '|', (b.library_path || '').slice(0, 80), '|', new Date(b.created_at).toISOString().slice(0, 16))
const n = db.prepare(`SELECT COUNT(*) AS n FROM asset`).get().n
const today = db.prepare(`SELECT COUNT(*) AS n FROM asset WHERE created_at > ?`).get(Date.now() - 86400000).n
console.log('\nasset 总行数', n, '／最近 24 小时新增', today)
db.close()
