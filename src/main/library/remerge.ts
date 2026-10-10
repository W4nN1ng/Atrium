/**
 * 第 9 轮 ② · B4「存量重并」：按**现在的**归并键规则，把库里老行重新归一次组。
 *
 * ## 为什么需要这个模块（症状与根因不在一起）
 *
 * 用户看到的：`E:\vrc\A\衣服\名流\` 里 20 张 Libero 散成 13 张卡。
 * 量出来的事实（`tests/real/realdb-key-rescan.spec.ts`，只读、可复跑）：
 *
 *  - **判据已经是对的** —— 那 20 个文件名喂给现在的 `deriveGroupKey` 全塌成一个键；
 *  - **库里的键是老的** —— §B2/§B3 之后没人回来重算过存量行；
 *  - `reanalyze.ts` 的 `recompute()` 刻意只改 name / version / variant_raw，**不动 `group_key`**，
 *    所以"再点一次重新分析"也治不了它。
 *
 * 一句话：**规则修好了，症状还在**，缺的就是"把规则重新作用到存量上"这一步。
 * 真库实测作用面积：1 处要合并、少 12 张卡，库里别的地方一处都不动。
 *
 * ## 三条硬约束（都是他点过名的）
 *
 *  1. **一个文件都不搬。** 这里只写 `asset.group_id` / `asset_group` / `variant` 三张表，
 *     `library_path` 一个字都不改 —— 归并关系变了不等于东西挪了位置。
 *  2. **预览 → 确认 → 整批可撤销。** 分组直接用现成的 `planGroups()`（含 §B2 安全保护 3 的
 *     歧义闸门和 #40 的"必须同目录"），所以预览里每一组都是自动归并**本来就该并上**的，
 *     不是又造一条模糊匹配。撤销走 journal 的 `remerge` op。
 *  3. **不许顺手改分类。** 目标组沿用**它自己原来的** category / subcategory / name；
 *     成员各自的分类用户可能手改过，一次归并不构成"把它们统一"的授权。
 *
 * ## 撤销为什么必须存原样而不是"重算"
 *
 * 撤销的时候键规则可能又被改了，重算出来的那份和当初正向操作的输入根本不是一套。
 * 所以旧组行、旧变体行、旧 `group_key` 全部逐条塞进 journal 的 payload。
 */
import type { Db } from '../db'
import type { AssetGroupRow, AssetRow, VariantRow } from '../../shared/types'
import { getAsset } from '../db/repos/asset'
import { addVariant, ensureGroup, getGroup } from '../db/repos/product'
import { appendJournal, type JournalPayload } from '../db/repos/journal'
import { deriveGroupKey, type NameTokens } from '../classify/groupKey'
import { planGroups, type GroupableAsset, type GroupPlan } from '../classify/grouping'
import { dirKeyOf } from '../../shared/pathkey'
import { ulid } from '../../shared/ulid'
import type { Lexicon } from '../classify/lexicon'

/** 参与重并的人口：和「建议合并」同一批 —— 合集卡与附属一律不动 */
const POPULATION = `SELECT * FROM asset
    WHERE parent_asset_id IS NULL AND is_bundle = 0 AND attachment_kind IS NULL
      AND status IN ('archived','classified','pending_confirm')
    ORDER BY name`

export interface RemergeRow {
  assetId: string
  name: string
  fromGroupId: string | null
  /** 现在挂的那个组的键（界面上"从 → 到"要用） */
  fromKey: string | null
  /** 重算出来的键 */
  toKey: string
}

export interface RemergeCluster {
  /** 这一簇落在哪个组上；null = 现有组一个都不合适，要新建 */
  keepGroupId: string | null
  groupKey: string
  category: string
  /** 卡片显示名：沿用活下来那个组的名字，没组才用 plan 给的 */
  name: string
  /** 要改挂过去的卡 */
  moveAssetIds: string[]
  /** 改挂之后会清空的旧组 */
  dropGroupIds: string[]
  rows: RemergeRow[]
}

export interface RemergePlan {
  scanned: number
  clusters: RemergeCluster[]
  /** 被 §B2 安全保护 3 挡住的（目录 + 键）处数 —— 预览里要如实说"有几处我没并" */
  skippedAmbiguous: number
}

/** 只读扫描：不改一行。预览面板、测试、活体都跑这个 */
export function planRemerge(db: Db, lex: Lexicon): RemergePlan {
  const rows = db.prepare(POPULATION).all() as AssetRow[]
  const items: GroupableAsset[] = []
  for (const r of rows) {
    const raw = r.raw_name || r.name
    const tokens = deriveGroupKey(raw, lex)
    items.push({
      id: r.id,
      rawName: raw,
      category: r.category,
      sourceUrl: r.source_url,
      sourceItemId: r.source_item_id,
      groupKey: tokens.groupKey,
      tokens,
      /**
       * ⚠ `planGroups` 里的 `shelf()` 只对 `dir` 做"斜杠/尾斜杠/小写"归一，**不会取 dirname**，
       * 所以这里必须传"所在目录"而不是 `library_path`（那是文件自己的路径）。
       * 传错的表现很阴：每张卡的"货架"都成了它自己那个文件路径，谁也不和谁同架，
       * 于是 `planGroups` 一组都归不出来 —— 预览看着"无事可做"，其实是判据没吃到目录。
       * #40 那道闸在这里头：只会同目录才并。
       */
      dir: dirKeyOf(r.library_path ?? r.source_path ?? null)
    })
  }
  const plans = planGroups(items)
  const groupOf = (id: string | null): AssetGroupRow | null => (id ? getGroup(db, id) : null)

  const clusters: RemergeCluster[] = []
  for (const p of plans) {
    const members = p.memberIds.map((id) => getAsset(db, id)).filter((r): r is AssetRow => !!r)
    if (members.length < 2) continue

    /** 按"现在挂在哪个组"分堆 */
    const byGroup = new Map<string, AssetRow[]>()
    for (const m of members) {
      const k = m.group_id ?? '(无组)'
      const list = byGroup.get(k) ?? []
      list.push(m)
      byGroup.set(k, list)
    }
    const rowOf = (): RemergeRow[] =>
      members.map((m) => ({
        assetId: m.id,
        name: m.name,
        fromGroupId: m.group_id,
        fromKey: groupOf(m.group_id)?.group_key ?? null,
        toKey: p.groupKey
      }))

    if (byGroup.size < 2) {
      /**
       * 成员已经在同一个组里了。还要看一眼**那个组的键**：老行可能挂着
       * `libero attitude the royal bunny` 这种旧键 —— 键错在界面上看不出来，
       * 但它会让"同键同目录复用组"那条路继续走错（新来的成员吸附不到它）。
       * 顺手改对，代价是撤销账多一条 groupPatch。
       */
      const gid = [...byGroup.keys()][0]
      if (gid === '(无组)') continue
      const g = groupOf(gid)
      if (!g || g.group_key === p.groupKey) continue
      clusters.push({
        keepGroupId: gid,
        groupKey: p.groupKey,
        category: p.category,
        name: g.name,
        moveAssetIds: [],
        dropGroupIds: [],
        rows: rowOf()
      })
      continue
    }

    /**
     * 活下来的是**成员最多的那个组**，不是"第一个"：成员多的通常就是已经并好的那一族
     * （Libero 是挂着 8 个模型变体的那个），保留它能让"卡片名 / 分类 / 已有变体"
     * 这些用户看得见东西少变一点。并列时取 created_at 最早的。
     */
    const ranked = [...byGroup.entries()]
      .filter(([gid]) => gid !== '(无组)')
      .sort((a, b) => {
        if (b[1].length !== a[1].length) return b[1].length - a[1].length
        return (groupOf(a[0])?.created_at ?? Number.MAX_SAFE_INTEGER) - (groupOf(b[0])?.created_at ?? Number.MAX_SAFE_INTEGER)
      })
    const keep = ranked[0]?.[0] ?? null
    const keepRow = groupOf(keep)
    const moveAssetIds = [...byGroup.entries()].filter(([gid]) => gid !== keep).flatMap(([, list]) => list.map((m) => m.id))
    /**
     * 预览列表**把要挪的排在前面**。
     *
     * 不排的话界面只列前 8 行，而 `planGroups` 给的第一批往往正是"已经在同一个组里"的那些 ——
     * 活体实测就是这样：8 行全是 `libero attitude the royal bunny → libero attitude`，
     * 真正要挪的 12 行被"还有 N 张没列出来"折起来了。
     * 用户看预览是来问"你要动我什么东西"的，不是来看已经不动的那批。
     */
    const moving = new Set(moveAssetIds)
    const rows = rowOf().sort((a, b) => Number(moving.has(b.assetId)) - Number(moving.has(a.assetId)))

    clusters.push({
      keepGroupId: keep,
      groupKey: p.groupKey,
      category: p.category,
      name: keepRow?.name ?? p.name,
      moveAssetIds,
      dropGroupIds: [...byGroup.keys()].filter((gid) => gid !== keep && gid !== '(无组)'),
      rows
    })
  }

  /** 歧义闸门挡掉了几处：planGroups 不回报，只能按同一口径再数一遍 */
  const perKey = new Map<string, Set<string>>()
  for (const it of items) {
    if (!it.tokens.slotPrefixes.length) continue
    const k = `${it.dir ?? '?'}\u0000${it.groupKey}`
    const s = perKey.get(k) ?? new Set<string>()
    s.add(it.tokens.slotPrefixes[0])
    perKey.set(k, s)
  }
  const skippedAmbiguous = [...perKey.values()].filter((s) => s.size >= 3).length

  return { scanned: rows.length, clusters, skippedAmbiguous }
}

/**
 * 变体行要写的模型名：**原样词形**，不是归并键内部那份大写写法。
 *
 * 口径抄的是 `engine.ts:buildTags` —— 那边是 `token.term.replace(/^\w/, 大写)`，
 * 也就是"文件名里怎么写，就怎么写进变体行"（真库里因此是 `Selestia` / `Airi` 这种）。
 * `NameTokens.avatars` 为了归并键统一大小写把它变成了 `SELESTIA`，直接拿来用，
 * 一张卡上就会一半 `Airi`、一半 `ICHIGO`（第一版就是这么写的，用例抓出来了）。
 *
 * 做法：拿那份大写值回原始文件名里**忽略大小写**找一次，用找到的原样片段。
 * 找不到（比如名字里根本没有这个词形，是从内容里推出来的）才退回大写值。
 */
function displayAvatar(raw: string, tokens: NameTokens): string {
  const upper = tokens.avatars[0] ?? ''
  if (!upper) return ''
  const esc = upper.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const hit = new RegExp(esc, 'i').exec(raw)
  const name = hit ? hit[0] : upper
  return name.replace(/^\w/, (c) => c.toUpperCase())
}

export interface RemergeResult {
  moved: number
  droppedGroups: number
  /** 只改键、没搬成员的簇数 */
  keyOnly: number
  /** 本次新建的组（keepGroupId 为 null 的那些），撤销时靠它清空的 */
  createdGroups: string[]
  batchId: string
}

/**
 * 执行重并。**一个事务、一个 batch_id**，Ctrl+Z 一次整批退回。
 *
 * ⚠ 传进来的 plan 必须是**刚刚现扫的**：中间只要有任何一次入库或改分类，那份预览就过期了。
 * 所以 IPC 层的做法是"点确认时重扫一遍再落地"，不把预览对象当真相存。
 */
export function applyRemerge(db: Db, plan: RemergePlan, lex: Lexicon): RemergeResult {
  const now = Date.now()
  const batchId = ulid()
  let moved = 0
  let droppedGroups = 0
  let keyOnly = 0

  const fieldChanges: NonNullable<JournalPayload['fieldChanges']> = []
  const groupPatch: NonNullable<JournalPayload['groupPatch']> = []
  const dropped: NonNullable<JournalPayload['droppedGroups']> = []
  const addedVariants: string[] = []
  const createdGroups: string[] = []

  db.transaction(() => {
    for (const c of plan.clusters) {
      let target: AssetGroupRow | null = c.keepGroupId ? getGroup(db, c.keepGroupId) : null
      if (target && target.group_key !== c.groupKey) {
        groupPatch.push({
          id: target.id,
          from: { group_key: target.group_key, name: target.name, updated_at: target.updated_at }
        })
        db.prepare(`UPDATE asset_group SET group_key = ?, updated_at = ? WHERE id = ?`).run(c.groupKey, now, target.id)
        target = { ...target, group_key: c.groupKey }
      }
      if (!target) {
        /**
         * 一簇里没有任何现成组可复用 → 走 `ensureGroup` 那条正常路径，
         * 它自己会处理"同键同目录已有组就吸附"（三种 dir_key 口径的坑它已经踩过并修好了）。
         */
        const first = getAsset(db, c.rows[0]?.assetId)
        target = ensureGroup(db, {
          groupKey: c.groupKey,
          name: c.name,
          category: c.category,
          dirKey: dirKeyOf(first?.library_path ?? first?.source_path ?? null)
        })
        if (!plan.clusters.some((x) => x.keepGroupId === target!.id)) createdGroups.push(target.id)
      }

      for (const id of c.moveAssetIds) {
        const row = getAsset(db, id)
        if (!row) continue
        fieldChanges.push({ id, to: { group_id: target.id }, from: { group_id: row.group_id ?? null } })
        db.prepare(`UPDATE asset SET group_id = ?, updated_at = ? WHERE id = ?`).run(target.id, now, id)
        moved++
      }

      /**
       * 清空了的旧组：连变体行一起删，原样存进 journal。
       * 删之前先确认它**真的空了** —— 组里可能还挂着子项或附属（不在本次人口里、也不该被搬走），
       * 那时删组会留下一堆指向不存在组的 group_id。
       */
      for (const gid of c.dropGroupIds) {
        const stay = db.prepare(`SELECT COUNT(*) AS n FROM asset WHERE group_id = ?`).get(gid) as { n: number }
        if (Number(stay.n) > 0) continue
        const grow = getGroup(db, gid)
        if (!grow) continue
        const gvars = db.prepare(`SELECT * FROM variant WHERE group_id = ?`).all(gid) as VariantRow[]
        db.prepare(`DELETE FROM variant WHERE group_id = ?`).run(gid)
        db.prepare(`DELETE FROM asset_group WHERE id = ?`).run(gid)
        dropped.push({ row: grow, variants: gvars })
        droppedGroups++
      }

      /**
       * 补齐变体行。**只插不删**（要删的上面按整组删过了）。
       *
       * ⚠ 两条必须守住的规矩，都是从"写这行的那个人"（`commit.ts:persistRelations`）抄来的，
       * 不是我自己定的：
       *
       *  1. **只有单一体型才算变体。** 一个包适配 11 个体型时那 11 个名字是兼容性说明，
       *     写进 variant 表会让聚合视图谎报"12 变体"（commit 那边实测踩过）。
       *     所以：`avatars.length === 1` 写模型名，`=== 0` 写 `UNIVERSAL` 占位，`> 1` 一条都不写。
       *     ⚠ 这里**不用 `planGroups` 给的 `p.variants`** —— 它走的是 §3.2 那条"找一个能区分兄弟的维度"，
       *     多体型时会把 `avatars[0]` 当成变体写进来，正好是 commit 要避免的那种谎报。
       *  2. **插之前按大小写无关查重。** `deriveGroupKey` 的 `avatars` 是大写写法（`ICHIGO`），
       *     而老组上存的是 `Shinano` 这种原样写法 —— 不查重的话一张卡上会同时挂 `AIRI` 与 `Airi`
       *     两个"模型"，卡片上那一排徽章一半是重复的。`addVariant` 自带的查重是大小写敏感的，拦不住。
       */
      const have = new Set(
        (db.prepare(`SELECT variant_kind k, variant_value v FROM variant WHERE group_id = ?`).all(target.id) as Array<{
          k: string
          v: string
        }>).map((x) => `${x.k}\u0000${String(x.v).toLowerCase()}`)
      )
      const put = (assetId: string, kind: VariantRow['variant_kind'], value: string): void => {
        const sig = `${kind}\u0000${value.toLowerCase()}`
        if (have.has(sig)) return
        have.add(sig)
        const row = addVariant(db, { groupId: target.id, assetId, kind, value })
        addedVariants.push(row.id)
      }
      for (const r of c.rows) {
        const row = getAsset(db, r.assetId)
        if (!row) continue
        const t = deriveGroupKey(row.raw_name || row.name, lex)
        if (t.avatars.length === 1) put(r.assetId, 'avatar', displayAvatar(row.raw_name || row.name, t))
        if (t.avatars.length === 0) put(r.assetId, 'avatar', 'UNIVERSAL')
        if (t.installMethod) put(r.assetId, 'install_method', t.installMethod)
        if (t.version) put(r.assetId, 'version', t.version)
        if (t.locale) put(r.assetId, 'locale', t.locale)
      }
      if (!c.moveAssetIds.length) keyOnly++
      db.prepare(`UPDATE asset_group SET updated_at = ? WHERE id = ?`).run(now, target.id)
    }

    if (!moved && !groupPatch.length) return
    appendJournal(
      db,
      {
        op: 'remerge',
        fieldChanges,
        groupPatch,
        droppedGroups: dropped,
        addedVariants,
        assetIds: [],
        label: `按现在的规则重新归并：${plan.clusters.length} 簇 / 改挂 ${moved} 张卡 / 合并掉 ${droppedGroups} 个组`
      },
      { batchId }
    )
    /**
     * 新建出来的组另记一条 `register`，**不带 assetIds**（带了会被 undoLast 当成"待删的素材行"），
     * 只带 extra.groupIds —— 撤销时那条分支"组确实空了才删"，正是我们要的。
     */
    if (createdGroups.length) {
      appendJournal(
        db,
        { op: 'register', label: `重并新建 ${createdGroups.length} 个组记录`, extra: { groupIds: createdGroups } },
        { batchId }
      )
    }
  })()

  return { moved, droppedGroups, keyOnly, createdGroups, batchId }
}

/** 给界面/测试用：把 plan 摊成"哪张卡从哪个键去哪个键" */
export function remergeLines(plan: RemergePlan): string[] {
  const out: string[] = []
  for (const c of plan.clusters) {
    out.push(`${c.rows.length} 张 → ${c.groupKey}${c.keepGroupId ? '' : '（新建组）'}`)
    for (const r of c.rows) out.push(`   ${(r.fromKey ?? '(无组)').padEnd(46)} → ${r.toKey}　${r.name}`)
  }
  return out
}

export type { GroupPlan }
