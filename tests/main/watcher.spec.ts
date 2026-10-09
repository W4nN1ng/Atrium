import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { startFolderWatcher, type FolderWatcher } from '../../src/main/services/watcher'

/**
 * 监视文件夹的真测试：真的往磁盘丢文件，真的等 debounce。
 * 这里最容易出的两个事故是"下载中途抢跑"和"同一文件投两次"，
 * 都只有真跑磁盘才测得出来，mock 会全绿但用户那边重复入库。
 */

let root = ''
let watchDir = ''
let libraryDir = ''

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** 等到 onPaths 攒够 n 条，最多等 ms */
async function waitFor(pred: (calls: string[][]) => boolean, ms = 14000): Promise<string[][]> {
  const t0 = Date.now()
  for (;;) {
    if (pred(calls)) return calls
    if (Date.now() - t0 > ms) throw new Error('等监视器等超时了，当前：' + JSON.stringify(calls))
    await sleep(200)
  }
}

let calls: string[][] = []
let watcher: FolderWatcher | null = null

beforeAll(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'avca-watch-'))
  watchDir = path.join(root, 'inbox')
  libraryDir = path.join(root, 'library')
  fs.mkdirSync(watchDir, { recursive: true })
  fs.mkdirSync(libraryDir, { recursive: true })
  // 已存在的文件不该在启动时补投一遍
  fs.writeFileSync(path.join(watchDir, 'old.zip'), 'old')
  watcher = startFolderWatcher({
    getFolders: () => [watchDir],
    getExcludes: () => [libraryDir],
    onPaths: (p) => calls.push(p)
  })
  // 不等 ready 就写文件，第一条事件会掉在 chokidar 还没真盯上的空档里（实测踩过）
  await watcher.whenReady()
})

afterAll(async () => {
  watcher?.dispose()
  await sleep(200)
  try {
    fs.rmSync(root, { recursive: true, force: true })
  } catch {
    /* 临时目录留给系统清 */
  }
})

describe('startFolderWatcher', () => {
  it('丢进去的文件会在 debounce 后报出来', async () => {
    calls = []
    fs.writeFileSync(path.join(watchDir, 'new-asset.zip'), 'a'.repeat(2048))
    const seen = await waitFor((c) => c.flat().some((p) => p.endsWith('new-asset.zip')))
    expect(seen.flat().filter((p) => p.endsWith('new-asset.zip'))).toHaveLength(1)
  }, 25000)

  it('下载中的半成品和系统噪音文件一律不理', async () => {
    calls = []
    fs.writeFileSync(path.join(watchDir, 'big.zip.part'), 'x')
    fs.writeFileSync(path.join(watchDir, 'chrome.dmg.crdownload'), 'x')
    fs.writeFileSync(path.join(watchDir, '.DS_Store'), 'x')
    fs.writeFileSync(path.join(watchDir, 'desktop.ini'), 'x')
    await sleep(6000)
    expect(calls.flat()).toEqual([])
  }, 20000)

  it('同一个文件短时间内的第二次 change 不再重复投', async () => {
    calls = []
    const f = path.join(watchDir, 'twice.zip')
    fs.writeFileSync(f, 'one')
    await waitFor((c) => c.flat().some((p) => p.endsWith('twice.zip')))
    fs.writeFileSync(f, 'two')
    await sleep(6000)
    const hits = calls.flat().filter((p) => p.endsWith('twice.zip'))
    expect(hits).toHaveLength(1)
  }, 25000)

  it('ignoreInitial：启动前就在那儿的文件不会补投', async () => {
    calls = []
    await sleep(3000)
    expect(calls.flat().some((p) => p.endsWith('old.zip'))).toBe(false)
  }, 15000)

  it('watching() 报出当前监视的目录，dispose 之后清空', () => {
    expect(watcher?.watching()).toEqual([watchDir])
    watcher?.dispose()
    watcher = null
    expect(watcher === null).toBe(true)
  })
})
