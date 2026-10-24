/**
 * 缩略图（第 1 份 F6：卡片要有封面，缓存在 %APPDATA%\A\thumbs\）
 *
 * 为什么不用 sharp：sharp 要拉 libvips 预编译包（这台机器 GitHub 时通时不通），
 * 而且它和 better-sqlite3 一样是原生模块，双 ABI 的坑得再踩一遍。
 * Electron 自带的 nativeImage 就是 Chromium 的图像解码器 ——
 * png / jpg / webp / bmp / gif 都能读，resize 也内置，零新依赖、打包版一定能用。
 * 代价是没有 webp 编码器，所以缓存统一写 jpg（封面多是照片类，jpg 还更小）。
 *
 * 存进 asset.cover_image 的是 `athumb://<key>.jpg`，不是绝对路径：
 * 库要能整体挪盘（侧车同理不写绝对路径），而缩略图本来就属于这台机器的缓存，
 * 只存文件名、路径由主进程现算。dev 页面是 http://localhost:5173，
 * 直接给 file:/// 会被 webSecurity 拦掉，打包版又是 file://，
 * 两边不一致最难查 —— 所以走自定义协议（见 services/thumb-protocol.ts）。
 *
 * "挑哪张图"的规则在 thumbRules.ts（纯函数，有单测），这里只负责读写。
 */
import { nativeImage } from 'electron'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { P, bundledBinDir } from '../services/paths'
import { extractPackagePreview } from '../unpack/unitypackage'
import { extractMembers, listMembers } from '../unpack/members'
import type { Db } from '../db'
import { getCover, referencedCoverKeys } from '../db/repos/covers'
import {
  COVER_NONE,
  THUMB_MAX_SOURCE_BYTES,
  listImageFiles,
  pickArchiveCoverEntry,
  pickCoverCandidate,
  thumbKeyFromUrl,
  thumbKeyOf,
  thumbKeyFromCover,
  thumbUrlFor,
  THUMB_MAX_EDGE
} from './thumbRules'

export { COVER_NONE, THUMB_MAX_EDGE, THUMB_SCHEME } from './thumbRules'
export { isImageName, listImageFiles, pickCoverCandidate, thumbKeyFromUrl, thumbUrlFor } from './thumbRules'

export function thumbPathFor(key: string): string {
  return path.join(P.thumbs(), key + '.jpg')
}

export interface ThumbResult {
  ok: boolean
  url: string | null
  /** 失败原因（进日志，不进界面） */
  why?: string
}

/**
 * 解码 → 缩到 320 → 写 jpg。已存在就直接返回，重复调用不重复干活。
 *
 * nativeImage 读不懂的格式不会抛错，而是返回一张"空图"，
 * 所以必须用 isEmpty() 判断 —— 否则会写出一张 0 字节的 jpg，
 * 然后因为"文件已存在"永远命中这张坏缓存。
 */
function encodeThumb(img: ReturnType<typeof nativeImage.createFromBuffer>, key: string): ThumbResult {
  const dest = thumbPathFor(key)
  if (img.isEmpty()) return { ok: false, url: null, why: '解码不了这个格式' }
  const { width, height } = img.getSize()
  const scaled =
    width > THUMB_MAX_EDGE || height > THUMB_MAX_EDGE
      ? (() => {
          const s = THUMB_MAX_EDGE / Math.max(width, height)
          return img.resize({
            width: Math.max(1, Math.round(width * s)),
            height: Math.max(1, Math.round(height * s)),
            quality: 'good'
          })
        })()
      : img
  const buf = scaled.toJPEG(82)
  if (!buf.length) return { ok: false, url: null, why: '编码 jpg 失败' }
  try {
    fs.mkdirSync(P.thumbs(), { recursive: true })
    const tmp = dest + '.tmp'
    fs.writeFileSync(tmp, buf)
    fs.renameSync(tmp, dest)
  } catch (e) {
    return { ok: false, url: null, why: e instanceof Error ? e.message : String(e) }
  }
  return { ok: true, url: thumbUrlFor(key) }
}

export function writeThumbFromBuffer(bytes: Buffer, key: string): ThumbResult {
  return encodeThumb(nativeImage.createFromBuffer(bytes), key)
}

export function writeThumb(srcAbs: string, key: string): ThumbResult {
  const dest = thumbPathFor(key)
  if (fs.existsSync(dest) && fs.statSync(dest).size > 0) return { ok: true, url: thumbUrlFor(key) }
  let stat: fs.Stats
  try {
    stat = fs.statSync(srcAbs)
  } catch {
    return { ok: false, url: null, why: '源文件不存在' }
  }
  if (!stat.isFile() || stat.size > THUMB_MAX_SOURCE_BYTES) return { ok: false, url: null, why: '源文件太大或不是文件' }
  return encodeThumb(nativeImage.createFromPath(srcAbs), key)
}

/** 能"从里面抠封面"的容器：VRChat 素材基本就这四种 */
export const CONTAINER_EXT = /\.(unitypackage|zip|rar|7z)$/i

/** 嵌套包上限：Booth 里"zip 只装一个 unitypackage"通常几 MB，超过这个就不值得为封面去解压 */
const NESTED_MAX_BYTES = 64 * 1024 * 1024

/** 解出来的成员落在临时目录里（保留包内相对路径），扫一遍找出来，别猜 */
function findLandedFile(dir: string, re: RegExp, depth = 4): string | null {
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return null
  }
  for (const e of entries) {
    const abs = path.join(dir, e.name)
    if (e.isDirectory()) {
      const hit = depth > 0 ? findLandedFile(abs, re, depth - 1) : null
      if (hit) return hit
      continue
    }
    if (re.test(e.name)) return abs
  }
  return null
}

/**
 * 源本身就是压缩包时，封面只能从**包里**取。
 *
 * 现场（2026-10-24 16:49，拖入「插件17件」27 件）：16 件是目录、14 件是
 * zip / rar / unitypackage。旧路径把压缩包本体丢给 `nativeImage.createFromPath`，
 * 必然解不出一张图 → 一路走到"没图"，于是这些卡片永远是首字母方块。
 *
 * 三种容器分开处理不是重复代码：
 * - `.unitypackage` 是 tar.gz，卖家自己塞的 `preview.png` 就是他们选的封面，
 *   走流式解析、拿到第一张就掐断，不解压整个包；
 * - zip / rar / 7z 先列清单挑一张图，再只抽那一张（`extractMembers` 支持点名抽取），
 *   绝不能为了封面把几百 MB 的包解到磁盘上；
 * - **包中包**：`liltoon_unebeta.zip` 里只有一个 `liltoon_unebeta.unitypackage`，
 *   没有散图。不下这一层，Booth 上最常见的那种"zip 套 unitypackage"永远没封面。
 *   只下一层、只看最小的两个，防止为了封面去解一整套合集。
 */
async function coverFromArchive(file: string, key: string, depth = 1): Promise<ThumbResult | null> {
  if (/\.unitypackage$/i.test(file)) {
    const pv = await extractPackagePreview(file)
    return pv ? writeThumbFromBuffer(pv.bytes, key) : null
  }
  let entries: Array<{ path: string; size: number; isDir: boolean }>
  try {
    /**
     * ⚠ **必须带 `extraBackendDirs`**。
     * 不带的话 `resolveBackend` 会退回系统里装的 WinRAR / 7-Zip；这台机器上退回的是
     * `UnRAR.exe`，它不认我们用的那套参数，抛 `后端版本过旧` —— 于是所有 rar 素材
     * 都被判成"没图"（2026-10-24 实测：`原版VRCFury.rar` 里明明有 7 KB 的 preview.png）。
     * 打包后 7z.exe 就在 `resources/bin`，传进去就能正常列清单和解包。
     */
    entries = (await listMembers(file, { extraBackendDirs: [bundledBinDir()] })).entries
  } catch {
    return null
  }

  const best = pickArchiveCoverEntry(entries)
  if (best) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'atrium-cover-'))
    try {
      await extractMembers(file, tmp, [best.path], { extraBackendDirs: [bundledBinDir()] })
      const landed = listImageFiles(tmp, 5, 4)[0]
      if (!landed || landed.size > THUMB_MAX_SOURCE_BYTES) return null
      return writeThumbFromBuffer(fs.readFileSync(landed.absPath), key)
    } catch {
      /* 加密包、坏包、后端缺 7z —— 都当"这张拿不到"，不往上抛 */
      return null
    } finally {
      try {
        fs.rmSync(tmp, { recursive: true, force: true })
      } catch {
        /* 临时目录删不掉不影响结果，系统会回收 */
      }
    }
  }

  if (depth <= 0) return null
  const nested = entries
    .filter((e) => !e.isDir && CONTAINER_EXT.test(e.path) && e.size > 0 && e.size <= NESTED_MAX_BYTES)
    .sort((a, b) => a.size - b.size)
    .slice(0, 2)
  for (const n of nested) {
    const inner = fs.mkdtempSync(path.join(os.tmpdir(), 'atrium-cover-in-'))
    try {
      await extractMembers(file, inner, [n.path], { extraBackendDirs: [bundledBinDir()] })
      const innerFile = findLandedFile(inner, CONTAINER_EXT)
      if (!innerFile) continue
      const r = await coverFromArchive(innerFile, key, depth - 1)
      if (r?.ok && r.url) return r
    } catch {
      /* 这个嵌套包读不动，换下一个 */
    } finally {
      try {
        fs.rmSync(inner, { recursive: true, force: true })
      } catch {
        /* 同上 */
      }
    }
  }
  return null
}

interface ThumbRow {
  id: string
  hash_xxh64: string | null
  kind: string | null
  library_path: string | null
  source_path: string | null
  cover_image: string | null
}

/** 素材目录里找可以"从里面抠封面"的容器（最多两层、前 6 个，够挑封面了） */
function findPackageFiles(dir: string, limit = 6): string[] {
  const out: string[] = []
  const walk = (d: string, level: number): void => {
    if (level > 2 || out.length >= limit) return
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(d, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      if (out.length >= limit) return
      const abs = path.join(d, e.name)
      if (e.isDirectory()) {
        if (e.name.startsWith('.')) continue
        walk(abs, level + 1)
      } else if (/\.(unitypackage|zip|rar|7z)$/i.test(e.name)) {
        try {
          if (fs.statSync(abs).isFile()) out.push(abs)
        } catch {
          /* 跳过读不到的 */
        }
      }
    }
  }
  walk(dir, 1)
  return out
}

/**
 * 给一条素材补封面：找到源图 → 写缓存 → 回填 asset.cover_image。
 * 返回 ok:false 表示"没有能当封面的图"，卡片继续显示首字母，不是错误。
 *
 * 顺序：先目录里的散图（最快），再伸进 .unitypackage 里拿 preview.png ——
 * VRChat 素材一大半是"包里只有 unitypackage"（ABT 就是这样），
 * 不做第二步的话这些卡片永远是首字母方块。
 */
export async function ensureThumb(db: Db, assetId: string, opts: ThumbOptions = {}): Promise<ThumbResult> {
  const row = db
    .prepare(`SELECT id, hash_xxh64, kind, library_path, source_path, cover_image FROM asset WHERE id = ?`)
    .get(assetId) as ThumbRow | undefined
  if (!row) return { ok: false, url: null, why: '素材不存在' }
  const chosenKey = thumbKeyFromCover(row.cover_image)
  if (chosenKey) {
    const chosenFile = thumbPathFor(chosenKey)
    if (fs.existsSync(chosenFile) && fs.statSync(chosenFile).size > 0) {
      return { ok: true, url: row.cover_image }
    }
  }
  // An explicit cover whose cache is missing remains explicit; rebuilding must
  // not silently replace the user's choice with an unrelated automatic image.
  if (getCover(db, assetId)) return { ok: false, url: null, why: '已设置的封面缓存丢失，请重新生成或恢复自动封面' }
  const key = thumbKeyOf(row)
  const dest = thumbPathFor(key)
  const save = (url: string): boolean => {
    // Extraction yields to IPC. Only update the unchanged automatic cover;
    // a user selection made in the meantime always wins.
    return db.prepare(`UPDATE asset SET cover_image = ? WHERE id = ? AND cover_image IS ?
      AND NOT EXISTS (SELECT 1 FROM asset_cover WHERE asset_id = ?)`)
      .run(url, assetId, row.cover_image, assetId).changes > 0
  }
  const current = (): ThumbResult => {
    const latest = db.prepare('SELECT cover_image FROM asset WHERE id = ?').get(assetId) as { cover_image: string | null } | undefined
    const selected = thumbKeyFromCover(latest?.cover_image)
    return selected && fs.existsSync(thumbPathFor(selected))
      ? { ok: true, url: latest!.cover_image }
      : { ok: false, url: null, why: '封面已变化，未覆盖当前选择' }
  }
  if (fs.existsSync(dest) && fs.statSync(dest).size > 0) {
    const url = thumbUrlFor(key)
    return save(url) ? { ok: true, url } : current()
  }
  /**
   * `listedOk` 和旧的 `sawSomething` 差一个字，差的是"到底看没看过"：
   * 只有**真的把目录读出来了**（或源就是一个文件）才算看过。
   *
   * 旧口径只要 `statSync` 成功就算"看过"，于是刚拖进来、目录还没落稳时，
   * 会走到最后一句把 `cover_image` 写成 `'none'` —— 而 `backfillThumbs` 只捞
   * `cover_image IS NULL`，一旦标成 'none' 就**永远不会再补**。
   * 2026-10-24 那次 22 件只出 1 张封面，就是这条路径的两种表现。
   */
  let listedOk = false
  /** 找到了容器但这一趟没被允许拆 → 不许把"没看"写成"没图"（见下面 lookedEverywhere） */
  let skippedContainer = false
  const dirs: string[] = []
  for (const d of [row.library_path, row.source_path].filter((x): x is string => !!x)) {
    let abs: string | null = null
    let st: fs.Stats
    try {
      st = fs.statSync(d)
    } catch {
      // 路径还没落稳：既不算看过，也别记 'none'，留给补拍
      continue
    }
    if (st.isFile()) {
      listedOk = true
      /**
       * 源文件是压缩包：解码器读不懂它，封面要从包里取。
       * 也不能把它塞进 `dirs` 再走 `findPackageFiles` —— 那里 `readdirSync` 一个文件必然失败，
       * 等于白跑一趟。
       */
      if (CONTAINER_EXT.test(d)) {
        /**
         * 没被允许拆包的那一趟（启动时"便宜"的那趟）**既不试、也不许记 none**：
         * 拆包要 CPU 和磁盘，但这不代表"这素材没图"，只代表"这一趟没看"。
         */
        if (!opts.packages) {
          skippedContainer = true
          continue
        }
        const r = await coverFromArchive(d, key)
        if (r?.ok && r.url) return save(r.url) ? r : current()
        continue
      }
      abs = d
    } else {
      try {
        fs.readdirSync(d)
        listedOk = true
      } catch {
        continue
      }
      abs = pickCoverCandidate(listImageFiles(d))
    }
    dirs.push(d)
    if (!abs) continue
    const r = writeThumb(abs, key)
    if (r.ok && r.url) {
      return save(r.url) ? r : current()
    }
  }
  // 散图没有 → 伸进目录里的容器抠图（unitypackage 的 preview.png、zip/rar 里的商品图）
  for (const d of dirs) {
    const containers = findPackageFiles(d)
    if (!containers.length) continue
    if (!opts.packages) {
      // 这一趟不拆包，但也不能因此判"没图"
      skippedContainer = true
      continue
    }
    for (const pkg of containers) {
      try {
        const r = await coverFromArchive(pkg, key)
        if (r?.ok && r.url) {
          return save(r.url) ? r : current()
        }
      } catch {
        /* 一个包读不动就试下一个 */
      }
    }
  }
  // 只有"里外都找过"才配写没图记号：没拆包的那趟只是没往里看，
  // 现在就标 'none' 的话，这一行就**永远不会**再被补（backfill 只捞 NULL）。
  const lookedEverywhere = !!opts.packages || !skippedContainer
  if (lookedEverywhere && listedOk && row.cover_image !== COVER_NONE) {
    if (!save(COVER_NONE)) return current()
  }
  return { ok: false, url: null, why: '没有可用的图片' }
}

export interface ThumbOptions {
  /**
   * 允不允许伸进 .unitypackage 里抠 preview.png。
   * gzip 是顺序流：预览图要是排在 300MB 的 fbx 后面，解压那 300MB 得三五秒，
   * 而且是主进程。所以启动补批默认关掉，只在"用户刚入库"和"维护页手动重建"时开。
   */
  packages?: boolean
  /** 时间预算（毫秒）：超了就把手上这批剩下的留给下次 */
  deadlineMs?: number
}

/**
 * 补一批封面（启动后台跑一小批，维护页的"重建缩略图"也用它）。
 * 有两条预算：条数 + 时间。cover_image 为 NULL 的才处理，所以天然可续跑；
 * 'none' 的自动跳过（那是"确认过没图"，不是"还没看过"）。
 */
export async function backfillThumbs(
  db: Db,
  budget = 200,
  opts: ThumbOptions = {}
): Promise<{ checked: number; made: number; hitDeadline: boolean }> {
  const rows = db
    .prepare(`SELECT id FROM asset WHERE cover_image IS NULL ORDER BY updated_at DESC LIMIT ?`)
    .all(budget) as Array<{ id: string }>
  const until = opts.deadlineMs ? Date.now() + opts.deadlineMs : 0
  let made = 0
  let checked = 0
  let hitDeadline = false
  for (const r of rows) {
    if (until && Date.now() > until) {
      hitDeadline = true
      break
    }
    checked++
    if ((await ensureThumb(db, r.id, opts)).ok) made++
  }
  return { checked, made, hitDeadline }
}

/**
 * 给**指定这批**素材补封面（入库收尾用）。
 *
 * 为什么不复用 `backfillThumbs`：那个是"全库捞 cover_image IS NULL，按 updated_at 取前 N 条"。
 * 一次整筐入库 27 件时，它的预算里混着一堆旧素材，而真正该补的就是这 27 条 ——
 * 而且它没法回答"这批到底补全了没有"。
 *
 * 返回 `missed`：这次没出图、**且仍然是 NULL** 的那些（= 源还没落稳，值得补拍）。
 * 已经确认没图的（`none`）不算 missed —— 给它们排补拍只是白发两次解码。
 */
export async function backfillThumbsFor(
  db: Db,
  ids: string[],
  opts: ThumbOptions = {}
): Promise<{ checked: number; made: number; missed: string[] }> {
  let made = 0
  const missed: string[] = []
  for (const id of ids) {
    let ok = false
    try {
      ok = (await ensureThumb(db, id, opts)).ok
    } catch {
      ok = false
    }
    if (ok) {
      made++
      continue
    }
    const row = db.prepare('SELECT cover_image FROM asset WHERE id = ?').get(id) as
      | { cover_image: string | null }
      | undefined
    if (row && row.cover_image === null) missed.push(id)
  }
  return { checked: ids.length, made, missed }
}

/**
 * 一次性修复：把旧流程**判错**的 `cover_image='none'` 清回 NULL。
 *
 * 为什么不走迁移：核心库 schema 版本是"旧版能直接打开新库"的前提
 * （`tests/rollback/drill.spec.ts` 咬死 11 不放），封面缓存的口径不该去动它。
 * 所以改用 `setting` 里的一枚标记，跑一次就记下。
 *
 * 为什么必须修：`'none'` 的语义是"确认过，这包里没图"，而 `backfillThumbs`
 * 只捞 `IS NULL` —— 记错一次就是**永远**没有封面。0.9.2 之前"源是压缩包"的素材
 * 从来没往包里看过（还把系统 UnRAR 的参数错误当成"没图"），那批 `none` 是错的。
 *
 * 清回 NULL 代价有限：重看一遍，真没图的会再被记回 `none`，不会来回抖。
 */
const COVER_PIPELINE_KEY = 'cover.pipeline'
const COVER_PIPELINE_VERSION = 2

export function repairUntrustedNoneCovers(db: Db): number {
  const row = db.prepare('SELECT value_json FROM setting WHERE key = ?').get(COVER_PIPELINE_KEY) as
    | { value_json: string | null }
    | undefined
  let seen = 0
  try {
    seen = row?.value_json ? Number(JSON.parse(row.value_json)) || 0 : 0
  } catch {
    seen = 0
  }
  if (seen >= COVER_PIPELINE_VERSION) return 0
  const cleared = db.prepare(`UPDATE asset SET cover_image = NULL WHERE cover_image = 'none'`).run().changes
  db.prepare('INSERT OR REPLACE INTO setting (key, value_json) VALUES (?, ?)').run(
    COVER_PIPELINE_KEY,
    JSON.stringify(COVER_PIPELINE_VERSION)
  )
  return cleared
}

/** 删素材时顺手清缓存（回收站里的东西不该继续在缩略图目录留影子） */
export function forgetThumb(db: Db, assetId: string): void {
  const row = db.prepare(`SELECT hash_xxh64, id, cover_image FROM asset WHERE id = ?`).get(assetId) as
    | { hash_xxh64: string | null; id: string; cover_image: string | null }
    | undefined
  if (!row) return
  const used = referencedCoverKeys(db, assetId)
  const others = db.prepare('SELECT id, hash_xxh64, cover_image FROM asset WHERE id != ?').all(assetId) as Array<typeof row & object>
  for (const other of others) {
    used.add(thumbKeyOf(other))
    const key = thumbKeyFromCover(other.cover_image)
    if (key) used.add(key)
  }
  const cover = getCover(db, assetId)
  const keys = new Set([thumbKeyOf(row), thumbKeyFromCover(row.cover_image), thumbKeyFromCover(cover?.previousImage)])
  for (const key of keys) {
    if (!key || used.has(key)) continue
    try { fs.rmSync(thumbPathFor(key), { force: true }) } catch { /* maintenance retries */ }
  }
}

/** 缓存目录里所有 jpg 的键（健康检查算"游离缩略图"要用） */
export function listThumbKeys(): string[] {
  try {
    return fs
      .readdirSync(P.thumbs())
      .filter((f) => f.toLowerCase().endsWith('.jpg'))
      .map((f) => thumbKeyFromUrl('athumb://' + f) ?? '')
      .filter(Boolean)
  } catch {
    return []
  }
}

/**
 * 清掉没有素材引用的缩略图。
 *
 * 为什么不跟着每次删除走：撤销、批量删、以后换库根……能删掉 asset 行的入口有好几个，
 * 每个都记得删缓存反而容易漏。这里一次扫目录对着库里的哈希比对，
 * 谁引用不到就删，入口再多也不怕。
 */
export function pruneThumbCache(db: Db): { removed: number; kept: number } {
  const used = referencedCoverKeys(db)
  for (const row of db.prepare('SELECT id, hash_xxh64, cover_image FROM asset').all() as Array<{ id: string; hash_xxh64: string | null; cover_image: string | null }>) {
    used.add(thumbKeyOf(row))
    const key = thumbKeyFromCover(row.cover_image)
    if (key) used.add(key)
  }
  let removed = 0
  let kept = 0
  for (const key of listThumbKeys()) {
    // Keep unconfirmed previews briefly while the user is reviewing a modal.
    try {
      if (key.startsWith('preview-') && Date.now() - fs.statSync(thumbPathFor(key)).mtimeMs < 30 * 60_000) { kept++; continue }
    } catch { continue }
    if (used.has(key)) {
      kept++
      continue
    }
    try {
      fs.rmSync(thumbPathFor(key), { force: true })
      removed++
    } catch {
      /* 正被占用就下次再清 */
    }
  }
  return { removed, kept }
}

/**
 * 刚导入时封面常常"生不出来"，而且**不报错**。
 *
 * 现场（2026-10-24，22 件一次性拖入）：只有 1 张封面在入库那一刻写出来，
 * 另外 19 张要等下次启动的 `backfillThumbs` 才补上；日志里一条错误都没有。
 * 原因是入库瞬间源目录往往还没落稳 —— 用户刚解压完就拖进来，文件还在被写、
 * 被占用，`readdir`/解码拿不到图，`ensureThumb` 只能返回 `ok:false`（这是"没图"的正常语义，
 * 不能当异常抛）。等两秒再看就什么都有了。
 *
 * 所以给刚入库的素材留两次补拍机会，而不是让它一直空到下次启动。
 * 有上限、可取消、不阻塞退出（timer 都 unref）。
 */
const thumbRetryTimers = new Map<string, ReturnType<typeof setTimeout>>()
const THUMB_RETRY_DELAYS = [1500, 5000]

export interface ThumbRetryOptions {
  /** 补拍成功时回调（调用方用它广播 data:changed）。 */
  onMade?: (assetId: string) => void
  /** 测试用：覆盖重试间隔。 */
  delays?: readonly number[]
  /** 补拍时允不允许伸进 .unitypackage（默认允许，和入库时一致）。 */
  packages?: boolean
}

/** 已经排着的重试不叠加，避免同一个素材堆一串 timer。 */
export function scheduleThumbRetry(db: Db, assetId: string, opts: ThumbRetryOptions = {}): void {
  if (thumbRetryTimers.has(assetId)) return
  const delays = opts.delays ?? THUMB_RETRY_DELAYS
  const step = (index: number): void => {
    if (index >= delays.length) {
      thumbRetryTimers.delete(assetId)
      return
    }
    const timer = setTimeout(() => {
      thumbRetryTimers.delete(assetId)
      void ensureThumb(db, assetId, { packages: opts.packages ?? true })
        .then((result) => {
          if (result.ok) opts.onMade?.(assetId)
          else step(index + 1)
        })
        .catch(() => step(index + 1))
    }, delays[index])
    // 别让补拍把进程吊着不退出
    ;(timer as { unref?: () => void }).unref?.()
    thumbRetryTimers.set(assetId, timer)
  }
  step(0)
}

/** 测试/删除素材时取消待补拍。 */
export function cancelThumbRetry(assetId: string): void {
  const timer = thumbRetryTimers.get(assetId)
  if (timer) clearTimeout(timer)
  thumbRetryTimers.delete(assetId)
}

export function clearThumbRetriesForTest(): void {
  for (const timer of thumbRetryTimers.values()) clearTimeout(timer)
  thumbRetryTimers.clear()
}
