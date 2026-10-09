import fs from 'node:fs'
import path from 'node:path'

/**
 * 路径 2 的探测：`Temp/UnityLockfile`。
 *
 * ## 为什么"文件存在"不等于"Unity 在运行"
 *
 * Unity 异常退出（崩溃、被任务管理器杀掉）时这个文件会**残留**。
 * 只判断 `existsSync` 会让程序长期坚称一个早就关掉的工程"正在运行"，
 * 用户在这个状态下点导入就会一直排队等一个永远不会来的 Unity。
 *
 * ## 正确判据：尝试独占打开
 *
 * Unity 在运行时**持有这个文件的独占句柄**，所以：
 *  - 独占打开**成功** → 没有别人持有 → Unity **没在**运行（残留的锁文件）
 *  - 独占打开**失败（EBUSY / EPERM / EACCES）** → 有人持有 → Unity **在**运行
 *
 * 这是规格 §4.2 写的「配合"尝试独占打开"来判断，**不能只看文件是否存在**」。
 *
 * 只读约束：打开成功后立刻关闭，**绝不写入或截断**这个文件 ——
 * 它是 Unity 自己的锁，动它可能让 Unity 以为另一个实例在跑。
 */

export interface LockfileProbe {
  /** 文件在不在（诊断用，**不是**运行判据） */
  present: boolean
  /** 独占试开的结论：true = 有人在持有（= Unity 在运行） */
  held: boolean
  /** 试不开的具体错码，排障用 */
  code: string | null
  file: string
}

/** 这些错码表示"有人持有这个文件"。实测 Unity/.NET 的 FileShare.None 会让 Node 拿到 EBUSY */
const HELD_CODES = new Set(['EBUSY', 'EPERM', 'EACCES'])

export function unityLockfilePath(projectPath: string): string {
  return path.join(projectPath, 'Temp', 'UnityLockfile')
}

/**
 * 试开一次。**同步**是有意的：它只做 open+close，比 async 更好推理，
 * 而且调用方是每 3 秒一次的轻量轮询（规格 §4.2），不占主线程。
 *
 * ⚠ 为什么必须用 `r+`（读写）而不是 `r`（只读）：
 * Unity 是持 `_SH_DENYWR`（禁止别人写）打开这个文件的，所以**只有请求写权限的打开才会被拒**。
 * 用 `r` 去试会在 Unity 正开着的时候也成功，于是这一路永远判定"没在运行"。
 * 实测（2026-10-06）：PowerShell/.NET 以 `FileShare.None` 持有时，
 * Node 的 `openSync(path,'r+')` 抛 `EBUSY`，而 `'r'` 能打开 —— 差别就是这一条。
 */
export function probeUnityLockfile(projectPath: string): LockfileProbe {
  const file = unityLockfilePath(projectPath)
  let fd: number | null = null
  try {
    fd = fs.openSync(file, 'r+')
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code ?? null
    if (code === 'ENOENT') {
      /** 文件都不在：Unity 没开（Temp 在 Unity 关闭时会被清理） */
      return { present: false, held: false, code, file }
    }
    /**
     * 被独占 → 判定在运行。**宁可偶尔误判成"在运行"**（用户会看到工程亮着、
     * 点导入会排队），也不要误判成"没运行"（那会让导入静默打到一个不存在的目标上）。
     *
     * 但只把已知的"被占用"错码算作 held：别的错（比如路径过长 ENAMETOOLONG、
     * 文件系统错误）说明我们**没能做出判断**，那种情况下 `held` 只作为弱信号。
     * 调用方靠三路取并集，所以这里保守一点不会漏掉真正的运行状态。
     */
    return { present: true, held: HELD_CODES.has(code ?? ''), code, file }
  } finally {
    if (fd !== null) {
      try {
        fs.closeSync(fd)
      } catch {
        /* 关不掉也不影响结论 */
      }
    }
  }
  /** 能独占打开 = 没人持有。文件可能是残留的 */
  return { present: true, held: false, code: null, file }
}
