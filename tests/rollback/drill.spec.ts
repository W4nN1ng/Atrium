import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'
import { closeDatabase, openDatabase } from '../../src/main/db'
import { SCHEMA_VERSION } from '../../src/main/db/schema'
import { P, setAppPathsForTest } from '../../src/main/services/paths'
import { defaultVpmSettings, readVpmSettings, writeVpmSettings } from '../../src/main/vpm/config'
import {
  disableVpm,
  enableVpm,
  getVpmStatus,
  isSafeMode,
  registerVpmGateIpc,
  resetVpmGateForTest,
  startVpmRuntime
} from '../../src/main/vpm/gate'

/**
 * P9-D：回退演练的**可自动化部分**（L1/L2/L3/L4）。
 *
 * 真机部分（安装版点按钮、真 Unity 打开工程）不在这里 —— 见
 * `docs/VPM-ROLLBACK-EVIDENCE.md` 的"未验证"。
 *
 * 这份测试要钉住的不是"功能能用"，而是**回退出路到底还剩下什么**：
 * - L1「设置里停用」在 R20 之后没有界面入口，而且 `ensureAutoEnabled()` 会在下次启动
 *   把它改回来 —— 这条必须被记录成事实，不能写成"可以停用"；
 * - L2 安全模式是真的出口（`--safe-mode` / `ATRIUM_SAFE_MODE=1`）；
 * - L3 移走 VPM 状态目录后，核心库一个字节都不该变（schema 仍是 11、表还是那些表）；
 * - L4 旧版忽略 VPM 目录的前提是：**VPM 的表从来不在 library.db 里**。
 */

const electron = vi.hoisted(() => ({
  getVersion: vi.fn(() => '0.9.0'),
  getAppPath: vi.fn(() => 'E:\\Apps\\Atrium'),
  /** R19 的自动启用会把数据根设成 `<appData>\Atrium`，所以这里要给一个沙盒 appData。 */
  appData: { value: '' }
}))

vi.mock('electron', () => ({
  app: {
    getVersion: electron.getVersion,
    getAppPath: electron.getAppPath,
    getPath: () => electron.appData.value
  },
  BrowserWindow: { getFocusedWindow: () => null },
  dialog: { showOpenDialog: vi.fn() }
}))

/** 不真的加载 VPM 运行时（那要 electron net + 完整数据根）；只记录"有没有被调起来"。 */
const initVpm = vi.hoisted(() =>
  vi.fn(async () => ({
    dataRoot: 'mock',
    dispose: () => {}
  }))
)
vi.mock('../../src/main/vpm/index', () => ({ initVpm }))

let root: string
let db: ReturnType<typeof openDatabase>
let oldSystemDrive: string | undefined

function register(enableRuntime: boolean): void {
  registerVpmGateIpc({
    ipc: { handle: () => {} },
    getDb: () => db,
    getLibraryRoot: () => path.join(root, 'library'),
    getKnownProjectPaths: () => [path.join(root, 'project')],
    appInstallDirs: () => [path.join(root, 'app')],
    enableRuntime
  })
}

function seedCoreAsset(): void {
  db.prepare(
    `INSERT INTO asset (id, name, raw_name, category, confidence, status, storage_mode,
                        library_path, size_bytes, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run('asset-1', 'a.png', 'a.png', '服装', 1, 'ready', 'managed', 'E:\\lib\\a.png', 123, 1, 1)
}

function snapshotCore(): {
  userVersion: number
  tables: string[]
  counts: Record<string, number>
  assetRow: unknown
} {
  const userVersion = Number(db.pragma('user_version', { simple: true }))
  const tables = (
    db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as Array<{
      name: string
    }>
  ).map((row) => row.name)
  const counts: Record<string, number> = {}
  for (const table of ['asset', 'project', 'import_log', 'collection']) {
    if (!tables.includes(table)) continue
    const row = db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }
    counts[table] = Number(row.n)
  }
  const assetRow = db.prepare('SELECT id, name, library_path, size_bytes FROM asset LIMIT 1').get() ?? null
  return { userVersion, tables, counts, assetRow }
}

beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'atrium-rollback-')))
  setAppPathsForTest(root)
  electron.appData.value = path.join(root, 'AppData', 'Roaming')
  db = openDatabase(P.db())
  oldSystemDrive = process.env.SystemDrive
  process.env.SystemDrive = 'Z:'
  delete process.env.ATRIUM_SAFE_MODE
  initVpm.mockClear()
})

afterEach(() => {
  resetVpmGateForTest()
  if (db?.open) closeDatabase()
  if (oldSystemDrive === undefined) delete process.env.SystemDrive
  else process.env.SystemDrive = oldSystemDrive
  delete process.env.ATRIUM_SAFE_MODE
  fs.rmSync(root, { recursive: true, force: true })
})

describe('L1：停用到底还算不算一层回退', () => {
  it('停用当场生效，但下次启动会被自动启用改回来（R19/R20 的真实行为）', async () => {
    register(true)
    await startVpmRuntime()
    expect(getVpmStatus().enabled).toBe(true)

    const afterDisable = await disableVpm()
    expect(afterDisable.enabled).toBe(false)
    // 停用不删数据根、不删设置 —— 这点仍然成立
    expect(fs.existsSync(path.join(P.vpm(), 'settings.json'))).toBe(true)

    // 模拟"重启应用"：再走一次启动流程
    initVpm.mockClear()
    await startVpmRuntime()
    expect(
      getVpmStatus().enabled,
      'ensureAutoEnabled 会把显式停用改回来；回退文档必须按这个事实写'
    ).toBe(true)
  })
})

describe('L2：安全模式是真正的出口', () => {
  it('两种写法都认（argv 与环境变量）', () => {
    expect(isSafeMode(['--safe-mode'], {})).toBe(true)
    expect(isSafeMode([], { ATRIUM_SAFE_MODE: '1' })).toBe(true)
    expect(isSafeMode([], { ATRIUM_SAFE_MODE: '0' })).toBe(false)
    expect(isSafeMode(['--other'], {})).toBe(false)
  })

  it('安全模式下启动不会加载 VPM 运行时，也不会自动启用', async () => {
    process.env.ATRIUM_SAFE_MODE = '1'
    register(true)

    await startVpmRuntime()

    expect(initVpm).not.toHaveBeenCalled()
    const status = getVpmStatus()
    expect(status.safeMode).toBe(true)
    expect(status.enabled).toBe(false)
  })

  it('安全模式下即使调启用接口也拒绝（不会偷偷把模块拉起来）', async () => {
    process.env.ATRIUM_SAFE_MODE = '1'
    register(true)
    await expect(
      enableVpm({ dataRoot: path.join(root, 'vpm-data'), systemDefault: true })
    ).rejects.toMatchObject({ code: 'vpmSafeMode' })
    expect(initVpm).not.toHaveBeenCalled()
  })
})

describe('L3：移走 VPM 状态目录，核心库无损', () => {
  it('核心库的 user_version/表/行数在移走前后完全一致，且里面没有 vpm_* 表', () => {
    // 造一点核心数据，证明"无损"不是"空库当然一样"
    seedCoreAsset()
    const before = snapshotCore()
    expect(before.userVersion).toBe(SCHEMA_VERSION)
    expect(before.tables.some((name) => name.startsWith('vpm_'))).toBe(false)

    // VPM 状态目录（R19：%APPDATA%\Atrium，路径由 P.vpm() 给出）
    const vpmDir = P.vpm()
    fs.mkdirSync(vpmDir, { recursive: true })
    fs.writeFileSync(
      path.join(vpmDir, 'settings.json'),
      JSON.stringify({ ...defaultVpmSettings(), enabled: true })
    )
    new Database(path.join(vpmDir, 'vpm.db')).close()

    // L3 的动作：移走整个 VPM 状态目录（模拟"卸载/不想要了"）
    fs.renameSync(vpmDir, path.join(root, 'parked-vpm'))

    // 核心库重新打开：必须一模一样
    closeDatabase()
    db = openDatabase(P.db())
    const after = snapshotCore()
    expect(after.userVersion).toBe(before.userVersion)
    expect(after.tables).toEqual(before.tables)
    expect(after.counts).toEqual(before.counts)
    expect(after.assetRow).toEqual(before.assetRow)
  })
})

describe('L4：旧版忽略 VPM 的前提', () => {
  it('library.db 里没有任何 vpm 表；VPM 自己的库在数据根里', () => {
    const core = snapshotCore()
    expect(core.tables.filter((name) => name.startsWith('vpm_'))).toEqual([])
    expect(core.userVersion).toBe(11)
    // VPM 的库是另一个文件
    expect(P.vpmDb()).not.toBe(P.db())
    expect(P.vpmDb().toLowerCase()).toContain('vpm')
  })

  it('核心库 schema 文件里没有 VPM 的痕迹（回退代码不会动核心 schema）', () => {
    const schema = fs.readFileSync(path.join(__dirname, '../../src/main/db/schema.ts'), 'utf8')
    expect(/vpm/i.test(schema), '核心 schema 里出现了 vpm —— 回退会变复杂').toBe(false)
    expect(SCHEMA_VERSION).toBe(11)
  })

  it('VPM 设置文件坏掉时，核心仍然能开（回退不依赖 VPM 状态）', () => {
    const vpmDir = P.vpm()
    fs.mkdirSync(vpmDir, { recursive: true })
    fs.writeFileSync(path.join(vpmDir, 'settings.json'), '{ not json')
    // 读设置会隔离坏文件并回默认值，但核心库不受影响
    const read = readVpmSettings()
    expect(read.recovered).toBe(true)
    expect(db.open).toBe(true)
    expect(snapshotCore().userVersion).toBe(SCHEMA_VERSION)
  })

  it('VPM 设置写不进去时核心照常（settings.json 被占成目录）', () => {
    const vpmDir = P.vpm()
    fs.mkdirSync(vpmDir, { recursive: true })
    // Windows 上 chmod 对目录不生效，用"同名目录占位"制造确定的写入失败
    fs.mkdirSync(path.join(vpmDir, 'settings.json'))
    expect(() => writeVpmSettings({ ...defaultVpmSettings(), enabled: false })).toThrow()
    expect(db.open).toBe(true)
    expect(snapshotCore().userVersion).toBe(SCHEMA_VERSION)
  })
})
