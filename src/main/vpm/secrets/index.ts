import fs from 'node:fs'
import path from 'node:path'
import { VpmError } from '../../../shared/vpm/errors'

/**
 * 每仓库 / 每包的请求头（P7-B）。
 *
 * 铁律：
 * - **只用 Electron `safeStorage` 加密后落盘**；不可用就明确报 `vpmSecretUnavailable`，
 *   **绝不降级成明文**；
 * - 头只进 HTTP 适配器：`list()` 只回"设了哪些头名"，值永远不出主进程；
 * - 日志/错误里一律用 `redactHeaders()`。
 */

export type SecretScope = string

export interface SecretStore {
  /** safeStorage 是否可用；false 时 `set()` 会抛错。 */
  available(): boolean
  get(scope: SecretScope): Record<string, string> | null
  set(scope: SecretScope, headers: Record<string, string>): void
  clear(scope: SecretScope): void
  /** 只回 scope + 头名，用于"已设置"标记。 */
  list(): Array<{ scope: SecretScope; names: string[] }>
}

/** 不允许用户自定义的头：会改变请求语义或泄露凭据。 */
const FORBIDDEN_HEADERS = new Set([
  'host',
  'cookie',
  'content-length',
  'connection',
  'transfer-encoding',
  'upgrade',
  'proxy-authorization'
])
const MAX_HEADERS = 16
const MAX_NAME = 64
const MAX_VALUE = 4096

/** 校验并归一化用户输入的请求头；不合法就抛 `vpmSecretInvalid`。 */
export function validateSecretHeaders(input: unknown): Record<string, string> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new VpmError('vpmSecretInvalid', { field: 'headers' })
  }
  const entries = Object.entries(input as Record<string, unknown>)
  if (entries.length > MAX_HEADERS) throw new VpmError('vpmSecretInvalid', { field: 'tooMany' })
  const out: Record<string, string> = {}
  for (const [rawName, rawValue] of entries) {
    const name = rawName.trim().toLowerCase()
    if (!/^[a-z0-9][a-z0-9-]*$/.test(name) || name.length > MAX_NAME) {
      throw new VpmError('vpmSecretInvalid', { field: `name:${rawName}` })
    }
    if (FORBIDDEN_HEADERS.has(name)) {
      throw new VpmError('vpmSecretInvalid', { field: `forbidden:${name}` })
    }
    if (typeof rawValue !== 'string') throw new VpmError('vpmSecretInvalid', { field: name })
    const value = rawValue.trim()
    if (!value || value.length > MAX_VALUE || /[\u0000-\u001f\u007f]/.test(value)) {
      throw new VpmError('vpmSecretInvalid', { field: name })
    }
    out[name] = value
  }
  if (Object.keys(out).length === 0) throw new VpmError('vpmSecretInvalid', { field: 'empty' })
  return out
}

/** 日志/错误里用的脱敏副本：只保留头名。 */
export function redactHeaders(headers: Record<string, string> | null | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  for (const name of Object.keys(headers ?? {})) out[name] = '***'
  return out
}

/** 测试/无 Electron 环境用：只存在内存里，进程退出即消失。 */
export class MemorySecretStore implements SecretStore {
  private readonly data = new Map<SecretScope, Record<string, string>>()

  available(): boolean {
    return true
  }

  get(scope: SecretScope): Record<string, string> | null {
    const value = this.data.get(scope)
    return value ? { ...value } : null
  }

  set(scope: SecretScope, headers: Record<string, string>): void {
    this.data.set(scope, validateSecretHeaders(headers))
  }

  clear(scope: SecretScope): void {
    this.data.delete(scope)
  }

  list(): Array<{ scope: SecretScope; names: string[] }> {
    return [...this.data.entries()].map(([scope, headers]) => ({
      scope,
      names: Object.keys(headers).sort()
    }))
  }
}

interface SecretFileEntry {
  /** safeStorage 加密后的 base64。 */
  data: string
}

interface SecretFile {
  version: 1
  entries: Record<string, SecretFileEntry>
}

export interface SafeStorageLike {
  isEncryptionAvailable(): boolean
  encryptString(value: string): Buffer
  decryptString(value: Buffer): string
}

export interface SafeStorageSecretStoreOptions {
  safeStorage: SafeStorageLike
  /** `<dataRoot>/secrets.json`。 */
  file: string
}

/**
 * safeStorage 实现。
 *
 * - 不可用时 `available()` 为 false，`set()` 抛 `vpmSecretUnavailable`（不写明文）；
 * - 文件里只有密文（base64），没有头名以外的任何元数据；
 * - 解密失败（换机器/密钥变了）当作"没有这个头"，不抛异常打断刷新。
 */
export function createSafeStorageSecretStore(options: SafeStorageSecretStoreOptions): SecretStore {
  const { safeStorage, file } = options

  const readFile = (): SecretFile => {
    try {
      const text = fs.readFileSync(file, 'utf8')
      const parsed: unknown = JSON.parse(text)
      if (!parsed || typeof parsed !== 'object') return { version: 1, entries: {} }
      const record = parsed as { version?: unknown; entries?: unknown }
      if (record.version !== 1 || !record.entries || typeof record.entries !== 'object') {
        return { version: 1, entries: {} }
      }
      const entries: Record<string, SecretFileEntry> = {}
      for (const [scope, value] of Object.entries(record.entries as Record<string, unknown>)) {
        const data = (value as { data?: unknown })?.data
        if (typeof data === 'string' && data.length > 0) entries[scope] = { data }
      }
      return { version: 1, entries }
    } catch {
      return { version: 1, entries: {} }
    }
  }

  const writeFile = (payload: SecretFile): void => {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 })
  }

  return {
    available(): boolean {
      try {
        return safeStorage.isEncryptionAvailable() === true
      } catch {
        return false
      }
    },
    get(scope: SecretScope): Record<string, string> | null {
      const entry = readFile().entries[scope]
      if (!entry || !this.available()) return null
      try {
        const json = safeStorage.decryptString(Buffer.from(entry.data, 'base64'))
        const parsed: unknown = JSON.parse(json)
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
        const out: Record<string, string> = {}
        for (const [name, value] of Object.entries(parsed as Record<string, unknown>)) {
          if (typeof value === 'string') out[name] = value
        }
        return Object.keys(out).length ? out : null
      } catch {
        // 换了机器/密钥变了：当作没有，不打断刷新。
        return null
      }
    },
    set(scope: SecretScope, headers: Record<string, string>): void {
      if (!this.available()) throw new VpmError('vpmSecretUnavailable', {})
      const clean = validateSecretHeaders(headers)
      const payload = readFile()
      payload.entries[scope] = {
        data: safeStorage.encryptString(JSON.stringify(clean)).toString('base64')
      }
      writeFile(payload)
    },
    clear(scope: SecretScope): void {
      const payload = readFile()
      if (!payload.entries[scope]) return
      delete payload.entries[scope]
      writeFile(payload)
    },
    list(): Array<{ scope: SecretScope; names: string[] }> {
      const payload = readFile()
      const out: Array<{ scope: string; names: string[] }> = []
      for (const [scope, entry] of Object.entries(payload.entries)) {
        const headers = this.get(scope)
        out.push({ scope, names: headers ? Object.keys(headers).sort() : [] })
        void entry
      }
      return out
    }
  }
}

/** 没有 Electron 时的降级实现：只存内存（进程退出即丢），绝不写盘。 */
export function createMemorySecretStore(): SecretStore {
  return new MemorySecretStore()
}

/** 仓库级 scope。 */
export function repoScope(repoId: string): SecretScope {
  return `repo:${repoId}`
}

/** 包级 scope（同一仓库里某个包单独的凭据）。 */
export function packageScope(repoId: string, packageName: string): SecretScope {
  return `package:${repoId}/${packageName.toLowerCase()}`
}
