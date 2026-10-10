import { describe, it, expect, beforeAll } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import type { FileEntry, IngestResult, CategoryConfig } from '../../src/shared/types'
import { classify } from '../../src/main/classify/engine'
import { isBasketOnlyName } from '../../src/main/classify/bundle'
import { containerInfoOf } from '../../src/main/ingest/container'
import { tagsWithAltName } from '../../src/shared/naming'
import { loadLexicon, type Lexicon } from '../../src/main/classify/lexicon'

/**
 * 第 10 轮 C + D（他 2026-10-10 下午批的 Q2 甲 / Q4 甲）。
 *
 *  - **C**：目录名本身就是个"筐"（`道具22件`）时，不再做成一张合集卡，里面各件自成一张卡。
 *  - **D**：他拖进来的那个名字不许被包内主体名顶掉（`修女` 不该变成 `Holy Spice Kaguya`）。
 *
 * 他批 Q2 的时候**同时给了一条反向硬约束**，这里当成正向对照写着：
 * 「像衣服这种素材，只要是同一件衣服、有很多其他素体的适配，那就必须得合并成一个合集」——
 * 那条走 `groupKey`（`containerKind='merged'`），和"名字是不是筐"是两条路，
 * 所以本文件最后一组用例专门验"两条路不打架"。
 */
const ROOT = path.resolve(__dirname, '../..')

function read(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8')
}

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
    assetId: '01R10',
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

/** 真库形状：`道具22件/` 下面 22 个 Booth 商品目录，每个自己的包 */
function basketFixture(n = 6): IngestResult {
  const entries: string[] = []
  for (let i = 0; i < n; i++) {
    const id = 4533350 + i
    entries.push(`${id}道具${i}/main${i}.unitypackage`)
    entries.push(`${id}道具${i}/preview.png`)
  }
  return mk('道具22件', [], entries)
}

describe('C · 筐不该成为一张卡（isBasketOnlyName）', () => {
  it('判据本身：计数词是筐，写着"合集"的不是', () => {
    for (const n of ['道具22件', 'ERP用12件', 'プラグイン17件', '更新', '重要！', '插件28件']) {
      expect(isBasketOnlyName(n), `${n} 应该是筐`).toBe(true)
    }
    /** 卖家打包卖的那种是**一件商品**，02 号 §验收 5 那条没被推翻 */
    for (const n of ['插件道具合集-初音的VRC小店', '○○セット', 'まとめ売り', 'Big Pack of Avatars']) {
      expect(isBasketOnlyName(n), `${n} 不该被当筐摊掉`).toBe(false)
    }
    /**
     * 同时命中两条名字的：`插件道具合集22件` 里 CONTAINER_RE 吃到 `…22件`、
     * BUNDLE_NAME_RE 吃到 `合集` —— **后者的否决权**就是这条，去掉 `!BUNDLE_NAME_RE` 那半边判据它就活了。
     */
    for (const n of ['插件道具合集22件', 'まとめ3点', 'アバターセット10個']) {
      expect(isBasketOnlyName(n), `${n} 是卖家合集，不是筐`).toBe(false)
    }
    for (const n of ['', null, undefined, '修女', 'Libero']) expect(isBasketOnlyName(n)).toBe(false)
  })

  it('⭐ 拖一个筐进来 → 里面每件各自成单元，不产合集卡', () => {
    const r = classify(basketFixture(6), deps())
    expect(r.units.length, '6 件商品就该出 6 个单元').toBe(6)
    expect(r.tree, '不许再产出合集树').toBeFalsy()
    expect(r.bundle, '不许产出合集自己那一行').toBeFalsy()
    for (const u of r.units) {
      expect(u.bundleRef, '摊出来的单元不许挂着 bundleRef').toBeNull()
      expect(u.name).not.toBe('道具22件')
      /** ⭐ 每件都得带着"我在父目录的哪一层"，登记那一步要靠它算源路径（不带 = 22 件全记到筐那一层） */
      expect(u.sourceRelPath, `${u.name} 没有 sourceRelPath`).toBeTruthy()
    }
    /** 名字穿透了 ID 目录：`4533350道具0/main0.unitypackage` → 主体名，不是纯数字 */
    expect(r.units.some((u) => /^\d{5,}$/.test(u.name)), `名字里有纯数字 id：${r.units.map((u) => u.name).join(',')}`).toBe(false)
  })

  it('⭐ 名字写着"合集"的仍然是一张卡（这条不许被 C 顺带改坏）', () => {
    const r = classify(
      mk('插件道具合集-初音的VRC小店', [], [
        'GoLoco.v.1.8.6u/GoLoco.v.1.8.6u.unitypackage',
        'SPS_V2.7.4.zip',
        '佳兔工具箱v2.7.0版本.unitypackage'
      ]),
      deps()
    )
    expect(r.units.length).toBe(1)
    expect(r.tree, '合集树必须还在').toBeTruthy()
    expect(r.tree?.containerKind).toBe('collection')
  })

  it('⭐ 名字里同时写着"合集"和计数词 → 仍是卖家的合集，不摊平', () => {
    /** 走的是整条主路径：判据一旦丢了 `!BUNDLE_NAME_RE` 那半边，这张卡就会被摊成几项 */
    const r = classify(
      mk('插件道具合集22件', [], ['GoLoco.v.1.8.6u/GoLoco.v.1.8.6u.unitypackage', 'SPS_V2.7.4.zip', '小刀/blade.prefab']),
      deps()
    )
    expect(r.units.length, '应当只有合集自己那一行').toBe(1)
    expect(r.tree, '合集树必须还在').toBeTruthy()
  })

  it('筐里只有一件东西时不硬摊（一件商品 + 一张图，别摊成两张卡）', () => {
    const r = classify(mk('道具1件', [], ['a/main.unitypackage', 'a/preview.png']), deps())
    expect(r.units.length).toBe(1)
  })
})

describe('D · 他拖进来的名字不许被包内主体名顶掉（containerInfoOf）', () => {
  /** `修女/` 里躺着 5 个 Holy Spice 包 —— 真库实测那张卡被叫成了 `Holy Spice Kaguya` */
  const NUN = { looseFiles: [{ relPath: '修女/Holy Spice Kaguya.unitypackage', size: 9000, ext: 'unitypackage', isDir: false }], entries: [] }

  it('⭐ 目录名有信息量 → 主名就是它，包内名降级成 altName', () => {
    const info = containerInfoOf(NUN as never, [], '修女')
    expect(info.name).toBe('修女')
    expect(info.altName, '被压下去的那个名字不许丢，调用方要拿它进 tags').toBe('Holy Spice Kaguya')
  })

  it('Booth id + 中文品名（`4533350巧克力`）也算有信息量', () => {
    const info = containerInfoOf(
      { looseFiles: [{ relPath: 'Valentines Choco.unitypackage', size: 9000, ext: 'unitypackage', isDir: false }], entries: [] },
      [],
      '4533350巧克力'
    )
    expect(info.name).toBe('4533350巧克力')
    expect(info.altName).toBe('Valentines Choco')
  })

  it('⭐ 反过来：磁盘名是垃圾时仍然用包内主体名（§A3 当初治的病不许放回来）', () => {
    for (const garbage of ['6447797.rar', 'd6b99874-1f2a-4b3c-8d9e-0f1a2b3c4d5e', '4533350', 'image0.jpg', 'ab']) {
      const info = containerInfoOf(
        { looseFiles: [{ relPath: 'Noir Luxe Airi.unitypackage', size: 9000, ext: 'unitypackage', isDir: false }], entries: [] },
        [],
        garbage
      )
      expect(info.name, `${garbage} 不该当主名`).toBe('Noir Luxe Airi')
    }
  })

  it('altName 和 name 不许相同（相同就是往 tags 里塞一个重复词）', () => {
    const info = containerInfoOf(
      { looseFiles: [{ relPath: '修女.unitypackage', size: 9000, ext: 'unitypackage', isDir: false }], entries: [] },
      [],
      '修女'
    )
    expect(info.name).toBe('修女')
    expect(info.altName).toBeNull()
  })

  it('不传 droppedName 时行为和以前一样（老调用点不许被改坏）', () => {
    const info = containerInfoOf(NUN as never, ['兜底名'], null)
    expect(info.name).toBe('Holy Spice Kaguya')
    expect(info.altName).toBeNull()
  })
})

describe('D 的后半程：被压下去的那个名字真的进了 tags', () => {
  /**
   * `containerInfoOf` 算出 `altName` 只是前半程。后半程在 `ingest/api.ts`，
   * 而那里原来是一段写在对象字面量里的三元 —— **没有任何用例看着它**，
   * 正是本仓库反复栽过的那类"判据实现了、调用点没接"。
   * 所以判据抽成 `shared/naming.ts` 的 `tagsWithAltName`（下面能测），调用点用源码形状钉住。
   */
  it('主名让位之后，包内名照样进 tags（以后按 `Holy Spice Kaguya` 还搜得到这张「修女」）', () => {
    expect(tagsWithAltName(['裙子'], 'Holy Spice Kaguya')).toEqual(['裙子', 'Holy Spice Kaguya'])
    /** 已经在里面就别重复塞一个 */
    expect(tagsWithAltName(['Holy Spice Kaguya'], 'Holy Spice Kaguya')).toEqual(['Holy Spice Kaguya'])
    /** 前后空白不算新名字 */
    expect(tagsWithAltName(['x'], '   ')).toEqual(['x'])
    expect(tagsWithAltName([], null)).toEqual([])
    expect(tagsWithAltName(undefined, 'y')).toEqual(['y'])
  })

  it('不许改动调用方传进来的那个数组（`model?.tags` 别处还在用同一份引用）', () => {
    const src = ['a']
    const out = tagsWithAltName(src, 'b')
    expect(out).toEqual(['a', 'b'])
    expect(src, '返回的是原引用 = 调用方那边也被塞了一个标签').toEqual(['a'])
    expect(out).not.toBe(src)
    /**
     * 每一条**返回路径**都得是新数组，不只"追加那一条"。
     * 原来只有追加那条被测到，于是 `const base = tags ?? []`（省掉拷贝）这种写法能活下来 ——
     * 调用方后面 `push` 一下就改到了别人的 tags。变异回扫 D7 逼出来的。
     */
    expect(tagsWithAltName(src, null)).not.toBe(src)
    expect(tagsWithAltName(src, 'a')).not.toBe(src)
    expect(tagsWithAltName(src, '  ')).not.toBe(src)
    expect(tagsWithAltName(src, undefined), 'null/undefined 也不能把原引用递回去').not.toBe(src)
  })

  it('⭐ 摄取那条路真的调了它（只在 shared 里写函数、没人接 = 界面照旧搜不到）', () => {
    const api = read('src/main/ingest/api.ts')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split(/\r?\n/)
      .filter((l) => !/^\s*\/\//.test(l))
      .join('\n')
    expect(api).toContain('tags: tagsWithAltName(model?.tags, container?.altName)')
    expect(api, '老的那句里程碑话术不许回来（reason 是会显示在详情面板里的）').not.toMatch(/'M\d/)
  })
})

describe('C 的后半程：登记那一步真的逐件走（活体抓出来的那条断链）', () => {
  const api = read('src/main/ingest/api.ts')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split(/\r?\n/)
    .filter((l) => !/^\s*\/\//.test(l))
    .join('\n')

  it('⭐ commit() 里有一条"多单元逐个登记"的分支，而不是只读 units[0]', () => {
    expect(api).toContain('isFlattenedBasket(flatUnits, !!tree)')
    expect(api).toContain('for (const u of flatUnits)')
    expect(api).toContain('createdIds.push(one.assetId)')
    /** 收尾必须把**全部**新建 id 交给 finishCommit：只交主 id 的话其余那些件不进检索索引 */
    expect(api).toContain('finishCommit(job, primaryId, createdIds, batchId, batch)')
  })

  it('逐件登记一律索引、不搬盘（一个筐里 22 个子目录各搬各的家，中途出错就是半个库散在两地）', () => {
    expect(api).toContain("storageMode: 'indexed'")
    /** 每件自己的源路径来自 shared 那条判据，不在主进程里另写一遍路径算术 */
    expect(api).toContain('unitSourcePath(job.item.sourcePath, u)')
  })

  it('⭐ 筐那一层的名字不许盖到每一件上（container 传 null、name 不许沿用）', () => {
    const at = api.indexOf('for (const u of flatUnits)')
    expect(at).toBeGreaterThan(-1)
    const seg = api.slice(at, at + 1200)
    expect(seg).toContain('name: undefined')
    /** unitFromModel 最后一项是 container —— 这里必须传 null（不传就是整个筐那份清单） */
    expect(seg, 'container 那一项没传 null').toMatch(/unitFromModel\([\s\S]*?,\s*batch,\s*null\s*\)/)
  })

  it('用户没主动改分类时不许把第一件的分类盖给其余那些件', () => {
    expect(api).toContain('input.category !== flatUnits[0].category ? input.category : undefined')
  })
})

describe('C 与 D 不打架（他批 Q2 时那条反向硬约束）', () => {
  it('⭐ 同一件衣服的 20 个素体适配：目录名不是筐 → 照旧并成一张卡', () => {
    const entries: string[] = []
    for (const m of ['Selestia', 'Airi', 'Milltina', 'Shinra', 'Shinano', 'Manuka', 'Sio', 'Moe', 'Ichigo', 'Ramune']) {
      entries.push(`Libero[${m}_ATTITUDE The Royal Bunny]_1.0${m.length % 5}.unitypackage`)
    }
    const r = classify(mk('名流', ['衣服'], entries), deps())
    expect(r.units.length, '10 个变体必须并成一张卡').toBe(1)
    expect(r.tree?.containerKind, '这是归并型容器，不是合集型').toBe('merged')
  })

  it('⭐ 同样 10 个变体，但目录名叫 `衣服10件`（筐名）、每个变体一个子目录 → 还是并成一张卡', () => {
    /**
     * 这条是他那句话的直接对照：筐名只决定"要不要往下摊一层"，
     * 摊出来的那 10 个候选 groupKey 相同 → `mergeVersions` 把它们并成一项 →
     * 单元数 = 1，**不会因为名字像筐就散成 10 张卡**。
     *
     * ⚠ 子目录名要带着产品名（`Libero[Selestia_...]`）—— 真库里"一件一个文件夹"就是这个形状。
     * 第一版我拿 `Selestia/main.unitypackage` 当夹具，候选名成了光杆的 `Selestia`，
     * 十个键各不相同 → 10 项。那是**夹具不真实**，不是判据错（真库没人把变体目录只按模型名命名）。
     */
    const entries: string[] = []
    for (const m of ['Selestia', 'Airi', 'Milltina', 'Shinra', 'Shinano', 'Manuka', 'Sio', 'Moe', 'Ichigo', 'Ramune']) {
      const dir = `Libero[${m}_ATTITUDE The Royal Bunny]_1.0${m.length % 5}`
      entries.push(`${dir}/main.unitypackage`)
    }
    const r = classify(mk('衣服10件', [], entries), deps())
    expect(r.units.length).toBe(1)
  })
})
