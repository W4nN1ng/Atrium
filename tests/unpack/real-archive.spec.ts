import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { listArchive, extractArchive, resolveBackend, parseSltListing } from '../../src/main/unpack/sevenZip'
import { listZip, extractZip } from '../../src/main/unpack/unzip'

/**
 * 真包回归测试：直接拿用户库里的实际素材验 cp932/GBK 与"单层 rar"判定。
 * 包不在（换机器 / 清理过）就整组跳过，不误报失败。
 */

const HERE = process.cwd()
const BIN = path.resolve(HERE, 'resources/bin')
const LIB = 'E:\\vrc\\A'

const RAR_RAR = path.join(LIB, '插件', 'shinano表情', '6117553 Shinano_FaceAnimation.rar.rar')
const JP_ZIP = path.join(LIB, '衣服', '【束縛チャイナ】', '束縛チャイナFULLSET.zip')
const GRIMOIR = path.join(LIB, '衣服', '27', 'Grimoir_SHINANO_V1.0.zip')

const has = (p: string): boolean => {
  try {
    return fs.statSync(p).isFile()
  } catch {
    return false
  }
}

let tmp: string
beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'avca-real-'))
})
afterAll(() => {
  fs.rmSync(tmp, { recursive: true, force: true })
})

describe('解压后端可用性', () => {
  it('自带的 resources/bin/7z.exe 被优先选中，且能处理 RAR', (ctx) => {
    /**
     * 新克隆的仓库里**没有** `7z.exe` / `7z.dll`（unRAR 那部分许可不允许二次分发），
     * 所以先跑 `node tools/fetch-7z.cjs` 才会跑到真断言。
     * 这里不是"随便跳一下"：跳了会打一行响的，CI 与本地都能看见"这一条没验"。
     */
    if (!fs.existsSync(path.join(BIN, '7z.exe'))) {
      console.log('⚠ resources/bin/7z.exe 不在（新克隆？）→ 这一条**没验**，先跑 node tools/fetch-7z.cjs')
      ctx.skip()
      return
    }
    const b = resolveBackend([BIN], true)
    expect(b, '没找到后端：先跑 node tools/fetch-7z.cjs').not.toBeNull()
    expect(b?.kind).toBe('7z')
    expect(b?.canHandleRar).toBe(true)
    expect(b?.exe.toLowerCase()).toContain('resources')
  })

  it('parseSltListing 用 Folder = + 判目录、Encrypted = + 判加密', () => {
    const text = [
      'Path = 说明.txt',
      'Folder = -',
      'Size = 1234',
      'Encrypted = -',
      '',
      'Path = Assets',
      'Folder = +',
      'Size = 0',
      'Encrypted = +',
      ''
    ].join('\r\n')
    const e = parseSltListing(text)
    expect(e).toHaveLength(2)
    expect(e[0]).toMatchObject({ path: '说明.txt', size: 1234, isDir: false, encrypted: false })
    expect(e[1]).toMatchObject({ path: 'Assets', isDir: true, encrypted: true })
  })
})

describe.skipIf(!has(RAR_RAR))('真件：6117553 Shinano_FaceAnimation.rar.rar', () => {
  it('是单层 rar，里面装的是 zip，不是"rar 套 rar"', async () => {
    const r = await listArchive(RAR_RAR, { extraBackendDirs: [BIN] })
    expect(r.entries.length).toBeGreaterThan(0)
    const zips = r.entries.filter((e) => /\.zip$/i.test(e.path))
    expect(zips.length).toBeGreaterThan(0)
    expect(r.entries.some((e) => /\.rar$/i.test(e.path)), '里面不该再套 rar').toBe(false)
  })

  it('包内日文名「無料」解得对（GBK 字节，按 cp932 解会变成乱码）', async () => {
    const r = await listArchive(RAR_RAR, { extraBackendDirs: [BIN] })
    const names = r.entries.map((e) => e.path)
    const freebie = names.find((n) => /FREE/i.test(n))
    expect(freebie, '没找到 FREE 开头的条目：' + names.join(', ')).toBeTruthy()
    expect(freebie).toContain('無料')
    expect(freebie).not.toMatch(/[\uFF61-\uFF9F]/) // 半角片假名 = 解错的典型产物
    expect(freebie).not.toContain('\uFFFD')
  })

  it('真解压到暂存目录，文件名在磁盘上也正确', async () => {
    const dest = path.join(tmp, 'rarrar')
    const r = await extractArchive(RAR_RAR, dest, { extraBackendDirs: [BIN] })
    expect(r.files).toBeGreaterThan(0)
    const names = fs.readdirSync(dest)
    expect(names.some((n) => n.includes('無料'))).toBe(true)
    expect(names.some((n) => /[\uFF61-\uFF9F]/.test(n))).toBe(false)
  })
})

describe.skipIf(!has(JP_ZIP))('真件：束縛チャイナFULLSET.zip', () => {
  it('zip 条目名里的日文假名解得出来，且不产生替换符', async () => {
    const r = await listZip(JP_ZIP)
    expect(r.entries.length).toBeGreaterThan(0)
    const joined = r.entries.map((e) => e.path).join('\n')
    expect(joined).toContain('チャイナ')
    expect(joined).not.toContain('\uFFFD')
    // 说明回退解码这条路确实被走到了（老 zip 不带 UTF-8 标志）
    expect(r.fallbackDecoded).toBeGreaterThan(0)
  })

  it('真解压到临时目录：文件名不带替换符，目录条目真的建成了目录', async () => {
    const dest = path.join(tmp, 'jpzip')
    const r = await extractZip(JP_ZIP, dest)
    expect(r.files).toBeGreaterThan(0)
    const seen: string[] = []
    const walk = (d: string): void => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        seen.push(e.name)
        if (e.isDirectory()) walk(path.join(d, e.name))
      }
    }
    walk(dest)
    expect(seen.some((n) => n.includes('チャイナ') || n.includes('束縛'))).toBe(true)
    expect(seen.every((n) => !n.includes('\uFFFD') && !/[\uFF61-\uFF9F]/.test(n))).toBe(true)
  })
})

describe.skipIf(!has(GRIMOIR))('真件：Grimoir_SHINANO_V1.0.zip', () => {
  it('能列出条目并给出总字节', async () => {
    const r = await listZip(GRIMOIR)
    expect(r.entries.length).toBeGreaterThan(0)
    expect(r.totalBytes).toBeGreaterThan(0)
    expect(r.entries.every((e) => e.path && !e.path.includes('\uFFFD'))).toBe(true)
  })
})
