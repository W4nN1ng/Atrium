import { net } from 'electron'
import type { Readable } from 'node:stream'
import type { VpmHttpTransport, VpmHttpTransportRequest, VpmHttpTransportResponse } from './types'

/**
 * Electron net 适配器。
 *
 * - `credentials:'omit'` + `useSessionCookies:false`：不发/不存 Cookie；
 * - `redirect:'manual'`：每一跳都通过 onRedirect 校验，合法才 followRedirect；
 * - 证书校验保持默认开启，不提供忽略错误的选项；
 * - 系统代理由 Electron net 负责。
 */
export function createElectronHttpTransport(): VpmHttpTransport {
  return {
    request(input: VpmHttpTransportRequest): Promise<VpmHttpTransportResponse> {
      return new Promise<VpmHttpTransportResponse>((resolve, reject) => {
        let settled = false
        let redirectError: unknown = null

        let request: ReturnType<typeof net.request>
        try {
          request = net.request({
            method: 'GET',
            url: input.url,
            headers: input.headers,
            redirect: 'manual',
            credentials: 'omit',
            useSessionCookies: false,
            referrerPolicy: 'no-referrer'
          })
        } catch (error) {
          reject(error)
          return
        }

        const cleanupSignal = (): void => {
          input.signal.removeEventListener('abort', onAbort)
        }
        if (input.signal.aborted) {
          try {
            request.abort()
          } catch {
            /* already closed */
          }
          reject(new Error('aborted'))
          return
        }
        const settleReject = (error: unknown): void => {
          if (settled) return
          settled = true
          cleanupSignal()
          reject(error)
        }
        const settleResolve = (response: VpmHttpTransportResponse): void => {
          if (settled) return
          settled = true
          resolve(response)
        }
        const onAbort = (): void => {
          try {
            request.abort()
          } catch {
            /* already closed */
          }
          settleReject(redirectError ?? new Error('aborted'))
        }

        input.signal.addEventListener('abort', onAbort, { once: true })

        request.on('redirect', (statusCode, _method, redirectUrl, responseHeaders) => {
          try {
            input.onRedirect?.({ status: statusCode, url: redirectUrl, headers: responseHeaders })
            request.followRedirect()
          } catch (error) {
            redirectError = error
            try {
              request.abort()
            } catch {
              /* already closed */
            }
            settleReject(error)
          }
        })

        request.on('response', (response) => {
          const body = response as unknown as Readable
          body.once('end', cleanupSignal)
          body.once('close', cleanupSignal)
          response.once('aborted', cleanupSignal)
          settleResolve({
            status: response.statusCode,
            headers: response.headers,
            body
          })
        })

        request.on('error', (error) => settleReject(redirectError ?? error))
        request.on('abort', () => settleReject(redirectError ?? new Error('aborted')))

        try {
          request.end()
        } catch (error) {
          settleReject(error)
        }
      })
    }
  }
}
