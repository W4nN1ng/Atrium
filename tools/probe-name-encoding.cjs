/**
 * 查清 7z 对 RAR/ZIP 内日文文件名的输出编码 —— 决定 cp932 回退该写在哪一层。
 * 用法：node tools/probe-name-encoding.cjs "<压缩包路径>"
 */
const { execFile } = require('node:child_process')
const path = require('node:path')
const iconv = require('iconv-lite')

const ROOT = path.resolve(__dirname, '..')
const SEVEN = path.join(ROOT, 'resources', 'bin', '7z.exe')
const target = process.argv[2] || 'E:\\vrc\\A\\插件\\shinano表情\\6117553 Shinano_FaceAnimation.rar.rar'

execFile(SEVEN, ['l', '-slt', '-ba', target], { maxBuffer: 32 * 1024 * 1024, encoding: 'buffer' }, (err, outBuf, errBuf) => {
  const out = outBuf
  console.log('exit', err ? err.code : 0, 'bytes', out.length)
  const lines = out.toString('latin1').split(/\r?\n/)
  let shown = 0
  for (const line of lines) {
    if (!line.startsWith('Path = ')) continue
    const idx = lines.indexOf(line)
    // 拿到这一行的原始字节
    let offset = 0
    for (let i = 0; i < idx; i++) offset += Buffer.byteLength(lines[i], 'latin1') + 1
    const raw = out.subarray(offset + 'Path = '.length, offset + Buffer.byteLength(line, 'latin1'))
    console.log('---- Path #' + shown + ' ----')
    console.log('  hex     :', raw.subarray(0, 40).toString('hex'))
    console.log('  cp932   :', iconv.decode(raw, 'cp932'))
    console.log('  gbk     :', iconv.decode(raw, 'gbk'))
    console.log('  utf8    :', raw.toString('utf8'))
    if (++shown >= 4) break
  }
  const e = errBuf.toString('latin1')
  if (e.trim()) console.log('stderr:', e.slice(0, 300))
})
