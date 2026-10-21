import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { PassThrough } from 'node:stream'
import { createVpmHttpClient } from '../../../src/main/vpm/http'
import type { VpmHttpLimits } from '../../../src/main/vpm/http'
import { FakeTransport, reply } from './fake-transport'

let root: string
let transport: FakeTransport

function makeClient(allowed = true, limits?: Partial<VpmHttpLimits>) {
  return createVpmHttpClient({
    transport,
    isNetworkAllowed: () => allowed,
    userAgent: 'Atrium/test',
    limits
  })
}

function sha256(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex')
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'atrium-vpm-http-'))
  transport = new FakeTransport()
})

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true })
})

describe('VPM HTTP client', () => {
  it('fails closed without network consent and never calls the transport', async () => {
    transport.handler = () => reply(200, '{}')
    const client = makeClient(false)

    await expect(client.getJson('https://example.test/a')).rejects.toMatchObject({
      code: 'vpmNetworkNotConsented'
    })
    await expect(
      client.downloadToFile('https://example.test/a.zip', path.join(root, 'a.zip'))
    ).rejects.toMatchObject({ code: 'vpmNetworkNotConsented' })
    expect(transport.calls).toHaveLength(0)
  })

  it('blocks non-HTTPS, userinfo and forbidden headers before the transport', async () => {
    const client = makeClient()
    await expect(client.getJson('http://example.test/a')).rejects.toMatchObject({ code: 'vpmHttpBlocked' })
    await expect(client.getJson('file:///C:/secret')).rejects.toMatchObject({ code: 'vpmHttpBlocked' })
    await expect(client.getJson('https://user:pass@example.test/a')).rejects.toMatchObject({
      code: 'vpmHttpBlocked'
    })
    await expect(
      client.getJson('https://example.test/a', { headers: { Cookie: 'sid=1' } })
    ).rejects.toMatchObject({ code: 'vpmHttpBlocked' })
    expect(transport.calls).toHaveLength(0)
  })

  it('sends UA/conditional headers without cookies and parses JSON', async () => {
    let seen: Record<string, string> = {}
    transport.handler = (input) => {
      seen = input.headers
      return reply(200, '{"ok":true}', {
        'content-type': 'application/json',
        etag: '"abc"',
        'last-modified': 'Wed, 21 Oct 2026 06:00:00 GMT'
      })
    }

    const result = await makeClient().getJson('https://example.test/a', {
      etag: '"old"',
      lastModified: 'Tue, 20 Oct 2026 06:00:00 GMT'
    })

    expect(result).toMatchObject({
      status: 200,
      body: { ok: true },
      etag: '"abc"',
      lastModified: 'Wed, 21 Oct 2026 06:00:00 GMT',
      finalUrl: 'https://example.test/a'
    })
    expect(seen['User-Agent']).toBe('Atrium/test')
    expect(seen.Accept).toBe('application/json')
    expect(seen['If-None-Match']).toBe('"old"')
    expect(seen['If-Modified-Since']).toBe('Tue, 20 Oct 2026 06:00:00 GMT')
    expect(Object.keys(seen).some((name) => name.toLowerCase() === 'cookie')).toBe(false)
  })

  it('returns 304 without a body', async () => {
    transport.handler = () => reply(304, undefined, { etag: '"same"' })
    const result = await makeClient().getJson('https://example.test/a')
    expect(result.status).toBe(304)
    expect(result.etag).toBe('"same"')
    expect(result.body).toBeUndefined()
  })

  it('follows an allowed redirect and reports the final URL', async () => {
    transport.handler = (input) => {
      input.onRedirect?.({ status: 302, url: 'https://example.test/b', headers: {} })
      return reply(200, '{"ok":true}')
    }
    const result = await makeClient().getJson('https://example.test/a')
    expect(result.finalUrl).toBe('https://example.test/b')
    expect(result.body).toEqual({ ok: true })
  })

  it('stops redirects that downgrade, cross origin with custom headers, or exceed the limit', async () => {
    transport.handler = (input) => {
      input.onRedirect?.({ status: 302, url: 'http://example.test/b', headers: {} })
      return reply(200, '{}')
    }
    await expect(makeClient().getJson('https://example.test/a')).rejects.toMatchObject({
      code: 'vpmHttpRedirect'
    })

    transport.handler = (input) => {
      input.onRedirect?.({ status: 302, url: 'https://other.test/b', headers: {} })
      return reply(200, '{}')
    }
    await expect(
      makeClient().getJson('https://example.test/a', { headers: { Authorization: 'Bearer x' } })
    ).rejects.toMatchObject({ code: 'vpmHttpRedirect' })

    transport.handler = (input) => {
      for (let i = 0; i < 6; i++) {
        input.onRedirect?.({ status: 302, url: `https://example.test/${i}`, headers: {} })
      }
      return reply(200, '{}')
    }
    await expect(makeClient().getJson('https://example.test/a')).rejects.toMatchObject({
      code: 'vpmHttpRedirect'
    })
  })

  it('rejects a raw 3xx response, bad status and invalid JSON', async () => {
    transport.handler = () => reply(302, '')
    await expect(makeClient().getJson('https://example.test/a')).rejects.toMatchObject({
      code: 'vpmHttpRedirect'
    })

    transport.handler = () => reply(404, 'not found')
    await expect(makeClient().getJson('https://example.test/a')).rejects.toMatchObject({
      code: 'vpmHttpStatus',
      params: { status: 404 }
    })

    transport.handler = () => reply(200, 'not json')
    await expect(makeClient().getJson('https://example.test/a')).rejects.toMatchObject({
      code: 'vpmHttpInvalidJson'
    })
  })

  it('enforces the JSON size limit', async () => {
    transport.handler = () => reply(200, '{"too":"large"}')
    await expect(makeClient(true, { maxJsonBytes: 8 }).getJson('https://example.test/a')).rejects.toMatchObject({
      code: 'vpmHttpTooLarge'
    })
  })

  it('streams a download to disk and returns its size/hash/content type', async () => {
    const data = Buffer.from('hello vpm package')
    transport.handler = () =>
      reply(200, data, {
        'content-type': 'application/octet-stream',
        'content-length': String(data.length)
      })
    const dest = path.join(root, 'pkg.zip')

    const result = await makeClient().downloadToFile('https://example.test/pkg.zip', dest)

    expect(fs.readFileSync(dest)).toEqual(data)
    expect(result).toMatchObject({
      size: data.length,
      sha256: sha256(data),
      contentType: 'application/octet-stream',
      finalUrl: 'https://example.test/pkg.zip'
    })
  })

  it('removes the partial download when the size limit is exceeded', async () => {
    transport.handler = () => reply(200, Buffer.from('0123456789'))
    const dest = path.join(root, 'pkg.zip')

    await expect(
      makeClient(true, { maxDownloadBytes: 5 }).downloadToFile('https://example.test/pkg.zip', dest)
    ).rejects.toMatchObject({ code: 'vpmHttpTooLarge' })
    expect(fs.existsSync(dest)).toBe(false)
  })

  it('aborts a download and removes the partial file', async () => {
    const body = new PassThrough()
    transport.handler = () => ({ status: 200, headers: {}, body })
    const dest = path.join(root, 'pkg.zip')
    const controller = new AbortController()

    const promise = makeClient().downloadToFile('https://example.test/pkg.zip', dest, {
      signal: controller.signal
    })
    await new Promise((resolve) => setTimeout(resolve, 10))
    controller.abort()

    await expect(promise).rejects.toMatchObject({ code: 'vpmHttpAborted' })
    expect(fs.existsSync(dest)).toBe(false)
    body.destroy()
  })

  it('times out a stalled connection', async () => {
    transport.handler = () => new Promise(() => {})
    await expect(
      makeClient(true, { connectTimeoutMs: 20, totalTimeoutMs: 1_000 }).getJson('https://example.test/a')
    ).rejects.toMatchObject({ code: 'vpmHttpTimeout' })
  })

  it('times out an idle response body', async () => {
    const body = new PassThrough()
    body.write('x')
    transport.handler = () => ({ status: 200, headers: {}, body })

    await expect(
      makeClient(true, { idleTimeoutMs: 20, totalTimeoutMs: 1_000 }).getJson('https://example.test/a')
    ).rejects.toMatchObject({ code: 'vpmHttpTimeout' })
    body.destroy()
  })

  it('enforces the total timeout across a slow response', async () => {
    const body = new PassThrough()
    transport.handler = () => ({ status: 200, headers: {}, body })

    await expect(
      makeClient(true, { idleTimeoutMs: 1_000, totalTimeoutMs: 20 }).getJson('https://example.test/a')
    ).rejects.toMatchObject({ code: 'vpmHttpTimeout' })
    body.destroy()
  })
})
