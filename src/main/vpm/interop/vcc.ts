import fs from 'node:fs'
import { assertHttpsUrl } from '../http'

/**
 * 只读导入 VCC / ALCOM 的 `settings.json`（P7-D）。
 *
 * 铁律：
 * - **只读**：不写回、不改对方的设置文件；
 * - 只取我们认识的三样：`userRepos`（仓库 URL）、`userPackageFolders`（本地包目录）、
 *   `unity` 相关提示（`lastUnityPath` / `unityArguments`）；
 * - **不默认信任**未知路径：这里只把它们"读出来"，是否加进信任表由用户点。
 */

export interface VccRepo {
  url: string
  name: string | null
}

export interface VccSettings {
  /** 设置文件路径（读不到时仍然返回，方便界面显示"没找到"）。 */
  path: string
  exists: boolean
  repos: VccRepo[]
  packageFolders: string[]
  /** 上次用的 Unity 可执行文件（只作为提示，不直接使用）。 */
  unityHint: string | null
  unityArguments: string[]
  /** 被跳过的条目与原因（坏 URL、重复、类型不对）。 */
  skipped: Array<{ value: string; reason: 'invalidUrl' | 'duplicate' | 'invalidType' }>
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

/**
 * 解析 settings.json 文本；不抛异常（坏 JSON 由调用方按 `exists/parseError` 处理）。
 */
export function parseVccSettings(text: string, path = ''): VccSettings & { parseError: boolean } {
  const result: VccSettings & { parseError: boolean } = {
    path,
    exists: true,
    repos: [],
    packageFolders: [],
    unityHint: null,
    unityArguments: [],
    skipped: [],
    parseError: false
  }
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    result.parseError = true
    return result
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    result.parseError = true
    return result
  }
  const record = raw as Record<string, unknown>
  const seen = new Set<string>()

  for (const entry of asArray(record.userRepos)) {
    if (typeof entry === 'string') {
      pushRepo(entry, null)
      continue
    }
    if (!entry || typeof entry !== 'object') {
      result.skipped.push({ value: String(entry), reason: 'invalidType' })
      continue
    }
    const repo = entry as { url?: unknown; name?: unknown }
    if (typeof repo.url !== 'string') {
      result.skipped.push({ value: JSON.stringify(entry).slice(0, 120), reason: 'invalidType' })
      continue
    }
    pushRepo(repo.url, typeof repo.name === 'string' ? repo.name : null)
  }

  function pushRepo(url: string, name: string | null): void {
    const trimmed = url.trim()
    try {
      assertHttpsUrl(trimmed)
    } catch {
      result.skipped.push({ value: trimmed, reason: 'invalidUrl' })
      return
    }
    const key = trimmed.toLowerCase()
    if (seen.has(key)) {
      result.skipped.push({ value: trimmed, reason: 'duplicate' })
      return
    }
    seen.add(key)
    result.repos.push({ url: trimmed, name })
  }

  for (const folder of asArray(record.userPackageFolders)) {
    if (typeof folder !== 'string' || !folder.trim()) {
      result.skipped.push({ value: String(folder), reason: 'invalidType' })
      continue
    }
    const trimmed = folder.trim()
    const key = trimmed.toLowerCase()
    if (seen.has(key)) {
      result.skipped.push({ value: trimmed, reason: 'duplicate' })
      continue
    }
    seen.add(key)
    result.packageFolders.push(trimmed)
  }

  if (typeof record.lastUnityPath === 'string' && record.lastUnityPath.trim()) {
    result.unityHint = record.lastUnityPath.trim()
  }
  for (const arg of asArray(record.unityArguments)) {
    if (typeof arg === 'string' && arg.trim()) result.unityArguments.push(arg.trim())
  }
  return result
}

/** 读一个路径；不存在就返回 `exists:false`（不报错——"没装 VCC" 是正常情况）。 */
export function readVccSettings(path: string): VccSettings & { parseError: boolean } {
  try {
    return parseVccSettings(fs.readFileSync(path, 'utf8'), path)
  } catch {
    return {
      path,
      exists: false,
      repos: [],
      packageFolders: [],
      unityHint: null,
      unityArguments: [],
      skipped: [],
      parseError: false
    }
  }
}
