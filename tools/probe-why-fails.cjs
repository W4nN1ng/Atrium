/**
 * 只读诊断：为什么某个压缩包 7z 列不出来（M5-B 的错误分类要靠真实样本）。
 * 用法：node tools/probe-why-fails.cjs
 */
const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')
const SEVEN = path.resolve(__dirname, '..', 'resources', 'bin', '7z.exe')

const LIB = 'E:\\vrc\\A'
const files = [
  path.join(LIB, '衣服', 'shinano', 'Texture_Package.zip'),
  path.join(LIB, '衣服', 'shinano', 'Shinano_Guidance.zip')
]

for (const f of files) {
  console.log('---', path.basename(f), fs.existsSync(f) ? `${(fs.statSync(f).size / 1048576).toFixed(1)} MB` : '不存在')
  try {
    const o = execFileSync(SEVEN, ['l', '-slt', '-ba', '--', f], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    })
    console.log('  能列出来，前几行：', o.split(/\r?\n/).slice(0, 4).join(' / ').slice(0, 200))
  } catch (e) {
    const so = String(e && e.stdout ? e.stdout : '')
    const se = String(e && e.stderr ? e.stderr : '')
    console.log('  退出码', e && e.status)
    console.log('  stdout:', so.replace(/\s+/g, ' ').slice(0, 300))
    console.log('  stderr:', se.replace(/\s+/g, ' ').slice(0, 300))
    console.log('  method:', /Method = /.test(so) ? so.match(/Method = .*/g).slice(0, 3).join(' ; ') : '(无)')
  }
}
