/**
 * 造一棵"像真库那样"的沙盒树，用来测收编（重新登记 → 自动归档 → 撤销）。
 * 形状是照 E:\vrc\A 实测出来的层级抄的：顶层是用户自己起的中文目录名，
 * 素材在第三层往下，中间还夹着已经解压成散文件的目录、rar 套 rar、同产品多体型。
 *
 * 用法：node tools/make-reclaim-tree.cjs [目标目录]
 * 只读真库，绝不往 E:\vrc\A 写任何东西。
 */
const fs = require('node:fs')
const path = require('node:path')

const R = process.argv[2] || 'E:/vrc/test/reclaim'
const SRC = 'E:/vrc/test/library'
const INBOX = 'E:/vrc/test/inbox'
const GRIM = path.join(SRC, '服装/套装/Grimoir SHINANO/Grimoir_SHINANO_V1.0.zip')
const RAR = path.join(SRC, '插件/表情类/Shinano FaceAnimation/6117553 Shinano_FaceAnimation.rar.rar')
const CHAINA = path.join(SRC, '材质/MatCap/束縛チャイナFULLSET/束縛チャイナFULLSET.zip')
// ABT 那件在撤销测试里被搬回 inbox 了，两处都找一下
const ABTPKG = [
  path.join(SRC, '插件/动作类/ABT/ABT 1.3.0【汉化 闲鱼@月见汐音】/ABT 右手用【汉化 闲鱼@月见汐音】.unitypackage'),
  path.join(INBOX, 'ABT 1.3.0【汉化 闲鱼@月见汐音】/ABT 右手用【汉化 闲鱼@月见汐音】.unitypackage')
].find(fs.existsSync)

for (const f of [GRIM, RAR, CHAINA, ABTPKG]) {
  if (!f || !fs.existsSync(f)) {
    console.error('缺原件（先从真库只读复制一份到沙盒 inbox/library 再跑）')
    process.exit(1)
  }
}
const mk = (p) => fs.mkdirSync(p, { recursive: true })
const cp = (src, dst) => {
  mk(path.dirname(dst))
  fs.copyFileSync(src, dst)
}
const put = (p, buf) => {
  mk(path.dirname(p))
  fs.writeFileSync(p, buf)
}

fs.rmSync(R, { recursive: true, force: true })

// 1) 同一产品的多个体型各占一个目录（归并要吃下这个）
for (const av of ['SHINANO', 'CHIFFON', 'MIZUKI']) cp(GRIM, R + '/衣服/27/Grimoir_' + av + '_V1.0/Grimoir_' + av + '_V1.0.zip')
put(R + '/衣服/27/材质/readme.txt', Buffer.alloc(3000, 0x41))
// 2) rar 套 rar + 一个已经解压过的兄弟目录
cp(RAR, R + '/插件/shinano表情/6117553 Shinano_FaceAnimation.rar/6117553 Shinano_FaceAnimation.rar.rar')
cp(ABTPKG, R + '/插件/shinano表情/ShinanoTouchbyshiio/touch.unitypackage')
// 3) 已经解压成几十个散文件的插件目录（要当一个素材，不是几十个）
for (let i = 0; i < 40; i++) put(R + '/插件/ovr汉化/AdvancedSettings-5.8.11/Editor/Asset' + i + '.cs', Buffer.alloc(600, 0x43))
put(R + '/插件/ovr汉化/AdvancedSettings-5.8.11/package.json', Buffer.from('{"name":"com.avca.advsettings","version":"5.8.11","displayName":"Advanced Settings"}'))
// 4) 混装合集里按 Booth id 命名的几件
cp(CHAINA, R + '/插件道具合集-初音的VRC小店/插件17件/5534236JustKissSFX/JustKissSFX.zip')
cp(ABTPKG, R + '/插件道具合集-初音的VRC小店/插件17件/5408028手势拓展/gesture.unitypackage')
// 5) 顶层直接放着的散文件
cp(GRIM, R + '/贴图/随手放的.unitypackage')

const out = []
;(function w(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const a = path.join(d, e.name)
    if (e.isDirectory()) w(a)
    else out.push(path.relative(R, a) + '|' + fs.statSync(a).size)
  }
})(R)
out.sort()
fs.writeFileSync(path.join(__dirname, 'reclaim-before.txt'), out.join('\n'))
console.log('沙盒收编树已生成：' + out.length + ' 个文件（清单存 tools/reclaim-before.txt）')
