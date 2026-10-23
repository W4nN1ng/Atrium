import { VpmError } from '../../../shared/vpm/errors'
import { IpcInvoke } from '../../../shared/ipc'
import type { VpmPreferencesDto, VpmPreferencesPatch } from '../../../shared/vpm/dto'
import type { IpcApi } from '../../ipc/types'
import { patchVpmSettings, readVpmSettings } from '../config'
import type { VpmRuntime } from '../index'

const MAX_HIDDEN = 5000
const MAX_PACKAGE_ID = 200
const MIN_QUOTA_GB = 1
const MAX_QUOTA_GB = 1024
const MAX_ARGS = 4096

export interface VpmSettingsIpcOptions {
  ipc: IpcApi
  getRuntime: () => VpmRuntime | null
}

function preferencesDto(): VpmPreferencesDto {
  const { settings } = readVpmSettings()
  return {
    allowPrerelease: settings.allowPrerelease,
    hiddenPackageIds: [...settings.hiddenPackageIds],
    cacheQuotaGb: settings.cacheQuotaGb,
    vaultQuotaGb: settings.vaultQuotaGb,
    defaultUnityArgs: settings.defaultUnityArgs,
    checkUpdates: settings.checkUpdates,
    networkEnabled: settings.networkEnabled !== false
  }
}

function bad(field: string): VpmError {
  return new VpmError('vpmInternal', { field })
}

/** 逐字段白名单校验：任何一项不合法就整次拒绝，不做"部分生效"。 */
export function parsePreferencesPatch(input: unknown): VpmPreferencesPatch {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw bad('settings')
  const raw = input as Record<string, unknown>
  const patch: VpmPreferencesPatch = {}

  if (raw.allowPrerelease !== undefined) {
    if (typeof raw.allowPrerelease !== 'boolean') throw bad('allowPrerelease')
    patch.allowPrerelease = raw.allowPrerelease
  }
  if (raw.hiddenPackageIds !== undefined) {
    const value = raw.hiddenPackageIds
    if (!Array.isArray(value) || value.length > MAX_HIDDEN) throw bad('hiddenPackageIds')
    const seen = new Set<string>()
    for (const item of value) {
      if (typeof item !== 'string') throw bad('hiddenPackageIds')
      const id = item.trim()
      if (!id || id.length > MAX_PACKAGE_ID || id.includes('\0')) throw bad('hiddenPackageIds')
      seen.add(id)
    }
    patch.hiddenPackageIds = [...seen]
  }
  for (const key of ['cacheQuotaGb', 'vaultQuotaGb'] as const) {
    if (raw[key] === undefined) continue
    const value = raw[key]
    if (typeof value !== 'number' || !Number.isFinite(value) || value < MIN_QUOTA_GB || value > MAX_QUOTA_GB) {
      throw bad(key)
    }
    patch[key] = Math.trunc(value)
  }
  if (raw.defaultUnityArgs !== undefined) {
    const value = raw.defaultUnityArgs
    if (typeof value !== 'string' || value.length > MAX_ARGS || value.includes('\0')) throw bad('defaultUnityArgs')
    patch.defaultUnityArgs = value
  }
  if (raw.checkUpdates !== undefined) {
    if (typeof raw.checkUpdates !== 'boolean') throw bad('checkUpdates')
    patch.checkUpdates = raw.checkUpdates
  }
  return patch
}

export function registerSettingsIpc(options: VpmSettingsIpcOptions): void {
  const { ipc } = options

  ipc.handle(IpcInvoke.Vpm.SettingsGet, () => preferencesDto())

  ipc.handle(IpcInvoke.Vpm.SettingsPatch, (input: unknown) => {
    const patch = parsePreferencesPatch(input)
    patchVpmSettings(patch)
    return preferencesDto()
  })

  ipc.handle(IpcInvoke.Vpm.UpdateCheck, async (input: unknown) => {
    const runtime = options.getRuntime()
    if (!runtime) throw new VpmError('vpmRuntimeNotReady')
    const force =
      !!input && typeof input === 'object' && (input as { force?: unknown }).force === true
    return runtime.updater.check(force)
  })

  ipc.handle(IpcInvoke.Vpm.UpdateDownload, async () => {
    const runtime = options.getRuntime()
    if (!runtime) throw new VpmError('vpmRuntimeNotReady')
    return runtime.updater.download()
  })

  ipc.handle(IpcInvoke.Vpm.UpdateInstall, (input: unknown) => {
    const runtime = options.getRuntime()
    if (!runtime) throw new VpmError('vpmRuntimeNotReady')
    const target = input && typeof input === 'object' ? (input as { path?: unknown }).path : null
    if (typeof target !== 'string' || !target.trim()) throw new VpmError('vpmUpdateInstallFailed')
    return runtime.updater.runInstaller(target)
  })
}
