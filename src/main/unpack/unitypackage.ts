/**
 * .unitypackage 深度解析（第 2 份 §2）
 *
 * 格式：gzip 套 tar，里面每个资产占一个目录：
 *   <guid>/pathname      纯文本，该文件在工程里的目标路径（很小，全读）
 *   <guid>/asset         真身，可能几百 MB —— 默认只读头部，主体直接跳过
 *   <guid>/asset.meta    YAML，判类型用
 *   <guid>/preview.png   可选缩略图
 *
 * 三条硬要求（§2.2 / §10.5）：
 * 1. 流式：不许把整包读进内存或全解到磁盘（用户的包有几百 MB）；
 * 2. 只有 .prefab/.mat/.controller/.asset/.unity 且 ≤4MB 时才读 asset 正文扫 GUID；
 * 3. 解析失败要返回明确错误，不许抛未捕获异常。
 */
import fs from 'node:fs'
import zlib from 'node:zlib'
import path from 'node:path'
import * as tar from 'tar'
import type { EntryKind, PackageEntry, PackageParseResult } from '../../shared/types'

/** asset 正文最多读这么多用来扫 GUID */
const REF_SCAN_LIMIT = 4 * 1024 * 1024
/** meta 头部读这么多就够判类型 */
const META_HEAD = 2 * 1024
/** 需要读正文扫依赖的工程文件 */
const REF_SCAN_EXT = /\.(prefab|mat|controller|asset|unity|playable|overridecontroller)$/i

export interface UnitypackageOptions {
  /** 已处理条目数 / 预估总条目数（tar 流式，总数只能边读边估） */
  onProgress?: (processed: number, bytes: number) => void
  /** 关掉可以省时间：不扫外部 GUID */
  scanRefs?: boolean
  /** 最多收多少条（超大包防 UI 卡死），默认 5000 */
  maxEntries?: number
}

function kindOf(unityPath: string, metaHead: string): EntryKind {
  const ext = path.extname(unityPath).toLowerCase()
  switch (ext) {
    case '.prefab':
      return 'prefab'
    case '.fbx':
    case '.obj':
    case '.blend':
      return 'fbx'
    case '.mat':
      return 'mat'
    case '.shader':
    case '.cginc':
    case '.hlsl':
    case '.shadergraph':
      return 'shader'
    case '.anim':
      return 'anim'
    case '.controller':
    case '.overridecontroller':
      return 'controller'
    case '.cs':
      return 'cs'
    case '.unity':
      return 'unity'
    case '.png':
    case '.jpg':
    case '.jpeg':
    case '.tga':
    case '.psd':
    case '.bmp':
    case '.gif':
    case '.webp':
      return 'png'
    case '.asset':
      // §2.2 要点 4：.asset 要读 YAML 头才能分 Material / ScriptableObject
      return /^%YAML|!!u!114|ScriptableObject|m_Script:/i.test(metaHead) && !/Material/i.test(metaHead.slice(0, 400))
        ? 'so'
        : /Material/i.test(metaHead.slice(0, 400))
          ? 'mat'
          : 'so'
    default:
      return 'other'
  }
}

/**
 * 规范化 tar 里第一段目录名得到的 GUID。
 *
 * Unity 的 GUID 规范是**恰好 32 位十六进制**。真包里那一段可能带尾随空格，
 * 而且目录项（`./<guid>/`）本身也会走到这里 —— 所以统一清洗一遍：
 * 去空白 + 小写 + 只认 32 位 hex，对不上返回空串（调用方会跳过那一条）。
 */
function normalizeGuid(raw: string): string {
  const g = raw.trim().toLowerCase()
  return /^[0-9a-f]{32}$/.test(g) ? g : ''
}

function fail(error: string): PackageParseResult {
  return {
    ok: false,
    error,
    entries: [],
    guidSet: new Set<string>(),
    externalRefs: new Set<string>(),
    hasEditorScript: false,
    hasShader: false,
    tree: ''
  }
}

/** 从 asset 正文里扫 `guid: <32hex>` */
function scanGuids(text: string, into: Set<string>): void {
  for (const m of text.matchAll(/guid:\s*([0-9a-f]{32})/g)) into.add(m[1])
}

/** 把 unityPath 列表渲染成缩进树（UI 详情页用） */
export function renderTree(entries: Array<{ unityPath: string; entryKind: string }>, maxLines = 200): string {
  const lines: string[] = []
  const prevParts: string[] = []
  for (const e of entries.slice(0, maxLines)) {
    const parts = e.unityPath.split('/').filter(Boolean)
    let i = 0
    while (i < parts.length - 1 && i < prevParts.length && prevParts[i] === parts[i]) i++
    for (let d = i; d < parts.length - 1; d++) lines.push('  '.repeat(d) + parts[d] + '/')
    lines.push('  '.repeat(Math.max(0, parts.length - 1)) + parts[parts.length - 1] + '  [' + e.entryKind + ']')
    prevParts.length = 0
    for (const p of parts) prevParts.push(p)
  }
  if (entries.length > maxLines) lines.push(`… 还有 ${entries.length - maxLines} 项`)
  return lines.join('\n')
}

/**
 * 解析一个 .unitypackage 文件。
 * 永远 resolve，不 reject —— 调用方拿 ok=false 的返回值自己决定怎么提示。
 */
export async function parseUnitypackage(
  file: string,
  opts: UnitypackageOptions = {}
): Promise<PackageParseResult> {
  const maxEntries = opts.maxEntries ?? 5000
  const scanRefs = opts.scanRefs !== false

  return new Promise<PackageParseResult>((resolve) => {
    const guidSet = new Set<string>()
    const external = new Set<string>()
    const metaHeads = new Map<string, string>()
    const pathnames = new Map<string, string>()
    const assetSizes = new Map<string, number>()
    const previews = new Set<string>()
    let hasEditorScript = false
    let hasShader = false
    let packageJson: PackageParseResult['packageJson']
    let processed = 0
    let bytes = 0
    let settled = false
    /** guid → 暂存的 asset 正文（最后按 pathname 决定要不要用它） */
    const buffered = new Map<string, string>()
    /** 留在内存里的正文总预算：超了就跳过后面的 asset */
    let refBudget = 24 * 1024 * 1024

    const done = (error?: string): void => {
      if (settled) return
      settled = true
      if (error) {
        resolve(fail(error))
        return
      }
      const list: PackageEntry[] = Array.from(pathnames.keys())
        .sort()
        .map((guid) => ({
          guid,
          unityPath: pathnames.get(guid) as string,
          entryKind: kindOf(pathnames.get(guid) as string, metaHeads.get(guid) ?? ''),
          size: assetSizes.get(guid) ?? 0,
          hasPreview: previews.has(guid),
          ...(/^folderAsset:\s*yes\s*$/m.test(metaHeads.get(guid) ?? '') ? { isFolder: true } : {})
        }))
      for (const e of list) {
        guidSet.add(e.guid)
        if (/\.shader$/i.test(e.unityPath)) hasShader = true
        if (/(^|\/)Editor\/[^/]+\.cs$/i.test(e.unityPath)) hasEditorScript = true
      }
      // 外部引用 = 正文里出现、但不属于本包的 GUID；只扫该扫的那几类
      for (const [guid, text] of buffered) {
        const up = pathnames.get(guid) ?? ''
        if (REF_SCAN_EXT.test(up)) scanGuids(text, external)
        if (/package\.json$/i.test(up)) {
          try {
            const j = JSON.parse(text) as { name?: string; version?: string; displayName?: string }
            if (j && (j.name || j.displayName)) {
              packageJson = { name: j.name ?? '', version: j.version ?? '', displayName: j.displayName ?? j.name ?? '' }
            }
          } catch {
            /* 不是合法 JSON 就算了，不影响其余解析 */
          }
        }
      }
      buffered.clear()
      for (const g of Array.from(external)) if (guidSet.has(g)) external.delete(g)
      resolve({
        ok: true,
        entries: list,
        tree: renderTree(list),
        guidSet,
        externalRefs: external,
        hasEditorScript,
        hasShader,
        packageJson
      })
    }

    let input: fs.ReadStream
    try {
      input = fs.createReadStream(file)
    } catch (e) {
      done('读不到文件：' + (e instanceof Error ? e.message : String(e)))
      return
    }

    const gunzip = zlib.createGunzip()
    const parser = new tar.Parse({
      // tar v6：不消费 entry 流就自动跳过 —— 正好用来"读 pathname 不读 asset 主体"
      strict: false,
      onentry(entry: tar.ReadEntry): void {
        const rel = entry.path.replace(/\\/g, '/')
        /**
         * ⚠ **必须滤掉 `.`**：真 `.unitypackage` 的 tar 条目名带 `./` 前缀。
         * 实测 `jp.lilxyzw.liltoon-2.x.x-installer.unitypackage` 是 **12/12 条全带**：
         * `./`、`./4b344df74d4849e3b2c978b959abd31b/`、`./4b344df.../pathname`。
         *
         * `filter(Boolean)` **不会**去掉 `'.'`（它是真值），于是 `parts[0]` 恒为 `'.'`、
         * 所有条目的 pathname 都写进同一个键互相覆盖 —— 整个包**只解析出 1 条**、
         * 而且 guid 是错的。这是个预先存在的真 bug：`package_entry` 表里
         * 这类包的数据一直是错的，`resolve_guids` 的冲突扫描也会因此失效。
         */
        const parts = rel.split('/').filter((s) => s && s !== '.')
        const leaf = parts[parts.length - 1] ?? ''
        /** 结构是 `<guid>/pathname`；GUID 恒为首段，且规范就是 32 位 hex */
        const ownerGuid = normalizeGuid(parts[0] ?? '')
        if (!ownerGuid) {
          /**
           * 认不出 guid 的条目（tar 开头的 `./`、`./<guid>/` 目录项、`pax_global_header`）。
           * **必须 `resume()` 把这条流消费掉** —— tar v6 只在 entry 被消费或 resume 之后
           * 才推进下一条，直接 `return` 会让整个解析卡死（实测挂满 60 秒超时）。
           */
          entry.resume()
          return
        }

        processed++
        bytes += entry.size ?? 0
        if (processed % 40 === 0) opts.onProgress?.(processed, bytes)

        if (leaf === 'pathname') {
          let buf = ''
          entry.on('data', (c: Buffer) => {
            if (buf.length < 4096) buf += c.toString('utf8')
          })
          entry.on('end', () => {
            const up = buf.replace(/\\/g, '/').trim()
            if (up) pathnames.set(ownerGuid, up)
          })
          entry.resume()
          return
        }

        if (leaf === 'asset.meta') {
          let buf = ''
          entry.on('data', (c: Buffer) => {
            if (buf.length < META_HEAD) buf += c.toString('utf8')
          })
          entry.on('end', () => metaHeads.set(ownerGuid, buf))
          entry.resume()
          return
        }

        if (leaf === 'preview.png' || leaf === 'icon.png') {
          previews.add(ownerGuid)
          entry.resume()
          return
        }

        if (leaf === 'asset') {
          const size = entry.size ?? 0
          assetSizes.set(ownerGuid, size)
          /**
           * 这里不能依赖"pathname 已经读到"：tar 的 ReadEntry 是异步 end，
           * 同一个 guid 的 pathname 事件往往比 asset 晚一步完成（单测就是这么抓出来的）。
           * 所以先按"大小 + 全局预算"把正文留在内存里，最后再按 pathname 决定要不要扫 GUID。
           * 预算是硬上限，超了就只跳过后面的，不会把整包吸进内存。
           */
          if (scanRefs && size > 0 && size <= REF_SCAN_LIMIT && refBudget > 0) {
            refBudget -= size
            let buf = ''
            const cap = Math.min(size, REF_SCAN_LIMIT)
            entry.on('data', (c: Buffer) => {
              if (buf.length < cap) buf += c.toString('latin1')
            })
            entry.on('end', () => buffered.set(ownerGuid, buf))
            entry.resume()
            return
          }
          entry.resume() // 明确跳过主体，绝不落盘也不进内存
          return
        }
        entry.resume()
      }
    })

    // @types/tar 把 Parse.on 的重载收窄成只认 entry/end/close，
    // 但 Parse 实际是个 Transform，损坏包真的会发 error —— 只能这样绕一下类型
    const parserEvents = parser as unknown as NodeJS.EventEmitter
    parserEvents.on('error', (e: Error) => {
      done('tar 解析失败：' + e.message)
    })
    gunzip.on('error', (e: Error) => {
      done('不是有效的 gzip（.unitypackage 应为 gzip+tar）：' + e.message)
    })
    input.on('error', (e: Error) => done('读文件失败：' + e.message))
    parser.on('end', () => {
      if (!pathnames.size) {
        done(processed === 0 ? '包里没有任何条目' : '包里没有 pathname 条目，不像 .unitypackage')
        return
      }
      if (pathnames.size > maxEntries) {
        // 截断而不是失败：大包列前 N 条，UI 上说明还有多少
        const all = Array.from(pathnames.keys()).sort()
        for (const g of all.slice(maxEntries)) pathnames.delete(g)
      }
      opts.onProgress?.(processed, bytes)
      done()
    })

    input.pipe(gunzip).pipe(parser)
  })
}

/** 从解析结果里挑封面（有 preview.png 的条目优先） */
export function pickPackageCover(result: PackageParseResult): string | null {
  const withPreview = result.entries.find((e) => e.hasPreview)
  return withPreview ? withPreview.unityPath : null
}

export interface PackagePreview {
  bytes: Buffer
  /** 这张预览属于哪个工程路径（写日志/判断够不够格当封面要用） */
  unityPath: string
}

/** 预览图最大收多少：Booth 的宣传图一般几百 KB，8MB 已经到顶 */
const PREVIEW_MAX_BYTES = 8 * 1024 * 1024

/**
 * 从 .unitypackage 里取出**第一张** preview.png。
 *
 * VRChat 素材绝大多数是"一个 unitypackage，里面没有散图"（ABT 就是这样），
 * 只用目录里的图片当封面的话，这类素材永远是首字母方块。
 * 卖家放的 preview.png 就是他们自己选的封面，直接拿来用最合适。
 *
 * 为什么拿到第一张就走、不挑最大的：gzip 是顺序流，
 * 为了比较后面的预览得把整个包解压一遍 —— 500MB 的包要十几秒，
 * 启动时补封面绝不能干这种事。
 */
export async function extractPackagePreview(file: string): Promise<PackagePreview | null> {
  return new Promise<PackagePreview | null>((resolve) => {
    let settled = false
    let found: { guid: string; chunks: Buffer[]; size: number } | null = null
    const pathnames = new Map<string, string>()

    const done = (value: PackagePreview | null): void => {
      if (settled) return
      settled = true
      // 拿到图就掐断读流：不解压完整个包是这个函数存在的前提
      try {
        input.destroy()
        gunzip.destroy()
        ;(parser as unknown as { destroy?: () => void }).destroy?.()
      } catch {
        /* 已经关了 */
      }
      resolve(value)
    }

    let input: fs.ReadStream
    try {
      input = fs.createReadStream(file)
    } catch {
      done(null)
      return
    }
    const gunzip = zlib.createGunzip()
    const parser = new tar.Parse({
      strict: false,
      onentry(entry: tar.ReadEntry): void {
        if (found) return
        const rel = entry.path.replace(/\\/g, '/')
        /** 同 parseUnitypackage：真包的条目名带 `./` 前缀，必须滤掉 `.`（见那边的注释） */
        const parts = rel.split('/').filter((s) => s && s !== '.')
        const leaf = parts[parts.length - 1] ?? ''
        const guid = normalizeGuid(parts[0] ?? '')
        const size = entry.size ?? 0
        if (!guid) {
          /** 认不出 guid 的条目也要消费掉流，否则 tar 解析器会卡住 */
          entry.resume()
          return
        }

        if (leaf === 'pathname') {
          let buf = ''
          entry.on('data', (c: Buffer) => {
            if (buf.length < 4096) buf += c.toString('utf8')
          })
          entry.on('end', () => {
            const up = buf.replace(/\\/g, '/').trim()
            if (up) pathnames.set(guid, up)
          })
          entry.resume()
          return
        }

        if ((leaf === 'preview.png' || leaf === 'icon.png') && size >= 2048 && size <= PREVIEW_MAX_BYTES) {
          const chunks: Buffer[] = []
          let got = 0
          found = { guid, chunks, size }
          entry.on('data', (c: Buffer) => {
            if (!found) return
            got += c.length
            found.chunks.push(Buffer.from(c))
            if (got > PREVIEW_MAX_BYTES) done(null)
          })
          entry.on('end', () => {
            if (!found) return
            const bytes = Buffer.concat(found.chunks)
            const owner = found.guid
            found = null
            if (bytes.length >= 2048) done({ bytes, unityPath: pathnames.get(owner) ?? owner })
          })
          entry.on('error', () => done(null))
          return
        }
        entry.resume()
      }
    })
    parser.on('end', () => done(null))
    // @types/tar 把 Parse.on 的重载收窄成只认 entry/end/close，但它其实是个 Transform
    ;(parser as unknown as NodeJS.EventEmitter).on('error', () => done(null))
    gunzip.on('error', () => done(null))
    input.on('error', () => done(null))
    input.pipe(gunzip).pipe(parser)
  })
}
