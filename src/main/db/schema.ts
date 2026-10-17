import type { Db } from './index'
import { dirKeyOf } from '../../shared/pathkey'

/**
 * 数据库 schema —— 权威定义来自「第 1 份 §5」。
 * 这里只做两类兼容性改动（已在实现计划里报备）：
 *   1. 新增 asset_group / bundle 两张表（variant.group_id 与 asset.bundle_id 原本无处可指）
 *   2. 给若干表加列：asset.content_type、asset.source_item_id_confidence、
 *      import_log.kind、journal.status/error/batch_id、package_entry.size/has_preview、
 *      project.fingerprint_json
 * 所有加列都是"只增不改不删"，老库可以直接增量迁移。
 * ⚠ 这条在 V9 破了一次例（见文件末尾 V9）：删掉了 `asset.needs_review`。
 *   那是一次**经用户明确要求的整功能移除**，不是随手的破坏性迁移；
 *   除此之外仍然只增不删。
 *
 * V2（2026-10-05 增量改动单 §2.4）：合集改成 asset 自引用三级模型
 *   asset.parent_asset_id / is_bundle / needs_review（needs_review 已在 V9 删除）
 *   —— 从此 **bundle 表和 asset.bundle_id 都废弃了**（改动单 §7.2：不许有平行表）。
 *   表留着不删：删表不可逆，而且里面可能有人数据；只是再没有任何代码往里写。
 *
 * V3（2026-10-05 增量改动单 2 §A2/§B7）：附属资源 + 统一容器
 *   asset.attachment_kind / container_kind / variant_raw，asset_group.cover_image
 *   附属资源仍然是 asset 行（详情页要列、导入时可单独勾），但**不进第一层、不计入素材总数**。
 *   容器只有 container_kind 一个字段区分来源，结构上仍是同一种东西。
 *
 * V4（甲轨③ · #40）：asset_group.dir_key —— **归并必须有目录前提**
 *   用户裁定原文：「归并的前提是同一父容器（同目录），跨目录的 groupKey 相同不构成归并理由」。
 *   以前 ensureGroup 只按 (group_key, category) 找组，于是 `贴图/脸部/4900077` 和
 *   `贴图/lime/4900077` 这种"两个毫不相干的商品恰好同名（纯 Booth id）"会挂进同一组。
 *   真库实测这种组有 13 个 / 27 行。dir_key 记的就是这一组的商品所在目录（小写、正斜杠）。
 *   迁移时只在**组内所有成员目录一致**时回填；不一致的那 13 个留 NULL，
 *   意思是"历史遗留的跨目录归并"，新条目不会再吸附进去（要拆交给健康检查）。
 */

export const SCHEMA_VERSION = 10

const V1 = `
CREATE TABLE IF NOT EXISTS asset (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  raw_name        TEXT NOT NULL,
  category        TEXT NOT NULL,
  subcategory     TEXT,
  confidence      REAL NOT NULL,
  status          TEXT NOT NULL,
  library_path    TEXT,
  source_path     TEXT,
  storage_mode    TEXT NOT NULL,
  kind            TEXT,
  content_type    TEXT,
  size_bytes      INTEGER,
  hash_xxh64      TEXT,
  cover_image     TEXT,
  source_url      TEXT,
  source_platform TEXT,
  source_item_id  TEXT,
  source_item_id_confidence REAL,
  author          TEXT,
  version         TEXT,
  locale_tag      TEXT,
  group_id        TEXT,
  bundle_id       TEXT,
  notes           TEXT,
  created_at      INTEGER,
  updated_at      INTEGER
);
CREATE INDEX IF NOT EXISTS idx_asset_category ON asset(category, subcategory);
CREATE INDEX IF NOT EXISTS idx_asset_status ON asset(status);
CREATE INDEX IF NOT EXISTS idx_asset_group ON asset(group_id);
CREATE INDEX IF NOT EXISTS idx_asset_bundle ON asset(bundle_id);
CREATE INDEX IF NOT EXISTS idx_asset_hash ON asset(hash_xxh64);
CREATE INDEX IF NOT EXISTS idx_asset_name ON asset(name);
CREATE INDEX IF NOT EXISTS idx_asset_updated ON asset(updated_at DESC);

CREATE TABLE IF NOT EXISTS asset_group (
  id          TEXT PRIMARY KEY,
  group_key   TEXT NOT NULL,
  name        TEXT NOT NULL,
  category    TEXT NOT NULL,
  subcategory TEXT,
  created_at  INTEGER,
  updated_at  INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_group_key_cat ON asset_group(group_key, category);

CREATE TABLE IF NOT EXISTS bundle (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  source_path TEXT,
  cover_image TEXT,
  asset_count INTEGER DEFAULT 0,
  created_at  INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_bundle_source ON bundle(source_path);

CREATE TABLE IF NOT EXISTS variant (
  id            TEXT PRIMARY KEY,
  group_id      TEXT NOT NULL,
  asset_id      TEXT NOT NULL,
  variant_kind  TEXT NOT NULL,
  variant_value TEXT NOT NULL,
  UNIQUE(group_id, variant_kind, variant_value)
);
CREATE INDEX IF NOT EXISTS idx_variant_group ON variant(group_id);
CREATE INDEX IF NOT EXISTS idx_variant_value ON variant(variant_value);
CREATE INDEX IF NOT EXISTS idx_variant_asset ON variant(asset_id);

CREATE TABLE IF NOT EXISTS tag (
  id    TEXT PRIMARY KEY,
  name  TEXT NOT NULL UNIQUE,
  color TEXT,
  kind  TEXT
);

CREATE TABLE IF NOT EXISTS asset_tag (
  asset_id TEXT NOT NULL,
  tag_id   TEXT NOT NULL,
  source   TEXT,
  PRIMARY KEY(asset_id, tag_id)
);
CREATE INDEX IF NOT EXISTS idx_asset_tag_tag ON asset_tag(tag_id);

CREATE TABLE IF NOT EXISTS collection (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  icon       TEXT,
  sort_order INTEGER DEFAULT 0,
  rule_json  TEXT,
  is_auto    INTEGER DEFAULT 0,
  priority   INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS collection_asset (
  collection_id TEXT NOT NULL,
  asset_id      TEXT NOT NULL,
  added_at      INTEGER,
  PRIMARY KEY(collection_id, asset_id)
);
CREATE INDEX IF NOT EXISTS idx_ca_asset ON collection_asset(asset_id);

CREATE TABLE IF NOT EXISTS package_entry (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  asset_id    TEXT NOT NULL,
  guid        TEXT NOT NULL,
  unity_path  TEXT NOT NULL,
  entry_kind  TEXT,
  size        INTEGER,
  has_preview INTEGER
);
CREATE INDEX IF NOT EXISTS idx_pkg_guid ON package_entry(guid);
CREATE INDEX IF NOT EXISTS idx_pkg_asset ON package_entry(asset_id);

CREATE TABLE IF NOT EXISTS dependency (
  asset_id    TEXT NOT NULL,
  dep_guid    TEXT NOT NULL,
  dep_kind    TEXT,
  resolved_by TEXT,
  PRIMARY KEY(asset_id, dep_guid)
);
CREATE INDEX IF NOT EXISTS idx_dep_guid ON dependency(dep_guid);

CREATE TABLE IF NOT EXISTS project (
  id               TEXT PRIMARY KEY,
  path             TEXT NOT NULL UNIQUE,
  name             TEXT NOT NULL,
  unity_version    TEXT,
  last_seen        INTEGER,
  is_running       INTEGER DEFAULT 0,
  guid_index_at    INTEGER,
  bridge_version   TEXT,
  fingerprint_json TEXT
);

CREATE TABLE IF NOT EXISTS import_log (
  id                  TEXT PRIMARY KEY,
  project_id          TEXT NOT NULL,
  batch_id            TEXT,
  asset_id            TEXT,
  unitypackage_path   TEXT,
  created_guids_json  TEXT,
  overwritten_json    TEXT,
  backup_dir          TEXT,
  status              TEXT,
  kind                TEXT DEFAULT 'import',
  message             TEXT,
  started_at          INTEGER,
  finished_at         INTEGER
);
CREATE INDEX IF NOT EXISTS idx_importlog_project ON import_log(project_id, status);
CREATE INDEX IF NOT EXISTS idx_importlog_batch ON import_log(batch_id);

CREATE TABLE IF NOT EXISTS journal (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  op           TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  undo_of      INTEGER,
  undone       INTEGER DEFAULT 0,
  status       TEXT DEFAULT 'done',
  error        TEXT,
  batch_id     TEXT,
  created_at   INTEGER
);
CREATE INDEX IF NOT EXISTS idx_journal_created ON journal(created_at DESC);

CREATE TABLE IF NOT EXISTS learning (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  token       TEXT NOT NULL,
  category    TEXT NOT NULL,
  subcategory TEXT,
  weight      REAL NOT NULL DEFAULT 1.0,
  hits        INTEGER DEFAULT 0,
  UNIQUE(token, category, subcategory)
);
CREATE INDEX IF NOT EXISTS idx_learning_token ON learning(token);

CREATE TABLE IF NOT EXISTS password_vault (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  hint         TEXT,
  password_enc BLOB,
  platform     TEXT,
  item_id      TEXT,
  author       TEXT
);

CREATE TABLE IF NOT EXISTS setting (
  key        TEXT PRIMARY KEY,
  value_json TEXT
);

CREATE TABLE IF NOT EXISTS search_alias (
  asset_id TEXT NOT NULL,
  field    TEXT NOT NULL,
  alias    TEXT NOT NULL,
  PRIMARY KEY(asset_id, field, alias)
);
CREATE INDEX IF NOT EXISTS idx_alias ON search_alias(alias);
`

/**
 * V4 的回填（见下面 MIGRATIONS[4].post 的注释）。
 * 目录归一化用 dirKeyOf()，和入库时写 dir_key 的是同一个函数 ——
 * 两边各写一遍就漂了，#40 修的正是"同不同目录"这件事。
 */
export function backfillGroupDir(db: Db): number {
  const rows = db
    .prepare(
      `select group_id as gid, coalesce(library_path, source_path) as p
         from asset
        where group_id is not null`
    )
    .all() as Array<{ gid: string; p: string | null }>
  const dirs = new Map<string, Set<string>>()
  for (const r of rows) {
    const d = dirKeyOf(r.p)
    if (!d) continue
    let set = dirs.get(r.gid)
    if (!set) dirs.set(r.gid, (set = new Set()))
    set.add(d)
  }
  const stmt = db.prepare(`update asset_group set dir_key = ? where id = ?`)
  let written = 0
  for (const [gid, set] of dirs) {
    if (set.size !== 1) continue
    stmt.run([...set][0], gid)
    written++
  }
  return written
}

/** 一次增量迁移。post = 纯 SQL 做不了的那部分（回填要按路径算 dirname） */
export interface Migration {
  version: number
  sql: string
  post?: (db: Db) => void
}

/** 每个元素 = 一次增量迁移；数组下标 = 迁移前的 user_version */
export const MIGRATIONS: Migration[] = [
  { version: 1, sql: V1 },
  {
    version: 2,
    sql: `
-- 三级模型：合集(Bundle) ─ 子项(Item) ─ 版本(Variant)，全部落在 asset 一张表里
ALTER TABLE asset ADD COLUMN parent_asset_id TEXT REFERENCES asset(id);
ALTER TABLE asset ADD COLUMN is_bundle INTEGER NOT NULL DEFAULT 0;
-- 一键入库时置信度不够的标 1：入库不再被低置信度挡住，但要能事后捞回来
ALTER TABLE asset ADD COLUMN needs_review INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_asset_parent ON asset(parent_asset_id);
CREATE INDEX IF NOT EXISTS idx_asset_review ON asset(needs_review) WHERE needs_review = 1;
CREATE INDEX IF NOT EXISTS idx_asset_bundle_flag ON asset(is_bundle);
`
  },
  {
    version: 3,
    sql: `
-- 增量改动单 2：附属资源 + 统一容器
-- attachment_kind 非空 = 这一行是附属资源（介绍图/演示视频/说明文档/.url/源文件/音频）。
-- 附属资源**不进库的第一层、不计入素材总数、不参与合集判定**（§A2 核心规则），
-- 但它仍然是 asset 表里的一行 —— 详情页要列出来，导入 Unity 时可以被单独勾选。
ALTER TABLE asset ADD COLUMN attachment_kind TEXT;
-- is_bundle=1 的容器分两种来源，UI 上文案不同（§B7）：
--   collection = 合集型（一个筐里装着好几个不同产品）→ "合集 · 含 N 项"
--   merged     = 归并型（同一个产品的多个变体）      → "N 个模型变体"
-- 两种共用同一套容器卡 + 同一套进入式浏览，**不许做成两套结构**（§B7 / 不要做的事 #5）。
ALTER TABLE asset ADD COLUMN container_kind TEXT;
-- §B2：方括号变体槽位的原文，界面上要能回答"为什么这 20 个被并成一张卡"
ALTER TABLE asset ADD COLUMN variant_raw TEXT;
-- 改动单 1 §2.4 里批准过、V2 漏掉的那一列：合集/归并组的封面
ALTER TABLE asset_group ADD COLUMN cover_image TEXT;
CREATE INDEX IF NOT EXISTS idx_asset_attachment ON asset(attachment_kind) WHERE attachment_kind IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_asset_container_kind ON asset(container_kind);
`
  },
  {
    version: 4,
    sql: `
-- #40：归并组的目录归属。dir_key = 组内商品所在目录（小写、正斜杠、无尾斜杠）。
ALTER TABLE asset_group ADD COLUMN dir_key TEXT;
-- 老库这里可能已经有同名的旧索引（V1 建的 UNIQUE(group_key, category)），
-- 加列之前先按老口径把唯一性放宽成"同目录才唯一"，否则第二个同 key 不同目录的组插不进去。
DROP INDEX IF EXISTS idx_group_key_cat;
CREATE UNIQUE INDEX IF NOT EXISTS idx_group_key_cat_dir ON asset_group(group_key, category, dir_key);
`,
    /**
     * 回填交给 JS 而不是 SQL：dirname 在 SQLite 里没有现成函数，
     * 硬写递归 CTE 按字符扫路径既难读又难测。这里就 122 个组，一次性扫完。
     *
     * 只在"组内所有成员目录一致"时写值。不一致的那些（真库实测 13 组 / 27 行）
     * 是 #40 已经造成的跨目录归并，留 NULL = 标记为"历史组，不再吸附新成员"，
     * 而不是假装它们不存在 —— 拆开的动作留给健康检查，那一步要能撤销，不该塞进迁移。
     */
    post: backfillGroupDir
  },
  {
    version: 5,
    sql: `
-- M5-B：压缩包型容器的成员也要能记账、能反查。
-- 为什么非得加列（设计文档 §3.8）：现有 import_log 只有 unitypackage_path，
-- 而那一列对成员来说是**临时抽取目录里的路径**，导入完就被删 ——
-- 事后既查不出"这次导的是容器里第几个包"，也没法反查"这个素材在哪些工程装过"。
-- 这类"当时知道、过后算不出来"的事实只能落列；库里没有 child_count/unit_count 那种
-- 查询时算的字段可以借用（它们本来就是查询时算的，历史事实不是）。
ALTER TABLE import_log ADD COLUMN container_asset_id TEXT;
ALTER TABLE import_log ADD COLUMN member_rel_path TEXT;
ALTER TABLE import_log ADD COLUMN origin_archive TEXT;
-- 反查按容器走（"这张卡在这个工程装过吗"），散装导入的那批 NULL 不进索引
CREATE INDEX IF NOT EXISTS idx_import_log_container
  ON import_log(container_asset_id) WHERE container_asset_id IS NOT NULL;
`,
    /**
     * **不回填，所以这一版没有 `post`**（V4 有，对照看）：
     * 老行的这三列 NULL，语义就是"散装包直导，本来就没有容器"。
     * 猜一个值（比如从 unitypackage_path 反推）会把"猜"写成事实，
     * 后面撤销和反查都会拿它当真凭据 —— 宁可空着。
     */
  },
  {
    version: 6,
    sql: `
-- M6 ③：自动切换集合的冷却（第 3 份 §4.3 防打扰规则「同一工程 5 分钟内只自动切换一次」）。
-- 为什么必须落库而不是放内存：这个时间戳是"上次**真的切了**"的时刻，
-- 不落库的症状是每次重启 A 都会立刻再弹一次横幅 —— 而重启 A 是常态（改代码、崩了、开机自启）。
-- 同样**不回填**：NULL = 从没自动切过，第一次检测到 Unity 启动就该切。
ALTER TABLE project ADD COLUMN last_auto_switch_at INTEGER;
`
  },
  {
    version: 7,
    sql: `
CREATE TABLE asset_cover (
  asset_id TEXT PRIMARY KEY REFERENCES asset(id) ON DELETE CASCADE,
  cover_image TEXT NOT NULL,
  previous_image TEXT,
  source TEXT NOT NULL CHECK(source IN ('unity', 'image')),
  project_id TEXT,
  target_json TEXT,
  options_json TEXT,
  updated_at INTEGER NOT NULL
);
`
  },
  {
    version: 8,
    sql: `
CREATE TABLE asset_cover_package_upgrade (
  asset_id TEXT PRIMARY KEY REFERENCES asset(id) ON DELETE CASCADE,
  cover_image TEXT NOT NULL,
  previous_image TEXT,
  source TEXT NOT NULL CHECK(source IN ('unity', 'image', 'package')),
  project_id TEXT,
  target_json TEXT,
  options_json TEXT,
  updated_at INTEGER NOT NULL
);
INSERT INTO asset_cover_package_upgrade SELECT * FROM asset_cover;
DROP TABLE asset_cover;
ALTER TABLE asset_cover_package_upgrade RENAME TO asset_cover;
`
  },
  {
    version: 9,
    sql: `
CREATE TABLE IF NOT EXISTS cover_task_backup (
  task_id TEXT NOT NULL,
  asset_id TEXT NOT NULL REFERENCES asset(id) ON DELETE CASCADE,
  before_json TEXT NOT NULL,
  applied_json TEXT,
  undone INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  PRIMARY KEY(task_id, asset_id)
);
CREATE INDEX IF NOT EXISTS idx_cover_task_backup_created ON cover_task_backup(created_at DESC);
`
  },
  {
    /**
     * ⚠ **编号是 10，不是 9**：合并 main 时撞过号 ——
     * main 的 V9 是「封面批量更新」的 `cover_task_backup` 表（已发布），
     * 我这一版删列原本也写成 9，两边都要 9。
     * 已发布的迁移号**绝不能改**（老库按号判断跑没跑过），所以让路的只能是我这条。
     */
    version: 10,
    sql: `
-- 2026-10-15：**「待复核」整个功能移除**（用户要求，理由是它臃肿、拖慢工作流）。
-- V2 引入的这一列 + 部分索引在这里一起删干净，不留"没人读但还在写"的死列。
--
-- 为什么是"删"而不是"留着不用"：这一列本身无害，但它会一直诱使后来的人以为
-- "还有个待复核状态可以接"；而界面上的三个出口（侧栏计数、单卡按钮、合集批量）
-- 已经全部拆掉了，留着列等于给一个不存在的功能留后门。
--
-- 为什么删列是安全的（查过，不是想当然）：
--  1. 没有任何外键或视图引用它；
--  2. 撤销（journal）里老记录的 restore.row 虽然带着 needs_review 键，
--     但 upsertAsset 是**按固定列清单取值**的（ASSET_COLUMNS 逐列取 row[c]），
--     对象上多余的键被忽略 —— 老撤销记录照常能塞回去，不会报"没有这一列"；
--  3. 老侧车 .avca.json 里同样可能带这个字段，assetFromSidecar 也是显式构造行，
--     多出来的字段被自然丢掉。
--
-- 顺序要紧：部分索引 idx_asset_review 建在 needs_review 上，
-- 不先删索引，DROP COLUMN 会被 SQLite 拒掉。
DROP INDEX IF EXISTS idx_asset_review;
`,
    /**
     * 删列必须走 `post`，不能写成纯 SQL。
     *
     * SQLite 没有 `DROP COLUMN IF EXISTS`，而迁移是**能被重放的** ——
     * `tests/covers/package-service.spec.ts` 就有一条用例把 `user_version` 手工退回 7
     * 再跑一遍迁移，那时列已经被上一次删掉了。纯 SQL 会抛
     * `no such column: needs_review`，把整个迁移事务炸掉；
     * 而迁移一炸用户就打不开软件。所以先查列在不在。
     *
     * （这条不是凭想象加的：那个用例在我第一版纯 SQL 的写法下就是红的。）
     */
    post: (db) => {
      const cols = db.prepare('PRAGMA table_info(asset)').all() as Array<{ name: string }>
      if (cols.some((c) => c.name === 'needs_review')) db.exec('ALTER TABLE asset DROP COLUMN needs_review')
    }
  }
]
