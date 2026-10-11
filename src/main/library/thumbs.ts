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
import path from 'node:path'
import { P } from '../services/paths'
import { extractPackagePreview } from '../unpack/unitypackage'
import type { Db } from '../db'
import { getCover, referencedCoverKeys } from '../db/repos/covers'
import {
  COVER_NONE,
  THUMB_MAX_SOURCE_BYTES,
  listImageFiles,
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

interface ThumbRow {
  id: string
  hash_xxh64: string | null
  kind: string | null
  library_path: string | null
  source_path: string | null
  cover_image: string | null
}

/** 素材目录里找 .unitypackage（最多两层、前 6 个，够挑封面了） */
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
      } else if (/\.unitypackage$/i.test(e.name)) {
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
  let sawSomething = false
  const dirs: string[] = []
  for (const d of [row.library_path, row.source_path].filter((x): x is string => !!x)) {
    let abs: string | null = null
    try {
      const st = fs.statSync(d)
      abs = st.isFile() ? d : pickCoverCandidate(listImageFiles(d))
      sawSomething = true
      dirs.push(d)
    } catch {
      continue
    }
    if (!abs) continue
    const r = writeThumb(abs, key)
    if (r.ok && r.url) {
      return save(r.url) ? r : current()
    }
  }
  // 散图没有 → 伸进 unitypackage 拿卖家自己放的 preview.png（要解压，看 opts.packages 脸色）
  if (opts.packages) {
    for (const d of dirs) {
      for (const pkg of findPackageFiles(d)) {
        try {
          const pv = await extractPackagePreview(pkg)
          if (!pv) continue
          const r = writeThumbFromBuffer(pv.bytes, key)
          if (r.ok && r.url) {
            return save(r.url) ? r : current()
          }
        } catch {
          /* 一个包读不动就试下一个 */
        }
      }
    }
  }
  // 只有"里外都找过"才配写没图记号：没开 packages 的批次只是没往包里看，
  // 现在就标 'none' 的话，以后维护页再也不会去补这些素材的封面。
  const searchedEverything = opts.packages !== false
  if (searchedEverything && sawSomething && row.cover_image !== COVER_NONE) {
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
