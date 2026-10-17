import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { openDatabase, closeDatabase, collectStats, type Db } from '../../src/main/db'
import { getAsset, queryCards, listChildren, countChildren, listVersions } from '../../src/main/db/repos/asset'
import { lastRevertible } from '../../src/main/db/repos/journal'
import { commitAsset, commitBundleAsset, type CommitDeps, type CommitUnit } from '../../src/main/library/commit'
import { undoLast } from '../../src/main/library/undo'
import { readSidecar } from '../../src/main/library/sidecar'
import { SIDECAR_FILENAME } from '../../src/shared/constants'
import type { CategoryConfig } from '../../src/shared/types'

/** queryCards 只要分类表能查 key，测试里给一份最小可用的 */
const cfg: CategoryConfig = {
  version: 1,
  categories: [
    { key: 'plugin', order: 1, label: { 'zh-CN': '插件' }, subcategories: [{ key: 'action', label: { 'zh-CN': '动作类' } }] },
    { key: 'clothing', order: 2, label: { 'zh-CN': '服装' }, subcategories: [] }
  ]
}

/**
 * F4 入库 + Ctrl+Z 撤销，在临时沙盒里做真文件操作。
 * 只写"内容对不对"，不写"代码看着对不对"。
 */

let root: string
let db: Db
const names = new Map<string, string>([
  ['plugin', '插件'],
  ['plugin/action', '动作类'],
  ['clothing', '服装']
])

function mkUnit(over: Partial<CommitUnit> = {}): CommitUnit {
  return {
    name: 'GoLoco v1.8.6',
    rawName: 'GoLoco.v.1.8.6u.unitypackage',
    category: 'plugin',
    subcategory: 'action',
    confidence: 0.9,
    status: 'archived',
    kind: 'unitypackage',
    contentType: 'unity_upm_package',
    version: '1.8.6',
    author: null,
    localeTag: null,
    sourceUrl: 'https://booth.pm/ja/items/1234567',
    sourcePlatform: 'booth',
    sourceItemId: '1234567',
    sourceItemIdConfidence: 1,
    tags: ['动作', 'Shinano'],
    targetAvatars: ['SHINANO'],
    groupKey: 'gogoloco',
    bundleRef: null,
    bundleName: null,
    reason: '包内含 Editor/*.cs 与 .asmdef，判定为插件；文件名命中动作类词条',
    hash: 'cafebabe00000001',
    sizeBytes: 2048,
    ...over
  }
}

function deps(over: Partial<CommitDeps> = {}): CommitDeps {
  return {
    db,
    libraryRoot: path.join(root, 'lib'),
    names,
    template: '{category}/{subcategory}/{name}',
    storageMode: 'archived',
    autoExtract: false,
    holdDir: path.join(root, 'hold'),
    appVersion: 'test',
    ...over
  }
}

function touch(file: string, bytes = 64): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, Buffer.alloc(bytes, 0x5a))
}

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'avca-commit-'))
  db = openDatabase(path.join(root, 'library.db'))
})

afterAll(() => {
  closeDatabase()
  fs.rmSync(root, { recursive: true, force: true })
})

describe('归档模式入库', () => {
  it('原压缩包在另一卷暂存时，撤销仍能完整恢复且清掉库中的副本', async () => {
    const src = path.join(root, 'inbox', 'cross-volume.zip')
    const staging = path.join(root, 'staging', 'cross-volume')
    touch(src)
    touch(path.join(staging, 'Dress.unitypackage'))
    const r = await commitAsset(deps({ autoExtract: true, keepOriginalArchive: false }), {
      unit: mkUnit({ name: '跨卷撤销', kind: 'archive' }), sourcePath: src, stagingPath: staging
    })
    const rename = vi.spyOn(fs.promises, 'rename').mockRejectedValueOnce(Object.assign(new Error('Cross-device'), { code: 'EXDEV' }))
    try {
      const outcome = await undoLast({ db, holdDir: path.join(root, 'hold') })
      expect(outcome.ok, outcome.error).toBe(true)
      expect(fs.readFileSync(src)).toEqual(Buffer.alloc(64, 0x5a))
      expect(fs.existsSync(r.libraryPath!)).toBe(false)
    } finally { rename.mockRestore() }
  })
  it('关闭保留原压缩包：成功落盘解压内容后，原包移入可撤销暂存区', async () => {
    const src = path.join(root, 'inbox', 'extracted.zip')
    const staging = path.join(root, 'staging', 'extracted')
    touch(src)
    touch(path.join(staging, '衣服.unitypackage'))
    const r = await commitAsset(deps({ autoExtract: true, keepOriginalArchive: false }), {
      unit: mkUnit({ name: '提取衣服', kind: 'archive' }), sourcePath: src, stagingPath: staging
    })
    expect(r.archiveInLibrary).toBeNull()
    expect(getAsset(db, r.assetId)?.source_path).toBeNull()
    expect(fs.existsSync(path.join(r.libraryPath!, '_extracted', '衣服.unitypackage'))).toBe(true)
    expect(fs.existsSync(path.join(r.libraryPath!, 'extracted.zip'))).toBe(false)
    await undoLast({ db, holdDir: path.join(root, 'hold') })
    expect(fs.existsSync(src)).toBe(true)
    expect(fs.readFileSync(src)).toEqual(Buffer.alloc(64, 0x5a))
  })

  it.each([null, 'empty'])('没有成功解压内容时仍保留唯一原包 (%s)', async (stage) => {
    const src = path.join(root, 'inbox', `fallback-${stage}.zip`)
    touch(src)
    const staging = stage ? path.join(root, 'staging', 'empty') : null
    if (staging) fs.mkdirSync(staging, { recursive: true })
    const r = await commitAsset(deps({ autoExtract: true, keepOriginalArchive: false }), {
      unit: mkUnit({ name: `保留-${stage}`, kind: 'archive' }), sourcePath: src, stagingPath: staging
    })
    expect(r.archiveInLibrary).not.toBeNull()
    expect(fs.existsSync(r.archiveInLibrary!)).toBe(true)
  })

  it('关闭保留压缩包不影响原始 unitypackage', async () => {
    const src = path.join(root, 'inbox', 'raw.unitypackage')
    touch(src)
    const r = await commitAsset(deps({ autoExtract: true, keepOriginalArchive: false }), {
      unit: mkUnit({ name: 'Unity原包' }), sourcePath: src, stagingPath: null
    })
    expect(fs.existsSync(r.archiveInLibrary!)).toBe(true)
  })
  it('原件搬进 库/插件/动作类/名称/，目录模板用的是磁盘语言', async () => {
    const src = path.join(root, 'inbox', 'GoLoco.v.1.8.6u.unitypackage')
    touch(src, 128)
    const r = await commitAsset(deps(), { unit: mkUnit(), stagingPath: null, sourcePath: src })

    expect(r.libraryPath).toBe(path.join(root, 'lib', '插件', '动作类', 'GoLoco v1.8.6'))
    expect(fs.existsSync(path.join(r.libraryPath!, 'GoLoco.v.1.8.6u.unitypackage'))).toBe(true)
    expect(fs.existsSync(src), '原件应该被移走，不是复制一份留两份').toBe(false)
    expect(r.pendingTrash, '同盘是 rename，不该有待回收站文件').toEqual([])

    const row = getAsset(db, r.assetId)
    expect(row?.library_path).toBe(r.libraryPath)
    expect(row?.category).toBe('plugin')
    expect(row?.group_id).toBe(r.groupId)
  })

  it('写 .avca.json 侧车，且不含绝对路径（库能整体挪盘）', async () => {
    const src = path.join(root, 'inbox', 'sidecar.zip')
    touch(src, 64)
    const r = await commitAsset(deps(), { unit: mkUnit({ name: 'SidecarTest', rawName: 'sidecar.zip' }), stagingPath: null, sourcePath: src })
    const sc = sidecarPathOf(r.libraryPath!)
    expect(fs.existsSync(sc)).toBe(true)
    const data = await readSidecar(r.libraryPath!)
    expect(data?.asset.name).toBe('SidecarTest')
    const raw = data?.asset as unknown as Record<string, unknown>
    expect(raw.library_path, '侧车不许存绝对路径').toBeUndefined()
    expect(raw.source_path, '侧车不许存绝对路径').toBeUndefined()
    expect(data?.tags).toContain('动作')
    expect(data?.reason).toContain('插件')
  })

  it('默认不自动解压：暂存内容进 hold，不进库', async () => {
    const src = path.join(root, 'inbox', 'noextract.zip')
    const staging = path.join(root, 'staging', 'noextract')
    touch(src, 64)
    touch(path.join(staging, 'Assets', 'a.prefab'), 32)
    const r = await commitAsset(deps({ autoExtract: false }), { unit: mkUnit({ name: 'NoExtract' }), stagingPath: staging, sourcePath: src })
    expect(fs.existsSync(path.join(r.libraryPath!, '_extracted'))).toBe(false)
    expect(fs.existsSync(staging), '暂存目录不该被永久删除，应挪去 hold').toBe(false)
    expect(fs.existsSync(path.join(root, 'hold'))).toBe(true)
  })

  it('开了自动解压才落到 _extracted/', async () => {
    const src = path.join(root, 'inbox', 'autoext.zip')
    const staging = path.join(root, 'staging', 'autoext')
    touch(src, 64)
    touch(path.join(staging, 'Assets', 'b.prefab'), 32)
    const r = await commitAsset(deps({ autoExtract: true }), { unit: mkUnit({ name: 'AutoExt' }), stagingPath: staging, sourcePath: src })
    expect(fs.existsSync(path.join(r.libraryPath!, '_extracted', 'Assets', 'b.prefab'))).toBe(true)
  })

  it('同名资产不覆盖，自动加 (2)', async () => {
    const a = path.join(root, 'inbox', 'dup1.zip')
    const b = path.join(root, 'inbox', 'dup2.zip')
    touch(a, 64)
    touch(b, 96)
    const r1 = await commitAsset(deps(), { unit: mkUnit({ name: 'Dup' }), stagingPath: null, sourcePath: a })
    const r2 = await commitAsset(deps(), { unit: mkUnit({ name: 'Dup' }), stagingPath: null, sourcePath: b })
    expect(r2.libraryPath).not.toBe(r1.libraryPath)
    expect(path.basename(r2.libraryPath!)).toBe('Dup (2)')
    expect(fs.statSync(path.join(r1.libraryPath!, 'dup1.zip')).size).toBe(64)
  })

  it('索引模式一个文件都不动', async () => {
    const src = path.join(root, 'inbox', 'indexed.zip')
    touch(src, 64)
    const r = await commitAsset(deps({ storageMode: 'indexed' }), { unit: mkUnit({ name: 'Indexed' }), stagingPath: null, sourcePath: src })
    expect(r.libraryPath).toBeNull()
    expect(fs.existsSync(src), '索引模式必须原地不动').toBe(true)
    expect(getAsset(db, r.assetId)?.storage_mode).toBe('indexed')
  })
})

describe('适配体型怎么存', () => {
  /**
   * 一个 zip 里带 11 个体型的目录（束縛チャイナFULLSET 就是这样）时，
   * 那 11 个名字是"这包适配谁"，不是"我手上有 11 个变体"。
   * 写进 variant 表会让聚合视图谎报"12 变体"（实测踩过），
   * 所以：单一体型才算变体，多体型记成 avatar 标签（顺手也进了检索别名）。
   */
  it('多体型 → 记标签，不记变体', async () => {
    const src = path.join(root, 'multi-avatar.zip')
    touch(src)
    const avatars = ['Chiffon', 'Lime', 'Manuka', 'Milfy', 'Mizuki', 'Rurune', 'Selestia', 'Shinano', 'Sio']
    const r = await commitAsset(deps(), {
      unit: mkUnit({ name: 'MultiAvatar', rawName: 'multi-avatar.zip', groupKey: 'multiavatar', targetAvatars: avatars }),
      stagingPath: null,
      sourcePath: src
    })
    const rows = db
      .prepare(`SELECT variant_kind k, variant_value v FROM variant WHERE asset_id = ?`)
      .all(r.assetId) as Array<{ k: string; v: string }>
    expect(rows.filter((x) => x.k === 'avatar')).toHaveLength(0)
    const tags = db
      .prepare(`SELECT t.name n, t.kind k, at2.source s FROM asset_tag at2 JOIN tag t ON t.id = at2.tag_id WHERE at2.asset_id = ?`)
      .all(r.assetId) as Array<{ n: string; k: string; s: string }>
    // tag 表按名字全局去重（Shinano 既能是话题标签也能是体型），
    // 所以这里只查"挂上了没有"，不查 kind —— kind 只是显示用的分组。
    for (const a of avatars) expect(tags.some((t) => t.n === a), a + ' :: ' + JSON.stringify(tags)).toBe(true)
    // 话题标签不能被这次的写入抹掉
    expect(tags.some((t) => t.n === '动作'), JSON.stringify(tags)).toBe(true)
    // 适配体型是"兼容性"，不该变成 9 个变体
    expect(db.prepare(`SELECT COUNT(*) c FROM variant WHERE group_id = (SELECT group_id FROM asset WHERE id = ?) AND variant_kind = 'avatar'`).get(r.assetId)).toEqual({ c: 0 })
  })

  it('只有单一体型才算变体', async () => {
    const src = path.join(root, 'one-avatar.zip')
    touch(src)
    const r = await commitAsset(deps(), {
      unit: mkUnit({ name: 'OneAvatar', rawName: 'one-avatar.zip', groupKey: 'oneavatar', targetAvatars: ['SHINANO'] }),
      stagingPath: null,
      sourcePath: src
    })
    const row = db
      .prepare(`SELECT variant_value v FROM variant WHERE asset_id = ? AND variant_kind = 'avatar'`)
      .get(r.assetId) as { v: string } | undefined
    expect(row?.v).toBe('SHINANO')
  })

  it('没识别出体型时算通用，仍然只有一个变体', async () => {
    const src = path.join(root, 'universal.zip')
    touch(src)
    const r = await commitAsset(deps(), {
      unit: mkUnit({ name: 'UniversalOne', rawName: 'universal.zip', groupKey: 'universal', targetAvatars: [] }),
      stagingPath: null,
      sourcePath: src
    })
    const row = db
      .prepare(`SELECT variant_value v FROM variant WHERE asset_id = ? AND variant_kind = 'avatar'`)
      .get(r.assetId) as { v: string } | undefined
    expect(row?.v).toBe('UNIVERSAL')
  })
})

describe('Ctrl+Z 整批撤销', () => {
  it('撤一次入库：文件回到原位、库目录消失、库记录删掉', async () => {
    const src = path.join(root, 'inbox', 'undo-me.zip')
    const staging = path.join(root, 'staging', 'undo-me')
    touch(src, 64)
    touch(path.join(staging, 'Assets', 'x.prefab'), 16)

    const r = await commitAsset(deps({ autoExtract: true }), {
      unit: mkUnit({ name: 'UndoMe' }),
      stagingPath: staging,
      sourcePath: src
    })
    expect(fs.existsSync(path.join(r.libraryPath!, 'undo-me.zip'))).toBe(true)

    const u = await undoLast({ db, holdDir: path.join(root, 'hold') })
    expect(u.ok, u.error ?? u.message).toBe(true)
    expect(u.undone, 'mkdir + move + extract 三步应一起撤').toBeGreaterThanOrEqual(3)

    expect(fs.existsSync(src), '原件应回到原位').toBe(true)
    expect(fs.existsSync(r.libraryPath!), '库目录应被清掉').toBe(false)
    expect(getAsset(db, r.assetId), '幽灵卡片不能留').toBeNull()
  })

  /**
   * 收编整库时会连着按好几次 Ctrl+Z，带 _extracted 的那批以前会卡死：
   * extract 那条 journal 的 from 是暂存目录，撤销时它还在（里面还有别的东西），
   * 于是"原位置已被占用"抛错、整条撤销链停在那儿。实测撤到第 8 批就再也动不了。
   */
  it('撤销带解压内容的入库：不许卡在暂存目录上', async () => {
    const src = path.join(root, 'inbox', 'adopt.zip')
    const staging = path.join(root, 'staging', 'adopt')
    touch(src, 64)
    touch(path.join(staging, 'Assets', 'c.prefab'), 32)
    const r = await commitAsset(deps({ autoExtract: true }), {
      unit: mkUnit({ name: 'AdoptMe' }),
      stagingPath: staging,
      sourcePath: src
    })
    expect(fs.existsSync(path.join(r.libraryPath as string, '_extracted', 'Assets', 'c.prefab'))).toBe(true)

    const u = await undoLast({ db, holdDir: path.join(root, 'hold') })
    expect(u.ok, '撤销不该失败：' + (u.error ?? '')).toBe(true)
    expect(u.undone).toBeGreaterThan(0)
    expect(fs.existsSync(r.libraryPath as string)).toBe(false)
    expect(fs.existsSync(path.join(root, 'inbox', 'adopt.zip'))).toBe(true)
    expect(getAsset(db, r.assetId)).toBeNull()
  })

  it('没有可撤销的操作时如实说，不假装成功', async () => {
    // 把剩下能撤的都撤完
    for (let i = 0; i < 40; i++) {
      const u = await undoLast({ db, holdDir: path.join(root, 'hold') })
      if (!u.ok && u.message === '没有可撤销的操作') break
    }
    const u = await undoLast({ db, holdDir: path.join(root, 'hold') })
    expect(u.ok).toBe(false)
    expect(u.message).toBe('没有可撤销的操作')
  })

  it('原位置已被占用时中止，绝不覆盖用户文件', async () => {
    const src = path.join(root, 'inbox', 'conflict.zip')
    touch(src, 64)
    const r = await commitAsset(deps(), { unit: mkUnit({ name: 'Conflict' }), stagingPath: null, sourcePath: src })
    // 有人在原位置放了新东西
    touch(src, 99)
    const u = await undoLast({ db, holdDir: path.join(root, 'hold') })
    expect(u.ok).toBe(false)
    expect(u.error ?? u.message).toContain('没敢覆盖')
    expect(fs.statSync(src).size, '用户刚放的文件必须原样保留').toBe(99)
  })
})

function sidecarPathOf(dir: string): string {
  return path.join(dir, SIDECAR_FILENAME)
}

describe('合集三级落库（改动单 §2 / §7.1 不动磁盘）', () => {
  /** 建一棵假的合集目录，返回它的绝对路径 */
  function makeBundleDir(rel: string, files: Record<string, number>): string {
    const dir = path.join(root, 'lib', rel)
    for (const [name, size] of Object.entries(files)) {
      const abs = path.join(dir, name)
      fs.mkdirSync(path.dirname(abs), { recursive: true })
      fs.writeFileSync(abs, Buffer.alloc(size, 7))
    }
    return dir
  }

  function treeOf(dir: string): string[] {
    const out: string[] = []
    const walk = (d: string): void => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const abs = path.join(d, e.name)
        if (e.isDirectory()) walk(abs)
        else out.push(`${path.relative(dir, abs)}:${fs.statSync(abs).size}`)
      }
    }
    walk(dir)
    return out.sort()
  }

  it('合集 = 1 条合集行 + N 条子项 + 多版本的版本行，文件一个都不动', async () => {
    const dir = makeBundleDir('插件/初音的VRC小店', {
      'StoZero/StoZeroCustomEX.zip': 100,
      'StoZero/StoZeroCustomEX_v1.01.zip': 110,
      'StoZero/StoZeroCustomEX_v1.10.zip': 120,
      'GoLoco/GoLoco.unitypackage': 50
    })
    const before = treeOf(dir)

    const r = commitBundleAsset(
      deps(),
      {
        rootPath: dir,
        bundle: mkUnit({ name: '初音的VRC小店', rawName: '插件道具合集-初音的VRC小店', groupKey: null, hash: null }),
        items: [
          {
            unit: mkUnit({ name: 'StoZeroCustomEX', rawName: 'StoZeroCustomEX.zip', groupKey: 'stozero', hash: null, sizeBytes: 330 }),
            relPath: 'StoZero',
            versions: [
              { rawName: 'StoZeroCustomEX_v1.10.zip', relPath: 'StoZero/StoZeroCustomEX_v1.10.zip', sizeBytes: 120, version: '1.10', avatar: null, installMethod: null, locale: null },
              { rawName: 'StoZeroCustomEX_v1.01.zip', relPath: 'StoZero/StoZeroCustomEX_v1.01.zip', sizeBytes: 110, version: '1.01', avatar: null, installMethod: null, locale: null },
              { rawName: 'StoZeroCustomEX.zip', relPath: 'StoZero/StoZeroCustomEX.zip', sizeBytes: 100, version: null, avatar: null, installMethod: null, locale: null }
            ]
          },
          {
            unit: mkUnit({ name: 'GoLoco', rawName: 'GoLoco.unitypackage', groupKey: 'gogoloco2', hash: null, sizeBytes: 50 }),
            relPath: 'GoLoco',
            versions: [
              { rawName: 'GoLoco.unitypackage', relPath: 'GoLoco/GoLoco.unitypackage', sizeBytes: 50, version: '1.8.6', avatar: null, installMethod: null, locale: null }
            ]
          }
        ]
      }
    )

    // 一个字节都没动、也没多写侧车
    expect(treeOf(dir)).toEqual(before)

    const bundle = getAsset(db, r.bundleAssetId)!
    expect(bundle.is_bundle).toBe(1)
    expect(bundle.parent_asset_id).toBeNull()
    expect(bundle.library_path).toBe(dir)
    expect(bundle.size_bytes, '合集体积 = 子项之和').toBe(380)

    const kids = listChildren(db, r.bundleAssetId)
    expect(kids.map((k) => k.name).sort()).toEqual(['GoLoco', 'StoZeroCustomEX'])
    expect(kids.every((k) => k.is_bundle === 0)).toBe(true)

    const sto = kids.find((k) => k.name === 'StoZeroCustomEX')!
    const versions = listVersions(db, sto.id)
    expect(versions.length, '3 个版本 = 3 行').toBe(3)
    expect(versions.map((v) => v.version), '最新的排最前（按名字排会把 v1.10 甩到 v1.9 后面）').toEqual(['1.10', '1.01', null])
    expect(new Set(versions.map((v) => v.group_id)).size, '同一 Item 的版本共享一个组').toBe(1)
    // 版本行不许跑到顶层
    expect(queryCards(db, {}, cfg, 'zh-CN').cards.map((c) => c.name)).not.toContain('StoZeroCustomEX_v1.10.zip')

    const go = kids.find((k) => k.name === 'GoLoco')!
    expect(countChildren(db, go.id), '单版本不许多占一行').toBe(0)
    expect(getAsset(db, go.id)?.version).toBe('1.8.6')

    const stats = collectStats(db)
    expect(stats.bundles).toBe(1)
    expect(stats.bundleItems, '子项数不含版本行（否则合集卡上"含 N 项"会虚高）').toBe(2)
    expect(stats.totalBytes % 1000, '合集算一次体积，不重复累加').toBeGreaterThanOrEqual(0)

    // 撤销：整批库记录消失、文件照旧
    const u = await undoLast({ db, holdDir: path.join(root, 'hold') })
    expect(u.ok, u.error ?? u.message).toBe(true)
    expect(getAsset(db, r.bundleAssetId)).toBeNull()
    for (const id of r.createdIds) expect(getAsset(db, id)).toBeNull()
    expect(treeOf(dir)).toEqual(before)
  })

  /**
   * 老库里的行为：低置信度的子项曾被打上 needs_review，合集自己跟着标（`items.some(...)`）。
   * 「待复核」功能 2026-10-15 移除后这条语义**整个消失了** ——
   * 现在低置信度照常入库、不再留任何标记。
   * 这条用例改成守"不再有任何复核标记"，而不是删掉：留着它才能防止有人
   * 哪天把 needs_review 又加回来（那会让列和迁移重新对不上）。
   */
  it('低置信度不再产生任何复核标记（合集和子项都没有）', async () => {
    const dir = makeBundleDir('插件/低置信合集', { 'a/x.prefab': 10, 'b/x.prefab': 20, 'c/x.prefab': 30 })
    const r = commitBundleAsset(
      deps(),
      {
        rootPath: dir,
        bundle: mkUnit({ name: '低置信合集', groupKey: null, hash: null, confidence: 0.3 }),
        items: [
          { unit: mkUnit({ name: 'A', groupKey: 'a', hash: null, confidence: 0.9 }), relPath: 'a', versions: [] },
          { unit: mkUnit({ name: 'B', groupKey: 'b', hash: null, confidence: 0.31 }), relPath: 'b', versions: [] }
        ]
      }
    )
    const bundle = getAsset(db, r.bundleAssetId)
    expect(bundle).toBeTruthy()
    expect(Object.prototype.hasOwnProperty.call(bundle, 'needs_review')).toBe(false)
    const kids = listChildren(db, r.bundleAssetId)
    for (const k of kids) expect(Object.prototype.hasOwnProperty.call(k, 'needs_review')).toBe(false)
    /** 统计里也没有这一项了 */
    expect(Object.keys(collectStats(db))).not.toContain('review')
    /** 置信度本身照样记着 —— 详情页"为什么这么判"还要用 */
    expect(kids.find((k) => k.name === 'B')?.confidence).toBeCloseTo(0.31, 5)
    // 合牌照常出现在列表里
    expect(queryCards(db, { scope: 'top' }, cfg, 'zh-CN').cards.map((c) => c.name)).toContain('低置信合集')
  })

  it('一键入库的登记批次可以整批撤销（journal op = register）', async () => {
    const dir = makeBundleDir('插件/登记合集', { 'a/x.prefab': 10, 'b/x.prefab': 20, 'c/x.prefab': 30 })
    const r = commitBundleAsset(
      deps(),
      {
        rootPath: dir,
        batchId: 'BATCH-ONE',
        bundle: mkUnit({ name: '登记合集', groupKey: null, hash: null }),
        items: [
          { unit: mkUnit({ name: 'K1', groupKey: 'k1', hash: null }), relPath: 'a', versions: [] },
          { unit: mkUnit({ name: 'K2', groupKey: 'k2', hash: null }), relPath: 'b', versions: [] }
        ]
      }
    )
    const before = treeOf(dir)
    expect(lastRevertible(db)?.op).toBe('register')
    const u = await undoLast({ db, holdDir: path.join(root, 'hold') })
    expect(u.ok, u.error ?? u.message).toBe(true)
    expect(u.batchId).toBe('BATCH-ONE')
    expect(r.createdIds.every((id) => getAsset(db, id) === null)).toBe(true)
    expect(treeOf(dir)).toEqual(before)
  })
})
