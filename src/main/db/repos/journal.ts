import type { Db } from '../index'
import { ulid } from '../../../shared/ulid'
import type {
  ImportLogRow,
  ImportStatus,
  JournalOp,
  JournalRow,
  LearningRow
} from '../../../shared/types'

// ---------------------------------------------------------------- journal：所有文件系统操作的记账本

export interface JournalPayload {
  op: JournalOp
  /** move/copy/rename */
  from?: string
  to?: string
  /** extract/mkdir：本次新建的目录与文件，撤销时按倒序清理 */
  createdDirs?: string[]
  createdFiles?: string[]
  /** trash：from = 原来在哪，to = 被挪去哪（hold 目录），撤销就是从 to 搬回 from */
  trashed?: Array<{ from: string; to: string }>
  /**
   * reparent（三级模型改挂）：每条记 id + 原父级，撤销时按原值挂回去。
   * 解散合集时删掉的那行也存这儿，撤销能整条复原。
   */
  changes?: Array<{ id: string; from: string | null; to: string | null; groupFrom?: string | null; nameFrom?: string | null }>
  /**
   * row = 解散容器时删掉的那行容器；
   * dropped = 连带删掉的附属资源行（容器下没有子项可挂时才会发生，§A2）。
   */
  restore?: { row?: unknown; dropped?: Array<{ row: unknown }> }
  /**
   * reanalyze（「重新分析」）：每条记 id + 改了哪些列的新值 + 那些列的旧值。
   * 旧值必须逐列存 —— 不能"撤销时重算一遍"，因为撤销的时候规则可能又变了。
   */
  fieldChanges?: Array<{ id: string; to: Record<string, unknown>; from: Record<string, unknown> }>
  /** import */
  importLogId?: string
  projectId?: string
  assetIds?: string[]
  /** collection_backfill（M6 ④）：本次新建的集合 id，撤销时按这份清单删，绝不按名字删 */
  collectionIds?: string[]
  /**
   * rearchive（R4 ③「改分类搬文件」）：本次**真的搬了**哪些目录/文件。
   *
   * ⚠ 附属与子项不在这里 —— 它们在父目录里面，`moveTree` 一次就把它们连带搬走了，
   * 再单独记一条 move 撤销时就会去搬一个"已经不在原处的东西"。
   * 它们要改的只是**库里的路径字符串**，那部分走 `fieldChanges`。
   */
  moves?: Array<{ from: string; to: string }>
  /**
   * remerge（第 9 轮 ② · B4 存量重并）：
   *  - `groupPatch` = 被改名（换成新归并键）的那些组，存**旧值**；
   *  - `droppedGroups` = 被合并后清空、连带删掉的组行 + 它们身上的变体行。
   *
   * 两组都必须存原样，**不能"撤销时重算一遍"**：撤销的时候规则可能又被改了，
   * 重算出来的和当初那次正向操作根本不是同一份（`reanalyze` 那条注释讲的同一件事）。
   */
  groupPatch?: Array<{ id: string; from: Record<string, unknown> }>
  droppedGroups?: Array<{ row: unknown; variants: unknown[] }>
  /** remerge：这次往目标组新插的变体行 id，撤销时按这份清单删，绝不按值删 */
  addedVariants?: string[]
  /** 人类可读描述，"操作历史"面板直接显示 */
  label?: string
  libraryRoot?: string
  extra?: Record<string, unknown>
}

export function appendJournal(
  db: Db,
  payload: JournalPayload,
  opts?: { batchId?: string | null; status?: JournalRow['status']; undoOf?: number | null; isUndo?: boolean }
): number {
  const info = db
    .prepare(
      `INSERT INTO journal (op, payload_json, undo_of, undone, status, error, batch_id, created_at)
       VALUES (?, ?, ?, ?, ?, NULL, ?, ?)`
    )
    .run(
      payload.op,
      JSON.stringify(payload),
      opts?.undoOf ?? null,
      // "撤销记录"本身不能再被撤销，否则 Ctrl+Z 会在两条记录之间来回横跳
      opts?.isUndo ? 1 : 0,
      opts?.status ?? 'done',
      /**
       * ⚠ 这里**不能**写 `opts?.batchId ?? null`：`??` 把显式传进来的 `null` 也当空值，
       * 于是"我要一条不属于任何批次的记录"会变成空字符串 `''`。
       * 空串不是 NULL，按 `batch_id = ''` 还是能把它捞出来 ——
       * 撤销记录一旦被当成"待撤销的原操作"，一次 Ctrl+Z 就会自我复制一批记录。
       * 所以只有 `undefined`（调用方压根没提）才回退到 null。
       */
      opts?.batchId === undefined ? null : opts.batchId,
      Date.now()
    )
  return Number(info.lastInsertRowid)
}

export function listBatch(db: Db, batchId: string): JournalRow[] {
  return db.prepare(`SELECT * FROM journal WHERE batch_id = ? ORDER BY id DESC`).all(batchId) as JournalRow[]
}

export function listJournal(db: Db, limit = 200): JournalRow[] {
  return db
    .prepare(`SELECT * FROM journal ORDER BY id DESC LIMIT ?`)
    .all(limit) as JournalRow[]
}

export function getJournal(db: Db, id: number): JournalRow | null {
  const row = db.prepare(`SELECT * FROM journal WHERE id = ?`).get(id) as JournalRow | undefined
  return row ?? null
}

/** Ctrl+Z 找"最近一条还没撤销过的" */
export function lastRevertible(db: Db): JournalRow | null {
  /**
   * `import` **不在这个列表里**（M5-B ⑤ 摘掉的）。
   *
   * 原来列里有 `import`，而 `undoOne` 碰到 import 只会抛
   * "导入撤销依赖 Unity 桥接，将在 M5 交付" —— 于是每导一次包，Ctrl+Z 就先撞上
   * 这条抛错、把它标成 failed 再罢手，用户按一次"撤销"什么都没撤掉。
   * M5-B 之后一次容器导入会留下 N 条 import 行**共用一个 batch_id**，
   * `undoLast` 是按 batch 整批捞的，那 N 条会把一次 Ctrl+Z 拖成 N 次失败。
   *
   * 导入的撤销走的是 `unity:rollback-import` / `unity:rollback-batch`（要 Unity 在线），
   * 它和"把文件搬回去"是两条链，别混进 Ctrl+Z。
   */
  const OPS = ['move', 'copy', 'extract', 'mkdir', 'rename', 'trash', 'register', 'reparent', 'remerge', 'reanalyze', 'collection_backfill', 'rearchive']
  const row = db
    .prepare(
      `SELECT * FROM journal WHERE undone = 0 AND status = 'done'
         AND op IN (${OPS.map(() => '?').join(', ')})
       ORDER BY id DESC LIMIT 1`
    )
    .get(...OPS) as JournalRow | undefined
  return row ?? null
}

export function markUndone(db: Db, id: number, undoJournalId: number | null, error?: string): void {
  /**
   * 失败时**不许**写 undone=1。
   * 之前失败也标成"已撤销"，结果那一步的正向效果还留在库里，journal 却说自己撤过了 ——
   * 整条撤销链从此在这里断掉，用户按 Ctrl+Z 只会跳到更早的批次，中间那截永远撤不回来
   * （实测：一次外键失败就把两行 reparent 记录钉死，沙盒里 38 条测试记录清不掉）。
   */
  if (error) {
    db.prepare(`UPDATE journal SET status = 'failed', error = ? WHERE id = ?`).run(error, id)
    return
  }
  db.prepare(`UPDATE journal SET undone = 1, undo_of = ?, status = 'done', error = NULL WHERE id = ?`).run(
    undoJournalId,
    id
  )
}

export function journalPayload(row: JournalRow): JournalPayload {
  return JSON.parse(row.payload_json) as JournalPayload
}

export function setJournalStatus(db: Db, id: number, status: JournalRow['status'], error?: string): void {
  db.prepare(`UPDATE journal SET status = ?, error = ? WHERE id = ?`).run(status, error ?? null, id)
}

// ---------------------------------------------------------------- import_log

export function insertImportLog(
  db: Db,
  input: {
    projectId: string
    assetId?: string | null
    batchId?: string | null
    unitypackagePath?: string | null
    kind?: ImportLogRow['kind']
    /** M5-B：容器型导入才有；散装直导留 null（见 ImportLogRow 的注释） */
    containerAssetId?: string | null
    memberRelPath?: string | null
    originArchive?: string | null
    status?: ImportStatus
    message?: string | null
  }
): ImportLogRow {
  const row: ImportLogRow = {
    id: ulid(),
    project_id: input.projectId,
    batch_id: input.batchId ?? null,
    asset_id: input.assetId ?? null,
    unitypackage_path: input.unitypackagePath ?? null,
    container_asset_id: input.containerAssetId ?? null,
    member_rel_path: input.memberRelPath ?? null,
    origin_archive: input.originArchive ?? null,
    created_guids_json: null,
    overwritten_json: null,
    backup_dir: null,
    status: input.status ?? 'queued',
    kind: input.kind ?? 'import',
    message: input.message ?? null,
    started_at: null,
    finished_at: null
  }
  db.prepare(
    `INSERT INTO import_log (id, project_id, batch_id, asset_id, unitypackage_path,
       container_asset_id, member_rel_path, origin_archive,
       created_guids_json, overwritten_json, backup_dir, status, kind, message, started_at, finished_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, ?, ?, ?, NULL, NULL)`
  ).run(
    row.id,
    row.project_id,
    row.batch_id,
    row.asset_id,
    row.unitypackage_path,
    row.container_asset_id,
    row.member_rel_path,
    row.origin_archive,
    row.status,
    row.kind,
    row.message
  )
  return row
}

export function patchImportLog(
  db: Db,
  id: string,
  patch: Partial<
    Pick<
      ImportLogRow,
      'status' | 'message' | 'created_guids_json' | 'overwritten_json' | 'backup_dir' | 'started_at' | 'finished_at'
    >
  >
): ImportLogRow | null {
  type PatchKey = keyof typeof patch
  const keys = Object.keys(patch) as PatchKey[]
  if (keys.length) {
    db.prepare(
      `UPDATE import_log SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`
    ).run(...keys.map((k) => patch[k] as string | number | null), id)
  }
  const row = db.prepare(`SELECT * FROM import_log WHERE id = ?`).get(id) as ImportLogRow | undefined
  return row ?? null
}

export function getImportLog(db: Db, id: string): ImportLogRow | null {
  const row = db.prepare(`SELECT * FROM import_log WHERE id = ?`).get(id) as ImportLogRow | undefined
  return row ?? null
}

export function listImportLogs(db: Db, projectId?: string, limit = 200): ImportLogRow[] {
  return projectId
    ? (db
        .prepare(`SELECT * FROM import_log WHERE project_id = ? ORDER BY id DESC LIMIT ?`)
        .all(projectId, limit) as ImportLogRow[])
    : (db.prepare(`SELECT * FROM import_log ORDER BY id DESC LIMIT ?`).all(limit) as ImportLogRow[])
}

/**
 * 一批的导入记录，**按插入顺序倒序**（最后导成功的先撤）。
 *
 * 为什么排序键是 `rowid` 而不是 `id` 也不是 `finished_at`：
 *  - `id` 是 ULID，**同一毫秒内**后缀是随机的 —— 一批里连着导两个小包就会撞同一毫秒，
 *    实测撤销顺序会飘（用例忽红忽绿，而飘的那个顺序是错的）。
 *  - `finished_at` 是毫秒，同样打平。
 *  - `rowid` 是 SQLite 给普通表自增的整数，插入顺序就是它。`import_log` 的主键是 TEXT，
 *    所以这张表仍然有隐式 rowid（不是 WITHOUT ROWID 表），可以直接拿来排。
 *
 * "正序撤"不是难看而已：同一批里后导入的那个可能覆盖了先导入的那个文件，
 * 正序撤会把后一次覆盖的内容又写回去。
 */
/**
 * 一批里**可以撤销**的导入记录，按"后做的先撤"排（§3.6 的倒序）。
 *
 * 排序键借的是 `journal.id`（INTEGER 自增 = 真实插入顺序），不是 `import_log.id`、
 * 也不是 `finished_at`：
 *  - `import_log.id` 是 ULID，**同一毫秒内后缀是随机的**。一批里连着导两个小包
 *    就在同一毫秒，于是撤销顺序会飘 —— 实测过，用例忽红忽绿就是这么来的。
 *  - `finished_at` 是毫秒，同样打平。
 * 打平之后排错的症状不是难看而已：同一批里后导入的那个可能覆盖了先导入的那个文件，
 * 正序撤会把后一次覆盖的内容又写回去。
 *
 * 只统计有 `import` 记账行、且 `status='ok'` 的那些 —— 失败的导入压根没进工程，
 * 没有可撤的东西，本来就该跳过（不靠调用方自己 filter）。
 */
export function rollbackOrderOfBatch(db: Db, batchId: string): ImportLogRow[] {
  return db
    .prepare(
      `SELECT il.* FROM import_log il
         JOIN journal j ON j.op = 'import'
                      AND json_extract(j.payload_json, '$.importLogId') = il.id
        WHERE il.batch_id = ? AND il.kind = 'import' AND il.status = 'ok'
        ORDER BY j.id DESC`
    )
    .all(batchId) as ImportLogRow[]
}

export function lastImportOfAsset(db: Db, assetId: string): ImportLogRow | null {
  const row = db
    .prepare(
      `SELECT * FROM import_log WHERE asset_id = ? AND status = 'ok' ORDER BY finished_at DESC LIMIT 1`
    )
    .get(assetId) as ImportLogRow | undefined
  return row ?? null
}

// ---------------------------------------------------------------- learning（第 2 份 §5.4）

const SUPPRESS_STEP = 0.5
const LEARN_STEP = 1.0

export function recordCorrection(
  db: Db,
  input: {
    tokens: string[]
    newCategory: string
    newSubcategory: string | null
    oldCategory?: string | null
    oldSubcategory?: string | null
  }
): { touched: number; learnedRules: number } {
  const up = db.prepare(
    `INSERT INTO learning (token, category, subcategory, weight, hits)
     VALUES (?, ?, ?, ?, 1)
     ON CONFLICT(token, category, subcategory)
     DO UPDATE SET weight = weight + excluded.weight, hits = hits + 1`
  )
  const down = db.prepare(
    `UPDATE learning SET weight = MAX(0.1, weight - ?)
     WHERE token = ? AND category = ? AND (subcategory IS ? OR subcategory = ?)`
  )
  let touched = 0
  db.transaction(() => {
    for (const raw of input.tokens) {
      const token = raw.toLowerCase().trim()
      if (!token) continue
      up.run(token, input.newCategory, input.newSubcategory, LEARN_STEP)
      touched++
      if (input.oldCategory) {
        down.run(SUPPRESS_STEP, token, input.oldCategory, input.oldSubcategory, input.oldSubcategory)
      }
    }
  })()
  return { touched, learnedRules: countLearnedRules(db) }
}

export function countLearnedRules(db: Db): number {
  return Number(
    (db.prepare(`SELECT COUNT(*) AS n FROM learning WHERE hits >= 1`).get() as { n: number }).n
  )
}

/** 同一 token 被修正到同一分类 ≥3 次 → UI 提示"已学习 N 条规则" */
export function tokensLearnedHard(db: Db): LearningRow[] {
  return db
    .prepare(`SELECT * FROM learning WHERE hits >= 3 ORDER BY weight DESC LIMIT 50`)
    .all() as LearningRow[]
}

export function learningFor(db: Db, tokens: string[]): LearningRow[] {
  const uniq = Array.from(new Set(tokens.map((t) => t.toLowerCase().trim()).filter(Boolean)))
  if (!uniq.length) return []
  const placeholders = uniq.map(() => '?').join(', ')
  return db
    .prepare(`SELECT * FROM learning WHERE token IN (${placeholders})`)
    .all(...uniq) as LearningRow[]
}

export function listLearning(db: Db, limit = 500): LearningRow[] {
  return db.prepare(`SELECT * FROM learning ORDER BY weight DESC, hits DESC LIMIT ?`).all(limit) as LearningRow[]
}

export function deleteLearning(db: Db, id: number): void {
  db.prepare(`DELETE FROM learning WHERE id = ?`).run(id)
}
