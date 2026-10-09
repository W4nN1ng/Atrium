import { describe, it, expect, beforeAll } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { CategoryConfig } from '../../src/shared/types'
import { openDatabase, closeDatabase, type Db } from '../../src/main/db'
import { planRearchive, type RearchiveEnv } from '../../src/main/library/rearchive'
import { planRegroup, applyRegroup } from '../../src/main/library/regroup'
import { getAsset } from '../../src/main/db/repos/asset'

/**
 * R4 ③/⑤ 在**他真库的副本**上的只读体检（默认整份跳过）。
 *
 * 跑法（Node ABI）：
 *   AVCA_CHECK_REAL_DB=1 npx vitest run tests/real/realdb-r4-preview.spec.ts
 *
 * 三条硬规矩：
 *  1. 只开副本。真库文件一个字节都不写，跑完核对原文件字节数没变。
 *  2. `planRearchive` 本身就是只读的（预览 → 用户确认才轮到 `applyRearchive`），
 *     所以这里连"搬一个文件"都不该发生 —— 用整棵库根的目录快照证明。
 *  3. 素材库根 `E:\vrc\A` 只 stat / 只数目录，不写、不搬、不删。
 *
 * 它要回答的两个问题（都是 2026-10-07 这轮"把没验证的验一遍"点名的）：
 *  - ③ 的预览数字在真数据上到底对不对（落点、文件数、字节数、该拒的拒不拒）
 *  - ⑤ 依赖的 avatar 变体：真库有 5 张卡"只有一个模型却没写出变体行"，
 *    走一次重新归并补不补得上（补不上就如实写"存量补不了"）
 */
const APPDATA = process.env.APPDATA || ''
const REAL_DB = path.join(APPDATA, 'A', 'library.db')
const GO = !!process.env.AVCA_CHECK_REAL_DB && fs.existsSync(REAL_DB)
const ROOT = path.resolve(__dirname, '../..')
const cfg = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'resources/lexicon/categories.json'), 'utf8')
) as CategoryConfig

function realSettings(): { libraryRoot: string; dirTemplate: string; libraryLocale: 'zh-CN' | 'en' | 'ja' } {
  const s = JSON.parse(fs.readFileSync(path.join(APPDATA, 'A', 'settings.json'), 'utf8')) as Record<string, unknown>
  return {
    libraryRoot: String(s.libraryRoot || 'E:/vrc/A'),
    dirTemplate: String(s.dirTemplate || '{category}/{subcategory}/{name}'),
    libraryLocale: (s.libraryLocale as 'zh-CN' | 'en' | 'ja') || 'zh-CN'
  }
}

/** 库根的"目录树 + 字节数"快照（只读遍历，用来证明预览没碰盘） */
function snapshot(dir: string): string[] {
  const out: string[] = []
  const stack = [dir]
  while (stack.length && out.length < 6000) {
    const d = stack.pop() as string
    let list: fs.Dirent[]
    try {
      list = fs.readdirSync(d, { withFileTypes: true })
    } catch {
      continue
    }
    for (const e of list) {
      const p = path.join(d, e.name)
      if (e.isDirectory()) stack.push(p)
      else {
        try {
          out.push(path.relative(dir, p) + ':' + fs.statSync(p).size)
        } catch {
          out.push(path.relative(dir, p) + ':?')
        }
      }
    }
  }
  return out.sort()
}

let copy = ''
let tmp = ''
let db: Db
let env: RearchiveEnv
let before: string[]
let originalBytes = 0

beforeAll(() => {
  originalBytes = fs.statSync(REAL_DB).size
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'avca-r4prev-'))
  copy = path.join(tmp, 'library.db')
  fs.copyFileSync(REAL_DB, copy)
  db = openDatabase(copy)
  const s = realSettings()
  env = { libraryRoot: s.libraryRoot, dirTemplate: s.dirTemplate, libraryLocale: s.libraryLocale }
  before = snapshot(s.libraryRoot)
}, 120000)

describe.skipIf(!GO)('真库副本 · R4 ③ 搬文件预览 + ⑤ 变体存量', () => {
  it('③ 预览：每张卡给的落点/文件数/字节数都成立，且磁盘一个字节都没动', async () => {
    const rows = db
      .prepare(
        `SELECT id, category, subcategory, name FROM asset
          WHERE storage_mode='archived' AND parent_asset_id IS NULL AND kind IS NOT NULL
          ORDER BY category, name LIMIT 40`
      )
      .all() as Array<{ id: string; category: string; subcategory: string | null; name: string }>
    expect(rows.length, '真库里没有归档素材，这条测不出东西').toBeGreaterThan(0)

    const libRoot = env.libraryRoot
    expect(libRoot, '真库没设库根，这条测不了').toBeTruthy()
    const cats = cfg.categories.map((c) => c.key)
    const histogram: Record<string, number> = {}
    let moved = 0
    const samples: string[] = []

    for (const r of rows) {
      /** 故意改成一个**不同的一级分类**：同分类改二级也合法，但一级更能暴露落点算错 */
      const target = cats.find((c) => c !== r.category) ?? r.category
      const sub = cfg.categories.find((c) => c.key === target)?.subcategories[0]?.key ?? null
      const plan = await planRearchive(db, r.id, target, sub, env)
      expect(plan.ok, '预览本身不该报错：' + r.name).toBe(true)
      if (!plan.ok) {
        histogram['预览失败'] = (histogram['预览失败'] ?? 0) + 1
        continue
      }
      const key = plan.willMove ? '会搬' : plan.reasonKey ?? '没说原因'
      histogram[key] = (histogram[key] ?? 0) + 1
      if (!plan.willMove) continue
      moved++
      expect(plan.fromDir, 'fromDir 必须有').toBeTruthy()
      expect(plan.toDir, 'toDir 必须有').toBeTruthy()
      expect(
        plan.toDir!.toLowerCase().startsWith(libRoot!.toLowerCase().replace(/\//g, '\\')),
        '落点必须在库根下：' + plan.toDir
      ).toBe(true)
      expect(path.normalize(plan.fromDir ?? '')).not.toBe(path.normalize(plan.toDir ?? ''))
      expect(plan.fileCount, '说会搬却数出 0 个文件').toBeGreaterThan(0)
      expect(plan.bytes, '说会搬却算出 0 字节').toBeGreaterThan(0)
      expect(plan.moves.length, 'moves 必须非空').toBeGreaterThan(0)
      if (samples.length < 4) samples.push(`${r.name} → ${plan.fromDir} ⇒ ${plan.toDir}（${plan.fileCount} 个文件 / ${plan.bytes} 字节）`)
    }

    console.log(`③ 预览了 ${rows.length} 张真卡：会搬 ${moved} 张，其余分布 ${JSON.stringify(histogram)}`)
    for (const s of samples) console.log('   样本：' + s)

    const after = snapshot(libRoot!)
    expect(after.length, '预览阶段库根文件数变了（不该发生）').toBe(before.length)
    expect(after.join('\n')).toBe(before.join('\n'))
    expect(fs.statSync(REAL_DB).size, '真库文件被动过').toBe(originalBytes)
  })

  it('⑤ 存量：那 5 张"单模型却没写出 avatar 变体"的卡，重新归并补不补得上', () => {
    const gap = db
      .prepare(
        `SELECT a.id, a.raw_name AS name,
                (SELECT COUNT(DISTINCT lower(t.name)) FROM asset_tag at JOIN tag t ON t.id=at.tag_id
                  WHERE at.asset_id=a.id AND t.kind='avatar') models
           FROM asset a
          WHERE a.group_id IS NOT NULL AND models = 1
            AND NOT EXISTS (SELECT 1 FROM variant v WHERE v.asset_id=a.id AND v.variant_kind='avatar')`
      )
      .all() as Array<{ id: string; name: string; models: number }>
    console.log('⑤ 存量缺口：' + gap.length + ' 张 —— ' + gap.map((g) => g.name).join(' / '))

    const plan = planRegroup(db)
    const res = applyRegroup(db, plan)
    console.log(`重新归并：拆了 ${res.createdGroups} 个组、动了 ${res.moved} 行`)

    const still = gap.filter((g) => {
      const row = getAsset(db, g.id)
      if (!row) return false
      const has = db.prepare(`SELECT COUNT(*) n FROM variant WHERE asset_id=? AND variant_kind='avatar'`).get(g.id) as { n: number }
      return Number(has.n) === 0
    })
    /**
     * 这条**故意只打印不断言**：`applyRegroup` 只重建"被拆开的那些组"的变体，
     * 没被拆的组它一行都不碰，所以存量缺口本来就不该指望它。
     * 断言写死成"补上了"反而是假的；写死成"补不上"又会在哪天有人加了重建逻辑时变红。
     */
    console.log(
      still.length === gap.length
        ? '⑤ 结论：重新归并**补不上**这批存量（它只重建被拆开的组）—— 要补得另开一条"重建变体"的路'
        : `⑤ 结论：重新归并补上了 ${gap.length - still.length} / ${gap.length} 张，剩 ${still.length} 张`
    )
    expect(gap.length).toBeGreaterThanOrEqual(0)
  })
})
