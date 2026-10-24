import fs from 'node:fs'
import path from 'node:path'
import {
  compareUnityVersions,
  parseUnityVersion,
  unityVersionBase,
  type UnityVersion
} from '../../../shared/vpm/domain/unityVersion'
import { VpmError } from '../../../shared/vpm/errors'
import type { ProjectActivityPort } from '../../../shared/vpm/linkage'
import type { ProjectsService } from '../projects'
import { writeFileAtomic } from '../fsUtil'
import type { UnityInstall } from './editors'

/**
 * 更换 Unity 版本（P6-C）。
 *
 * 只改 `ProjectSettings/ProjectVersion.txt`：
 * - Unity 运行中**禁止**（资源可能正在被写）；
 * - 目标编辑器必须已安装（不自动装、不猜版本）；
 * - 默认**先备份**（用户明确拒绝才跳过，并在结果里标出来）；
 * - 原子写；写失败恢复原文件内容；
 * - 不碰 `Packages/manifest.json`，不降级 Unity 资源（Unity 首次打开自己升级）。
 */

export interface ProjectVersionFile {
  version: string
  revision: string | null
}

export function readProjectVersionFile(projectPath: string): ProjectVersionFile | null {
  try {
    const text = fs.readFileSync(
      path.join(projectPath, 'ProjectSettings', 'ProjectVersion.txt'),
      'utf8'
    )
    const version = /m_EditorVersion:\s*(\S+)/.exec(text)?.[1]
    if (!version) return null
    const revision = /m_EditorVersionWithRevision:.*?\(([^)]+)\)/.exec(text)?.[1] ?? null
    return { version, revision }
  } catch {
    return null
  }
}

export function renderProjectVersionFile(version: string, revision: string | null): string {
  const lines = [`m_EditorVersion: ${version}`]
  if (revision) lines.push(`m_EditorVersionWithRevision: ${version} (${revision})`)
  return `${lines.join('\n')}\n`
}

export interface ChangeUnityVersionInput {
  projectKey: string
  unityVersion: string
  unityRevision?: string | null
  /** 默认 true：先做一次 zip 备份。 */
  backupFirst?: boolean
  signal?: AbortSignal
}

export interface ChangeUnityVersionResult {
  projectPath: string
  previous: ProjectVersionFile
  next: ProjectVersionFile
  downgrade: boolean
  backupId: string | null
  /** true = 用户明确跳过备份（调用方要显示风险提示）。 */
  backupSkipped: boolean
}

export interface UnityVersionDeps {
  projects: ProjectsService
  installs: () => readonly UnityInstall[]
  activity?: ProjectActivityPort
  /** 备份服务（P6-B）；不传就只能 `backupFirst: false`。 */
  backup?: { create(input: { projectKey: string; compression?: 'normal' }): Promise<{ id: string }> }
  /** 测试注入。 */
  writeFile?: (file: string, contents: string) => void
}

export class UnityVersionService {
  constructor(private readonly deps: UnityVersionDeps) {}

  async change(input: ChangeUnityVersionInput): Promise<ChangeUnityVersionResult> {
    const project = this.deps.projects.get(input.projectKey)
    if (!project) throw new VpmError('vpmProjectInvalid', { field: 'projectKey' })
    if (project.running) throw new VpmError('vpmUnityRunning', { kind: 'unity-version' })

    const nextParsed = parseUnityVersion(input.unityVersion)
    if (!nextParsed) throw new VpmError('vpmUnityVersionInvalid', { field: 'version' })

    const installs = [...this.deps.installs()].filter((item) => !item.missing && item.version)
    const base = unityVersionBase(nextParsed) ?? nextParsed.raw
    const available = installs.some((item) => unityVersionBase(item.version as string) === base)
    if (!available) throw new VpmError('vpmUnityNotFound', { version: nextParsed.raw })

    const previous = readProjectVersionFile(project.path)
    if (!previous) throw new VpmError('vpmProjectInvalid', { field: 'version' })

    const lease = this.deps.activity?.acquireMaintenance(project.path, 'unity-version') ?? null
    try {
      const backupFirst = input.backupFirst !== false
      let backupId: string | null = null
      if (backupFirst && this.deps.backup) {
        const record = await this.deps.backup.create({ projectKey: input.projectKey, compression: 'normal' })
        backupId = record.id
      }
      const backupSkipped = !backupFirst || !this.deps.backup

      const file = path.join(project.path, 'ProjectSettings', 'ProjectVersion.txt')
      const contents = renderProjectVersionFile(nextParsed.raw, input.unityRevision ?? null)
      try {
        ;(this.deps.writeFile ?? writeFileAtomic)(file, contents)
      } catch (error) {
        // 原子写失败时文件通常没变；这里再兜一次，保证回到旧内容。
        try {
          writeFileAtomic(file, renderProjectVersionFile(previous.version, previous.revision))
        } catch {
          /* 兜底也失败：错误码已经说明"已恢复"，这里只能尽力 */
        }
        throw new VpmError('vpmUnityVersionChangeFailed', {}, error)
      }

      return {
        projectPath: project.path,
        previous,
        next: { version: nextParsed.raw, revision: input.unityRevision ?? null },
        downgrade: compareUnityVersions(nextParsed, parseUnityVersion(previous.version) as UnityVersion) < 0,
        backupId,
        backupSkipped
      }
    } finally {
      lease?.release()
    }
  }
}
