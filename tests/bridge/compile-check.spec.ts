import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

/**
 * **用 Unity 自带的 Roslyn 真编译一遍桥接 C#。**
 *
 * 之前一直说"C# 桥接未经 Unity 编译验证，只能靠用户点一下"——不必：
 * Unity 安装目录里带着编译器（`Editor/Data/DotNetSdkRoslyn/csc.dll`）
 * 与全部引用程序集，所以"能不能编过"完全可以离线验证。
 *
 * 这**不等于**在 Unity 里跑过（运行时的心跳、导入回调、Busy 时序仍需真 Unity），
 * 但它能抓住最致命的失败：**编译不过**。那种情况下用户装完桥接，
 * Unity Console 直接报错、桥接完全不工作 —— 是最该在交付前拦住的错误。
 *
 * 环境没有 Unity（或路径不同）时**跳过并说明**，不把整仓测试搞红。
 * 路径可用 `AVCA_UNITY_ROOT` 覆盖。
 */

const REPO = path.resolve(__dirname, '../..')
const SCRIPT = path.join(REPO, 'tools', 'check-bridge-compile.cjs')
const UNITY_ROOT = process.env.AVCA_UNITY_ROOT || 'E:\\unity\\2022.3.22f1'
const DNET = path.join(UNITY_ROOT, 'Editor', 'Data', 'NetCoreRuntime', 'dotnet.exe')

/** 退出码 2 = 脚本自己报"环境缺引用程序集"，那种情况该 skip 而不是 fail */
function runCheck(): { status: number; output: string } {
  const r = spawnSync(process.execPath, [SCRIPT, UNITY_ROOT], {
    encoding: 'utf8',
    cwd: REPO,
    windowsHide: true
  })
  return { status: r.status ?? -1, output: `${r.stdout ?? ''}${r.stderr ?? ''}` }
}

describe('桥接 C# 编译检查（用 Unity 自带的 Roslyn）', () => {
  it('能在 Unity 2022.3 的引擎程序集下编过；环境不具备时跳过', (ctx) => {
    if (!fs.existsSync(DNET)) {
      /** 这台机器没装/没在预期位置装 Unity —— 跳过，并说明怎么打开这条检查 */
      console.log(`[skip] 找不到 Unity 运行时：${DNET}`)
      ctx.skip()
      return
    }
    const { status, output } = runCheck()
    if (status === 2) {
      console.log('[skip] 环境缺引用程序集：\n' + output)
      ctx.skip()
      return
    }
    /** 编译器的原始输出对排错很重要，成功失败都打出来 */
    console.log(output)
    expect(status, '编译失败 —— 上面是编译器的原始输出').toBe(0)
    expect(output).toContain('编译通过')
  }, 180_000)

  it('编出来的 DLL 落在 out/ 下，且不是空文件', (ctx) => {
    if (!fs.existsSync(DNET)) {
      ctx.skip()
      return
    }
    const dll = path.join(REPO, 'out', 'bridge-compile-check', 'AVCA.Bridge.dll')
    if (!fs.existsSync(dll)) {
      /** 上一条用例已经编过并断言过；这里只在 DLL 不存在时跳过（比如单独跑这条） */
      runCheck()
    }
    if (!fs.existsSync(dll)) {
      ctx.skip()
      return
    }
    expect(fs.statSync(dll).size).toBeGreaterThan(1024)
  }, 180_000)
})
