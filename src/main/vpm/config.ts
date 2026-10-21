import fs from 'node:fs'
import path from 'node:path'
import { P } from '../services/paths'
import { VpmError } from '../../shared/vpm/errors'
import {
  VPM_SETTINGS_SCHEMA_VERSION,
  type VpmReadResult,
  type VpmRollbackSnapshot,
  type VpmSettingsFile
} from '../../shared/vpm/types'

const MAX_HIDDEN_PACKAGES = 5000
const MAX_ARGS_LENGTH = 4096
const MIN_QUOTA_GB = 1
const MAX_QUOTA_GB = 1024

export function defaultVpmSettings(): VpmSettingsFile {
  return {
    schemaVersion: VPM_SETTINGS_SCHEMA_VERSION,
    enabled: false,
    networkEnabled: true,
    networkConsentAt: null,
    dataRoot: null,
    cacheQuotaGb: 20,
    vaultQuotaGb: 20,
    allowPrerelease: false,
    hiddenPackageIds: [],
    defaultUnityArgs: '',
    checkUpdates: false,
    rollbackSnapshot: null
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function validTimestamp(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 64 && !Number.isNaN(Date.parse(value))
}

function validQuota(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= MIN_QUOTA_GB && value <= MAX_QUOTA_GB
}

function validDataRoot(value: unknown): value is string | null {
  return (
    value === null ||
    (typeof value === 'string' &&
      value.trim().length > 0 &&
      value.length <= 512 &&
      !value.includes('\0') &&
      path.isAbsolute(value))
  )
}

function validSnapshot(value: unknown): value is VpmRollbackSnapshot | null {
  if (value === null) return true
  if (!isRecord(value)) return false
  return (
    typeof value.path === 'string' &&
    value.path.length > 0 &&
    value.path.length <= 512 &&
    !value.path.includes('\0') &&
    typeof value.sha256 === 'string' &&
    /^[a-f0-9]{64}$/.test(value.sha256) &&
    validTimestamp(value.createdAt)
  )
}

export function isValidVpmSettings(value: unknown): value is VpmSettingsFile {
  if (!isRecord(value)) return false
  if (value.schemaVersion !== VPM_SETTINGS_SCHEMA_VERSION) return false
  if (typeof value.enabled !== 'boolean') return false
  // 旧设置文件没有这个字段：按默认开启处理，读取时补全。
  if (value.networkEnabled !== undefined && typeof value.networkEnabled !== 'boolean') return false
  if (!(value.networkConsentAt === null || validTimestamp(value.networkConsentAt))) return false
  if (!validDataRoot(value.dataRoot)) return false
  if (!validQuota(value.cacheQuotaGb) || !validQuota(value.vaultQuotaGb)) return false
  if (typeof value.allowPrerelease !== 'boolean') return false
  if (!Array.isArray(value.hiddenPackageIds) || value.hiddenPackageIds.length > MAX_HIDDEN_PACKAGES) return false
  if (
    !value.hiddenPackageIds.every(
      (id) => typeof id === 'string' && id.length > 0 && id.length <= 200 && !id.includes('\0')
    )
  ) {
    return false
  }
  if (typeof value.defaultUnityArgs !== 'string' || value.defaultUnityArgs.length > MAX_ARGS_LENGTH) return false
  if (value.defaultUnityArgs.includes('\0')) return false
  if (typeof value.checkUpdates !== 'boolean') return false
  if (!validSnapshot(value.rollbackSnapshot)) return false
  return true
}

function stamp(date = new Date()): string {
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

/** 把坏文件挪到旁边（不删），失败也不让主进程崩。 */
function quarantineSettingsFile(file: string): string | null {
  const dir = path.dirname(file)
  const base = `${path.basename(file)}.corrupt-${stamp()}`
  for (let i = 0; i < 100; i++) {
    const candidate = path.join(dir, i === 0 ? base : `${base}-${i}`)
    try {
      fs.renameSync(file, candidate)
      return candidate
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return null
      if ((error as NodeJS.ErrnoException)?.code === 'EEXIST') continue
      throw new VpmError('vpmInternal', undefined, error)
    }
  }
  throw new VpmError('vpmInternal')
}

/**
 * 读取独立设置。
 *
 * - 文件不存在 → 默认值（默认关闭，不创建目录）；
 * - JSON 坏/字段非法/schema 不认识 → 原文件改名 `.corrupt-*`，返回默认值并标记 recovered。
 */
export function readVpmSettings(): VpmReadResult {
  const file = P.vpmSettings()
  let text: string
  try {
    text = fs.readFileSync(file, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') {
      return { settings: defaultVpmSettings(), recovered: false, corruptPath: null }
    }
    throw new VpmError('vpmInternal', undefined, error)
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    const corruptPath = quarantineSettingsFile(file)
    return { settings: defaultVpmSettings(), recovered: true, corruptPath }
  }

  if (!isValidVpmSettings(parsed)) {
    const corruptPath = quarantineSettingsFile(file)
    return { settings: defaultVpmSettings(), recovered: true, corruptPath }
  }

  return {
    settings: {
      ...parsed,
      networkEnabled: parsed.networkEnabled !== false,
      hiddenPackageIds: [...parsed.hiddenPackageIds],
      rollbackSnapshot: parsed.rollbackSnapshot ? { ...parsed.rollbackSnapshot } : null
    },
    recovered: false,
    corruptPath: null
  }
}

/**
 * 原子写：同目录临时文件 + fsync + rename。
 * 失败只留下/清理临时文件，不会把原设置截成半个 JSON。
 */
export function writeVpmSettings(settings: VpmSettingsFile): void {
  if (!isValidVpmSettings(settings)) throw new VpmError('vpmInternal')
  const file = P.vpmSettings()
  const dir = path.dirname(file)
  fs.mkdirSync(dir, { recursive: true })
  const tmp = path.join(dir, `.${path.basename(file)}.${process.pid}.${Date.now()}.tmp`)
  let fd: number | null = null
  try {
    fd = fs.openSync(tmp, 'wx', 0o600)
    fs.writeFileSync(fd, JSON.stringify(settings, null, 2) + '\n', 'utf8')
    fs.fsyncSync(fd)
    fs.closeSync(fd)
    fd = null
    fs.renameSync(tmp, file)
  } catch (error) {
    if (fd !== null) {
      try {
        fs.closeSync(fd)
      } catch {
        /* ignore */
      }
    }
    try {
      fs.rmSync(tmp, { force: true })
    } catch {
      /* ignore */
    }
    throw new VpmError('vpmInternal', undefined, error)
  }
}

/** 读联网同意记录时间；没记录/没设置文件时返回 null。 */
export function readNetworkConsent(): string | null {
  return readVpmSettings().settings.networkConsentAt
}

/** 记录同意时间并开启联网；保留其余设置。 */
export function grantNetworkConsent(at: Date = new Date()): string {
  const timestamp = at.toISOString()
  const read = readVpmSettings()
  writeVpmSettings({ ...read.settings, networkConsentAt: timestamp, networkEnabled: true })
  return timestamp
}

/** 撤销同意（关闭联网，不删缓存/仓库）；需要时可在仓库区重新开启。 */
export function revokeNetworkConsent(): void {
  const read = readVpmSettings()
  writeVpmSettings({ ...read.settings, networkConsentAt: null, networkEnabled: false })
}

/** 默认开启；设置读不出来时 fail closed。 */
export function isNetworkEnabled(): boolean {
  try {
    return readVpmSettings().settings.networkEnabled !== false
  } catch {
    return false
  }
}

/** 用户显式开关；开启时补同意时间（仅作记录，不再是硬门）。 */
export function setNetworkEnabled(enabled: boolean): boolean {
  const read = readVpmSettings()
  const next = { ...read.settings, networkEnabled: enabled }
  if (enabled && !next.networkConsentAt) next.networkConsentAt = new Date().toISOString()
  writeVpmSettings(next)
  return enabled
}
