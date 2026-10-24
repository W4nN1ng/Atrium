import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { IpcEvent, IpcInvoke } from '../../src/shared/ipc'

/**
 * 主进程注册的每个通道都必须在 preload 的白名单里。
 *
 * 踩过两次：新加了 assets:bundle / health:scan-rebundle，主进程和 preload 的 API 都写好了，
 * 但 IpcInvoke 里漏登记 —— 一点就报"通道不在白名单"，而 tsc 和单元测试全绿（它们不经过 preload）。
 * 这份检查扫的是真实源码，漏一个就红。
 */

const ROOT = path.resolve(__dirname, '../..')
const allowedChannels = new Set<string>(
  Object.values(IpcInvoke).flatMap((g) => Object.values(g as Record<string, string>))
)
const allowedEvents = new Set<string>(Object.values(IpcEvent))

function sources(dir: string): string[] {
  const out: string[] = []
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, e.name)
    if (e.isDirectory()) out.push(...sources(abs))
    else if (e.name.endsWith('.ts')) out.push(abs)
  }
  return out
}

/**
 * handler 可能写字面量，也可能引 `IpcInvoke.Group.Name`。
 * 两种都要认，否则“加了通道但测试说没实现”会逼着实现里重复一份字符串。
 */
function channelName(literal: string | undefined, group: string | undefined, key: string | undefined): string | null {
  if (literal) return literal
  if (!group || !key) return null
  const table = (IpcInvoke as Record<string, Record<string, string>>)[group]
  return table?.[key] ?? null
}

function handledChannels(text: string): string[] {
  const out: string[] = []
  for (const m of text.matchAll(
    /(?:ipc|registrar\.ipc)\.handle\(\s*(?:'([^']+)'|IpcInvoke\.([A-Za-z0-9_]+)\.([A-Za-z0-9_]+))/g
  )) {
    const channel = channelName(m[1], m[2], m[3])
    if (channel) out.push(channel)
  }
  return out
}

describe('IPC 通道白名单', () => {
  it('每个 ipc.handle(...) 的通道都在 IpcInvoke 里', () => {
    const missing: string[] = []
    for (const file of sources(path.join(ROOT, 'src/main'))) {
      const text = fs.readFileSync(file, 'utf8')
      for (const channel of handledChannels(text)) {
        if (!allowedChannels.has(channel)) missing.push(path.relative(ROOT, file) + ' → ' + channel)
      }
    }
    expect(missing, '这些通道没登记进白名单，渲染进程一调就抛：\n' + missing.join('\n')).toEqual([])
  })

  it('每个 broadcast(...) 的事件都在 IpcEvent 里', () => {
    const missing: string[] = []
    for (const file of sources(path.join(ROOT, 'src/main'))) {
      const text = fs.readFileSync(file, 'utf8')
      for (const m of text.matchAll(/broadcast\(\s*'([^']+)'/g)) {
        if (!allowedEvents.has(m[1])) missing.push(path.relative(ROOT, file) + ' → ' + m[1])
      }
    }
    expect(missing, '这些事件不在白名单，渲染进程订阅不到：\n' + missing.join('\n')).toEqual([])
  })

  /**
   * preload 里**本地实现**的同步方法：不走 invoke，所以主进程没有对应 handler 是对的。
   * （webUtils.getPathForFile 只能在渲染侧同步拿路径，跨进程反而拿不到 File 对象）
   */
  const LOCAL_ONLY = new Set(['system:path-for-file'])

  it('IpcInvoke 里没有主进程根本没实现的死通道', () => {
    const handled = new Set<string>()
    for (const file of sources(path.join(ROOT, 'src/main'))) {
      const text = fs.readFileSync(file, 'utf8')
      for (const channel of handledChannels(text)) handled.add(channel)
    }
    const dead = [...allowedChannels].filter((c) => !handled.has(c) && !LOCAL_ONLY.has(c))
    expect(dead, '这些通道声明了但主进程没实现：' + dead.join(', ')).toEqual([])
  })

  /**
   * 事件侧的同一味药（invoke 侧那条一上线就抓到过三个漏登记的通道）。
   *
   * 为什么现在补：R4 ① 要接的就是"事件在广播、没人订阅"和"白名单里躺着、从来没人广播"
   * 这两种东西 —— 一查发现 `IpcEvent` 里六个通道主进程从来没发过
   * （`unity:heartbeat` / `unity:project-started` / `unity:project-stopped` /
   * `import:progress` / `import:batch-changed` / `ingest:item`），
   * 其中 `import:batch-changed` 渲染层还挂着一个把 payload 直接 `JSON.stringify` 弹 toast 的
   * 调试残留订阅。**声明了没人发的通道比缺通道更坏**：它让后来人以为这条路是通的。
   */
  it('IpcEvent 里没有主进程从来没广播过的死事件', () => {
    const fired = new Set<string>()
    for (const file of sources(path.join(ROOT, 'src/main'))) {
      const text = fs.readFileSync(file, 'utf8')
      // 既认字面量，也认 `IpcEvent.X`（后者更不容易写错，没理由不认）。
      for (const m of text.matchAll(/broadcast\??\.?\(\s*(?:'([^']+)'|IpcEvent\.([A-Za-z0-9_]+))/g)) {
        const name = m[1] ?? (IpcEvent as Record<string, string>)[m[2] ?? '']
        if (name) fired.add(name)
      }
    }
    const dead = [...allowedEvents].filter((e) => !fired.has(e))
    expect(dead, '这些事件白名单里有、主进程一次都没广播：' + dead.join(', ')).toEqual([])
  })

  it('渲染层订阅的事件都在白名单里（不在的话 preload 会直接抛"未登记的事件通道"）', () => {
    const bad: string[] = []
    for (const file of sources(path.join(ROOT, 'src/renderer'))) {
      const text = fs.readFileSync(file, 'utf8')
      for (const m of text.matchAll(/window\.a\.on\(\s*'([^']+)'/g)) {
        if (!allowedEvents.has(m[1])) bad.push(path.relative(ROOT, file) + ' → ' + m[1])
      }
    }
    expect(bad, '这些订阅的通道没登记，运行时是当场抛错：\n' + bad.join('\n')).toEqual([])
  })
})
