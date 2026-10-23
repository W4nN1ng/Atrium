import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { VpmError } from '../../src/shared/vpm/errors'
import type { VpmDownloadRequest, VpmDownloadResult, VpmHttpPort, VpmJsonRequest, VpmJsonResponse } from '../../src/main/vpm/http'
import { UpdaterService, hashFromNotes, isNewerVersion } from '../../src/main/vpm/updater'

let root: string
let downloads: string

beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'atrium-vpm-update-')))
  downloads = path.join(root, 'updates')
})

afterEach(() => {
  vi.restoreAllMocks()
  fs.rmSync(root, { recursive: true, force: true })
})

const BODY = 'cafe' // 下载内容
const BODY_SHA = createHash('sha256').update(BODY).digest('hex')

function release(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    tag_name: 'v0.9.1',
    published_at: '2026-11-01T00:00:00Z',
    html_url: 'https://github.com/W4nN1ng/Atrium/releases/tag/v0.9.1',
    body: `Atrium-Setup-0.9.1.exe\nSHA-256：${BODY_SHA}\n`,
    assets: [
      {
        name: 'Atrium-Setup-0.9.1.exe',
        size: 1024,
        browser_download_url: 'https://github.com/W4nN1ng/Atrium/releases/download/v0.9.1/Atrium-Setup-0.9.1.exe'
      }
    ],
    ...overrides
  }
}

function fakeHttp(options: {
  body?: unknown
  jsonError?: unknown
  sha256?: string
}): { http: VpmHttpPort; jsonCalls: number } {
  const state = { jsonCalls: 0 }
  const http: VpmHttpPort = {
    async getJson(_url: string, _opts?: VpmJsonRequest): Promise<VpmJsonResponse> {
      state.jsonCalls++
      if (options.jsonError) throw options.jsonError
      return { status: 200, body: options.body ?? release(), finalUrl: 'https://api.github.com/' }
    },
    async downloadToFile(url: string, dest: string, _opts?: VpmDownloadRequest): Promise<VpmDownloadResult> {
      fs.mkdirSync(path.dirname(dest), { recursive: true })
      fs.writeFileSync(dest, BODY)
      const sha256 = options.sha256 ?? BODY_SHA
      return { size: BODY.length, sha256, finalUrl: url }
    }
  }
  return { http, get jsonCalls() { return state.jsonCalls } } as unknown as {
    http: VpmHttpPort
    jsonCalls: number
  }
}

function service(http: VpmHttpPort, currentVersion = '0.9.0'): UpdaterService {
  return new UpdaterService({ http, currentVersion, downloadDir: downloads })
}

describe('isNewerVersion', () => {
  it('只有严格更高才算新版本', () => {
    expect(isNewerVersion('0.9.1', '0.9.0')).toBe(true)
    expect(isNewerVersion('0.9.0', '0.9.0')).toBe(false)
    expect(isNewerVersion('0.8.9', '0.9.0')).toBe(false)
    expect(isNewerVersion('v1.0.0', '0.9.0')).toBe(true)
  })

  it('解析不了就当没有更新', () => {
    expect(isNewerVersion('nightly', '0.9.0')).toBe(false)
  })
})

describe('hashFromNotes', () => {
  it.each(['：', ':', '—', '–', ' - ', ' '])('支持 %s 分隔', (separator) => {
    const notes = `Atrium-Setup-0.9.1.exe${separator}${BODY_SHA}`
    expect(hashFromNotes(notes, 'Atrium-Setup-0.9.1.exe')).toBe(BODY_SHA)
  })

  it('没有 hash 就是 null（不允许装）', () => {
    expect(hashFromNotes('Atrium-Setup-0.9.1.exe\nno hash here', 'Atrium-Setup-0.9.1.exe')).toBeNull()
  })
})

describe('UpdaterService.check', () => {
  it('有新版本时给出资产与 hash', async () => {
    const fake = fakeHttp({})
    const result = await service(fake.http).check()

    expect(result.status).toBe('update')
    expect(result.latestVersion).toBe('0.9.1')
    expect(result.installer).toEqual({ name: 'Atrium-Setup-0.9.1.exe', size: 1024, sha256: BODY_SHA })
    expect(result.releaseUrl).toContain('github.com')
    expect(result.errorCode).toBeNull()
    expect(result.cached).toBe(false)
  })

  it('版本相同 → current', async () => {
    const result = await service(fakeHttp({}).http, '0.9.1').check()
    expect(result.status).toBe('current')
  })

  it('网络失败 → unknown + code，且不缓存（下次还会真的重试）', async () => {
    const fake = fakeHttp({ jsonError: new VpmError('vpmHttpNetwork') })
    const updater = service(fake.http)
    const first = await updater.check()
    expect(first.status).toBe('unknown')
    expect(first.errorCode).toBe('vpmHttpNetwork')

    const second = await updater.check()
    expect(second.errorCode).toBe('vpmHttpNetwork')
    expect(fake.jsonCalls).toBe(2)
  })

  it('1 小时内复用缓存，force 才重新请求', async () => {
    const fake = fakeHttp({})
    const updater = service(fake.http)
    await updater.check()
    const cached = await updater.check()
    expect(cached.cached).toBe(true)
    expect(fake.jsonCalls).toBe(1)

    await updater.check(true)
    expect(fake.jsonCalls).toBe(2)
  })

  it('release 形状不对 → unknown + vpmUpdateCheckFailed', async () => {
    const result = await service(fakeHttp({ body: { tag_name: 42 } }).http).check()
    expect(result.status).toBe('unknown')
    expect(result.errorCode).toBe('vpmUpdateCheckFailed')
  })
})

describe('UpdaterService.download', () => {
  it('hash 对得上 → ready，文件留在下载目录', async () => {
    const updater = service(fakeHttp({}).http)
    const result = await updater.download()

    expect(result.status).toBe('ready')
    expect(result.path).toBe(path.join(downloads, 'Atrium-Setup-0.9.1.exe'))
    expect(fs.existsSync(result.path as string)).toBe(true)
  })

  it('hash 不一致 → 删文件、不返回路径', async () => {
    const updater = service(fakeHttp({ sha256: 'f'.repeat(64) }).http)
    const result = await updater.download()

    expect(result.status).toBe('hash-mismatch')
    expect(result.path).toBeNull()
    expect(result.errorCode).toBe('vpmUpdateHashMismatch')
    expect(fs.existsSync(path.join(downloads, 'Atrium-Setup-0.9.1.exe'))).toBe(false)
  })

  it('发布说明里没有 hash → 不装，文件删掉', async () => {
    const body = release({ body: 'no checksums in this release' })
    const updater = service(fakeHttp({ body }).http)
    const result = await updater.download()

    expect(result.status).toBe('failed')
    expect(result.errorCode).toBe('vpmUpdateHashMismatch')
    expect(fs.existsSync(path.join(downloads, 'Atrium-Setup-0.9.1.exe'))).toBe(false)
  })

  it('没有更新时直接失败，不下载', async () => {
    const updater = service(fakeHttp({}).http, '0.9.1')
    const result = await updater.download()
    expect(result.status).toBe('failed')
    expect(fs.existsSync(downloads)).toBe(false)
  })
})

describe('UpdaterService.localBuilds', () => {
  it('列出投放目录里的安装包，按版本从新到旧', () => {
    fs.mkdirSync(downloads, { recursive: true })
    for (const name of ['Atrium-Setup-0.9.0.exe', 'Atrium-Setup-0.10.0.exe', 'Atrium-Setup-0.9.1.exe']) {
      fs.writeFileSync(path.join(downloads, name), 'x')
    }
    // 干扰项：不是安装包 / 不是 exe
    fs.writeFileSync(path.join(downloads, 'notes.txt'), 'x')
    fs.writeFileSync(path.join(downloads, 'Atrium-Setup-0.9.0.exe.blockmap'), 'x')

    const builds = service(fakeHttp({}).http).localBuilds()

    expect(builds.map((build) => build.version)).toEqual(['0.10.0', '0.9.1', '0.9.0'])
    expect(builds[0].name).toBe('Atrium-Setup-0.10.0.exe')
    expect(builds[0].size).toBeGreaterThan(0)
    expect(builds[0].mtime).toBeGreaterThan(0)
  })

  it('目录不存在时返回空数组，不抛错', () => {
    expect(service(fakeHttp({}).http).localBuilds()).toEqual([])
  })

  it('文件名里没有合法版本时 version 为 null，但仍然列出来', () => {
    fs.mkdirSync(downloads, { recursive: true })
    fs.writeFileSync(path.join(downloads, 'Atrium-Setup-nightly.exe'), 'x')
    const builds = service(fakeHttp({}).http).localBuilds()
    expect(builds).toHaveLength(1)
    expect(builds[0].version).toBeNull()
  })

  it('updatesDir 就是下载目录（界面"打开文件夹"用）', () => {
    expect(service(fakeHttp({}).http).updatesDir).toBe(downloads)
  })
})

describe('UpdaterService.runInstaller', () => {
  it('只接受下载目录里的 Atrium-Setup-*.exe', () => {
    const updater = service(fakeHttp({}).http)
    fs.mkdirSync(downloads, { recursive: true })
    const good = path.join(downloads, 'Atrium-Setup-0.9.1.exe')
    fs.writeFileSync(good, 'x')

    // 目录外的文件：拒绝（这条通道不能变成"随便执行一个 exe"）
    const outside = path.join(root, 'Atrium-Setup-evil.exe')
    fs.writeFileSync(outside, 'x')
    expect(updater.runInstaller(outside)).toEqual({ ok: false, errorCode: 'vpmUpdateInstallFailed' })

    // 名字不对：拒绝
    const wrongName = path.join(downloads, 'other.exe')
    fs.writeFileSync(wrongName, 'x')
    expect(updater.runInstaller(wrongName)).toEqual({ ok: false, errorCode: 'vpmUpdateInstallFailed' })

    // 不存在：拒绝
    expect(updater.runInstaller(path.join(downloads, 'Atrium-Setup-9.9.9.exe'))).toEqual({
      ok: false,
      errorCode: 'vpmUpdateInstallFailed'
    })
  })
})
