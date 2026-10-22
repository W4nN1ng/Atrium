import fs from 'node:fs'
import path from 'node:path'
import type { ProjectInfo, UnityStatus } from '../../shared/types'
import type { ProjectConnection, UnityConnectionSnapshot } from '../../shared/unityConnection'

export interface UnityConnectionsDependencies {
  config(): { enabled: boolean; excludedProjectIds: string[] }
  install(project: ProjectInfo): { ok: boolean; error: string | null } | Promise<{ ok: boolean; error: string | null }>
  statusOf(projectPath: string): Pick<UnityStatus, 'bridgeReady' | 'isCompiling' | 'isUpdating' | 'isPlaying' | 'busyReason'>
  watch(projectPath: string): void
  changed(snapshot: UnityConnectionSnapshot): void
  now?: () => number
}

interface Attempt { pending: boolean; error: string | null }
interface Waiter { check(): void; cancel(): void }
type Rejection = { phase: 'unsupported' | 'failed'; reasonKey: string; detail: string | null }
const POLL_MS = 250
const DEFAULT_TIMEOUT_MS = 180_000
const keyOf = (p: ProjectInfo): string => `${p.id}\0${path.resolve(p.path).toLowerCase()}`
const messageOf = (error: unknown): string => error instanceof Error ? error.message : String(error)

/** Check only the project boundary and the package we may write, never the user's Assets tree. */
function validateProject(projectPath: string): Rejection | null {
  const unsafe = (): Rejection => ({ phase: 'failed', reasonKey: 'project.connectionUnsafe', detail: null })
  try {
    if (!path.isAbsolute(projectPath)) return unsafe()
    let cursor = path.resolve(projectPath)
    for (;;) {
      const stat = fs.lstatSync(cursor)
      if (!stat.isDirectory() || stat.isSymbolicLink()) return unsafe()
      const parent = path.dirname(cursor)
      if (cursor === parent) break
      cursor = parent
    }
    // Treat any preview ownership marker as reserved, including damaged markers.
    try {
      fs.lstatSync(path.join(projectPath, '.atrium-cover-preview.json'))
      return { phase: 'unsupported', reasonKey: 'project.connectionUnsupported', detail: null }
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return unsafe() }
    for (const rel of ['Assets', 'ProjectSettings', 'Packages']) {
      const target = path.join(projectPath, rel)
      try {
        const stat = fs.lstatSync(target)
        if (!stat.isDirectory() || stat.isSymbolicLink()) return unsafe()
      } catch (error) {
        if (rel !== 'Packages' || (error as NodeJS.ErrnoException).code !== 'ENOENT') return unsafe()
      }
    }
    const versionFile = path.join(projectPath, 'ProjectSettings', 'ProjectVersion.txt')
    const versionStat = fs.lstatSync(versionFile)
    if (!versionStat.isFile() || versionStat.isSymbolicLink() || versionStat.size > 65_536) return unsafe()
    const version = /m_EditorVersion:\s*(\S+)/.exec(fs.readFileSync(versionFile, 'utf8'))?.[1]
    if (!version || !/^2022\.3\.\d+(?:[abfp]\d+)?$/.test(version)) {
      return { phase: 'unsupported', reasonKey: 'project.connectionUnsupported', detail: version ?? null }
    }
    const checkPackage = (file: string): void => {
      const stat = fs.lstatSync(file)
      if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile())) throw new Error('linked package')
      if (stat.isDirectory()) for (const entry of fs.readdirSync(file)) checkPackage(path.join(file, entry))
    }
    const target = path.join(projectPath, 'Packages', 'com.avca.bridge')
    try { checkPackage(target) } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return unsafe()
    }
    return null
  } catch { return unsafe() }
}

function installed(projectPath: string): boolean {
  return fs.existsSync(path.join(projectPath, 'Packages', 'com.avca.bridge', 'package.json'))
}

/** Owns connection preparation, not imports. Every waiter remains bound to its initial ID and path. */
export class UnityConnections {
  private projects = new Map<string, ProjectInfo>()
  private readonly attempts = new Map<string, Attempt>()
  private readonly explicitRetries = new Map<string, { allowWhileDisabled: boolean }>()
  private readonly watched = new Set<string>()
  private readonly waiters = new Set<Waiter>()
  private manualId: string | null = null
  /** Atrium 启动工程时写入；closed 也保留，表示“Unity 正在启动/等待连接”。 */
  private launchId: string | null = null
  private launchSawRunning = false
  /** 启动绑定是什么时候设的：用于"永远等不到心跳"的兜底清理。 */
  private launchSince = 0
  private lastPublished: string | null = null
  private disposed = false

  constructor(private readonly deps: UnityConnectionsDependencies) {}

  update(projects: ProjectInfo[]): void {
    if (this.disposed) return
    this.projects = new Map(projects.map((project) => [project.id, { ...project }]))
    this.pruneExplicitRetries()
    this.pruneLaunchBinding()
    for (const p of this.projects.values()) this.ensure(p)
    this.publish()
  }

  snapshot(): UnityConnectionSnapshot {
    this.pruneExplicitRetries()
    const projects = [...this.projects.values()].map((p) => this.connection(p))
    const candidates = projects.filter((p) => !['closed', 'disabled', 'unsupported'].includes(p.phase)
      && p.reasonKey !== 'project.connectionUnsafe')
    if (this.manualId && !candidates.some((p) => p.projectId === this.manualId)) this.manualId = null
    const launch = this.launchId ? projects.find((p) => p.projectId === this.launchId) : undefined
    const launchUsable = Boolean(launch && !['disabled', 'unsupported'].includes(launch.phase))
    const targetProjectId = this.manualId ?? (launchUsable ? this.launchId : null)
      ?? (candidates.length === 1 ? candidates[0].projectId : null)
    return {
      projects,
      targetProjectId,
      targetMode: this.manualId ? 'manual' : launchUsable ? 'launch' : 'auto',
      targetPending: !this.manualId && launchUsable && !this.launchSawRunning,
      ambiguous: this.manualId === null && !launchUsable && candidates.length > 1
    }
  }

  select(id: string | null): void {
    this.assertLive()
    if (id !== null) this.assertEligible(this.requiredProject(id))
    this.manualId = id
    this.launchId = null
    this.launchSawRunning = false
    this.publish()
  }

  /**
   * Atrium 启动工程前调用：不要求 Unity 已运行。
   * 新启动动作覆盖旧的启动绑定，并清除显式选择；启动失败由调用方 clear。
   */
  bindLaunchTarget(id: string): void {
    this.assertLive()
    const project = this.requiredProject(id)
    this.launchId = id
    this.launchSawRunning = project.running
    this.launchSince = this.now()
    this.manualId = null
    this.publish()
  }

  clearLaunchTarget(id: string): void {
    this.assertLive()
    if (this.launchId !== id) return
    this.launchId = null
    this.launchSawRunning = false
    this.publish()
  }

  retry(id: string): void {
    this.assertLive()
    const p = this.requiredProject(id)
    this.assertEligible(p, true)
    const key = keyOf(p)
    // A user action may prepare this project once without enabling global automation.
    this.explicitRetries.set(key, { allowWhileDisabled: !this.deps.config().enabled })
    if (this.attempts.get(key)?.pending) { this.publish(); return }
    this.attempts.delete(key)
    // Uninstall also tears down BridgeManager's watcher outside this controller.
    this.watched.delete(key)
    this.ensure(p)
    this.publish()
  }

  async prepare(id: string, options: { signal?: AbortSignal; timeoutMs?: number } = {}): Promise<ProjectConnection> {
    this.assertLive()
    if (options.signal?.aborted) throw new Error('project.connectionCancelled')
    const p = this.requiredProject(id)
    const projectPath = p.path
    const requestedTimeout = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
    const timeoutMs = Number.isFinite(requestedTimeout) ? Math.max(0, requestedTimeout) : DEFAULT_TIMEOUT_MS
    const deadline = this.now() + timeoutMs
    return new Promise<ProjectConnection>((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | undefined
      let settled = false
      const finish = (error: string | null, connection?: ProjectConnection): void => {
        if (settled) return
        settled = true
        if (timer !== undefined) clearTimeout(timer)
        options.signal?.removeEventListener('abort', waiter.cancel)
        this.waiters.delete(waiter)
        if (error) reject(new Error(error))
        else resolve(connection!)
      }
      const waiter: Waiter = {
        cancel: () => finish('project.connectionCancelled'),
        check: () => {
          if (settled) return
          if (timer !== undefined) clearTimeout(timer)
          if (this.disposed || options.signal?.aborted) { waiter.cancel(); return }
          const current = this.projects.get(id)
          if (!current || current.path !== projectPath) { finish('project.connectionProjectMissing'); return }
          const connection = this.connection(current)
          if (connection.phase === 'ready') { finish(null, connection); return }
          if (connection.phase === 'closed' && this.isLaunchPending(id)) {
            // Atrium 已经绑定这个工程，只是 Unity 还没启动；继续等到超时/取消。
          } else if (['closed', 'disabled', 'unsupported', 'failed'].includes(connection.phase)) {
            finish(connection.reasonKey ?? 'project.connectionFailed'); return
          }
          const remaining = deadline - this.now()
          if (remaining <= 0) { finish('project.connectionTimeout'); return }
          timer = setTimeout(() => this.publish(), Math.min(POLL_MS, remaining))
        }
      }
      this.waiters.add(waiter)
      options.signal?.addEventListener('abort', waiter.cancel, { once: true })
      waiter.check()
    })
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.explicitRetries.clear()
    for (const waiter of [...this.waiters]) waiter.cancel()
  }

  private now(): number { return (this.deps.now ?? Date.now)() }

  private assertLive(): void {
    if (this.disposed) throw new Error('project.connectionCancelled')
  }

  private requiredProject(id: string): ProjectInfo {
    const p = this.projects.get(id)
    if (!p) throw new Error('project.connectionProjectMissing')
    return p
  }

  private assertEligible(p: ProjectInfo, explicitRetry = false): void {
    const connection = this.connection(p)
    if (explicitRetry && connection.phase === 'disabled' && !this.deps.config().excludedProjectIds.includes(p.id)) return
    if (['closed', 'disabled', 'unsupported'].includes(connection.phase) || connection.reasonKey === 'project.connectionUnsafe') {
      throw new Error(connection.reasonKey ?? 'project.connectionFailed')
    }
  }

  private connection(p: ProjectInfo): ProjectConnection {
    const base = { projectId: p.id, projectPath: p.path, name: p.name, detail: null }
    const config = this.deps.config()
    if (config.excludedProjectIds.includes(p.id)) return { ...base, phase: 'disabled', reasonKey: 'project.connectionDisabled' }
    if (!p.running) return { ...base, phase: 'closed', reasonKey: 'project.connectionClosed' }
    const invalid = validateProject(p.path)
    if (invalid) return { ...base, ...invalid }
    try {
      if (this.deps.statusOf(p.path).bridgeReady) return { ...base, phase: 'ready', reasonKey: 'project.connectionReady' }
    } catch (error) {
      return { ...base, phase: 'failed', reasonKey: 'project.connectionFailed', detail: messageOf(error) }
    }
    const attempt = this.attempts.get(keyOf(p))
    if (!installed(p.path) && !config.enabled && !this.explicitRetries.get(keyOf(p))?.allowWhileDisabled) {
      return { ...base, phase: 'disabled', reasonKey: 'project.connectionDisabled' }
    }
    if (attempt?.error) return { ...base, phase: 'failed', reasonKey: 'project.connectionFailed', detail: attempt.error }
    if (attempt?.pending) return { ...base, phase: 'installing', reasonKey: 'project.connectionInstalling' }
    return { ...base, phase: 'connecting', reasonKey: 'project.connectionWaiting' }
  }

  private ensure(p: ProjectInfo): void {
    const connection = this.connection(p)
    if (['closed', 'disabled', 'unsupported'].includes(connection.phase) || connection.phase === 'failed') return
    const key = keyOf(p)
    if (!this.watched.has(key)) {
      try { this.deps.watch(p.path); this.watched.add(key) } catch (error) {
        this.attempts.set(key, { pending: false, error: messageOf(error) })
        return
      }
    }
    if (connection.phase === 'ready' || installed(p.path) || this.attempts.has(key)) return
    const attempt: Attempt = { pending: true, error: null }
    this.attempts.set(key, attempt)
    // Deferring one microtask keeps update nonblocking and permits a close/disable before the write starts.
    void Promise.resolve().then(async () => {
      this.pruneExplicitRetries()
      const current = this.projects.get(p.id)
      if (this.disposed || !current || keyOf(current) !== key || !current.running
        || (!this.deps.config().enabled && !this.explicitRetries.get(key)?.allowWhileDisabled)
        || this.deps.config().excludedProjectIds.includes(p.id)
        || validateProject(current.path)) {
        if (this.attempts.get(key) === attempt) this.attempts.delete(key)
        return
      }
      try {
        // A manual installation may have completed since the initial snapshot.
        const result = installed(current.path) ? { ok: true, error: null } : await this.deps.install(current)
        attempt.error = result.ok ? null : result.error || 'project.connectionFailed'
      } catch (error) { attempt.error = messageOf(error) }
      finally { attempt.pending = false }
    }).then(() => { if (!this.disposed) this.publish() })
  }

  private isLaunchPending(id: string): boolean {
    const project = this.projects.get(id)
    return this.launchId === id && Boolean(project) && !this.launchSawRunning && project?.running === false
  }

  private pruneLaunchBinding(): void {
    if (!this.launchId) return
    /**
     * 兜底：启动绑定设了但**一直没等到心跳**（Unity 起来了又关掉、或桥接没装成功），
     * 不能让顶栏永远显示"正在连接"。超过 3 分钟就丢掉这个绑定。
     */
    if (!this.launchSawRunning && this.launchSince > 0 && this.now() - this.launchSince > 180_000) {
      this.launchId = null
      this.launchSawRunning = false
      this.launchSince = 0
      return
    }
    const project = this.projects.get(this.launchId)
    if (!project) {
      this.launchId = null
      this.launchSawRunning = false
      this.launchSince = 0
      return
    }
    if (project.running) {
      this.launchSawRunning = true
      return
    }
    if (this.launchSawRunning) {
      this.launchId = null
      this.launchSawRunning = false
      return
    }
    const phase = this.connection(project).phase
    if (phase === 'disabled' || phase === 'unsupported') {
      this.launchId = null
      this.launchSawRunning = false
    }
  }

  private pruneExplicitRetries(): void {
    const config = this.deps.config()
    const runningKeys = new Set([...this.projects.values()]
      .filter((p) => p.running && !config.excludedProjectIds.includes(p.id)).map(keyOf))
    for (const [key, permission] of this.explicitRetries) {
      if (!runningKeys.has(key) || (!config.enabled && !permission.allowWhileDisabled)) {
        this.explicitRetries.delete(key)
      } else if (config.enabled) {
        // A subsequent global disable is a new user decision, even after a retry
        // was originally requested while automatic connection was disabled.
        permission.allowWhileDisabled = false
      }
    }
  }

  private publish(): void {
    if (this.disposed) return
    const snapshot = this.snapshot()
    const serialized = JSON.stringify(snapshot)
    if (serialized !== this.lastPublished) {
      this.lastPublished = serialized
      this.deps.changed(snapshot)
    }
    for (const waiter of [...this.waiters]) waiter.check()
  }
}
