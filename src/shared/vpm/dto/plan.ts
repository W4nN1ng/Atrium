import type {
  ChangePlan,
  ChangePlanConflict,
  ChangePlanMissing,
  ChangePlanRequest
} from '../domain/plan'
import type { ResolverWarning } from '../domain/resolver'

export interface VpmPlanResolveInput {
  projectKey: string
  preset?: 'upgradeAll'
  requests?: ChangePlanRequest[]
  allowPrerelease?: boolean
  freeBytes?: number
}

export interface VpmPlanDto extends ChangePlan {
  planId: string
}

export interface VpmPlanExplainDto {
  planId: string
  name: string | null
  planHash: string
  changes: ChangePlan['changes']
  conflicts: ChangePlanConflict[]
  missing: ChangePlanMissing[]
  warnings: ResolverWarning[]
}
