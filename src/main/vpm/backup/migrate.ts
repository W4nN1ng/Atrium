import { VpmError } from '../../../shared/vpm/errors'
import type { ProjectActivityPort } from '../../../shared/vpm/linkage'
import type { InstallTransactionService } from '../install'
import type { PlanService } from '../planService'
import type { ProjectsService } from '../projects'
import type { ProjectBackupService } from './service'

/**
 * 旧式 VPM / Assets 迁移（P6-D）。
 *
 * 这里**不做"一键全自动"**：只处理用户明确勾选、且能解释清楚的候选包。
 *
 * 流程（每个包都一样）：备份 → 用 P3 计划 + P4 事务把包正式装上 → 旧 Assets 由事务的
 * legacy 步骤移到 vault（不永久删）。所以"迁移"本身不写工程，写工程的是那个事务。
 *
 * 拒绝矩阵（全部可解释）：
 * - Unity 运行中 / 素材导入中 / 已有维护动作 → `vpmUnityRunning` / `vpmProjectImporting` / `vpmProjectBusy`
 * - 包在仓库里解析不到 → `vpmResolutionFailed`（不猜、不装未知包）
 * - 候选置信度不是 high/medium → 直接拒绝，让用户自己判断
 * - 已经在 manifest 里 → 跳过（不重复装）
 */

export type MigrateCandidateConfidence = 'high' | 'medium' | 'low'

export interface MigrateCandidate {
  /** 旧 Assets 里的相对路径，只用于展示与日志。 */
  relativePath: string | null
  /** 候选包 id；null 表示认不出来，不迁移。 */
  packageId: string | null
  confidence: MigrateCandidateConfidence
}

export interface MigrateInput {
  projectKey: string
  /** 用户勾选的候选（来自 P2 的 legacy 报告）。 */
  candidates: readonly MigrateCandidate[]
  /** 默认 true：迁移前先做一次 zip 备份。 */
  backupFirst?: boolean
  signal?: AbortSignal
}

export type MigrateSkipReason =
  | 'noPackageId'
  | 'lowConfidence'
  | 'alreadyInstalled'
  | 'notInCatalog'

export interface MigrateOutcome {
  packageId: string
  status: 'installed' | 'skipped' | 'failed'
  skipReason: MigrateSkipReason | null
  errorCode: string | null
  operationId: string | null
}

export interface MigrateResult {
  backupId: string | null
  backupSkipped: boolean
  outcomes: MigrateOutcome[]
  installed: string[]
  skipped: Array<{ packageId: string; reason: MigrateSkipReason }>
  failed: Array<{ packageId: string; errorCode: string | null }>
}

export interface ProjectMigrateDeps {
  projects: ProjectsService
  plans: PlanService
  transactions: InstallTransactionService
  backup?: Pick<ProjectBackupService, 'create'>
  activity?: ProjectActivityPort
}

export class ProjectMigrateService {
  constructor(private readonly deps: ProjectMigrateDeps) {}

  async migrate(input: MigrateInput): Promise<MigrateResult> {
    const project = this.deps.projects.get(input.projectKey)
    if (!project) throw new VpmError('vpmProjectInvalid', { field: 'projectKey' })
    if (project.running) throw new VpmError('vpmUnityRunning', { kind: 'migrate' })

    const lease = this.deps.activity?.acquireMaintenance(project.path, 'migrate') ?? null
    try {
      const backupFirst = input.backupFirst !== false
      let backupId: string | null = null
      if (backupFirst && this.deps.backup) {
        const record = await this.deps.backup.create({
          projectKey: input.projectKey,
          compression: 'normal'
        })
        backupId = record.id
      }

      const installedAlready = new Set(
        project.ledger?.packages?.map((pkg) => pkg.name.toLowerCase()) ?? []
      )
      const outcomes: MigrateOutcome[] = []
      const seen = new Set<string>()

      for (const candidate of input.candidates) {
        const packageId = candidate.packageId?.trim() ?? ''
        if (!packageId) {
          outcomes.push({ packageId: '', status: 'skipped', skipReason: 'noPackageId', errorCode: null, operationId: null })
          continue
        }
        const key = packageId.toLowerCase()
        if (seen.has(key)) continue
        seen.add(key)

        if (candidate.confidence === 'low') {
          outcomes.push({ packageId, status: 'skipped', skipReason: 'lowConfidence', errorCode: null, operationId: null })
          continue
        }
        if (installedAlready.has(key)) {
          outcomes.push({ packageId, status: 'skipped', skipReason: 'alreadyInstalled', errorCode: null, operationId: null })
          continue
        }

        try {
          const plan = this.deps.plans.resolve({
            projectKey: input.projectKey,
            requests: [{ kind: 'install', name: packageId }]
          })
          if (plan.changes.length === 0) {
            outcomes.push({ packageId, status: 'skipped', skipReason: 'notInCatalog', errorCode: null, operationId: null })
            continue
          }
          const result = await this.deps.transactions.apply({
            projectKey: input.projectKey,
            planId: plan.planId
          })
          if (result.status === 'committed') {
            outcomes.push({ packageId, status: 'installed', skipReason: null, errorCode: null, operationId: result.operationId })
            installedAlready.add(key)
          } else {
            outcomes.push({
              packageId,
              status: 'failed',
              skipReason: null,
              errorCode: result.errorCode,
              operationId: result.operationId
            })
          }
        } catch (error) {
          outcomes.push({
            packageId,
            status: 'failed',
            skipReason: null,
            errorCode: (error as { code?: string }).code ?? 'vpmResolutionFailed',
            operationId: null
          })
        }
      }

      return {
        backupId,
        backupSkipped: !backupFirst || !this.deps.backup,
        outcomes,
        installed: outcomes.filter((item) => item.status === 'installed').map((item) => item.packageId),
        skipped: outcomes
          .filter((item) => item.status === 'skipped')
          .map((item) => ({ packageId: item.packageId, reason: item.skipReason as MigrateSkipReason })),
        failed: outcomes
          .filter((item) => item.status === 'failed')
          .map((item) => ({ packageId: item.packageId, errorCode: item.errorCode }))
      }
    } finally {
      lease?.release()
    }
  }
}
