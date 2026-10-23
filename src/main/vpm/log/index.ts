import fs from 'node:fs'
import path from 'node:path'
import yazl from 'yazl'
import { createWriteStream } from 'node:fs'
import { pipeline } from 'node:stream/promises'
import { directoryUsage } from '../fsUtil'
import type { OperationRecord } from '../install'
import type { ProjectsService } from '../projects'

/**
 * 操作记录 / 诊断导出 / 用量（P8-B）。
 *
 * 脱敏规矩（写死在类型里）：
 * - **不导出绝对路径**：只留工程名与相对信息；
 * - **不导出计划 JSON / hash / 文件清单**：只留操作类型、状态、步骤、错误码、时间；
 * - 诊断包里没有任何密钥、请求头、文件内容。
 */

export interface OperationLogEntry {
  id: string
  projectName: string
  kind: string
  status: string
  createdAt: number
  finishedAt: number | null
  errorCode: string | null
  /** 失败的步骤名（没有就是 null）。 */
  failedStep: string | null
  stepCount: number
}

function projectNameOf(projectPath: string): string {
  return path.basename(projectPath) || projectPath
}

/** 把一条操作压成"用户看得懂、又不泄露路径"的样子。 */
export function toLogEntry(record: OperationRecord): OperationLogEntry {
  const steps = Array.isArray(record.steps) ? record.steps : []
  const failed = steps.find((step) => step.status === 'failed')
  return {
    id: record.id,
    projectName: projectNameOf(record.projectPath),
    kind: record.kind,
    status: record.status,
    createdAt: record.createdAt,
    finishedAt: record.finishedAt ?? null,
    errorCode: record.errorCode ?? null,
    failedStep: failed ? failed.step : null,
    stepCount: steps.length
  }
}

export class OperationLogService {
  constructor(
    private readonly deps: {
      operations: { list(projectKey: string, limit?: number): OperationRecord[] }
      projects: Pick<ProjectsService, 'list'>
    }
  ) {}

  /** 跨工程取最近的 N 条（按时间倒序）。 */
  recent(limit = 20): OperationLogEntry[] {
    const count = Number.isFinite(limit) ? Math.max(1, Math.min(100, Math.trunc(limit))) : 20
    const merged: OperationRecord[] = []
    for (const project of this.deps.projects.list()) {
      try {
        merged.push(...this.deps.operations.list(project.projectKey, count))
      } catch {
        /* 单个工程读失败不影响其它 */
      }
    }
    return merged
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, count)
      .map(toLogEntry)
  }
}

export interface UsageSnapshot {
  cache: { bytes: number; files: number }
  vault: { bytes: number; files: number }
  backups: { bytes: number; files: number }
  totalBytes: number
}

/** 缓存 / 回滚仓 / 备份的用量（都是我们自己建的目录，不碰用户工程）。 */
export function usageOf(dataRoot: string): UsageSnapshot {
  const cache = directoryUsage(path.join(dataRoot, 'cache'))
  const vault = directoryUsage(path.join(dataRoot, 'vault'))
  const backups = directoryUsage(path.join(dataRoot, 'backups'))
  return {
    cache,
    vault,
    backups,
    totalBytes: cache.bytes + vault.bytes + backups.bytes
  }
}

export type CleanupTarget = 'cache'

/**
 * 清理。**只允许清缓存**：
 * - 缓存可以重新下载，删了不丢数据；
 * - vault（回滚仓）和备份是用户的保险，必须由用户自己在对应界面处理，这里拒绝。
 */
export function clearUsage(dataRoot: string, target: CleanupTarget): { removedBytes: number } {
  if (target !== 'cache') {
    throw Object.assign(new Error('refused'), { code: 'vpmInternal' })
  }
  const dir = path.join(dataRoot, 'cache')
  const before = directoryUsage(dir).bytes
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true })
  fs.mkdirSync(dir, { recursive: true })
  return { removedBytes: before }
}

export interface DiagnosticsInput {
  appVersion: string
  platform: string
  dataRoot: string
  status: { enabled: boolean; safeMode: boolean; degraded: boolean }
  operations: OperationLogEntry[]
  usage: UsageSnapshot
}

/** 诊断内容：**只有这些字段**，没有路径、没有密钥、没有文件内容。 */
export function buildDiagnostics(input: DiagnosticsInput): Record<string, unknown> {
  return {
    kind: 'atrium-vpm-diagnostics',
    version: 1,
    app: { version: input.appVersion, platform: input.platform },
    vpm: input.status,
    usage: input.usage,
    operations: input.operations,
    generatedAt: new Date().toISOString()
  }
}

/** 把诊断写成一个 zip（里面只有一个 JSON），返回 zip 路径。 */
export async function exportDiagnostics(
  dataRoot: string,
  payload: Record<string, unknown>,
  now = Date.now()
): Promise<string> {
  const dir = path.join(dataRoot, 'diagnostics')
  fs.mkdirSync(dir, { recursive: true })
  const stamp = new Date(now).toISOString().replace(/[:.]/g, '-')
  const target = path.join(dir, `atrium-diagnostics-${stamp}.zip`)
  const part = `${target}.part`

  const zip = new yazl.ZipFile()
  zip.addBuffer(Buffer.from(`${JSON.stringify(payload, null, 2)}\n`, 'utf8'), 'diagnostics.json')
  zip.end()
  try {
    await pipeline(zip.outputStream, createWriteStream(part))
    fs.renameSync(part, target)
    return target
  } catch (error) {
    fs.rmSync(part, { force: true })
    throw error
  }
}
