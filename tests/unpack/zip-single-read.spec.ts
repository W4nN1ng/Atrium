/**
 * readZipEntryText 回归测试。
 *
 * 起因（实测）：真库一次收编 228 项，226 项 30 秒完事，剩两个带 Readme.txt/.url 的 zip
 * 停在 70% 十分钟不动 —— 这函数里等的是 yauzl 的 'open' 事件，而事件在 promise 回调那一刻
 * 就发完了，监听器挂上去时早没救了：不报错、不返回、CPU 0%，整条摄取挂死。
 * 而这条路径以前**一条测试都没有**，所以它从 M3 起对 zip 就是静默失效的。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { listZip, readZipEntryText } from '../../src/main/unpack/unzip'

const BIN = path.resolve(process.cwd(), 'resources/bin')

function find7z(): string {
  for (const n of ['7z.exe', '7za.exe']) {
    const p = path.join(BIN, n)
    if (fs.existsSync(p)) return p
  }
  throw new Error('没找到 7z：先跑 node tools/fetch-7z.cjs')
}

let tmp: string
let zip: string

beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'avca-zipread-'))
  fs.writeFileSync(path.join(tmp, 'Readme.txt'), 'shop: https://booth.pm/ja/items/6117553\n作者：Shinano\n')
  fs.mkdirSync(path.join(tmp, 'docs'), { recursive: true })
  fs.writeFileSync(path.join(tmp, 'docs', '説明.txt'), 'これは説明です\n')
  fs.writeFileSync(path.join(tmp, 'big.txt'), 'x'.repeat(200 * 1024))
  zip = path.join(tmp, 'pkg.zip')
  // stdin 必须关掉：带密码的 7z 会挂在"Enter password"上（这条坑记在项目备忘里）
  execFileSync(find7z(), ['a', '-tzip', '-y', zip, 'Readme.txt', 'docs', 'big.txt'], {
    cwd: tmp,
    stdio: ['ignore', 'pipe', 'pipe']
  })
})

afterAll(() => {
  fs.rmSync(tmp, { recursive: true, force: true })
})

describe('包内单读一个小文件', () => {
  it('顶层条目能读到，而且几秒内就回（以前这条永远不回）', async () => {
    const t = Date.now()
    const v = await readZipEntryText(zip, 'Readme.txt')
    expect(Date.now() - t, '单读不该超过 5 秒').toBeLessThan(5000)
    expect(v).not.toBeNull()
    expect(v).toContain('6117553')
    expect(v).toContain('作者')
  }, 20000)

  it('子目录条目、以及反斜杠传来的路径都读得到', async () => {
    const a = await readZipEntryText(zip, 'docs/説明.txt')
    expect(a).toContain('説明')
    const b = await readZipEntryText(zip, 'docs\\説明.txt')
    expect(b).toContain('説明')
  }, 20000)

  it('没有的条目返回 null，不是挂住', async () => {
    const t = Date.now()
    expect(await readZipEntryText(zip, '不存在.txt')).toBeNull()
    expect(Date.now() - t).toBeLessThan(5000)
  }, 20000)

  it('超过 maxBytes 的条目放弃（不为了 200KB 把整包读完）', async () => {
    expect(await readZipEntryText(zip, 'big.txt', 64 * 1024)).toBeNull()
  }, 20000)

  it('文件不存在 / 不是 zip 时也是 null', async () => {
    expect(await readZipEntryText(path.join(tmp, 'nope.zip'), 'Readme.txt')).toBeNull()
    expect(await readZipEntryText(path.join(tmp, 'Readme.txt'), 'Readme.txt')).toBeNull()
  }, 20000)

  it('列清单和单读对同一个条目的口径一致（名字解码两边都得过 normalizeEntryPath）', async () => {
    const listed = await listZip(zip)
    const names = listed.entries.map((e) => e.path)
    expect(names).toContain('docs/説明.txt')
    for (const n of names) {
      if (n.endsWith('/')) continue
      const v = await readZipEntryText(zip, n, 64 * 1024)
      // 大文件那条允许 null，其余必须读得出内容
      if (n === 'big.txt') expect(v).toBeNull()
      else expect(typeof v, `${n} 应该读得出内容`).toBe('string')
    }
  }, 60000)
})
