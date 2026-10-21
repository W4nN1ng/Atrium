import { VpmError } from '../../../shared/vpm/errors'

const FORBIDDEN_HEADERS = new Set([
  'cookie',
  'set-cookie',
  'host',
  'content-length',
  'connection',
  'transfer-encoding',
  'upgrade'
])
const HEADER_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/

/** 只接受普通 HTTPS 绝对 URL；不接受 userinfo、非 https、超长/控制字符。 */
export function assertHttpsUrl(raw: string): URL {
  if (typeof raw !== 'string') throw new VpmError('vpmHttpBlocked')
  if (!raw || raw.length > 4096 || /[\u0000-\u001f\u007f]/.test(raw)) {
    throw new VpmError('vpmHttpBlocked')
  }

  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new VpmError('vpmHttpBlocked')
  }
  if (url.protocol !== 'https:' || !url.hostname) throw new VpmError('vpmHttpBlocked')
  if (url.username || url.password) throw new VpmError('vpmHttpBlocked')
  url.hash = ''
  return url
}

export function sameOrigin(a: string | URL, b: string | URL): boolean {
  const left = a instanceof URL ? a : new URL(a)
  const right = b instanceof URL ? b : new URL(b)
  return left.origin === right.origin
}

function safeHeaderValue(name: string, value: unknown): string {
  if (typeof value !== 'string') throw new VpmError('vpmHttpBlocked')
  if (value.length > 8192 || /[\r\n\u0000]/.test(value)) throw new VpmError('vpmHttpBlocked')
  if (!name || name.length > 100) throw new VpmError('vpmHttpBlocked')
  return value
}

/**
 * 生成请求头：强制 UA、JSON Accept、条件头；禁止 Cookie/Host 等。
 * 自定义头只用于 P7 的私有仓库；当前没有调用方。
 */
export function buildRequestHeaders(input: {
  userAgent: string
  acceptJson: boolean
  etag?: string | null
  lastModified?: string | null
  extra?: Record<string, string>
}): Record<string, string> {
  const headers: Record<string, string> = {
    'User-Agent': safeHeaderValue('User-Agent', input.userAgent),
    Accept: input.acceptJson ? 'application/json' : 'application/octet-stream, */*'
  }
  if (input.etag) headers['If-None-Match'] = safeHeaderValue('If-None-Match', input.etag)
  if (input.lastModified) {
    headers['If-Modified-Since'] = safeHeaderValue('If-Modified-Since', input.lastModified)
  }

  for (const [name, value] of Object.entries(input.extra ?? {})) {
    const lower = name.toLowerCase()
    if (!HEADER_NAME.test(name) || FORBIDDEN_HEADERS.has(lower)) {
      throw new VpmError('vpmHttpBlocked')
    }
    // UA/Accept 由客户端强制；自定义同名头不允许覆盖/制造重复键。
    if (lower === 'user-agent' || lower === 'accept') continue
    headers[name] = safeHeaderValue(name, value)
  }

  // 自定义头不能把 UA/Accept 换掉；Cookie 永远不出现。
  headers['User-Agent'] = safeHeaderValue('User-Agent', input.userAgent)
  headers.Accept = input.acceptJson ? 'application/json' : 'application/octet-stream, */*'
  delete headers.Cookie
  delete headers.cookie
  return headers
}

export function headerValue(
  headers: Record<string, string | string[] | undefined>,
  name: string
): string | undefined {
  const wanted = name.toLowerCase()
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() !== wanted) continue
    if (Array.isArray(value)) return value[0]
    return value
  }
  return undefined
}
