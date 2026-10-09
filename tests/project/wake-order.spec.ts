import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

/**
 * M6 ⑥ 的唤醒：`wakeForProject()` 里"窗口是不是藏着的"必须在**拿窗口之前**问。
 *
 * 为什么这条只能静态查（没有 Electron 环境）：`window.ts` 顶层就要读 `app.isPackaged`、
 * 里面全是 `BrowserWindow`，node 测试环境里 `app` 是 undefined —— 一 import 就炸
 * （`running-wiring.spec.ts` 当年就是为了这个才把 `wake` 做成注入的）。
 * 但这条缺陷**恰好是顺序问题**，不是算术问题，所以顺序本身就是要钉的东西：
 * 第 5 轮活体（`tools/live-r5-m6-debts.cjs --case=wake`）量到 `WS_EX_TOPMOST` 全程 false、
 * 日志里没有"已从托盘唤醒主窗口" —— 因为 `createMainWindow()` 在窗口已存在时会顺手
 * `show() + focus()`，先调它再读 `isVisible()` 得到的永远是"本来就开着"，
 * 置顶那一段一次都没跑过。窗口能弹出来只是那个副作用的巧合，掩盖了整条没生效的事实。
 *
 * ⚠ 这类"屏幕上看着对了，其实对在了别的东西上"的形状，是 M6 那条纪律的第二次应验：
 * 用例名字/注释写着顺序，断言里就得真的查顺序。
 */

const SRC = fs.readFileSync(path.resolve(__dirname, '../../src/main/window.ts'), 'utf8')

/** 注释里写满了"先问再拿"这类话，扫顺序之前必须剥掉，否则注释自己就能把断言喂绿 */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split(/\r?\n/)
    .filter((l) => !/^\s*\/\//.test(l))
    .join('\n')
}

const CODE = stripComments(SRC)

/** 取 wakeForProject 的函数体（到下一个顶层 `export ` 之前为止） */
function wakeBody(code: string): string {
  const start = code.indexOf('export async function wakeForProject')
  expect(start, 'window.ts 里找不到 wakeForProject（改名了？那这条保护就失效了，要一起改）').toBeGreaterThanOrEqual(0)
  const rest = code.slice(start + 10)
  const next = rest.search(/\nexport (async )?(function|const)/)
  return next < 0 ? code.slice(start) : code.slice(start, start + 10 + next)
}

describe('托盘唤醒（M6 ⑥）的顺序与置顶', () => {
  it('⭐ 先读"是不是藏着的"，再调 createMainWindow（它的副作用会把窗口 show 出来）', () => {
    const b = wakeBody(CODE)
    const hidden = b.search(/const\s+wasHidden\s*=/)
    const create = b.indexOf('createMainWindow()')
    expect(hidden, 'wakeForProject 里没有 wasHidden 这个判据了').toBeGreaterThanOrEqual(0)
    expect(create, 'wakeForProject 里没有再调 createMainWindow').toBeGreaterThanOrEqual(0)
    expect(hidden, '判据必须在 createMainWindow() 之前算 —— 那个函数会顺手 show()+focus()，之后 isVisible() 恒为 true').toBeLessThan(create)
    /** 判据要读的是"已存在的那个窗口"，不是刚拿回来的那个 */
    expect(b.slice(0, hidden), 'wasHidden 之前得先拿到 existing（getMainWindow），不能拿 createMainWindow 的返回值判').toMatch(/getMainWindow\(\)/)
  })

  it('置顶亮了之后一定取消（放在 finally 里，抛错也要关）', () => {
    const b = wakeBody(CODE)
    expect(b).toMatch(/setAlwaysOnTop\(\s*true\s*\)/)
    const off = b.search(/setAlwaysOnTop\(\s*false\s*\)/)
    expect(off, '没有取消置顶的那一步 —— A 会永远压在 Unity 上面').toBeGreaterThanOrEqual(0)
    expect(b.slice(0, off), '取消置顶必须在 finally 里').toMatch(/finally\s*\{/)
  })

  it('本来就开着的时候不抢焦点（返回 already-visible，不置顶）', () => {
    const b = wakeBody(CODE)
    const early = b.search(/return\s+'already-visible'/)
    expect(early, '没有"本来就开着就不动"这条早退').toBeGreaterThanOrEqual(0)
    expect(early, '早退必须在 setAlwaysOnTop(true) 之前 —— 否则每次检测到工程都闪一下置顶，那是骚扰').toBeLessThan(
      b.search(/setAlwaysOnTop\(\s*true\s*\)/)
    )
  })

  it('置顶时长用的是常量，不是写死的数（Q6 裁的 1.2 秒要能一处改）', () => {
    const b = wakeBody(CODE)
    expect(b, '唤醒那段不许写死毫秒数').toMatch(/WAKE_TOPMOST_MS/)
    expect(b).not.toMatch(/setTimeout\([^)]*\b1200\b/)
  })
})
