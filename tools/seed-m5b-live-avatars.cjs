/**
 * 沙盒活体（M6 ⑦）用的**数据种子**：往沙盒库里塞几条 avatar 变体，
 * 让「按库里出现过的模型补建集合」有真实形状的东西可列。
 *
 * ⚠ 只许指到 `avca-m5b-live` 这种沙盒路径（下面有防呆），**用户的真库在 `%APPDATA%\A`，
 * 这个脚本碰到别的路径会直接拒绝**。
 *
 * 为什么要塞而不是"让它自然产生"：合成容器（3 个几 KB 的假包）走完整条分类链之后
 * 不一定能认出 avatar 变体，而这一轮要验的是补建/匹配/横幅，不是分类器。
 * 塞进去的行列在 `live-seed-report.txt` 里，截图说明里也写清这是种子数据。
 */
const fs = require('node:fs')
const path = require('node:path')
const { DatabaseSync } = require('node:sqlite')

const file = process.argv[2] || 'D:\\avca-m5b-live\\AppData\\Roaming\\A\\library.db'
if (!/avca-m5b-live|avca-live|sandbox/i.test(file)) {
  console.error(`拒绝写入：${file}（只许指到沙盒库）`)
  process.exit(1)
}
if (!fs.existsSync(file)) {
  console.error(`库不存在：${file}（先跑一次沙盒活体的入库步骤）`)
  process.exit(1)
}

/** 一个 ULID 形状的假 id 就够了：这些行只用来喂查询 */
let seq = 0
const id = (p) => p + String(1000 + ++seq)

const db = new DatabaseSync(file)
const assets = db.prepare(`SELECT id, name FROM asset WHERE is_bundle = 0 ORDER BY name`).all()
if (!assets.length) {
  console.error('沙盒库里一个素材都没有，先入库再种')
  process.exit(1)
}

/** 名字里带这些词的子项，算成"带这个模型" */
const MODELS = ['Shinano', 'Manuka']
/** 额外再塞一条 UNIVERSAL：它不是模型名，补建时必须被排除并留痕 */
const rows = []
for (const a of assets) {
  const m = MODELS.find((x) => a.name.includes(x))
  if (m) rows.push({ asset: a.id, model: m })
}
rows.push({ asset: assets[0].id, model: 'UNIVERSAL' })
/** 大小写重复也要有：真库里就是 `Shinano` 和 `SHINANO` 并存 */
rows.push({ asset: assets[assets.length - 1].id, model: 'SHINANO' })

const write = db.prepare(
  `INSERT OR IGNORE INTO variant (id, group_id, asset_id, variant_kind, variant_value) VALUES (?, ?, ?, 'avatar', ?)`
)
for (const r of rows) {
  const gid = id('G')
  db.prepare(`INSERT OR IGNORE INTO asset_group (id, group_key, name, category, dir_key) VALUES (?, ?, ?, 'texture', NULL)`).run(
    gid,
    'seed-' + gid,
    r.model
  )
  write.run(id('V'), gid, r.asset, r.model)
}
const now = db.prepare(`SELECT variant_value v, COUNT(*) n FROM variant WHERE variant_kind='avatar' GROUP BY v`).all()
db.close()
const report = '种子变体：' + JSON.stringify(now)
console.log(report)
fs.writeFileSync(path.join(path.dirname(file), 'live-seed-report.txt'), report + '\n')
