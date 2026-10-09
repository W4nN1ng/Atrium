/**
 * 只读：验证"zip 与已解压目录并存"那几组在磁盘上的真实形态。
 * 只做 stat/exists，不改任何东西。用法：node tools/probe-16-pairs.cjs
 */
const fs = require('node:fs')
const path = require('node:path')

// 来自 probe-40-meta.cjs 的 5 组「同名两侧」+ 对照组
const cases = [
  ['1 sexy skin', 'E:\\vrc\\A\\贴图\\皮肤\\Sexy skin material for VRC 6053463', 'E:\\vrc\\A\\贴图\\6718483Milfy妆容'],
  ['2 real skin no39', 'E:\\vrc\\A\\贴图\\皮肤\\Shinano Real skin NO39', 'E:\\vrc\\A\\贴图\\shinano贴图'],
  ['3 prism cat eye', 'E:\\vrc\\A\\贴图\\化妆\\milfy Prism cat eye texture + makeup', 'E:\\vrc\\A\\贴图\\6718483Milfy妆容'],
  ['5 真实肤质材质球', 'E:\\vrc\\A\\贴图\\化妆\\真实肤质材质球', 'E:\\vrc\\A\\贴图\\6718483Milfy妆容'],
  ['7 costume pomae', 'E:\\vrc\\A\\衣服', 'E:\\vrc\\A\\衣服\\shinano'],
  ['6 psd 对照', 'E:\\vrc\\A\\衣服\\名流\\材质包 psd', 'E:\\vrc\\A\\衣服\\衣服twinklespica'],
  ['4 4900077 对照', 'E:\\vrc\\A\\贴图\\脸部', 'E:\\vrc\\A\\贴图\\lime']
]

function listing(dir) {
  try {
    const es = fs.readdirSync(dir, { withFileTypes: true })
    return es.map((e) => (e.isDirectory() ? e.name + '/' : e.name))
  } catch (e) {
    return [`<读取失败 ${e.code}>`]
  }
}

for (const [label, dirA, dirB] of cases) {
  console.log(`\n${'='.repeat(76)}\n${label}`)
  for (const d of [dirA, dirB]) {
    console.log(`  📂 ${d}`)
    const es = listing(d)
    // 只打和案情有关的项，目录太长的截断
    const hit = es.filter((n) => /pomae|sexy|skin|prism|材质球|psd|4900077|lime/i.test(n))
    const show = hit.length ? hit : es.slice(0, 12)
    for (const n of show.slice(0, 20)) {
      const full = path.join(d, n)
      let extra = ''
      try {
        const st = fs.statSync(full)
        if (st.isDirectory()) {
          const inner = listing(full)
          extra = `  <dir, ${inner.length} 项> e.g. ${inner.slice(0, 4).join(' | ')}`
        } else extra = `  ${(st.size / 1024).toFixed(0)} KB`
      } catch { /* ignore */ }
      console.log(`      ${n}${extra}`)
    }
    if (es.length > show.length) console.log(`      …共 ${es.length} 项`)
  }
}
