#!/usr/bin/env node
/**
 * 抓真桥接写到 outbox 里的**原始响应**（取证用，不改任何东西）。
 *
 * A 读到终态就把 `outbox/<id>.json` 删了（R-23：删除权归读方），所以想知道
 * Unity 到底回了什么形状，只能自己盯一份副本出来。
 *
 *   node tools/live-s8-capture-outbox.cjs            # 一直抓到 Ctrl+C
 * 副本落在 D:\avca-r4-live\outbox-capture\<时间>-<id>.json
 */
const fs = require('node:fs')
const path = require('node:path')

const ROOT = process.env.AVCA_LIVE_ROOT || 'D:\\avca-r4-live'
const OUT = path.join(ROOT, 'projects', 'Shinano-R4LiveTest', 'Temp', 'AVCABridge', 'outbox')
const DST = path.join(ROOT, 'outbox-capture')
if (!/avca-r4-live$/i.test(path.basename(ROOT))) {
  console.error('拒绝：沙盒根目录名不对（' + ROOT + '）')
  process.exit(1)
}
fs.mkdirSync(DST, { recursive: true })
console.log('盯 ' + OUT + ' → ' + DST)
const seen = new Set()
const tick = () => {
  let list = []
  try {
    list = fs.readdirSync(OUT)
  } catch {
    return
  }
  for (const f of list) {
    if (!f.endsWith('.json')) continue
    const src = path.join(OUT, f)
    let text = ''
    try {
      text = fs.readFileSync(src, 'utf8')
    } catch {
      continue
    }
    if (!text || text.length < 8) continue
    const key = f + ':' + text.length + ':' + text.slice(0, 40)
    if (seen.has(key)) continue
    seen.add(key)
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    fs.writeFileSync(path.join(DST, stamp + '-' + f), text)
    console.log('抓到 ' + f + '（' + text.length + ' 字节）')
  }
}
setInterval(tick, 100)
/**
 * 光靠 100ms 轮询抓不到：A 的 chokidar 一看到终态就把 outbox 文件删了（R-23 删除权归读方），
 * 实测 delete_guids 那条就是每次都差一步没抄下来。fs.watch 是事件级的，落盘立刻抄。
 */
try {
  fs.watch(OUT, (event, file) => {
    if (!file || !file.endsWith('.json')) return
    tick()
  })
} catch (e) {
  console.log('fs.watch 起不来（继续用轮询）：' + e.message)
}
