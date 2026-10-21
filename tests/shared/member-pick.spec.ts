import { describe, it, expect } from 'vitest'
import {
  batchesOf,
  capNoteKeys,
  cardImportChoice,
  collectionTokens,
  outcomeCounts,
  planSummary,
  preselectMembers,
  projectFingerprintTokens,
  totalBytesOf,
  underSize
} from '../../src/shared/memberPick'
import type { ContainerNotes, FoundPackage, PlanView } from '../../src/shared/types'

/**
 * 成员选择的预勾 / 分批逻辑（M5-B ⑥）。
 *
 * 这一层为什么值得单独测：本仓库的渲染层**没有 DOM 测试环境**
 * （vitest 配的是 `environment:'node'`，没装 jsdom），所以"哪些被默认勾上、
 * 一批几个、撞上限说什么"这些**替用户做决定**的判断必须是纯函数才有测试可做。
 * 写进 JSX 里就等于没测。
 *
 * 名字匹配的数据用的是真库实际形状：
 * `插件道具合集-初音的VRC小店` 里 87 个成员、最深 7 段、一个目录里挤 17 个。
 */

const pkg = (relPath: string, sizeBytes = 1000): FoundPackage => ({
  path: null,
  relPath,
  sizeBytes,
  origin: { containerAssetId: 'CARD', originArchive: 'E:\\x.zip', memberRelPath: relPath }
})

function notes(over: Partial<ContainerNotes> = {}): ContainerNotes {
  return {
    cappedDepth: 0,
    cappedCount: 0,
    blocked: [],
    needsPassword: false,
    scannedEntries: 10,
    backend: 'yauzl',
    ...over
  }
}

describe('工程名 → 指纹词', () => {
  it('shinano-Main2 只留 shinano（Main2 每个工程都有，用它当词等于全选）', () => {
    expect(projectFingerprintTokens('shinano-Main2')).toEqual(['shinano'])
    expect(projectFingerprintTokens('Milfy-Main')).toEqual(['milfy'])
    expect(projectFingerprintTokens('Grimoire-Pro')).toEqual(['grimoire'])
  })

  it('空 / 纯数字 / 太短的名字给不出词，而不是给个错词', () => {
    expect(projectFingerprintTokens(null)).toEqual([])
    expect(projectFingerprintTokens('')).toEqual([])
    expect(projectFingerprintTokens('2022')).toEqual([])
    expect(projectFingerprintTokens('A-B')).toEqual([])
  })

  it('尾部的数字版本号剥掉，但**词尾不许乱剥**（Orion 剥成 or 就永远预勾不上）', () => {
    expect(projectFingerprintTokens('Orion2')).toEqual(['orion2'].map(() => 'orion'))
    expect(projectFingerprintTokens('Shinano2-Main')).toEqual(['shinano'])
    /** 'orion' 被剥成 'or' 的那种写法：整批信号直接消失，测试专门盯它 */
    expect(projectFingerprintTokens('Orion')).toEqual(['orion'])
    expect(projectFingerprintTokens('Fusion')).toEqual(['fusion'])
  })

  it('多个片段都留下，顺序稳定（界面按这个顺序显示依据）', () => {
    expect(projectFingerprintTokens('shinano yuki main2')).toEqual(['shinano', 'yuki'])
  })
})

describe('集合关键词 → 词', () => {
  it('规则关键词与集合名都算，重复的只留一份', () => {
    expect(collectionTokens('衣服', ['shinano', 'SHINANO', ''])).toEqual(['shinano', '衣服'])
  })

  it('单个字母不算词（一个 a 会命中一切）', () => {
    expect(collectionTokens(null, ['a', 'b'])).toEqual([])
  })
})

describe('名字匹配：只认完整词段', () => {
  const members = [
    { relPath: '商品/Shinano_Yuki_Morph.unitypackage' },
    { relPath: 'Avatar Pack.unitypackage' },
    { relPath: '雾雨改.unitypackage' },
    { relPath: 'shinano2.unitypackage' },
    { relPath: 'Package_List.unitypackage' },
    { relPath: 'Grimoire_Final.unitypackage' }
  ]
  const hit = (token: string): string[] =>
    Object.keys(preselectMembers(members, [{ token, reasonKey: 'pickByProject' }], { maxShare: 0.9 }).reasons)

  it('下划线、空格、点都是段边界', () => {
    expect(hit('shinano')).toEqual(['商品/Shinano_Yuki_Morph.unitypackage', 'shinano2.unitypackage'])
    expect(hit('yuki')).toEqual(['商品/Shinano_Yuki_Morph.unitypackage'])
    expect(hit('avatar')).toEqual(['Avatar Pack.unitypackage'])
  })

  it('整段相等才算命中：av 不许咬 avatar，pack 不许咬 package', () => {
    expect(hit('av')).toEqual([])
    expect(hit('ack')).toEqual([])
    expect(hit('packa')).toEqual([])
    /** 'pack' 是 "Avatar Pack" 的一个完整词段 → 该命中；但 "Package_List" 的段是 'package' → 不该中 */
    expect(hit('pack')).toEqual(['Avatar Pack.unitypackage'])
  })

  it('尾巴上只跟数字才算同一个东西（shinano2 是 shinano 的改版，shinanoyuki 不是）', () => {
    expect(hit('shinano')).toContain('shinano2.unitypackage')
    expect(preselectMembers([{ relPath: 'shinanoyuki.unitypackage' }], [{ token: 'shinano', reasonKey: 'pickByProject' }], { maxShare: 0.9 }).reasons).toEqual({})
  })

  it('中文段没法切词，包含就算', () => {
    expect(hit('雾雨')).toEqual(['雾雨改.unitypackage'])
  })

  it('目录前缀不参与匹配（只看文件名，否则"路径里有个 s"也算命中）', () => {
    expect(hit('商品')).toEqual([])
  })

  it('命中了就要说得出是哪个词（界面上那行"因为 shinano 才勾上"）', () => {
    const r = preselectMembers(members, [{ token: 'shinano', reasonKey: 'pickByProject' }], { maxShare: 0.9 })
    expect(r.reasons['shinano2.unitypackage']).toEqual({ reasonKey: 'pickByProject', matched: 'shinano' })
  })
})

describe('预勾的"不许替他灌"闸门', () => {
  it('命中数超过一批上限 → **一个都不勾**，并说为什么', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ relPath: `shinano_${i}.unitypackage` }))
    const r = preselectMembers(many, [{ token: 'shinano', reasonKey: 'pickByProject' }], { batchMax: 8 })
    expect(r.reasons).toEqual({})
    expect(r.tooBroad).toEqual({ matched: 'shinano', hits: 20, total: 20 })
  })

  it('命中过半 → 一个都不勾（工程名叫 vrc 时，87 个包个个带 vrc 就是这一种）', () => {
    const ten = Array.from({ length: 10 }, (_, i) => ({ relPath: i < 6 ? `vrc_${i}.unitypackage` : `other${i}.unitypackage` }))
    const r = preselectMembers(ten, [{ token: 'vrc', reasonKey: 'pickByProject' }])
    expect(r.reasons).toEqual({})
    expect(r.tooBroad?.hits).toBe(6)
  })

  it('一个都没命中 → 谁都不勾，但这不算"太宽"（两种原因在界面上说的话不一样）', () => {
    const r = preselectMembers([{ relPath: 'A.unitypackage' }], [{ token: 'zzz', reasonKey: 'pickByProject' }])
    expect(r.reasons).toEqual({})
    expect(r.tooBroad).toBe(null)
  })

  it('小规模、有区分度的命中才真勾上', () => {
    const members = [
      { relPath: 'shinano_a.unitypackage' },
      { relPath: 'shinano_b.unitypackage' },
      { relPath: 'grimoire_c.unitypackage' },
      { relPath: 'grimoire_d.unitypackage' },
      { relPath: 'other_e.unitypackage' },
      { relPath: 'other_f.unitypackage' }
    ]
    const r = preselectMembers(members, [{ token: 'shinano', reasonKey: 'pickByProject' }])
    expect(Object.keys(r.reasons)).toEqual(['shinano_a.unitypackage', 'shinano_b.unitypackage'])
    expect(r.tooBroad).toBe(null)
  })

  it('工程词与集合词同时在场时，工程词优先（依据只显示第一个命中的）', () => {
    const r = preselectMembers(
      [{ relPath: 'Shinano_Morph.unitypackage' }],
      [
        { token: '衣服', reasonKey: 'pickByCollection' },
        { token: 'shinano', reasonKey: 'pickByProject' }
      ]
    )
    expect(r.reasons['Shinano_Morph.unitypackage'].reasonKey).toBe('pickByProject')
  })
})

describe('分批', () => {
  it('8 个一批，剩下的进下一批', () => {
    const ten = Array.from({ length: 10 }, (_, i) => `m${i}`)
    expect(batchesOf(ten, 8).map((b) => b.length)).toEqual([8, 2])
  })

  it('顺序保持用户勾选的顺序，不重排', () => {
    expect(batchesOf(['c', 'a', 'b'], 2)).toEqual([['c', 'a'], ['b']])
  })

  it('max 给 0 或负数也不许死循环（当成 1）', () => {
    expect(batchesOf(['x', 'y'], 0)).toEqual([['x'], ['y']])
  })

  it('空选择 → 零批', () => {
    expect(batchesOf([], 8)).toEqual([])
  })
})

describe('快捷勾选与体积', () => {
  it('[只勾 < N 的] 按主进程给的字节数算，并且跳过"不知道多大"的那些', () => {
    const list = [pkg('a.unitypackage', 50 * 1024 * 1024), pkg('b.unitypackage', 500 * 1024 * 1024), pkg('c.unitypackage', 0)]
    expect(underSize(list, 100 * 1024 * 1024)).toEqual(['a.unitypackage'])
  })

  it('合计体积把"读不出大小"的单独报出来，不许糊成 0 B', () => {
    const t = totalBytesOf([pkg('a', 100), pkg('b', 0), pkg('c', 0)])
    expect(t).toEqual({ bytes: 100, unknown: 2 })
  })
})

describe('清单没列全的那几句实话', () => {
  it('每种撞线各一个 key，且都出现时按严重程度排（要密码第一）', () => {
    const k = capNoteKeys(
      notes({ needsPassword: true, cappedCount: 3, cappedDepth: 2, blocked: [{ relPath: 'x.zip', key: 'nestedArchive', detail: null }] })
    )
    expect(k).toEqual(['library.noteNeedsPassword', 'library.noteCappedCount', 'library.noteCappedDepth', 'library.noteNestedArchive'])
  })

  it('什么都没撞 → 一句都不说（不能凭空造"已列全"的承诺）', () => {
    expect(capNoteKeys(notes())).toEqual([])
    expect(capNoteKeys(null)).toEqual([])
  })

  it('只有 listFailed 时也要说出来（列不出来 ≠ 里面没包）', () => {
    expect(capNoteKeys(notes({ blocked: [{ relPath: 'a.rar', key: 'listFailed', detail: 'x' }] }))).toEqual([
      'library.noteListFailed'
    ])
  })
})

describe('汇总卡片那几行数', () => {
  const plan: PlanView = {
    ok: true,
    batchId: 'B1',
    items: [
      {
        relPath: 'a',
        sizeBytes: 1,
        originArchive: 'z',
        extracted: true,
        entryCount: 10,
        fresh: 7,
        conflictCount: 3,
        conflicts: []
      },
      {
        relPath: 'b',
        sizeBytes: 1,
        originArchive: 'z',
        extracted: true,
        entryCount: 5,
        fresh: 5,
        conflictCount: 0,
        conflicts: []
      }
    ],
    blocked: [],
    totalBytes: 2,
    freeBytes: 99,
    conflictPackages: 1,
    conflictEntries: 3,
    batchMax: 8
  }

  it('几个包 / 几个有冲突 / 几个文件会被覆盖 / 全新几个 —— 四个数各管各的', () => {
    expect(planSummary(plan)).toEqual({ packages: 2, withConflicts: 1, conflictEntries: 3, fresh: 12 })
  })

  it('结果那行必须分出"没执行"，不能把它并进"失败"（§7-R2）', () => {
    expect(outcomeCounts({ imported: 4, failed: 1, notRun: 3, blocked: [], cleanupFailed: 0 })).toBe('ok:4 bad:1 skip:3')
    expect(outcomeCounts({ imported: 0, failed: 0, notRun: 0, blocked: [1, 2], cleanupFailed: 3 })).toBe(
      'ok:0 bad:0 skip:0 blocked:2 dirty:3'
    )
  })
})

describe('cardImportChoice（一张卡能不能直接导，R4 ②）', () => {
  const pkg = (path: string | null) => ({ path, relPath: 'x', sizeBytes: 1, origin: { containerAssetId: 'C', originArchive: null, memberRelPath: null } })

  it('一张卡都没有 → empty（界面要说"没有可导入的包"，不是"失败了"）', () => {
    expect(cardImportChoice([]).kind).toBe('empty')
  })

  it('磁盘上就有一个 .unitypackage → 直接导，点名它', () => {
    const r = cardImportChoice([pkg('E:\lib\a.unitypackage')])
    expect(r.kind).toBe('single')
    expect(r.indexes).toEqual([0])
  })

  it('容器里只有一个成员 → 也算直接导（没有"选哪个"这回事）', () => {
    const r = cardImportChoice([pkg(null)])
    expect(r.kind).toBe('single')
    expect(r.indexes).toEqual([0])
  })

  it('好几个成员要抽 → needs-choice，**一个都不替他挑**', () => {
    const r = cardImportChoice([pkg(null), pkg(null), pkg(null)])
    expect(r.kind).toBe('needs-choice')
    expect(r.indexes).toEqual([])
  })

  it('磁盘上就摆着多个包 → 也是 needs-choice（按钮移除后不许静默只导第一个）', () => {
    const r = cardImportChoice([pkg('E:\\lib\\a.unitypackage'), pkg('E:\\lib\\b.unitypackage')])
    expect(r.kind).toBe('needs-choice')
    expect(r.indexes).toEqual([])
  })

  it('单卡与多选批量用的是同一条判据（这条断言挡的是"两边各写一遍然后漂掉"）', async () => {
    const fs = await import('node:fs')
    const store = fs.readFileSync('src/renderer/stores/ui.ts', 'utf8')
    /** importAsset 与 importSelected 两条路都得走这个函数，不许有一边自己判 length>1 */
    const inline = (store.match(/packages\.some\(\(p\) => p\.path === null\)/g) || []).length
    expect(inline, '单卡那条路已经改用 cardImportChoice 了才允许这里是 0').toBe(0)
    expect(store).toContain('cardImportChoice(found.packages)')
  })
})
