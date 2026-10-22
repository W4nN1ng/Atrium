import { spawn as nodeSpawn, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { projectKeyOf } from '../../../shared/vpm/domain/project'
import { parseUnityVersion, unityVersionBase } from '../../../shared/vpm/domain/unityVersion'
import log from 'electron-log'
import { VpmError } from '../../../shared/vpm/errors'
import type { UnityInstall } from './editors'

/**
 * 启动 Unity（P5-D）。
 *
 * 规矩：
 * - 参数**只作为数组**传给 `spawn`，不经过 shell、不拼字符串；
 * - `detached + stdio:'ignore' + unref()`，不等待退出，Windows 不弹控制台；
 * - **先 `bindLaunchTarget` 再 spawn**：绑定立即生效，双击素材时能等它启动/连接；
 * - 启动失败/取消必须 `clearLaunchTarget`，不留旧目标；
 * - 已在运行 → 不重复启动，返回 `alreadyRunning`，但仍把该工程设为导入目标；
 * - 缺失编辑器**不自动换版本**，直接报 `vpmUnityNotFound`；
 * - **必须带上 Hub 的许可参数**（`-useHub -hubIPC -licensingIpc LicenseClient-<用户名>`）：
 *   裸 `Unity.exe -projectPath` 在 2022.3 上会卡在许可验证之后（实测：进程在、没有窗口、
 *   工程里连 Temp 都没有、Editor.log 里是 `LicensingClient has failed validation`）；
 * - 启动后**必须验证**：轮询 `Temp/UnityLockfile`，超时返回 `unverified` 并清掉绑定。
 */

const MAX_EXTRA_ARGS = 64
const MAX_ARG_LENGTH = 4096

export interface LaunchUnityInput {
  projectPath: string
  /** 本次启动指定编辑器（不写版本文件，只影响这一次）。 */
  editorPath?: string | null
  /** 工程设置里存的附加参数。 */
  extraArgs?: readonly string[]
  /** spawn 前绑定导入目标（gate 注入）。 */
  bindTarget?: (projectPath: string) => void
  /** 启动失败时清除绑定（gate 注入）。 */
  clearTarget?: (projectPath: string) => void
}

export type LaunchEditorSource = 'explicit' | 'project' | 'version'

export type LaunchStatus = 'launched' | 'alreadyRunning' | 'unverified'

export interface LaunchUnityResult {
  status: LaunchStatus
  exePath: string
  version: string | null
  args: string[]
  pid: number | null
  /** 看到 `Temp/UnityLockfile` 出现 = 工程真的被打开了。 */
  verified: boolean
}

export interface UnityLaunchDeps {
  /** 已发现的编辑器（`runtime.unity.list()`）。 */
  installs: () => readonly UnityInstall[]
  /** 工程台账里存的 exe 路径（`vpm_project.unity_exe_path`）。 */
  projectExePath?: (projectPath: string) => string | null
  /** 三路运行状态（心跳/进程/锁）。 */
  isRunning?: (projectPath: string) => boolean
  /** 测试可替换；生产用 `node:child_process.spawn`。 */
  spawn?: (command: string, args: readonly string[], options: Record<string, unknown>) => ChildProcess
  /** 验证超时与轮询间隔（默认 45s / 800ms）。 */
  verifyTimeoutMs?: number
  verifyIntervalMs?: number
  sleep?: (ms: number) => Promise<void>
  exists?: (target: string) => boolean
  /** 许可 IPC 通道名；默认 `LicenseClient-<当前用户名>`（和 Hub 用的一致）。 */
  licenseChannel?: string
  /** 当前在跑的工程（任意一个）；用来做"同时只开一个工程"的拒绝（R12）。 */
  runningProject?: () => { name: string; path: string } | null
}

/**
 * 当前进程是不是以管理员身份运行。
 *
 * 实测（2026-10-22）：管理员权限启动 Atrium 时，Unity 会继承管理员权限，
 * 而 Unity 的许可客户端是 Hub 用普通权限起的 → `LicensingClient has failed validation`
 * → Unity 卡在许可阶段（进程在、无窗口、不写 Editor.log）。这种失败必须能一眼看出来。
 */
export function isElevated(): boolean {
  try {
    const { execFileSync } = require('node:child_process') as typeof import('node:child_process')
    const output = execFileSync('whoami', ['/groups'], {
      encoding: 'utf8',
      windowsHide: true,
      // 这个探测是"尽力而为"：Windows 的 whoami.exe 和 Git 的 GNU whoami 参数不同，
      // 失败就当非管理员，不要往 stderr 吐错误。
      stdio: ['ignore', 'pipe', 'ignore']
    })
    // S-1-16-12288 = High Mandatory Level（管理员）
    return output.includes('S-1-16-12288')
  } catch {
    return false
  }
}

/** `LicenseClient-<用户名>` 里的用户名（和 Hub 用的同一个）。 */
function userName(): string {
  try {
    return os.userInfo().username
  } catch {
    return process.env.USERNAME ?? 'User'
  }
}

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

function isFile(target: string): boolean {
  try {
    const stat = fs.lstatSync(target)
    return stat.isFile() && !stat.isSymbolicLink()
  } catch {
    return false
  }
}

function readVersionFile(projectPath: string): string | null {
  try {
    const text = fs.readFileSync(
      path.join(projectPath, 'ProjectSettings', 'ProjectVersion.txt'),
      'utf8'
    )
    return /m_EditorVersion:\s*(\S+)/.exec(text)?.[1] ?? null
  } catch {
    return null
  }
}

/** 参数只允许普通字符串：拒绝空字节与换行（它们能改变进程语义）。 */
export function sanitizeArgs(input: readonly unknown[] | undefined): string[] {
  if (!input) return []
  if (!Array.isArray(input)) throw new VpmError('vpmUnityLaunchFailed', { reason: 'args' })
  if (input.length > MAX_EXTRA_ARGS) throw new VpmError('vpmUnityLaunchFailed', { reason: 'tooManyArgs' })
  const out: string[] = []
  for (const raw of input) {
    if (typeof raw !== 'string') throw new VpmError('vpmUnityLaunchFailed', { reason: 'argType' })
    if (!raw || raw.length > MAX_ARG_LENGTH) {
      throw new VpmError('vpmUnityLaunchFailed', { reason: 'argLength' })
    }
    if (/[\0\r\n]/.test(raw)) throw new VpmError('vpmUnityLaunchFailed', { reason: 'argChars' })
    out.push(raw)
  }
  return out
}

export class UnityLaunchService {
  constructor(private readonly deps: UnityLaunchDeps) {}

  /** 解析该工程该用哪个编辑器；找不到就抛 `vpmUnityNotFound`。 */
  resolveEditor(
    projectPath: string,
    explicitPath?: string | null
  ): { install: UnityInstall; source: LaunchEditorSource } {
    const installs = [...this.deps.installs()]
    if (explicitPath) {
      const trimmed = explicitPath.trim()
      if (!trimmed || !isFile(trimmed)) {
        throw new VpmError('vpmUnityNotFound', { reason: 'explicitPath' })
      }
      const known = installs.find((item) => path.resolve(item.path) === path.resolve(trimmed))
      return {
        install: known ?? { ...syntheticInstall(trimmed) },
        source: 'explicit'
      }
    }

    const stored = this.deps.projectExePath?.(projectPath) ?? null
    if (stored && isFile(stored)) {
      const known = installs.find((item) => path.resolve(item.path) === path.resolve(stored))
      return { install: known ?? syntheticInstall(stored), source: 'project' }
    }

    const version = readVersionFile(projectPath)
    const parsed = parseUnityVersion(version)
    if (!parsed) throw new VpmError('vpmUnityNotFound', { reason: 'noVersionFile' })
    const base = unityVersionBase(parsed) ?? parsed.raw
    const candidates = installs.filter((item) => {
      if (!item.version || item.missing) return false
      const candidateBase = unityVersionBase(item.version)
      return candidateBase === base
    })
    if (candidates.length === 0) {
      throw new VpmError('vpmUnityNotFound', { version: parsed.raw })
    }
    // 精确版本优先，其次按路径稳定排序，保证同样输入总是同一个编辑器。
    candidates.sort((a, b) => {
      const exactA = a.version === parsed.raw ? 0 : 1
      const exactB = b.version === parsed.raw ? 0 : 1
      if (exactA !== exactB) return exactA - exactB
      return a.path.localeCompare(b.path)
    })
    return { install: candidates[0], source: 'version' }
  }

  /** 实际传给 Unity 的 argv（不含 exe 本身）；UI 的"预览参数"也用它。 */
  buildArgs(projectPath: string, extraArgs?: readonly string[]): string[] {
    return ['-projectPath', projectPath, ...sanitizeArgs(extraArgs)]
  }

  async launch(input: LaunchUnityInput): Promise<LaunchUnityResult> {
    const projectPath = path.resolve(input.projectPath)
    let stat: fs.Stats
    try {
      stat = fs.lstatSync(projectPath)
    } catch {
      throw new VpmError('vpmProjectInvalid', { field: 'path' })
    }
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new VpmError('vpmProjectInvalid', { field: 'path' })
    }
    const projectVersion = readVersionFile(projectPath)
    if (!projectVersion) throw new VpmError('vpmProjectInvalid', { field: 'version' })

    const { install } = this.resolveEditor(projectPath, input.editorPath)
    const extraArgs = sanitizeArgs(input.extraArgs)
    const args = this.buildArgs(projectPath, extraArgs)

    // 已运行：不重复启动，但仍然把它设为导入目标。
    if (this.deps.isRunning?.(projectPath) === true) {
      input.bindTarget?.(projectPath)
      return {
        status: 'alreadyRunning',
        exePath: install.path,
        version: install.version,
        args,
        pid: null,
        verified: true
      }
    }

    /**
     * R12：同时只允许一个工程开着。
     * 别的工程在跑就**直接拒绝**（不做"切换导入目标"），并带上它的名字让人知道关哪个。
     */
    const other = this.deps.runningProject?.() ?? null
    if (other && projectKeyOf(other.path) !== projectKeyOf(projectPath)) {
      throw new VpmError('vpmUnityAlreadyRunning', { name: other.name })
    }

    // 先绑定再启动：绑定立即生效，双击素材会等这个工程起来。
    input.bindTarget?.(projectPath)

    /**
     * 崩溃/被强杀会留下 `Temp/UnityLockfile`。新起的 Unity 看到它就会**一直等**另一个实例
     * （实测：进程在、CPU 几乎为 0、无窗口、不写 Editor.log）。
     * 能删掉 = 没人持有 → 陈旧锁，清掉再启动；删不掉 = 真有实例在跑 → 不重复启动。
     */
    const lockfile = path.join(projectPath, 'Temp', 'UnityLockfile')
    if (fs.existsSync(lockfile)) {
      try {
        fs.rmSync(lockfile)
        log.info(`[launch] 清掉陈旧锁文件 ${lockfile}`)
      } catch {
        input.clearTarget?.(projectPath)
        return {
          status: 'alreadyRunning',
          exePath: install.path,
          version: install.version,
          args,
          pid: null,
          verified: true
        }
      }
    }

    /**
     * Unity 2022.3 只有在拿到 Hub 的许可通道时才会真正打开工程窗口。
     * 实测（2026-10-22）：裸 `-projectPath` → 进程在、无窗口、无 Temp，
     * Editor.log 里是 `LicensingClient has failed validation`；
     * 加上下面这几个参数后 `Temp/UnityLockfile` 立刻出现。
     */
    const licenseChannel = this.deps.licenseChannel ?? `LicenseClient-${userName()}`
    const spawnArgs = [
      '-projectPath',
      projectPath,
      '-useHub',
      '-hubIPC',
      '-cloudEnvironment',
      'production',
      '-licensingIpc',
      licenseChannel,
      ...extraArgs
    ]
    log.info(`[launch] ${install.path} ${JSON.stringify(spawnArgs)}`)
    let child: ChildProcess | null = null

    try {
      {
        const spawnFn: NonNullable<UnityLaunchDeps['spawn']> =
          this.deps.spawn ?? (nodeSpawn as unknown as NonNullable<UnityLaunchDeps['spawn']>)
        child = spawnFn(install.path, spawnArgs, {
          cwd: projectPath,
          detached: true,
          stdio: 'ignore',
          /**
           * **必须 false**。`windowsHide: true` 会给子进程传 `STARTF_USESHOWWINDOW/SW_HIDE`，
           * Unity 是 GUI 程序，它的第一个顶层窗口会被这个标志隐藏 ——
           * 表现就是"进程在、CPU 在跑、锁文件也有，但屏幕上什么都没有"（MainWindowHandle=0）。
           */
          windowsHide: false,
          // 绝不让参数经过 shell
          shell: false
        })
        // spawn 失败是异步事件（比如 exe 被删），这里也要清绑定。
        let failed = false
        child.once('error', () => {
          failed = true
          input.clearTarget?.(projectPath)
        })
        try {
          child.unref()
        } catch {
          /* unref 失败不影响启动 */
        }
        await new Promise<void>((resolve) => setImmediate(resolve))
        if (failed) throw new VpmError('vpmUnityLaunchFailed', { reason: 'spawn' })
      }
    } catch (error) {
      input.clearTarget?.(projectPath)
      throw error instanceof VpmError
        ? error
        : new VpmError('vpmUnityLaunchFailed', { reason: 'spawn' }, error)
    }

    // 启动是"发出去"了，但工程有没有真的打开要验证：等 Temp/UnityLockfile。
    const verified = await this.verifyStarted(projectPath)
    log.info(`[launch] verified=${verified} pid=${child?.pid ?? 'n/a'} elevated=${isElevated()}`)
    if (!verified && isElevated()) {
      log.warn(
        '[launch] Atrium 以管理员身份运行：Unity 会继承管理员权限，许可客户端握手失败，' +
          '所以窗口起不来。请用普通权限重新启动 Atrium。'
      )
    }
    if (!verified) {
      // 没打开就不要留着导入目标，否则双击素材会投到一个不存在的工程。
      input.clearTarget?.(projectPath)
      return {
        status: 'unverified',
        exePath: install.path,
        version: install.version,
        args,
        pid: child?.pid ?? null,
        verified: false
      }
    }

    return {
      status: 'launched',
      exePath: install.path,
      version: install.version,
      args,
      pid: child?.pid ?? null,
      verified: true
    }
  }

  /** 轮询 `Temp/UnityLockfile`：它出现 = Unity 真的在打开这个工程。 */
  private async verifyStarted(projectPath: string): Promise<boolean> {
    const exists = this.deps.exists ?? ((target: string) => fs.existsSync(target))
    const sleep = this.deps.sleep ?? defaultSleep
    const timeout = this.deps.verifyTimeoutMs ?? 45_000
    const interval = this.deps.verifyIntervalMs ?? 800
    const lockfile = path.join(projectPath, 'Temp', 'UnityLockfile')
    const deadline = Date.now() + timeout
    while (Date.now() < deadline) {
      if (exists(lockfile)) return true
      await sleep(interval)
    }
    return exists(lockfile)
  }
}

function syntheticInstall(exePath: string): UnityInstall {
  return {
    id: `manual:${exePath.toLowerCase()}`,
    path: exePath,
    version: null,
    versionWithRevision: null,
    source: 'manual',
    arch: 'x86_64',
    archInferred: true,
    versionUnknown: true,
    missing: false,
    lastSeenAt: Date.now()
  }
}
