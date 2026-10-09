/**
 * 造一棵照「增量改动单 2 §A0 / §B0 验收标准」抄的沙盒树。
 *
 * 每一条都对着 05 的验收：
 *   1/2  6866030亲亲音效+亲吻时产生爱心粒子 → 1 张卡，名字 Kiss Sound Gimmick，3 图 1 视频进附属
 *   3    .DS_Store / Thumbs.db / __MACOSX 完全不存在
 *   4    Editor/SkinnedMeshMover.cs 不再单独成卡
 *   5    lilToon 目录 → 1 张卡 + Readme.html/Distribution.png/【重要】…html 当附属
 *   6/7  名流 20 个 Libero → 1 张归并型容器卡，进去看得到 20 个变体
 *   9    Chiffon&Chocolat / Milfy&Eku 两个模型名都认出来
 *   10   衣服TwinkleSpica 同前缀 → 建议合并横幅（不自动并）
 *   裁定16 名流/材质包 PSD 嵌套容器 → 活体跑一次"容器里还有容器"
 *
 * 用法：node tools/make-attach-tree.cjs [目标目录]     默认 E:/vrc/test/attach
 * 只往目标目录写，绝不碰 E:/vrc/A。
 */
const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')

const ROOT = process.argv[2] || 'E:/vrc/test/attach'
const BIN = path.resolve(__dirname, '..', 'resources', 'bin')

function ensureDir(d) {
  fs.mkdirSync(d, { recursive: true })
}

/**
 * 一张真的 1x1 PNG。附属资源要能被封面流水线读进去（`nativeImage` 读假数据返回空图，
 * 空图会被 `isEmpty()` 判掉、永远不进缓存），所以介绍图必须是真的能解码的图，
 * 不然"第一张当封面"这条根本验不到。
 */
const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
)

function write(file, bytes = 64) {
  ensureDir(path.dirname(file))
  fs.writeFileSync(file, Buffer.alloc(bytes, 7))
}

function png(file) {
  ensureDir(path.dirname(file))
  fs.writeFileSync(file, PNG_1PX)
}

function zip(file, inner = 'payload.txt', bytes = 48) {
  ensureDir(path.dirname(file))
  const tmp = path.join(fs.mkdtempSync(path.join(require('os').tmpdir(), 'avca-z-')), 'x')
  ensureDir(tmp)
  write(path.join(tmp, inner), bytes)
  const exe = ['7z.exe', '7za.exe'].map((n) => path.join(BIN, n)).find(fs.existsSync)
  if (!exe) throw new Error('找不到 resources/bin/7z*.exe，先跑 node tools/fetch-7z.cjs')
  execFileSync(exe, ['a', '-tzip', '-y', file, inner], { cwd: tmp, stdio: ['ignore', 'pipe', 'pipe'] })
  fs.rmSync(path.dirname(tmp), { recursive: true, force: true })
}

/** 不是真包，只给流水线一个"看起来像"的文件；解析失败会走降级分支，不影响附属/归并判定 */
function unitypkg(file, bytes = 4096) {
  write(file, bytes)
}

let count = 0
function touch(file, kind) {
  if (kind === 'png') png(file)
  else if (kind === 'zip') zip(file)
  else if (kind === 'upk') unitypkg(file)
  else write(file, kind === 'big' ? 65536 : 64)
  count++
}

fs.rmSync(ROOT, { recursive: true, force: true })
ensureDir(ROOT)

// ---------------------------------------------------------------- 验收 1/2：亲亲音效
const kiss = path.join(ROOT, '插件', '交互类', '6866030亲亲音效+亲吻时产生爱心粒子')
touch(path.join(kiss, 'Kiss_Sound_Gimmick_1.0', 'Kiss Sound Gimmick 1.0.unitypackage'), 'upk')
touch(path.join(kiss, '29d6e178-9672-4af7-b1e7-2909aaaa0001.jpg'), 'png')
touch(path.join(kiss, '56374c06-5b70-44bd-979c-f1d8aaaa0002.jpg'), 'png')
touch(path.join(kiss, 'd6b99874-3687-4746-8eca-21c8050c74a0.jpg'), 'png')
touch(path.join(kiss, 'Kiss_Sound_Gimmick_1.0.zip'), 'zip')
touch(path.join(kiss, 'Kissギミック.mp4'), 'big')

// ---------------------------------------------------------------- 验收 3：垃圾
const junky = path.join(ROOT, '插件', '动作类', '带垃圾的素材')
touch(path.join(junky, 'Tool.unitypackage'), 'upk')
touch(path.join(junky, 'readme.txt'), 'txt')
touch(path.join(junky, 'booth_item.url'), 'txt')
touch(path.join(junky, '.DS_Store'), 'txt')
touch(path.join(junky, 'Thumbs.db'), 'txt')
touch(path.join(junky, 'desktop.ini'), 'txt')
touch(path.join(junky, '__MACOSX', '._Tool.unitypackage'), 'txt')
touch(path.join(junky, '__MACOSX', 'sub', '_other.txt'), 'txt')

// ---------------------------------------------------------------- 验收 4：纯脚本目录
const editor = path.join(ROOT, 'Editor')
touch(path.join(editor, 'SkinnedMeshMover.cs'), 'txt')
touch(path.join(editor, 'SkinnedMeshMover.cs.meta'), 'txt')
touch(path.join(editor, 'HeadAccessoryMover.cs'), 'txt')
touch(path.join(editor, 'HeadAccessoryMover.cs.meta'), 'txt')

// ---------------------------------------------------------------- 验收 5：lilToon
const lil = path.join(ROOT, '着色器', 'lilToon_2.x.x')
touch(path.join(lil, 'Assets', 'lilToon', 'lilToon.shader'), 'txt')
touch(path.join(lil, 'Assets', 'lilToon', 'Shader', 'lilCommon.hlsl'), 'txt')
touch(path.join(lil, 'Assets', 'lilToon', 'Editor', 'lilInspector.cs'), 'txt')
touch(path.join(lil, 'Readme.html'), 'txt')
touch(path.join(lil, 'Distribution.png'), 'png')
touch(path.join(lil, '【重要】以前のバージョンをお使いの方へ.html'), 'txt')
touch(path.join(lil, 'package.json'), 'txt')

// ---------------------------------------------------------------- 验收 6/7/9：名流 20 个 Libero
const SER = 'ATTITUDE The Royal Bunny'
const MODELS = [
  ['Airi', '1.03'],
  ['Chiffon&Chocolat', '1.02'],
  ['Ichigo', '1.01'],
  ['KipfelMame', '1.00'], // 真库里 `&` 写丢了的那个，靠驼峰拆
  ['Kumaly', '1.00'],
  ['Lasyusha', '1.01'],
  ['Lumina', '1.00'],
  ['Manuka', '1.03'],
  ['Milfy&Eku', '1.01'],
  ['Milltina', '1.02'],
  ['Misaki', '1.00'],
  ['Moe', '1.04'],
  ['Nemesis&Elusion', '1.00'],
  ['Ramune', '1.00'],
  ['Rurune&Mizuki', '1.00'],
  ['Selestia', '1.01'],
  ['Shinano', '1.00'],
  ['Shinra', '1.01'],
  ['Sio', '1.02'],
  ['Sion', '1.01']
]
const mingliu = path.join(ROOT, '衣服', '名流')
for (const [m, v] of MODELS) touch(path.join(mingliu, 'Libero[' + m + '_' + SER + ']_' + v + '.unitypackage'), 'upk')
touch(path.join(mingliu, SER + '.jpg'), 'png')
// 裁定 16：容器里还有容器 —— 嵌套那一层的第 21 个 Libero + 一个不是 Libero 的产品
const nested = path.join(mingliu, '材质包 PSD')
touch(path.join(nested, 'Libero[Material_' + SER + ']_1.00.unitypackage'), 'upk')
touch(path.join(nested, 'ATTITUDE_Stocking no Lace.unitypackage'), 'upk')
touch(path.join(nested, 'PSD', 'UV1.psd'), 'big')
touch(path.join(nested, 'UV', 'UV3_Normal.png'), 'png')

// ---------------------------------------------------------------- 验收 10：同前缀建议合并
const twinkle = path.join(ROOT, '衣服', '衣服TwinkleSpica')
for (const [m, v] of [
  ['Chiffon', '1.1'], ['Eku', '1.1'], ['Lime', '1.1'], ['Manuka', '1.1'], ['Manuka', '1.3'],
  ['Mint', '1.1'], ['Plum', '1.1'], ['Milk', '1.1'], ['Karin', '1.1'], ['Shinano', '1.1']
]) touch(path.join(twinkle, 'TwinkleSpica_' + m + '_v' + v + '.zip'), 'zip')

// ---------------------------------------------------------------- §A5：全是图/文档 → 一张参考资料卡
const refimg = path.join(ROOT, '参考资料', '参考图')
touch(path.join(refimg, 'ref01.jpg'), 'png')
touch(path.join(refimg, 'ref02.png'), 'png')
touch(path.join(refimg, 'notes.md'), 'txt')

// ---------------------------------------------------------------- §B2 闸门③的活体材料：三种前缀塌成同一个 key
const ambig = path.join(ROOT, '衣服', '歧义试验')
for (const p of ['Shinano', 'Manuka', 'Moe']) {
  touch(path.join(ambig, p + '[X_Same Series]_1.0.zip'), 'zip')
}

console.log('造好 ' + count + ' 个文件 → ' + ROOT)
console.log('  名流 = ' + MODELS.length + ' 个 Libero + 1 张系列封面 + 嵌套 材质包 PSD/ 2 个包')
console.log('  待验的卡片：1 亲亲音效 / 1 带垃圾的素材 / 1 Editor / 1 lilToon / 1 名流容器 / 10 TwinkleSpica / 1 参考图')
