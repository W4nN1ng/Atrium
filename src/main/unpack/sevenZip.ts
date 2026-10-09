import fs from 'node:fs'
import path from 'node:path'
import { execFile, spawn } from 'node:child_process'
import { decodeText } from './encoding'

/**
 * 7z / RAR 后端。
 *
 * 为什么不用 7zip-bin 完事：它只给 7za.exe，而 **7za 不含 RAR 解码器**；
 * 用户库里有 23 个 rar，其中 `6117553 Shinano_FaceAnimation.rar.rar` 还是验收件。
 * 解析顺序：自带 7z.exe → 已装 7-Zip → 已装 WinRAR → 7za 兜底（只能 zip/7z）。
 *
 * 所有列表输出都带 `-sccUTF-8`：实测不加时 7z 会把包内文件名按系统 ANSI 码页（这台机器是 936/GBK）
 * 吐出来，日文包名会变成一堆假象字节，"哪个编码不报错"根本判不出来。
 */

export interface ArchiveEntry {
  /** 用 / 分隔的包内路径 */
  path: string
  size: number
  isDir: boolean
  encrypted: boolean
}

export interface ListResult {
  entries: ArchiveEntry[]
  totalBytes: number
  encrypted: boolean
  backend: string
}

export class PasswordNeededError extends Error {
  readonly code = 'ingest.passwordNeeded'
  constructor(public archivePath: string) {
    super(`压缩包需要密码：${archivePath}`)
    this.name = 'PasswordNeededError'
  }
}

export class CorruptArchiveError extends Error {
  readonly code = 'ingest.corruptArchive'
  constructor(public archivePath: string, detail: string) {
    super(`压缩包损坏或格式不支持：${archivePath} —— ${detail}`)
    this.name = 'CorruptArchiveError'
  }
}

export interface SevenZipBackend {
  exe: string
  kind: '7z' | 'rar' | '7za'
  canHandleRar: boolean
}

const WINRAR_DIRS = ['C:\\Program Files\\WinRAR', 'C:\\Program Files (x86)\\WinRAR']
const SEVENZIP_DIRS = ['C:\\Program Files\\7-Zip', 'C:\\Program Files (x86)\\7-Zip']

function firstExisting(cands: string[]): string | null {
  for (const c of cands) {
    try {
      if (fs.statSync(c).isFile()) return c
    } catch {
      /* 不存在就下一个 */
    }
  }
  return null
}

let cached: SevenZipBackend | null = null

/** extraDirs 由主进程传入（打包后的 resources/bin）；本模块要能在 worker 里跑，不能 import electron */
export function resolveBackend(extraDirs: string[] = [], refresh = false): SevenZipBackend | null {
  if (cached && !refresh) return cached
  const bundled = extraDirs.map((d) => path.join(d, '7z.exe'))
  const installed = SEVENZIP_DIRS.map((d) => path.join(d, '7z.exe'))
  const b7 = firstExisting([...bundled, ...installed])
  if (b7) {
    cached = { exe: b7, kind: '7z', canHandleRar: true }
    return cached
  }
  const wr = firstExisting(WINRAR_DIRS.flatMap((d) => [path.join(d, 'UnRAR.exe'), path.join(d, 'Rar.exe')]))
  if (wr) {
    cached = { exe: wr, kind: 'rar', canHandleRar: true }
    return cached
  }
  const za = firstExisting([
    path.join(process.cwd(), 'node_modules', '7zip-bin', 'win', 'x64', '7za.exe'),
    path.join(path.dirname(process.execPath), 'resources', 'app.asar.unpacked', 'node_modules', '7zip-bin', 'win', 'x64', '7za.exe')
  ])
  if (za) {
    cached = { exe: za, kind: '7za', canHandleRar: false }
    return cached
  }
  return null
}

/** 列清单是纯本地 IO，两分钟还没完就是出问题了；解压不设限（大包本来就慢） */
const LIST_TIMEOUT_MS = 120_000

/**
 * 跑外部后端。
 *
 * stdin 必须是"立刻 EOF"的：遇到头部加密的 7z，后端会打印
 * `Enter password (will not be echoed):` 然后从 stdin 读密码。
 * execFile 默认给的是常开管道，于是进程永远挂着 —— 实测摄取会卡在
 * "正在读取包内清单"不动，7z.exe 变成孤儿进程（2026-10-04）。
 * 关掉 stdin 后 7z 立刻退出（code 255 + 那句提示），上层就能按"要密码"处理。
 */
function runBinary(
  exe: string,
  args: string[],
  opts: { timeoutMs?: number } = {}
): Promise<{ code: number; out: Buffer; err: Buffer }> {
  return new Promise((resolve, reject) => {
    const child = spawn(exe, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    const out: Buffer[] = []
    const err: Buffer[] = []
    let outLen = 0
    const MAX = 64 * 1024 * 1024
    let timer: NodeJS.Timeout | undefined
    let timedOut = false

    if (opts.timeoutMs) {
      timer = setTimeout(() => {
        timedOut = true
        try {
          child.kill()
        } catch {
          /* 已经退了 */
        }
      }, opts.timeoutMs)
    }

    child.stdout.on('data', (b: Buffer) => {
      outLen += b.length
      if (outLen <= MAX) out.push(b)
    })
    child.stderr.on('data', (b: Buffer) => {
      err.push(b)
    })
    child.on('error', (e) => {
      if (timer) clearTimeout(timer)
      const code = (e as NodeJS.ErrnoException).code
      reject(code === 'ENOENT' ? new Error('找不到解压后端：' + exe) : e)
    })
    child.on('close', (code) => {
      if (timer) clearTimeout(timer)
      if (timedOut) {
        reject(new Error(`解压后端超时未响应：${path.basename(exe)} ${args[0] ?? ''}`))
        return
      }
      resolve({ code: code ?? 1, out: Buffer.concat(out), err: Buffer.concat(err) })
    })
  })
}

const PASSWORD_HINT = /wrong password|password|encrypted|数据错误|密码/i
const CORRUPT_HINT = /data error|corrupt|broken|unexpected end|cannot open|unsupported method|headers error|不是压缩包/i

/**
 * 后端版本太旧、连我们传的参数都不认。
 *
 * 实测：`resolveBackend` 在"既没有自带 `resources/bin/7z.exe`、也没装 7-Zip"的机器上
 * 会退到 `7zip-bin` 的 `7za.exe`，而它不认 `-sccUTF-8` 与 `-bso1`，
 * 于是 7z 只回一句「未知选项」，退出码非 0。上层按退出码判就会报成
 * **"压缩包损坏或格式不支持"** —— 那是一句假话：包是好的，坏的是解压组件。
 * 用户照着"包坏了"去折腾，永远折腾不出来。
 *
 * 所以这里单独一类，界面能如实说"解压组件不对，请重装 A 或安装 7-Zip"。
 */
export class BackendUnsupportedError extends Error {
  constructor(
    readonly exe: string,
    readonly detail: string
  ) {
    super(`解压后端版本过旧，不认识必需的参数：${exe}`)
    this.name = 'BackendUnsupportedError'
  }
}

const UNSUPPORTED_OPT_RE = /未知选项|unknown option|invalid switch/i

/** 解析 `7z l -slt -ba -sccUTF-8` 的键值块；目录看 Folder = + 而不是 Attributes */
export function parseSltListing(text: string): ArchiveEntry[] {
  const entries: ArchiveEntry[] = []
  let cur: Partial<ArchiveEntry> = {}
  const flush = (): void => {
    if (cur.path) {
      entries.push({
        path: cur.path.replace(/\\/g, '/'),
        size: Number(cur.size ?? 0),
        isDir: !!cur.isDir,
        encrypted: !!cur.encrypted
      })
    }
    cur = {}
  }
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (line === '') {
      flush()
      continue
    }
    const eq = line.indexOf(' = ')
    if (eq < 0) continue
    const key = line.slice(0, eq)
    const val = line.slice(eq + 3)
    switch (key) {
      case 'Path':
        flush()
        cur.path = val
        break
      case 'Size':
        cur.size = Number(val.replace(/[^\d-]/g, '')) || 0
        break
      case 'Folder':
        cur.isDir = val === '+'
        break
      case 'Encrypted':
        cur.encrypted = val === '+'
        break
      default:
        break
    }
  }
  flush()
  return entries.filter((e) => e.path)
}

export interface BackendOptions {
  extraBackendDirs?: string[]
  /**
   * 头部加密（-mhe）的 7z/rar 连"包里有几个文件"都要密码才读得出来，
   * 所以列清单这一步也得拿到密码，否则用户输对了也永远停在"需要密码"。
   * 注意 7z 只支持命令行传密码，同机其他用户能在工作进程列表里看到它。
   */
  password?: string
}

function requireBackend(opts: BackendOptions): SevenZipBackend {
  const b = resolveBackend(opts.extraBackendDirs ?? [])
  if (!b) throw new Error('没有可用的解压后端：自带 7z.exe 不在，也没找到已安装的 7-Zip / WinRAR')
  return b
}

/** 只列目录不解压 —— 默认路径（省空间）下的指纹分析就靠它 */
export async function listArchive(file: string, opts: BackendOptions = {}): Promise<ListResult> {
  const backend = requireBackend(opts)
  if (!backend.canHandleRar && /\.rar$/i.test(file)) {
    throw new Error('当前解压后端（7za）不含 RAR 解码器，请安装 7-Zip 或 WinRAR')
  }
  const pw = opts.password ? [`-p${opts.password}`] : []
  const r = await runBinary(backend.exe, ['l', '-slt', '-ba', '-y', '-sccUTF-8', ...pw, file], { timeoutMs: LIST_TIMEOUT_MS })
  const text = decodeText(r.out).text
  const blob = text + decodeText(r.err).text
  if (r.code !== 0) {
    if (PASSWORD_HINT.test(blob)) throw new PasswordNeededError(file)
    /** 「未知选项」必须在"包坏了"之前判，否则一句假话把用户支到别处去 */
    if (UNSUPPORTED_OPT_RE.test(blob)) throw new BackendUnsupportedError(backend.exe, blob.slice(0, 200))
    throw new CorruptArchiveError(file, blob.slice(0, 240) || `exit ${r.code}`)
  }
  const entries = parseSltListing(text)
  if (!entries.length) {
    // 有些版本 -slt 失败但普通 l 能出东西；至少别让调用方以为"空包"
    const plain = await runBinary(backend.exe, ['l', '-ba', '-y', '-sccUTF-8', ...pw, file], { timeoutMs: LIST_TIMEOUT_MS })
    const pt = decodeText(plain.out).text
    if (PASSWORD_HINT.test(pt)) throw new PasswordNeededError(file)
  }
  return {
    entries,
    totalBytes: entries.reduce((a, e) => a + (e.isDir ? 0 : e.size), 0),
    encrypted: entries.some((e) => e.encrypted),
    backend: backend.exe
  }
}

export interface ExtractOptions extends BackendOptions {
  password?: string
  /** 只解这些路径前缀（按需解压） */
  only?: string[]
  onProgress?: (percent: number, current: string) => void
  signal?: AbortSignal
}

/** 解压到 destDir —— 调用方保证 destDir 在 staging 内，绝不直接解到库目录（第 1 份 §12 坑 4） */
export function extractArchive(file: string, destDir: string, opts: ExtractOptions = {}): Promise<{ files: number; bytes: number }> {
  if (opts.only && opts.only.length === 0) {
    /**
     * 和 `extractZip` 同一条闸门：`only: []` 是"调用方漏传"，不是"解全部"。
     * 7z 少写成员参数就是把整包摊开，而这个 destDir 通常在暂存目录里。
     */
    return Promise.resolve({ files: 0, bytes: 0 })
  }
  const backend = requireBackend(opts)
  if (!backend.canHandleRar && /\.rar$/i.test(file)) {
    return Promise.reject(new Error('当前解压后端（7za）不含 RAR 解码器'))
  }
  fs.mkdirSync(destDir, { recursive: true })

  const args: string[] = ['x', '-y', '-bso1', '-bsp1', `-o${destDir}`]
  if (opts.password) args.push(`-p${opts.password}`)
  args.push(file)
  if (opts.only?.length) args.push(...opts.only)

  return new Promise((resolve, reject) => {
    const child = execFile(backend.exe, args, { windowsHide: true, maxBuffer: 8 * 1024 * 1024, encoding: 'buffer' }, (e, outBuf, errBuf) => {
      const out = decodeText(outBuf as unknown as Buffer).text
      const errText = decodeText(errBuf as unknown as Buffer).text
      const blob = out + errText
      const code = e ? Number((e as { code?: unknown }).code ?? 1) : 0
      if (code !== 0) {
        if (PASSWORD_HINT.test(blob)) reject(new PasswordNeededError(file))
        else if (UNSUPPORTED_OPT_RE.test(blob)) reject(new BackendUnsupportedError(backend.exe, blob.slice(0, 200)))
        else reject(new CorruptArchiveError(file, blob.slice(-300) || String(e?.message ?? '')))
        return
      }
      const counted = countTree(destDir)
      resolve(counted)
    })

    // 同上：不喂 stdin 就立刻关掉，否则没给密码的加密包会让 7z 卡在交互提示上
    try {
      child.stdin?.end()
    } catch {
      /* 已经关了 */
    }

    if (opts.onProgress && child.stdout) {
      let rest = ''
      child.stdout.on('data', (chunk: Buffer) => {
        const s = rest + decodeText(chunk).text
        const lines = s.split(/\r?\n/)
        rest = lines.pop() ?? ''
        for (const line of lines) {
          const m = /^\s*(\d+)%.*?\s-\s(.*)$/.exec(line)
          if (m) opts.onProgress?.(Math.min(1, Number(m[1]) / 100), m[2])
        }
      })
    }
    if (opts.signal) {
      opts.signal.addEventListener(
        'abort',
        () => {
          try {
            child.kill()
          } catch {
            /* 已经退了 */
          }
        },
        { once: true }
      )
    }
  })
}

export function countTree(dir: string): { files: number; bytes: number } {
  let files = 0
  let bytes = 0
  const stack = [dir]
  while (stack.length) {
    const d = stack.pop() as string
    let list: fs.Dirent[]
    try {
      list = fs.readdirSync(d, { withFileTypes: true })
    } catch {
      continue
    }
    for (const e of list) {
      const p = path.join(d, e.name)
      if (e.isDirectory()) stack.push(p)
      else {
        files++
        try {
          bytes += fs.statSync(p).size
        } catch {
          /* 忽略 */
        }
      }
    }
  }
  return { files, bytes }
}
