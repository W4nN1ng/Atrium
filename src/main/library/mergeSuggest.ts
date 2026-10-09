/**
 * §B5 同前缀建议合并。
 *
 * 和 §B2 的自动归并是两件事，界线必须划清楚：
 *  - 方括号变体槽位（`Libero[Shinano_ATTITUDE…]`）→ **自动**并，因为括号本身就写着"这里是变体"；
 *  - 只是首词相同（`TwinkleSpica Mint` / `TwinkleSpica Plum`）→ **只建议**，等用户点头。
 *
 * 为什么不自动并：Mint / Plum / Chocolate 是配色，Eku / Ramune / Shinano 是模型，
 * 光看名字分不清是不是同一件东西 —— 用户原话是"可能真是不同产品"。
 * 并错了虽然能"解散分组"退回来，但那是让用户替程序擦屁股。
 *
 * 三件事都在这里：扫建议、执行合并、记住"不再提示"。
 * 合并走的是和「重新整理合集」同一条 reparent journal，Ctrl+Z 能整批退回。
 */
import path from 'node:path'
import type { Db } from '../db'
import { upsertAsset, getAsset } from '../db/repos/asset'
import { appendJournal } from '../db/repos/journal'
import { deriveGroupKey } from '../classify/groupKey'
import type { Lexicon } from '../classify/lexicon'
import { ulid } from '../../shared/ulid'
import type { AssetRow } from '../../shared/types'

const DISMISS_KEY = 'mergeSuggestDismissed'

/**
 * 这些首词是通用词，撞上了不代表同系列。
 * 真库里 `Custom` / ` for ` / `用` 这种前缀能横跨几十个不相干的产品。
 */
const GENERIC_HEADS = new Set([
  'custom', 'for', 'the', 'a', 'an', 'my', 'new', 'old', 'ver', 'version', 'v',
  'unity', 'vrc', 'vrchat', 'quest', 'pc', 'mod', 'modular', 'pack', 'set', 'bundle',
  'free', 'test', 'temp', 'copy', 'backup', 'old', '用', '版', '新', '旧', '测试'
])

export interface MergeSuggestion {
  /** 共同的首词，界面上显示成「TwinkleSpica」 */
  head: string
  assetIds: string[]
  names: string[]
  /** 它们共同所在的目录（同目录才建议；跨目录撞首词太容易是巧合） */
  dir: string | null
}

function dirOf(p: string | null): string | null {
  if (!p) return null
  const norm = p.replace(/[\\/]+$/, '')
  const i = Math.max(norm.lastIndexOf('/'), norm.lastIndexOf('\\'))
  return i > 1 ? norm.slice(0, i) : null
}

function readDismissed(db: Db): Set<string> {
  try {
    const row = db.prepare(`SELECT value_json FROM setting WHERE key = ?`).get(DISMISS_KEY) as
      | { value_json: string }
      | undefined
    const arr = row ? (JSON.parse(row.value_json) as unknown) : []
    return new Set(Array.isArray(arr) ? arr.map(String) : [])
  } catch {
    return new Set()
  }
}

function writeDismissed(db: Db, set: Set<string>): void {
  db.prepare(`INSERT OR REPLACE INTO setting (key, value_json) VALUES (?, ?)`).run(
    DISMISS_KEY,
    JSON.stringify(Array.from(set))
  )
}

/** 只读扫描。改一次库/收一次素材都可以重跑，不产生任何副作用 */
export function scanMergeSuggestions(db: Db, lex: Lexicon, minSize = 3): MergeSuggestion[] {
  const rows = db
    .prepare(
      `SELECT * FROM asset
        WHERE parent_asset_id IS NULL AND is_bundle = 0 AND attachment_kind IS NULL
          AND status IN ('archived','classified','pending_confirm')
        ORDER BY name`
    )
    .all() as AssetRow[]
  if (rows.length < minSize) return []
  const dismissed = readDismissed(db)

  /** 按「目录 + 首词」分桶：跨目录撞首词不算同系列 */
  const byBucket = new Map<string, AssetRow[]>()
  for (const r of rows) {
    const key = deriveGroupKey(r.raw_name || r.name, lex)
    const head = (key.core[0] ?? '').toLowerCase()
    if (head.length < 3) continue
    if (GENERIC_HEADS.has(head)) continue
    if (key.variantRaw.length) continue // 方括号槽位那批已经自动并过了，不再重复建议
    const bucket = (dirOf(r.library_path ?? r.source_path) ?? '?') + '\u0000' + head
    const list = byBucket.get(bucket) ?? []
    list.push(r)
    byBucket.set(bucket, list)
  }

  const out: MergeSuggestion[] = []
  for (const [bucket, list] of byBucket) {
    if (list.length < minSize) continue
    const head = bucket.split('\u0000')[1]
    if (dismissed.has(head)) continue
    const dir = dirOf(list[0].library_path ?? list[0].source_path)
    // 已经在同一个容器里的不再建议
    if (list.every((r) => r.group_id && r.group_id === list[0].group_id)) continue
    out.push({
      head,
      assetIds: list.map((r) => r.id),
      names: list.map((r) => r.name),
      dir
    })
  }
  return out.sort((a, b) => b.assetIds.length - a.assetIds.length)
}

export interface MergeResult {
  containerId: string
  moved: number
  batchId: string
}

/**
 * 执行合并：建一个 `container_kind='merged'` 的容器，把成员挂进去。
 * **一个文件都不搬**（改动单 1 §7.1），撤销走 reparent journal 原路退回。
 */
export function applyMergeSuggestion(
  db: Db,
  input: { assetIds: string[]; name: string; category?: string | null; subcategory?: string | null }
): MergeResult {
  const members = input.assetIds.map((id) => getAsset(db, id)).filter((r): r is AssetRow => !!r)
  if (members.length < 2) throw new Error('至少要有 2 个成员')
  const now = Date.now()
  const containerId = ulid()
  const batchId = ulid()
  const dir = dirOf(members[0].library_path ?? members[0].source_path)
  const bytes = members.reduce((a, m) => a + (m.size_bytes ?? 0), 0)
  const worst = members.reduce((m, r) => Math.min(m, r.confidence), 1)
  const cat = input.category || members[0].category
  const sub = input.subcategory ?? members[0].subcategory

  const changes: Array<{ id: string; from: string | null; to: string | null; groupFrom: string | null; nameFrom?: string | null }> = []

  db.transaction(() => {
    upsertAsset(db, {
      ...members[0],
      id: containerId,
      name: input.name,
      raw_name: input.name,
      category: cat,
      subcategory: sub,
      confidence: worst,
      status: 'classified',
      content_type: 'bundle',
      library_path: dir,
      source_path: null,
      storage_mode: 'indexed',
      size_bytes: bytes,
      hash_xxh64: null,
      group_id: null,
      bundle_id: null,
      parent_asset_id: null,
      is_bundle: 1,
      container_kind: 'merged',
      needs_review: members.some((m) => Number(m.needs_review) === 1) ? 1 : 0,
      notes: 'merge-suggestion',
      created_at: now,
      updated_at: now
    })
    for (const m of members) {
      changes.push({ id: m.id, from: m.parent_asset_id, to: containerId, groupFrom: m.group_id })
      db.prepare(`UPDATE asset SET parent_asset_id = ?, updated_at = ? WHERE id = ?`).run(containerId, now, m.id)
    }
    appendJournal(
      db,
      { op: 'reparent', changes, label: `合并 ${members.length} 个同系列素材成容器「${input.name}」` },
      { batchId }
    )
    appendJournal(db, { op: 'register', assetIds: [containerId], label: `新建归并型容器 ${input.name}` }, { batchId })
  })()

  return { containerId, moved: changes.length, batchId }
}

/** 「不再提示」：记首词，不记具体那批 id —— 之后新加进来的同系列素材也不再烦他 */
export function dismissMergeSuggestion(db: Db, head: string): void {
  const set = readDismissed(db)
  set.add(head.toLowerCase())
  writeDismissed(db, set)
}

export function listDismissedMerges(db: Db): string[] {
  return Array.from(readDismissed(db))
}

/** 给界面显示"这些素材在哪"：目录名而已，不暴露整条绝对路径 */
export function dirLabel(dir: string | null): string | null {
  return dir ? path.basename(dir) : null
}

/** 分类下拉的默认值：取成员里的多数派 */
export function majorityCategory(rows: AssetRow[]): { category: string; subcategory: string | null } {
  const count = new Map<string, number>()
  for (const r of rows) count.set(r.category, (count.get(r.category) ?? 0) + 1)
  const top = Array.from(count.entries()).sort((a, b) => b[1] - a[1])[0]
  const category = top ? top[0] : 'other'
  const sub = rows.find((r) => r.category === category)?.subcategory ?? null
  return { category, subcategory: sub }
}

/** 让「不再提示」能被清掉（设置页里给了个复位入口，不然用户点了就永远找不回来） */
export function resetDismissedMerges(db: Db): void {
  writeDismissed(db, new Set())
}
