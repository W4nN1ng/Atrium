#!/usr/bin/env node
/**
 * R4 ② 沙盒活体：**5 张散装 .unitypackage 卡 + 假 Unity**，验规格 §8-4
 * 「多选 5 个 `.unitypackage` → 一键导入 → **串行执行** → 进度可见 → 全部成功」。
 *
 * 全放 D 盘，不碰他任何真实目录（和 `make-m5b-live-tree.cjs` 同一套红线）：
 *  - 库根 `D:\avca-r4-live\library` —— 不碰 `E:\vrc\A`
 *  - APPDATA 重定向 `D:\avca-r4-live\AppData\Roaming` —— **不碰 `%APPDATA%\A\library.db`（真库）**
 *  - 假工程 `D:\avca-r4-live\projects\Shinano-R4LiveTest` —— 不碰 `E:\ALCOMprojects`
 *  - 抽取根 `D:\avca-r4-live\_extracted` —— 不在库内、不在 C 盘
 *
 * ⚠ 跑之前先确认他的 Unity 没开着：沙盒实例**照样会发现真工程**，
 *   而对"运行中"的工程它会发只读的 `list_project_assets`。见 `docs/BRIDGE.md` §13.4。
 *
 * 用法：node tools/make-r4-live-tree.cjs [--print]
 */
const fs = require('node:fs')
const path = require('node:path')
const tar = require('tar')

const ROOT = process.env.AVCA_LIVE_ROOT || 'D:\\avca-r4-live'
if (!/avca-r4-live$/i.test(path.basename(ROOT))) {
  console.error(`拒绝写入：${ROOT}（沙盒根目录名必须是 avca-r4-live）`)
  process.exit(1)
}

const LIB = path.join(ROOT, 'library')
/**
 * 工程名以 `LiveTest` 结尾不是随手起的：`tools/fake-unity-live.cjs` 有一道防呆，
 * 拒绝挂到任何名字不像沙盒工程的对端上（防止哪天真把假 Unity 起在他的工程上）。
 */
const PROJ = path.join(ROOT, 'projects', 'Shinano-R4LiveTest')
const APPDATA = path.join(ROOT, 'AppData', 'Roaming')
const ADATA = path.join(APPDATA, 'A')
const EXTRACT = path.join(ROOT, '_extracted')

/** 和 tests/helpers/containers.ts 的 guidOf 同一个算法，两边不许漂 */
const guidOf = (i) => (i.toString(16).padStart(4, '0') + '0123456789abcdef0123456789abcdef').slice(0, 32)

/**
 * 五张散装卡：磁盘上就是 .unitypackage 文件（不是容器成员），
 * 所以每张的 `cardImportChoice` 都该判成"可直导"，批量那条路才走得起来。
 * 最后一张故意和工程里已有的资源撞 GUID —— 让汇总卡真的出现"有 1 个包有冲突"，
 * 不然测出来的是"永远没冲突"那种太平世界。
 */
const CARDS = [
  { file: 'Shinano_Hair', dir: '道具', base: 0x100, entries: ['Assets/Shinano/R4/Hair/Ponytail.txt', 'Assets/Shinano/R4/Hair/Notes.json'] },
  { file: 'Shinano_Face', dir: '道具', base: 0x200, entries: ['Assets/Shinano/R4/Face/Smile.txt'] },
  { file: 'Manuka_Dress', dir: '服装', base: 0x300, entries: ['Assets/Manuka/R4/Dress.txt', 'Assets/Manuka/R4/Dress.json'] },
  { file: 'Milfy_Makeup', dir: '贴图', base: 0x400, entries: ['Assets/Milfy/R4/Makeup.txt', 'Assets/Milfy/R4/Makeup.csv'] },
  { file: 'Liltoon_Shader', dir: '着色器', base: 0x500, entries: ['Assets/Liltoon/R4/lilToon.shader'] }
]

function rmMine(dir) {
  fs.rmSync(dir, { recursive: true, force: true })
}

/**
 * 包内条目一律用"Unity 读文本就能收下"的类型（TextAsset / Shader）。
 *
 * 为什么不用 .fbx / .anim / .mat / .prefab：这些要靠真 YAML 或真二进制才导得动，
 * 假内容会被 Unity 直接拒收（"does not have a valid GUID and its corresponding Asset file
 * will be ignored"），那时候测的是 Unity 的导入器而不是 A 的链路 ——
 * §8-3/8-6/8-7 要验的是"createdGuids 差集算得对、冲突列得对、撤销删得干净"，
 * 用 TextAsset 反而最干净：**GUID 一定按包里那个落地，没有第二种可能**。
 */
function bodyFor(unityPath) {
  const ext = path.extname(unityPath).toLowerCase()
  if (ext === '.shader') {
    return 'Shader "AVCA/R4Live/' + path.basename(unityPath, ext) + '" {\n  Properties {}\n  SubShader { Pass { } }\n}\n'
  }
  if (ext === '.json') return '{\n  "madeBy": "make-r4-live-tree",\n  "path": "' + unityPath + '"\n}\n'
  if (ext === '.xml') return '<?xml version="1.0" encoding="utf-8"?>\n<avca path="' + unityPath + '" />\n'
  if (ext === '.csv') return 'a,b\n1,2\n'
  return 'R4 沙盒活体用的占位文本资源：' + unityPath + '\n'
}

async function buildPackage(file, spec) {
  const stage = path.join(ROOT, '.stage', spec.file)
  rmMine(stage)
  fs.mkdirSync(stage, { recursive: true })
  spec.entries.forEach((unityPath, i) => {
    const guid = guidOf(spec.base + i)
    const dir = path.join(stage, guid)
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'pathname'), unityPath)
    fs.writeFileSync(path.join(dir, 'asset'), bodyFor(unityPath))
    /**
     * `.meta` 里**必须带 guid**。真包就是这么存的：外层目录名 = GUID，`asset.meta` 里再写一遍。
     * 只写 `fileFormatVersion: 2` 的话，真 Unity 会当它是坏 meta 直接忽略这个文件
     * （沙盒活体第一次跑 §8-3 就是这么撞的：文件铺进来了、`createdGuids` 却是空的）。
     */
    fs.writeFileSync(path.join(dir, 'asset.meta'), 'fileFormatVersion: 2\nguid: ' + guid + '\n')
  })
  await tar.c({ gzip: true, cwd: stage, file, prefix: './' }, fs.readdirSync(stage))
  rmMine(stage)
  return file
}

async function main() {
  const manifest = {
    sandbox: ROOT,
    libraryRoot: LIB,
    extractRoot: EXTRACT,
    projectPath: PROJ,
    appData: APPDATA,
    cards: CARDS.map((c) => ({
      file: path.join(LIB, c.dir, c.file + '.unitypackage'),
      entries: c.entries.map((e, i) => ({ guid: guidOf(c.base + i), unityPath: e }))
    })),
    /** 工程里预先存在的那一个：第 5 张卡导入时会撞它 */
    preexisting: { guid: guidOf(0x500), unityPath: 'Assets/Liltoon/R4/lilToon.shader' }
  }
  if (process.argv.includes('--print')) {
    console.log(JSON.stringify(manifest, null, 2))
    return
  }

  /**
   * `--packages-only`：**只重造那 5 个 .unitypackage**，沙盒的库 / 日志 / 工程一概不动。
   * 默认那一支会 `rmMine(ROOT)` 把整个沙盒抹掉 —— 已经跑过活体、库里已经有素材行的时候
   * 用它等于把上一轮的现场一起删了（真踩过）。GUID 由 `guidOf(base+i)` 决定，
   * 只改包内 `.meta` 内容不改目录名，所以库里已有的 `package_entry` 仍然对得上。
   */
  if (process.argv.includes('--packages-only')) {
    for (const c of CARDS) {
      fs.mkdirSync(path.join(LIB, c.dir), { recursive: true })
      await buildPackage(path.join(LIB, c.dir, c.file + '.unitypackage'), c)
      console.log('  重造 ' + c.file + '.unitypackage')
    }
    console.log('（只重造了包，沙盒其余部分没碰）')
    return
  }

  rmMine(ROOT)
  for (const c of CARDS) fs.mkdirSync(path.join(LIB, c.dir), { recursive: true })
  fs.mkdirSync(path.join(ROOT, 'projects'), { recursive: true })
  fs.mkdirSync(ADATA, { recursive: true })
  fs.mkdirSync(EXTRACT, { recursive: true })

  for (const c of CARDS) await buildPackage(path.join(LIB, c.dir, c.file + '.unitypackage'), c)

  /** —— 假 Unity 工程 —— */
  for (const d of ['Assets', 'Packages', 'ProjectSettings', 'Temp']) fs.mkdirSync(path.join(PROJ, d), { recursive: true })
  fs.writeFileSync(path.join(PROJ, 'ProjectSettings', 'ProjectVersion.txt'), 'm_EditorVersion: 2022.3.22f1\n')
  fs.writeFileSync(
    path.join(PROJ, 'Packages', 'manifest.json'),
    JSON.stringify({ dependencies: { 'com.avca.bridge': 'file:com.avca.bridge' } }, null, 2)
  )
  const tpl = path.resolve(__dirname, '..', 'resources', 'unity-bridge', 'com.avca.bridge')
  fs.cpSync(tpl, path.join(PROJ, 'Packages', 'com.avca.bridge'), { recursive: true })
  /**
   * 预先放一个同 GUID 的资源，让第 5 张卡真的撞车。
   * 内容用**真能编译的 ShaderLab**：假 YAML 会被 Unity 忽略，那样 `resolve_guids`
   * 找不到这个 GUID，"有冲突"那条就永远测不到。
   */
  const pre = path.join(PROJ, 'Assets', 'Liltoon', 'R4')
  fs.mkdirSync(pre, { recursive: true })
  fs.writeFileSync(path.join(pre, 'lilToon.shader'), bodyFor('Assets/Liltoon/R4/lilToon.shader'))
  fs.writeFileSync(path.join(pre, 'lilToon.shader.meta'), `fileFormatVersion: 2\nguid: ${manifest.preexisting.guid}\n`)

  /** —— 设置：库根 / 抽取根 / 工程根全指沙盒 —— */
  const settings = {
    language: 'zh-CN',
    libraryLocale: 'zh-CN',
    theme: 'dark',
    libraryRoot: LIB,
    extractRoot: EXTRACT,
    projectRoots: [path.join(ROOT, 'projects')],
    storageMode: 'indexed',
    autoArchive: false,
    autoExtract: false,
    autoLaunch: false,
    backupOverwritten: true,
    confirmBeforeImport: true,
    bridgeAutoInstall: false,
    onboardingDone: true,
    unityExePath: ''
  }
  fs.writeFileSync(path.join(ADATA, 'settings.json'), JSON.stringify(settings, null, 2))
  fs.writeFileSync(path.join(ROOT, 'live-manifest.json'), JSON.stringify(manifest, null, 2))

  console.log('R4 沙盒已造好：')
  console.log('  库根   ' + LIB)
  console.log('  工程   ' + PROJ)
  console.log('  抽取根 ' + EXTRACT)
  console.log('  APPDATA ' + APPDATA)
  for (const c of manifest.cards) console.log('  卡 ' + c.file + '（' + fs.statSync(c.file).size + ' 字节，' + c.entries.length + ' 个文件）')
  console.log('  预先存在（会撞车）：' + manifest.preexisting.unityPath + '  guid=' + manifest.preexisting.guid.slice(0, 8) + '…')
}

main().catch((e) => {
  console.error('FAILED: ' + (e && e.message ? e.message : e))
  process.exit(1)
})
