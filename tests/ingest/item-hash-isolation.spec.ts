import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { thumbKeyOf } from '../../src/main/library/thumbRules'

/**
 * **子项不许继承整个筐的内容指纹。**
 *
 * ## 这条守的是 2026-10-15 那个真故障
 *
 * 用户报「间隔一段时间后，封面会变成同一张」。真库实测：23 条素材的
 * `hash_xxh64` **全是同一个值** `f708d775f3745ff3`，而它们的体积从 319 KB 到 808 MB。
 *
 * 链条是这样接起来的：
 *
 *   入库时每个子项都继承整个筐的 `res.hash`
 *     → 23 行的 `hash_xxh64` 撞成一把
 *     → 缩略图缓存键 `thumbKeyOf` 是 `hash_xxh64 || id`，哈希优先
 *     → 23 张卡算出**同一个键**、指向**同一个 .jpg**
 *     → 界面上 23 张卡全是同一张图
 *
 * 顺带还有第二个后果：`findAssetByHash` 的查重会误判 ——
 * 同一个筐里再导一件，会被当成"已存在"。
 *
 * ## 为什么用静态断言
 *
 * `unitFromModel` 是 `registerIngest()` 里的闭包，测试拿不到实例；
 * 而这个仓库没有端到端驱动入库链的测试架子（`tests/ingest/` 不存在）。
 * 所以这里钉的是**调用点**：只要有人把 `hash: null` 删掉，这条就红。
 *
 * ⚠ 判源码必须先剥注释 —— 修复处的注释里反复写着 `hash: null` 这几个字，
 * 不剥的话"把代码删了只留注释"照样通过。
 */

const REPO = path.resolve(__dirname, '../..')

function strip(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split(/\r?\n/)
    .map((line) => {
      const i = line.indexOf('//')
      return i === -1 ? line : line.slice(0, i)
    })
    .join('\n')
}

const API = strip(fs.readFileSync(path.join(REPO, 'src/main/ingest/api.ts'), 'utf8'))

describe('内容指纹：子项与整个筐隔离', () => {
  it('⭐ 摊平的筐：每一件都显式传 hash: null（不继承整个筐的指纹）', () => {
    /**
     * 用户那 23 条正是从这条路径进来的。这里数的是"显式传 null 的地方"，
     * 筐里子项 + 合集子项两处都要有，少一处就有一半数据会再撞一次。
     */
    const hits = API.match(/\bhash:\s*null\b/g) ?? []
    expect(hits.length, '至少要有两处子项调用点显式传 hash: null').toBeGreaterThanOrEqual(2)
  })

  it('unitFromModel 默认仍用任务哈希（散装单包时"它就是这个包"，不能一刀切清空）', () => {
    /** 覆盖值语义：显式给了就用给的，没给才回退 res.hash */
    expect(API).toMatch(/hash:\s*over\.hash\s*!==\s*undefined\s*\?\s*over\.hash\s*:\s*res\.hash/)
  })

  it('入参类型允许传 null（只允许 string 的话，"这项不知道"就表达不出来）', () => {
    expect(API).toMatch(/hash\?:\s*string\s*\|\s*null/)
  })

  it('⭐ 相同哈希 → 相同缩略图键（这就是"封面全变同一张"的机制本身）', () => {
    const a = thumbKeyOf({ id: '01AAAAAAAAAAAAAAAAAAAAAAAA', hash_xxh64: 'f708d775f3745ff3' })
    const b = thumbKeyOf({ id: '01BBBBBBBBBBBBBBBBBBBBBBBB', hash_xxh64: 'f708d775f3745ff3' })
    expect(a, '两条不同素材落到同一个键上 —— 界面就会共用一张缩略图').toBe(b)
  })

  it('⭐ 哈希为空时按素材 id 取键 → 每张卡各出各的图', () => {
    const a = thumbKeyOf({ id: '01AAAAAAAAAAAAAAAAAAAAAAAA', hash_xxh64: null })
    const b = thumbKeyOf({ id: '01BBBBBBBBBBBBBBBBBBBBBBBB', hash_xxh64: null })
    expect(a).not.toBe(b)
    expect(a).toBe('01AAAAAAAAAAAAAAAAAAAAAAAA')
  })
})
