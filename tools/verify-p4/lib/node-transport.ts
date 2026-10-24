import http from 'node:http'
import https from 'node:https'
import net from 'node:net'
import tls from 'node:tls'
import type { Readable } from 'node:stream'
import type {
  VpmHttpTransport,
  VpmHttpTransportRequest,
  VpmHttpTransportResponse
} from '../../../src/main/vpm/http'

/**
 * 验证用 Node 传输：和 Electron 适配器同一份 `VpmHttpTransport` 契约。
 *
 * - 逐跳跟随 3xx，并对每一跳调用 `onRedirect`（客户端用它做协议/跨源校验）；
 * - 走 `HTTPS_PROXY` 的 CONNECT 隧道（生产里由 Electron `net` 读系统代理）。
 *
 * 这不是产品代码，只用于 `tools/verify-p4` 的真实网络验证。
 */
function proxyUrl(): URL | null {
  const raw = process.env.HTTPS_PROXY ?? process.env.https_proxy ?? ''
  if (!raw) return null
  try {
    return new URL(raw)
  } catch {
    return null
  }
}

function connectViaProxy(proxy: URL, host: string, port: number): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const request = http.request({
      host: proxy.hostname,
      port: Number(proxy.port || 80),
      method: 'CONNECT',
      path: `${host}:${port}`,
      headers: { host: `${host}:${port}` },
      timeout: 20_000
    })
    request.on('connect', (response, socket) => {
      if (response.statusCode !== 200) {
        socket.destroy()
        reject(new Error(`proxy CONNECT ${response.statusCode}`))
        return
      }
      resolve(socket)
    })
    request.on('timeout', () => request.destroy(new Error('proxy CONNECT timeout')))
    request.on('error', reject)
    request.end()
  })
}

async function openOnce(
  url: URL,
  headers: Record<string, string>,
  signal: AbortSignal
): Promise<VpmHttpTransportResponse> {
  const port = Number(url.port || 443)
  const proxy = proxyUrl()
  const socket = proxy ? await connectViaProxy(proxy, url.hostname, port) : undefined

  return new Promise((resolve, reject) => {
    const request = https.request(
      {
        host: url.hostname,
        port,
        path: `${url.pathname}${url.search}`,
        method: 'GET',
        headers,
        signal,
        createConnection: socket
          ? () => tls.connect({ socket, servername: url.hostname })
          : undefined
      },
      (response) => {
        resolve({
          status: response.statusCode ?? 0,
          headers: response.headers as Record<string, string | string[] | undefined>,
          body: response as Readable
        })
      }
    )
    request.on('error', reject)
    request.end()
  })
}

export function createNodeTransport(): VpmHttpTransport {
  return {
    async request(input: VpmHttpTransportRequest): Promise<VpmHttpTransportResponse> {
      let current = new URL(input.url)
      for (let hop = 0; hop <= 5; hop++) {
        const response = await openOnce(current, input.headers, input.signal)
        if (response.status >= 300 && response.status < 400) {
          const location = response.headers.location
          const next = Array.isArray(location) ? location[0] : location
          response.body.destroy()
          if (!next) throw new Error(`redirect without location (${response.status})`)
          const absolute = new URL(next, current).href
          input.onRedirect?.({
            status: response.status,
            url: absolute,
            headers: Object.fromEntries(
              Object.entries(response.headers).map(([key, value]) => [
                key,
                Array.isArray(value) ? value : value === undefined ? [] : [value]
              ])
            )
          })
          current = new URL(absolute)
          continue
        }
        return response
      }
      throw new Error('too many redirects')
    }
  }
}
