import path from 'node:path'

/**
 * 路径安全。所有来自 IPC / 压缩包条目名 / 外部清单的路径都要先过这里。
 * 纯函数，不依赖 electron，方便单测。
 */

/** 这些位置的绝对不许被移动/删除/覆盖。注意不含 C:\Users —— 浏览器下载目录就在那儿，是合法来料口 */
const FORBIDDEN_PATTERNS: RegExp[] = [
  /^[a-z]:\\(windows|winnt|program files|program files \(x86\)|programdata)(\\|$)/,
  /^[a-z]:\\(\$recycle\.bin|system volume information|recovery|boot)(\\|$)/,
  /^[a-z]:\\(perf\.sys|pagefile\.sys|swapfile\.sys)$/
]

/** 也绝不许把这些盘符根当库根（会把整盘当素材库） */
const FORBIDDEN_ROOTS = ['c:\\', 'd:\\', 'e:\\', 'f:\\', 'g:\\']


export interface CheckResult {
  ok: boolean
  /** i18n key：界面按它出文案（第 1 份 F11 不许硬编码字符串） */
  code?: string
  params?: Record<string, string | number>
  /** 兜底原文，只进日志 */
  reason?: string
}

/** 去掉 \\?\ 前缀、统一分隔符、去尾部分隔符、小写，用于比较 */
export function normalizeForCompare(p: string): string {
  let s = p
  if (s.startsWith('\\\\?\\UNC\\')) s = '\\\\' + s.slice(8)
  else if (s.startsWith('\\\\?\\')) s = s.slice(4)
  s = s.replace(/[\/\\]/g, '\\')
  s = s.replace(/\\+$/, '')
  return s.toLowerCase()
}

export function isForbiddenTarget(p: string): boolean {
  const n = normalizeForCompare(p)
  if (!n) return true
  // UNC 与设备路径不在 v1 支持范围（第 1 份 §11 只验收本地盘）
  if (n.startsWith('\\\\')) return true
  return FORBIDDEN_PATTERNS.some((re) => re.test(n))
}

export function isForbiddenLibraryRoot(p: string): boolean {
  const n = normalizeForCompare(p)
  if (FORBIDDEN_ROOTS.includes(n)) return true
  // 裸盘符（没有尾部斜杠）也算
  return /^[a-z]:$/.test(n)
}

/** target 是否位于 root 之内（含 root 自身）；用分隔符边界比较，避免 E:\AB 命中 E:\A */
export function isInside(root: string, target: string): boolean {
  const r = normalizeForCompare(root)
  const t = normalizeForCompare(target)
  if (!r || !t) return false
  if (t === r) return true
  return t.startsWith(r + '\\')
}

export function assertInside(root: string, target: string): CheckResult {
  return isInside(root, target)
    ? { ok: true }
    : {
        ok: false,
        code: 'err.pathOutside',
        params: { target, root },
        reason: `路径越界：${target} 不在 ${root} 内`
      }
}

/**
 * 压缩包条目名拼到解压目标上 —— 必须挡 zip slip（../../.. 与绝对路径、盘符、UNC）。
 * 返回 null 表示这个条目名不可信，直接丢弃。
 */
export function safeJoin(destDir: string, entryName: string): string | null {
  if (!entryName) return null
  const cleaned = entryName.replace(/\\/g, '/')
  if (cleaned.startsWith('/')) return null
  if (/^[a-z]:/i.test(cleaned)) return null
  if (cleaned.startsWith('//')) return null
  const segments: string[] = []
  for (const part of cleaned.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') return null
    if (/[<>:"|?*]/.test(part)) return null
    if (/[\x00-\x1f]/.test(part)) return null
    segments.push(part)
  }
  if (!segments.length) return null
  const joined = path.join(destDir, ...segments)
  return assertInside(destDir, joined).ok ? joined : null
}

export interface IngestPathOptions {
  libraryRoot?: string | null
  /** 本程序自己的目录，绝不能当成来料摄取（会把 staging 吞进库里） */
  ownDirs: string[]
  /**
   * 库里已登记素材所在的目录（asset.library_path / source_path）。
   * 有了它才能区分两件完全不同的事：
   * 「把自己的产出再吞一遍」(要拒) 和「收编一个本来就在那儿的旧库」(要放行)。
   */
  registeredDirs?: string[]
}

/**
 * 库根下面的路径能不能摄取。
 *
 * 早先是一刀切：只要在 libraryRoot 里就拒（防自摄）。代价是"重新登记游离文件"
 * 这个功能**永远返回 accepted=0** —— 游离文件按定义就在库根下面。
 * 实测踩过：点完按钮提示"已丢进取物队列：10"，实际一条都没进去。
 */
function checkInsideLibrary(p: string, opts: IngestPathOptions): CheckResult | null {
  if (!opts.libraryRoot || !isInside(opts.libraryRoot, p)) return null
  // 没传登记清单 = 调用方没查过库，那就保持老的保守行为（宁可拒，不要把自己的产出吞了）
  if (!opts.registeredDirs) {
    return {
      ok: false,
      code: 'err.alreadyInLibrary',
      params: { path: p },
      reason: '已在库内，无需重复摄取'
    }
  }
  const norm = normalizeForCompare(p)
  const reg = opts.registeredDirs.map(normalizeForCompare).filter(Boolean)
  if (reg.some((r) => isInside(r, norm))) {
    return {
      ok: false,
      code: 'err.alreadyInLibrary',
      params: { path: p },
      reason: '已在库内，无需重复摄取'
    }
  }
  const swallowed = reg.filter((r) => isInside(norm, r)).length
  if (swallowed) {
    return {
      ok: false,
      code: 'err.containsRegistered',
      params: { path: p, count: swallowed },
      reason: '这个目录里已经有 ' + swallowed + ' 条登记过的素材，整吞会把它们一起搬走'
    }
  }
  return null
}

export function checkIngestPath(p: string, opts: IngestPathOptions): CheckResult {
  if (!p) return { ok: false, code: 'err.emptyPath', reason: '空路径' }
  if (!path.isAbsolute(p)) {
    return { ok: false, code: 'err.notAbsolute', params: { path: p }, reason: `不是绝对路径：${p}` }
  }
  if (isForbiddenTarget(p)) {
    return { ok: false, code: 'err.forbiddenTarget', params: { path: p }, reason: `系统目录不允许摄取：${p}` }
  }
  if (opts.ownDirs.some((d) => isInside(d, p) || isInside(p, d))) {
    return { ok: false, code: 'err.selfIngest', params: { path: p }, reason: '这是 A 自己的目录，不能自摄' }
  }
  const inside = checkInsideLibrary(p, opts)
  if (inside) return inside
  return { ok: true }
}

/** Windows 单段最长 255，整路径留余量；超长要提示而不是硬撞 */
export function isPathTooLong(p: string, limit = 240): boolean {
  return normalizeForCompare(p).length > limit
}

/** IPC 边界校验：只接受字符串数组，逐条查绝对性与危险性 */
export interface RejectedPath {
  path: string
  code?: string
  params?: Record<string, string | number>
  reason: string
}

export function sanitizePathList(
  input: unknown,
  opts: IngestPathOptions
): { accepted: string[]; rejected: RejectedPath[] } {
  const accepted: string[] = []
  const rejected: RejectedPath[] = []
  if (!Array.isArray(input)) return { accepted, rejected }
  for (const raw of input) {
    if (typeof raw !== 'string' || !raw.trim()) {
      rejected.push({
        path: String(raw),
        code: 'err.notStringPath',
        reason: '不是字符串路径'
      })
      continue
    }
    const resolved = path.win32.normalize(raw.trim())
    const check = checkIngestPath(resolved, opts)
    if (check.ok) accepted.push(resolved)
    else {
      rejected.push({
        path: resolved,
        code: check.code,
        params: check.params,
        reason: check.reason ?? '拒绝'
      })
    }
  }
  return { accepted, rejected }
}
