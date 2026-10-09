import { execFile } from 'node:child_process'
import log from 'electron-log'

/**
 * 路径 3（**仅兜底**）：从进程命令行里认出 Unity 打开了哪个工程。
 *
 * ## 为什么必须只当兜底
 *
 * 规格 §4.2 原文点名过这件事：**Unity 以管理员权限启动时，非管理员进程读不到它的
 * `CommandLine`（返回 null）**。这是 Windows 的既定行为，不是 bug。
 * 所以"检测 Unity 是否运行"**绝不能**只靠这一路，否则用户会遇到
 * "A 检测不到 Unity"的诡异问题 —— 而且只在"用管理员身份跑 Unity"时才复现，
 * 极难自己发现。真正的主路径是 `UnityLockfile` 独占试开与桥接心跳。
 *
 * ## 用 PowerShell 的 `Get-CimInstance` 而不是 wmic
 *
 * `wmic` 在新版 Windows 上已被移除；`Get-CimInstance Win32_Process` 是官方替代。
 * 查询本身较慢，所以规格要求**每 5 秒一次，不要更频繁**（§4.2）。
 */

export interface WmiProbeResult {
  /** 查到的 Unity 进程：pid + 它打开的工程路径（命令行 -projectPath 的值） */
  projects: Array<{ pid: number; projectPath: string }>
  /** 查询本身失败的原因（PowerShell 不在、超时、权限不足） */
  error: string | null
  /** 确实跑了一次查询（用于区分"查询失败"与"没查"） */
  queried: boolean
}

/**
 * PowerShell 脚本：只输出 `进程号|完整命令行` 两行一组，解析放在 JS 里做。
 *
 * 刻意**不在 PowerShell 里做正则**：那里的转义规则和 cmd/JS 都不一样，
 * 一台机器上写对、另一台就错。让 PowerShell 只负责取原始数据。
 *
 * ## ⚠ 为什么用 `-join '|'` 而不是 `"$($_.ProcessId)|$($_.CommandLine)"`
 *
 * 原来的写法里有**一对双引号**。这对引号在
 * `execFile` → `CreateProcess` → PowerShell 自己的命令行解析之间会被吃掉，
 * 于是那个 `|` 就变成了**管道运算符**，PowerShell 直接报：
 *
 * ```
 * Expressions are only allowed as the first element of a pipeline.
 * ```
 *
 * 后果：**WMI 这一路从来没成功过**。而且它失败得很安静 ——
 * `probeUnityProcesses` 永不抛、失败只记 debug 日志，而 `lockfile` / `bridge`
 * 两路正常时结果照样对，所以这个坏掉的路被遮住了很久。
 * （2026-10-06 在真机上跑 `tests/project/*` 时才从日志里看出来。）
 *
 * `-join '|'` 只用单引号，**不含任何双引号**，从根上避开转义问题；
 * 再加 `-EncodedCommand` 传输，连命令行解析都不必依赖。
 *
 * 另外**不再设 `$ErrorActionPreference`**：`-EncodedCommand` 模式下改这个变量
 * 会让它失效（PowerShell 的已知行为），而我们靠 `2>$null` 与 `try/catch` 静默，
 * 本来也不需要它。
 */
const PS_SCRIPT = [
  'try {',
  "  Get-CimInstance Win32_Process -Filter \"Name='Unity.exe'\" -ErrorAction SilentlyContinue 2>$null |",
  "    ForEach-Object { @($_.ProcessId, $_.CommandLine) -join '|' }",
  '} catch { }'
].join('\n')

/**
 * PowerShell 的 `-EncodedCommand` 要 **UTF-16LE + Base64**。
 * 这么传可以完全绕开"引号被吃"这一层 —— 脚本原文里的引号一个都不用在命令行上出现。
 */
export function encodePowerShellCommand(script: string): string {
  return Buffer.from(script, 'utf16le').toString('base64')
}

/** 从命令行里抠 `-projectPath <path>`（Unity 的官方参数名，大小写不敏感） */
export function parseProjectPathFromCommandLine(cmd: string | null | undefined): string | null {
  if (!cmd) return null
  /**
   * 路径可能带引号、也可能不带（带空格就必然带引号）。
   * `[^"]+` 与 `\S+` 两支覆盖这两种写法。
   */
  const m = /-projectPath\s+(?:"([^"]+)"|(\S+))/i.exec(cmd)
  const raw = m?.[1] ?? m?.[2]
  if (!raw) return null
  /** 去掉可能的尾随引号/斜杠，统一成 Windows 反斜杠形式 */
  return raw.trim().replace(/["']+$/, '').replace(/\/+$/, '').replace(/\//g, '\\')
}

/** 解析 PowerShell 的原始输出。抽成纯函数是为了能直接测，不必真跑进程 */
export function parseWmiOutput(stdout: string): Array<{ pid: number; projectPath: string }> {
  const out: Array<{ pid: number; projectPath: string }> = []
  for (const line of stdout.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || !trimmed.includes('|')) continue
    const idx = trimmed.indexOf('|')
    const pid = Number(trimmed.slice(0, idx))
    if (!Number.isFinite(pid) || pid <= 0) continue
    const projectPath = parseProjectPathFromCommandLine(trimmed.slice(idx + 1))
    if (!projectPath) continue
    out.push({ pid, projectPath })
  }
  return out
}

export interface WmiOptions {
  timeoutMs?: number
  powershellPath?: string
}

/**
 * 跑一次 WMI 查询。**永不抛** —— 兜底路径失败就是"这一路没结论"，
 * 另外两路照常工作，不该让整个探测循环崩掉。
 */
export function probeUnityProcesses(opts: WmiOptions = {}): Promise<WmiProbeResult> {
  const timeout = opts.timeoutMs ?? 5000
  const exe = opts.powershellPath ?? 'powershell.exe'
  const encoded = encodePowerShellCommand(PS_SCRIPT)
  return new Promise((resolve) => {
    execFile(
      exe,
      ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded],
      { timeout, windowsHide: true, maxBuffer: 4 * 1024 * 1024, encoding: 'utf8' },
      (err, stdout) => {
        if (err) {
          /**
           * 超时/权限不足都不是致命错误。降级成 debug 级，
           * 免得每 5 秒往日志里写一条吓人的 ERROR。
           *
           * ⚠ 但也**不能像以前那样没人看得见**：这条曾经因为引号转义问题
           * 从来没成功过，而失败只进了 debug，被另外两路遮住很久。
           * 所以第一次失败会额外给一条 warn（见下方 `warnedOnce`），
           * 让"兜底路一直是坏的"在日志里留个痕。
           */
          const msg = err.message || String(err)
          log.debug('[wmi] Unity 进程查询失败（兜底路，忽略）：' + msg)
          if (!warnedOnce) {
            warnedOnce = true
            log.warn(
              '[wmi] 兜底路（进程命令行）查询失败一次，之后静默：' +
                msg.split('\n')[0] +
                ' —— 不影响主路径（锁文件 / 桥接心跳），但若一直失败说明这条兜底是坏的'
            )
          }
          resolve({ projects: [], error: msg, queried: true })
          return
        }
        resolve({ projects: parseWmiOutput(String(stdout ?? '')), error: null, queried: true })
      }
    )
  })
}

/** 失败只完整报一次，避免每 5 秒刷一条 */
let warnedOnce = false

/** 只给测试用：把"已经警告过"的状态复位 */
export function __resetWmiWarn(): void {
  warnedOnce = false
}
