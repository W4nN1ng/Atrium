import fs from 'node:fs'
import path from 'node:path'
import { normalizePackageId } from '../../../shared/vpm/domain/packageId'
import type { ChangePlan } from '../../../shared/vpm/domain/plan'
import type { ProjectSnapshot } from '../../../shared/vpm/domain/project'
import type { VpmErrorCode, VpmParams, VpmWarningCode } from '../../../shared/vpm/errors'

/** 受保护包：VPM 不升级/降级/卸载/覆盖；解析器与清理也必须跳过。 */
export const PROTECTED_PACKAGE_ID = 'com.avca.bridge'

const MIB = 1024 * 1024
const HASH = /^[a-f0-9]{64}$/i

export interface PreflightActivity {
  unityRunning: boolean
  importing: boolean
}

export interface PreflightPackagePath {
  name: string
  relativePath: string
  exists: boolean
  symlink: boolean
  kind: 'dir' | 'file' | 'missing'
}

/**
 * 预检输入。全部由 `collectPreflightFacts()` 采集，纯函数只做判断，
 * 这样拒绝矩阵可以在没有真实磁盘的情况下逐条测试。
 */
export interface PreflightFacts {
  plan: ChangePlan
  /** 调用方从 planId 缓存取到的计划 hash；必须与 plan.planHash 一致。 */
  expectedPlanHash: string
  snapshot: ProjectSnapshot
  activity: PreflightActivity
  projectFreeBytes: number | null
  dataRootFreeBytes: number | null
  vaultUsable: boolean
  txRootUsable: boolean
  packagesRootUsable: boolean
  packagePaths: readonly PreflightPackagePath[]
  protectedPackages?: readonly string[]
}

export interface PreflightIssue {
  code: VpmErrorCode | VpmWarningCode
  params?: VpmParams
  detail?: string
}

export interface PreflightResult {
  ok: boolean
  issues: PreflightIssue[]
  warnings: PreflightIssue[]
  required: { projectBytes: number; dataRootBytes: number }
}

export interface CollectPreflightInput {
  plan: ChangePlan
  expectedPlanHash: string
  snapshot: ProjectSnapshot
  projectPath: string
  /** 已校验的非 C 数据根；只用来探测缓存卷剩余空间。 */
  dataRoot: string
  activity?: PreflightActivity
  vault: { ensureUsable(): boolean }
  freeBytes?: (directory: string) => number | null
  protectedPackages?: readonly string[]
}

function defaultFreeBytes(directory: string): number | null {
  try {
    const statfs = (fs as unknown as {
      statfsSync?: (target: string) => { bavail: number; bsize: number }
    }).statfsSync
    if (!statfs) return null
    const stat = statfs(directory)
    const bytes = Number(stat.bavail) * Number(stat.bsize)
    return Number.isFinite(bytes) && bytes >= 0 ? bytes : null
  } catch {
    // 空间探测失败不当作“空间不足”；真正的写入失败仍会给出明确错误。
    return null
  }
}

/**
 * 预计空间：
 * - 工程卷要容纳解压后的新包（下载量 ≈ 展开量的保守估计 ×1.2 + 512 MiB 余量）；
 * - 数据根要容纳下载缓存（下载量 + 512 MiB）；
 * - 纯卸载不下载、也不增加工程体积，因此不要求额外空间（否则会挡住“先删再腾空间”）。
 */
export function requiredBytesFor(plan: ChangePlan): { projectBytes: number; dataRootBytes: number } {
  const installBytes = Math.max(0, Math.trunc(Number(plan?.disk?.installBytes ?? 0) || 0))
  const downloadBytes = Math.max(0, Math.trunc(Number(plan?.disk?.downloadBytes ?? 0) || 0))
  return {
    projectBytes: installBytes > 0 ? Math.ceil(installBytes * 1.2) + 512 * MIB : 0,
    dataRootBytes: downloadBytes > 0 ? downloadBytes + 512 * MIB : 0
  }
}

function lower(value: string): string {
  return value.trim().toLowerCase()
}

function lstatOrNull(target: string): fs.Stats | null {
  try {
    return fs.lstatSync(target)
  } catch {
    return null
  }
}

function describeKind(stat: fs.Stats): 'dir' | 'file' | 'missing' {
  if (stat.isSymbolicLink()) return 'file'
  if (stat.isDirectory()) return 'dir'
  return 'file'
}

/**
 * 预检拒绝矩阵。
 *
 * 顺序按“越早发现越省事”排列，但**不短路**：一次把所有阻塞原因交给界面，
 * 用户不用改一条、重试一次。
 */
export function evaluatePreflight(facts: PreflightFacts): PreflightResult {
  const issues: PreflightIssue[] = []
  const warnings: PreflightIssue[] = []
  const plan = facts?.plan
  const snapshot = facts?.snapshot
  const required = plan ? requiredBytesFor(plan) : { projectBytes: 0, dataRootBytes: 0 }

  const push = (code: VpmErrorCode, params?: VpmParams): void => {
    issues.push({ code, params })
  }
  const warn = (code: VpmWarningCode | VpmErrorCode, params?: VpmParams, detail?: string): void => {
    warnings.push({ code, params, detail })
  }

  if (!plan || typeof plan !== 'object') {
    push('vpmPlanChanged', { field: 'plan' })
    return { ok: false, issues, warnings, required }
  }
  if (!snapshot || typeof snapshot !== 'object') {
    push('vpmProjectInvalid', { field: 'snapshot' })
    return { ok: false, issues, warnings, required }
  }

  if (!plan.planHash || plan.planHash !== facts.expectedPlanHash) {
    push('vpmPlanChanged', { field: 'planHash' })
  }
  if (plan.projectKey !== snapshot.projectKey) {
    push('vpmPlanChanged', { field: 'projectKey' })
  }
  if (plan.blocked || (plan.conflicts?.length ?? 0) > 0 || (plan.missing?.length ?? 0) > 0) {
    push('vpmPlanBlocked', {
      conflicts: plan.conflicts?.length ?? 0,
      missing: plan.missing?.length ?? 0
    })
  }
  if (!snapshot.manifest?.hasManifest || !snapshot.manifest.valid) {
    push('vpmManifestInvalid', { field: 'Packages/vpm-manifest.json' })
  }
  if ((plan.manifestHashBefore ?? '') !== (snapshot.manifestHash ?? '')) {
    push('vpmProjectChanged', { field: 'manifest' })
  }
  if (facts.activity?.unityRunning) push('vpmUnityRunning')
  if (facts.activity?.importing) push('vpmProjectImporting')

  const protectedNames = new Set(
    [PROTECTED_PACKAGE_ID, ...(facts.protectedPackages ?? [])].map((name) => lower(name))
  )
  const changes = Array.isArray(plan.changes) ? plan.changes : []
  const downloads = Array.isArray(plan.downloads) ? plan.downloads : []
  const paths = new Map(
    (facts.packagePaths ?? []).map((entry) => [lower(entry.name), entry] as const)
  )

  for (const change of changes) {
    if (!change || typeof change.name !== 'string') {
      push('vpmPlanChanged', { field: 'changes' })
      continue
    }
    if (change.action === 'keep') continue
    if (protectedNames.has(lower(change.name))) {
      push('vpmProtectedPackage', { name: change.name })
      continue
    }
    let name: string
    try {
      name = normalizePackageId(change.name)
    } catch {
      push('vpmPackageIdInvalid', { name: change.name })
      continue
    }
    const entry = paths.get(name)
    if (!entry) {
      // 采集器没给出路径 = 我们无法证明目标安全，拒绝。
      push('vpmProjectPathUnsafe', { path: `Packages/${name}` })
      continue
    }
    if (entry.symlink || entry.kind === 'file') {
      push('vpmProjectPathUnsafe', { path: entry.relativePath })
      continue
    }
    if (change.action === 'install' && entry.exists) {
      // 计划说“新装”，磁盘上却已有同名目录：外部改动，不覆盖。
      push('vpmProjectChanged', { field: entry.relativePath })
    }
    if (
      (change.action === 'upgrade' ||
        change.action === 'downgrade' ||
        change.action === 'reinstall' ||
        change.action === 'remove') &&
      !entry.exists
    ) {
      warn('vpmProjectMissingPackage', { name })
    }
  }

  for (const download of downloads) {
    if (!download || typeof download.name !== 'string') {
      push('vpmPlanChanged', { field: 'downloads' })
      continue
    }
    if (protectedNames.has(lower(download.name))) {
      push('vpmProtectedPackage', { name: download.name })
    }
    if (typeof download.sha256 !== 'string' || !HASH.test(download.sha256.trim())) {
      push('vpmCacheHashMissing', { name: download.name })
    }
    if (typeof download.url !== 'string' || !download.url.trim()) {
      push('vpmResolutionFailed', { name: download.name })
    }
  }

  if (required.projectBytes > 0 && facts.projectFreeBytes !== null) {
    if (facts.projectFreeBytes < required.projectBytes) {
      push('vpmProjectNoSpace', { required: required.projectBytes })
    }
  }
  if (required.dataRootBytes > 0 && facts.dataRootFreeBytes !== null) {
    if (facts.dataRootFreeBytes < required.dataRootBytes) {
      push('vpmCacheNoSpace', { required: required.dataRootBytes })
    }
  }
  if (!facts.vaultUsable) push('vpmVaultUnavailable')
  if (!facts.txRootUsable) push('vpmJournalInvalid', { field: '.atrium-tx' })
  if (!facts.packagesRootUsable) push('vpmProjectPathUnsafe', { path: 'Packages' })

  return { ok: issues.length === 0, issues, warnings, required }
}

/** 只读采集预检事实；不创建工程内目录，不写工程文件。 */
export function collectPreflightFacts(input: CollectPreflightInput): PreflightFacts {
  const projectPath = input.projectPath
  const packagesDir = path.join(projectPath, 'Packages')
  const packagesStat = lstatOrNull(packagesDir)
  const packagesRootUsable =
    !!packagesStat && packagesStat.isDirectory() && !packagesStat.isSymbolicLink()

  const txDir = path.join(projectPath, '.atrium-tx')
  const txStat = lstatOrNull(txDir)
  let txRootUsable: boolean
  if (txStat) {
    txRootUsable = txStat.isDirectory() && !txStat.isSymbolicLink()
  } else {
    try {
      fs.accessSync(projectPath, fs.constants.W_OK)
      txRootUsable = true
    } catch {
      txRootUsable = false
    }
  }

  const packagePaths: PreflightPackagePath[] = []
  for (const change of Array.isArray(input.plan?.changes) ? input.plan.changes : []) {
    if (!change || change.action === 'keep') continue
    let name: string
    try {
      name = normalizePackageId(change.name)
    } catch {
      continue
    }
    const relativePath = `Packages/${name}`
    const stat = lstatOrNull(path.join(packagesDir, name))
    packagePaths.push({
      name,
      relativePath,
      exists: !!stat,
      symlink: stat?.isSymbolicLink() === true,
      kind: stat ? describeKind(stat) : 'missing'
    })
  }

  const freeBytes = input.freeBytes ?? defaultFreeBytes
  return {
    plan: input.plan,
    expectedPlanHash: input.expectedPlanHash,
    snapshot: input.snapshot,
    activity: input.activity ?? { unityRunning: false, importing: false },
    projectFreeBytes: freeBytes(projectPath),
    dataRootFreeBytes: freeBytes(input.dataRoot),
    vaultUsable: input.vault.ensureUsable(),
    txRootUsable,
    packagesRootUsable,
    packagePaths,
    protectedPackages: input.protectedPackages
  }
}
