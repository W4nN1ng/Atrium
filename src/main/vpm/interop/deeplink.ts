import path from 'node:path'
import { assertHttpsUrl } from '../http'

/**
 * 深链解析（P7-E）。
 *
 * 只有两种意图会被接受：
 * - `atrium://open?path=<绝对路径>` → 打开工程（仍然只是"选中"，不自动启动 Unity）
 * - `atrium://add-repo?url=<https>` / `vcc://vpm/addRepo?url=<https>` → **待确认**的加仓库
 *
 * 铁律：
 * - **不从深链接收凭据**：出现 `headers` / `token` / `authorization` / `password` 之类参数
 *   一律拒绝整条链接（不是忽略那几个参数）；
 * - `vcc://` 只有用户显式接管后才处理，这里只解析，不落库；
 * - 未知 host / scheme 返回 `unknown`，由界面忽略。
 */

export type DeepLinkIntent =
  | { kind: 'open-project'; path: string }
  | { kind: 'add-repo'; url: string; name: string | null; source: 'atrium' | 'vcc' }
  | { kind: 'unknown'; raw: string }

export type DeepLinkRejection = 'badScheme' | 'badUrl' | 'credentials' | 'notAbsolutePath'

export interface DeepLinkResult {
  intent: DeepLinkIntent | null
  rejection: DeepLinkRejection | null
}

/** 这些参数一旦出现，整条链接作废——深链不是传密钥的通道。 */
const CREDENTIAL_KEYS = [
  'headers',
  'header',
  'token',
  'access_token',
  'authorization',
  'auth',
  'password',
  'secret',
  'cookie'
]

function hasCredentials(url: URL): boolean {
  for (const key of url.searchParams.keys()) {
    if (CREDENTIAL_KEYS.includes(key.toLowerCase())) return true
  }
  return false
}

export function parseDeepLink(raw: string): DeepLinkResult {
  const text = typeof raw === 'string' ? raw.trim() : ''
  if (!text) return { intent: null, rejection: 'badUrl' }

  let url: URL
  try {
    url = new URL(text)
  } catch {
    return { intent: null, rejection: 'badUrl' }
  }
  const scheme = url.protocol.toLowerCase()
  if (scheme !== 'atrium:' && scheme !== 'vcc:') {
    return { intent: null, rejection: 'badScheme' }
  }
  if (hasCredentials(url)) return { intent: null, rejection: 'credentials' }

  // `atrium://open?path=...` 里 host 是 open；`vcc://vpm/addRepo` 里 host 是 vpm。
  const host = url.hostname.toLowerCase()
  const pathname = url.pathname.replace(/^\/+/, '').toLowerCase()

  if (scheme === 'atrium:' && host === 'open') {
    const target = url.searchParams.get('path')?.trim() ?? ''
    if (!target || !path.isAbsolute(target)) return { intent: null, rejection: 'notAbsolutePath' }
    return { intent: { kind: 'open-project', path: target }, rejection: null }
  }

  const isRepoLink =
    (scheme === 'atrium:' && host === 'add-repo') ||
    (scheme === 'vcc:' && host === 'vpm' && pathname === 'addrepo')

  if (isRepoLink) {
    const repoUrl = url.searchParams.get('url')?.trim() ?? ''
    if (!repoUrl) return { intent: null, rejection: 'badUrl' }
    try {
      assertHttpsUrl(repoUrl)
    } catch {
      return { intent: null, rejection: 'badUrl' }
    }
    const name = url.searchParams.get('name')?.trim() ?? ''
    return {
      intent: {
        kind: 'add-repo',
        url: repoUrl,
        name: name ? name.slice(0, 200) : null,
        source: scheme === 'vcc:' ? 'vcc' : 'atrium'
      },
      rejection: null
    }
  }

  return { intent: { kind: 'unknown', raw: text }, rejection: null }
}

/** 从 argv 里挑出深链（第二实例会把整条命令行交过来）。 */
export function deepLinksInArgv(argv: readonly string[]): string[] {
  return argv.filter((arg) => /^(atrium|vcc):\/\//i.test(arg))
}
