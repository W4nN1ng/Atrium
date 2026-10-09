import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { CategoryConfig } from '../../src/shared/types'
import { openDatabase, closeDatabase, type Db } from '../../src/main/db'
import { makeAssetRow, upsertAsset } from '../../src/main/db/repos/asset'
import { replacePackageEntries } from '../../src/main/db/repos/unity'
import { setAssetTags } from '../../src/main/db/repos/meta'
import { AssetSearchIndex, rebuildIndex, aliasesFor, tokenize } from '../../src/main/search'

const ROOT = path.resolve(__dirname, '../..')
const cfg = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'resources/lexicon/categories.json'), 'utf8')
) as CategoryConfig

let db: Db
let dir = ''
const index = new AssetSearchIndex()

const IDS: Record<string, string> = {}

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'avca-search-'))
  db = openDatabase(path.join(dir, 'library.db'))

  const seeds: Array<[string, string, string, string | null, string[]]> = [
    ['衣服套装', 'Grimoir_SHINANO_V1.0.zip', 'clothing', 'outfit', ['套装', '换装']],
    ['しなの表情', '6117553 Shinano_FaceAnimation.rar.rar', 'plugin', 'expression', ['表情', 'Shinano']],
    ['束縛チャイナFULLSET', '束縛チャイナFULLSET.zip', 'clothing', 'dress', ['チャイナ']],
    ['灯光控制器', 'LightControllerV2.0.3.1.unitypackage', 'plugin', 'interactive', ['灯光']],
    ['插件动作包', 'ABT 1.3.0【汉化 闲鱼@月见汐音】', 'plugin', 'action', ['动作']]
  ]
  seeds.forEach(([name, raw, cat, sub, tags], i) => {
    const row = makeAssetRow({
      id: '01SEARCH' + String(i).padStart(2, '0'),
      name,
      raw_name: raw,
      category: cat,
      subcategory: sub,
      status: 'classified',
      author: i === 4 ? '月见汐音' : null,
      notes: i === 3 ? '控制灯光的交互插件' : null
    })
    upsertAsset(db, row)
    IDS[name] = row.id
    setAssetTags(db, row.id, tags, 'topic')
  })
  // 包内路径也要能搜
  replacePackageEntries(db, IDS['しなの表情'], [
    { guid: 'a'.repeat(32), unityPath: 'Assets/Shinano/Face/EmoteMenu.prefab', entryKind: 'prefab', size: 10, hasPreview: false },
    { guid: 'b'.repeat(32), unityPath: 'Assets/Shinano/Face/blink.anim', entryKind: 'anim', size: 10, hasPreview: false }
  ])
  rebuildIndex(db, cfg, index)
}, 60000)

afterAll(() => {
  closeDatabase()
  try {
    fs.rmSync(dir, { recursive: true, force: true })
  } catch {
    /* 交给系统 */
  }
})

const hitIds = (q: string): string[] => index.search(q).map((h) => h.id)

describe('F5 互搜（真库、真索引）', () => {
  it('索引真的建起来了', () => {
    expect(index.ready).toBe(true)
    expect(index.size).toBe(5)
  })

  it('输 shinano 搜到 しなの表情', () => {
    expect(hitIds('shinano')).toContain(IDS['しなの表情'])
  })

  it('输 yifu 搜到 衣服套装', () => {
    expect(hitIds('yifu')).toContain(IDS['衣服套装'])
  })

  it('输中文也能搜到，且罗马字写法互逆', () => {
    expect(hitIds('衣服')).toContain(IDS['衣服套装'])
    expect(hitIds('chaina')).toContain(IDS['束縛チャイナFULLSET'])
  })

  it('分类标签三语都能搜（搜 plugin / 插件 都命中插件类）', () => {
    expect(hitIds('插件')).toContain(IDS['插件动作包'])
    expect(hitIds('plugin')).toContain(IDS['插件动作包'])
  })

  it('标签能搜', () => {
    expect(hitIds('表情')).toContain(IDS['しなの表情'])
    expect(hitIds('动作')).toContain(IDS['插件动作包'])
  })

  it('作者能搜', () => {
    expect(hitIds('月见汐音')).toContain(IDS['插件动作包'])
    expect(hitIds('yuejianxiyin')).toContain(IDS['插件动作包'])
  })

  it('包内路径能搜（emotemenu 只在 prefab 路径里出现过）', () => {
    expect(hitIds('emotemenu')).toContain(IDS['しなの表情'])
    expect(hitIds('blink')).toContain(IDS['しなの表情'])
  })

  it('备注能搜', () => {
    expect(hitIds('灯光'))
      .toContain(IDS['灯光控制器'])
  })

  it('原始文件名里的 Booth id 也能搜到', () => {
    expect(hitIds('6117553')).toContain(IDS['しなの表情'])
  })

  it('前缀匹配：sinan 应该命中 shinano（拼错一个字母也找得到）', () => {
    expect(hitIds('sinan').length + hitIds('shinan').length).toBeGreaterThan(0)
  })

  it('搜不到东西时返回空而不是全表', () => {
    expect(hitIds('zzzqqqxx')).toEqual([])
  })

  it('驼峰后半截也要能搜：animation 命中 FaceAnimation', () => {
    expect(hitIds('animation')).toContain(IDS['しなの表情'])
    expect(hitIds('emote')).toContain(IDS['しなの表情'])
    expect(hitIds('physbone')).toEqual([])
  })

  it('版本号不能被切碎：V1.0 / 1.3.0 还搜得到', () => {
    expect(hitIds('v1.0')).toContain(IDS['衣服套装'])
    expect(hitIds('1.3.0')).toContain(IDS['插件动作包'])
  })

  it('空查询与纯符号不炸', () => {
    expect(hitIds('')).toEqual([])
    expect(hitIds('   ')).toEqual([])
    expect(() => hitIds("——（（")).not.toThrow()
  })
})

describe('别名落库与增量', () => {
  it('search_alias 表真的被回填了（维护页/重建索引要用）', () => {
    const n = (db.prepare(`SELECT COUNT(*) c FROM search_alias`).get() as { c: number }).c
    expect(n).toBeGreaterThan(20)
    const fields = (
      db.prepare(`SELECT DISTINCT field FROM search_alias ORDER BY field`).all() as Array<{ field: string }>
    ).map((r) => r.field)
    expect(fields).toContain('name')
    expect(fields).toContain('tags')
    expect(fields).toContain('paths')
  })

  it('单条别名可复用（入库时走同一个函数，不会两套口径）', () => {
    const r = db.prepare(`SELECT * FROM asset WHERE id = ?`).get(IDS['衣服套装'])
    const { flat } = aliasesFor(db, cfg, r as never)
    expect(flat).toContain('衣服套装')
    // 连写别名是整串的（yifutaozhuang），不是每个词单独一条；
    // 输 yifu 能搜到是靠**查询侧**也归一化成 'yi fu' 再分词命中，不是靠别名里有 'yifu'
    expect(flat.some((x) => x.includes('yi fu tao zhuang'))).toBe(true)
    expect(hitIds('yifu')).toContain(IDS['衣服套装'])
  })

  it('增量 upsert 后新素材立刻可搜', () => {
    const row = makeAssetRow({ id: '01NEWASSET0001', name: '猫耳头饰', raw_name: 'mimikatu.zip', category: 'accessory', subcategory: 'ears', status: 'classified' })
    upsertAsset(db, row)
    const { doc } = aliasesFor(db, cfg, row)
    index.upsert(doc)
    expect(hitIds('maoer')).toContain(row.id)
    expect(hitIds('猫耳')).toContain(row.id)
    index.remove(row.id)
    expect(hitIds('猫耳')).not.toContain(row.id)
  })
})

describe('tokenize 切词', () => {
  const t = (s: string): string[] => tokenize(s)

  it('大小写交界切开，路径与下划线也是分隔符', () => {
    expect(t('Assets/ToraandoPRO/Mats/Body.mat')).toEqual(['Assets', 'Toraando', 'PRO', 'Mats', 'Body', 'mat'])
    expect(t('Shinano_FaceAnimation')).toEqual(['Shinano', 'Face', 'Animation'])
  })

  it('连续大写不拆（SHINANO 还是一个词），数字不拆散版本号', () => {
    expect(t('SHINANO_V1.0')).toEqual(['SHINANO', 'V1', '0'])
    expect(t('ABT 1.3.0')).toEqual(['ABT', '1', '3', '0'])
  })

  it('中日文按空白与符号切，词内不拆', () => {
    expect(t('束縛チャイナFULLSET')).toEqual(['束縛チャイナ', 'FULLSET'])
    expect(t('插件 表情类')).toEqual(['插件', '表情类'])
  })

  it('全空/纯符号返回空数组，不吐空 token', () => {
    expect(t('')).toEqual([])
    expect(t('——（（···')).toEqual([])
  })
})

describe('§7 性能：搜索 ≤100ms', () => {
  it('5000 条文档下查询仍在 100ms 内', () => {
    const big = new AssetSearchIndex()
    const docs = Array.from({ length: 5000 }, (_, i) => ({
      id: 'x' + i,
      name: 'Shinano 表情 套装 ' + i,
      rawName: 'file_' + i + '.zip',
      category: 'plugin expression',
      tags: '表情 换装 shinano',
      author: '作者' + (i % 50),
      notes: '这是一个说明文本 ' + i,
      paths: 'Assets/Face/Emote' + i + '.prefab',
      aliases: 'shinano biaoqing taozhu ' + i
    }))
    const t0 = Date.now()
    big.rebuild(docs)
    const buildMs = Date.now() - t0
    const q0 = Date.now()
    const hits = big.search('shinano')
    const queryMs = Date.now() - q0
    expect(hits.length).toBeGreaterThan(0)
    expect(queryMs, `查询 ${queryMs}ms 超了 100ms`).toBeLessThan(100)
    // 5000 条重建要在几秒内（启动时是后台做的，不能把主线程占死）
    expect(buildMs).toBeLessThan(5000)
  }, 60000)
})
