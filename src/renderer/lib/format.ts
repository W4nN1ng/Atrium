import type { LocaleKey } from '../../shared/types'

/** file:// URL：中文/日文路径与空格都要编码 */
export function fileUrl(absolutePath: string): string {
  const posix = absolutePath.replace(/\\/g, '/')
  const withSlash = posix.startsWith('/') ? '/' + posix : posix
  return 'file:///' + withSlash.replace(/^\/+/, '').split('/').map(encodeURIComponent).join('/')
}

/** 数字/日期/文件大小一律用 Intl（第 1 份 F11） */
export function humanBytes(bytes: number | null | undefined, locale: LocaleKey): string {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes)) return '—'
  // CLDR 的单位名是 'byte' 不是 'bytes' —— 写错时 Intl 直接抛 RangeError，
  // 而小于 1KB 的文件恰好走这一档，整个收件箱会白屏（2026-10-04 实测踩过）。
  const units = ['byte', 'kilobyte', 'megabyte', 'gigabyte', 'terabyte']
  const value = bytes < 1 ? 0 : bytes
  let size = value
  let unit = 0
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024
    unit++
  }
  const nf = new Intl.NumberFormat(intlLocale(locale), {
    style: 'unit',
    unit: units[unit],
    unitDisplay: 'narrow',
    maximumFractionDigits: unit === 0 ? 0 : 1
  })
  return nf.format(size)
}

export function humanNumber(n: number, locale: LocaleKey): string {
  return new Intl.NumberFormat(intlLocale(locale)).format(n)
}

export function humanDate(ms: number | null | undefined, locale: LocaleKey): string {
  if (!ms) return '—'
  return new Intl.DateTimeFormat(intlLocale(locale), {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }).format(new Date(ms))
}

export function relativeTime(ms: number, locale: LocaleKey): string {
  const diff = Date.now() - ms
  const rtf = new Intl.RelativeTimeFormat(intlLocale(locale), { numeric: 'auto' })
  const min = Math.round(diff / 60000)
  if (Math.abs(min) < 60) return rtf.format(-min, 'minute')
  const hr = Math.round(min / 60)
  if (Math.abs(hr) < 24) return rtf.format(-hr, 'hour')
  return rtf.format(-Math.round(hr / 24), 'day')
}

export function intlLocale(locale: LocaleKey): string {
  return locale === 'zh-CN' ? 'zh-CN' : locale === 'ja' ? 'ja-JP' : 'en-US'
}
