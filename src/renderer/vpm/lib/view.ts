import { msg } from '../../lib/msg'

export function repoHost(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

export function formatTimestamp(timestamp: number | null): string {
  if (timestamp === null || !Number.isFinite(timestamp)) return ''
  try {
    return new Date(timestamp).toLocaleString()
  } catch {
    return ''
  }
}

/** 纯文本渲染前去掉除换行/制表以外的 C0 控制字符。 */
export function cleanText(value: string | null | undefined, max = 4000): string {
  if (!value) return ''
  return value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').slice(0, max)
}

export function isHttpLink(value: string | null | undefined): value is string {
  if (!value || value.length > 4096) return false
  try {
    const url = new URL(value)
    return (
      (url.protocol === 'https:' || url.protocol === 'http:') &&
      !!url.hostname &&
      !url.username &&
      !url.password
    )
  } catch {
    return false
  }
}

export function repoErrorLabel(code: string | null): string {
  if (!code) return ''
  return msg(`vpm.errors.${code}`, undefined, code)
}
