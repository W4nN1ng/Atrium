import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'

/**
 * 本软件自己的目录固定在 %APPDATA%/A（第 1 份 §7 的缩略图路径就是这个），
 * 不跟随 productName 变成 "%APPDATA%/A 素材管家"，省掉中文目录带来的兼容问题。
 */
let base: string | null = null

/**
 * 决定运行时目录落在哪 —— **纯函数**（不碰 electron 的 `app`），所以能用例钉住。
 *
 * `fallback` = 不设环境变量时的默认（`%APPDATA%\A`）；`envHome` 空/空白就走它。
 *
 * ⚠ 沙盒护栏：`envHome` 里必须出现 `avca` / `sandbox` 字样，否则**直接抛**。
 * 这个变量的用途是"把整套运行时数据（含 library.db）搬到别处做活体验收"，
 * 手滑填成 `C:\Users\<他>\AppData\Roaming\A` 就等于拿用户的真库当沙盒 ——
 * 那种事故比没有这个变量更糟，所以宁可拒绝启动。
 */
export function resolveAppHome(envHome: string | null | undefined, fallback: string): string {
  const v = (envHome ?? '').trim()
  if (!v) return fallback
  if (!/(avca|sandbox)/i.test(v)) {
    throw new Error(
      `AVCA_APP_HOME=${v} 看起来不像沙盒目录（路径里必须有 avca / sandbox 字样），拒绝把运行时数据写到那里`
    )
  }
  return v
}

/**
 * **给活体用的第二道闸**：设了 `AVCA_REQUIRE_SANDBOX_HOME=1` 就等于宣布
 * "这个进程只允许在沙盒里跑"，此时算出来的运行时目录里必须有 `avca` / `sandbox` / `-live`，
 * 否则**拒绝启动**。
 *
 * ## 为什么光有 `resolveAppHome` 那道闸不够
 *
 * 那道闸管的是"**设了** `AVCA_APP_HOME` 却指向不像沙盒的路径"。它管不到**根本没设**的情况 ——
 * 而 2026-10-09 一天之内两次越界都是"根本没设"：
 *  1. 12:13 为了绕开被 adb 占用的 9222，直接 `node tools/dev.cjs --remote-debugging-port=9233`，
 *     漏了重定向 → 打开了真库（护栏后来加进了 `tools/dev.cjs`）；
 *  2. 17:24 我想知道打包版的版本号，敲了 `dist\win-unpacked\Atrium.exe --version` ——
 *     **打包版 Electron 不认 `--version`**，它按普通启动处理，直接把真库打开并跑了一轮工程发现。
 *     `tools/dev.cjs` 那道闸完全没参与（根本没走 dev 脚本）。
 *
 * 所以这道闸放在**应用自己身上**：只要进程环境里有这个变量，指错或没指都当场死，
 * 而不是安静地去开用户的真库。活体工具起沙盒实例时一律带上它。
 * 读打包版版本号请用 `node tools/pkg-version.cjs`（不启动进程）。
 *
 * 纯函数（不碰 electron），所以能用例钉住。返回 null = 放行；返回字符串 = 拒绝原因。
 */
export function requireSandboxHome(envValue: string | null | undefined, resolvedDir: string): string | null {
  if ((envValue ?? '').trim() !== '1') return null
  if (/(avca|sandbox|-live)/i.test(resolvedDir)) return null
  return `AVCA_REQUIRE_SANDBOX_HOME=1 说好了只在沙盒里跑，但运行时目录算出来是 ${resolvedDir} —— 拒绝启动`
}

/**
 * 运行时目录。**`AVCA_APP_HOME` 能整体搬走**（只给活体验收用，打包版没这个环境变量）。
 *
 * ## 为什么必须由我们自己读环境变量
 *
 * `app.getPath('appData')` 在 Windows 上取的是**系统 known folder**（CSIDL_APPDATA），
 * 改 `process.env.APPDATA` 它照样返回 `C:\Users\<用户名>\AppData\Roaming`。
 * 实测（2026-10-06）：带 `APPDATA=D:\avca-m5b-live\AppData\Roaming` 起 dev 做成员面板活体，
 * 主日志第一行还是「数据库就绪 C:\Users\…\A\library.db」——
 * 于是 M5-B 的 **V5 迁移写进了用户的真库**（加了三列 + 一个索引，行数据一行没动，
 * 但"没经过同意就动他的库"这件事本身就是红线）。所以重定向这条路必须真的通。
 *
 * ⚠ 指过去之后**库根、staging、缩略图、备份、日志、settings 全跟着走**（都从 `root()` 派生），
 * 这正是目的：整份运行时状态隔离，而不是只隔离其中一个。
 */
export function initAppPaths(): string {
  const dir = resolveAppHome(process.env.AVCA_APP_HOME, path.join(app.getPath('appData'), 'A'))
  const refuse = requireSandboxHome(process.env.AVCA_REQUIRE_SANDBOX_HOME, dir)
  if (refuse) throw new Error(refuse)
  fs.mkdirSync(dir, { recursive: true })
  app.setPath('userData', dir)
  base = dir
  return dir
}

function root(): string {
  if (base) return base
  const tmp = process.env.TEMP || process.env.TMP || '.'
  return path.join(tmp, 'A-uninitialized')
}

/**
 * **只给测试用**：把运行时目录指到一个独立的临时目录。
 *
 * ## 为什么必须有这个
 *
 * 没初始化时 `root()` 会退回 `%TEMP%/A-uninitialized` —— 那是**进程级共享**的，
 * 于是并行跑的多个测试文件会互相删对方的备份：
 * `pruneBackups` 只保留最近 20 次，A 文件刚写的备份可能被 B 文件的清理删掉，
 * 然后 A 的"撤销能还原"就红。表现是**单跑绿、全量红**（实测：
 * `tests/import/coordinator.spec.ts` 的"撤销会把被覆盖的文件还原回原位"
 * 单独跑通过、全量跑失败）。
 *
 * 每个测试文件的 worker 是独立进程，所以在 `beforeEach` 里调一次本函数、
 * 传一个 `mkdtemp` 出来的目录，各文件之间就彻底隔离了。
 *
 * ⚠ 生产代码**不要**调这个 —— 主进程走 `initAppPaths()`。
 */
export function setAppPathsForTest(dir: string): void {
  base = dir
  fs.mkdirSync(dir, { recursive: true })
}

export const P = {
  root: () => root(),
  db: () => path.join(root(), 'library.db'),
  staging: () => path.join(root(), 'staging'),
  thumbs: () => path.join(root(), 'thumbs'),
  backups: () => path.join(root(), 'backups'),
  /** 用户自己加的词典词条。打包后 resources/ 是只读的，所以只能放这里 */
  userLexicon: () => path.join(root(), 'lexicon.user.json'),
  /**
   * 用户对**分类表口语**的改动（增量，不是整份表）。
   *
   * 第 2 轮活体实测到：以前 `saveCategories` 直接写 `lexiconFile('categories.json')`，
   * 也就是**安装目录里那份内置表** —— 装成 per-user 目录所以写得动、也生效，
   * 但 electron-builder 每次发布都会重写整个 win-unpacked，用户加的口语词会整份丢。
   * 这和 `userLexicon.ts` 头部写死的规矩是同一类问题（"用户的东西必须落在 root()"）。
   * 存增量而不是整份：升级时内置表新增的分类/口语照样生效，用户的加减叠在上面。
   */
  categoriesUser: () => path.join(root(), 'categories.user.json'),
  /**
   * 收件箱队列的持久化（源路径清单）。
   * `jobs` 是内存态、staging 启动即清，所以"重启后还有什么在等我确认"只能靠这份清单。
   */
  inboxQueue: () => path.join(root(), 'inbox.json'),
  importBackups: () => path.join(root(), 'backups', 'import'),
  rollback: () => path.join(root(), 'backups', 'rollback'),
  trashHold: () => path.join(root(), 'backups', 'trash'),
  logs: () => path.join(root(), 'logs'),
  /**
   * VPM 自己的状态目录（默认关闭）。
   *
   * 刻意**不**放进 library.db / 核心设置：停用或移除 VPM 时只要忽略这个目录，
   * 核心的库、备份轮转、设置都不会被牵连。P0 只有 settings.json 和启用前快照。
   */
  vpm: () => path.join(root(), 'vpm'),
  vpmSettings: () => path.join(root(), 'vpm', 'settings.json'),
  vpmDb: () => path.join(root(), 'vpm', 'vpm.db'),
  vpmBackups: () => path.join(root(), 'vpm', 'backups')
}

export function ensureRuntimeDirs(): void {
  for (const dir of [P.staging(), P.thumbs(), P.importBackups(), P.rollback(), P.logs()]) {
    fs.mkdirSync(dir, { recursive: true })
  }
}

/**
 * 当前是不是打包版。
 *
 * ⚠ **不能直接写 `app.isPackaged`**：这个模块会被单元测试 import，
 * 而测试环境（node，不是 Electron 主进程）里 `electron` 的 `app` 是 undefined，
 * 一读就抛 `Cannot read properties of undefined (reading 'isPackaged')`。
 * 于是任何"顺带碰一下路径服务"的测试都会挂 —— 实测 `bridge/ipc.spec.ts`
 * 三条用例就是这么红的（跟被测逻辑毫无关系）。
 *
 * 判据退化成"`process.resourcesPath` 存不存在"：它只在 Electron 主进程里有。
 */
export function isPackaged(): boolean {
  try {
    if (app && typeof app.isPackaged === 'boolean') return app.isPackaged
  } catch {
    /* 不是 Electron 环境 */
  }
  return typeof process.resourcesPath === 'string' && process.resourcesPath.length > 0
}

/** dev 时拿得到 `app.getAppPath()`；测试环境退到 `process.cwd()` */
function appPath(): string {
  try {
    if (app && typeof app.getAppPath === 'function') return app.getAppPath()
  } catch {
    /* 不是 Electron 环境 */
  }
  return process.cwd()
}

/** dev 时资源在项目根的 resources/，打包后在 process.resourcesPath */
export function resourceRoot(): string {
  if (isPackaged()) return process.resourcesPath
  return path.resolve(appPath(), 'resources')
}

/**
 * 语言文件。托盘菜单要和界面用同一份文案，而主进程读不到渲染进程的 bundle，
 * 所以这三份 JSON 由 electron-builder 的 extraResources 带到 resources/i18n/。
 * 以前按 `resourcesPath/src/renderer/i18n` 找 —— 那里根本什么都没打进去（files 只有 out/**），
 * 打包版每次刷托盘都记一条 ENOENT，然后退回硬编码中文（dev 永远看不到）。
 */
export function i18nFile(lang: string): string {
  const candidates = [
    path.join(resourceRoot(), 'i18n', `${lang}.json`),
    path.resolve(appPath(), 'src', 'renderer', 'i18n', `${lang}.json`),
    path.resolve(process.cwd(), 'src', 'renderer', 'i18n', `${lang}.json`)
  ]
  for (const c of candidates) if (fs.existsSync(c)) return c
  return candidates[0]
}

export function lexiconFile(name: string): string {
  const candidates = isPackaged()
    ? [path.join(process.resourcesPath, 'lexicon', name)]
    : [
        path.resolve(appPath(), 'resources', 'lexicon', name),
        path.resolve(process.cwd(), 'resources', 'lexicon', name)
      ]
  for (const c of candidates) if (fs.existsSync(c)) return c
  return candidates[0]
}

export function bridgeTemplateRoot(): string {
  if (isPackaged()) return path.join(process.resourcesPath, 'unity-bridge', 'com.avca.bridge')
  /**
   * dev / 测试环境：从 `resources/` 下找。
   * 测试里 cwd 是仓库根，所以这里能直接指到 `resources/unity-bridge/com.avca.bridge` ——
   * `tests/bridge/ipc.spec.ts` 靠它验证"模板自检指向真模板"。
   */
  const fromResourceRoot = path.resolve(resourceRoot(), 'unity-bridge', 'com.avca.bridge')
  if (fs.existsSync(fromResourceRoot)) return fromResourceRoot
  return path.resolve(process.cwd(), 'resources', 'unity-bridge', 'com.avca.bridge')
}

/**
 * 解压后端候选目录。这台机器上没装 7-Zip，而 7zip-bin 自带的 7za.exe 不含 RAR 解码器，
 * 所以运行时按 7z.exe(自带) → 用户装的 7-Zip → WinRAR/Rar.exe 的顺序探测。
 */
export function bundledBinDir(): string {
  return path.resolve(resourceRoot(), 'bin')
}

export function appVersion(): string {
  return app.getVersion()
}
