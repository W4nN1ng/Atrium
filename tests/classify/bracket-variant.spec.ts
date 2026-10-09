import { describe, it, expect, beforeAll } from 'vitest'
import path from 'node:path'
import { deriveGroupKey, passBrackets, splitModelCandidates, type NameTokens } from '../../src/main/classify/groupKey'
import { planGroups, type GroupableAsset } from '../../src/main/classify/grouping'
import { loadLexicon, type Lexicon } from '../../src/main/classify/lexicon'

/**
 * 增量改动单 2 §B 的全部规则。
 *
 * 两套数据都测：§B0 里用户抄给我的 20 个名字，和 `E:\vrc\A\衣服\名流\` 里**实际躺着**的 20 个。
 * 两者不一样 —— 真数据里版本号各不相同（1.00～1.04），还有一个
 * `Libero[KipfelMame_ATTITUDE]_1.00` 把 `&` 写丢了、系列名也截短成 `ATTITUDE`。
 * 只测抄来的那份会全绿然后在真库上翻车，所以两份都要过。
 */
const ROOT = path.resolve(__dirname, '../..')
let lex: Lexicon

beforeAll(() => {
  lex = loadLexicon({ builtin: path.join(ROOT, 'resources/lexicon/lexicon.json') })
})

/** §B0：改动单里抄的 20 个（版本号统一 1.01） */
const LIBERO_SPEC = [
  'Libero[Airi_ATTITUDE The Royal Bunny]_1.01.unitypackage',
  'Libero[Chiffon&Chocolat_ATTITUDE The Royal Bunny]_1.01.unitypackage',
  'Libero[Ichigo_ATTITUDE The Royal Bunny]_1.01.unitypackage',
  'Libero[Kipfel&Mame_ATTITUDE The Royal Bunny]_1.01.unitypackage',
  'Libero[Kumaly_ATTITUDE The Royal Bunny]_1.01.unitypackage',
  'Libero[Lasyusha_ATTITUDE The Royal Bunny]_1.01.unitypackage',
  'Libero[Lumina_ATTITUDE The Royal Bunny]_1.01.unitypackage',
  'Libero[Manuka_ATTITUDE The Royal Bunny]_1.01.unitypackage',
  'Libero[Milfy&Eku_ATTITUDE The Royal Bunny]_1.01.unitypackage',
  'Libero[Milltina_ATTITUDE The Royal Bunny]_1.01.unitypackage',
  'Libero[Misaki_ATTITUDE The Royal Bunny]_1.01.unitypackage',
  'Libero[Moe_ATTITUDE The Royal Bunny]_1.01.unitypackage',
  'Libero[Nemesis&Elusion_ATTITUDE The Royal Bunny]_1.01.unitypackage',
  'Libero[Ramune_ATTITUDE The Royal Bunny]_1.01.unitypackage',
  'Libero[Rurune&Mizuki_ATTITUDE The Royal Bunny]_1.01.unitypackage',
  'Libero[Selestia_ATTITUDE The Royal Bunny]_1.01.unitypackage',
  'Libero[Shinano_ATTITUDE The Royal Bunny]_1.01.unitypackage',
  'Libero[Shinra_ATTITUDE The Royal Bunny]_1.01.unitypackage',
  'Libero[Sio_ATTITUDE The Royal Bunny]_1.01.unitypackage',
  'Libero[Sion_ATTITUDE The Royal Bunny]_1.01.unitypackage'
]

/** 真库 `E:\vrc\A\衣服\名流\` 顶层的 20 个（2026-10-05 实读） */
const LIBERO_REAL = [
  'Libero[Airi_ATTITUDE The Royal Bunny]_1.03.unitypackage',
  'Libero[Chiffon&Chocolat_ATTITUDE The Royal Bunny]_1.02.unitypackage',
  'Libero[Ichigo_ATTITUDE The Royal Bunny]_1.01.unitypackage',
  'Libero[KipfelMame_ATTITUDE]_1.00.unitypackage',
  'Libero[Kumaly_ATTITUDE The Royal Bunny]_1.00.unitypackage',
  'Libero[Lasyusha_ATTITUDE The Royal Bunny]_1.01.unitypackage',
  'Libero[Lumina_ATTITUDE The Royal Bunny]_1.00.unitypackage',
  'Libero[Manuka_ATTITUDE The Royal Bunny]_1.03.unitypackage',
  'Libero[Milfy&Eku_ATTITUDE The Royal Bunny]_1.01.unitypackage',
  'Libero[Milltina_ATTITUDE The Royal Bunny]_1.02.unitypackage',
  'Libero[Misaki_ATTITUDE The Royal Bunny]_1.00.unitypackage',
  'Libero[Moe_ATTITUDE The Royal Bunny]_1.04.unitypackage',
  'Libero[Nemesis&Elusion_ATTITUDE The Royal Bunny]_1.00.unitypackage',
  'Libero[Ramune_ATTITUDE The Royal Bunny]_1.00.unitypackage',
  'Libero[Rurune&Mizuki_ATTITUDE The Royal Bunny]_1.00.unitypackage',
  'Libero[Selestia_ATTITUDE The Royal Bunny]_1.01.unitypackage',
  'Libero[Shinano_ATTITUDE The Royal Bunny]_1.00.unitypackage',
  'Libero[Shinra_ATTITUDE The Royal Bunny]_1.01.unitypackage',
  'Libero[Sio_ATTITUDE The Royal Bunny]_1.02.unitypackage',
  'Libero[Sion_ATTITUDE The Royal Bunny]_1.01.unitypackage'
]

const tok = (n: string): NameTokens => deriveGroupKey(n, lex)

function item(rawName: string, category = 'clothing'): GroupableAsset {
  const t = tok(rawName)
  return { id: rawName, rawName, category, sourceUrl: null, sourceItemId: null, groupKey: t.groupKey, tokens: t }
}

describe('§A4 在归并键这条路上也要生效（真库跑出来的缺陷）', () => {
  it('deriveGroupKey 不许从 UUID 里咬出假版本号', () => {
    /**
     * cleanDisplayName 早就在提版本前剥 UUID 了，deriveGroupKey 没剥 ——
     * 于是展示名修好了、版本行还是 `99874-3687-4746-8e`。
     * 同一规则两份实现必然漂走，这次收到 shared/naming.stripIdLike 一处了。
     */
    const uuid = 'd6b99874-3687-4746-8eca-21c8050c74a0 base resized.jpg'
    const t = tok(uuid)
    expect(t.version).toBeNull()
    expect(t.groupKey).not.toContain('99874')

    const hex = 'ab4fc71c65f415fba41234567890abcd.png'
    expect(tok(hex).version).toBeNull()

    // 真版本号不许被顺手带掉
    expect(tok('Tool_1.2.3.zip').version).toBe('1.2.3')
    expect(tok('Grimoir_SHINANO_V1.0.zip').version).toBe('1.0')
  })
})

describe('§B2 方括号变体槽位：20 个 Libero 归并成 1 组', () => {
  it.each([
    ['改动单抄来的那份', LIBERO_SPEC],
    ['真库实读的那份', LIBERO_REAL]
  ])('%s：20 个 groupKey 全同（验收 6 的根）', (_label, names) => {
    const keys = new Set(names.map((n) => tok(n).groupKey))
    expect(keys.size, `散成了 ${keys.size} 个 key：${[...keys].join(' | ')}`).toBe(1)
  })

  it.each([
    ['改动单抄来的那份', LIBERO_SPEC],
    ['真库实读的那份', LIBERO_REAL]
  ])('%s：planGroups 只出 1 组、20 个成员、20 个 avatar 变体', (_label, names) => {
    const plans = planGroups(names.map((n) => item(n)))
    expect(plans.length).toBe(1)
    expect(plans[0].memberIds.length).toBe(20)
    expect(new Set(plans[0].variants.map((v) => v.kind))).toEqual(new Set(['avatar']))
    expect(new Set(plans[0].variants.map((v) => v.value)).size, '每个变体值得互不相同').toBe(20)
  })

  it('系列名 ATTITUDE 留在 groupKey 里（§B3：不同系列不许被误并）', () => {
    const k = tok(LIBERO_REAL[0]).groupKey
    expect(k).toContain('libero')
    expect(k).toContain('attitude')
    expect(tok(LIBERO_REAL[0]).series).toEqual(['ATTITUDE'])
  })

  it('版本号照旧摘出来，不被括号搅乱（真数据 1.00～1.04 各归各）', () => {
    expect(tok(LIBERO_REAL[0]).version).toBe('1.03')
    expect(tok(LIBERO_REAL[11]).version).toBe('1.04')
    expect(tok(LIBERO_REAL[3]).version).toBe('1.00')
    for (const n of LIBERO_SPEC) expect(tok(n).version, n).toBe('1.01')
  })

  it('variant_raw 记下了括号原文（UI 要显示"为什么并到一起"）', () => {
    expect(tok('Libero[Shinano_ATTITUDE The Royal Bunny]_1.00.unitypackage').variantRaw).toEqual([
      'Shinano_ATTITUDE The Royal Bunny'
    ])
    expect(tok(LIBERO_REAL[16]).stripped.some((s) => s.kind === 'bracket')).toBe(true)
  })
})

describe('§B3 复合模型名拆分', () => {
  it('`Chiffon&Chocolat` 拆成两个候选名（验收 9）', () => {
    const bp = passBrackets('Libero[Chiffon&Chocolat_ATTITUDE The Royal Bunny]_1.01', lex)
    expect(bp.slotTokens).toEqual(['Chiffon', 'Chocolat'])
    expect(bp.hitTokens).toEqual(['Chiffon', 'Chocolat'])
  })

  it('六种连接符都认：& ＆ + ＋ 、 , ，', () => {
    for (const sep of ['&', '\uFF06', '+', '\uFF0B', '\u3001', ',', '\uFF0C']) {
      const bp = passBrackets(`Libero[Airi${sep}Moe_SERIES]_1.0`, lex)
      expect(bp.slotTokens, `分隔符 ${sep}`).toEqual(['Airi', 'Moe'])
    }
  })

  it('四个复合名逐个数对（验收 9）', () => {
    const cases: Array<[string, string[]]> = [
      ['Libero[Milfy&Eku_ATTITUDE The Royal Bunny]_1.01.unitypackage', ['EKU', 'MILFY']],
      ['Libero[Kipfel&Mame_ATTITUDE The Royal Bunny]_1.01.unitypackage', ['KIPFEL', 'MAME']],
      ['Libero[Nemesis&Elusion_ATTITUDE The Royal Bunny]_1.01.unitypackage', ['ELUSION', 'NEMESIS']],
      ['Libero[Rurune&Mizuki_ATTITUDE The Royal Bunny]_1.01.unitypackage', ['MIZUKI', 'RURUNE']],
      ['Libero[Chiffon&Chocolat_ATTITUDE The Royal Bunny]_1.02.unitypackage', ['CHIFFON', 'CHOCOLAT']]
    ]
    for (const [name, want] of cases) expect(tok(name).avatars.slice().sort(), name).toEqual(want)
  })

  it('真库里 `&` 写丢了的 `KipfelMame` 靠驼峰拆开（且只在两段都命中词表时才拆）', () => {
    expect(splitModelCandidates('KipfelMame', lex)).toEqual(['Kipfel', 'Mame'])
    expect(tok('Libero[KipfelMame_ATTITUDE]_1.00.unitypackage').avatars.slice().sort()).toEqual(['KIPFEL', 'MAME'])
    // 全命不中就不许劈：劈错了 groupKey 再也拼不回去
    expect(splitModelCandidates('FaceAnimation', lex)).toEqual(['FaceAnimation'])
    expect(splitModelCandidates('ATTITUDE', lex)).toEqual(['ATTITUDE'])
  })

  it('词表认得的进 avatars，认不进的进 variantUnknown（喂 §B4 学习流程）', () => {
    const t = tok('Libero[Zorblax_ATTITUDE The Royal Bunny]_1.01.unitypackage')
    expect(t.variantUnknown).toEqual(['Zorblax'])
    expect(t.avatars).toEqual([])
    expect(t.groupKey, '词表不认也必须并得上').toBe('libero attitude')
  })
})

describe('§B2 安全保护：不许过度合并', () => {
  it('闸门 ①：括号外不足 2 字 → 不套用，括号里的生词留在 groupKey', () => {
    const blocked = tok('a[Zorblax_Series Name]')
    expect(blocked.variantRaw).toEqual([])
    expect(blocked.groupKey).toContain('zorblax')
    // 同一个名字，前缀够 2 字就套用了 —— 差别只可能在闸门上
    const passed = tok('ab[Zorblax_Series Name]')
    expect(passed.variantRaw).toEqual(['Zorblax_Series Name'])
    expect(passed.variantUnknown).toEqual(['Zorblax'])
    expect(passed.groupKey).not.toContain('zorblax')
  })

  it('闸门 ②：单位段且括号内容超过全名 70% → 不套用', () => {
    const long = 'ab[' + 'X'.repeat(60) + ']'
    const t = tok(long)
    expect(t.variantRaw).toEqual([])
    expect(t.groupKey.length).toBeGreaterThan(10)
  })

  it('单位段但比例合规 → 括号只是分隔符，认不认得全看词表', () => {
    const t = tok('Grimoir[SHINANO].zip')
    expect(t.variantRaw).toEqual(['SHINANO'])
    expect(t.groupKey).toBe('grimoir')
    // 词表不认的生词，单位段时**不**当变体（改动单 1 §2.3 的裁定：只有命中词表才算变体）
    const u = tok('Grimoir[Zorblax].zip')
    expect(u.variantUnknown).toEqual([])
    expect(u.groupKey).toContain('zorblax')
  })

  it('验收 11：Grimoir_Hat / Grimoir_Gimmick 没被并进 Grimoir 的模型版里', () => {
    const names = [
      'Grimoir_AIRI_V1.0.zip',
      'Grimoir_MANUKA_V1.0.zip',
      'Grimoir_SHINANO_V1.0.zip',
      'Grimoir_Hat.zip',
      'Grimoir_Gimmick.zip'
    ]
    const plans = planGroups(names.map((n) => item(n)))
    // planGroups 只返回"确实多于一个成员"的组，Hat / Gimmick 是单件，压根不该出现在任何组里
    expect(plans.length, '只该有模型版那一组').toBe(1)
    expect(plans[0].groupKey).toBe('grimoir')
    expect(plans[0].memberIds.slice().sort()).toEqual(
      ['Grimoir_AIRI_V1.0.zip', 'Grimoir_MANUKA_V1.0.zip', 'Grimoir_SHINANO_V1.0.zip'].sort()
    )
    const all = plans.flatMap((p) => p.memberIds)
    expect(all).not.toContain('Grimoir_Hat.zip')
    expect(all).not.toContain('Grimoir_Gimmick.zip')
  })

  it('ABT 左手用 / 右手用 仍是 2 件（改动单 1 §2.3 的裁定没被 B2 冲掉）', () => {
    const plans = planGroups([item('ABT 左手用【汉化】.unitypackage'), item('ABT 右手用【汉化】.unitypackage')])
    expect(plans.length, '一个都不许并').toBe(0)
  })

  it('同目录里的**别的产品**不许被 Libero 吸走', () => {
    // 真库 `名流\材质包 PSD\` 里还有一个 ATTITUDE_Stocking no Lace，系列词撞了但不是 Libero
    const plans = planGroups(
      [...LIBERO_REAL, 'ATTITUDE_Stocking no Lace.unitypackage', '材质包 PSD/Libero[Material_ATTITUDE The Royal Bunny]_1.00.unitypackage'].map(
        (n) => item(n)
      )
    )
    const libero = plans.find((p) => p.memberIds.length === 20)
    expect(libero, 'Libero 那 20 个自成一组').toBeTruthy()
    expect(libero?.memberIds).not.toContain('ATTITUDE_Stocking no Lace.unitypackage')
  })

  it('安全保护 3：同目录 ≥3 个不同前缀塌成同一个 key → 判歧义，不自动合并', () => {
    /**
     * 前缀本身是 avatar 词表里的词时，它会被当变体 token 剥掉 —— 于是三件不同东西的
     * groupKey 全塌成系列名那一个词。这时候 key 已经没有区分力了，并起来就是错的。
     */
    const dir = 'E:\\vrc\\A\\衣服\\某目录'
    const names = ['Shinano[X_Same Series]_1.0.zip', 'Manuka[Y_Same Series]_1.0.zip', 'Moe[Z_Same Series]_1.0.zip']
    const toks = names.map((n) => tok(n))
    expect(new Set(toks.map((t) => t.groupKey)).size, '三个 key 确实塌成一个了').toBe(1)
    expect(toks[0].groupKey).toBe('same')
    expect(toks.map((t) => t.slotPrefixes[0])).toEqual(['shinano', 'manuka', 'moe'])

    const withDir = planGroups(names.map((n) => ({ ...item(n), dir })))
    expect(withDir.length, '歧义 → 一个都不许并').toBe(0)

    // 同一批文件不给目录信息时判不了歧义，照旧并（说明闸门挂在"目录"上，不是挂在名字上）
    const noDir = planGroups(names.map((n) => item(n)))
    expect(noDir.length).toBe(1)
    expect(noDir[0].memberIds.length).toBe(3)
  })

  it('安全保护 3 不误伤 Libero：20 个前缀全同 → 照旧并成一组', () => {
    const dir = 'E:\\vrc\\A\\衣服\\名流'
    const plans = planGroups(LIBERO_REAL.map((n) => ({ ...item(n), dir })))
    expect(plans.length).toBe(1)
    expect(plans[0].memberIds.length).toBe(20)
    expect(new Set(LIBERO_REAL.map((n) => tok(n).slotPrefixes[0]))).toEqual(new Set(['libero']))
  })

  it('全角括号【】／（）同样当槽位', () => {
    expect(tok('Libero【Shinano_ATTITUDE The Royal Bunny】_1.01').variantRaw).toEqual([
      'Shinano_ATTITUDE The Royal Bunny'
    ])
    expect(tok('Libero（Shinano_ATTITUDE The Royal Bunny）_1.01').variantRaw).toEqual([
      'Shinano_ATTITUDE The Royal Bunny'
    ])
  })

  it('真库里的**说明性括号**没被当成变体槽位（都是单位段，走词表）', () => {
    for (const n of [
      'ABT 1.3.0【汉化 闲鱼@月见汐音】.unitypackage',
      '何か【必看】.zip',
      '何か【历史版本】.zip',
      'ツール【Unity上でポーズが作れる】.zip'
    ]) {
      const t = tok(n)
      expect(t.variantUnknown, n).toEqual([])
    }
  })
})

describe('§B5 同前缀建议合并（不自动合并）', () => {
  /** 改动单 2 §B5 里抄的 6 个（空格分隔、无括号、无版本号） */
  const TWINKLE_SPEC = [
    'TwinkleSpica Mint.unitypackage',
    'TwinkleSpica Plum.unitypackage',
    'TwinkleSpica Chocolate.unitypackage',
    'TwinkleSpica Eku.unitypackage',
    'TwinkleSpica Ramune.unitypackage',
    'TwinkleSpica Shinano.unitypackage'
  ]

  /**
   * 真库 `E:\vrc\A\衣服\衣服TwinkleSpica\` 实读的 19 个（2026-10-05）。
   * 和 §B5 举的例子**根本不是一回事**：真数据是 `TwinkleSpica_<模型>_v1.x.zip`，
   * 下划线分隔带版本号，结构上和 `Grimoir_SHINANO_V1.0.zip` 一模一样。
   * 所以这里不能照抄改动单的说法断言"6 个都不许并" —— 见下面两条的注释。
   */
  const TWINKLE_REAL = [
    'TwinkleSpica_Chiffon_v1.1.zip',
    'TwinkleSpica_Chocolat_v1.1.zip',
    'TwinkleSpica_Eku_v1.1.zip',
    'TwinkleSpica_Karin_v1.1.zip',
    'TwinkleSpica_Lime_v1.1.zip',
    'TwinkleSpica_Manuka_v1.1.zip',
    'TwinkleSpica_Manuka_v1.3.zip',
    'TwinkleSpica_Milfy_v1.1.zip',
    'TwinkleSpica_Milk_v1.1.zip',
    'TwinkleSpica_Milltina_v1.0.zip',
    'TwinkleSpica_Mint_v1.1.zip',
    'TwinkleSpica_Mizuki_v1.0.zip',
    'TwinkleSpica_Moe_v1.1.zip',
    'TwinkleSpica_Plum_v1.1.zip',
    'TwinkleSpica_Ramune_v1.1.zip',
    'TwinkleSpica_Rurune_v1.0.zip',
    'TwinkleSpica_Rusk_v1.1.zip',
    'TwinkleSpica_Selestia_v1.1.zip',
    'TwinkleSpica_Shinano_v1.1.zip'
  ]

  it('配色名（词表不认）一个都不许并：Mint / Plum / Chocolate 各自独立', () => {
    const plans = planGroups(TWINKLE_SPEC.map((n) => item(n)))
    const merged = plans.flatMap((p) => p.memberIds)
    for (const color of ['Mint', 'Plum', 'Chocolate']) {
      expect(merged, `${color} 是配色不是模型，不许自动并`).not.toContain(`TwinkleSpica ${color}.unitypackage`)
    }
  })

  it('模型名（词表认得）按改动单 1 §2.3 仍算 avatar 变体 —— 这是 §B5 与 §2.3 的冲突点', () => {
    /**
     * 改动单 2 §B5 说这 6 个"不自动合并"，但它自己 §B4 又要求把 Eku / Ramune 补进 avatar 词表；
     * 补进去之后，按改动单 1 §2.3「只有差异 token 命中已知词表时才算变体」它们就该并。
     * 两条规则对同一批文件给了相反的答案。我按 §2.3 走（词表命中=变体），
     * 因为 Grimoir 那 11 个的既有裁定就是这个口径，而 §B5 担心的"配色被当成模型"
     * 恰恰是靠词表区分开的 —— Mint/Plum/Chocolate 不在词表里，它们没被并。
     * **这处冲突已在报告里单列，等用户裁。**
     */
    const plans = planGroups(TWINKLE_SPEC.map((n) => item(n)))
    expect(plans.length).toBe(1)
    expect(plans[0].memberIds.slice().sort()).toEqual(
      ['TwinkleSpica Eku.unitypackage', 'TwinkleSpica Ramune.unitypackage', 'TwinkleSpica Shinano.unitypackage'].sort()
    )
  })

  it('真库 19 个：15 个模型名并成一组，4 个配色/生词各自独立', () => {
    const plans = planGroups(TWINKLE_REAL.map((n) => item(n)))
    expect(plans.length, '只该并出 1 组').toBe(1)
    const merged = plans[0].memberIds
    expect(merged.length).toBe(15)
    // Manuka 的两个版本都在组里（版本归并是 bundle 层的活，这里只确认没被踢出去）
    expect(merged).toContain('TwinkleSpica_Manuka_v1.1.zip')
    expect(merged).toContain('TwinkleSpica_Manuka_v1.3.zip')
    for (const odd of ['Karin', 'Milk', 'Mint', 'Plum']) {
      expect(merged, `${odd} 词表不认，不许自动并`).not.toContain(`TwinkleSpica_${odd}_v1.1.zip`)
    }
  })
})
