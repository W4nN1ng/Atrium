import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import type { Readable } from 'node:stream'
import { VpmError } from '../../../shared/vpm/errors'
import { assertHttpsUrl, buildRequestHeaders, headerValue, sameOrigin } from './policy'
import {
  DEFAULT_VPM_HTTP_LIMITS,
  type VpmDownloadRequest,
  type VpmDownloadResult,
  type VpmHttpClientOptions,
  type VpmHttpLimits,
  type VpmHttpPort,
  type VpmHttpTransportResponse,
  type VpmJsonRequest,
  type VpmJsonResponse
} from './types'

interface ResponseHandle {
  response: VpmHttpTransportResponse
  ctx: RequestContext
  finalUrl: string
}

/**
 * 一次请求的计时/取消上下文。
 *
 * - 总超时覆盖重定向 + 响应体；
 * - 连接超时由 requestOnce 管；
 * - 空闲超时在响应开始后按数据块重置；
 * - 外部 AbortSignal 与超时都通过同一个 controller 中止。
 */
class RequestContext {
  private readonly controller = new AbortController()
  readonly signal = this.controller.signal
  readonly abortPromise: Promise<never>
  private totalTimer: ReturnType<typeof setTimeout> | null = null
  private idleTimer: ReturnType<typeof setTimeout> | null = null
  private idleStarted = false
  private timedOut = false
  private abortedByUser = false
  private onExternalAbort: (() => void) | null = null
  private readonly externalSignal?: AbortSignal

  constructor(external: AbortSignal | undefined, private readonly limits: VpmHttpLimits) {
    this.externalSignal = external
    let rejectAbort!: (reason: VpmError) => void
    this.abortPromise = new Promise<never>((_, reject) => {
      rejectAbort = reject
    })
    // abortPromise 在请求已经 resolve 后仍可能因空闲/总超时 reject；
    // 这里先挂一个空 catch，避免进程级 unhandledRejection。
    void this.abortPromise.catch(() => {})

    this.signal.addEventListener(
      'abort',
      () => rejectAbort(this.errorForAbort()),
      { once: true }
    )

    if (external?.aborted) {
      this.abortedByUser = true
      this.controller.abort()
    } else if (external) {
      this.onExternalAbort = () => {
        this.abortedByUser = true
        this.controller.abort()
      }
      external.addEventListener('abort', this.onExternalAbort, { once: true })
    }

    if (limits.totalTimeoutMs > 0) {
      this.totalTimer = setTimeout(() => {
        this.timedOut = true
        this.controller.abort()
      }, limits.totalTimeoutMs)
    }
  }

  errorForAbort(): VpmError {
    if (this.abortedByUser) return new VpmError('vpmHttpAborted')
    if (this.timedOut) return new VpmError('vpmHttpTimeout')
    return new VpmError('vpmHttpNetwork')
  }

  mapError(error: unknown): VpmError {
    if (error instanceof VpmError) return error
    if (this.abortedByUser) return new VpmError('vpmHttpAborted', undefined, error)
    if (this.timedOut) return new VpmError('vpmHttpTimeout', undefined, error)
    return new VpmError('vpmHttpNetwork', undefined, error)
  }

  startIdle(): void {
    this.idleStarted = true
    this.touch()
  }

  touch(): void {
    if (!this.idleStarted || this.limits.idleTimeoutMs <= 0) return
    if (this.idleTimer) clearTimeout(this.idleTimer)
    this.idleTimer = setTimeout(() => {
      this.timedOut = true
      this.controller.abort()
    }, this.limits.idleTimeoutMs)
  }

  abort(): void {
    this.controller.abort()
  }

  abortForTimeout(): void {
    this.timedOut = true
    this.controller.abort()
  }

  dispose(): void {
    if (this.totalTimer) clearTimeout(this.totalTimer)
    if (this.idleTimer) clearTimeout(this.idleTimer)
    this.totalTimer = null
    this.idleTimer = null
    if (this.externalSignal && this.onExternalAbort) {
      this.externalSignal.removeEventListener('abort', this.onExternalAbort)
    }
    this.onExternalAbort = null
  }
}

function readBuffer(body: Readable, maxBytes: number, ctx: RequestContext): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    let settled = false

    const cleanup = (): void => {
      ctx.signal.removeEventListener('abort', onAbort)
    }
    const fail = (error: VpmError): void => {
      if (settled) return
      settled = true
      cleanup()
      body.destroy()
      ctx.abort()
      reject(error)
    }
    const onAbort = (): void => fail(ctx.errorForAbort())

    if (ctx.signal.aborted) {
      fail(ctx.errorForAbort())
      return
    }
    ctx.signal.addEventListener('abort', onAbort, { once: true })

    body.on('data', (chunk: Buffer | string) => {
      if (settled) return
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      size += buffer.length
      if (size > maxBytes) {
        fail(new VpmError('vpmHttpTooLarge'))
        return
      }
      chunks.push(buffer)
      ctx.touch()
    })
    body.on('end', () => {
      if (settled) return
      settled = true
      cleanup()
      resolve(Buffer.concat(chunks))
    })
    body.on('error', (error) => fail(ctx.mapError(error)))
    body.on('aborted', () => fail(new VpmError('vpmHttpNetwork')))
    body.on('close', () => {
      if (!settled) fail(new VpmError('vpmHttpNetwork'))
    })
  })
}

async function requestOnce(
  transport: VpmHttpClientOptions['transport'],
  input: {
    url: string
    headers: Record<string, string>
    signal: AbortSignal
    onRedirect: (info: { status: number; url: string; headers: Record<string, string[]> }) => void
  },
  ctx: RequestContext,
  connectTimeoutMs: number
): Promise<VpmHttpTransportResponse> {
  if (ctx.signal.aborted) throw ctx.errorForAbort()

  const connectTimer =
    connectTimeoutMs > 0
      ? setTimeout(() => ctx.abortForTimeout(), connectTimeoutMs)
      : null

  const requestPromise = Promise.resolve().then(() => transport.request(input))
  requestPromise.catch(() => {})
  try {
    return await Promise.race([requestPromise, ctx.abortPromise])
  } catch (error) {
    throw ctx.mapError(error)
  } finally {
    if (connectTimer) clearTimeout(connectTimer)
  }
}

function redirectError(): VpmError {
  return new VpmError('vpmHttpRedirect')
}

function openResponse(
  transport: VpmHttpClientOptions['transport'],
  initial: URL,
  headers: Record<string, string>,
  customHeaders: boolean,
  opts: { signal?: AbortSignal },
  limits: VpmHttpLimits
): Promise<ResponseHandle> {
  const ctx = new RequestContext(opts.signal, limits)
  let finalUrl = initial.href
  let redirects = 0

  const onRedirect = (info: { status: number; url: string; headers: Record<string, string[]> }): void => {
    if (redirects >= limits.maxRedirects) throw redirectError()
    let next: URL
    try {
      next = assertHttpsUrl(new URL(info.url, finalUrl).href)
    } catch {
      throw redirectError()
    }
    if (customHeaders && !sameOrigin(finalUrl, next)) throw redirectError()
    redirects++
    finalUrl = next.href
  }

  return (async () => {
    try {
      const response = await requestOnce(
        transport,
        { url: initial.href, headers, signal: ctx.signal, onRedirect },
        ctx,
        limits.connectTimeoutMs
      )
      if (response.status >= 300 && response.status < 400 && response.status !== 304) {
        response.body.destroy()
        throw redirectError()
      }
      ctx.startIdle()
      return { response, ctx, finalUrl }
    } catch (error) {
      ctx.dispose()
      throw error
    }
  })()
}

export function createVpmHttpClient(options: VpmHttpClientOptions): VpmHttpPort {
  const limits: VpmHttpLimits = { ...DEFAULT_VPM_HTTP_LIMITS, ...options.limits }
  const isAllowed = options.isNetworkAllowed ?? (() => false)

  const assertConsent = (): void => {
    if (!isAllowed()) throw new VpmError('vpmNetworkNotConsented')
  }

  return {
    async getJson(url: string, opts: VpmJsonRequest = {}): Promise<VpmJsonResponse> {
      opts = opts ?? {}
      assertConsent()
      const initial = assertHttpsUrl(url)
      const headers = buildRequestHeaders({
        userAgent: options.userAgent,
        acceptJson: true,
        etag: opts.etag,
        lastModified: opts.lastModified,
        extra: opts.headers
      })
      const customHeaders = !!opts.headers && Object.keys(opts.headers).length > 0
      let handle: ResponseHandle | null = null
      try {
        handle = await openResponse(options.transport, initial, headers, customHeaders, opts, limits)
        const { response, finalUrl } = handle
        const etag = headerValue(response.headers, 'etag')
        const lastModified = headerValue(response.headers, 'last-modified')

        if (response.status === 304) {
          response.body.destroy()
          return { status: 304, etag, lastModified, finalUrl }
        }
        if (response.status !== 200) {
          response.body.destroy()
          throw new VpmError('vpmHttpStatus', { status: response.status })
        }

        const contentLength = Number(headerValue(response.headers, 'content-length'))
        if (Number.isFinite(contentLength) && contentLength > limits.maxJsonBytes) {
          response.body.destroy()
          throw new VpmError('vpmHttpTooLarge')
        }

        const raw = await readBuffer(response.body, limits.maxJsonBytes, handle.ctx)
        let body: unknown
        try {
          body = JSON.parse(raw.toString('utf8').replace(/^\uFEFF/, ''))
        } catch (error) {
          throw new VpmError('vpmHttpInvalidJson', undefined, error)
        }
        return { status: 200, body, etag, lastModified, finalUrl }
      } finally {
        handle?.ctx.dispose()
      }
    },

    async downloadToFile(
      url: string,
      destPath: string,
      opts: VpmDownloadRequest = {}
    ): Promise<VpmDownloadResult> {
      opts = opts ?? {}
      assertConsent()
      if (!path.isAbsolute(destPath)) throw new VpmError('vpmCacheWriteFailed')
      const target = path.resolve(destPath)
      const initial = assertHttpsUrl(url)
      const headers = buildRequestHeaders({
        userAgent: options.userAgent,
        acceptJson: false,
        extra: opts.headers
      })
      const customHeaders = !!opts.headers && Object.keys(opts.headers).length > 0

      let fd: number
      try {
        fs.mkdirSync(path.dirname(target), { recursive: true })
        fd = fs.openSync(target, 'wx', 0o600)
      } catch (error) {
        throw new VpmError('vpmCacheWriteFailed', undefined, error)
      }
      const ws = fs.createWriteStream(target, { fd, autoClose: true })
      let handle: ResponseHandle | null = null
      const cleanup = (): void => {
        try {
          ws.destroy()
        } catch {
          /* ignore */
        }
        try {
          fs.rmSync(target, { force: true })
        } catch {
          /* ignore */
        }
      }

      try {
        handle = await openResponse(options.transport, initial, headers, customHeaders, opts, limits)
        const { response, finalUrl } = handle
        if (response.status !== 200) {
          response.body.destroy()
          throw new VpmError('vpmHttpStatus', { status: response.status })
        }
        const contentLength = Number(headerValue(response.headers, 'content-length'))
        if (Number.isFinite(contentLength) && contentLength > limits.maxDownloadBytes) {
          response.body.destroy()
          throw new VpmError('vpmHttpTooLarge')
        }

        const hash = createHash('sha256')
        let size = 0
        await new Promise<void>((resolve, reject) => {
          let settled = false
          let ended = false
          const done = (error?: VpmError): void => {
            if (settled) return
            settled = true
            handle?.ctx.signal.removeEventListener('abort', onAbort)
            if (!error) {
              resolve()
              return
            }
            response.body.destroy()
            cleanup()
            handle?.ctx.abort()
            reject(error)
          }
          const onAbort = (): void => done(handle?.ctx.errorForAbort() ?? new VpmError('vpmHttpNetwork'))
          if (handle?.ctx.signal.aborted) {
            done(handle.ctx.errorForAbort())
            return
          }
          handle?.ctx.signal.addEventListener('abort', onAbort, { once: true })

          response.body.on('data', (chunk: Buffer | string) => {
            if (settled) return
            const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
            size += buffer.length
            if (size > limits.maxDownloadBytes) {
              done(new VpmError('vpmHttpTooLarge'))
              return
            }
            hash.update(buffer)
            if (!ws.write(buffer)) {
              response.body.pause()
              ws.once('drain', () => response.body.resume())
            }
            handle?.ctx.touch()
          })
          response.body.on('end', () => {
            if (settled) return
            ended = true
            ws.end()
          })
          response.body.on('error', (error) => done(handle?.ctx.mapError(error) ?? new VpmError('vpmHttpNetwork')))
          response.body.on('aborted', () => done(new VpmError('vpmHttpNetwork')))
          response.body.on('close', () => {
            if (!settled && !ended) done(new VpmError('vpmHttpNetwork'))
          })
          ws.on('finish', () => done())
          ws.on('error', (error) => done(new VpmError('vpmCacheWriteFailed', undefined, error)))
        })

        return {
          size,
          sha256: hash.digest('hex'),
          contentType: headerValue(response.headers, 'content-type'),
          finalUrl
        }
      } catch (error) {
        cleanup()
        throw error
      } finally {
        handle?.ctx.dispose()
      }
    }
  }
}
