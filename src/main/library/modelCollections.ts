/**
 * M6 ④ · 「按库里出现过的模型补建集合」（主进程那半边）
 *
 * 为什么它是 M6 的第一入口：真库 `collection` 表 0 行，而 Q2 裁定是"命中才建"——
 * 没有集合就永远匹配不到，自动切换在真库上根本无从演示。
 *
 * 两条纪律：
 *  1. **先预览、后写库**：`planModelCollections` 只读，`applyModelCollections` 才写；
 *     而且 apply **只认预览里出现过的名字**（界面传什么来都照建 = 一条能批量造数据的后门）；
 *  2. **可撤销**：一次补建留一条 `journal(op='collection_backfill')`，
 *     撤销按 payload 里的 id 清单删（不按名字删 —— 见 `library/undo.ts` 那条 case 的注释）。
 */
import type { Db } from '../db'
import { appendJournal } from '../db/repos/journal'
import { createCollection, listCollections } from '../db/repos/meta'
import { modelCandidates, totalCovered } from '../../shared/modelCollections'
import type {
  CollectionRow,
  ModelBackfillPlan,
  ModelBackfillResult,
  ModelRow
} from '../../shared/types'

/** 补建出来的集合规则优先级：比手工集合高一点，但**低于 `projectPaths` 精确匹配**（那是用户明说的） */
const BACKFILL_PRIORITY = 10

/**
 * 库里出现过的模型值：`variant(variant_kind='avatar')` 与 `tag(kind='avatar')` 两处取并集。
 *
 * 为什么两处都要：附属识别之后，一部分素材的模型信息落在 `variant` 上，
 * 另一部分（只打了标签的）落在 `tag` 上。只看一处就会漏 —— 漏了就是"明明库里有，
 * 补建却没建出来"，用户只能自己手动建。
 */
export function avatarValuesInLibrary(db: Db): ModelRow[] {
  const merged = new Map<string, number>()
  const bump = (value: unknown, count: unknown): void => {
    const v = String(value ?? '').trim()
    if (!v) return
    merged.set(v, (merged.get(v) ?? 0) + (Number(count) || 0))
  }
  for (const r of db
    .prepare(`SELECT variant_value AS v, COUNT(*) AS n FROM variant WHERE variant_kind='avatar' GROUP BY variant_value`)
    .all() as Array<{ v: string; n: number }>) {
    bump(r.v, r.n)
  }
  for (const r of db
    .prepare(`SELECT t.name AS v, COUNT(*) AS n FROM tag t JOIN asset_tag at ON at.tag_id = t.id WHERE t.kind='avatar' GROUP BY t.name`)
    .all() as Array<{ v: string; n: number }>) {
    bump(r.v, r.n)
  }
  return Array.from(merged.entries()).map(([value, count]) => ({ value, count }))
}


/** 只读：算出"点确认会发生什么"。预览面板要的就是这份 */
export function planModelCollections(db: Db): ModelBackfillPlan {
  const rows = listCollections(db)
  const { candidates, skipped } = modelCandidates(avatarValuesInLibrary(db), rows.map((r) => r.name))
  return { candidates, skipped, covered: totalCovered(candidates), existing: rows.map((r) => r.name) }
}


/**
 * 写库：建集合 + 留一条可撤销的 journal。
 *
 * ⚠ `names` 必须来自刚才那份预览 —— 这里会**重新算一遍 plan 再取交集**，
 * 不在候选里的名字一律忽略。少这一道的后果是：这条通道变成"给库里塞任意集合"的后门，
 * 而它一旦被界面误用（比如把用户输入的字符串直接传进来）就没有第二次校验了。
 */
export function applyModelCollections(db: Db, names: string[]): ModelBackfillResult {
  const wanted = new Set(names.map((n) => String(n ?? '').trim()).filter(Boolean))
  const { candidates } = planModelCollections(db)
  const allow = new Map(candidates.map((c) => [c.name, c]))
  const created: CollectionRow[] = []
  const ignored: string[] = []

  for (const name of wanted) {
    const c = allow.get(name)
    if (!c) {
      ignored.push(name)
      continue
    }
    const row = createCollection(db, {
      name: c.name,
      rule: { keywords: c.keywords, matchMode: 'any', priority: BACKFILL_PRIORITY },
      isAuto: true,
      priority: BACKFILL_PRIORITY
    })
    created.push(row)
  }

  if (!created.length) return { created: [], ignored, journalId: -1 }
  const journalId = appendJournal(
    db,
    {
      op: 'collection_backfill',
      collectionIds: created.map((r) => r.id),
      label: `按库里出现过的模型补建 ${created.length} 个集合`
    },
    { batchId: null }
  )
  return { created, ignored, journalId }
}
