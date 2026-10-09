import { describe, it, expect, beforeAll } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { planGroups, groupSummary, type GroupableAsset } from '../../src/main/classify/grouping'
import { deriveGroupKey } from '../../src/main/classify/groupKey'
import { loadLexicon, type Lexicon } from '../../src/main/classify/lexicon'

const ROOT = path.resolve(__dirname, '../..')
let lex: Lexicon
beforeAll(() => {
  lex = loadLexicon({ builtin: path.join(ROOT, 'resources/lexicon/lexicon.json') })
})

function item(rawName: string, category = 'clothing', extra: Partial<GroupableAsset> = {}): GroupableAsset {
  return {
    id: rawName,
    rawName,
    category,
    sourceUrl: extra.sourceUrl ?? null,
    sourceItemId: extra.sourceItemId ?? null,
    groupKey: deriveGroupKey(rawName, lex).groupKey,
    tokens: deriveGroupKey(rawName, lex)
  }
}

const GRIMOIR = ['AIRI', 'CHIFFON', 'KIKYO', 'MANUKA', 'MILLTINA', 'MOE', 'RURUNE', 'SELESTIA', 'SHINANO', 'SHINRA', 'SIO'].map(
  (a) => `Grimoir_${a}_V1.0.zip`
)

describe('§8.2 归并：11 个 Grimoir', () => {
  it('并成 1 组、11 个 avatar 变体（§7 特例 1）', () => {
    const plans = planGroups(GRIMOIR.map((n) => item(n)))
    expect(plans.length).toBe(1)
    expect(plans[0].memberIds.length).toBe(11)
    expect(plans[0].groupKey).toBe('grimoir')
    expect(plans[0].category).toBe('clothing')
    const kinds = new Set(plans[0].variants.map((v) => v.kind))
    expect(kinds).toEqual(new Set(['avatar']))
    const avatars = plans[0].variants.map((v) => v.value).sort()
    expect(avatars).toContain('SHINANO')
    expect(avatars).toContain('MANUKA')
    expect(avatars.length).toBe(11)
  })

  it('targetAvatars 能覆盖全部 11 个模型名', () => {
    const plans = planGroups(GRIMOIR.map((n) => item(n)))
    expect(groupSummary(plans[0]).byKind.avatar?.length).toBe(11)
    expect(groupSummary(plans[0]).badge).toBe('11 变体')
  })

  it('版本号不影响 groupKey（V1.0 / v1.0 / 1.0 都归一个 key）', () => {
    const a = deriveGroupKey('Grimoir_SHINANO_V1.0.zip', lex)
    const b = deriveGroupKey('Grimoir_SHINANO_v1.0.zip', lex)
    const c = deriveGroupKey('Grimoir_SHINANO_1.0.zip', lex)
    expect(a.groupKey).toBe(b.groupKey)
    expect(b.groupKey).toBe(c.groupKey)
    expect(a.version).toBe('1.0')
    expect(a.avatar).toBe('SHINANO')
  })
})

describe('不许误并', () => {
  it('Grimoir_Gimmick / Grimoir_Hat 不许并进 11 个模型版（用户点名过）', () => {
    const plans = planGroups([...GRIMOIR, 'Grimoir_Gimmick_V1.0.zip', 'Grimoir_Hat_V1.0.zip'].map((n) => item(n)))
    expect(plans.length).toBe(1)
    expect(plans[0].memberIds.length).toBe(11)
    expect(plans[0].memberIds.join(' ')).not.toContain('Gimmick')
    expect(plans[0].memberIds.join(' ')).not.toContain('Hat')
  })

  it('Grimoir2_SHINANO 与 Grimoir_SHINANO 不得归并', () => {
    const plans = planGroups([item('Grimoir_SHINANO_V1.0.zip'), item('Grimoir2_SHINANO_V1.0.zip')])
    expect(plans).toEqual([])
  })

  it('一级分类不同就不并（哪怕 key 一样）', () => {
    const plans = planGroups([item('Foo_BAR_V1.0.zip', 'clothing'), item('Foo_QUEZ_V1.0.zip', 'accessory')])
    expect(plans).toEqual([])
  })

  it('单成员不成组（§3.3 关掉归并时自动解散）', () => {
    expect(planGroups([item('Only_One_V1.0.zip')])).toEqual([])
  })
})

describe('§7 特例 2：PCS 的两种安装方式', () => {
  // describe 体在收集阶段就跑，那时 beforeAll 还没加载词典 —— 必须写成函数延迟求值
  const items = (): GroupableAsset[] =>
    ['(Modular) PCS v1.10.0.unitypackage', '(VRCFury) PCS v1.10.0.unitypackage'].map((n) => item(n, 'plugin'))

  it('并成 1 组、2 个 install_method 变体', () => {
    const plans = planGroups(items())
    expect(plans.length).toBe(1)
    expect(plans[0].memberIds.length).toBe(2)
    expect(new Set(plans[0].variants.map((v) => v.kind))).toEqual(new Set(['install_method']))
    expect(plans[0].variants.map((v) => v.value).sort()).toEqual(['modular', 'vrcfury'])
  })
})

describe('靠来源链接归并', () => {
  it('同一 Booth 商品下的两个文件归为一组（判定 ③）', () => {
    const plans = planGroups([
      item('pack_pc.zip', 'plugin', { sourceItemId: '1234567' }),
      item('pack_quest.zip', 'plugin', { sourceItemId: '1234567' })
    ])
    expect(plans.length).toBe(1)
    expect(plans[0].memberIds.length).toBe(2)
  })

  it('同一 URL 归为一组（判定 ②）', () => {
    const plans = planGroups([
      item('alpha_thing_v1.zip', 'texture', { sourceUrl: 'https://booth.pm/ja/items/999' }),
      item('beta_thing_v2.zip', 'texture', { sourceUrl: 'https://booth.pm/ja/items/999' })
    ])
    expect(plans.length).toBe(1)
    expect(plans[0].groupKey).not.toBe('')
  })

  it('疑似 id 相同也归并，但 UI 那边仍要单独标"待确认"', () => {
    const a = item('6718483Milfy妆容.zip', 'texture', { sourceItemId: '6718483' })
    const b = item('Milfy_face.psd', 'texture', { sourceItemId: '6718483' })
    const plans = planGroups([a, b])
    expect(plans.length).toBe(1)
  })
})

describe('#40 归并的目录前提（用户裁定：跨目录的 groupKey 相同不构成归并理由）', () => {
  /** item() 拿 rawName 当 id，三条同名素材必须显式给不同 id，否则 DSU 里它们本来就是同一个节点 */
  const withDir = (raw: string, dir: string, id: string, extra: Partial<GroupableAsset> = {}): GroupableAsset => ({
    ...item(raw, 'texture', extra),
    id,
    dir
  })

  it('三个不同目录下的同名产品，必须各自成卡，不得归并', () => {
    const plans = planGroups([
      withDir('4900077.zip', 'E:/vrc/A/贴图/脸部', 'a'),
      withDir('4900077.zip', 'E:/vrc/A/贴图/lime', 'b'),
      withDir('4900077.zip', 'E:/vrc/A/贴图/化妆', 'c')
    ])
    expect(plans, 'planGroups 只返回成员 >1 的组；空数组 = 三个都独立成卡').toEqual([])
  })

  it('同一个目录下的同名产品照旧并成一组（闸门不许砍掉正常归并）', () => {
    const plans = planGroups([
      withDir('4900077.zip', 'E:/vrc/A/贴图/脸部', 'a'),
      withDir('4900077.zip', 'E:/vrc/A/贴图/脸部', 'b')
    ])
    expect(plans.length).toBe(1)
    expect(plans[0].memberIds.length).toBe(2)
  })

  it('路径写法不同（反斜杠 / 尾斜杠 / 大小写）要认成同一个目录', () => {
    const plans = planGroups([
      withDir('DPS.zip', 'E:\\vrc\\A\\道具\\DPS', 'a'),
      withDir('DPS.zip', 'e:/vrc/A/道具/DPS/', 'b'),
      withDir('DPS.zip', 'E:/vrc/A/道具/DPS', 'c')
    ])
    expect(plans.length, '三种写法是同一个货架，必须并成一组').toBe(1)
    expect(plans[0].memberIds.length).toBe(3)
  })

  it(' Booth 商品 id / 来源链接是"同一件商品的两份拷贝"级别的事实，仍然跨目录合并', () => {
    const sameId = planGroups([
      withDir('Sexy_skin_material.zip', 'E:/vrc/A/贴图/皮肤', 'a', { sourceItemId: '6053463' }),
      withDir('Sexy skin material for VRC.zip', 'E:/vrc/A/贴图/6718483Milfy妆容', 'b', { sourceItemId: '6053463' })
    ])
    expect(sameId.length, '真库里这种重复拷贝有 6 组，ID 相同要认').toBe(1)
    const sameUrl = planGroups([
      withDir('cover_a.zip', 'E:/vrc/A/贴图/皮肤', 'x', { sourceUrl: 'https://booth.pm/ja/items/6053463' }),
      withDir('cover_b.zip', 'E:/vrc/A/贴图/化妆', 'y', { sourceUrl: 'https://booth.pm/ja/items/6053463' })
    ])
    expect(sameUrl.length).toBe(1)
  })

  it('没传 dir（老数据 / 判不了）时保持原行为，不许把归并整个关掉', () => {
    const plans = planGroups([item('DPS_v1.0.zip', 'texture'), item('DPS_v1.1.zip', 'texture')])
    expect(plans.length).toBe(1)
  })
})

describe('§9 性能：5 万素材增量归并', () => {
  it('批量归并 5 万个条目 ≤ 5 秒（增量单条另算）', () => {
    const many: GroupableAsset[] = Array.from({ length: 50000 }, (_, i) => ({
      id: 'a' + i,
      rawName: `Product_${i}_V1.0.zip`,
      category: 'plugin',
      sourceUrl: null,
      sourceItemId: null,
      groupKey: 'product ' + i,
      tokens: deriveGroupKey(`Product_${i}_V1.0.zip`, lex)
    }))
    const t0 = Date.now()
    const plans = planGroups(many)
    expect(Date.now() - t0).toBeLessThan(5000)
    expect(plans.length).toBe(0) // 每个 key 只有一个成员 → 全不成组
  }, 60000)
})
