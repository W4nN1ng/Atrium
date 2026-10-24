import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { VpmError } from '../../../shared/vpm/errors'
import type { ProjectActivityPort } from '../../../shared/vpm/linkage'
import { ulid } from '../../../shared/ulid'
import type { ProjectsService } from '../projects'
import { collectProjectFiles, type CollectWarning } from './collector'

/**
 * 复制工程（P6-C）。
 *
 * - 复用 P6-A 的收集器（同一套排除规则），不自己遍历；
 * - 先复制到 `<parent>/.atrium-copy-<op>`（同卷），成功才 rename 成目标；
 * - 目标必须不存在；目标不能在源工程内（防递归）；
 * - 失败时临时目录**保留**（改名成 `.atrium-copy-failed-<op>`），不永久删；
 * - Unity 运行中默认拒绝（文件可能正在写）。
 */

export interface CopyProjectInput {
  sourceKey: string
  /** 最终目录（必须不存在）。 */
  targetDir: string
  excludeVpmPackages?: boolean
  signal?: AbortSignal
  onProgress?: (progress: { phase: 'collect' | 'copy'; files: number; bytes: number; current: string }) => void
}

export interface CopyProjectResult {
  projectPath: string
  projectKey: string
  files: number
  bytes: number
  warnings: Array<{ path: string; reason: CollectWarning }>
}

export interface ProjectCopyDeps {
  projects: ProjectsService
  activity?: ProjectActivityPort
}

function inside(parent: string, child: string): boolean {
  const root = path.resolve(parent).toLowerCase()
  const target = path.resolve(child).toLowerCase()
  return target === root || target.startsWith(`${root}${path.sep}`)
}

export class ProjectCopyService {
  constructor(private readonly deps: ProjectCopyDeps) {}

  async copy(input: CopyProjectInput): Promise<CopyProjectResult> {
    const source = this.deps.projects.get(input.sourceKey)
    if (!source) throw new VpmError('vpmProjectInvalid', { field: 'projectKey' })
    if (source.running) throw new VpmError('vpmUnityRunning', { kind: 'copy' })

    const target = path.resolve(input.targetDir)
    if (fs.existsSync(target)) throw new VpmError('vpmCopyConflict', { path: target })
    if (inside(source.path, target)) throw new VpmError('vpmCopyConflict', { path: target })

    const lease = this.deps.activity?.acquireMaintenance(source.path, 'copy') ?? null
    const opId = ulid()
    const parent = path.dirname(target)
    const temp = path.join(parent, `.atrium-copy-${opId.toLowerCase()}`)

    try {
      fs.mkdirSync(temp, { recursive: true })
      try {
        const collected = await collectProjectFiles({
          root: source.path,
          mode: 'copy',
          excludeVpmPackages: input.excludeVpmPackages === true,
          ...(input.signal ? { signal: input.signal } : {}),
          onProgress: (progress) =>
            input.onProgress?.({
              phase: 'collect',
              files: progress.files,
              bytes: progress.bytes,
              current: progress.current
            })
        })
        if (collected.truncated) throw new VpmError('vpmCopyFailed', { reason: 'tooLarge' })

        for (const dir of collected.directories) {
          fs.mkdirSync(path.join(temp, ...dir.relativePath.split('/')), { recursive: true })
        }
        let copied = 0
        for (const file of collected.files) {
          if (input.signal?.aborted) throw new VpmError('vpmCollectCancelled', {})
          const destination = path.join(temp, ...file.relativePath.split('/'))
          fs.mkdirSync(path.dirname(destination), { recursive: true })
          await fsp.copyFile(file.absolutePath, destination)
          copied++
          input.onProgress?.({
            phase: 'copy',
            files: copied,
            bytes: file.size,
            current: file.relativePath
          })
        }
        // 同卷 rename：目标已存在会在 rename 前就被拦下。
        if (fs.existsSync(target)) throw new VpmError('vpmCopyConflict', { path: target })
        fs.renameSync(temp, target)

        this.deps.projects.addExisting(target)
        return {
          projectPath: target,
          projectKey: source.projectKey,
          files: collected.fileCount,
          bytes: collected.byteCount,
          warnings: collected.warnings
        }
      } catch (error) {
        this.park(temp, opId)
        if (error instanceof VpmError) throw error
        if (input.signal?.aborted) throw new VpmError('vpmCollectCancelled', {})
        throw new VpmError('vpmCopyFailed', { reason: 'copy' }, error)
      }
    } finally {
      lease?.release()
    }
  }

  /** 失败现场改名保留，不永久删。 */
  private park(temp: string, opId: string): void {
    if (!fs.existsSync(temp)) return
    try {
      fs.renameSync(temp, path.join(path.dirname(temp), `.atrium-copy-failed-${opId.toLowerCase()}`))
    } catch {
      /* 挪不动就留在原地，错误里带 opId */
    }
  }
}
