/**
 * 封面的"挑哪张图"规则 —— 纯函数，不碰 electron，所以能单测。
 *
 * 拆出来的理由：真正写文件的 thumbs.ts 要用 nativeImage（只有 Electron 运行时里有），
 * 而"该显示哪张图"这件事恰恰是用户能直接看到好坏的部分，必须能测。
 */
import fs from 'node:fs'
import path from 'node:path'

/** 卡片是 4:3，长边 320 够了（高分屏 2x 也才 640，再大就是白占磁盘和解码时间） */
export const THUMB_MAX_EDGE = 320
export const THUMB_SCHEME = 'athumb'
/** 源图超过这个大小就完全放弃：4K 导出图解码一次能吃掉几百 MB 内存 */
export const THUMB_MAX_SOURCE_BYTES = 48 * 1024 * 1024
/** 超过这个大小就"能不用就不用"：同素材里通常还有一张正常尺寸的图 */
export const THUMB_PREFERRED_MAX_SOURCE_BYTES = 8 * 1024 * 1024
/** 小于这个数的一律不当封面：多半是 16x16 的角标 */
export const THUMB_MIN_SOURCE_BYTES = 2048

/**
 * "找过了，这包里确实没有图"的记号。
 * 不记这个的话，每次刷新列表都会把没图的素材再扫一遍目录 —— 5 万条的库会被拖死。
 */
export const COVER_NONE = 'none'

const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif', 'tga'])
/** 封面偏好顺序：无损大图通常就是宣传图，gif/tga 排后面 */
const EXT_RANK: Record<string, number> = { png: 0, jpg: 1, jpeg: 1, webp: 2, bmp: 3, tga: 4, gif: 5 }
const COVER_HINT = /(preview|cover|thumb|main|icon|banner|header|主图|封面|预览|一览)/i

export function isImageName(name: string): boolean {
  return IMAGE_EXT.has(path.extname(name).replace('.', '').toLowerCase())
}

export function thumbUrlFor(key: string): string {
  return `${THUMB_SCHEME}://${key}.jpg`
}

/**
 * 从 athumb 地址取出键；顺手挡掉 ../ 和绝对路径（协议 handler 与写缓存共用）。
 *
 * 注意 standard 协议下 Chromium 的规范化：`athumb://xxx.jpg` 会被当成
 * "host = xxx.jpg、path = 空"，回调里收到的 URL 常常还带一个尾斜杠。
 * 所以不能只按字符串正则抠，得先走 URL 解析，host 和 path 两种位置都认。
 */
export function thumbKeyFromUrl(url: string): string | null {
  let u: URL
  try {
    u = new URL(url.trim())
  } catch {
    return null
  }
  if (u.protocol !== THUMB_SCHEME + ':') return null
  // host 会被 punycode / 小写化，所以原始串里出现这些字符的一律不接（真键只有哈希与 ULID 的字符）
  if (/[\\%]|\.\./.test(url)) return null
  const tail = u.pathname.replace(/^\/+|\/+$/g, '')
  const name = tail || u.host || ''
  if (!/^[\w.-]+$/.test(name)) return null
  return name.replace(/\.jpg$/i, '')
}

/** 封面排序键：越小越优先。五个维度依次比。 */
function coverScore(absPath: string, size: number): number[] {
  const base = path.basename(absPath)
  const ext = path.extname(base).replace('.', '').toLowerCase()
  return [
    COVER_HINT.test(base) ? 0 : 1,
    EXT_RANK[ext] ?? 9,
    // 超大图先降一档（不是丢掉）：同素材里通常还有一张正常尺寸的图
    size > THUMB_PREFERRED_MAX_SOURCE_BYTES ? 1 : 0,
    // 同档里大的更像宣传图
    -size,
    // 再同分就包根目录的赢（层级浅）
    absPath.split(/[\\/]/).length
  ]
}

function better(a: number[], b: number[]): boolean {
  for (let i = 0; i < a.length; i++) {
    if (a[i] < b[i]) return true
    if (a[i] > b[i]) return false
  }
  return false
}

/**
 * 一堆候选图里挑封面。
 * 先名字带 preview/cover 的，再按扩展名偏好，再按大小，最后按目录深度。
 */
export function pickCoverCandidate(files: Array<{ absPath: string; size: number }>): string | null {
  let best: string | null = null
  let bestScore: number[] | null = null
  for (const f of files) {
    if (!isImageName(f.absPath)) continue
    if (f.size < THUMB_MIN_SOURCE_BYTES || f.size > THUMB_MAX_SOURCE_BYTES) continue
    const s = coverScore(f.absPath, f.size)
    if (!bestScore || better(s, bestScore)) {
      best = f.absPath
      bestScore = s
    }
  }
  return best
}

/**
 * 压缩包里的"哪张图当封面"——和 `pickCoverCandidate` 同一套偏好，
 * 只是候选不是磁盘上的绝对路径，而是包内条目清单。
 *
 * 单独一个函数的理由：zip / rar / 7z / unitypackage 四种容器都需要这道判断，
 * 而它不碰文件系统，能单测（真容器在 thumbs.ts 里才拆）。
 */
export function pickArchiveCoverEntry<T extends { path: string; size: number; isDir?: boolean }>(
  entries: T[]
): T | null {
  let best: T | null = null
  let bestScore: number[] | null = null
  for (const e of entries) {
    if (e.isDir) continue
    if (!isImageName(e.path)) continue
    if (e.size < THUMB_MIN_SOURCE_BYTES || e.size > THUMB_MAX_SOURCE_BYTES) continue
    const s = coverScore(e.path, e.size)
    if (!bestScore || better(s, bestScore)) {
      best = e
      bestScore = s
    }
  }
  return best
}

/** 列目录里的图片（只往下走两层，别为了一张封面把 5 万文件的包扫穿） */
export function listImageFiles(
  dir: string,
  maxEntries = 400,
  depth = 2
): Array<{ absPath: string; size: number }> {
  const out: Array<{ absPath: string; size: number }> = []
  const walk = (d: string, level: number): void => {
    if (level > depth || out.length >= maxEntries) return
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(d, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      if (out.length >= maxEntries) return
      const abs = path.join(d, e.name)
      if (e.isDirectory()) {
        if (e.name.startsWith('.') || e.name === 'node_modules') continue
        walk(abs, level + 1)
        continue
      }
      if (!isImageName(e.name)) continue
      try {
        out.push({ absPath: abs, size: fs.statSync(abs).size })
      } catch {
        /* 读不到大小就跳过这一条 */
      }
    }
  }
  walk(dir, 1)
  return out
}

/** 内容哈希优先（同内容换名字不用重做），没哈希才退回素材 id */
export function thumbKeyOf(asset: { id: string; hash_xxh64: string | null }): string {
  return asset.hash_xxh64 || asset.id
}

/** asset.cover_image → 缓存键；'none'/空/别的协议一律算"没有封面" */
export function thumbKeyFromCover(coverImage: string | null | undefined): string | null {
  if (!coverImage || coverImage === COVER_NONE) return null
  return thumbKeyFromUrl(coverImage)
}
