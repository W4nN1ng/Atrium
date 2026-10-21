import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { Readable } from 'node:stream'
import { VpmError } from '../../../src/shared/vpm/errors'

const net = vi.hoisted(() => ({ request: vi.fn() }))
vi.mock('electron', () => ({ net }))

import { createElectronHttpTransport } from '../../../src/main/vpm/http/electron'
import type { VpmHttpTransportRequest } from '../../../src/main/vpm/http'

class FakeRequest extends EventEmitter {
  readonly options: Record<string, unknown>
  followed = 0
  aborted = false
  ended = false

  constructor(options: Record<string, unknown>) {
    super()
    this.options = options
  }

  followRedirect(): void {
    this.followed++
  }

  abort(): void {
    this.aborted = true
    this.emit('abort')
  }

  end(): void {
    this.ended = true
  }
}

function input(overrides: Partial<VpmHttpTransportRequest> = {}): VpmHttpTransportRequest {
  return {
    url: 'https://example.test/a',
    headers: { 'User-Agent': 'Atrium/test' },
    signal: new AbortController().signal,
    ...overrides
  }
}

beforeEach(() => {
  net.request.mockReset()
})

function useFakeRequest(): () => FakeRequest {
  let request: FakeRequest | null = null
  net.request.mockImplementation((options: unknown) => {
    request = new FakeRequest((options ?? {}) as Record<string, unknown>)
    return request as never
  })
  return () => {
    if (!request) throw new Error('net.request was not called')
    return request
  }
}

describe('Electron HTTP transport', () => {
  it('disables cookies, uses manual redirects and follows only after validation', async () => {
    const getRequest = useFakeRequest()
    const onRedirect = vi.fn()
    const transport = createElectronHttpTransport()

    const promise = transport.request(input({ onRedirect }))
    const request = getRequest()

    expect(net.request).toHaveBeenCalledTimes(1)
    expect(request.options).toMatchObject({
      method: 'GET',
      url: 'https://example.test/a',
      redirect: 'manual',
      credentials: 'omit',
      useSessionCookies: false,
      referrerPolicy: 'no-referrer'
    })
    expect(request.options.headers).toEqual({ 'User-Agent': 'Atrium/test' })

    request.emit('redirect', 302, 'GET', 'https://example.test/b', {})
    expect(onRedirect).toHaveBeenCalledWith({
      status: 302,
      url: 'https://example.test/b',
      headers: {}
    })
    expect(request.followed).toBe(1)

    const body = Readable.from(['ok']) as Readable & {
      statusCode: number
      headers: Record<string, string[]>
    }
    body.statusCode = 200
    body.headers = { 'content-type': ['text/plain'] }
    request.emit('response', body)

    const response = await promise
    expect(response.status).toBe(200)
    expect(response.body).toBe(body)
  })

  it('aborts instead of following when the redirect validator throws', async () => {
    const getRequest = useFakeRequest()
    const transport = createElectronHttpTransport()

    const promise = transport.request(
      input({
        onRedirect: () => {
          throw new VpmError('vpmHttpRedirect')
        }
      })
    )
    const request = getRequest()
    request.emit('redirect', 302, 'GET', 'https://other.test/b', {})

    await expect(promise).rejects.toMatchObject({ code: 'vpmHttpRedirect' })
    expect(request.aborted).toBe(true)
    expect(request.followed).toBe(0)
  })

  it('rejects when the request aborts before a response', async () => {
    const getRequest = useFakeRequest()
    const controller = new AbortController()
    const transport = createElectronHttpTransport()

    const promise = transport.request(input({ signal: controller.signal }))
    const request = getRequest()
    controller.abort()

    await expect(promise).rejects.toThrow('aborted')
    expect(request.aborted).toBe(true)
  })
})
