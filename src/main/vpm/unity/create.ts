import fs from 'node:fs'
import path from 'node:path'
import { projectKeyOf, projectSlugOf } from '../../../shared/vpm/domain/project'
import { parseUnityVersion } from '../../../shared/vpm/domain/unityVersion'
import type { TemplateAttachment } from '../../../shared/vpm/domain/template'
import { VpmError, type VpmErrorCode } from '../../../shared/vpm/errors'
import type { ProjectActivityPort } from '../../../shared/vpm/linkage'
import { ulid } from '../../../shared/ulid'
import type { InstallTransactionService } from '../install'
import type { PlanService } from '../planService'
import type { ProjectsService } from '../projects'
import type { TemplateService } from '../templates'
import type { VaultStore } from '../vault'

/**
 * 新建工程（P5-B）。
 *
 * 只做"最小骨架 + 初始 manifest + 模板依赖"，其余交给 Unity 首次打开生成：
 * - **不写** `ProjectSettings.asset` / 场景 / 材质 / 脚本；
 * - **不写任何 `.meta`**（Unity 自己生成）；
 * - 不覆盖已存在的目录（空目录也算存在）。
 *
 * 失败分两段处理：
 * - rename 之前失败 → 临时目录移到回滚仓 `create-failed/`，**不永久删**；
 * - rename 之后（依赖安装）失败 → 工程保留，标记"依赖未装完"，可重试。
 */

const SKELETON_BYTES = 64 * 1024 * 1024
const SPACE_MARGIN = 1.2
const SPACE_HEADROOM = 512 * 1024 * 1024
/** 与解压/清理保持一致的策略上限：超过就不建，避免 Unity 打不开。 */
const MAX_TARGET_PATH = 260
const MAX_NAME = 80

const RESERVED_NAMES =
  /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i
const ILLEGAL_CHARS = /[<>:"/\\|?*\u0000-\u001f]/

export type CreateIssueCode =
  | 'parentMissing'
  | 'parentNotDirectory'
  | 'parentSymlink'
  | 'parentUnsafe'
  | 'parentInsideProject'
  | 'parentNotWritable'
  | 'nameEmpty'
  | 'nameTooLong'
  | 'nameIllegal'
  | 'nameReserved'
  | 'nameTrailing'
  | 'nameEscapes'
  | 'targetExists'
  | 'longPath'
  | 'noSpace'
  | 'unityVersionInvalid'
  | 'unityVersionMissing'
  | 'unityVersionUnverified'
  | 'attachmentsUnsupported'
  | 'templateMissing'
  | 'dependenciesFailed'

export interface CreateIssue {
  code: CreateIssueCode
  detail: string | null
}

export interface CreateProjectInput {
  parentDir: string
  name: string
  unityVersion: string
  unityRevision?: string | null
  templateId?: string
}

export interface CreateProjectContext {
  /** 不允许作为父目录的根（素材库、应用安装目录、数据根）。 */
  forbiddenRoots?: readonly string[]
  /** 已安装的 Unity 版本；空数组 = 没探测到，只给"未验证"警告。 */
  installedUnityVersions?: readonly string[]
}

export interface CreateValidation {
  ok: boolean
  issues: CreateIssue[]
  warnings: CreateIssue[]
  targetPath: string
  templateId: string
  templateName: string | null
  attachments: TemplateAttachment[]
}

export interface CreateProjectResult {
  projectPath: string
  projectKey: string
  templateId: string
  dependencyStatus: 'none' | 'installed' | 'failed'
  operationId: string | null
  errorCode: VpmErrorCode | null
  warnings: CreateIssue[]
}

/** P5-C 注入：把模板附件落到临时工程的 `Assets/`。 */
export interface TemplateAttachmentPort {
  apply(input: {
    projectPath: string
    templateId: string
    attachments: readonly TemplateAttachment[]
  }): Promise<{ applied: number; warnings: string[] }>
}

export interface ProjectCreateDeps {
  templates: TemplateService
  dataRoot: string
  vault: VaultStore
  projects: ProjectsService
  plans: PlanService
  transactions: InstallTransactionService
  activity?: ProjectActivityPort
  attachments?: TemplateAttachmentPort
  forbiddenRoots?: () => readonly string[]
  installedUnityVersions?: () => readonly string[]
  now?: () => number
}

function issue(code: CreateIssueCode, detail: string | null = null): CreateIssue {
  return { code, detail }
}

function inside(parent: string, child: string): boolean {
  const normalizedParent = path.resolve(parent).toLowerCase()
  const normalizedChild = path.resolve(child).toLowerCase()
  return normalizedChild === normalizedParent || normalizedChild.startsWith(`${normalizedParent}${path.sep}`)
}

/** 从 parent 往上找，看有没有 `ProjectSettings/ProjectVersion.txt`。 */
function insideUnityProject(parent: string): string | null {
  let cursor = path.resolve(parent)
  for (;;) {
    if (fs.existsSync(path.join(cursor, 'ProjectSettings', 'ProjectVersion.txt'))) return cursor
    const next = path.dirname(cursor)
    if (next === cursor) return null
    cursor = next
  }
}

function freeBytes(directory: string): number | null {
  try {
    const stat = (fs as unknown as {
      statfsSync?: (p: string) => { bavail: number; bsize: number }
    }).statfsSync?.(directory)
    if (!stat) return null
    return Number(stat.bavail) * Number(stat.bsize)
  } catch {
    return null
  }
}

function directoryBytes(directory: string): number {
  let total = 0
  const walk = (current: string): void => {
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(current, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue
      const full = path.join(current, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (entry.isFile()) {
        try {
          total += fs.statSync(full).size
        } catch {
          /* 跳过读不到的 */
        }
      }
    }
  }
  walk(directory)
  return total
}

export class ProjectCreateService {
  constructor(private readonly deps: ProjectCreateDeps) {}

  /** 只读校验；`ok=false` 时不要动磁盘。 */
  validate(input: CreateProjectInput, context: CreateProjectContext = {}): CreateValidation {
    // 调用方不传就用依赖里的默认值（测试与 UI 都能直接用 validate()）。
    const forbiddenRoots = context.forbiddenRoots ?? this.deps.forbiddenRoots?.() ?? []
    const installedUnityVersions =
      context.installedUnityVersions ?? this.deps.installedUnityVersions?.() ?? []
    const issues: CreateIssue[] = []
    const warnings: CreateIssue[] = []
    const templateId = input.templateId?.trim() || 'builtin.blank'
    let templateName: string | null = null
    let attachments: TemplateAttachment[] = []
    try {
      const resolved = this.deps.templates.get(templateId)
      templateName = resolved.manifest.name
      attachments = resolved.manifest.unitypackages
    } catch {
      issues.push(issue('templateMissing', templateId))
    }

    const parent = typeof input.parentDir === 'string' ? input.parentDir.trim() : ''
    if (!parent || !path.isAbsolute(parent)) {
      issues.push(issue('parentMissing', parent || null))
    } else {
      try {
        const stat = fs.lstatSync(parent)
        if (stat.isSymbolicLink()) issues.push(issue('parentSymlink', parent))
        else if (!stat.isDirectory()) issues.push(issue('parentNotDirectory', parent))
      } catch {
        issues.push(issue('parentMissing', parent))
      }
      const ancestor = insideUnityProject(parent)
      if (ancestor) issues.push(issue('parentInsideProject', ancestor))
      for (const root of forbiddenRoots) {
        if (!root) continue
        if (inside(root, parent)) {
          issues.push(issue('parentUnsafe', root))
          break
        }
      }
      try {
        fs.accessSync(parent, fs.constants.W_OK)
      } catch {
        issues.push(issue('parentNotWritable', parent))
      }
    }

    const name = typeof input.name === 'string' ? input.name : ''
    if (!name) issues.push(issue('nameEmpty'))
    else {
      if (name.length > MAX_NAME) issues.push(issue('nameTooLong', String(name.length)))
      if (ILLEGAL_CHARS.test(name)) issues.push(issue('nameIllegal'))
      if (RESERVED_NAMES.test(name)) issues.push(issue('nameReserved', name))
      if (name === '.' || name === '..') issues.push(issue('nameIllegal', name))
      if (name !== name.trim() || /[. ]$/.test(name)) issues.push(issue('nameTrailing', name))
      if (path.basename(name) !== name) issues.push(issue('nameIllegal', name))
    }

    const targetPath = parent && name ? path.join(parent, name) : ''
    if (targetPath) {
      if (!inside(parent, targetPath) || path.dirname(targetPath) !== path.resolve(parent)) {
        issues.push(issue('nameEscapes', targetPath))
      }
      if (fs.existsSync(targetPath)) issues.push(issue('targetExists', targetPath))
      if (targetPath.length >= MAX_TARGET_PATH) issues.push(issue('longPath', String(targetPath.length)))
    }

    const version = typeof input.unityVersion === 'string' ? input.unityVersion.trim() : ''
    if (!version || !parseUnityVersion(version)) {
      issues.push(issue('unityVersionInvalid', version || null))
    } else {
      const installed = installedUnityVersions.filter(Boolean)
      if (installed.length === 0) warnings.push(issue('unityVersionUnverified', version))
      else if (!installed.includes(version)) issues.push(issue('unityVersionMissing', version))
    }

    if (attachments.length > 0 && !this.deps.attachments) {
      issues.push(issue('attachmentsUnsupported', String(attachments.length)))
    }

    if (targetPath && !issues.some((item) => item.code === 'parentMissing')) {
      const estimate = SKELETON_BYTES + directoryBytes(this.deps.templates.filesDir(templateId))
      const free = freeBytes(parent)
      if (free !== null && free < estimate * SPACE_MARGIN + SPACE_HEADROOM) {
        issues.push(issue('noSpace', String(free)))
      }
    }

    return {
      ok: issues.length === 0,
      issues,
      warnings,
      targetPath,
      templateId,
      templateName,
      attachments
    }
  }

  async create(input: CreateProjectInput): Promise<CreateProjectResult> {
    const validation = this.validate(input)
    if (!validation.ok) {
      throw new VpmError('vpmCreateRejected', {
        reason: validation.issues.map((item) => item.code).join(',')
      })
    }

    const parent = path.resolve(input.parentDir)
    const lease = this.deps.activity?.acquireMaintenance(parent, 'create-project') ?? null
    const opId = ulid()
    const tempDir = path.join(parent, `.atrium-create-${opId.toLowerCase()}`)

    try {
      try {
        this.buildSkeleton(tempDir, input)
        if (validation.attachments.length > 0 && this.deps.attachments) {
          await this.deps.attachments.apply({
            projectPath: tempDir,
            templateId: validation.templateId,
            attachments: validation.attachments
          })
        }
        this.writeInitialManifest(tempDir, validation.templateId)
        this.renameIntoPlace(tempDir, validation.targetPath)
      } catch (error) {
        this.parkFailedDirectory(tempDir, opId)
        throw new VpmError('vpmCreateFailed', { opId }, error)
      }

      // 入列表（核心 project 表 + VPM 台账）；失败就保留目录，不删用户的东西。
      this.deps.projects.addExisting(validation.targetPath)
      this.deps.templates.markUsed(validation.templateId)
      this.deps.templates.recordLocation(parent)

      const install = await this.installDependencies(validation.targetPath, validation.templateId)
      return {
        projectPath: validation.targetPath,
        projectKey: projectKeyOf(validation.targetPath),
        templateId: validation.templateId,
        dependencyStatus: install.status,
        operationId: install.operationId,
        errorCode: install.errorCode,
        warnings: [...validation.warnings, ...install.warnings]
      }
    } finally {
      lease?.release()
    }
  }

  private buildSkeleton(tempDir: string, input: CreateProjectInput): void {
    fs.mkdirSync(path.join(tempDir, 'Assets'), { recursive: true })
    fs.mkdirSync(path.join(tempDir, 'ProjectSettings'), { recursive: true })
    fs.mkdirSync(path.join(tempDir, 'Packages'), { recursive: true })

    const version = input.unityVersion.trim()
    const revision = typeof input.unityRevision === 'string' ? input.unityRevision.trim() : ''
    const lines = [`m_EditorVersion: ${version}`]
    if (revision) lines.push(`m_EditorVersionWithRevision: ${version} (${revision})`)
    fs.writeFileSync(path.join(tempDir, 'ProjectSettings', 'ProjectVersion.txt'), `${lines.join('\n')}\n`)
    // 不写 ProjectSettings.asset、不写任何 .meta —— 交给 Unity 首次打开生成。
  }

  private writeInitialManifest(tempDir: string, templateId: string): void {
    const { manifest } = this.deps.templates.get(templateId)
    const data = {
      dependencies: Object.fromEntries(
        Object.entries(manifest.dependencies).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      ),
      locked: {}
    }
    fs.writeFileSync(
      path.join(tempDir, 'Packages', 'vpm-manifest.json'),
      `${JSON.stringify(data, null, 2)}\n`
    )
  }

  private renameIntoPlace(tempDir: string, targetPath: string): void {
    if (fs.existsSync(targetPath)) throw new Error(`target exists: ${targetPath}`)
    fs.renameSync(tempDir, targetPath)
  }

  /**
   * 失败现场移到回滚仓的 `create-failed/`，**不永久删**。
   *
   * 回滚仓不可用（数据根被拒、盘满）时退到父目录下的 `.atrium-create-failed-<op>`
   * —— 同卷 rename，原子且不丢东西。
   */
  private parkFailedDirectory(tempDir: string, opId: string): string | null {
    if (!fs.existsSync(tempDir)) return null
    const destinations: string[] = []
    try {
      const slug = projectSlugOf(projectKeyOf(tempDir))
      destinations.push(path.join(this.deps.vault.opDir(slug, opId), 'create-failed'))
    } catch {
      /* 回滚仓不可用，走下面的兜底 */
    }
    destinations.push(
      path.join(path.dirname(tempDir), `.atrium-create-failed-${opId.toLowerCase()}`)
    )
    for (const destination of destinations) {
      try {
        fs.mkdirSync(path.dirname(destination), { recursive: true })
        fs.renameSync(tempDir, destination)
        return destination
      } catch {
        continue
      }
    }
    return null
  }

  private async installDependencies(
    projectPath: string,
    templateId: string
  ): Promise<{
    status: 'none' | 'installed' | 'failed'
    operationId: string | null
    errorCode: VpmErrorCode | null
    warnings: CreateIssue[]
  }> {
    const { manifest } = this.deps.templates.get(templateId)
    const requests = Object.entries(manifest.dependencies).map(([name, range]) => ({
      kind: 'install' as const,
      name,
      range
    }))
    if (requests.length === 0) {
      return { status: 'none', operationId: null, errorCode: null, warnings: [] }
    }
    try {
      const plan = this.deps.plans.resolve({
        projectKey: projectKeyOf(projectPath),
        requests
      })
      const result = await this.deps.transactions.apply({
        projectKey: projectKeyOf(projectPath),
        planId: plan.planId
      })
      if (result.status !== 'committed') {
        return {
          status: 'failed',
          operationId: result.operationId,
          errorCode: result.errorCode,
          warnings: [issue('dependenciesFailed', result.errorCode ?? null)]
        }
      }
      return { status: 'installed', operationId: result.operationId, errorCode: null, warnings: [] }
    } catch (error) {
      // 工程保留：骨架与 manifest 已经在了，用户可以在列表里重试装依赖。
      return {
        status: 'failed',
        operationId: null,
        errorCode: (error as { code?: VpmErrorCode }).code ?? 'vpmTransactionFailed',
        warnings: [issue('dependenciesFailed', null)]
      }
    }
  }
}
