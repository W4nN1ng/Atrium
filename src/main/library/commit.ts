import path from 'node:path'
import fs from 'node:fs'
import { ulid } from '../../shared/ulid'
import { EXTRACTED_DIR_NAME } from '../../shared/constants'
import type { AssetRow, AssetStatus, AttachmentKind, ContainerKind, ContentType, SourcePlatform, StorageMode, VariantKind } from '../../shared/types'
import type { Db } from '../db'
import { makeAssetRow, upsertAsset } from '../db/repos/asset'
import { addVariant, ensureBundle, ensureGroup } from '../db/repos/product'
import { setAssetTags, addAssetTags } from '../db/repos/meta'
import { appendJournal } from '../db/repos/journal'
import { renderSegments } from './template'
import { dirKeyOf } from '../../shared/pathkey'
import { ensureDir, moveToHold, moveFile, moveTree, pathExists, uniquePath, listTree } from './fsx'
import { writeSidecar, type SidecarData } from './sidecar'
import { cleanDisplayName } from '../../shared/naming'

/**
 * F4 入库。两条铁律：
 *  1. 先写 journal 再动文件系统，中途失败能按 journal 回滚（第 1 份 F4 安全约束 5）；
 *  2. 只往 staging 解压，确认无误才提交进库目录（§12 坑 4）。
 */

export interface CommitUnit {
  name: string
  rawName: string
  category: string
  subcategory: string | null
  confidence: number
  status: AssetStatus
  kind: AssetRow['kind']
  contentType: ContentType | null
  version: string | null
  author: string | null
  localeTag: string | null
  sourceUrl: string | null
  sourcePlatform: SourcePlatform
  sourceItemId: string | null
  sourceItemIdConfidence: number | null
  tags: string[]
  targetAvatars: string[]
  installMethod?: string | null
  groupKey: string | null
  bundleRef: string | null
  bundleName: string | null
  reason: string
  hash: string | null
  sizeBytes: number | null
  coverRelative?: string | null
  notes?: string | null
  /** 低置信度被"一键入库"直接放过去了 → 标上，待复核页要能捞回来 */
  needsReview?: boolean
  /** §B2：方括号变体槽位原文，界面上回答"为什么这几个被并成一张卡" */
  variantRaw?: string | null
  /**
   * §A2 附属资源。它们跟着主体一起入库，但落成 parent=主体 的子行、
   * 带 attachment_kind —— 于是既不进库的第一层，也不计入素材总数，
   * 详情页还能把它们按区列出来（图库/媒体/说明/链接/源文件/音频）。
   */
  attachments?: AttachmentInput[]
}

/** 一条附属资源（增量改动单 2 §A2 的表） */
export interface AttachmentInput {
  /** 相对容器根的路径（正斜杠） */
  relPath: string
  kind: AttachmentKind
  sizeBytes: number
  /** 展示名；不给就从 relPath 末段清洗出来 */
  name?: string | null
}

export interface CommitDeps {
  db: Db
  libraryRoot: string
  /** key → 磁盘显示名，用建库时锁定的语言（第 1 份 F11） */
  names: Map<string, string>
  template: string
  storageMode: StorageMode
  autoExtract: boolean
  keepOriginalArchive?: boolean
  /** 丢弃暂存内容时挪到这里，可撤销 —— 绝不直接 rm */
  holdDir: string
  appVersion: string
}

export interface CommitInput {
  unit: CommitUnit
  /** 已准备好的暂存目录；只拖一个 .unitypackage 时为 null */
  stagingPath: string | null
  /** 原始压缩包 / 单文件本体 */
  sourcePath: string | null
  assetId?: string
  /** 一次摄取的多条 journal 共用它，Ctrl+Z 才能整批回滚 */
  batchId?: string
}

export interface CommitResult {
  assetId: string
  libraryPath: string | null
  sourcePath: string | null
  archiveInLibrary: string | null
  groupId: string | null
  bundleId: string | null
  journalIds: number[]
  /** 跨盘复制留下的源文件：worker 里调不了 shell.trashItem，交回主进程送回收站 */
  pendingTrash: string[]
}

/** 这个路径在磁盘上是不是个目录（附件路径要不要拼相对段，全看这个） */
function isDirPath(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory()
  } catch {
    return false
  }
}

/** root 往上到 libraryRoot 之间、本次会新建的目录（撤销时只删这些） */
async function createdDirsUnder(root: string, libraryRoot: string): Promise<string[]> {
  const out: string[] = []
  let cur = path.resolve(root)
  const stop = path.resolve(libraryRoot)
  while (cur.length > stop.length && cur.toLowerCase().startsWith(stop.toLowerCase() + path.sep)) {
    out.push(cur)
    cur = path.dirname(cur)
  }
  return out.reverse()
}

function buildRow(assetId: string, u: CommitUnit, now: number, extra: Partial<AssetRow>): AssetRow {
  return makeAssetRow({
    id: assetId,
    name: u.name,
    raw_name: u.rawName,
    category: u.category,
    subcategory: u.subcategory,
    confidence: u.confidence,
    status: u.status,
    kind: u.kind,
    content_type: u.contentType,
    size_bytes: u.sizeBytes,
    hash_xxh64: u.hash,
    source_url: u.sourceUrl,
    source_platform: (u.sourcePlatform ?? null) as AssetRow['source_platform'],
    source_item_id: u.sourceItemId,
    source_item_id_confidence: u.sourceItemIdConfidence,
    author: u.author,
    version: u.version,
    locale_tag: u.localeTag,
    notes: u.notes ?? null,
    needs_review: u.needsReview ? 1 : 0,
    variant_raw: u.variantRaw ?? null,
    created_at: now,
    updated_at: now,
    ...extra
  })
}

/**
 * 附属资源落库（增量改动单 2 §A2）。
 *
 * 每条附属资源都是 asset 表里的一行，parent 指向主体、attachment_kind 非空。
 * 于是：库列表的 buildWhere 天然把它挡在第一层之外，素材总数不数它，
 * 合集判定不看它，但详情页能按区分出来、导入 Unity 时能被单独勾选。
 * **不做成"隐藏卡片"** —— 那是 05「不要做的事」#1 点名禁止的。
 *
 * 一个文件都不搬：附属资源跟着主体待在原地，路径是拼出来的。
 */
function persistAttachments(
  db: Db,
  parentId: string,
  list: AttachmentInput[] | undefined,
  opts: { rootPath: string; rootIsDir: boolean; category: string; subcategory: string | null; now: number; created: string[] }
): void {
  if (!list?.length) return
  for (const a of list) {
    const id = ulid()
    const raw = a.relPath.split(/[\\/]/).filter(Boolean).pop() ?? a.relPath
    const name = a.name?.trim() || cleanDisplayName(raw).name || raw
    upsertAsset(
      db,
      makeAssetRow({
        id,
        name,
        raw_name: raw,
        category: opts.category,
        subcategory: opts.subcategory,
        confidence: 1,
        status: 'archived',
        kind: ATTACH_KIND_TO_ASSET_KIND[a.kind],
        content_type: a.kind === 'doc' ? 'reference' : null,
        size_bytes: a.sizeBytes,
        storage_mode: 'indexed',
        library_path: opts.rootIsDir ? path.join(opts.rootPath, ...a.relPath.split('/').filter(Boolean)) : opts.rootPath,
        source_path: null,
        parent_asset_id: parentId,
        is_bundle: 0,
        needs_review: 0,
        attachment_kind: a.kind,
        created_at: opts.now,
        updated_at: opts.now
      })
    )
    opts.created.push(id)
  }
}

/** 附属资源在 asset.kind 上的落点：详情页的图标和"能不能单独导入 Unity"都看它 */
const ATTACH_KIND_TO_ASSET_KIND: Record<AttachmentKind, AssetRow['kind']> = {
  image: 'image',
  video: 'video',
  doc: 'doc',
  link: 'doc',
  source: 'source',
  audio: 'audio'
}

/** 组 / 变体 / 合集 / 标签 —— 归档与索引两条路共用，只写一次行 */
function persistRelations(
  db: Db,
  assetId: string,
  u: CommitUnit,
  /** #40：这条素材所在的目录键。传了才吃"同目录才归并"的闸门 */
  dirKey?: string | null
): { groupId: string | null; bundleId: string | null } {
  let groupId: string | null = null
  if (u.groupKey) {
    const g = ensureGroup(db, {
      groupKey: u.groupKey,
      name: u.name,
      category: u.category,
      subcategory: u.subcategory,
      dirKey
    })
    groupId = g.id
    /**
     * variant 行的语义是"这个素材和组里兄弟不一样在哪"，所以只有**单一体型**才算变体。
     * 一个包适配 11 个体型（束縛チャイナFULLSET 就是）时，那 11 个名字是兼容性说明，
     * 不是 11 个变体 —— 写进 variant 表会让聚合视图谎报"12 变体"（实测踩过）。
     * 兼容性记到 tag(kind='avatar')，既能显示也进检索别名。
     */
    const avatars = u.targetAvatars
    if (avatars.length === 1) addVariant(db, { groupId: g.id, assetId, kind: 'avatar', value: avatars[0] })
    if (avatars.length === 0) addVariant(db, { groupId: g.id, assetId, kind: 'avatar', value: 'UNIVERSAL' })
    addAssetTags(db, assetId, avatars, 'avatar', 'auto')
    if (u.installMethod) addVariant(db, { groupId: g.id, assetId, kind: 'install_method', value: u.installMethod })
    if (u.version) addVariant(db, { groupId: g.id, assetId, kind: 'version', value: u.version })
    if (u.localeTag) addVariant(db, { groupId: g.id, assetId, kind: 'locale', value: u.localeTag })
  }
  let bundleId: string | null = null
  if (u.bundleRef || u.bundleName) {
    const b = ensureBundle(db, { name: u.bundleName ?? '合集', sourcePath: u.bundleRef })
    bundleId = b.id
  }
  if (u.tags.length) setAssetTags(db, assetId, u.tags, 'topic', 'auto')
  return { groupId, bundleId }
}

export async function commitAsset(deps: CommitDeps, input: CommitInput): Promise<CommitResult> {
  const db = deps.db
  const now = Date.now()
  const assetId = input.assetId ?? ulid()
  const u = input.unit
  const journalIds: number[] = []
  const pendingTrash: string[] = []
  const batchId = input.batchId ?? assetId

  // ------------------------------------------------------------ 索引模式：文件不动，只登记
  if (deps.storageMode === 'indexed') {
    const source = input.sourcePath ?? input.stagingPath
    if (!source) throw new Error('索引模式需要一个源路径')
    const rel = persistRelations(db, assetId, u, dirKeyOf(source))
    upsertAsset(
      db,
      buildRow(assetId, u, now, {
        storage_mode: 'indexed',
        source_path: source,
        group_id: rel.groupId,
        bundle_id: rel.bundleId
      })
    )
    const created: string[] = [assetId]
    const rootIsDir = isDirPath(source)
    persistAttachments(db, assetId, u.attachments, {
      rootPath: source,
      rootIsDir,
      category: u.category,
      subcategory: u.subcategory,
      now,
      created
    })
    /**
     * 一个文件都没动 ≠ 不需要进 journal。
     * 收编旧库、一键全部入库走的就是这条路，以前它一点痕迹都不留，
     * 于是 Ctrl+Z 无事可撤 —— 撤不回来的话"全部入库"就不是按钮，是赌注。
     * 附属资源的行也一起记进去：撤销时它们得跟着主体一起消失。
     */
    journalIds.push(
      appendJournal(
        db,
        { op: 'register', to: source, assetIds: created, label: `登记 ${u.name}（未移动文件）` },
        { batchId }
      )
    )
    return {
      assetId,
      libraryPath: null,
      sourcePath: source,
      archiveInLibrary: null,
      groupId: rel.groupId,
      bundleId: rel.bundleId,
      journalIds,
      pendingTrash
    }
  }

  // ------------------------------------------------------------ 归档模式
  const segments = renderSegments(
    deps.template,
    {
      category: u.category,
      subcategory: u.subcategory,
      name: u.name,
      version: u.version,
      avatar: u.targetAvatars[0] ?? null,
      author: u.author,
      year: String(new Date(now).getFullYear())
    },
    deps.names
  )
  const planned = path.join(deps.libraryRoot, ...segments)
  const destRoot = await uniquePath(planned)

  journalIds.push(
    appendJournal(
      db,
      {
        op: 'mkdir',
        to: destRoot,
        createdDirs: await createdDirsUnder(destRoot, deps.libraryRoot),
        assetIds: [assetId],
        label: `建目录 ${segments.join('/')}`
      },
      { batchId }
    )
  )
  await ensureDir(destRoot)

  let archiveInLibrary: string | null = null
  let extractedContent: string | null = null
  if (input.sourcePath) {
    const base = path.basename(input.sourcePath)
    const dest = await uniquePath(path.join(destRoot, base))
    journalIds.push(appendJournal(db, { op: 'move', from: input.sourcePath, to: dest, label: `归档原件 ${base}` }, { batchId }))
    const how = await moveFile(input.sourcePath, dest)
    archiveInLibrary = dest
    if (how === 'copied') pendingTrash.push(input.sourcePath)
  }

  // 默认不自动解压（库 25 GB，解压会成倍占空间）；
  // 但"只有解压出来的散文件、没有原件"时，那份内容就是素材本身，必须搬进库。
  if (input.stagingPath && (await pathExists(input.stagingPath))) {
    const isSame = archiveInLibrary !== null && path.resolve(input.stagingPath) === path.resolve(archiveInLibrary)
    if (!isSame) {
      if (archiveInLibrary && !deps.autoExtract) {
        const held = await moveToHold(deps.holdDir, input.stagingPath)
        journalIds.push(
          appendJournal(
            db,
            {
              op: 'trash',
              trashed: [{ from: input.stagingPath, to: held }],
              label: '丢弃暂存解压内容（未开启自动解压）'
            },
            { batchId }
          )
        )
      } else {
        const dest = archiveInLibrary ? path.join(destRoot, EXTRACTED_DIR_NAME) : destRoot
        journalIds.push(
          appendJournal(db, { op: 'extract', from: input.stagingPath, to: dest, label: '提交解压内容' }, { batchId })
        )
        await moveTree(input.stagingPath, dest)
        extractedContent = dest
      }
    }
  }

  // Only retire a generic archive after real files have been saved. Unity packages remain importable.
  if (archiveInLibrary && deps.keepOriginalArchive === false && deps.autoExtract &&
      u.kind === 'archive' && extractedContent && (await listTree(extractedContent)).some((f) => !f.isDir)) {
    const original = archiveInLibrary
    await ensureDir(deps.holdDir)
    const held = await uniquePath(path.join(deps.holdDir, path.basename(original)))
    journalIds.push(appendJournal(db, { op: 'trash', trashed: [{ from: original, to: held }],
      label: '原压缩包移入可撤销暂存区' }, { batchId }))
    if (await moveFile(original, held) === 'copied') await fs.promises.unlink(original)
    archiveInLibrary = null
  }

  const rel = persistRelations(db, assetId, u, dirKeyOf(destRoot))
  const row = buildRow(assetId, u, now, {
    storage_mode: 'archived',
    library_path: destRoot,
    source_path: archiveInLibrary,
    cover_image: u.coverRelative ? path.join(destRoot, u.coverRelative) : null,
    group_id: rel.groupId,
    bundle_id: rel.bundleId
  })
  upsertAsset(db, row)

  /**
   * 归档模式下附属资源已经跟着主体一起被搬进 destRoot 了（moveTree 整棵搬），
   * 所以路径按 destRoot 拼。撤销走的是 mkdir/move/extract 那几条 journal，
   * 附属行本身随 assetId 一起删（deleteAssetRow 会递归删子行）。
   */
  const archivedCreated: string[] = [assetId]
  persistAttachments(db, assetId, u.attachments, {
    rootPath: destRoot,
    rootIsDir: true,
    category: u.category,
    subcategory: u.subcategory,
    now,
    created: archivedCreated
  })

  const sidecar: SidecarData = {
    schema: 1,
    appVersion: deps.appVersion,
    generatedAt: now,
    asset: stripPaths(row),
    variants: persistableVariants(u),
    tags: u.tags,
    coverRelative: u.coverRelative ?? null,
    reason: u.reason
  }
  await writeSidecar(destRoot, sidecar)

  return {
    assetId,
    libraryPath: destRoot,
    sourcePath: archiveInLibrary,
    archiveInLibrary,
    groupId: rel.groupId,
    bundleId: rel.bundleId,
    journalIds,
    pendingTrash
  }
}

function persistableVariants(u: CommitUnit): SidecarData['variants'] {  const out: NonNullable<SidecarData['variants']> = []
  for (const a of u.targetAvatars) out.push({ assetId: '', kind: 'avatar' as VariantKind, value: a })
  if (u.installMethod) out.push({ assetId: '', kind: 'install_method', value: u.installMethod })
  if (u.version) out.push({ assetId: '', kind: 'version', value: u.version })
  if (u.localeTag) out.push({ assetId: '', kind: 'locale', value: u.localeTag })
  return out
}

/** 侧车不存绝对路径：库可以整体挪盘，路径由"它在哪个目录里"推出 */
function stripPaths(row: AssetRow): SidecarData['asset'] {
  const copy: Record<string, unknown> = { ...row }
  delete copy.library_path
  delete copy.source_path
  return copy as SidecarData['asset']
}

// ---------------------------------------------------------------- 合集三级落库（改动单 §2）

export interface BundleVersionInput {
  rawName: string
  /** 相对合集根的路径 */
  relPath: string
  sizeBytes: number
  version: string | null
  avatar: string | null
  installMethod: string | null
  locale: string | null
  /** §B2：这个版本是从哪截方括号内容认出来的，容器视图里的模型徽章靠它 */
  variantRaw?: string | null
}

export interface BundleItemInput {
  unit: CommitUnit
  /** 相对合集根 */
  relPath: string
  versions: BundleVersionInput[]
}

export interface BundleCommitResult {
  bundleAssetId: string
  /** 建出来的全部 asset id（合集自己 + 子项 + 版本），索引/撤销都按这份走 */
  createdIds: string[]
  journalIds: number[]
}

/**
 * 合集入库：**整包登记成一条合集记录 + 若干子项 + 若干版本行，一个文件都不搬**。
 *
 * 为什么不复用 commitAsset 的归档流程：改动单 §7.1 明确"不要为了看起来整齐
 * 而在磁盘上真的移动合集内的文件"。合集里 17 件东西挪 17 次目录，
 * 一旦中间出错就是半个库散在两地 —— 登记模式没有这个风险，撤销也只是删库记录。
 *
 * 三级都落在 asset 表里靠 parent_asset_id 串（§7.2 不许平行表）：
 *   合集 is_bundle=1, parent=NULL
 *   子项 parent=合集
 *   版本 parent=子项（只有 ≥2 个版本时才建；单件东西不许多占一行）
 */
export function commitBundleAsset(
  deps: CommitDeps,
  input: {
    bundle: CommitUnit
    items: BundleItemInput[]
    /** 合集在磁盘上的实际目录 */
    rootPath: string
    assetId?: string
    batchId?: string
    /** 低于这个置信度就标 needs_review（设置里的自动归档线） */
    reviewThreshold?: number
    /** §B7：容器来源。合集型 'collection'（默认）／归并型 'merged' */
    containerKind?: ContainerKind
  }
): BundleCommitResult {
  const db = deps.db
  const now = Date.now()
  const th = input.reviewThreshold ?? 0.75
  const bundleId = input.assetId ?? ulid()
  const batchId = input.batchId ?? bundleId
  const created: string[] = []

  const reviewOf = (u: CommitUnit): number => (u.confidence < th ? 1 : 0)
  /**
   * 合集可能是一个**目录**，也可能是一个**压缩包**（DMCustom_PCS_v1.10.0.zip 里装两个 unitypackage 就是后者）。
   * 是目录时子项有真实路径；是压缩包时子项的 library_path 只能是那个包本身 ——
   * 成员名已经存在 raw_name 里，M5 导入时按"包 + 成员名"取那一条就行。
   * 别拼出 `xxx.zip\SPS.zip` 这种磁盘上不存在的路径，那会误导所有下游。
   */
  const rootIsDir = fs.existsSync(input.rootPath) && fs.statSync(input.rootPath).isDirectory()
  const joinRel = (rel: string): string => (rootIsDir ? path.join(input.rootPath, ...rel.split('/').filter(Boolean)) : input.rootPath)

  const itemsBytes = input.items.reduce((a, i) => a + (i.unit.sizeBytes ?? 0), 0)
  const bundleRow = buildRow(bundleId, input.bundle, now, {
    storage_mode: 'indexed',
    library_path: input.rootPath,
    source_path: null,
    is_bundle: 1,
    parent_asset_id: null,
    /**
     * §B7：合集型和归并型是**同一种容器**，只有这个字段区分来源，
     * 卡片上那行字不一样（"合集 · 含 N 项" vs "N 个模型变体"），
     * 进入式浏览、导入、解散、撤销全走同一套代码。
     */
    container_kind: input.containerKind ?? 'collection',
    size_bytes: itemsBytes || input.bundle.sizeBytes,
    // 一坨里只要有 1 件没把握，整包都要人回来看一眼
    needs_review: input.items.some((i) => reviewOf(i.unit) === 1) ? 1 : 0
  })
  upsertAsset(db, bundleRow)
  created.push(bundleId)
  /** 容器自己也可能有附属资源（`名流/ATTITUDE The Royal Bunny.jpg` 就是整个系列的封面） */
  persistAttachments(db, bundleId, input.bundle.attachments, {
    rootPath: input.rootPath,
    rootIsDir,
    category: input.bundle.category,
    subcategory: input.bundle.subcategory,
    now,
    created
  })

  for (const it of input.items) {
    const itemId = ulid()
    const iu = it.unit
    const row = buildRow(itemId, iu, now, {
      storage_mode: 'indexed',
      library_path: joinRel(it.relPath),
      source_path: null,
      parent_asset_id: bundleId,
      is_bundle: 0,
      needs_review: reviewOf(iu),
      size_bytes: iu.sizeBytes ?? it.versions.reduce((a, v) => a + v.sizeBytes, 0)
    })
    upsertAsset(db, row)
    created.push(itemId)
    persistAttachments(db, itemId, iu.attachments, {
      rootPath: joinRel(it.relPath),
      rootIsDir: rootIsDir && isDirPath(joinRel(it.relPath)),
      category: iu.category,
      subcategory: iu.subcategory,
      now,
      created
    })

    /**
     * 版本行：≥2 个版本才单独占一行（一件东西没必要再套一层）。
     * 同时把它们挂进同一个 asset_group，variant 表照旧写维度 ——
     * 聚合视图、变体徽章、检索别名那套逻辑因此一行都不用改。
     *
     * dirKey 传的是**这个子项自己的目录**：同一个容器里的版本本来就同目录，
     * 而"另一个容器里恰好同名"的东西不许吸进来（#40）。
     */
    if (it.versions.length > 1) {
      const group = iu.groupKey
        ? ensureGroup(db, {
            groupKey: iu.groupKey,
            name: iu.name,
            category: iu.category,
            subcategory: iu.subcategory,
            dirKey: dirKeyOf(joinRel(it.relPath))
          })
        : null
      for (const v of it.versions) {
        const vid = ulid()
        const vrow = buildRow(
          vid,
          {
            ...iu,
            name: v.rawName,
            rawName: v.rawName,
            version: v.version,
            sizeBytes: v.sizeBytes,
            /** 每个版本记自己那截括号原文：容器视图里每行的模型徽章靠它 */
            variantRaw: v.variantRaw ?? iu.variantRaw ?? null
          },
          now,
          {
            storage_mode: 'indexed',
            library_path: joinRel(v.relPath),
            source_path: null,
            parent_asset_id: itemId,
            is_bundle: 0,
            needs_review: reviewOf(iu),
            size_bytes: v.sizeBytes,
            group_id: group?.id ?? null
          }
        )
        upsertAsset(db, vrow)
        created.push(vid)
        if (group) {
          addVariant(db, { groupId: group.id, assetId: vid, kind: 'version', value: v.version ?? v.rawName })
          if (v.avatar) addVariant(db, { groupId: group.id, assetId: vid, kind: 'avatar', value: v.avatar })
          if (v.installMethod) addVariant(db, { groupId: group.id, assetId: vid, kind: 'install_method', value: v.installMethod })
          if (v.locale) addVariant(db, { groupId: group.id, assetId: vid, kind: 'locale', value: v.locale })
        }
      }
    }
  }

  // 先写 journal 再算完成：这条是"一键入库能整批 Ctrl+Z"的唯一凭据
  const journalId = appendJournal(
    db,
    {
      op: 'register',
      to: input.rootPath,
      assetIds: created,
      label: `登记合集 ${input.bundle.name}（${input.items.length} 项 / ${created.length - 1} 行子记录）`
    },
    { batchId }
  )

  return { bundleAssetId: bundleId, createdIds: created, journalIds: [journalId] }
}
