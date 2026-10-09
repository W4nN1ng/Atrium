/**
 * M7 ② · 「没设库根就不许往库里写」这道闸门。
 *
 * ## 为什么单独一份
 *
 * `libraryRootOrThrow()` 这个函数**早就写好了**（注释还写着"不允许摄取/归档"），
 * 但全仓**一处都没调用过** —— 真正的拦截是 `ingest/api.ts` 里自己写的一句
 * `if (!s.libraryRoot) throw new Error('还没设置库根目录（设置 → 库）')`，
 * 而那句的文案和函数里那句还不一样（「还没」vs「尚未」）。
 *
 * 这就是这个仓库反复犯的那类错：**判据写好了、没人接**（`project/running.ts` 死代码、
 * `autoSwitchBehavior` / `bridgeAutoInstall` 两个死设置，见 `bridge-ask-wiring.spec.ts` 的说明）。
 * 所以这份用例两件事都要钉：
 *  1. 函数本身的行为（空 / 只有空格 / 有值）；
 *  2. **写路径真的调它**，而且全 `src/main` 里那句文案**只有一处**。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { setAppPathsForTest } from '../../src/main/services/paths'
import { libraryRootOrThrow, resetSettings, setSettings } from '../../src/main/services/settings'

function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split(/\r?\n/)
    .filter((l) => !/^\s*\/\//.test(l))
    .join('\n')
}

/** 递归列 src/main 下所有 .ts（扫描"这句文案只许有一处"用） */
function walk(dir: string): string[] {
  const out: string[] = []
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) out.push(...walk(p))
    else if (e.name.endsWith('.ts')) out.push(p)
  }
  return out
}

const MAIN_DIR = path.join(process.cwd(), 'src', 'main')

let dir = ''

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'avca-libroot-'))
  setAppPathsForTest(dir)
  resetSettings()
})

afterEach(() => {
  resetSettings()
  fs.rmSync(dir, { recursive: true, force: true })
})

describe('libraryRootOrThrow 的行为', () => {
  it('没设过库根 → 抛，而且说的是"库根"这件事', () => {
    setSettings({ libraryRoot: null })
    expect(() => libraryRootOrThrow()).toThrow(/库根/)
  })

  it('⭐ 只有空格的库根也算没设（不能让一个空串把闸门绕过去）', () => {
    setSettings({ libraryRoot: '   ' })
    expect(() => libraryRootOrThrow()).toThrow(/库根/)
  })

  it('设好了 → 原样返回（不许顺手 normalize 成别的样子，调用方拿它拼路径）', () => {
    setSettings({ libraryRoot: 'E:\\vrc\\A' })
    expect(libraryRootOrThrow()).toBe('E:\\vrc\\A')
  })

  it('错误文案里要指出去哪儿配（向导 / 设置 → 库），别只说"没设"', () => {
    setSettings({ libraryRoot: null })
    let msg = ''
    try {
      libraryRootOrThrow()
    } catch (e) {
      msg = e instanceof Error ? e.message : String(e)
    }
    expect(msg).toMatch(/向导/)
    expect(msg).toMatch(/设置/)
  })
})

describe('闸门真的接在写路径上（不是又一个死函数）', () => {
  it('⭐ ingest/api.ts 调了它，而且不再自己写那句文案', () => {
    const src = stripComments(fs.readFileSync(path.join(MAIN_DIR, 'ingest', 'api.ts'), 'utf8'))
    /** 单条入库 + 一键全部入库，两条写路径都要走闸门 */
    const calls = src.split('libraryRootOrThrow()').length - 1
    expect(calls, 'ingest/api.ts 里 commit() 与 ingest:commit-all 都该调它').toBeGreaterThanOrEqual(2)
    expect(src).not.toMatch(/if \(!s\.libraryRoot\) throw/)
  })

  it('⭐ 那句文案全 src/main 只有一处（口径不许散在调用点上）', () => {
    const hits = walk(MAIN_DIR)
      .map((f) => ({ f, src: stripComments(fs.readFileSync(f, 'utf8')) }))
      .filter((x) => /设置库根目录/.test(x.src))
      .map((x) => path.relative(MAIN_DIR, x.f).replace(/\\/g, '/'))
    expect(hits, '只有 services/settings.ts 里那句 throw 能带这句话').toEqual(['services/settings.ts'])
  })

  it('函数本体确实会抛（防止有人把守卫删了只留调用点）', () => {
    const src = stripComments(fs.readFileSync(path.join(MAIN_DIR, 'services', 'settings.ts'), 'utf8'))
    const body = src.slice(src.indexOf('export function libraryRootOrThrow'))
    expect(body.slice(0, 400)).toMatch(/throw new Error/)
  })
})
