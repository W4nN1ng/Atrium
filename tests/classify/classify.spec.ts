import { describe, it, expect, beforeAll } from 'vitest'
import path from 'node:path'
import fs from 'node:fs'
import type { ClassificationResult, FileEntry, IngestResult } from '../../src/shared/types'
import { classify, TH_AUTO, TH_CONFIRM, confidenceTone } from '../../src/main/classify/engine'
import { loadLexicon, type Lexicon } from '../../src/main/classify/lexicon'
import type { CategoryConfig } from '../../src/shared/types'

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

function mk(input: {
  name: string
  dirs?: string[]
  entries?: (string | FileEntry)[]
  readme?: string
  urls?: string[]
  boothId?: string | null
  boothConfidence?: number
  platform?: IngestResult['metadata']['sourcePlatform']
  version?: string | null
}): IngestResult {
  const entries = (input.entries ?? []).map((e) => (typeof e === 'string' ? fe(e) : e))
  return {
    assetId: '01TEST' + Math.random().toString(36).slice(2, 8).toUpperCase(),
    rawName: input.name,
    sourceDirChain: input.dirs ?? [],
    stagingPath: 'C:/fake/staging',
    detectedKind: 'archive',
    detectedFormat: 'zip',
    entries,
    nestedDepth: 1,
    warnings: [],
    totalBytes: entries.reduce((a, e) => a + e.size, 0),
    metadata: {
      urls: input.urls ?? [],
      boothItemId: input.boothId ?? null,
      boothItemIdConfidence: input.boothConfidence ?? 0,
      sourcePlatform: input.platform ?? null,
      version: input.version ?? null,
      localeTag: null,
      author: null,
      readmeText: input.readme ?? '',
      previewImages: entries.filter((e) => /\.(png|jpe?g|psd|tga)$/i.test(e.relPath)).map((e) => e.relPath)
    }
  }
}

const deps = (): Parameters<typeof classify>[1] => ({ lex, categories })
const one = (ingest: IngestResult): ClassificationResult => classify(ingest, deps())

describe('用户分类阈值', () => {
  it('合集汇总后的评分低于确认线时不能自动入库', () => {
    const input = mk({ name: 'ABT 1.3.0', dirs: ['插件'], entries: [
      'ABT left.unitypackage', 'ABT right.unitypackage', 'ABT nopose.unitypackage'
    ] })
    const result = classify(input, { ...deps(), confidenceConfirm: 0.98, confidenceAuto: 0.75 })
    expect(result.units[0].confidence).toBeLessThan(0.98)
    expect(result.tree?.items.every((item) => item.unit.status === 'archived')).toBe(true)
    expect(result.units[0].status).toBe('pending_confirm')
  })
  it('合集的高分不能绕过子项的待确认状态', () => {
    const input = mk({ name: 'ABT 1.3.0', dirs: ['插件'], entries: [
      'ABT 左手.unitypackage', 'ABT 右手.unitypackage', 'ABT 无姿势.unitypackage'
    ] })
    const result = classify(input, { ...deps(), confidenceConfirm: 1, confidenceAuto: 0.1 })
    expect(result.tree?.items.length).toBeGreaterThan(0)
    expect(result.tree?.items.every((item) => item.unit.status === 'pending_confirm')).toBe(true)
    expect(result.units[0].status).toBe('pending_confirm')
  })
  it('确认阈值会改变同一素材的待确认状态，默认评分保持不变', () => {
    const input = mk({ name: 'Dress.zip', entries: ['Assets/Clothes/Dress.prefab'] })
    const normal = one(input).units[0]
    expect(normal.confidence).toBeGreaterThan(0.4)
    expect(normal.confidence).toBeLessThan(1)
    const strict = classify(input, { ...deps(), confidenceConfirm: 1 }).units[0]
    const relaxed = classify(input, { ...deps(), confidenceConfirm: 0.1 }).units[0]
    expect(strict.confidence).toBe(normal.confidence)
    expect(strict.status).toBe('pending_confirm')
    expect(relaxed.status).toBe('archived')
  })
})

describe('§7 特例 3：ABT 1.3.0【汉化 闲鱼@月见汐音】', () => {
  const r = () =>
    one(
      mk({
        name: 'ABT 1.3.0【汉化 闲鱼@月见汐音】',
        dirs: ['插件'],
        entries: [
          'ABT 右手用【汉化 闲鱼@月见汐音】.unitypackage',
          'ABT 左手用【汉化 闲鱼@月见汐音】.unitypackage',
          'ABT 右手用 无姿势【汉化 闲鱼@月见汐音】.unitypackage'
        ]
      })
    )

  it('name=ABT、version=1.3.0', () => {
    const u = r().units[0]
    expect(u.name).toBe('ABT')
    expect(u.version).toBe('1.3.0')
  })

  it('category=插件，且能到自动归档档', () => {
    const u = r().units[0]
    expect(u.category).toBe('plugin')
    expect(u.confidence).toBeGreaterThanOrEqual(TH_CONFIRM)
  })

  it('localeTag=汉化、author=月见汐音、tags 含 汉化', () => {
    const i = mk({ name: 'ABT 1.3.0【汉化 闲鱼@月见汐音】', dirs: ['插件'], entries: ['a.unitypackage'] })
    // 元数据抽取在指纹阶段完成，引擎只负责把它带进标签
    i.metadata.localeTag = '汉化'
    i.metadata.author = '月见汐音'
    const u = classify(i, deps()).units[0]
    expect(u.localeTag).toBe('汉化')
    expect(u.author).toBe('月见汐音')
    expect(u.tags).toContain('汉化')
  })

  it('ABT 是动作类工具 → 二级=动作类', () => {
    expect(r().units[0].subcategory).toBe('action')
  })
})

describe('§7 特例 4：6117553 Shinano_FaceAnimation.rar.rar', () => {
  const r = () =>
    one(
      mk({
        name: '6117553 Shinano_FaceAnimation.rar.rar',
        dirs: ['插件', 'shinano表情'],
        entries: ['FREE無料-Shinano10FaceAnimation.zip', 'Shinano_FaceAnimation.zip']
      })
    )

  it('展示名剥掉 id 与双层扩展名', () => {
    expect(r().units[0].name).toBe('Shinano FaceAnimation')
  })

  it('判成 插件/表情类', () => {
    const u = r().units[0]
    expect(u.category).toBe('plugin')
    expect(u.subcategory).toBe('expression')
  })

  it('tags 含 Shinano 与 表情', () => {
    const u = r().units[0]
    expect(u.tags.concat(u.targetAvatars).map((s) => s.toLowerCase())).toContain('shinano')
    expect(u.tags.join(' ')).toContain('表情')
  })

  it('Booth id 只算疑似（0.4），UI 要标出来', async () => {
    const { extractMetadata } = await import('../../src/main/fingerprint/metadata')
    const md = await extractMetadata({
      fileName: '6117553 Shinano_FaceAnimation.rar.rar',
      dirChain: ['插件', 'shinano表情'],
      reader: { files: () => [], readText: async () => null }
    })
    expect(md.boothItemId).toBe('6117553')
    expect(md.boothItemIdConfidence).toBeLessThan(0.5)
    expect(md.boothItemIdConfidence).toBeGreaterThan(0)
  })
})

describe('§7 特例 6：R5613 武器合集里的单个产品', () => {
  const r = () =>
    one(
      mk({
        name: 'MAD HATER .45',
        dirs: ['R5613-VRChat-武器合集（军事武器合集）', '4185283'],
        entries: ['MAD HATER.fbx', 'MAD HATER.mat', 'Textures/t.png', 'Prefab/m.prefab']
      })
    )

  it('一级=道具、二级=武器', () => {
    const u = r().units[0]
    expect(u.category).toBe('prop')
    expect(u.subcategory).toBe('weapon')
  })

  it('纯数字目录名只给疑似 Booth id', async () => {
    const { extractMetadata } = await import('../../src/main/fingerprint/metadata')
    const md = await extractMetadata({
      fileName: 'MAD HATER .45',
      dirChain: ['R5613-VRChat-武器合集（军事武器合集）', '4185283'],
      reader: { files: () => [], readText: async () => null }
    })
    expect(md.boothItemId).toBe('4185283')
    expect(md.boothItemIdConfidence).toBeLessThan(0.5)
  })
})

describe('§7 特例 7：LightControllerV2.0.3.1.unitypackage', () => {
  const r = () =>
    one(
      mk({
        name: 'LightControllerV2.0.3.1.unitypackage',
        dirs: ['插件', '灯光'],
        entries: ['Assets/LightController/Script.cs', 'Assets/LightController/Menu.asset']
      })
    )

  it('name=LightController、version=2.0.3.1', () => {
    const u = r().units[0]
    expect(u.name).toBe('LightController') // §7 特例 7 要的就是这个
    expect(u.version).toBe('2.0.3.1')
  })

  it('插件 + 交互类或菜单UI类，且必须给出理由', () => {
    const u = r().units[0]
    expect(u.category).toBe('plugin')
    expect(['interactive', 'menu_ui']).toContain(u.subcategory)
    expect(u.reason.length).toBeGreaterThan(0)
    expect(u.reasonParts?.length).toBeGreaterThan(0)
  })
})

describe('§7 特例 8：lilToon_2.x.x/', () => {
  const r = () =>
    one(
      (() => {
        const i = mk({
          name: 'lilToon_2.x.x',
          dirs: [],
          entries: ['lilToon - BOOTH.url', '【重要】以前のバージョンをunitypackageでインストールしている場合.html', 'lilToon.unitypackage'],
          urls: ['https://booth.pm/ja/items/3087170'],
          boothId: '3087170',
          boothConfidence: 0.95,
          platform: 'booth'
        })
        i.metadata.version = '2.x.x'
        return i
      })()
    )

  it('category=着色器', () => {
    expect(r().units[0].category).toBe('shader')
  })

  it('booth 平台 + 商品 id 是硬证据（高置信）', () => {
    const u = r().units[0]
    expect(u.sourceItemId).toBe('3087170')
    expect(u.sourceItemIdConfidence).toBeGreaterThanOrEqual(0.9)
  })
})

describe('§7 特例 9：6866030亲亲音效+亲吻时产生爱心粒子', () => {
  const r = () =>
    one(
      mk({
        name: '6866030亲亲音效+亲吻时产生爱心粒子',
        dirs: ['插件'],
        entries: ['Kiss_Sound_Gimmick_1.0.zip']
      })
    )

  it('插件/音效类', () => {
    const u = r().units[0]
    expect(u.category).toBe('plugin')
    expect(u.subcategory).toBe('sound')
  })
})

describe('§7 特例 10：贴图/6718483Milfy妆容', () => {
  const r = () =>
    one(
      mk({
        name: '6718483Milfy妆容.zip',
        dirs: ['贴图'],
        entries: ['face.png', 'body.png', 'Milfy_makeup.psd']
      })
    )

  it('贴图/化妆，targetAvatars 含 MilfY', () => {
    const u = r().units[0]
    expect(u.category).toBe('texture')
    expect(u.subcategory).toBe('makeup')
    expect(u.targetAvatars.map((s) => s.toLowerCase())).toContain('milfy')
  })
})

describe('§7 特例 1 的单件：Grimoir 包', () => {
  it('名字里写 Grimoir、包里是 GRIMOIRE 系列 → 判服装', () => {
    const u = one(
      mk({
        name: 'Grimoir_SHINANO_V1.0.zip',
        dirs: ['衣服', '27'],
        entries: [
          'Grimoir_SHINANO_V1.0.unitypackage',
          'Assets/C.C.MATILDA/GRIMOIRE/Avatar/SHINANO/Black.prefab',
          'Assets/C.C.MATILDA/GRIMOIRE/Avatar/SHINANO/FBX/SHINANO_Grimoire.fbx'
        ]
      })
    ).units[0]
    expect(u.category).toBe('clothing')
    expect(u.subcategory).toBe('outfit') // 分类表里 套装 的 key 是 outfit
    expect(u.targetAvatars.map((x) => x.toLowerCase())).toContain('shinano')
  })
})

/**
 * R4 ⑤ 的拦路石（沙盒活体实测）：模型名的大小写双胞胎。
 *
 * 散装目录 `Grimoir_SHINANO_V1.0` 的语料里同时出现 `SHINANO`（名字里就是大写）和
 * `shinano`（词典回查用小写）。旧的 `includes` 区分大小写 → targetAvatars 变成 2 条 →
 * commit 里"只有一个模型才算变体"的闸门（`avatars.length === 1`）过不去 →
 * variant 表一条 avatar 都不写 → 聚合视图的「适配模型 ×2」永远出不来。
 * 同一个模型换个写法不能算两个。
 */
describe('模型名不许出现大小写双胞胎（R4 ⑤ 的前提）', () => {
  const folder = (name: string) =>
    one(
      mk({
        name,
        dirs: ['服装'],
        entries: ['body.fbx']
      })
    ).units[0]

  it('散装目录 Grimoir_SHINANO_V1.0 → targetAvatars 只有一条', () => {
    const u = folder('Grimoir_SHINANO_V1.0')
    expect(u.targetAvatars.map((x) => x.toLowerCase())).toContain('shinano')
    expect(u.targetAvatars).toHaveLength(1)
  })

  it('两个模型的大小写混排也各算一个（不许并掉真变体）', () => {
    const u = folder('Grimoir_SHINANO_MANUKA_V1.0')
    const lower = u.targetAvatars.map((x) => x.toLowerCase())
    expect(new Set(lower).size).toBe(u.targetAvatars.length)
    expect(lower.sort()).toEqual(['manuka', 'shinano'])
  })

  it('落在库里的形状：一条 avatar 变体 + 一个 avatar 标签（不是双胞胎）', () => {
    const u = folder('Grimoir_SHINANO_V1.0')
    expect(u.targetAvatars.length).toBe(1)
    // 归并键仍然认得出是 grimoir 系列，分列才有组可挂
    expect(u.groupKey).toBe('grimoir')
  })
})

describe('技术词不许盖过产品词（真件踩过的坑）', () => {
  it('服装 fullset 包里有 MatCap 贴图，也不能判成材质', () => {
    const u = one(
      mk({
        name: '束縛チャイナFULLSET.zip',
        dirs: ['衣服'],
        entries: [
          '束紛チャイナ.png',
          '束紛チャイナ_.png',
          '束紛チャイナFullset v1.3.unitypackage',
          'Assets/MatCap/mc_body.png',
          'Assets/MatCap/mc_cloth.png',
          'Assets/Fullset/dress.prefab',
          'Assets/Fullset/dress.mat'
        ]
      })
    ).units[0]
    expect(u.category).not.toBe('material')
    expect(['clothing', 'model']).toContain(u.category)
  })
})

describe('模型包不许被判成材质（真件加的分档封顶）', () => {
  it('FBX + prefab + matcap 贴图 → 材质候选的置信度必须压到自动归档线以下', () => {
    const u = one(
      mk({
        name: 'Zqbox_Thing_v1.zip', // 故意不含任何产品词，只剩贴图/材质线索
        dirs: [],
        entries: [
          'Assets/x/Body_matcap_01.png',
          'Assets/x/FBX/body.fbx',
          'Assets/x/Prefab/body.prefab',
          'Assets/x/Material/a.mat',
          'Assets/x/Material/b.mat'
        ]
      })
    ).units[0]
    expect(u.confidence).toBeLessThan(TH_AUTO)
    expect(u.status).toBe('pending_confirm')
  })
})

describe('低置信与通用要求', () => {
  it('什么线索都没有的 abc.zip 必须落待确认，不许瞎猜', () => {
    const u = one(mk({ name: 'abc.zip', entries: ['q.unk'] })).units[0]
    expect(u.status).toBe('pending_confirm')
    expect(u.confidence).toBeLessThan(TH_CONFIRM)
  })

  it('每条结果都必须有 reason 和 reasonParts', () => {
    const cases = [
      mk({ name: 'ABT 1.3.0【汉化】', dirs: ['插件'], entries: ['a.unitypackage'] }),
      mk({ name: 'abc.zip', entries: ['q.unk'] }),
      mk({ name: 'LongHair.fbx', entries: ['LongHair.fbx'] })
    ]
    for (const c of cases) {
      const u = classify(c, deps()).units[0]
      expect(u.reason.length, c.rawName).toBeGreaterThan(0)
      expect(u.reasonParts?.length, c.rawName).toBeGreaterThan(0)
    }
  })

  it('分档颜色与阈值一致', () => {
    expect(confidenceTone(0.95)).toBe('ok')
    expect(confidenceTone(0.5)).toBe('warn')
    expect(confidenceTone(0.1)).toBe('bad')
    expect(TH_AUTO).toBe(0.75)
    expect(TH_CONFIRM).toBe(0.4)
  })

  it('分类结果必须落在分类表里（不许出现表外的 key）', () => {
    const u = one(mk({ name: 'Grimoir_SHINANO_V1.0.zip', dirs: ['衣服', '27'], entries: ['Assets/a.prefab'] })).units[0]
    const cat = categories.categories.find((c) => c.key === u.category)
    expect(cat, 'category=' + u.category).toBeTruthy()
    if (u.subcategory) expect(cat?.subcategories.some((s) => s.key === u.subcategory)).toBe(true)
  })

  it('§9 性能：100 个素材批量分类 ≤10 秒', () => {
    const items = Array.from({ length: 100 }, (_, i) =>
      mk({ name: `Some_Avatar_Pack_${i}.zip`, dirs: ['插件', '动作类'], entries: ['Assets/a.prefab', 'Assets/b.mat', 'Assets/c.png'] })
    )
    const t0 = Date.now()
    for (const it of items) classify(it, deps())
    const ms = Date.now() - t0
    expect(ms).toBeLessThan(10000)
    // 单素材 ≤150ms
    expect(ms / items.length).toBeLessThan(150)
  })
})
