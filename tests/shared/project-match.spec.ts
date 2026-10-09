import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fold, searchForms } from '../../src/shared/normalize'
import type { CollectionRule } from '../../src/shared/types'
import {
  fingerprintTokens,
  matchProject,
  namesOf,
  normalizeForMatch,
  tokensOf,
  usableToken,
  type MatchableCollection,
  type ProjectFingerprint
} from '../../src/shared/projectMatch'

/**
 * M6 ① · 工程 ↔ 集合匹配（纯函数）。
 *
 * 每条用例都对着 2026-10-06 那六条裁定里的 Q1 写：**平手不切、而且必须留痕**。
 * 另外钉住两条"看起来有、其实没接上"的老毛病：`fold()` 被改回私有、
 * `CollectionRule` 又被人复制一份到 main 层。
 */

const ROOT = path.resolve(__dirname, '../..')
const fp = (over: Partial<ProjectFingerprint> = {}): ProjectFingerprint => ({
  dirName: '',
  topFolders: [],
  installedPackages: [],
  avatarDescriptors: [],
  ...over
})
const col = (
  id: string,
  name: string,
  rule: CollectionRule,
  priority?: number
): MatchableCollection => ({ id, name, rule, priority })

describe('归一化必须复用同一个 fold', () => {
  it('fold 是导出的（M6 要用它；被改回私有这条直接红）', () => {
    expect(typeof fold).toBe('function')
    /** 全角 → 半角、音标剥掉，和 M4 修完的口径一致 */
    expect(fold('ＡＢＣ')).toBe('ABC')
    expect(fold('é')).toBe('e')
    /** NFKD 拆浊音那个坑：バ 必须还是 バ，不能变成"ハ + U+3099" */
    expect(fold('バ')).toBe('バ')
    expect(fold('バ')).not.toContain('\u3099')
  })

  it('normalize.ts 里 fold 的声明带 export（读源码钉接线，行为测试挡不住"只给内部用"）', () => {
    const src = fs.readFileSync(path.join(ROOT, 'src/shared/normalize.ts'), 'utf8')
    expect(src).toMatch(/export function fold\s*\(/)
  })

  it('匹配用的 token 与 searchForms 同源：しなの / 信奈 / SHINANO 都归一到 shinano 一支', () => {
    expect(tokensOf('しなの')).toContain('shinano')
    expect(tokensOf('信奈')).toEqual(expect.arrayContaining(['xin', 'nai', 'xinnai']))
    expect(tokensOf('SHINANO')).toContain('shinano')
    expect(normalizeForMatch('Ｓｈｉｎａｎｏ')).toBe('shinano')
  })

  it('CollectionRule 的定义只在 shared/types.ts 一份（不许再复制回 main）', () => {
    const meta = fs.readFileSync(path.join(ROOT, 'src/main/db/repos/meta.ts'), 'utf8')
    expect(meta).not.toMatch(/export interface CollectionRule/)
    expect(meta).toMatch(/import type \{[^}]*CollectionRule[^}]*\} from '.*shared\/types'/)
  })
})

describe('token 资格（短词/数字不许当匹配依据）', () => {
  it('ASCII 短于 3 不参与、CJK 短于 2 不参与、纯数字不参与', () => {
    expect(usableToken('av')).toBe(false)
    expect(usableToken('信')).toBe(false)
    expect(usableToken('信奈')).toBe(true)
    expect(usableToken('shinano')).toBe(true)
    expect(usableToken('2022')).toBe(false)
    expect(usableToken('v1')).toBe(false)
  })

  it('关键词 av 不许咬住 avatar（子串匹配的后果 M5-B 实测过）', () => {
    const r = matchProject(fp({ dirName: 'avatar-Editor' }), [col('c1', 'Av', { keywords: ['av'] })])
    expect(r.kind).toBe('none')
    if (r.kind === 'none') {
      expect(r.dropped).toEqual([{ collectionId: 'c1', keyword: 'av', why: 'tooShort' }])
    }
  })
})

describe('首帧与四段指纹', () => {
  it('只有目录名也能命中（§4.3 步骤 1「首帧先用项目名匹配」）', () => {
    const r = matchProject(fp({ dirName: 'shinano-Main2' }), [col('c1', 'Shinano', { keywords: ['shinano'] })])
    expect(r.kind).toBe('hit')
    if (r.kind === 'hit') expect(r.evidence.collectionId).toBe('c1')
  })

  it('topFolders / installedPackages / avatarDescriptors 三段都参与', () => {
    const cols = [
      col('folder', 'Folder 集合', { keywords: ['gimikku'] }),
      col('pkg', '包集合', { keywords: ['liltoon'] }),
      col('desc', '模型集合', { keywords: ['shinanoworkshop'] })
    ]
    /** 假名段过 wanakana：ギミック → gimikku（长音写法还会给一份 gimiku） */
    const one = matchProject(fp({ dirName: 'x', topFolders: ['Kiss音ギミック'] }), cols, {})
    expect(one.kind === 'hit' && one.evidence.collectionId).toBe('folder')
    const two = matchProject(fp({ dirName: 'x', installedPackages: ['jp.lilxyzw.liltoon'] }), cols)
    expect(two.kind === 'hit' && two.evidence.collectionId).toBe('pkg')
    const three = matchProject(fp({ dirName: 'x', avatarDescriptors: ['Assets/ShinaNoWorkshop/a.prefab'] }), cols)
    expect(three.kind === 'hit' && three.evidence.collectionId).toBe('desc')
  })

  it('指纹彻底是空的 → none，不许瞎猜一个集合', () => {
    const r = matchProject(fp({}), [col('c1', 'Shinano', { keywords: ['shinano'] })])
    expect(r.kind).toBe('none')
  })

  it('没有任何集合 → none（tried 记 0，给日志用）', () => {
    const r = matchProject(fp({ dirName: 'shinano-Main2' }), [])
    expect(r.kind).toBe('none')
    if (r.kind === 'none') expect(r.tried).toBe(0)
  })
})

describe('仲裁（Q1：平手不切，且必须留痕）', () => {
  it('priority 高的赢，另一个进不了候选', () => {
    const r = matchProject(fp({ dirName: 'shinano-Main2' }), [
      col('low', '泛用', { keywords: ['shinano'], priority: 1 }),
      col('high', '信奈', { keywords: ['shinano'], priority: 10 })
    ])
    expect(r.kind === 'hit' && r.evidence.collectionId).toBe('high')
  })

  it('priority 并列时，关键词更长（更具体）的赢', () => {
    const r = matchProject(fp({ dirName: 'shinano-Main2', topFolders: ['ShinanoWorkshop'] }), [
      col('short', '宽', { keywords: ['shinano'] }),
      col('long', '具体', { keywords: ['shinanoworkshop'] })
    ])
    expect(r.kind === 'hit' && r.evidence.collectionId).toBe('long')
  })

  it('完全平手 → ambiguous，两个候选都在（留痕），调用方拿不到可切的结论', () => {
    const r = matchProject(fp({ dirName: 'shinano-Main2' }), [
      col('a', 'Shinano A', { keywords: ['shinano'] }),
      col('b', 'Shinano B', { keywords: ['SHINANO'] })
    ])
    expect(r.kind).toBe('ambiguous')
    if (r.kind === 'ambiguous') {
      expect(r.evidence.map((e) => e.collectionId).sort()).toEqual(['a', 'b'])
      /** 名单要能直接进日志/横幅：「有 2 个集合同时命中（Shinano A、Shinano B），未自动切换」 */
      expect(namesOf(r.evidence)).toBe('Shinano A、Shinano B')
    }
  })

  it('同一条精确路径被写进两个集合 → 也判平手，不硬选', () => {
    const r = matchProject(
      fp({ dirName: 'shinano-Main2' }),
      [
        col('a', 'A', { projectPaths: ['E:/ALCOMprojects/shinano-Main2'] }),
        col('b', 'B', { projectPaths: ['E:\\ALCOMprojects\\shinano-Main2\\'] })
      ],
      { projectPath: 'E:\\ALCOMprojects\\shinano-Main2' }
    )
    expect(r.kind).toBe('ambiguous')
  })
})

describe('精确路径（"以后都这样"）', () => {
  it('路径命中优先于一切关键词，哪怕别的集合 priority 更高', () => {
    const r = matchProject(
      fp({ dirName: 'shinano-Main2' }),
      [
        col('pinned', '钉过的', { projectPaths: ['e:/alcomprojects/shinano-main2'] }),
        col('rich', '高优先', { keywords: ['shinano', 'main2'], priority: 999 })
      ],
      { projectPath: 'E:\\ALCOMprojects\\shinano-Main2' }
    )
    expect(r.kind === 'hit' && r.evidence.collectionId).toBe('pinned')
    if (r.kind === 'hit') expect(r.evidence.via).toBe('projectPath')
  })

  it('反斜杠 / 正斜杠 / 尾斜杠 / 大小写 都算同一个路径', () => {
    for (const written of [
      'E:\\ALCOMprojects\\shinano-Main2',
      'E:/ALCOMprojects/shinano-Main2/',
      'e:\\alcomprojects\\SHINANO-MAIN2'
    ]) {
      const r = matchProject(fp({ dirName: 'x' }), [col('c', 'C', { projectPaths: [written] })], {
        projectPath: 'E:/ALCOMprojects/shinano-Main2'
      })
      expect(r.kind, written).toBe('hit')
    }
  })

  it('不传 projectPath 时路径规则不参与（也不误命中）', () => {
    const r = matchProject(fp({ dirName: 'x' }), [col('c', 'C', { projectPaths: ['E:/a/b'] })])
    expect(r.kind).toBe('none')
  })
})

describe('通用词闸门（一个词命中**所有**已知工程 = 它什么都没说，不许据此切）', () => {
  const projects = [
    fp({ dirName: 'vrc-tools' }),
    fp({ dirName: 'vrc-avatar' }),
    fp({ dirName: 'vrc-world' })
  ]

  it('vrc 命中 3 个已知工程 → 判通用词，不切，并留痕为什么没切', () => {
    const r = matchProject(projects[0], [col('c1', 'VRC 相关', { keywords: ['vrc'] })], {
      knownProjects: projects
    })
    expect(r.kind).toBe('none')
    if (r.kind === 'none') expect(r.dropped).toEqual([{ collectionId: 'c1', keyword: 'vrc', why: 'generic' }])
  })

  it('同一个集合里还有别的非通用词时，照那个词切（闸门只掐共用词）', () => {
    const r = matchProject(projects[0], [col('c1', 'VRC 工具', { keywords: ['vrc', 'tools'] })], {
      knownProjects: projects
    })
    expect(r.kind === 'hit' && r.evidence.keyword).toBe('tools')
  })

  it('没给 knownProjects 时闸门不开（口径要写清：调用方负责传全量）', () => {
    const r = matchProject(projects[0], [col('c1', 'VRC 相关', { keywords: ['vrc'] })])
    expect(r.kind).toBe('hit')
  })

  it('**命中多数但不是全部工程照样能切**（§8-9 那条验收靠这个）', () => {
    /**
     * 沙盒活体上改的判据：他机器上 9 个工程有 7 个名字带 shinano，
     * 老规则"≥3 个就判通用词"会把 Shinano 集合整个废掉 ——
     * 多个工程指向同一个分区本来就是自动切换的目的，不是它的反例。
     */
    const many = [
      fp({ dirName: 'shinano-Main2' }),
      fp({ dirName: 'shinano-Loli' }),
      fp({ dirName: 'shinano-basics' }),
      fp({ dirName: 'milfy-Main' }),
      fp({ dirName: 'manuka-World' })
    ]
    const r = matchProject(many[0], [col('c1', 'Shinano', { keywords: ['shinano'] })], { knownProjects: many })
    expect(r.kind).toBe('hit')
    if (r.kind === 'hit') expect(r.evidence.keyword).toBe('shinano')
  })

  it('一个词命中**全部**已知工程才算"什么都没说"（unity 这种）', () => {
    const allUnity = [fp({ dirName: 'a-unity' }), fp({ dirName: 'b-unity' }), fp({ dirName: 'c-unity' })]
    const r = matchProject(allUnity[0], [col('c1', 'Unity 通用', { keywords: ['unity'] })], { knownProjects: allUnity })
    expect(r.kind).toBe('none')
    if (r.kind === 'none') expect(r.dropped[0]).toMatchObject({ keyword: 'unity', why: 'generic' })
  })

  it('已知工程太少（<3）时不开这道闸 —— 一个工程时"全都命中"没有意义', () => {
    const only = [fp({ dirName: 'shinano-Main2' })]
    const r = matchProject(only[0], [col('c1', 'Shinano', { keywords: ['shinano'] })], { knownProjects: only })
    expect(r.kind).toBe('hit')
  })
})

describe('matchMode', () => {
  it('all：每个关键词都得命中，缺一个就不作候选', () => {
    const cols = [col('c', 'C', { keywords: ['shinano', 'workshop'], matchMode: 'all' })]
    const miss = matchProject(fp({ dirName: 'shinano-Main2' }), cols)
    expect(miss.kind).toBe('none')
    const hit = matchProject(fp({ dirName: 'shinano-Main2', topFolders: ['Shinano Workshop'] }), cols)
    expect(hit.kind).toBe('hit')
  })

  it('any（默认）：命中一个就是候选', () => {
    const r = matchProject(fp({ dirName: 'shinano-Main2' }), [
      col('c', 'C', { keywords: ['milfy', 'shinano'], matchMode: 'any' })
    ])
    expect(r.kind === 'hit' && r.evidence.keyword).toBe('shinano')
  })

  it('规则里 keywords 为空 → 这条集合不参与关键词匹配', () => {
    const r = matchProject(fp({ dirName: 'shinano-Main2' }), [col('c', 'C', {})])
    expect(r.kind).toBe('none')
  })
})

describe('优先级取数口径', () => {
  it('同一个集合：rule.priority 覆盖 collection.priority 列（规则里写的才算它自己的）', () => {
    const r = matchProject(fp({ dirName: 'shinano-Main2' }), [
      col('a', 'A', { keywords: ['shinano'], priority: 50 }, 1)
    ])
    expect(r.kind === 'hit' && r.evidence.priority).toBe(50)
  })

  it('列里的值也算数（规则没写 priority 时不至于全 0 分）', () => {
    const r = matchProject(fp({ dirName: 'shinano-Main2' }), [col('b', 'B', { keywords: ['shinano'] }, 90)])
    expect(r.kind === 'hit' && r.evidence.priority).toBe(90)
  })

  it('跨集合比的是各自算出来的有效值：列 90 赢过规则 50', () => {
    const r = matchProject(fp({ dirName: 'shinano-Main2' }), [
      col('a', 'A', { keywords: ['shinano'], priority: 50 }, 1),
      col('b', 'B', { keywords: ['shinano'] }, 90)
    ])
    expect(r.kind === 'hit' && r.evidence.collectionId).toBe('b')
  })
})

describe('别把匹配结果当成"必然命中"来读', () => {
  it('hit 的证据里 hits>0，keyword 就是决定性的那一个', () => {
    const r = matchProject(fp({ dirName: 'shinano-Main2' }), [col('c', 'C', { keywords: ['shinano'] })])
    expect(r.kind).toBe('hit')
    if (r.kind === 'hit') {
      expect(r.evidence.hits).toBeGreaterThan(0)
      expect(r.evidence.keyword).toBe('shinano')
      expect(r.evidence.via).toBe('keyword')
    }
  })

  it('fingerprintTokens 去重且不含空格（同一工程重复目录名不放大命中数）', () => {
    const set = fingerprintTokens(fp({ dirName: 'Shinano Shinano', topFolders: ['shinano'] }))
    expect([...set].filter((t) => t === 'shinano')).toHaveLength(1)
    expect(searchForms('shinano').all.length).toBeGreaterThan(0)
  })
})
