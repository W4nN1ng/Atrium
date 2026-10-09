import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  INBOX_QUEUE_MAX,
  addToInboxQueue,
  clearInboxQueue,
  describeInboxQueue,
  isInInboxQueue,
  normalizeQueuePath,
  readInboxQueue,
  removeFromInboxQueue,
  writeInboxQueue
} from '../../src/main/services/inboxQueue'

/**
 * 收件箱持久化。核心是**幂等**与**耐坏**：
 * 程序启动时要靠这个文件把上次没确认完的卡片捞回来，它读坏一次就等于用户的队列丢了，
 * 所以"文件不存在 / JSON 半截 / 版本不对"都必须退化成空队列而不是抛。
 */

let dir: string
let file: string

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'avca-inboxq-'))
  file = path.join(dir, 'inbox.json')
})

afterEach(() => {
  try {
    fs.rmSync(dir, { recursive: true, force: true })
  } catch {
    /* 交给系统 */
  }
})

describe('路径归一化', () => {
  it('反斜杠/正斜杠、大小写、尾斜杠都归一到同一个键', () => {
    const a = normalizeQueuePath('E:\\vrc\\A\\Foo.zip')
    expect(normalizeQueuePath('e:/vrc/a/foo.zip')).toBe(a)
    expect(normalizeQueuePath('E:\\vrc\\A\\Foo.zip\\')).toBe(a)
    expect(normalizeQueuePath('  E:\\vrc\\A\\Foo.zip  ')).toBe(a)
  })
})

describe('读写', () => {
  it('文件不存在 → 空队列，不抛', () => {
    expect(readInboxQueue(path.join(dir, 'nope.json'))).toEqual([])
  })

  it('JSON 半截 / 不是 JSON → 空队列，不抛', () => {
    fs.writeFileSync(file, '{"version":1,"items":[{"path":"E:\\\\a.zip"', 'utf8')
    expect(readInboxQueue(file)).toEqual([])
    fs.writeFileSync(file, 'not json at all', 'utf8')
    expect(readInboxQueue(file)).toEqual([])
  })

  it('版本不对 → 空队列（宁可丢队列也不要用错语义的数据）', () => {
    fs.writeFileSync(file, JSON.stringify({ version: 99, items: [{ path: 'E:\\a.zip', at: 1 }] }), 'utf8')
    expect(readInboxQueue(file)).toEqual([])
  })

  it('写出去能原样读回来，且带 version', () => {
    writeInboxQueue(file, [{ path: 'E:\\vrc\\A\\x.zip', at: 123 }])
    expect(readInboxQueue(file)).toEqual([{ path: 'E:\\vrc\\A\\x.zip', at: 123 }])
    const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as { version: number }
    expect(raw.version).toBe(1)
  })

  it('写入是原子的：不会留下 .tmp', () => {
    writeInboxQueue(file, [{ path: 'E:\\a.zip', at: 1 }])
    expect(fs.existsSync(file + '.tmp')).toBe(false)
  })

  it('读取时丢掉重复项与坏行', () => {
    fs.writeFileSync(
      file,
      JSON.stringify({
        version: 1,
        items: [
          { path: 'E:\\vrc\\A\\x.zip', at: 1 },
          { path: 'e:/vrc/a/X.ZIP', at: 2 },
          { path: '', at: 3 },
          { nope: true },
          { path: 'E:\\vrc\\A\\y.zip', at: 4 }
        ]
      }),
      'utf8'
    )
    const items = readInboxQueue(file)
    expect(items.map((i) => i.path)).toEqual(['E:\\vrc\\A\\x.zip', 'E:\\vrc\\A\\y.zip'])
  })
})

describe('增删', () => {
  it('加入是幂等的：同一个路径（不同写法）只留一条', () => {
    addToInboxQueue(file, 'E:\\vrc\\A\\Foo.zip', 1)
    addToInboxQueue(file, 'e:/vrc/a/foo.zip', 2)
    addToInboxQueue(file, 'E:\\vrc\\A\\Foo.zip\\', 3)
    const items = readInboxQueue(file)
    expect(items).toHaveLength(1)
    /** 幂等时更新时间戳：用户在最后那次拖入才是"最近" */
    expect(items[0].at).toBe(3)
  })

  it('空路径不进队列', () => {
    addToInboxQueue(file, '   ', 1)
    expect(readInboxQueue(file)).toEqual([])
  })

  it('移除按归一化比较', () => {
    addToInboxQueue(file, 'E:\\vrc\\A\\Foo.zip', 1)
    addToInboxQueue(file, 'E:\\vrc\\A\\Bar.zip', 2)
    const left = removeFromInboxQueue(file, 'e:/vrc/a/FOO.zip')
    expect(left.map((i) => i.path)).toEqual(['E:\\vrc\\A\\Bar.zip'])
  })

  it('移除不存在的东西不报错', () => {
    expect(removeFromInboxQueue(file, 'E:\\nope.zip')).toEqual([])
  })

  it('清空', () => {
    addToInboxQueue(file, 'E:\\vrc\\A\\Foo.zip', 1)
    clearInboxQueue(file)
    expect(readInboxQueue(file)).toEqual([])
  })

  it('超过上限丢最旧的', () => {
    for (let i = 0; i < INBOX_QUEUE_MAX + 20; i++) addToInboxQueue(file, `E:\\vrc\\A\\f${i}.zip`, i + 1)
    const items = readInboxQueue(file)
    expect(items).toHaveLength(INBOX_QUEUE_MAX)
    /** 最旧的 f0…f19 被丢掉，最新的 f519 还在 */
    expect(items.some((i) => i.path.endsWith('f0.zip'))).toBe(false)
    expect(items.some((i) => i.path.endsWith(`f${INBOX_QUEUE_MAX + 19}.zip`))).toBe(true)
  })

  it('isInInboxQueue 认归一化后的路径', () => {
    addToInboxQueue(file, 'E:\\vrc\\A\\Foo.zip', 1)
    expect(isInInboxQueue(file, 'e:/vrc/a/foo.zip')).toBe(true)
    expect(isInInboxQueue(file, 'E:\\vrc\\A\\Other.zip')).toBe(false)
  })
})

describe('启动体检', () => {
  it('列出总数与磁盘上已不存在的条数', () => {
    const real = path.join(dir, 'real.zip')
    fs.writeFileSync(real, 'x')
    addToInboxQueue(file, real, 1)
    addToInboxQueue(file, path.join(dir, 'gone.zip'), 2)
    const d = describeInboxQueue(file)
    expect(d.total).toBe(2)
    expect(d.missing).toBe(1)
    expect(d.paths).toHaveLength(2)
  })
})
