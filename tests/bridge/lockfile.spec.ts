import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { probeUnityLockfile, unityLockfilePath } from '../../src/main/project/lockfile'
import {
  __resetWmiWarn,
  encodePowerShellCommand,
  parseProjectPathFromCommandLine,
  parseWmiOutput,
  probeUnityProcesses
} from '../../src/main/project/wmi'

/**
 * 路径 2（UnityLockfile）与路径 3（WMI）的判据。
 *
 * 这两路写错的表现都是"偶尔检测不到 Unity"或者"Unity 明明关了却坚称开着"，
 * 而它们只在特定情况下复现（管理员权限、异常退出残留锁文件）。
 */

let root: string
let project: string

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'avca-lock-'))
  project = path.join(root, 'shinano-Main2')
  fs.mkdirSync(project, { recursive: true })
})

afterEach(() => {
  try {
    fs.rmSync(root, { recursive: true, force: true })
  } catch {
    /* 交给系统 */
  }
})

describe('UnityLockfile 独占试开（§4.2 / R-38）', () => {
  it('文件不存在 → present=false held=false（Unity 没开，Temp 被清理过）', () => {
    const p = probeUnityLockfile(project)
    expect(p.present).toBe(false)
    expect(p.held).toBe(false)
    expect(p.code).toBe('ENOENT')
    expect(p.file).toBe(unityLockfilePath(project))
  })

  it('文件存在但没人持有 → present=true held=false（**残留锁文件**，这是关键用例）', () => {
    const f = unityLockfilePath(project)
    fs.mkdirSync(path.dirname(f), { recursive: true })
    fs.writeFileSync(f, 'unity lock', 'utf8')
    const p = probeUnityLockfile(project)
    expect(p.present).toBe(true)
    /** 只判断"文件存在"会在这里误判成"Unity 在运行" */
    expect(p.held).toBe(false)
  })

  it('判定过程绝不改这个文件（它是 Unity 自己的锁）', () => {
    const f = unityLockfilePath(project)
    fs.mkdirSync(path.dirname(f), { recursive: true })
    fs.writeFileSync(f, 'unity lock content', 'utf8')
    const before = fs.statSync(f)
    probeUnityLockfile(project)
    const after = fs.statSync(f)
    expect(after.size).toBe(before.size)
    expect(fs.readFileSync(f, 'utf8')).toBe('unity lock content')
  })
})

/**
 * ⚠ 这两个用例的"持有者"必须是**会真正独占**的进程。
 *
 * 第一版测试在同一个进程里 `fs.openSync(f,'r+')` 当持有者，甚至跨进程用 Node 当持有者，
 * 判定都得到 `held=false`。那不是代码错，是**测试模拟不出来**：
 * Node/libuv 在 Windows 上打开文件时带了共享标志，它的 `open` **不构成独占**，
 * 所以别人照样打得开（实测跨进程也一样）。
 *
 * 真正独占要显式 `FileShare.None`。实测（2026-10-06）：
 *   - PowerShell/.NET `[IO.File]::Open(path,'Open','ReadWrite','None')` 持有
 *   - 此时 Node 的 `openSync(path,'r+')` 抛 **EBUSY** ← 判据成立
 * 这正是 Unity 持锁的形态，所以用 PowerShell 当持有者才贴近真实。
 */
describe('UnityLockfile：跨进程独占（真正模拟 Unity 持锁）', () => {
  const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

  /** 起一个 FileShare.None 的持有者，等到它真的把文件锁住为止；环境起不来时返回 null */
  async function startExclusiveHolder(
    f: string
  ): Promise<import('node:child_process').ChildProcess | null> {
    /** -Wait 之外用 Start-Sleep 顶着；8 秒足够跑完断言 */
    const ps = `$fs=[System.IO.File]::Open('${f}','Open','ReadWrite','None'); Start-Sleep -Seconds 8; $fs.Close()`
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], {
      stdio: 'ignore',
      windowsHide: true
    })
    /**
     * 轮询到"它真的锁上了"再断言，避免和子进程启动竞态。
     *
     * ⚠ 这里的超时是**给慢环境的余量**，不是"等一个应该发生的事"：
     * PowerShell 冷启动 + FileShare.None 在满载机器上偶尔要好几秒。
     * 超时后**不抛**，返回 null 让用例 `skip` —— 环境起不来子进程时，
     * 把整仓测试搞红没有意义（这条验的是 Windows 独占语义，不是我们的代码有 bug）。
     * 实测：全量并发跑时 8 秒偶尔不够，单独跑从没失败过。
     */
    const deadline = Date.now() + 25_000
    for (;;) {
      if (probeUnityLockfile(project).held) return child
      if (Date.now() > deadline) {
        child.kill()
        return null
      }
      await sleep(50)
    }
  }

  it('另一个进程以 FileShare.None 占着 → held=true，报 EBUSY（真的在运行）', async (ctx) => {
    const f = unityLockfilePath(project)
    fs.mkdirSync(path.dirname(f), { recursive: true })
    fs.writeFileSync(f, 'unity lock', 'utf8')

    const child = await startExclusiveHolder(f)
    if (!child) {
      console.log('⚠ 独占持有者起不来（满载机器上 PowerShell 冷启动 25 秒超时）→ 这一条本轮**没验**，不算通过')
      ctx.skip()
      return
    }
    try {
      const p = probeUnityLockfile(project)
      expect(p.present).toBe(true)
      expect(p.held).toBe(true)
      expect(p.code).toBe('EBUSY')
    } finally {
      child.kill()
    }
  })

  it('持有者退出后 → held=false（不会被残留锁文件骗住）', async (ctx) => {
    const f = unityLockfilePath(project)
    fs.mkdirSync(path.dirname(f), { recursive: true })
    fs.writeFileSync(f, 'unity lock', 'utf8')

    const child = await startExclusiveHolder(f)
    if (!child) {
      console.log('⚠ 独占持有者起不来（满载机器上 PowerShell 冷启动 25 秒超时）→ 这一条本轮**没验**，不算通过')
      ctx.skip()
      return
    }
    child.kill()
    /** 等它真正退出并释放句柄 */
    const deadline = Date.now() + 10_000
    while (probeUnityLockfile(project).held && Date.now() < deadline) await sleep(50)

    const after = probeUnityLockfile(project)
    expect(after.present).toBe(true)
    expect(after.held).toBe(false)
  })
})

describe('WMI 命令行解析（§4.2 路径 3，仅兜底）', () => {
  it('⭐ 那条 PowerShell 命令**真的能跑**（曾经因为引号转义从来没成功过）', async () => {
    /**
     * 这个用例是 2026-10-06 抓到的真 bug 的回归。
     *
     * 旧脚本里有 `"$($_.ProcessId)|$($_.CommandLine)"` —— 那对**双引号**
     * 在 `execFile` → `CreateProcess` → PowerShell 解析之间被吃掉，
     * 于是 `|` 变成管道运算符，PowerShell 报：
     *   Expressions are only allowed as the first element of a pipeline.
     *
     * 后果：**WMI 这一路从来没成功过**，而且失败得很安静
     * （`probeUnityProcesses` 永不抛、只记 debug），被 lockfile / bridge 遮住很久。
     *
     * 所以这里断言的是 `queried && !error` —— 即"命令真的跑通了"，
     * 而不是"解析函数对不对"。没有 Unity 在跑时 `projects` 为空是**正确**结果。
     */
    __resetWmiWarn()
    const r = await probeUnityProcesses()
    expect(r.queried, '压根没查').toBe(true)
    expect(
      r.error,
      'PowerShell 命令跑不通了 —— 检查 PS_SCRIPT 里是不是又出现了会破坏转义的引号'
    ).toBeNull()
  }, 30_000)

  it('编码成 -EncodedCommand 时用的是 UTF-16LE + Base64，且能解回原文', () => {
    const script = "ForEach-Object { @($_.ProcessId, $_.CommandLine) -join '|' }"
    const b64 = encodePowerShellCommand(script)
    expect(b64).toMatch(/^[A-Za-z0-9+/]+=*$/)
    /** PowerShell 要求 UTF-16LE，用 utf8 编会得到一个能过 Base64 校验但跑不起来的串 */
    expect(Buffer.from(b64, 'base64').toString('utf16le')).toBe(script)
  })

  it('脚本里**不含任何双引号**（这是那个 bug 的根因，要钉死）', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../../src/main/project/wmi.ts'), 'utf8')
    const m = /const PS_SCRIPT = \[([\s\S]*?)\]\.join\('\\n'\)/.exec(src)
    expect(m, '没抠到 PS_SCRIPT，抠取规则可能失效了').toBeTruthy()
    const body = m![1]
    /**
     * 允许 TypeScript 源码里的 `\"`（那是为了在 JS 字符串里表示 PowerShell 的
     * 单引号过滤条件），但**经过 JS 求值后**不该剩下裸的双引号。
     * 这里直接求值 PS_SCRIPT 的语义等价物太绕，改为断言：源码里没有
     * `"$(` 这种"双引号包住变量展开"的写法 —— 那正是被吃掉的那种。
     */
    expect(body, 'PS_SCRIPT 里又出现了双引号包住变量展开的写法').not.toContain('"$(')
  })

  it('抠出 -projectPath 的带引号写法', () => {
    const cmd = '"E:\\unity\\2022.3.22f1\\Editor\\Unity.exe" -projectPath "E:\\ALCOMprojects\\shinano-Main2"'
    expect(parseProjectPathFromCommandLine(cmd)).toBe('E:\\ALCOMprojects\\shinano-Main2')
  })

  it('不带引号的写法也能抠', () => {
    expect(parseProjectPathFromCommandLine('Unity.exe -projectPath E:\\proj\\A -batchmode')).toBe('E:\\proj\\A')
  })

  it('大小写不敏感（Unity 参数名实际就是 -projectPath，但别赌）', () => {
    expect(parseProjectPathFromCommandLine('unity -PROJECTPATH "E:\\p"')).toBe('E:\\p')
  })

  it('正斜杠统一成反斜杠、去尾斜杠', () => {
    expect(parseProjectPathFromCommandLine('Unity -projectPath "E:/ALCOMprojects/A/"')).toBe('E:\\ALCOMprojects\\A')
  })

  it('没有 -projectPath（如 -createProject）→ null', () => {
    expect(parseProjectPathFromCommandLine('Unity.exe -createProject E:\\new')).toBeNull()
    expect(parseProjectPathFromCommandLine('')).toBeNull()
    expect(parseProjectPathFromCommandLine(null)).toBeNull()
  })

  it('解析 Get-CimInstance 的 "pid|CommandLine" 输出', () => {
    const stdout = [
      '12345|"C:\\Program Files\\Unity\\Editor\\Unity.exe" -projectPath "E:\\ALCOMprojects\\shinano-Main2"',
      '23456|"C:\\Program Files\\Unity\\Editor\\Unity.exe" -projectPath "E:\\ALCOMprojects\\Milfy-Main"',
      ''
    ].join('\r\n')
    const got = parseWmiOutput(stdout)
    expect(got).toHaveLength(2)
    expect(got[0]).toEqual({ pid: 12345, projectPath: 'E:\\ALCOMprojects\\shinano-Main2' })
    expect(got[1].pid).toBe(23456)
  })

  it('**CommandLine 为 null 的进程整行跳过**（管理员 Unity 读不到，这是主路径不能靠 WMI 的原因）', () => {
    const stdout = ['111|', '222|Unity.exe -projectPath "E:\\p"'].join('\n')
    const got = parseWmiOutput(stdout)
    expect(got).toHaveLength(1)
    expect(got[0].pid).toBe(222)
  })

  it('垃圾行（没有 | 、pid 不是数字、空行）一律跳过', () => {
    const stdout = ['', '   ', 'garbage without pipe', 'abc|Unity -projectPath "E:\\p"', '0|Unity -projectPath "E:\\q"'].join('\n')
    expect(parseWmiOutput(stdout)).toEqual([])
  })

  it('进程在跑但没带 -projectPath → 不计入（认不出是哪个工程就没用）', () => {
    expect(parseWmiOutput('999|Unity.exe -batchmode -quit')).toEqual([])
  })
})
