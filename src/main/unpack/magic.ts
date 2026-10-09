import fs from 'node:fs'
import path from 'node:path'

/**
 * 用文件头字节判定真实格式，**不吃扩展名**。
 * 用户库里真有 `6117553 Shinano_FaceAnimation.rar.rar`（双重扩展名）和
 * 扩展名与内容不符的包，按扩展名判断一定会翻车（第 1 份 §12 坑 3）。
 */

export type Format =
  | 'zip'
  | 'rar'
  | 'sevenz'
  | 'gzip'
  | 'bzip2'
  | 'xz'
  | 'zstd'
  | 'tar'
  | 'pdf'
  | 'png'
  | 'jpeg'
  | 'gif'
  | 'bmp'
  | 'webp'
  | 'psd'
  | 'ico'
  | 'exe'
  | 'lnk'
  | 'ole'
  | 'blend'
  | 'unity-asset'
  | 'audio'
  | 'video'
  | 'html'
  | 'ini'
  | 'text'
  | 'cab'
  | 'unknown'

export interface ProbeResult {
  format: Format
  /** rar4 / rar5 / unitypackage-gzip / internet-shortcut 之类 */
  subtype: string | null
  /** 是不是需要解压的容器 */
  isArchive: boolean
  /** 分卷（.part1.rar / .z01 / .7z.001），交给后端整组处理 */
  splitVolume: boolean
  /** 扩展名与真实内容不符 —— 日志与 UI 要提示 */
  extMismatch: boolean
  label: string
}

const ARCHIVE_FORMATS: ReadonlySet<Format> = new Set(['zip', 'rar', 'sevenz', 'gzip', 'bzip2', 'xz', 'zstd', 'tar', 'cab'])

const SPLIT_PATTERNS: RegExp[] = [
  /\.part\d+\.rar$/i,
  /\.r\d{2,3}$/i,
  /\.z\d{2,3}$/i,
  /\.(?:7z|zip|tar|gz)\.\d{3}$/i,
  /\.(?:001|002)$/i
]

function startsWith(buf: Buffer, sig: number[], offset = 0): boolean {
  if (buf.length < offset + sig.length) return false
  for (let i = 0; i < sig.length; i++) if (buf[offset + i] !== sig[i]) return false
  return true
}

function ascii(buf: Buffer, n: number): string {
  return buf.toString('latin1', 0, Math.min(n, buf.length))
}

/** tar 的 magic 在偏移 257，不在开头 */
function isTar(buf: Buffer): boolean {
  return startsWith(buf, [0x75, 0x73, 0x74, 0x61, 0x72], 257) // "ustar"
}

export function probeBuffer(buf: Buffer, fileName?: string): ProbeResult {
  const ext = fileName ? path.extname(fileName).toLowerCase() : ''
  const base: Omit<ProbeResult, 'format' | 'subtype' | 'label'> = {
    isArchive: false,
    splitVolume: !!fileName && SPLIT_PATTERNS.some((re) => re.test(fileName)),
    extMismatch: false
  }
  const make = (format: Format, subtype: string | null, label: string): ProbeResult =>
    withExtMismatch(
      {
        format,
        subtype,
        isArchive: ARCHIVE_FORMATS.has(format),
        splitVolume: base.splitVolume,
        extMismatch: false,
        label
      },
      fileName ?? ''
    )

  if (buf.length === 0) return make('unknown', null, 'Empty')

  if (startsWith(buf, [0x50, 0x4b, 0x03, 0x04]) || startsWith(buf, [0x50, 0x4b, 0x05, 0x06]) || startsWith(buf, [0x50, 0x4b, 0x07, 0x08]))
    return make('zip', null, 'ZIP')
  if (startsWith(buf, [0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x01, 0x00])) return make('rar', 'rar5', 'RAR5')
  if (startsWith(buf, [0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x00])) return make('rar', 'rar4', 'RAR4')
  if (startsWith(buf, [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c])) return make('sevenz', null, '7-Zip')
  if (startsWith(buf, [0x1f, 0x8b])) {
    // .unitypackage 就是 gzip 套 tar；扩展名对上时给个更具体的 subtype
    const sub = ext === '.unitypackage' ? 'unitypackage-gzip' : null
    return make('gzip', sub, sub ? 'UnityPackage (gzip+tar)' : 'gzip')
  }
  if (startsWith(buf, [0x42, 0x5a, 0x68])) return make('bzip2', null, 'bzip2')
  if (startsWith(buf, [0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00])) return make('xz', null, 'xz')
  if (startsWith(buf, [0x28, 0xb5, 0x2f, 0xfd])) return make('zstd', null, 'zstd')
  if (isTar(buf)) return make('tar', null, 'tar')
  if (startsWith(buf, [0x4d, 0x53, 0x43, 0x46])) return make('cab', null, 'CAB')

  if (startsWith(buf, [0x25, 0x50, 0x44, 0x46])) return make('pdf', null, 'PDF')
  if (startsWith(buf, [0x89, 0x50, 0x4e, 0x47])) return make('png', null, 'PNG')
  if (startsWith(buf, [0xff, 0xd8, 0xff])) return make('jpeg', null, 'JPEG')
  if (startsWith(buf, [0x47, 0x49, 0x46, 0x38])) return make('gif', null, 'GIF')
  if (startsWith(buf, [0x42, 0x4d])) return make('bmp', null, 'BMP')
  if (startsWith(buf, [0x38, 0x42, 0x50, 0x53])) return make('psd', null, 'Photoshop PSD')
  if (startsWith(buf, [0x00, 0x00, 0x01, 0x00])) return make('ico', null, 'ICO')
  if (startsWith(buf, [0x52, 0x49, 0x46, 0x46]) && buf.length >= 12 && buf.toString('latin1', 8, 12) === 'WEBP')
    return make('webp', null, 'WebP')
  if (startsWith(buf, [0x52, 0x49, 0x46, 0x46]) && buf.length >= 12 && buf.toString('latin1', 8, 12) === 'WAVE')
    return make('audio', 'wav', 'WAV')
  if (startsWith(buf, [0x4f, 0x67, 0x67, 0x53])) return make('audio', 'ogg', 'Ogg')
  if (startsWith(buf, [0x66, 0x4c, 0x61, 0x43])) return make('audio', 'flac', 'FLAC')
  if (startsWith(buf, [0x49, 0x44, 0x33]) || startsWith(buf, [0xff, 0xfb]) || startsWith(buf, [0xff, 0xf3]) || startsWith(buf, [0xff, 0xf2]))
    return make('audio', 'mp3', 'MP3')
  if (buf.length >= 12 && buf.toString('latin1', 4, 8) === 'ftyp') return make('video', 'mp4', 'MP4')
  if (startsWith(buf, [0x1a, 0x45, 0xdf, 0xa3])) return make('video', 'mkv', 'Matroska')

  if (startsWith(buf, [0x4d, 0x5a])) return make('exe', null, 'EXE')
  if (startsWith(buf, [0x4c, 0x00, 0x00, 0x00, 0x01, 0x14, 0x02, 0x00])) return make('lnk', null, 'LNK')
  if (startsWith(buf, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) return make('ole', null, 'OLE')
  if (startsWith(buf, [0x42, 0x4c, 0x45, 0x4e, 0x44, 0x45, 0x52])) return make('blend', null, 'Blender')

  const head = ascii(buf, 512)
  if (head.startsWith('--- !u!')) return make('unity-asset', 'yaml', 'Unity YAML')
  if (/^\[InternetShortcut\]/i.test(head)) return make('ini', 'internet-shortcut', 'Windows Internet Shortcut (.url)')
  if (/^\s*<(!doctype|html|\?xml)/i.test(head)) return make('html', null, 'HTML')
  if (startsWith(buf, [0xef, 0xbb, 0xbf])) return make('text', 'utf8-bom', 'UTF-8 Text')
  if (startsWith(buf, [0xff, 0xfe]) || startsWith(buf, [0xfe, 0xff])) return make('text', 'utf16', 'UTF-16 Text')
  // 全可打印 + 常见空白 → 当文本处理（readme/txt/ini）
  const printableRatio = (() => {
    let ok = 0
    const n = Math.min(buf.length, 512)
    for (let i = 0; i < n; i++) {
      const c = buf[i]
      if (c === 0x09 || c === 0x0a || c === 0x0d || (c >= 0x20 && c <= 0x7e) || c >= 0x80) ok++
    }
    return n ? ok / n : 0
  })()
  if (printableRatio > 0.95) return make('text', null, 'Text')

  return make('unknown', null, 'Unknown')
}

/** 读文件头若干字节做判定（默认 1KB，够覆盖 tar 的 257 偏移） */
export async function probeFile(filePath: string, headBytes = 1024): Promise<ProbeResult> {
  let fd: fs.promises.FileHandle | null = null
  try {
    fd = await fs.promises.open(filePath, 'r')
    const buf = Buffer.alloc(headBytes)
    const { bytesRead } = await fd.read(buf, 0, headBytes, 0)
    const r = probeBuffer(buf.subarray(0, bytesRead), path.basename(filePath))
    return withExtMismatch(r, filePath)
  } catch (e) {
    return {
      format: 'unknown',
      subtype: null,
      isArchive: false,
      splitVolume: SPLIT_PATTERNS.some((re) => re.test(filePath)),
      extMismatch: false,
      label: e instanceof Error ? e.message : String(e)
    }
  } finally {
    await fd?.close()
  }
}

const EXT_TO_FORMAT: Record<string, Format[]> = {
  '.zip': ['zip'],
  '.rar': ['rar'],
  '.7z': ['sevenz'],
  '.gz': ['gzip'],
  '.tgz': ['gzip'],
  '.bz2': ['bzip2'],
  '.xz': ['xz'],
  '.tar': ['tar'],
  '.unitypackage': ['gzip'],
  '.pdf': ['pdf'],
  '.png': ['png'],
  '.jpg': ['jpeg'],
  '.jpeg': ['jpeg'],
  '.gif': ['gif'],
  '.bmp': ['bmp'],
  '.webp': ['webp'],
  '.psd': ['psd'],
  '.exe': ['exe'],
  '.dll': ['exe'],
  '.msi': ['exe'],
  '.url': ['ini'],
  '.lnk': ['lnk'],
  '.mp3': ['audio'],
  '.wav': ['audio'],
  '.ogg': ['audio'],
  '.mp4': ['video'],
  '.blend': ['blend'],
  '.anim': ['unity-asset'],
  '.prefab': ['unity-asset'],
  '.mat': ['unity-asset'],
  '.controller': ['unity-asset'],
  '.unity': ['unity-asset'],
  '.asset': ['unity-asset'],
  '.cs': ['text'],
  '.txt': ['text'],
  '.html': ['html'],
  '.htm': ['html']
}

/**
 * 扩展名 → 允许格式那份表的**键**。首启向导的目录探测拿它当"这里有没有 A 吃得下的东西"的准绳
 * （见 `ipc/system.ts` 的 `system:probe-directory`）。
 *
 * ⚠ 必须在 `EXT_TO_FORMAT` 下面（`const` 不提升，写在它上面会在模块求值时拿到 undefined）。
 * 另有一条规矩：探测不许自己再列一份扩展名清单 —— 两处各列一遍的话，以后加了格式，
 * 探测会说"这目录没素材"而摄取其实吃得下。
 */
export const SUPPORTED_INPUT_EXTS: string[] = Object.keys(EXT_TO_FORMAT)

export function isSupportedInputName(name: string): boolean {
  return SUPPORTED_INPUT_EXTS.includes(path.extname(name).toLowerCase())
}

/** 扩展名与真实内容不符时打个标记（xxx.rar.rar 不算不符，两个 .rar 都指向 rar） */
export function withExtMismatch(r: ProbeResult, filePath: string): ProbeResult {
  const ext = path.extname(filePath).toLowerCase()
  const expected = EXT_TO_FORMAT[ext]
  if (!expected) return r
  const ok = expected.includes(r.format) || (ext === '.unitypackage' && r.format === 'gzip')
  return { ...r, extMismatch: !ok }
}

/**
 * 分卷判定：除了文件名模式，还要能认出 .z01/.r00 这类首卷不在手边的情况。
 * 返回同组的所有卷（按名字排序），后端只喂首卷即可。
 */
/**
 * 分卷命名有三类：game.part1.rar（标记后面还带扩展名）、big.r00 / big.z03、x.7z.001。
 * 只用 `\.(part\d+|...)$` 会漏掉第一类 —— 写测试时实测到的。
 */
function splitInfo(name: string): { base: string; marker: string } | null {
  let m = /^(.*?)\.part(\d+)\.(rar|zip|7z|tar|gz)$/i.exec(name)
  if (m) return { base: m[1], marker: 'part' + m[2] }
  m = /^(.*?)\.(z\d{2,3}|r\d{2,3})$/i.exec(name)
  if (m) return { base: m[1], marker: m[2].toLowerCase() }
  m = /^(.*?)\.(\d{3})$/i.exec(name)
  if (m) return { base: m[1], marker: m[2] }
  return null
}

export function findSplitSiblings(filePath: string): string[] {
  const dir = path.dirname(filePath)
  const self = splitInfo(path.basename(filePath))
  if (!self) return [filePath]

  let files: string[] = []
  try {
    files = fs.readdirSync(dir)
  } catch {
    return [filePath]
  }
  const group = files
    .filter((f) => {
      const i = splitInfo(f)
      return !!i && i.base.toLowerCase() === self.base.toLowerCase()
    })
    .map((f) => path.join(dir, f))
  if (!group.length) return [filePath]

  const isHead = (p: string): boolean => {
    const i = splitInfo(path.basename(p))
    if (!i) return false
    return i.marker === 'part1' || i.marker === '001' || i.marker === 'z01'
  }
  const out: string[] = []
  // zip 分卷的真主卷是 .zip（.z01 只是续卷），有就排最前
  for (const ext of ['.zip', '.rar', '.7z']) {
    const main = path.join(dir, self.base + ext)
    if (fs.existsSync(main)) out.push(main)
  }
  const first = group.find(isHead)
  if (first) out.push(first)
  if (!out.length) out.push(filePath)
  return Array.from(new Set(out))
}
