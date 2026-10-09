import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { requireSandboxHome, resolveAppHome } from '../../src/main/services/paths'

/**
 * 运行时目录的落点（`AVCA_APP_HOME`）。
 *
 * 这一组用例是被一次**真实事故**逼出来的：2026-10-06 做 M5-B 成员面板活体时，
 * 以为改 `process.env.APPDATA` 就能把整个运行时目录指到沙盒 ——
 * 但 `app.getPath('appData')` 在 Windows 上取的是系统 known folder，
 * `APPDATA` 根本不生效，dev 起来第一行日志就是「数据库就绪 C:\Users\…\A\library.db」，
 * 于是 V5 迁移写进了用户的真库。修法是环境变量改叫 `AVCA_APP_HOME` 并由我们自己读，
 * 而**判据必须能单独测**（`initAppPaths()` 碰 electron 的 `app`，node 环境里测不了）。
 */
describe('运行时目录落点（AVCA_APP_HOME）', () => {
  const REAL = 'C:\\Users\\you\\AppData\\Roaming\\A'

  it('不设环境变量 → 用传进来的默认目录（%APPDATA%\\A）', () => {
    expect(resolveAppHome(undefined, REAL)).toBe(REAL)
    expect(resolveAppHome('', REAL)).toBe(REAL)
    expect(resolveAppHome('   ', REAL)).toBe(REAL)
  })

  it('设了沙盒目录 → 整个运行时目录跟过去，和 appData 再无关系', () => {
    expect(resolveAppHome('D:\\avca-m5b-live\\AppData\\Roaming\\A', REAL)).toBe(
      'D:\\avca-m5b-live\\AppData\\Roaming\\A'
    )
  })

  it('路径里没有 avca / sandbox 字样 → 抛，绝不悄悄写到别的地方', () => {
    /** 典型手滑：想指沙盒却填成了真库位置 / 别人的目录 / 一个不明所以的路径 */
    expect(() => resolveAppHome(REAL, REAL)).toThrow(/不像沙盒目录/)
    expect(() => resolveAppHome('D:\\temp\\run', REAL)).toThrow(/不像沙盒目录/)
    expect(() => resolveAppHome('E:\\vrc\\A', REAL)).toThrow(/不像沙盒目录/)
  })

  it('抛的时候把要写的目录打进消息里（不然排查只能靠猜）', () => {
    expect(() => resolveAppHome('D:\\random\\place', REAL)).toThrow('D:\\random\\place')
  })

  it('沙盒字样在**任何一段**都算（不限定盘符、不限定大小写）', () => {
    expect(resolveAppHome('E:\\AVCA-Sandbox\\A', REAL)).toBe('E:\\AVCA-Sandbox\\A')
    expect(resolveAppHome('D:\\x\\myapp\\sandbox', REAL)).toBe('D:\\x\\myapp\\sandbox')
  })

  it('initAppPaths 真的读这个变量（不许写成只给测试用的死函数）', () => {
    /**
     * 这条断言的存在理由就是纪律④「实现了不等于生效了」：
     * `resolveAppHome` 写好了、`initAppPaths` 却照旧只走 `app.getPath('appData')` ——
     * 那就是上面四条全绿而真库照旧被写。所以直接读源码把接线钉住，
     * 而且**先剥注释**（注释里出现 `process.env.AVCA_APP_HOME` 不算接上过）。
     */
    const src = fs.readFileSync(path.resolve(process.cwd(), 'src/main/services/paths.ts'), 'utf8')
    const body = src.slice(src.indexOf('export function initAppPaths'))
    const code = stripComments(body)
    expect(code).toContain('resolveAppHome(')
    expect(code).toContain('process.env.AVCA_APP_HOME')
  })
})

/**
 * `requireSandboxHome` —— 第二道闸，管的是**"根本没设 `AVCA_APP_HOME`"** 那一类。
 *
 * 2026-10-09 一天内两次越界都是这一类（12:13 漏了重定向的 dev 实例；17:24 我为了看打包版
 * 版本号直接 `Atrium.exe --version`，而**打包版 Electron 不认这个参数**，于是按普通启动
 * 打开了用户的真库并跑了一轮工程发现）。`tools/dev.cjs` 那道闸第二次完全没参与，
 * 所以这道闸必须放在应用自己身上：带上了这个变量，指错或没指都当场死。
 */
describe('AVCA_REQUIRE_SANDBOX_HOME（只允许在沙盒里跑的声明）', () => {
  const REAL = 'C:\\Users\\you\\AppData\\Roaming\\A'

  it('没设 / 设成 0 / 空白 → 完全不干预（用户平时就这么跑）', () => {
    expect(requireSandboxHome(undefined, REAL)).toBeNull()
    expect(requireSandboxHome('', REAL)).toBeNull()
    expect(requireSandboxHome('0', REAL)).toBeNull()
    expect(requireSandboxHome('  ', REAL)).toBeNull()
  })

  it('设成 1 而目录不像沙盒 → 拒绝，并把算出来的路径写进原因里', () => {
    const r = requireSandboxHome('1', REAL)
    expect(r, '真库目录必须被拒').toBeTruthy()
    expect(r).toContain(REAL)
  })

  it('设成 1 且目录确实是沙盒 → 放行（三种写法都认：avca / sandbox / -live）', () => {
    expect(requireSandboxHome('1', 'D:\\avca-m7-live\\AppData')).toBeNull()
    expect(requireSandboxHome('1', 'D:\\sandbox\\A')).toBeNull()
    expect(requireSandboxHome('1', 'D:\\avca-m5b-live\\AppData\\Roaming\\A')).toBeNull()
  })

  it('⭐ 这道闸真的接在 initAppPaths 里（写了没人调 = 第二个死设置）', () => {
    const src = fs.readFileSync(path.resolve(process.cwd(), 'src/main/services/paths.ts'), 'utf8')
    const body = stripComments(src.slice(src.indexOf('export function initAppPaths')))
    expect(body).toContain('requireSandboxHome(')
    expect(body).toContain('process.env.AVCA_REQUIRE_SANDBOX_HOME')
    expect(body, '拒绝之后必须真的抛，不能只是打一行日志').toContain('throw')
  })
})

/** 剥掉 `//` 行注释与块注释，只留代码 —— 判断"这行到底有没有被写进代码"必须这么做 */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split(/\r?\n/)
    .filter((l) => !/^\s*\/\//.test(l))
    .join('\n')
}
