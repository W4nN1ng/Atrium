#!/usr/bin/env node
/**
 * R4 ③ 沙盒活体：**改分类搬文件**的取证现场。
 *
 * 全放 D 盘，一个真实目录都不碰（和 `make-r4-live-tree.cjs` 同一套红线）：
 *  - 库根   `D:\avca-r4-move\library`   —— **不是** `E:\vrc\A`
 *  - APPHOME `D:\avca-r4-move\AppData\Roaming\A` —— 不是他的真库
 *  - 投料区 `D:\avca-r4-move\drop`      —— 入库时被真的搬走（move=true 那条）
 *  - 抽取根 / 工程根 全在沙盒里
 *
 * 造四类现场，正好把这一轮的三条分支都踩到：
 *  1. 三件 **归档模式**（真搬进库）的素材 —— 「改分类 → 预览 → 搬过去 → Ctrl+Z」；
 *  2. 一件 **只登记不搬**（indexed）的素材 —— 「改分类 → 不该搬 → 只改记录 + 把原因说出来」；
 *  3. 目标分类的目录**故意预先建好**（`配饰/头饰`）—— 让"新建分类目录"那条清理路径也有账。
 *
 * ⚠ 跑之前确认他的 Unity 没开着（沙盒实例照样会发现真工程，见 docs/BRIDGE.md §13.4）。
 *
 * 用法：node tools/make-r4-move-tree.cjs [--print]
 */
const fs = require('node:fs')
const path = require('node:path')

const ROOT = process.env.AVCA_LIVE_ROOT || 'D:\\avca-r4-move'
if (!/avca-r4-move$/i.test(path.basename(ROOT))) {
  console.error(`拒绝写入：${ROOT}（沙盒根目录名必须是 avca-r4-move）`)
  process.exit(1)
}

const LIB = path.join(ROOT, 'library')
const DROP = path.join(ROOT, 'drop')
const APPDATA = path.join(ROOT, 'AppData', 'Roaming')
const ADATA = path.join(APPDATA, 'A')
const EXTRACT = path.join(ROOT, '_extracted')

/**
 * 投料区里放的都是**散装目录**（不是压缩包），因为这一轮要验的是"整棵目录跟着分类走"，
 * 压缩包那条链在 R4 ② 已经验过。每个目录里放几个真文件，字节数才能被预览报出来。
 */
const ITEMS = [
  { dir: 'MatCap Vol.3', files: { 'matcap_a.png': 4096, 'matcap_b.png': 4096, '说明.txt': 120 } },
  { dir: '束縛チャイナ FULLSET', files: { 'dress.fbx': 8192, 'dress.mat': 2048, 'cover.png': 1024 } },
  { dir: 'Shinano_Hair_Pack', files: { 'hair.fbx': 6144, 'hair.mat': 512 } },
  // 这一件走"只登记不搬"，留在投料区不动
  { dir: 'Indexed_Only_Scania', files: { 'readme.md': 256 } }
]

function write(file, bytes) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, Buffer.alloc(bytes, 0x5a))
}

function main() {
  const manifest = {
    sandbox: ROOT,
    libraryRoot: LIB,
    dropRoot: DROP,
    extractRoot: EXTRACT,
    appHome: ADATA,
    archived: ITEMS.slice(0, 3).map((i) => path.join(DROP, i.dir)),
    indexed: path.join(DROP, ITEMS[3].dir),
    /** 预先存在的目标分类目录（让 createdDirs 那条清理路径也有账可查） */
    prebuiltTarget: path.join(LIB, '配饰', '头饰')
  }
  if (process.argv.includes('--print')) {
    console.log(JSON.stringify(manifest, null, 2))
    return
  }

  fs.rmSync(ROOT, { recursive: true, force: true })
  fs.mkdirSync(LIB, { recursive: true })
  fs.mkdirSync(DROP, { recursive: true })
  fs.mkdirSync(EXTRACT, { recursive: true })
  fs.mkdirSync(ADATA, { recursive: true })
  /** 目标分类的顶层目录预先建好，但**素材目录**不建 —— 建的是"分类已在、位置要新"这一档 */
  fs.mkdirSync(manifest.prebuiltTarget, { recursive: true })

  for (const it of ITEMS) {
    for (const [name, size] of Object.entries(it.files)) write(path.join(DROP, it.dir, name), size)
  }

  const settings = {
    language: 'zh-CN',
    libraryLocale: 'zh-CN',
    theme: 'dark',
    libraryRoot: LIB,
    dirTemplate: '{category}/{subcategory}/{name}',
    extractRoot: EXTRACT,
    /** 工程扫描根指到沙盒里一个空目录：这一轮用不到 Unity，别让沙盒实例去发现他的真工程 */
    projectRoots: [path.join(ROOT, 'projects-none')],
    storageMode: 'archived',
    autoArchive: false,
    autoExtract: false,
    autoLaunch: false,
    autoSwitchBehavior: 'off',
    minimizeToTray: false,
    backupOverwritten: true,
    confirmBeforeImport: true,
    bridgeAutoInstall: false,
    onboardingDone: true,
    unityExePath: ''
  }
  fs.mkdirSync(path.join(ROOT, 'projects-none'), { recursive: true })
  fs.writeFileSync(path.join(ADATA, 'settings.json'), JSON.stringify(settings, null, 2))
  fs.writeFileSync(path.join(ROOT, 'live-manifest.json'), JSON.stringify(manifest, null, 2))

  console.log('R4 ③ 沙盒已造好：')
  console.log('  库根   ' + LIB)
  console.log('  投料区 ' + DROP)
  console.log('  APPHOME ' + ADATA)
  console.log('  预建目录 ' + manifest.prebuiltTarget)
  for (const p of manifest.archived) console.log('  归档投料 ' + p + '（' + fs.readdirSync(p).length + ' 个文件）')
  console.log('  登记投料 ' + manifest.indexed)
}

main()
