/**
 * 造一棵照「增量改动单 §6 验收标准」抄的沙盒树，用来验三级模型：
 * 合集 ─ 子项 ─ 版本。
 *
 * 每一条都对着 §6 的一条验收：
 *   3  插件道具合集-初音的VRC小店 → 1 张合集卡（不是 17 张）
 *   4  StoZeroCustomEX 三个包 → 1 个子项 / 3 个版本
 *   5  R5613 武器合集 → 1 张合集卡，子项名是 INVICTA 而不是 4952737
 *   6  衣服/27 的 Grimoir → 1 个子项 / 11 个 avatar 变体，Hat 和 Gimmick 各自独立
 *   7  ABT 左手用 / 右手用 → 2 个子项（不许并成版本）
 *
 * 用法：node tools/make-bundle-tree.cjs [目标目录]      默认 E:/vrc/test/bundles
 * 只往目标目录写，绝不碰 E:/vrc/A。
 */
const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')

const ROOT = process.argv[2] || 'E:/vrc/test/bundles'
const BIN = path.resolve(__dirname, '..', 'resources', 'bin')

function ensureDir(d) {
  fs.mkdirSync(d, { recursive: true })
}

function write(file, bytes = 64) {
  ensureDir(path.dirname(file))
  fs.writeFileSync(file, Buffer.alloc(bytes, 7))
}

/** 真的 zip（让流水线走压缩包分支；里面塞一个同名占位文件） */
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

function unitypkg(file, bytes = 4096) {
  // 不是真包，只给流水线一个"看起来像"的文件；解析失败会走降级分支，不影响三级模型验收
  write(file, bytes)
}

let count = 0
function unit(dir, files) {
  for (const f of files) {
    if (f.endsWith('.zip')) zip(path.join(dir, f), path.basename(f, '.zip') + '.txt', 48)
    else if (f.endsWith('.unitypackage')) unitypkg(path.join(dir, f))
    else write(path.join(dir, f), 64)
    count++
  }
}

fs.rmSync(ROOT, { recursive: true, force: true })
ensureDir(ROOT)

// ── §6.3 / §6.4：初音的VRC小店（判据①名字写着合集；里面混着嵌套容器和多版本子项）
const shop = path.join(ROOT, '插件道具合集-初音的VRC小店')
unit(path.join(shop, 'DMCustom_PCS_v1.10.0'), ['(Modular) PCS v1.10.0.unitypackage', '(VRCFury) PCS v1.10.0.unitypackage'])
unit(path.join(shop, 'GoLoco.v.1.8.6u'), ['GoLoco.v.1.8.6u.unitypackage'])
unit(shop, ['SPS_V2.7.4.zip', '佳兔工具箱v2.7.0版本.unitypackage', '闲鱼-初音的VRC小店.png'])
unit(path.join(shop, '道具22件'), ['a.prefab', 'b.mat', 'c.png'])
unit(path.join(shop, 'ERP用12件'), ['a.prefab', 'b.mat', 'c.png'])
unit(path.join(shop, '插件17件'), ['a.prefab', 'b.mat', 'c.png'])
unit(path.join(shop, '更新'), ['a.prefab', 'b.mat', 'c.png'])
unit(path.join(shop, '重要！'), ['a.prefab', 'b.mat', 'c.png'])

// ── §6.5：Booth 数字 ID 目录套商品目录，要穿透取真名
const weapons = path.join(ROOT, 'R5613-VRChat-武器合集（军事武器合集）')
for (const [id, name] of [['4952737', 'INVICTA'], ['4185283', 'M4A1'], ['4211200', 'MP5'], ['4399206', 'AK12']]) {
  unit(path.join(weapons, id, name), ['mesh.fbx', 'mat.mat', 'tex.png'])
}

// ── §6.6：Grimoir 11 个体型 + Hat + Gimmick（后两个必须独立）
const gr = path.join(ROOT, '衣服', '27')
for (const a of ['AIRI', 'CHIFFON', 'KIKYO', 'MANUKA', 'MILLTINA', 'MOE', 'RURUNE', 'SELESTIA', 'SHINANO', 'SHINRA', 'SIO']) {
  unit(path.join(gr, `Grimoir_${a}_V1.0`), ['mesh.fbx', 'mat.mat'])
}
unit(gr, ['Grimoir_Hat_V1.0.zip', 'Grimoir_Gimmick_V1.0.zip'])

// ── §6.7：ABT 左手用 / 右手用 是两个子项，不是版本
// 位置照真库：插件/动作类/ABT 1.3.0…/ —— 深度得够，扫描才会把这一目录当成一个单元报上来
unit(path.join(ROOT, '插件', '动作类', 'ABT 1.3.0【汉化 闲鱼@月见汐音】'), [
  'ABT 左手用【汉化 闲鱼@月见汐音】.unitypackage',
  'ABT 右手用【汉化 闲鱼@月见汐音】.unitypackage',
  'ABT 右手用 无姿势【汉化 闲鱼@月见汐音】.unitypackage'
])

// ── §6.4 的正主：同一个包的三个版本
// 真库里这件就在 插件/道具22件/6159895摇后会喷的酒/ —— 容器只套一层，扫描要钻到商品那层
const sto = path.join(ROOT, '插件', '道具22件', '6159895摇后会喷的酒')
unit(sto, ['StoZeroCustomEX.zip', 'StoZeroCustomEX_v1.01.zip', 'StoZeroCustomEX_v1.10.zip', 'cover.png', 'shop-watermark.png'])

const bytes = (function size(d) {
  let n = 0
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const abs = path.join(d, e.name)
    n += e.isDirectory() ? size(abs) : fs.statSync(abs).size
  }
  return n
})(ROOT)

console.log(`沙盒树：${ROOT}`)
console.log(`文件 ${count} 个 / ${(bytes / 1048576).toFixed(1)} MB`)
console.log('顶层：', fs.readdirSync(ROOT).join(' | '))
