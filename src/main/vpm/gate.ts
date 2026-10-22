import { app, BrowserWindow, dialog, shell } from 'electron'
import log from 'electron-log'
import Database from 'better-sqlite3'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import type { Db } from '../db'
import { createDatabaseBackup } from '../db/backup'
import type { IpcApi } from '../ipc/types'
import { P } from '../services/paths'
import { validateVpmDataRoot } from '../../shared/vpm/dataRoot'
import { VpmError, type VpmErrorCode } from '../../shared/vpm/errors'
import { IpcInvoke } from '../../shared/ipc'
import { registerVpmIpc } from './ipc'
import type { VpmRuntime } from './index'
import type {
  CoreProjectInput,
  CoreProjectSummary,
  VccProjectsRead
} from './projects'
import type { LegacyGuardPort, ProjectActivityPort, ProjectLinkagePort } from '../../shared/vpm/linkage'
import { projectKeyOf } from '../../shared/vpm/domain/project'
import {
  VPM_SETTINGS_SCHEMA_VERSION,
  type VpmDataRootContext,
  type VpmDataRootPick,
  type VpmDataRootValidation,
  type VpmEnableInput,
  type VpmRollbackSnapshot,
  type VpmSettingsFile,
  type VpmStatus
} from '../../shared/vpm/types'
import {
  defaultVpmSettings,
  isNetworkEnabled,
  readVpmSettings,
  writeVpmSettings
} from './config'

export interface VpmGateDeps {
  ipc: IpcApi
  getDb(): Db
  getLibraryRoot(): string | null
  getKnownProjectPaths(): string[]
  /** 核心工程发现/运行状态；P2-C 的台账合并用。 */
  getCoreProjects?(): CoreProjectSummary[]
  /** 添加已有工程时写核心 `project` 表（DML，不改 schema）。 */
  registerCoreProject?(input: CoreProjectInput): CoreProjectSummary
  /** VCC settings.json 的只读 userProjects。 */
  readVccProjects?(): VccProjectsRead
  /** 核心当前导入目标/启动绑定；P5-D 启动工程前调用。 */
  projectLinkage?: ProjectLinkagePort
  /** P4-F 工程活动闸门（素材写入 vs 维护写）。 */
  projectActivity?: ProjectActivityPort
  /** P4-F 旧 Assets 保护集合（`import_log` 已知资产）。 */
  legacyGuard?: LegacyGuardPort
  appVersion?(): string
  appInstallDirs?(): string[]
  /** 主进程事件广播；P1-E 的刷新进度用。 */
  broadcast?(event: string, payload?: unknown): void
  /** 测试可关掉动态运行时加载；生产默认开启。 */
  enableRuntime?: boolean
}

let deps: VpmGateDeps | null = null
let configRecovered = false
let runtime: VpmRuntime | null = null
let runtimePromise: Promise<void> | null = null
let runtimeCode: VpmErrorCode | null = null
let runtimeGeneration = 0
let ipcController: { dispose(): void } | null = null

export function isSafeMode(
  argv: readonly string[] = process.argv,
  env: NodeJS.ProcessEnv = process.env
): boolean {
  return argv.includes('--safe-mode') || env.ATRIUM_SAFE_MODE === '1'
}

function safeAppVersion(): string {
  try {
    return app.getVersion()
  } catch {
    return ''
  }
}

function defaultInstallDirs(): string[] {
  const dirs: string[] = []
  try {
    const appPath = app.getAppPath()
    if (appPath) dirs.push(appPath)
  } catch {
    /* 测试/非 Electron 环境 */
  }
  try {
    if (process.execPath) dirs.push(path.dirname(process.execPath))
  } catch {
    /* ignore */
  }
  try {
    if (process.resourcesPath) dirs.push(process.resourcesPath)
  } catch {
    /* ignore */
  }
  return [...new Set(dirs)]
}

function context(): VpmDataRootContext {
  let libraryRoot: string | null = null
  let knownProjectPaths: string[] = []
  try {
    libraryRoot = deps?.getLibraryRoot() ?? null
  } catch {
    libraryRoot = null
  }
  try {
    knownProjectPaths = deps?.getKnownProjectPaths() ?? []
  } catch {
    knownProjectPaths = []
  }
  return {
    platform: process.platform,
    systemDrive: process.env.SystemDrive ?? null,
    libraryRoot,
    knownProjectPaths,
    appInstallDirs: deps?.appInstallDirs?.() ?? defaultInstallDirs()
  }
}

function dataRootLooksValid(dataRoot: string | null, ctx: VpmDataRootContext): boolean {
  if (!dataRoot) return false
  const result = validateVpmDataRoot(dataRoot, ctx)
  if (!result.ok) return false
  try {
    return fs.statSync(result.normalized).isDirectory()
  } catch {
    return false
  }
}

function baseStatus(settings = defaultVpmSettings()): VpmStatus {
  return {
    enabled: settings.enabled,
    safeMode: isSafeMode(),
    degraded: runtimeCode !== null,
    degradedCode: runtimeCode,
    dataRoot: settings.dataRoot,
    dataRootValid: dataRootLooksValid(settings.dataRoot, context()),
    networkConsentAt: settings.networkConsentAt,
    configRecovered,
    appVersion: deps?.appVersion?.() ?? safeAppVersion(),
    rollbackSnapshot: settings.rollbackSnapshot
  }
}

/** 读状态；配置坏了也只返回默认值 + degraded，不阻塞核心启动。 */
export function getVpmStatus(): VpmStatus {
  try {
    const read = readVpmSettings()
    if (read.recovered) configRecovered = true
    return baseStatus(read.settings)
  } catch (error) {
    log.warn('VPM 状态读取失败（核心继续）：' + (error instanceof Error ? error.message : String(error)))
    return { ...baseStatus(), degraded: true, degradedCode: runtimeCode ?? 'vpmInternal' }
  }
}

function disposeRuntime(): void {
  runtimeGeneration++
  runtimePromise = null
  runtimeCode = null
  const current = runtime
  runtime = null
  try {
    current?.dispose()
  } catch (error) {
    log.warn('VPM 运行时释放失败：' + (error instanceof Error ? error.message : String(error)))
  }
}

async function ensureRuntime(): Promise<void> {
  if (!deps || deps.enableRuntime === false) return
  if (runtime) return
  if (runtimePromise) return runtimePromise

  const status = getVpmStatus()
  if (!status.enabled || status.safeMode) return
  if (!status.dataRoot || !status.dataRootValid) {
    runtimeCode = 'vpmDataRootInvalid'
    log.warn('VPM 运行时未加载：数据根不可用')
    return
  }

  const gateDeps = deps
  const generation = runtimeGeneration
  runtimePromise = (async () => {
    try {
      const { initVpm } = await import('./index')
      const readCoreProjects = gateDeps.getCoreProjects
      const registerCoreProject = gateDeps.registerCoreProject
      const readVccProjects = gateDeps.readVccProjects
      const handle = await initVpm({
        dataRoot: status.dataRoot as string,
        userAgent: `Atrium/${status.appVersion || '0.0.0'}`,
        isNetworkAllowed: () => isNetworkEnabled(),
        coreProjects: readCoreProjects
          ? {
              list: () => readCoreProjects(),
              register: registerCoreProject
                ? (input) => registerCoreProject(input)
                : undefined
            }
          : undefined,
        vccProjects: readVccProjects
          ? { read: () => readVccProjects() }
          : undefined,
        projectLinkage: gateDeps.projectLinkage,
        projectActivity: gateDeps.projectActivity,
        legacyGuard: gateDeps.legacyGuard,
        revealPath: (target: string) => shell.showItemInFolder(target),
        // R1：Unity 启动优先走 Hub 协议（直接跑 Unity.exe 会卡在创建窗口之前）
        openExternal: (url: string) => shell.openExternal(url),
        // 启动前判断"这个工程是不是已经在跑"：不接这个端口的话，每点一次都会再拉起一个 Unity。
        isProjectActive: (projectPath: string) => {
          try {
            const key = projectKeyOf(projectPath)
            return (gateDeps.getCoreProjects?.() ?? []).some(
              (project) => projectKeyOf(project.path) === key && project.running === true
            )
          } catch {
            return false
          }
        }
      })
      if (generation !== runtimeGeneration) {
        handle.dispose()
        return
      }
      runtime = handle
      runtimeCode = null
      log.info('VPM 运行时已加载（仓库/缓存/目录服务）')
    } catch (error) {
      if (generation !== runtimeGeneration) return
      runtimeCode = error instanceof VpmError ? error.code : 'vpmInternal'
      log.warn(
        'VPM 运行时加载失败（核心继续）：' +
          runtimeCode +
          (error instanceof Error ? ' / ' + error.message : '')
      )
    } finally {
      if (generation === runtimeGeneration) runtimePromise = null
    }
  })()

  await runtimePromise
}

/** 应用启动/启用后调用；disabled/safe mode 不加载重模块。 */
export async function startVpmRuntime(): Promise<void> {
  if (!deps || deps.enableRuntime === false) return
  await ensureRuntime()
}

/**
 * 把还不存在的末段拼到最近的已存在祖先上再 realpath。
 * 这样 symlink/junction 不能把“看起来在外面”的目录指进素材库/工程。
 */
function resolveRealTarget(target: string): string {
  let existing = target
  const missing: string[] = []
  while (!fs.existsSync(existing)) {
    const parent = path.dirname(existing)
    if (parent === existing) break
    missing.unshift(path.basename(existing))
    existing = parent
  }
  const real = fs.realpathSync(existing)
  return missing.length ? path.join(real, ...missing) : real
}

function ensureWritableDataRoot(normalized: string): void {
  let real: string
  try {
    real = resolveRealTarget(normalized)
  } catch (error) {
    throw new VpmError('vpmDataRootNotWritable', undefined, error)
  }

  if (real !== normalized) {
    const again = validateVpmDataRoot(real, context())
    if (!again.ok) throw new VpmError(again.code, again.params)
  }

  try {
    fs.mkdirSync(real, { recursive: true })
    if (!fs.statSync(real).isDirectory()) throw new Error('not a directory')
  } catch (error) {
    throw new VpmError('vpmDataRootNotWritable', undefined, error)
  }

  const probe = path.join(real, `.atrium-write-test-${process.pid}-${Date.now()}`)
  try {
    fs.writeFileSync(probe, 'atrium-vpm-write-test\n', { encoding: 'utf8', flag: 'wx' })
  } catch (error) {
    throw new VpmError('vpmDataRootNotWritable', undefined, error)
  } finally {
    try {
      fs.unlinkSync(probe)
    } catch {
      /* 写不进去时本来就没有文件；清理失败也不该掩盖主错误 */
    }
  }

  for (const name of ['cache', 'vault', 'backups', 'tmp'] as const) {
    try {
      fs.mkdirSync(path.join(real, name), { recursive: true })
    } catch (error) {
      throw new VpmError('vpmDataRootNotWritable', { path: name }, error)
    }
  }
}

function snapshotStamp(date = new Date()): string {
  const pad = (n: number): string => String(n).padStart(2, '0')
  return (
    String(date.getFullYear()) +
    pad(date.getMonth() + 1) +
    pad(date.getDate()) +
    '-' +
    pad(date.getHours()) +
    pad(date.getMinutes()) +
    pad(date.getSeconds())
  )
}

function uniqueSnapshotPath(): string {
  fs.mkdirSync(P.vpmBackups(), { recursive: true })
  const base = `pre-vpm-${snapshotStamp()}`
  for (let i = 1; i <= 100; i++) {
    const file = path.join(P.vpmBackups(), i === 1 ? `${base}.db` : `${base}-${i}.db`)
    if (!fs.existsSync(file)) return file
  }
  throw new VpmError('vpmSnapshotFailed')
}

function sha256File(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256')
    const stream = fs.createReadStream(file)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('error', reject)
    stream.on('end', () => resolve(hash.digest('hex')))
  })
}

async function createPreVpmSnapshot(): Promise<VpmRollbackSnapshot> {
  if (!deps) throw new VpmError('vpmInternal')
  const target = uniqueSnapshotPath()
  let written: string
  try {
    written = (await createDatabaseBackup(deps.getDb(), P.db(), target)).path
  } catch (error) {
    throw new VpmError('vpmSnapshotFailed', undefined, error)
  }

  try {
    const check = new Database(written, { readonly: true, fileMustExist: true })
    try {
      const integrity = check.pragma('integrity_check', { simple: true })
      if (integrity !== 'ok') throw new Error('integrity_check=' + String(integrity))
    } finally {
      check.close()
    }
    return {
      path: written,
      sha256: await sha256File(written),
      createdAt: new Date().toISOString()
    }
  } catch (error) {
    throw new VpmError('vpmSnapshotFailed', undefined, error)
  }
}

export async function enableVpm(input: VpmEnableInput): Promise<VpmStatus> {
  if (isSafeMode()) throw new VpmError('vpmSafeMode')
  if (!deps) throw new VpmError('vpmInternal')
  if (!input || typeof input !== 'object' || typeof input.dataRoot !== 'string') {
    throw new VpmError('vpmDataRootRequired')
  }

  const evaluated = validateVpmDataRoot(input.dataRoot, context())
  if (!evaluated.ok) throw new VpmError(evaluated.code, evaluated.params)

  ensureWritableDataRoot(evaluated.normalized)

  // 配置可能在选择目录后被外部改坏；启用时重新读，坏文件仍会先备份。
  let previous: VpmSettingsFile
  try {
    const read = readVpmSettings()
    if (read.recovered) configRecovered = true
    previous = read.settings
  } catch (error) {
    throw new VpmError('vpmInternal', undefined, error)
  }

  const snapshot = await createPreVpmSnapshot()
  const next: VpmSettingsFile = {
    ...previous,
    schemaVersion: VPM_SETTINGS_SCHEMA_VERSION,
    enabled: true,
    dataRoot: evaluated.normalized,
    rollbackSnapshot: snapshot
  }
  try {
    writeVpmSettings(next)
  } catch (error) {
    throw new VpmError('vpmInternal', undefined, error)
  }
  configRecovered = false
  log.info(`VPM 已启用：dataRoot=${evaluated.normalized} snapshot=${snapshot.path}`)

  disposeRuntime()
  if (deps.enableRuntime !== false) await ensureRuntime()
  return getVpmStatus()
}

export function disableVpm(): VpmStatus {
  try {
    if (fs.existsSync(P.vpmSettings())) {
      const read = readVpmSettings()
      if (read.recovered) configRecovered = true
      writeVpmSettings({ ...read.settings, enabled: false })
      configRecovered = false
      log.info('VPM 已停用（数据根/设置/快照保留）')
    }
    disposeRuntime()
  } catch (error) {
    log.warn('VPM 停用失败：' + (error instanceof Error ? error.message : String(error)))
    throw new VpmError('vpmInternal', undefined, error)
  }
  return getVpmStatus()
}

function nonSystemSuggestion(): string | undefined {
  const ctx = context()
  const candidates = [ctx.libraryRoot, ...(ctx.knownProjectPaths ?? [])].filter(
    (p): p is string => !!p && path.isAbsolute(p)
  )
  const system = (ctx.systemDrive ?? 'C:').toLowerCase()
  for (const candidate of candidates) {
    const root = path.parse(candidate).root
    if (!root || root.slice(0, 2).toLowerCase() === system) continue
    if (fs.existsSync(root)) return path.join(root, 'AtriumVPM')
  }
  try {
    const root = path.parse(P.root()).root
    if (root && root.slice(0, 2).toLowerCase() !== system && fs.existsSync(root)) {
      return path.join(root, 'AtriumVPM')
    }
  } catch {
    /* ignore */
  }
  return undefined
}

export async function pickDataRoot(): Promise<VpmDataRootPick> {
  const current = getVpmStatus()
  const options: Electron.OpenDialogOptions = {
    title: 'VPM data root',
    properties: ['openDirectory', 'createDirectory'],
    defaultPath: current.dataRoot && current.dataRootValid ? current.dataRoot : nonSystemSuggestion()
  }
  const win = BrowserWindow.getFocusedWindow()
  const picked = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
  if (picked.canceled || picked.filePaths.length === 0) {
    return { path: null, validation: null }
  }
  const selected = picked.filePaths[0]
  const validation: VpmDataRootValidation = validateVpmDataRoot(selected, context())
  return { path: selected, validation }
}

export function registerVpmGateIpc(next: VpmGateDeps): void {
  ipcController?.dispose()
  deps = next
  const { ipc } = next

  ipcController = registerVpmIpc({
    ipc,
    broadcast: next.broadcast,
    getRuntime: () => runtime
  })

  ipc.handle(IpcInvoke.Vpm.Status, () => getVpmStatus())
  ipc.handle(IpcInvoke.Vpm.Enable, (input: unknown) => enableVpm(input as VpmEnableInput))
  ipc.handle(IpcInvoke.Vpm.Disable, () => disableVpm())
  ipc.handle(IpcInvoke.Vpm.PickDataRoot, () => pickDataRoot())
}

export function disposeVpm(): void {
  disposeRuntime()
  ipcController?.dispose()
  ipcController = null
}

/** 只给测试用：清掉模块级 deps/恢复标记，避免测试文件互相污染。 */
export function resetVpmGateForTest(): void {
  disposeRuntime()
  ipcController?.dispose()
  ipcController = null
  deps = null
  configRecovered = false
}
