import { describe, it, expect, beforeAll } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import type { FileEntry, IngestResult } from '../../src/shared/types'
import { planBundle } from '../../src/main/classify/bundle'
import { compareVersionDesc } from '../../src/shared/version'
import { classify } from '../../src/main/classify/engine'
import { loadLexicon, type Lexicon } from '../../src/main/classify/lexicon'
import type { CategoryConfig } from '../../src/shared/types'

/**
 * 三级模型（改动单 §2）：合集 ─ 子项 ─ 版本。
 * 这里全是纯函数，不碰磁盘 —— 真库那 228 项不能拿来当测试素材。
 */

const ROOT = path.resolve(__dirname, '../..')
let lex: Lexicon
let categories: CategoryConfig

beforeAll(() => {
  lex = loadLexicon({ builtin: path.join(ROOT, 'resources/lexicon/lexicon.json') })
  categories = JSON.parse(fs.readFileSync(path.join(ROOT, 'resources/lexicon/categories.json'), 'utf8')) as CategoryConfig
})

function fe(relPath: string, size = 1024): FileEntry {
  const isDir = relPath.endsWith('/')
  const clean = relPath.replace(/\/$/, '')
  return { relPath: clean, size: isDir ? 0 : size, ext: (clean.split('.').pop() ?? '').toLowerCase(), isDir }
}

function mk(name: string, dirs: string[], entries: string[]): IngestResult {
  return {
    assetId: '01BUNDLE',
    rawName: name,
    sourceDirChain: dirs,
    stagingPath: 'C:/fake',
    detectedKind: 'folder',
    detectedFormat: 'dir',
    entries: entries.map((e) => fe(e)),
    nestedDepth: 1,
    warnings: [],
    totalBytes: 1000,
    metadata: {
      urls: [],
      boothItemId: null,
      boothItemIdConfidence: 0,
      sourcePlatform: null,
      version: null,
      localeTag: null,
      author: null,
      readmeText: '',
      previewImages: entries.filter((e) => /\.(png|jpe?g)$/i.test(e))
    }
  }
}

const deps = () => ({ lex, categories })
const item = (plan: { items: Array<{ name: string; sourceItemId?: string | null }> }, n: string) =>
  plan.items.find((i) => i.name === n)

/** 用户真库里的"初音的VRC小店"结构 */
const SHOP = mk(
  '插件道具合集-初音的VRC小店',
  [],
  [
    'DMCustom_PCS_v1.10.0/(Modular) PCS v1.10.0.unitypackage',
    'DMCustom_PCS_v1.10.0/(VRCFury) PCS v1.10.0.unitypackage',
    'GoLoco.v.1.8.6u/GoLoco.v.1.8.6u.unitypackage',
    'SPS_V2.7.4.zip',
    '佳兔工具箱v2.7.0版本.unitypackage',
    'ERP用12件/a.prefab',
    'ERP用12件/b.mat',
    'ERP用12件/c.png',
    '道具22件/x.prefab',
    '道具22件/y.mat',
    '道具22件/z.png',
    '闲鱼-初音的VRC小店.png'
  ]
)

describe('§2.1 合集判定', () => {
  it('名字写着"合集"→ 整包算一个合集，产出子项树', () => {
    const plan = planBundle(SHOP, deps())!
    expect(plan).toBeTruthy()
    expect(plan.items.length).toBeGreaterThanOrEqual(5)
    expect(item(plan, 'GoLoco.v.1.8.6u')).toBeTruthy()
    // 压缩包后缀不进展示名（磁盘上叫什么由 rawNames / versions.rawName 记着）
    expect(item(plan, 'SPS_V2.7.4')).toBeTruthy()
    expect(item(plan, '佳兔工具箱v2.7.0版本')).toBeTruthy()
    expect(plan.why.some((w) => w.key === 'classify.whyBundleName')).toBe(true)
  })

  it('判据③：目录名是容器名（道具22件 / 更新 / プラグイン17件）也算合集', () => {
    for (const name of ['道具22件', 'ERP用12件', 'プラグイン17件', '更新', '重要！']) {
      const plan = planBundle(
        mk(name, [], ['a/x.prefab', 'a/y.mat', 'b/x.prefab', 'b/y.mat', 'c/x.prefab', 'c/y.mat']),
        deps()
      )
      expect(plan, `${name} 应该被判成容器`).toBeTruthy()
      expect(plan!.why.some((w) => w.key === 'classify.whyBundleContainer'), `${name} 要写明理由`).toBe(true)
    }
  })

  it('判据②：名字没写合集但里面 ≥3 个不同产品也收', () => {
    const plan = planBundle(
      mk('MyStuff', [], ['p1/a.prefab', 'p1/b.mat', 'p2/a.prefab', 'p2/b.mat', 'p3/a.prefab', 'p3/b.mat']),
      deps()
    )
    expect(plan).toBeTruthy()
    expect(plan!.items.length).toBe(3)
  })

  it('普通素材目录（Mesh/Textures/Prefabs）不许当合集', () => {
    expect(planBundle(mk('Some_Avatar_Fullset', [], ['Mesh/a.fbx', 'Mesh/b.mat', 'Textures/t.png', 'Textures/u.png', 'Prefabs/p.prefab']), deps())).toBeNull()
  })

  it('说明目录的文件数量不能把说明、配图和链接变成产品', () => {
    const plan = planBundle(
      mk('Clothing Pack', [], [
        'Shirt.unitypackage',
        'Pants.unitypackage',
        'Instructions/readme.txt',
        'Instructions/help.png',
        'Instructions/store.url',
        'Notes/readme.txt',
        'Notes/changelog.md',
        'Notes/store.url',
        'Customer Info/readme.txt',
        'Customer Info/help.png',
        'Customer Info/terms.pdf',
        'cover.png',
        'readme.txt'
      ]),
      deps()
    )!
    expect(plan.items.map((i) => i.name)).toEqual(['Pants', 'Shirt'])
    expect(plan.coverImage).toBe('cover.png')
  })

  it('只有说明目录凑成三个子目录时不应推断为合集', () => {
    expect(planBundle(
      mk('Ordinary Outfit', [], [
        'Notes/readme.txt', 'Notes/changes.md', 'Notes/store.url',
        'Guides/install.png', 'Guides/setup.png', 'Guides/help.png',
        'Links/store.url', 'Links/seller.url', 'Links/video.url'
      ]),
      deps()
    )).toBeNull()
  })

  it('卖家合集内的嵌套筐也不把说明和结构目录展开为产品', () => {
    const plan = planBundle(
      mk('Seller Pack', [], [
        '道具22件/Shirt/main.unitypackage',
        '道具22件/Pants/main.unitypackage',
        '道具22件/Instructions/step1.png',
        '道具22件/Instructions/step2.png',
        '道具22件/Instructions/step3.png',
        '道具22件/Notes/readme.txt',
        '道具22件/Notes/changelog.md',
        '道具22件/Notes/store.url',
        '道具22件/Textures/albedo.png',
        '道具22件/Textures/normal.png',
        '道具22件/Textures/mask.png',
        'Hat.unitypackage'
      ]),
      deps()
    )!
    expect(plan.items.map((i) => i.name)).toEqual(['Hat', 'Pants', 'Shirt'])
    expect(plan.containerKind).toBe('collection')
  })

  it('嵌套筐只有说明时也不回退为一个虚假的产品', () => {
    const plan = planBundle(
      mk('Clothing Pack', [], [
        'Shirt.unitypackage', 'Pants.unitypackage',
        '道具22件/Instructions/step1.png',
        '道具22件/Instructions/step2.png',
        '道具22件/Instructions/step3.png'
      ]),
      deps()
    )!
    expect(plan.items.map((i) => i.name)).toEqual(['Pants', 'Shirt'])
  })

  it('只有图像的贴图商品和带说明的贴图商品仍然保留', () => {
    const plan = planBundle(
      mk('Makeup Pack', [], [
        'Rose Makeup/face.png', 'Rose Makeup/body.png', 'Rose Makeup/eye.png',
        'Silver Makeup/face.png', 'Silver Makeup/body.png', 'Silver Makeup/readme.txt',
        'cover.png', 'readme.txt'
      ]),
      deps()
    )!
    expect(plan.items.map((i) => i.name)).toEqual(['Rose Makeup', 'Silver Makeup'])
    expect(plan.items[0].entries.map((e) => e.relPath)).toEqual(['face.png', 'body.png', 'eye.png'])
    expect(plan.coverImage).toBe('cover.png')
  })

  it('ABT 那种"一件商品的几个分包"：不再否决，但标 oneProduct（§6.7 要 2 个 Item）', () => {
    const plan = planBundle(
      mk('ABT 1.3.0【汉化 闲鱼@月见汐音】', ['插件'], [
        'ABT 右手用【汉化 闲鱼@月见汐音】.unitypackage',
        'ABT 左手用【汉化 闲鱼@月见汐音】.unitypackage',
        'ABT 右手用 无姿势【汉化 闲鱼@月见汐音】.unitypackage'
      ]),
      deps()
    )!
    // 改动单 §6.7 要求左手用/右手用是 2 个 Item，所以新版不再"整个不算合集"；
    // 但首词全一样 = 很可能是一件东西的几个部分 → oneProduct 标出来，合集那行别吹高分
    expect(plan.items.length).toBeGreaterThanOrEqual(2)
    expect(plan.oneProduct).toBe(true)
  })

  it('子项太少不收（防误伤）：名字没写合集时要求 ≥3 个独立子项', () => {
    expect(planBundle(mk('我的东西', [], ['a.zip', 'b.zip']), deps())).toBeNull()
    // 名字写着合集时 2 个就够（R5613 那种两个商品的合集）
    expect(planBundle(mk('小合集', [], ['a.zip', 'b.zip']), deps())).toBeTruthy()
  })

  it('隐藏目录不算子项', () => {
    const plan = planBundle(
      mk('东西合集', [], ['.git/x.fbx', '.git/y.mat', 'a/a.prefab', 'a/b.mat', 'b/b.prefab', 'b/c.mat', 'c/c.prefab']),
      deps()
    )!
    expect(plan.items.every((i) => !i.relPath.startsWith('.'))).toBe(true)
  })

  it('封面用合集根上那张图', () => {
    expect(planBundle(SHOP, deps())!.coverImage).toContain('初音的VRC小店.png')
  })
})

describe('§2.1 判据③附加：Booth ID 目录要能穿透', () => {
  const WEAPONS = mk(
    'R5613-VRChat-武器合集（军事武器合集）',
    [],
    [
      '4952737/INVICTA/mesh.fbx',
      '4952737/INVICTA/mat.mat',
      '4185283/M4A1/mesh.fbx',
      '4185283/M4A1/mat.mat',
      '4185283/M4A1/tex.png'
    ]
  )

  it('Item 名取 INVICTA，不取 4952737', () => {
    const plan = planBundle(WEAPONS, deps())!
    const names = plan.items.map((i) => i.name)
    expect(names).toContain('INVICTA')
    expect(names).toContain('M4A1')
    expect(names).not.toContain('4952737')
  })

  it('数字 ID 只当疑似来源', () => {
    const plan = planBundle(WEAPONS, deps())!
    expect(item(plan, 'INVICTA')!.sourceItemId).toBe('4952737')
  })

  it('classify 后子项带上疑似来源（置信度 0.4，要人确认）', () => {
    const r = classify(WEAPONS, deps())
    const inv = r.tree!.items.find((i) => i.name === 'INVICTA')!
    expect(inv.unit.sourceItemId).toBe('4952737')
    expect(inv.unit.sourceItemIdConfidence).toBeLessThan(0.5)
  })
})

describe('§2.3 版本归并', () => {
  it('StoZeroCustomEX 三个包 = 1 个 Item、3 个版本，最新在前', () => {
    // 真库实物：E:\vrc\A\插件道具合集-初音的VRC小店\道具22件\6159895摇后会喷的酒\
    // 里面就是 StoZeroCustomEX.zip / _v1.01.zip / _v1.10.zip 三个包 + 两张图
    const plan = planBundle(
      mk('6159895摇后会喷的酒', ['插件道具合集-初音的VRC小店', '道具22件'], [
        'StoZeroCustomEX.zip',
        'StoZeroCustomEX_v1.01.zip',
        'StoZeroCustomEX_v1.10.zip',
        'edd2d2e04f89e9227fd907979766a067.png',
        '闲鱼-初音的VRC小店.png'
      ]),
      deps()
    )!
    expect(plan.items.length).toBe(1)
    const it = plan.items[0]
    expect(it.name).toBe('StoZeroCustomEX')
    expect(it.versions.length).toBe(3)
    expect(it.versions[0].version).toBe('1.10')
    expect(it.versions.map((v) => v.rawName)).toContain('StoZeroCustomEX.zip')
  })

  it('(Modular)/(VRCFury) PCS = 1 个 Item、2 个 install_method 变体', () => {
    const plan = planBundle(SHOP, deps())!
    const pcs = plan.items.find((i) => i.versions.some((v) => /PCS/.test(v.rawName)))!
    expect(pcs).toBeTruthy()
    expect(pcs.versions.length).toBe(2)
    expect(new Set(pcs.versions.map((v) => v.installMethod))).toEqual(new Set(['modular', 'vrcfury']))
  })

  it('Grimoir 11 个体型 = 1 个 Item / 11 个 avatar 变体，Hat 和 Gimmick 各自独立', () => {
    // 名字取自真库 E:\vrc\A\衣服\27\（11 个模型版 + Hat + Gimmick，用户点过名不许误并）
    const avatars = [
      'AIRI', 'CHIFFON', 'KIKYO', 'MANUKA', 'MILLTINA', 'MOE',
      'RURUNE', 'SELESTIA', 'SHINANO', 'SHINRA', 'SIO'
    ]
    const entries = avatars.flatMap((a) => [`Grimoir_${a}_V1.0/mesh.fbx`, `Grimoir_${a}_V1.0/mat.mat`])
    const plan = planBundle(
      mk('27', ['衣服'], [...entries, 'Grimoir_Hat_V1.0.zip', 'Grimoir_Gimmick_V1.0.zip']),
      deps()
    )!
    const grimoir = plan.items.filter((i) => i.groupKey === 'grimoir')
    expect(grimoir.length).toBe(1)
    expect(grimoir[0].versions.length).toBe(11)
    expect(new Set(grimoir[0].versions.map((v) => v.avatar)).size).toBe(11)
    // Hat / Gimmick 不许并进来（用户点过名的裁定）
    expect(plan.items.some((i) => /Hat/i.test(i.name))).toBe(true)
    expect(plan.items.some((i) => /Gimmick/i.test(i.name))).toBe(true)
    expect(grimoir[0].name).toBe('Grimoir')
  })

  it('ABT 左手用 / 右手用 是 2 个 Item，不是版本', () => {
    const plan = planBundle(
      mk('ABT合集', [], [
        'ABT 左手用【汉化】.unitypackage',
        'ABT 右手用【汉化】.unitypackage',
        'SPS.zip',
        'GoLoco.unitypackage'
      ]),
      deps()
    )!
    const hands = plan.items.filter((i) => /左手|右手/.test(i.name))
    expect(hands.length).toBe(2)
  })

  it('版本号按数字段比：v1.10 > v1.9（不是字符串序）', () => {
    expect(compareVersionDesc('1.10', '1.9')).toBeLessThan(0)
    expect(compareVersionDesc('1.9', '1.10')).toBeGreaterThan(0)
    expect(compareVersionDesc('2.0', '1.99')).toBeLessThan(0)
    const list = ['1.9', '1.10', '1.2']
    expect([...list].sort(compareVersionDesc)).toEqual(['1.10', '1.9', '1.2'])
  })

  it('版本归并只在同一层：不同目录里的同名产品不许并成一项', () => {
    const plan = planBundle(
      mk('更新合集', [], [
        'ERP用12件/DPS/a.prefab',
        'ERP用12件/DPS/b.mat',
        '道具22件/DPS/x.prefab',
        '道具22件/DPS/y.mat',
        'misc.zip'
      ]),
      deps()
    )!
    const dps = plan.items.filter((i) => i.groupKey === 'dps')
    expect(dps.length).toBe(2)
    expect(new Set(dps.map((i) => i.relPath)).size).toBe(2)
  })
})

describe('§2 合集在分类结果里的形状', () => {
  it('units 只给 1 条 = 合集自己（库列表一张卡）', () => {
    const r = classify(SHOP, deps())
    expect(r.units.length).toBe(1)
    expect(r.tree).toBeTruthy()
    expect(r.tree!.items.length).toBeGreaterThanOrEqual(5)
    expect(r.units[0].name).toContain('初音的VRC小店')
  })

  it('合集的分类 = 子项多数派', () => {
    const r = classify(SHOP, deps())
    const tally = new Map<string, number>()
    for (const i of r.tree!.items) tally.set(i.unit.category, (tally.get(i.unit.category) ?? 0) + 1)
    const top = Array.from(tally.entries()).sort((a, b) => b[1] - a[1])[0][0]
    expect(r.units[0].category).toBe(top)
  })

  it('合集置信度 = 最低那个子项（一坨里有一件没把握，整包都要人看）', () => {
    const r = classify(SHOP, deps())
    const worst = Math.min(...r.tree!.items.map((i) => i.unit.confidence))
    expect(r.units[0].confidence).toBeCloseTo(worst, 5)
  })

  it('每个子项都记得自己属于哪个合集', () => {
    const r = classify(SHOP, deps())
    for (const i of r.tree!.items) expect(i.unit.bundleRef).toContain('初音的VRC小店')
  })

  it('深度保护：子项不再被二次拆合集（防套娃）', () => {
    const r = classify(SHOP, { ...deps(), depth: 1 })
    expect(r.tree).toBeUndefined()
    expect(r.units.length).toBe(1)
  })

  it('子项条目路径相对化（不能还带着合集名）', () => {
    const r = classify(SHOP, deps())
    const go = r.tree!.items.find((i) => /GoLoco/.test(i.name))!
    expect(go.unit.filePaths[0]).toContain('GoLoco.v.1.8.6u')
    expect(go.unit.filePaths[0].startsWith('插件道具合集')).toBe(false)
  })
})
