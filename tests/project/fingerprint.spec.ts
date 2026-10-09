import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { openDatabase, closeDatabase, type Db } from '../../src/main/db'
import { upsertProject, getProjectByPath } from '../../src/main/db/repos/unity'
import {
  BRIDGE_WITH_ASSET_LIST,
  TOP_FOLDERS_MAX,
  bridgeWorthAsking,
  collectFingerprint,
  readInstalledPackages,
  readTopFolders,
  saveFingerprint,
  storedFingerprint,
  type FingerprintBridge
} from '../../src/main/project/fingerprint'

/**
 * M6 ② · 工程指纹采集。
 *
 * 被测的核心不是"能不能读目录"，而是三条口径：
 *  1. **旧版桥接必须照样能用**（按 `bridgeVersion` 降级，不看"字段有没有回来"）——
 *     Q5 裁定这一版不动 C#，所以 `avatarDescriptors` 恒空是**正确行为**，
 *     但必须记在 `notes` 里，不能让上层以为"这个工程没有 AvatarDescriptor"；
 *  2. **桥接挂了不许把功能带停**（抛错/超时/失败三种都退回磁盘那半边）；
 *  3. **落库不许抹掉运行状态**（`upsertProject` 对 undefined 保留原值，绕过它就会重演 M5-A 那个坑）。
 */

let root: string
let project: string

const mk = (p: string): void => {
  fs.mkdirSync(p, { recursive: true })
}

/** 写一份新鲜心跳（bridgeVersion 可控），让 `bridgeWorthAsking` / 降级判定走真代码 */
function writeHeartbeat(bridgeVersion: string | null): void {
  const dir = path.join(project, 'Temp', 'AVCABridge')
  mk(dir)
  fs.writeFileSync(
    path.join(dir, 'bridge.json'),
    JSON.stringify({
      protocolVersion: 1,
      pid: 4242,
      projectPath: project,
      projectName: path.basename(project),
      unityVersion: '2022.3.22f1',
      bridgeVersion,
      isPlaying: false,
      isCompiling: false,
      isUpdating: false,
      isPlayingOrWillChangePlaymode: false,
      activeScene: null,
      busyReason: null,
      queueLength: 0,
      heartbeatUtc: Date.now()
    }),
    'utf8'
  )
}

function installBridge(): void {
  const bd = path.join(project, 'Packages', 'com.avca.bridge')
  mk(bd)
  fs.writeFileSync(path.join(bd, 'package.json'), '{"name":"com.avca.bridge","version":"1.0.0"}', 'utf8')
}

/** 手搓一个桥接桩：返回什么、抛不抛，全由用例决定 */
const stubBridge = (
  impl: () => { ok: boolean; data?: unknown; error?: string | null } | Promise<{ ok: boolean; data?: unknown; error?: string | null }>
): FingerprintBridge & { calls: number } => {
  const b = {
    calls: 0,
    execute: async (): Promise<{ ok: boolean; status: string; data: unknown; error: string | null }> => {
      b.calls++
      const r = await impl()
      return { ok: r.ok, status: r.ok ? 'ok' : 'error', data: r.data ?? null, error: r.error ?? null }
    }
  }
  return b as FingerprintBridge & { calls: number }
}

/** 抛错版（execute 直接 reject） */
const throwingBridge = (): FingerprintBridge => ({
  execute: (): never => {
    throw new Error('信箱被锁住了')
  }
})

let db: Db

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'avca-fp-'))
  project = path.join(root, 'shinano-Main2')
  mk(path.join(project, 'Assets', 'Shinano'))
  mk(path.join(project, 'Assets', 'Editor'))
  mk(path.join(project, 'Assets', 'Shinano', 'Deep'))
  fs.writeFileSync(path.join(project, 'Assets', 'readme.txt'), 'x', 'utf8')
  mk(path.join(project, 'Packages'))
  fs.writeFileSync(
    path.join(project, 'Packages', 'manifest.json'),
    JSON.stringify(
      { dependencies: { 'jp.lilxyzw.liltoon': '0.0.0', 'com.coplaydev.unity-mcp': '3.0.0', 'com.unity.ide.rider': '1.0.0' } },
      null,
      2
    ),
    'utf8'
  )
  db = openDatabase(path.join(root, 'library.db'))
  upsertProject(db, { path: project, name: 'shinano-Main2', isRunning: true })
})

afterEach(() => {
  closeDatabase()
  fs.rmSync(root, { recursive: true, force: true })
})

describe('读盘那半边', () => {
  it('topFolders 只取 Assets 浅一层的目录（文件不算、子目录不钻）', () => {
    expect(readTopFolders(project).folders).toEqual(['Editor', 'Shinano'])
    expect(readTopFolders(project).capped).toBe(false)
  })

  it('没有 Assets 时返回空而不是抛（工程被挪走 / 读不到）', () => {
    const r = readTopFolders(path.join(root, 'nope'))
    expect(r).toEqual({ folders: [], capped: false })
  })

  it('撞线必须记账：201 个目录只收 200 个，并说 capped', () => {
    for (let i = 0; i < 201; i++) mk(path.join(project, 'Assets', `d${String(i).padStart(3, '0')}`))
    const r = readTopFolders(project)
    expect(r.folders).toHaveLength(TOP_FOLDERS_MAX)
    expect(r.capped).toBe(true)
  })

  it('installedPackages 只抠 dependencies 的键名', () => {
    expect(readInstalledPackages(project).sort()).toEqual([
      'com.coplaydev.unity-mcp',
      'com.unity.ide.rider',
      'jp.lilxyzw.liltoon'
    ])
  })

  it('没有 manifest / 没有 dependencies 段 → 空数组，不抛', () => {
    expect(readInstalledPackages(path.join(root, 'nope'))).toEqual([])
    const bare = path.join(root, 'bare')
    mk(path.join(bare, 'Packages'))
    fs.writeFileSync(path.join(bare, 'Packages', 'manifest.json'), '{"dependencies":{', 'utf8')
    expect(readInstalledPackages(bare)).toEqual([])
  })
})

describe('桥接那半边与降级（Q5 的落地）', () => {
  it('不传桥接 → 磁盘那半边照样齐，并记 bridgeSkipped', async () => {
    const r = await collectFingerprint(project, null)
    expect(r.fp.dirName).toBe('shinano-Main2')
    expect(r.fp.topFolders).toEqual(['Editor', 'Shinano'])
    expect(r.fp.installedPackages).toContain('jp.lilxyzw.liltoon')
    expect(r.notes).toContain('bridgeSkipped')
  })

  it('旧版桥接（1.0.0）：即使它回了 avatarDescriptors 也**不用**，并记 bridgeTooOld', async () => {
    writeHeartbeat('1.0.0')
    const b = stubBridge(() => ({
      ok: true,
      data: { installedPackages: ['a'], topFolders: ['FromBridge'], avatarDescriptors: ['Assets/x.prefab'] }
    }))
    const r = await collectFingerprint(project, b)
    expect(r.notes).toContain('bridgeTooOld')
    /** 关键字段一律保持磁盘那份 —— 降级判据是版本，不是"字段有没有回来" */
    expect(r.fp.avatarDescriptors).toEqual([])
    expect(r.fp.topFolders).toEqual(['Editor', 'Shinano'])
  })

  it(`新版桥接（≥${BRIDGE_WITH_ASSET_LIST}）：topFolders / avatarDescriptors 以桥接为准`, async () => {
    writeHeartbeat(BRIDGE_WITH_ASSET_LIST)
    const b = stubBridge(() => ({
      ok: true,
      data: { installedPackages: ['jp.lilxyzw.liltoon'], topFolders: ['Shinano'], avatarDescriptors: ['Assets/Shinano/a.prefab'] }
    }))
    const r = await collectFingerprint(project, b)
    expect(r.fp.topFolders).toEqual(['Shinano'])
    expect(r.fp.avatarDescriptors).toEqual(['Assets/Shinano/a.prefab'])
    expect(r.sources).toContain('descriptors:bridge')
    expect(r.sources).toContain('topFolders:bridge')
    expect(r.notes).not.toContain('bridgeTooOld')
  })

  it('installedPackages 以桥接回的那份覆盖磁盘那份', async () => {
    writeHeartbeat('1.0.0')
    const b = stubBridge(() => ({ ok: true, data: { installedPackages: ['only.from.bridge'] } }))
    const r = await collectFingerprint(project, b)
    expect(r.fp.installedPackages).toEqual(['only.from.bridge'])
    expect(r.sources).toContain('packages:bridge')
  })

  it('桥接回了空清单时不覆盖磁盘那份（"没东西"和"没回"是两件事）', async () => {
    writeHeartbeat('1.0.0')
    const b = stubBridge(() => ({ ok: true, data: { installedPackages: [] } }))
    const r = await collectFingerprint(project, b)
    expect(r.fp.installedPackages).toContain('jp.lilxyzw.liltoon')
    expect(r.sources).not.toContain('packages:bridge')
  })

  it('桥接抛错 → 不往外抛，退回磁盘那半边并记 bridgeThrew', async () => {
    writeHeartbeat('1.0.0')
    const r = await collectFingerprint(project, throwingBridge())
    expect(r.notes).toContain('bridgeThrew')
    expect(r.fp.topFolders).toEqual(['Editor', 'Shinano'])
  })

  it('桥接回 error → 记 bridgeFailed，同样不炸', async () => {
    writeHeartbeat('1.0.0')
    const r = await collectFingerprint(project, stubBridge(() => ({ ok: false, error: '不认识的命令类型' })))
    expect(r.notes).toContain('bridgeFailed')
    expect(r.fp.installedPackages.length).toBeGreaterThan(0)
  })

  it('连目录名都抠不出来时不返回空串（宁可退回整条路径）', async () => {
    const r = await collectFingerprint(root, null)
    expect(r.fp.dirName).toBeTruthy()
    expect(r.fp.dirName).toBe(path.basename(root))
  })
})

describe('要不要问桥接（别白等 5 秒）', () => {
  it('桥接没装 → false；装了但心跳过期 → false；心跳新鲜 → true', () => {
    expect(bridgeWorthAsking(project)).toBe(false)
    installBridge()
    expect(bridgeWorthAsking(project)).toBe(false)
    writeHeartbeat('1.0.0')
    expect(bridgeWorthAsking(project)).toBe(true)
    /**
     * 判新鲜度看的是**文件 mtime**（`readHeartbeat` 的口径：mtime 优先于心跳里的戳，
     * 因为 Unity 挂掉时最后写进去的 heartbeatUtc 也可能很新）。
     * 所以这里要真的把 mtime 挪到过去，改 JSON 里的数字是没用的。
     */
    const file = path.join(project, 'Temp', 'AVCABridge', 'bridge.json')
    const old = new Date(Date.now() - 10 * 60_000)
    fs.utimesSync(file, old, old)
    expect(bridgeWorthAsking(project)).toBe(false)
  })
})

describe('落库（列早就有，一直没人写）', () => {
  it('存进去读回来是同一份四段', async () => {
    const { fp } = await collectFingerprint(project, null)
    saveFingerprint(db, project, fp)
    const back = storedFingerprint(db, project)
    expect(back).toEqual(fp)
  })

  it('写指纹**不许把 is_running 抹掉**（M5-A 那个坑的同一味药）', () => {
    const before = getProjectByPath(db, project)
    expect(before?.is_running).toBe(1)
    saveFingerprint(db, project, { dirName: 'x', topFolders: [], installedPackages: [], avatarDescriptors: [] })
    expect(getProjectByPath(db, project)?.is_running).toBe(1)
  })

  it('库里没有这个工程 → 不写、不抛', () => {
    const ghost = path.join(root, 'ghost-project')
    expect(() => saveFingerprint(db, ghost, { dirName: 'ghost', topFolders: [], installedPackages: [], avatarDescriptors: [] })).not.toThrow()
    expect(storedFingerprint(db, ghost)).toBeNull()
  })

  it('坏 JSON 一律当"没有指纹"，不许让读的人抛', () => {
    db.prepare(`UPDATE project SET fingerprint_json = ? WHERE path = ?`).run('{不是 JSON', project)
    expect(storedFingerprint(db, project)).toBeNull()
  })

  it('字段缺一半的旧数据也能读回成完整四段', () => {
    db.prepare(`UPDATE project SET fingerprint_json = ? WHERE path = ?`).run(JSON.stringify({ dirName: 'only-name' }), project)
    expect(storedFingerprint(db, project)).toEqual({
      dirName: 'only-name',
      topFolders: [],
      installedPackages: [],
      avatarDescriptors: []
    })
  })
})
