import { spawn as nodeSpawn, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { parseUnityVersion, unityVersionBase } from '../../../shared/vpm/domain/unityVersion'
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
 * - 缺失编辑器**不自动换版本**，直接报 `vpmUnityNotFound`。
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

export interface LaunchUnityResult {
  status: 'launched' | 'alreadyRunning'
  exePath: string
  version: string | null
  args: string[]
  pid: number | null
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
}

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
    if (!readVersionFile(projectPath)) {
      throw new VpmError('vpmProjectInvalid', { field: 'version' })
    }

    const { install } = this.resolveEditor(projectPath, input.editorPath)
    const args = this.buildArgs(projectPath, input.extraArgs)

    // 已运行：不重复启动，但仍然把它设为导入目标。
    if (this.deps.isRunning?.(projectPath) === true) {
      input.bindTarget?.(projectPath)
      return {
        status: 'alreadyRunning',
        exePath: install.path,
        version: install.version,
        args,
        pid: null
      }
    }

    // 先绑定再 spawn：绑定立即生效，双击素材会等这个工程起来。
    input.bindTarget?.(projectPath)
    const spawnFn: NonNullable<UnityLaunchDeps['spawn']> =
      this.deps.spawn ??
      (nodeSpawn as unknown as NonNullable<UnityLaunchDeps['spawn']>)
    let child: ChildProcess
    try {
      child = spawnFn(install.path, args, {
        cwd: projectPath,
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
        // 绝不让参数经过 shell
        shell: false
      })
    } catch (error) {
      input.clearTarget?.(projectPath)
      throw new VpmError('vpmUnityLaunchFailed', { reason: 'spawn' }, error)
    }

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
    // 给 error 事件一个微任务的机会；同步失败就不报成功。
    await new Promise<void>((resolve) => setImmediate(resolve))
    if (failed) throw new VpmError('vpmUnityLaunchFailed', { reason: 'spawn' })

    return {
      status: 'launched',
      exePath: install.path,
      version: install.version,
      args,
      pid: child.pid ?? null
    }
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
