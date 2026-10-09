/** 沙盒活体跑之前的环境确认（只读 + 一次可删除的写探针）。 */
const fs = require('node:fs')
const path = require('node:path')

const out = []
for (const drive of ['C:\\', 'D:\\', 'E:\\']) {
  let exists = false
  try {
    fs.accessSync(drive)
    exists = true
  } catch {
    out.push({ drive, exists, writable: false, note: '盘不存在' })
    continue
  }
  const probe = path.join(drive, `avca-write-probe-${Date.now()}.tmp`)
  try {
    fs.writeFileSync(probe, 'x')
    fs.unlinkSync(probe)
    out.push({ drive, exists, writable: true, note: '可写' })
  } catch (e) {
    out.push({ drive, exists, writable: false, note: '不可写：' + (e.code || e.message) })
  }
}
for (const r of out) console.log(r.drive.padEnd(4), r.writable ? '✓ 可写' : '✗ 不可写', '—', r.note)

try {
  const cp = require('child_process')
  console.log('\n--- 卷标 ---')
  console.log(cp.execSync('wmic logicaldisk get caption,volumename,drivetyp,freespace,size /format:csv', { encoding: 'utf8' }))
} catch (e) {
  console.log('wmic 不可用：', e.message)
}
