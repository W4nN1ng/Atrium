/**
 * V4 迁移在**真库副本**上的验证（原库只读，绝不打开原库写）。
 * 用法：node tools/try-v4-on-copy.cjs
 *
 * 要回答的三个问题：
 *  1. ALTER TABLE + DROP INDEX 在他那个 122 组 / 373 行的库上跑不跑得过去
 *  2. 回填之后有多少组拿到了 dir_key、有多少留 NULL（预期 NULL = 跨目录误并的存量）
 *  3. 迁移前后的统计口径不许变（素材 134 / 附属 19 / 容器 5 / 待复核 59）
 */
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')

const SRC = path.join(process.env.APPDATA, 'A', 'library.db')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'avca-v4-'))
const COPY = path.join(tmp, 'library.db')
fs.copyFileSync(SRC, COPY)
if (fs.existsSync(SRC + '-wal')) fs.copyFileSync(SRC + '-wal', COPY + '-wal')

const before = dump(SRC)
const out = migrateCopy(COPY)
const after = dump(COPY)

console.log('原库（只读）迁移前：', JSON.stringify(before))
console.log('副本迁移后：      ', JSON.stringify(after))
console.log('迁移输出：', out)
const same = JSON.stringify(strip(before)) === JSON.stringify(strip(after))
console.log(same ? '✅ 统计口径一致，一个数字都没变' : '❌ 口径变了')
fs.rmSync(tmp, { recursive: true, force: true })

function dump(file) {
  const q = (sql) =>
    JSON.parse(
      execFileSync('node', [path.join(__dirname, 'sqlite-query.cjs'), file, sql], { encoding: 'utf8' }).trim()
    )
  return {
    version: q('PRAGMA user_version'),
    top: q('select count(*) c from asset where parent_asset_id is null and attachment_kind is null and is_bundle=0'),
    attach: q('select count(*) c from asset where attachment_kind is not null'),
    bundle: q('select count(*) c from asset where is_bundle=1'),
    review: q('select count(*) c from asset where needs_review=1 and parent_asset_id is null'),
    groups: q('select count(*) c from asset_group')
  }
}
function strip(x) {
  const { version, ...rest } = x
  return rest
}
function migrateCopy(file) {
  const script = path.join(__dirname, 'migrate-copy.cjs')
  return execFileSync('node', [script, file], { encoding: 'utf8' }).trim()
}
