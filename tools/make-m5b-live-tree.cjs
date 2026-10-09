#!/usr/bin/env node
/**
 * M5-B ⑦ 沙盒活体：**造一个和环境隔离的假库 + 假工程**，让真程序在上面点一遍成员选择面板。
 *
 * 为什么全放 D 盘而不是他任何真实目录（红线，逐条对上）：
 *  - 库根 `D:\avca-m5b-live\library` —— 不碰 `E:\vrc\A`（他的 25 GB 真库）
 *  - APPDATA 重定向到 `D:\avca-m5b-live\AppData\Roaming` —— **不碰 `%APPDATA%\A\library.db`（真库 372 行）**
 *  - 假工程 `D:\avca-m5b-live\projects\Shinano-LiveTest` —— 不碰 `E:\ALCOMprojects` 里 8 个真工程
 *  - 抽取根 `D:\avca-m5b-live\_extracted` —— 不在库内、不在 C 盘，三道闸门按原样过
 *
 * 里面装的 .unitypackage 是**按真形状造的**（gzip + tar + `./` 前缀 + pathname/asset/asset.meta），
 * 和 `tests/helpers/containers.ts` 同一套写法 —— 夹具造假会让有 bug 的代码照样通过，
 * 这条教训已经记在 M3/M5 的备忘里。
 *
 * 用法：
 *   node tools/make-m5b-live-tree.cjs            # 造（已存在则先删掉自己造的沙盒），默认 3 个成员
 *   AVCA_M5B_MEMBERS=10 node tools/make-m5b-live-tree.cjs   # 多塞成员：>8 就会自动切两批（第 4 轮）
 *   node tools/make-m5b-live-tree.cjs --print    # 只打印 GUID / 路径清单（喂给 fake-unity）
 */
const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const tar = require('tar')

const ROOT = process.env.AVCA_LIVE_ROOT || 'D:\\avca-m5b-live'
/** 防呆：这个脚本只会往名字里带 avca-m5b-live 的目录写，别的目录一律拒绝 */
if (!/avca-m5b-live$/i.test(path.basename(ROOT))) {
  console.error(`拒绝写入：${ROOT}（沙盒根目录名必须是 avca-m5b-live）`)
  process.exit(1)
}

const LIB = path.join(ROOT, 'library')
const PROJ = path.join(ROOT, 'projects', 'Shinano-LiveTest')
const APPDATA = path.join(ROOT, 'AppData', 'Roaming')
const ADATA = path.join(APPDATA, 'A')
const EXTRACT = path.join(ROOT, '_extracted')
const BIN = path.resolve(__dirname, '..', 'resources', 'bin')

/** 和 tests/helpers/containers.ts 的 guidOf 同一个算法，两边不许漂 */
const guidOf = (i) => (i.toString(16).padStart(4, '0') + '0123456789abcdef0123456789abcdef').slice(0, 32)

/**
 * 成员清单。前三个就是 M5-B ⑦ 那一轮的形状（工程里预置的"撞车"资源用的是 `MEMBERS[0]` 的 GUID，
 * 顺序不许动）。
 *
 * `AVCA_M5B_MEMBERS=10` 会往后多造几个 —— 第 4 轮要测的就是**一批装不下**的样子：
 * `IMPORT_BATCH_MAX = 8`，10 个成员必须自动切成 8 + 2 两批、一次只抽一批。
 */
const BASE_MEMBERS = [
  { file: 'Shinano_Hair.unitypackage', base: 0x100, entries: ['Assets/Shinano/Hair/Ponytail.prefab', 'Assets/Shinano/Hair/Ponytail.mat'] },
  { file: 'Shinano_Face.unitypackage', base: 0x200, entries: ['Assets/Shinano/Face/Smile.anim'] },
  { file: 'Manuka_Dress.unitypackage', base: 0x300, entries: ['Assets/Manuka/Dress.fbx', 'Assets/Manuka/Dress.mat'] }
]
const MEMBER_COUNT = Math.max(1, Number(process.env.AVCA_M5B_MEMBERS || BASE_MEMBERS.length))
const MEMBERS = [
  ...BASE_MEMBERS,
  ...Array.from({ length: Math.max(0, MEMBER_COUNT - BASE_MEMBERS.length) }, (_, i) => {
    const name = `Shinano_Pose${String(i + 1).padStart(2, '0')}`
    return {
      /** base 隔开 0x10：GUID 前 4 位就是 base+i，成员之间不许撞 */
      file: `${name}.unitypackage`,
      base: 0x400 + i * 0x10,
      entries: [`Assets/Shinano/Pose/${name}.anim`, `Assets/Shinano/Pose/${name}.controller`]
    }
  })
].slice(0, MEMBER_COUNT)

/**
 * `AVCA_M5B_TEXT_ENTRIES=1`：把每个条目的**扩展名换成 `.json`**（名字里带上原来的扩展名，
 * 免得 `Pose01.anim` 和 `Pose01.controller` 换完撞成同一个文件）。
 *
 * 为什么要有这一档：假 `.prefab/.mat/.anim/.fbx/.controller` 里塞的是随手写的 YAML，
 * **真 Unity 会报导入失败** —— 那时 `createdGuids` 为空是因为 Unity 拒收，不是 A 的链路坏，
 * 测出来的是 Unity 的导入器而不是 A（这条口径记在 `docs/VERIFY-UNVERIFIED.md`：
 * 条目要用文本型 `.txt/.json/.csv/.shader`）。假对端不看内容，所以 M5-B 那轮默认档没暴露。
 */
if (process.env.AVCA_M5B_TEXT_ENTRIES === '1') {
  for (const m of MEMBERS) {
    m.entries = m.entries.map((p) => p.replace(/\.[A-Za-z0-9]+$/, (ext) => '_' + ext.slice(1) + '.json'))
  }
}

function rmMine(dir) {
  fs.rmSync(dir, { recursive: true, force: true })
}

function mkdirs(...d) {
  fs.mkdirSync(path.join(...d), { recursive: true })
}

/** 造一个真形状 .unitypackage：tar.gz，条目全带 `./` 前缀 */
async function buildPackage(file, spec) {
  const stage = path.join(ROOT, '.stage', spec.file)
  rmMine(stage)
  mkdirs(stage)
  spec.entries.forEach((unityPath, i) => {
    const guid = guidOf(spec.base + i)
    const dir = path.join(stage, guid)
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'pathname'), unityPath)
    fs.writeFileSync(
      path.join(dir, 'asset'),
      `%YAML 1.1\n--- !u!1 &2\n  m_Name: ${path.basename(unityPath)}\n`
    )
    /**
     * ⚠ `asset.meta` **必须带 `guid:`**。只写 `fileFormatVersion: 2` 的话真 Unity 直接
     * `… does not have a valid GUID and will be ignored` —— 文件铺进去了、`createdGuids` 却是空的，
     * 看着像 A 的记账坏了（第 4 轮开工前就按这条改；假对端是按 tar 的目录名取 GUID，所以暴露不了）。
     * 真凭据的比对方式不变：**目录的 `.meta` 得是 Unity 自己生成的**，不是包里抄的。
     */
    fs.writeFileSync(path.join(dir, 'asset.meta'), `fileFormatVersion: 2\nguid: ${guid}\n`)
  })
  await tar.c({ gzip: true, cwd: stage, file, prefix: './' }, fs.readdirSync(stage))
  rmMine(stage)
  return file
}

function find7z() {
  for (const n of ['7z.exe', '7za.exe']) {
    const p = path.join(BIN, n)
    if (fs.existsSync(p)) return p
  }
  throw new Error('没找到 7z：' + BIN + '（跑 node tools/fetch-7z.cjs）')
}

async function main() {
  const printOnly = process.argv.includes('--print')
  const manifest = {
    sandbox: ROOT,
    libraryRoot: LIB,
    extractRoot: EXTRACT,
    projectPath: PROJ,
    appData: APPDATA,
    container: path.join(LIB, '道具', 'Shinano_PosePack.zip'),
    members: MEMBERS.map((m) => ({
      file: m.file,
      entries: m.entries.map((e, i) => ({ guid: guidOf(m.base + i), unityPath: e }))
    }))
  }
  if (printOnly) {
    console.log(JSON.stringify(manifest, null, 2))
    return
  }

  /** 只清自己造的沙盒：根目录名已在上面验过 */
  rmMine(ROOT)
  mkdirs(LIB, '道具')
  mkdirs(ROOT, 'projects')
  mkdirs(ADATA)
  fs.mkdirSync(EXTRACT, { recursive: true })

  /** —— 1. 三个成员包 + 一个把它们装在一起的 zip —— */
  const pkgDir = path.join(ROOT, '.build')
  fs.mkdirSync(pkgDir, { recursive: true })
  for (const spec of MEMBERS) await buildPackage(path.join(pkgDir, spec.file), spec)
  fs.writeFileSync(
    path.join(pkgDir, 'Readme.txt'),
    '这是 M5-B 沙盒活体用的假合集，不属于任何人的素材库。\n'
  )
  const zip = manifest.container
  fs.mkdirSync(path.dirname(zip), { recursive: true })
  execFileSync(
    find7z(),
    ['a', '-tzip', '-y', zip, ...MEMBERS.map((m) => m.file), 'Readme.txt'],
    { cwd: pkgDir, stdio: ['ignore', 'pipe', 'pipe'] }
  )
  rmMine(pkgDir)

  /** —— 2. 假 Unity 工程（只到"看起来是工程"为止：Assets/Packages/ProjectSettings） —— */
  fs.mkdirSync(path.join(PROJ, 'Assets'), { recursive: true })
  fs.mkdirSync(path.join(PROJ, 'Packages'), { recursive: true })
  fs.mkdirSync(path.join(PROJ, 'ProjectSettings'), { recursive: true })
  fs.mkdirSync(path.join(PROJ, 'Temp'), { recursive: true })
  fs.writeFileSync(path.join(PROJ, 'ProjectSettings', 'ProjectVersion.txt'), 'm_EditorVersion: 2022.3.22f1\n')
  fs.writeFileSync(
    path.join(PROJ, 'Packages', 'manifest.json'),
    JSON.stringify({ dependencies: { 'com.avca.bridge': 'file:com.avca.bridge' } }, null, 2)
  )
  /** 桥接从仓库自带的模板原样拷过去 —— 装桥接这件事本身已经有测试，这里只要"已装"这个事实 */
  const tpl = path.resolve(__dirname, '..', 'resources', 'unity-bridge', 'com.avca.bridge')
  fs.cpSync(tpl, path.join(PROJ, 'Packages', 'com.avca.bridge'), { recursive: true })
  /**
   * 让其中一个成员真的"撞车"：工程里**已经有同路径同 GUID**的资源。
   * ⚠ 路径必须跟着 `MEMBERS[0].entries[0]` 走，不能写死 `Ponytail.prefab` ——
   *   开了 `AVCA_M5B_TEXT_ENTRIES=1`（真 Unity 那一轮用的档）之后条目名变成
   *   `Ponytail_prefab.json`，写死的话就变成"GUID 相同、路径不同"，
   *   真 Unity 会当成两回事处理，冲突预扫描要看的"会覆盖谁"就测不到了。
   */
  const collidePath = MEMBERS[0].entries[0].replace(/^Assets[\\/]/i, '')
  const collideFull = path.join(PROJ, 'Assets', collidePath)
  fs.mkdirSync(path.dirname(collideFull), { recursive: true })
  fs.writeFileSync(collideFull, '%YAML 1.1\n--- !u!1 &9\n这是沙盒里预置的"已存在"资源，用来验冲突预扫描\n')
  fs.writeFileSync(
    collideFull + '.meta',
    `fileFormatVersion: 2\nguid: ${guidOf(MEMBERS[0].base)}\n`
  )
  console.log('  预置撞车资源 Assets/' + collidePath + '（guid ' + guidOf(MEMBERS[0].base).slice(0, 8) + '…）')

  /**
   * `AVCA_M5B_PLAY_TRIGGER=1`：往 `Assets/Editor/` 放一个**沙盒专用**的小脚本，
   * 把"进 / 退 Play 模式"变成 `Temp/AVCABridge/play.txt` 这一个文件开关。
   *
   * 为什么要它：§8-5 那条要在**真 Unity 真 Play** 底下点导入 —— 之前只能用假对端装忙，
   * 证的是 A 这一侧；"`IsBusy()` 真的会翻、翻的时候 A 收到的是 busy 而不是 error"只能问真编辑器。
   * 让人守着点 Play 就没法自动化重跑，所以给它一个文件信号。
   * ⚠ 这脚本只进沙盒工程，装完这一轮就随沙盒一起删；它不属于桥接包，更不许进任何人的真工程。
   */
  if (process.env.AVCA_M5B_PLAY_TRIGGER === '1') {
    const editorDir = path.join(PROJ, 'Assets', 'Editor')
    fs.mkdirSync(editorDir, { recursive: true })
    fs.writeFileSync(
      path.join(editorDir, 'AvcaSandboxPlayTrigger.cs'),
      [
        '// 沙盒专用（第 4 轮 §8-5 活体）：Temp/AVCABridge/play.txt 在 = 进 Play，没了 = 退出。',
        '// 不属于 com.avca.bridge，也不许出现在任何真工程里 —— 它只是让"真 Play 下点导入"这件事能被自动化。',
        'using System.IO;',
        'using UnityEditor;',
        'using UnityEngine;',
        '',
        '[InitializeOnLoad]',
        'internal static class AvcaSandboxPlayTrigger',
        '{',
        '    static string FlagPath',
        '    {',
        '        get { return Path.GetFullPath(Path.Combine(Application.dataPath, "..", "Temp", "AVCABridge", "play.txt")); }',
        '    }',
        '',
        '    static AvcaSandboxPlayTrigger()',
        '    {',
        '        EditorApplication.update += Tick;',
        '    }',
        '',
        '    static void Tick()',
        '    {',
        '        bool want = File.Exists(FlagPath);',
        '        if (want && !EditorApplication.isPlaying && !EditorApplication.isPlayingOrWillChangePlaymode)',
        '        {',
        '            Debug.Log("[AVCA-SANDBOX] play.txt 在 → 进 Play 模式");',
        '            EditorApplication.isPlaying = true;',
        '        }',
        '        else if (!want && EditorApplication.isPlaying)',
        '        {',
        '            Debug.Log("[AVCA-SANDBOX] play.txt 没了 → 退 Play 模式");',
        '            EditorApplication.isPlaying = false;',
        '        }',
        '    }',
        '}',
        ''
      ].join('\n'),
      'utf8'
    )
    console.log('  放了沙盒 Play 开关脚本 Assets/Editor/AvcaSandboxPlayTrigger.cs')
  }

  /** —— 3. 设置：库根 / 抽取根 / 工程根都指到沙盒 —— */
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

  console.log('沙盒已造好：')
  console.log('  库根     ' + LIB)
  console.log('  容器     ' + zip + '（' + fs.statSync(zip).size + ' 字节）')
  console.log('  假工程   ' + PROJ)
  console.log('  抽取根   ' + EXTRACT)
  console.log('  APPDATA  ' + APPDATA)
  console.log('  清单     ' + path.join(ROOT, 'live-manifest.json'))
  for (const m of manifest.members) {
    for (const e of m.entries) console.log('    ' + m.file + '  ' + e.guid.slice(0, 8) + '…  ' + e.unityPath)
  }
}

main().catch((e) => {
  console.error('FAILED: ' + (e && e.message ? e.message : e))
  process.exit(1)
})
