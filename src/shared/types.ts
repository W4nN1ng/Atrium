/**
 * 全套共享类型。
 * 数据库行的权威定义来自「第 1 份 §5」；本文件在其之上加了 4 处扩表/加列
 * （实现计划 C.6 已征得同意）：asset_group / bundle 两张表、import_log.kind 列、
 * asset.content_type 列（用于区分「内容类型」与「归档分类」，见 C.1 的裁定）。
 */

// ---------------------------------------------------------------- 基础枚举

export type LocaleKey = 'zh-CN' | 'en' | 'ja'

export type AssetStatus = 'inbox' | 'classified' | 'pending_confirm' | 'archived'

export type StorageMode = 'archived' | 'indexed'

/** 归档用的 kind（第 1 份 §5 asset.kind） */
export type AssetKind =
  | 'unitypackage'
  | 'folder'
  | 'archive'
  | 'loose_files'
  | 'image'
  | 'doc'
  | 'exe'
  /** 下面三种是附属资源专用的（增量改动单 2 §A2）：演示视频 / 音频 / psd 等工程源文件 */
  | 'video'
  | 'audio'
  | 'source'

/** 硬规则判出的"内容是什么"，与归档分类互相独立（第 2 份 §1.1） */
export type ContentType =
  | 'unity_project'
  | 'unity_upm_package'
  | 'shader'
  | 'model'
  | 'animation'
  | 'audio'
  | 'texture'
  | 'material'
  | 'tool'
  | 'reference'
  | 'bundle'
  | 'unknown'

export type VariantKind = 'avatar' | 'install_method' | 'version' | 'locale' | 'quest' | 'other'

/**
 * 一个变体维度（R4 ⑤）。`kind` 用 string 而不是 `VariantKind`：
 * 词典里的 dim 可以长（`install_method`、`quest`… 都是数据不是枚举），
 * 写死成枚举会让新维度在界面上直接消失 —— 那种"数据有、界面吞掉"最难查。
 */
export interface VariantDim {
  kind: string
  values: string[]
}

export type TagKind = 'topic' | 'avatar' | 'style' | 'locale' | 'user'

export type SourcePlatform = 'booth' | 'github' | 'gumroad' | 'afdian' | 'other' | null

export type ImportStatus = 'queued' | 'running' | 'ok' | 'failed' | 'cancelled' | 'rolledback' | 'rollbackpartial'

export type EntryKind =
  | 'prefab'
  | 'fbx'
  | 'mat'
  | 'shader'
  | 'anim'
  | 'controller'
  | 'cs'
  | 'png'
  | 'so'
  | 'unity'
  | 'other'

/** journal 记录的操作类型（第 1 份 §5 + 桥接安装/撤销） */
export type JournalOp =
  | 'move'
  | 'copy'
  | 'extract'
  | 'mkdir'
  | 'import'
  | 'delete_backup'
  | 'rename'
  | 'trash'
  | 'bridge_install'
  | 'bridge_uninstall'
  | 'import_rollback'
  /** 三级模型里改挂父级（从合集中拆出 / 解散合集 / 重新整理合集），纯库操作 */
  | 'reparent'
  /**
   * 第 9 轮 ② · B4「存量重并」：按**现在的**归并键规则把老行重新归组。
   *
   * 和 `reparent` 的区别是它改的是 `asset.group_id` + `asset_group` 行本身（合并组、删空组），
   * 而 `reparent` 只管 `parent_asset_id`。也是纯库操作 —— **一个文件都不搬**，
   * 撤销要能把删掉的组和变体行原样塞回来，所以单独开一个 op，不蹭 `reparent` 的账。
   */
  | 'remerge'
  /**
   * M6 ④：「按库里出现过的模型补建集合」。
   * 纯库操作（一个文件都不碰），但**必须能撤销** —— 它是批量写用户数据，
   * 用户看完预览点了确认也可能立刻后悔。撤销 = 删掉本次新建的那几个 collection 行。
   */
  | 'collection_backfill'
  /**
   * 只写库记录、一个文件都不动的"登记"（收编旧库 / 合集 / 索引模式）。
   * 别以为它不需要进 journal —— 一键全部入库 228 项全靠这一条才能 Ctrl+Z 整批撤回收件箱。
   */
  | 'register'
  /**
   * 「重新分析」（改动单 2 §交付 4）：改完归并/命名规则后把已入库的行重算一遍。
   * 纯库操作、只读重算，一个文件都不碰，但必须能撤销 ——
   * 用户按下之前得先看到"会影响多少条"，按下之后不满意要能退回来。
   */
  | 'reanalyze'
  /**
   * R4 ③「改分类搬文件」：改分类的同时把磁盘上的目录搬到新分类该在的位置。
   *
   * 为什么单独一个 op 而不是复用 `move` + `mkdir`：那两条的撤销只管**文件**，
   * 而这件事还改了 `library_path` / `source_path` / `cover_image` 和一串附属/子项的路径 ——
   * 文件搬回去了、库里还指着新位置，比不搬更糟（表现为"素材全都丢失"）。
   * 所以撤销必须一次做完两半，路径旧值逐条存在 payload 里。
   */
  | 'rearchive'

/**
 * R4 ③「改分类搬文件」的预览与结果。
 *
 * 契约放在 shared（界面与主进程共用），实现见 `src/main/library/rearchive.ts`。
 * `willMove=false` 时 `reasonKey` 一定有值 —— 界面上必须说清"为什么没搬"，
 * 否则症状就是"我明明改了分类，文件夹怎么还在原地"。
 */
export interface RearchiveMove {
  from: string
  to: string
  /** 搬之前 `to` 这个位置已经有东西（执行时会加 `(2)` 之类的后缀避开） */
  taken: boolean
  isDirectory: boolean
  bytes: number
  fileCount: number
}

export interface RearchiveRewrite {
  assetId: string
  field: 'library_path' | 'source_path' | 'cover_image'
  from: string
  to: string
}

export interface RearchivePlan {
  ok: true
  assetId: string
  category: string
  subcategory: string | null
  /** 现在在哪（目录；单文件素材就是它自己） */
  fromDir: string | null
  /** 要搬到哪（已经避过名） */
  toDir: string | null
  moves: RearchiveMove[]
  rewrites: RearchiveRewrite[]
  fileCount: number
  bytes: number
  /** false = 这次只改记录 */
  willMove: boolean
  reasonKey: string | null
  reasonParams: Record<string, unknown> | null
  batchId: string
}

export interface RearchiveFailure {
  ok: false
  reasonKey: string
  reasonParams?: Record<string, unknown>
}

export type RearchiveOutcome = RearchivePlan | RearchiveFailure

export interface RearchiveResult {
  ok: boolean
  batchId: string
  journalId: number
  moved: number
  rewrites: number
  /** 只改了记录没碰盘（索引模式 / 本来就在对的地方 / 不该搬） */
  dbOnly: boolean
  /**
   * `dbOnly` 为真时**必须有**：界面要靠它说清"为什么没搬"，
   * 不能让玩家以为文件已经到位了。搬成功是 null。
   */
  reasonKey: string | null
  reasonParams: Record<string, unknown> | null
  error: string | null
  /**
   * 改分类顺带学到的东西（M3-7 的 learning 表）。
   * 只有**成功**那条路上才有：失败/stale 返回的是 `RearchiveFailure`，没有这一项。
   */
  learned?: LearnedCorrection
}

/**
 * 用户修正分类之后回给界面的结构化数据（第 2 份 §5.4）。
 *
 * ⚠ 这里**不放中文句子**：hint 只带"学到几条 / 哪条线索"，
 * 句子由渲染进程拼 —— 否则切英文/日文时界面会夹生中文。
 */
export interface LearnedCorrection {
  learnedTokens: number
  /** 够门槛（hits ≥ 3）才回；不够就是 null，界面就不提示 */
  hint: { rules: number; token: string; category: string; subcategory: string | null } | null
}

// ---------------------------------------------------------------- 数据库行

export interface AssetRow {
  id: string
  name: string
  raw_name: string
  category: string
  subcategory: string | null
  confidence: number
  status: AssetStatus
  library_path: string | null
  source_path: string | null
  storage_mode: StorageMode
  kind: AssetKind | null
  content_type: ContentType | null
  size_bytes: number | null
  hash_xxh64: string | null
  cover_image: string | null
  source_url: string | null
  source_platform: Exclude<SourcePlatform, null> | null
  source_item_id: string | null
  /** 1.0 = 已确认真实；0.4 = 疑似（纯数字目录名推断），UI 上要标"疑似 [确认]" */
  source_item_id_confidence: number | null
  author: string | null
  version: string | null
  locale_tag: string | null
  group_id: string | null
  /** @deprecated 合集改用 asset.parent_asset_id / is_bundle（改动单 §2.4），这列只留作历史数据 */
  bundle_id: string | null
  /** 所属合集的 asset.id；顶层素材为 null（改动单 §2.4 三级模型） */
  parent_asset_id: string | null
  /** 1 = 这一行是合集容器本身，不是一件素材 */
  is_bundle: number
  /**
   * 非空 = 这一行是**附属资源**（增量改动单 2 §A2）：介绍图 / 演示视频 / 说明文档 /
   * `.url` 链接 / psd 等源文件 / 音频。
   * 附属资源不进库的第一层、不计入素材总数、不参与合集判定，但详情页要列出来，
   * 导入 Unity 时可以被单独勾选（默认不勾）。
   */
  attachment_kind: AttachmentKind | null
  /**
   * is_bundle=1 的容器分两种来源（§B7），只是卡片上那行字不同，结构完全一样：
   * `collection` = 合集型（一个筐里装着几个不同产品）；`merged` = 归并型（同一产品的多个变体）。
   */
  container_kind: ContainerKind | null
  /** §B2 方括号变体槽位的原文，回答"为什么这几个被并成一张卡" */
  variant_raw: string | null
  notes: string | null
  created_at: number
  updated_at: number
}

/** 附属资源的六个区（增量改动单 2 §A2 的表） */
export type AttachmentKind = 'image' | 'video' | 'doc' | 'link' | 'source' | 'audio'
/** 容器来源：合集型 / 归并型（§B7：两种共用同一套结构） */
export type ContainerKind = 'collection' | 'merged'

export interface VariantRow {
  id: string
  group_id: string
  asset_id: string
  variant_kind: VariantKind
  variant_value: string
}

export interface AssetGroupRow {
  id: string
  group_key: string
  name: string
  category: string
  subcategory: string | null
  created_at: number
  updated_at: number
  /**
   * #40：这一组的商品所在目录（小写、正斜杠、无尾斜杠）。
   * NULL = V4 迁移留下的"历史上跨目录误并"，不再吸附新成员。
   */
  dir_key?: string | null
}

export interface BundleRow {
  id: string
  name: string
  source_path: string | null
  cover_image: string | null
  asset_count: number
  created_at: number
}

export interface TagRow {
  id: string
  name: string
  color: string | null
  kind: TagKind | null
}

export interface AssetTagRow {
  asset_id: string
  tag_id: string
  /** auto | learned | user */
  source: string
}

export interface CollectionRow {
  id: string
  name: string
  icon: string | null
  sort_order: number
  /** { keywords:[], matchMode:'any'|'all', priority, projectPaths:[] } */
  rule_json: string | null
  is_auto: number
  /** 自动切换集合时的优先级（第 3 份 §4.3 步骤 2） */
  priority: number
}

/**
 * 集合的匹配规则（存在 `collection.rule_json` 里，一份 JSON）。
 *
 * ⚠ 原来定义在 `src/main/db/repos/meta.ts`，2026-10-06 挪到共享层：
 * M6 的工程指纹匹配（`shared/projectMatch.ts`）要读它，而 shared 不许 import main。
 * 定义放两处就会漂（M5-3 为同类问题犯过两次），所以整份搬过来，meta.ts 改 import。
 */
export interface CollectionRule {
  keywords?: string[]
  matchMode?: 'any' | 'all'
  priority?: number
  /** 第 3 份 §4.3 步骤 3 的"以后都这样"：精确路径匹配优先级最高 */
  projectPaths?: string[]
  tagNames?: string[]
  categories?: string[]
}

export interface CollectionAssetRow {  collection_id: string
  asset_id: string
  added_at: number
}

export interface PackageEntryRow {
  id?: number
  asset_id: string
  guid: string
  unity_path: string
  entry_kind: EntryKind | null
  size: number | null
  has_preview: number | null
}

export interface DependencyRow {
  asset_id: string
  dep_guid: string
  dep_kind: 'internal' | 'external'
  resolved_by: string | null
}

export interface ProjectRow {
  id: string
  path: string
  name: string
  unity_version: string | null
  last_seen: number | null
  is_running: number
  guid_index_at: number | null
  bridge_version: string | null
  /** §4.3 工程指纹缓存：{ topFolders, installedPackages, avatarDescriptors, guidCount } */
  fingerprint_json: string | null
  /** M6 ③（V6）：上次**真的自动切换**的时刻。NULL = 从没切过。skip 不写（见 §4.3 冷却那条） */
  last_auto_switch_at: number | null
}

/**
 * M6 ④ · 补建集合的数据形状。
 * 放在这里而不是 `modelCollections.ts`：这是 IPC 契约（预览结果要过进程边界），
 * 而那个文件还 import 了 normalize —— 契约不该拖着实现走。
 */
export interface ModelRow {
  value: string
  count: number
}

export interface ModelCandidate {
  /** 显示名（库里出现最多的那种写法） */
  name: string
  /** 归一化键 */
  key: string
  /** 塞进 `rule_json.keywords` 的那一串 */
  keywords: string[]
  /** 库里有多少条素材带这个模型 */
  count: number
}

export interface SkippedModel {
  value: string
  key: string
  /** `generic` = 不是模型名（UNIVERSAL 这类）；`tooShort` = 短到不能当匹配依据；`exists` = 已经建过了 */
  why: 'generic' | 'tooShort' | 'exists'
}

/**
 * M6 ④ · 补建集合的 IPC 契约（预览 / 写库两步，两边共用一份，别各写各的）。
 * 算法在 `shared/modelCollections.ts`，主进程只是把库里的值喂进去。
 */
export interface ModelBackfillPlan {
  candidates: ModelCandidate[]
  skipped: SkippedModel[]
  covered: number
  existing: string[]
}

export interface ModelBackfillResult {
  created: CollectionRow[]
  /** 不在预览清单里的名字（主进程重算 plan 取交集后忽略掉的） */
  ignored: string[]
  /** 撤销凭据；-1 = 一个都没建，没写 journal */
  journalId: number
}

/**
 * M6 ③ · 主进程广播给界面的"这个工程刚被检测到打开了，我决定了什么"。
 *
 * ⚠ 界面**不自己判断该不该切**（那是 `shared/projectMatch.ts` + `decideAutoSwitch()` 的活），
 * 这里只带结论。`action==='skip'` 也要发 —— 平手时那句「有 N 个集合同时命中」得有人画
 * （Q1 的"留痕"要求）。
 */
export interface AutoSwitchEvent {
  projectId: string
  projectPath: string
  projectName: string
  action: 'switch' | 'wake-only' | 'skip'
  /** `switched` / `never` / `cooldown` / `none` / `ambiguous` / `no-match-always` */
  reason: string
  collectionId: string | null
  collectionName: string | null
  /** 平手时的候选集合名（留痕用；不平手时是空数组） */
  candidates: string[]
  at: number
}

/**
 * R4 ⑦ · 「第一次发现这个工程」的边沿事件（`project:first-seen`）。
 *
 * ⚠ `decision` 已经是主进程用 `shared/bridgeAsk.ts` 算好的结论，
 * 界面**不许再判一次**（两边各判必漂 —— 这条在 M5-3/M6 各犯过一次）。
 * `quiet` 不会发这条事件（发了也没事可做）。
 */
export interface BridgeFirstSeenEvent {
  projectId: string
  projectPath: string
  name: string
  decision: 'ask' | 'auto'
  /** 这个工程是从 ALCOM 清单来的还是扫盘扫到的；"发现它在运行"那个时机不带这个 */
  detected?: 'vcc' | 'scan'
}

export interface ImportLogRow {
  id: string
  project_id: string
  batch_id: string | null
  asset_id: string | null
  unitypackage_path: string | null
  created_guids_json: string | null
  overwritten_json: string | null
  backup_dir: string | null
  status: ImportStatus
  /** 扩列：区分 import / bridge_install（第 3 份 §1.3 要求记录安装动作但原表没有该列） */
  kind: 'import' | 'bridge_install' | 'bridge_uninstall'
  /**
   * M5-B（V5）：这三列是把"从哪个容器的哪个成员导进来的"钉成历史事实。
   * `unitypackage_path` 对压缩包成员来说是**临时抽取目录里的路径**，导完就删，
   * 事后靠它什么都问不出来 —— 所以容器归属必须单独记。
   * 散装直导：三列都 NULL（V5 明确不回填，猜一个值就是把猜测写成事实）。
   */
  container_asset_id: string | null
  member_rel_path: string | null
  origin_archive: string | null
  message: string | null
  started_at: number | null
  finished_at: number | null
}

export interface JournalRow {
  id: number
  op: JournalOp
  payload_json: string
  undo_of: number | null
  undone: number
  status: 'pending' | 'done' | 'failed'
  error: string | null
  batch_id: string | null
  created_at: number
}

export interface ImportHistoryItem {
  id: string
  name: string
  status: ImportStatus
  created: number
  overwritten: number
  hasBackup: boolean
  message: string | null
  canRollback: boolean
}

export interface ImportHistoryGroup {
  key: string
  batchId: string | null
  projectId: string
  projectName: string
  projectPath: string | null
  at: number | null
  items: ImportHistoryItem[]
  rollbackBlockKey: string | null
}

export interface ImportHistoryQuery {
  projectId?: string | null
  offset?: number
  limit?: number
}

export interface ImportHistoryPage {
  groups: ImportHistoryGroup[]
  total: number
  offset: number
}

export interface LearningRow {
  id: number
  token: string
  category: string
  subcategory: string | null
  weight: number
  hits: number
}

export interface PasswordVaultRow {
  id: number
  hint: string | null
  password_enc: Uint8Array
  platform: string | null
  item_id: string | null
  author: string | null
}

export interface SettingRow {
  key: string
  value_json: string
}

// ---------------------------------------------------------------- 分类表配置（外置 JSON）

export type LocalizedString = Partial<Record<LocaleKey, string>> & { 'zh-CN': string }

/**
 * 口语同义词（R4 ④）。**扁平一组词、不按语言分三份** ——
 * `shared/normalize.ts:searchForms` 会把每个词展开成"原文 + 拼音 + 罗马字 + 假名"全套写法，
 * 所以写一条 `衣服` 就同时能被 `yifu` / `衣服` 命中；分三份只是把同一件事做三遍。
 *
 * 为什么不放在检索层硬编码：`docs/SEARCH.md` §4 那条结论 —— 它是**这张分类表的元数据**，
 * 放检索层的话设置页看不见也改不了，而且分类能被增删、词表会变孤儿。
 *
 * ⚠ 单字词会被 `aliases.ts:pushUnique` 丢掉（命中面太宽），所以别写「刀」「角」这种。
 */
export interface SubcategoryDef {
  key: string
  label: LocalizedString
  /** 主题标签映射（第 2 份 §5.3 Step 6） */
  topicTags?: string[]
  synonyms?: string[]
}

export interface CategoryDef {
  key: string
  label: LocalizedString
  order: number
  subcategories: SubcategoryDef[]
  synonyms?: string[]
}

export interface CategoryConfig {
  version: number
  categories: CategoryDef[]
}

// ---------------------------------------------------------------- 第 1/2 份接口契约

export interface FileEntry {
  relPath: string
  size: number
  ext: string
  isDir: boolean
}

export interface ExtractedMetadata {
  urls: string[]
  boothItemId: string | null
  boothItemIdConfidence: number
  sourcePlatform: SourcePlatform
  version: string | null
  localeTag: string | null
  author: string | null
  readmeText: string
  previewImages: string[]
}

export interface IngestResult {
  assetId: string
  rawName: string
  /** 原始路径的每一层目录名（第 2 份 §1.2 语料权重 2.5） */
  sourceDirChain: string[]
  stagingPath: string
  sourceArchivePath?: string
  detectedKind: AssetKind
  detectedFormat: string
  entries: FileEntry[]
  metadata: ExtractedMetadata
  /** 解压过程中真实遇到过的密码（用于存密码库） */
  usedPassword?: string
  nestedDepth: number
  totalBytes: number
  warnings: string[]
}

export interface PackageEntry {
  guid: string
  unityPath: string
  entryKind: EntryKind
  size: number
  hasPreview: boolean
}

export interface PackageParseResult {
  ok: boolean
  error?: string
  entries: PackageEntry[]
  tree: string
  guidSet: Set<string>
  externalRefs: Set<string>
  hasEditorScript: boolean
  hasShader: boolean
  packageJson?: { name: string; version: string; displayName: string }
}

export interface AssetUnit {
  tempId: string
  name: string
  category: string
  subcategory: string | null
  confidence: number
  status: 'archived' | 'pending_confirm'
  contentType: ContentType
  targetAvatars: string[]
  tags: string[]
  localeTag: string | null
  author: string | null
  version: string | null
  sourceUrl: string | null
  sourceItemId: string | null
  sourceItemIdConfidence: number
  groupKey: string
  bundleRef: string | null
  /** §B2：方括号变体槽位原文（`Shinano_ATTITUDE The Royal Bunny`），UI 解释"为什么并到一起" */
  variantRaw?: string | null
  filePaths: string[]
  /**
   * 第 10 轮 C：这一件在**父目录里的相对位置**（`件1` / `4533350\护目镜`）。
   * 摊平出来的筐由 `planBundle` 标上它，登记那一步用它算每件事自己的源路径
   * （见 `shared/flattenUnits.ts`）—— 少了它，22 件会全部登记到筐那一层目录上。
   */
  sourceRelPath?: string | null
  packageEntries?: PackageEntry[]
  coverImage?: string
  /**
   * 分类理由的结构化片段（第 2 份 §5.3 要求 UI 显示 reason）。
   *
   * reason 是拼好的人话、进库给人看日志；但界面文案不许主进程硬编码中文（第 1 份 F11），
   * 所以同时回传这份 key + 参数，渲染进程按语言自己拼。
   */
  reasonParts?: ReasonPart[]
  reason: string
}

/** 一句分类理由里的一个证据片段 */
export interface ReasonPart {
  key: string
  params?: Record<string, string | number>
}

/**
 * 三级模型的落库前形态（改动单 §2）。
 * 合集 ─ 子项 ─ 版本：每一级都是 asset 表里的一行，靠 parent_asset_id 串起来。
 */
export interface BundleVersionResult {
  rawName: string
  /** 相对合集根的路径 —— 只导入某一个版本时要靠它定位 */
  relPath: string
  sizeBytes: number
  version: string | null
  avatar: string | null
  installMethod: string | null
  locale: string | null
}

export interface BundleItemResult {
  name: string
  relPath: string
  groupKey: string
  /** ID 目录穿透出来的疑似商品号（只当来源，不当名字） */
  sourceItemId: string | null
  versions: BundleVersionResult[]
  /** 这个子项自己的完整分类结果 */
  unit: AssetUnit
  /** 子项自己还是个筐 → 嵌套合集 */
  tree?: BundleTreeResult | null
}

export interface BundleTreeResult {
  name: string
  coverImage: string | null
  /** 为什么算合集：i18n key + 参数 */
  why: Array<{ key: string; params?: Record<string, unknown> }>
  items: BundleItemResult[]
  sourceItemId: string | null
  totalBytes: number
  /** §B7：合集型 / 归并型。UI 上同一种容器卡，只有那行说明文字不同 */
  containerKind: ContainerKind
}

export interface ClassificationResult {
  units: AssetUnit[]
  /** @deprecated 合集现在是 tree；这个字段只为兼容老 worker 结果留着 */
  bundle?: { name: string; coverImage?: string }
  /** 有 tree = 这一坨是合集，整包入库，绝不拆成顶层卡片 */
  tree?: BundleTreeResult
}

// ---------------------------------------------------------------- UI 视图模型

/** 卡片：聚合视图下一个 group 一张卡 */
export interface AssetCard {
  id: string
  groupId: string | null
  name: string
  rawName: string
  category: string
  categoryLabel: string
  subcategory: string | null
  subcategoryLabel: string
  status: AssetStatus
  confidence: number
  kind: AssetKind | null
  variantCount: number
  /**
   * 变体之间到底差在哪几个维度（R4 ⑤「变体分列」）。
   * 和 `variantCount` 是两件事：那个是"我手上有几份"，这个是"这几份哪里不一样"。
   *
   * ⚠ **组级**事实，不是这一行独有的属性：平铺视图里同一个组的 11 张卡会带同一份 dims，
   * 这是故意的 —— 那一列要回答的是"这 11 份差在哪"，不是"我这份是什么"
   * （后者看 `variantRaw` 和标签）。解析与展示判据都在 `shared/variantDims.ts`。
   */
  dims: VariantDim[]
  coverImage: string | null
  /** @deprecated 老字段；合集卡现在看 isBundle / childCount */
  bundleName: string | null
  /** 这一行是不是合集容器（库列表里它是一张卡，点进去是二级列表） */
  isBundle: boolean
  /** 合集里几件子项（非合集为 0）；**不含附属资源** */
  childCount: number
  /** 容器里"能单独拿出来用"的件数：子项有版本行时数版本。归并型容器的"N 个模型变体"用它 */
  unitCount: number
  /** 挂在它下面的附属资源数（介绍图/视频/文档…），卡片上显示"3 张图 · 1 个视频"用 */
  attachmentCount: number
  /**
   * 容器来源（§B7）：`collection` = 合集型，卡片写"合集 · 含 N 项"；
   * `merged` = 归并型，卡片写"N 个模型变体"。两种卡的结构和进入式浏览完全一样。
   */
  containerKind: ContainerKind | null
  /** §B2 方括号变体槽位原文，进容器视图时显示每个变体是从哪截名字来的 */
  variantRaw: string | null
  /** 父合集的名字（子项详情里要显示"来自哪个合集"） */
  parentName: string | null
  tags: string[]
  sizeBytes: number | null
  updatedAt: number
}

/**
 * R4 ⑥ · 「在哪些工程装过」的一行（按工程聚合）。
 *
 * 类型住在这里是因为：主进程算、渲染进程画，两边各写一遍必漂。
 * 口径（为什么"手动 Import 过的查不到"）写在 `db/repos/unity.ts:installedProjects` 上。
 */
export interface InstalledWhereRow {
  projectId: string
  name: string
  /** 最后一次成功导入的时间（毫秒）；老数据没写完是 0 = "时间未知"，不是 1970 */
  at: number
  /** 成功导入过几个包（一包一条 import_log） */
  packages: number
  /** 新建的 GUID 总数 */
  created: number
  /** 覆盖过的文件总数（当时开了备份就能从备份目录拿回来） */
  overwritten: number
  /** 后来被 A 自己退回去的次数：不算"装过"，但要让用户看得见发生过 */
  rolledBack: number
  /** 工程记录已经没了（VCC 里删过工程）→ false，界面要如实说"工程已不在清单里" */
  known: boolean
}

export interface DetailInfo {
  asset: AssetRow
  group?: AssetGroupRow
  variants: VariantRow[]
  tags: TagRow[]
  bundle?: BundleRow
  packageSummary: { total: number; byKind: Record<string, number> } | null
  dependencies: { internal: number; external: number; resolved: number; missing: string[] }
  /** 第 3 份 §7：当前工程的导入状态 */
  installedInProject: { projectId: string; state: 'unknown' | 'none' | 'partial' | 'full'; hit: number; total: number } | null
  /**
   * R4 ⑥ · 跨工程反查：这条素材（同组一起算）在**哪些**工程导入过。
   * 口径见 `db/repos/unity.ts:installedProjects` 的头注 —— 只认 A 导过的那几次。
   */
  installedAcross: InstalledWhereRow[]
  lastImport: ImportLogRow | null
  pathExists: boolean
}

export interface AssetFilter {
  search?: string
  category?: string | null
  subcategory?: string | null
  collectionId?: string | null
  status?: AssetStatus | null
  groupId?: string | null
  view?: 'grouped' | 'flat'
  /**
   * 三级模型的取数范围。默认 'top'：只取顶层素材和合集卡，
   * 合集里的子项不单独出现在库列表里（改动单 §2.2）。
   */
  scope?: 'top' | 'all'
  /** true = 只看合集卡 */
  bundlesOnly?: boolean
  /** 给了就只取这个合集下面的子项 */
  parentId?: string
  /**
   * true = 反过来只取附属资源（详情页列"介绍图/演示视频/说明文档"用）。
   * 不给或 false 时，附属资源一律被排除 —— 它们不进库的第一层（增量改动单 2 §A2）。
   */
  attachmentsOnly?: boolean
  /** 给了就只取这一类附属资源（详情页分区显示用） */
  attachmentKind?: AttachmentKind | null
  /** M4：内存检索索引先算出候选 id，再交给 SQL 做剩下的过滤 */
  ids?: string[]
  limit?: number
  offset?: number
}

// ---------------------------------------------------------------- 设置（electron-store）

export interface AppSettings {
  /** 界面语言 */
  language: LocaleKey
  /** 物理目录名使用的语言：库创建时锁定，切 UI 语言不改磁盘（第 1 份 F11） */
  libraryLocale: LocaleKey
  theme: 'dark' | 'light'
  autoLaunch: boolean
  /**
   * M6 ⑥（Q3 裁定）：那条"要不要开机常驻托盘"的应用内提示**只问一次**。
   *
   * ⚠ 这个开关和"托盘常驻"是两件事，别混：
   *  - `autoLaunch` = 登录 Windows 时自启（点了"好"才会去写登录启动项）；
   *  - `minimizeToTray` = 关窗口时收进托盘（运行时状态，不碰系统）。
   * 规格 §4.3 要"默认开启开机自启"，代码**故意保持 false**（不擅自写用户的启动项），
   * 改成第一次检测到 Unity 启动时在应用内问一次，由他点。
   */
  autoLaunchAsked: boolean
  minimizeToTray: boolean
  globalHotkey: string
  /** 库 */
  libraryRoot: string | null
  /**
   * M7 · 第 ① 步选完之后，这个库根是按哪种方式处理的（Q3）。
   *  - `'adopt'` = 接管已有素材：**只登记不搬盘**，并且向导会把 `autoArchive` 关成 false；
   *  - `'fresh'` = 建空库：不碰目录里原有的东西，新素材按模板往里归档；
   *  - `null`   = 还没选过。老库里没这个键也是 null —— 那不代表"没配好"，
   *             只代表这个库是向导之前建的（Q2：`libraryRoot` 非空就不拦人）。
   */
  libraryMode: 'adopt' | 'fresh' | null
  storageMode: StorageMode
  dirTemplate: string
  keepOriginalArchive: boolean
  /** 实测库 25 GB、E 盘只剩 53 GB，默认关闭（见实现计划 D.1） */
  autoExtract: boolean
  flattenExtracted: boolean
  /**
   * 从压缩包型容器里抽 .unitypackage 时的临时落脚处（M5-B）。
   * 空串 = 由库根推导成"同盘的兄弟目录"（见 `src/main/import/extractRoot.ts`）。
   * 两道不许：不许在库根之内（临时副本会被当成游离素材登记进库）、不许在 C 盘。
   */
  extractRoot: string
  /** 分类 */
  autoArchive: boolean
  confidenceAuto: number
  confidenceConfirm: number
  groupingEnabled: boolean
  bundleSplitEnabled: boolean
  bundleChildrenUnderBundleDir: boolean
  llmEnabled: boolean
  llmEndpoint: string
  llmModel: string
  llmApiKeyRef: string
  /** Unity */
  unityExePath: string
  /** Prepare connections only for running user projects. Independent of legacy install prompts. */
  unityAutoConnect: boolean
  unityAutoConnectExcludedProjectIds: string[]
  /** null: not yet remembered; empty string: explicitly saved without extra rendering dependencies. */
  coverDependencyProjectId: string | null
  projectRoots: string[]
  bridgeAutoInstall: boolean
  confirmBeforeImport: boolean
  backupOverwritten: boolean
  autoSwitchBehavior: 'always' | 'when_matched' | 'never'
  /** 集成 */
  watchedFolders: string[]
  /**
   * M7 · 首次配置向导是否**走完**（只有第 ④ 步/「完成」会写 true）。
   *
   * ⚠ 这个字段 M7 之前就存在，但**应用代码里一处都没读过**（只有三个活体夹具在写 true）——
   * 也就是说它一直是个空壳。现在它真的当门禁用，判据在 `shared/wizardState.ts`。
   */
  onboardingDone: boolean
  /**
   * M7 · 向导走到第几步（1–4）。中途关窗口下次接着走，不必从第 ① 步重来。
   * 断点续填只记"走到哪"，不记答案 —— 答案本来就是各个设置项自己（库根、监视目录、`bridgeAsk:<id>`…）。
   */
  onboardingStep: number
  /**
   * M7 · 用户点「稍后配置」的时刻（ISO），null = 从没跳过。
   *
   * ⚠ **跳过不等于完成**：跳过之后不再拦人，但库根还是空的，
   * 侧栏那条"库还没配好"的提示必须一直在（`needsLibrarySetup`）。
   * 把 skip 写成 done 的话，用户拿到的是一个"看着配好了、拖什么都报错"的软件。
   */
  onboardingSkippedAt: string | null
  /**
   * 第 9 轮 ⑥ · 「自动收拾历史遗留」在这台机器上跑过的时刻（ISO），null = 还没跑过。
   *
   * 这条时间戳是整个设计的**刹车**：它保证"自动并"只发生一次。
   * 没有它，用户手动撤销之后下次开机又被并一遍 —— 那是程序跟用户抢方向盘，
   * 比原来那四步确认糟得多。撤销之后不想再被打扰 = 它已经是 true，不会再自己变回去。
   *
   * 顺带一个成本考虑：检查本身要给每张顶层卡跑一次归并键，所以**查过但没东西可收拾**
   * 也照样落这个值（把"每次开机全库扫一遍只为确认没事"变成"每台机器一次"）。
   */
  autoRemergeRunAt: string | null
  /**
   * 第 10 轮 #112 · 落上面那个时间戳时用的是**哪套库根**。
   *
   * 为什么要有这一列：`autoRemergeRunAt` 是整个设计的刹车，但它原来只记"什么时候跑过"，
   * 于是把素材库整体搬到另一块盘之后，那套新库里的旧账永远不会被自动收拾
   * —— 刹车本来防的是"同一批卡被并两遍"，跟"换了一套库"根本是两件事。
   * 判据在 `shared/autoRemerge.ts` 的 `remergeAlreadyRun`。
   */
  autoRemergeRunRoot: string | null
}

// ---------------------------------------------------------------- 第 3 份契约（M5 实现，类型先就位）

export const BRIDGE_PROTOCOL_VERSION = 1
export const BRIDGE_DIR = ['Temp', 'AVCABridge']
export const SIDECAR_FILENAME = '.avca.json'

export interface BridgeHeartbeat {
  protocolVersion: number
  pid: number
  projectPath: string
  projectName: string
  unityVersion: string
  bridgeVersion: string
  capabilities?: string[]
  isPlaying: boolean
  isCompiling: boolean
  isUpdating: boolean
  isPlayingOrWillChangePlaymode: boolean
  activeScene: string | null
  busyReason: string | null
  queueLength: number
  heartbeatUtc: number
}

export type BridgeCommandType =
  | 'get_preview_targets'
  | 'get_preview_candidates'
  | 'render_preview'
  | 'ping'
  | 'get_status'
  | 'resolve_guids'
  | 'import_unitypackage'
  | 'import_files'
  | 'delete_guids'
  | 'list_project_assets'
  | 'refresh'
  | 'open_folder'

export interface BridgeCommand {
  id: string
  type: BridgeCommandType
  protocolVersion: number
  createdAt: number
  payload: unknown
}

export type BridgeResultStatus = 'ok' | 'progress' | 'busy' | 'error' | 'cancelled'

export interface BridgeResult<T = unknown> {
  id: string
  status: BridgeResultStatus
  progress?: number
  message?: string
  busyReason?: string
  data?: T
}

export interface UnityInstance {
  projectPath: string
  projectId: string
  pid: number
  heartbeat: BridgeHeartbeat
  seenAt: number
}

export interface UnityStatus {
  running: boolean
  bridgeReady: boolean
  isPlaying: boolean
  isCompiling: boolean
  isUpdating: boolean
  queueLength: number
  busyReason: string | null
}

export interface ProjectInfo {
  id: string
  path: string
  name: string
  unityVersion: string | null
  running: boolean
  /**
   * 这个"运行中"的结论是哪几路探测给出的（第 3 份 §4.2：**三路取并集，任一命中即认为在运行**）。
   * 单独暴露出来是因为三路的可靠性差得远：`lockfile` / `bridge` 是硬证据，
   * `wmi` 只是兜底（Unity 以管理员权限启动时非管理员进程读不到它的 CommandLine）。
   * 排障时"为什么它说 Unity 开着"必须能一眼回答。
   */
  detectedBy: Array<'vcc' | 'scan' | 'bridge' | 'wmi' | 'lockfile'>
  bridgeVersion: string | null
  /** 桥接是否已装进这个工程（`Packages/com.avca.bridge/package.json`） */
  bridgeInstalled?: boolean
  /** 桥接在跑、但处于忙态（编译 / Play / 刷新）时的原因 */
  busyReason?: string | null
  /**
   * `Temp/UnityLockfile` 存在 —— **不代表 Unity 在运行**（异常退出会残留）。
   * 只有"独占试开失败"才算在运行，见 `project/running.ts`。
   */
  lockfilePresent?: boolean
}

/**
 * M7 ⑥ · 设置页列"记住的密码"时用的形状 —— **不含明文，也不含密文**。
 * 定义在 shared 是因为 `shared/api.ts` 不能 import 主进程模块（那边要 electron-log / better-sqlite3）。
 */
export interface RememberedEntry {
  id: number
  /** 文件名 + 大小 */
  hint: string
  /** 存的时候那个包在哪儿 */
  path: string
  /** 当时用哪套加密（`win-dpapi`） */
  platform: string
  /** 现在解不解得开 —— false 通常是换过机器或 Windows 用户 */
  readable: boolean
}

// ---------------------------------------------------------------- F9 库健康检查
export interface HealthAssetRef {
  id: string
  name: string
  path: string | null
  sizeBytes: number | null
}

/**
 * 只读扫描的结果。界面上每一项都另配一个"要动东西"的按钮，
 * 用户点了才动 —— 扫描本身永不改文件、永不改库（第 1 份 §F9 的第一条铁律）。
 */
export interface HealthReport {
  scannedAt: number
  libraryRoot: string | null
  /** DB 里有记录、磁盘上找不到 */
  missing: HealthAssetRef[]
  /** xxh64 完全一致（同一份内容的多个副本） */
  duplicates: Array<{ hash: string; sizeBytes: number; assets: HealthAssetRef[] }>
  /** 封面感知哈希相近（同名换格式、或者下了两遍改了名） */
  similar: Array<{ distance: number; a: HealthAssetRef; b: HealthAssetRef }>
  /** 库目录里有、DB 里没有 */
  strays: Array<{
    path: string
    sizeBytes: number
    entries: number
    isDir: boolean
    /** 旁边那个同名已解压目录 —— 登记只进包，这个留在原地由你处置 */
    alsoDirs?: string[]
    /**
     * 结构层目录整棵收口时标的类型（增量改动单 2 §A5）：
     * `code` = 全是脚本（一个「编辑器脚本」单元，不是 N 张卡）；
     * `attachments` = 全是图/文档（一个「参考资料」单元）。
     * 只有 depth ≤ 2 那层会标，depth ≥ 3 的目录本来就是整棵报一条。
     */
    contentKind?: 'code' | 'attachments' | 'group' | 'primary'
  }>
  /** 占空间最多的素材 */
  largest: HealthAssetRef[]
  /** 组里只剩一个成员（归并过细，解散掉才算干净） */
  orphanGroups: Array<{ groupId: string; key: string; name: string; assetId: string }>
  totals: { assets: number; groups: number; bytes: number; missingBytes: number; duplicateBytes: number }
  /** 扫到上限被截断（界面要如实说"只扫了前 N 条"） */
  truncated: boolean
}

// ---------------------------------------------------------------- M5-B 容器成员导入（IPC 契约）

/**
 * 这一节的类型是**主进程与渲染进程共用的同一份**，不是"照着主进程返回值手写一遍"。
 *
 * 为什么要专门搬到 shared：上一版 `packagesOfAsset` 的返回结构在
 * `main/bridge/ipc.ts`、`shared/api.ts`、`renderer/stores/ui.ts` 三处各写了一遍，
 * 结果 M5-B 改成判别联合时，只要有一处忘了跟着改，`tsc` 也照样绿
 * （渲染进程那份是自己声明的字面量类型，没人拿主进程的真实返回值去核对它）。
 * 一份类型、两侧引用，改漏了就直接红。
 */

/** "这个包是从哪儿来的"。导入记账与反查都靠它（见 `docs/M5B-DESIGN.md` §3.8） */
export interface PackageOrigin {
  /** 用户点的那张卡（容器卡或素材卡） */
  containerAssetId: string
  /** 外层压缩包绝对路径；散装 / 目录型容器为 null */
  originArchive: string | null
  /** 相对容器根的正斜杠路径；压缩包成员抽取时按它点名 */
  memberRelPath: string | null
}

export interface FoundPackage {
  /**
   * **现在就能导入**的磁盘路径。
   * 压缩包成员在抽出来之前没有路径 —— 这里是 `null`，不放"看起来像"的假路径。
   */
  path: string | null
  /** 相对容器根的路径；单文件素材就是它的文件名 */
  relPath: string
  sizeBytes: number
  origin: PackageOrigin
}

/** 容器"没列全 / 看不动"的那些实话。P0-4 的规矩：**撞线必须记账，不许静默少列** */
export interface ContainerNotes {
  cappedDepth: number
  cappedCount: number
  blocked: Array<{ relPath: string; key: string; detail: string | null }>
  needsPassword: boolean
  /** 一共看了多少条目（不是"库里有多少"） */
  scannedEntries: number
  /** 列清单用的后端；null = 没起过后端（目录型容器） */
  backend: string | null
}

export type EmptyReasonKey = 'noRow' | 'noPath' | 'missing' | 'noPackage'

/** 判别联合。老实现是 `FoundPackage[]`，压缩包那一支被 `return []` 吞掉 */
export type PackagesOfAssetResult =
  | { kind: 'loose'; packages: FoundPackage[]; notes: ContainerNotes | null }
  | { kind: 'archive'; packages: FoundPackage[]; notes: ContainerNotes | null }
  | { kind: 'empty'; reasonKey: EmptyReasonKey; packages: []; notes: ContainerNotes | null }

/**
 * 一条被挡住的成员。
 * `reasonKey` 是 i18n key —— 主进程只回 key + 参数，中文原文只当兜底（项目铁律）。
 * 设计 §3.7 要求五类失败各一个 key，不许合成一句"抽取失败"。
 */
export interface MemberFailure {
  relPath: string
  reasonKey: string
  detail: string | null
}

export interface ConflictView {
  guid: string
  existingPath: string
  incomingPath: string
}

/** 已经抽好并预扫描过的那个成员（`unity:import-plan` 返回的每一项） */
export interface PlanItemView {
  relPath: string
  sizeBytes: number
  originArchive: string | null
  /** true = A 抽出来的临时副本，导入完会删；false = 磁盘原件 */
  extracted: boolean
  entryCount: number
  fresh: number
  conflictCount: number
  conflicts: ConflictView[]
}

export interface PlanView {
  ok: true
  batchId: string
  items: PlanItemView[]
  blocked: MemberFailure[]
  totalBytes: number
  /** 闸门当时量到的可用字节；-1 = 量不到 */
  freeBytes: number
  /** 汇总卡片："这批里有 N 个包存在冲突" */
  conflictPackages: number
  /** "共 M 个文件会被覆盖" */
  conflictEntries: number
  batchMax: number
}

export interface PlanFailure {
  ok: false
  reasonKey: string
  reasonParams?: Record<string, unknown>
  /** 原文只当兜底（翻译缺 key 时界面至少能说出发生了什么） */
  detail?: string | null
}

export type PlanResult = PlanView | PlanFailure

/**
 * `unity:import-commit` / `unity:rollback-batch` 的返回。
 * 两种 `ok:false` 要分清：`BatchOutcome` 是"跑过了，但有几条没成"，
 * `PlanFailure` 是"这批早没了（重启过 / 被新批次挤掉），副本已经不在了"。
 * 界面按 `'results' in r` / `'details' in r` 分岔。
 */
export type CommitResult = BatchOutcome | PlanFailure
export type RollbackBatchResult = BatchRollbackOutcome | PlanFailure

export interface CommitItemResult {
  relPath: string
  ok: boolean
  status: 'ok' | 'failed' | 'cancelled' | 'skipped' | 'blocked'
  importId: string | null
  createdGuids: string[]
  overwrittenGuids: string[]
  error: string | null
  reasonKey: string | null
  /** 临时副本没删掉（占用/只读）。**不影响导入结论**，只影响磁盘占用 */
  cleanupFailed: boolean
}

export interface BatchOutcome {
  ok: boolean
  batchId: string
  imported: number
  failed: number
  /** 因为前面失败而**根本没执行**的条数（界面要显示"未执行 3"，不能算成失败） */
  notRun: number
  blocked: MemberFailure[]
  results: CommitItemResult[]
  cleanupFailed: number
  stoppedReasonKey: string | null
}

/**
 * R4 ① · 主进程**每跑完一条**广播给界面的一条（`unity:import-item`）。
 *
 * 为什么要有这条：`commitMemberImport` 一直有 `onItem` 这个回调参数
 * （"每包跑完一次（界面刷新进度条）"是它自己的注释写的），但 `ipc.ts` 调它时**没传**，
 * 于是"进度可见"这件事从 M5-B 起就只有个接口形状。传进来之后才知道第几条完了、成没成。
 *
 * ⚠ 只带 key 与计数，不带中文文案（i18n 铁律：主进程不许回传中文）。
 */
export interface ImportItemEvent {
  batchId: string
  /** 这批里的第几条（0 起） */
  index: number
  relPath: string
  ok: boolean
  status: CommitItemResult['status']
  reasonKey: string | null
  reasonParams?: Record<string, unknown> | null
  created: number
  overwritten: number
}

export interface BatchRollbackDetail {
  importId: string
  relPath: string | null
  ok: boolean
  error: string | null
  deletedFiles: number
  restoredFiles: number
  unrestorable: number
  failedToDelete?: number
}

export interface BatchRollbackOutcome {
  batchId: string
  attempted: number
  rolledBack: number
  stoppedAt: string | null
  details: BatchRollbackDetail[]
  /** 只有这一批**全撤干净**才是 true */
  ok: boolean
}

/** 设置 → 维护里那句"抽取目录占用 N MB [清理]" */
export type ExtractUsage = { root: string; bytes: number } | null

export interface ExtractCleanOutcome {
  ok: boolean
  reasonKey?: string
  removed: number
  kept: number
  bytes: number
  root?: string
}

/**
 * `unity:preflight` 的返回（Map 不能过 IPC，`PreflightResult` 转成这一份）。
 * 定义在 shared 而不是 main 里，是为了让 `shared/api.ts` 那份渲染侧声明
 * **就是同一个类型**，不是"照着主进程手抄一遍"—— 抄的那份改了没人报错。
 */
export interface PreflightView {
  ok: boolean
  reasonKey: string | null
  reason: string | null
  bridgeMissing: boolean
  packagePath: string
  entryCount: number
  fresh: number
  conflictCount: number
  /** §5.1④：要列出**具体文件路径**，所以这里给全（界面自己截断展示） */
  conflicts: ConflictView[]
  guids: string[]
  projectId: string
}

/** `unity:import-package`（单包）的返回。批量那条走 `CommitResult` */
export interface ImportResultView {
  ok: boolean
  importId: string
  status: ImportStatus
  createdGuids: string[]
  overwrittenGuids: string[]
  backupDir: string | null
  /** 备份目录里真存下了几个文件（0 = 盘上本来就没有那份，见 `shared/importNotes.ts`） */
  backupSaved: number
  error: string | null
  stackTrace: string | null
  elapsedMs: number
  retries: number
}

export interface ImportFailureView {
  ok: false
  error: string | null
  reasonKey?: string | null
}

export type ImportPackageResult = ImportResultView | ImportFailureView

/** `unity:rollback-import`（单条）的返回 */
export interface RollbackResultView {
  ok: boolean
  importId: string
  deletedFiles: string[]
  restoredFiles: string[]
  /** 有 `overwritten` 但没开备份 → 内容找不回来了，必须如实告诉用户 */
  unrestorable: number
  /** 桥接回 `failed`：白名单里**没能删掉**的那些路径（不是"本来就没有"） */
  failedToDelete?: string[]
  error: string | null
}

export interface RollbackFailureView {
  ok: false
  error: string
  importId?: string
}

export type RollbackResult = RollbackResultView | RollbackFailureView

/** `unity:cancel-batch`：只登记意图，当前那一条一定让它跑完（§5.2） */
export interface CancelBatchResult {
  ok: boolean
  willStopAfterCurrent?: boolean
  reasonKey?: string
}
