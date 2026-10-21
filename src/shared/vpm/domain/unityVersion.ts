import { VpmError } from '../errors'

const MAX_UNITY_VERSION_LENGTH = 64
const UNITY_VERSION = /^(\d{4})(?:\.(0|[1-9]\d*))?(?:\.(0|[1-9]\d*))?(?:([abfp])(0|[1-9]\d*))?(?:c(0|[1-9]\d*))?$/
const STAGE_RANK: Record<'a' | 'b' | 'f' | 'p', number> = { a: 0, b: 1, f: 2, p: 3 }

export type UnityStage = 'a' | 'b' | 'f' | 'p'

export interface UnityVersion {
  major: number
  minor: number | null
  patch: number | null
  stage: UnityStage | null
  stageNumber: number | null
  /** 中国版 `cN` 后缀；只保留显示，兼容比较按基础版本。 */
  china: number | null
  raw: string
  /** 去掉中国版后缀的版本（仍保留原 ref/revision 风格的大小写）。 */
  base: string
}

/**
 * Unity 编辑器版本：`YYYY.MINOR.PATCH[abfp]N[cN]`，允许 `2022`/`2022.3` 这类部分版本。
 * stage 必须带 patch；`c` 必须带 stage。不启动 Unity、不猜 revision。
 */
export function parseUnityVersion(input: unknown): UnityVersion | null {
  if (typeof input !== 'string') return null
  const raw = input.trim()
  if (!raw || raw.length > MAX_UNITY_VERSION_LENGTH) return null
  const match = UNITY_VERSION.exec(raw)
  if (!match) return null
  const major = Number(match[1])
  const minor = match[2] === undefined ? null : Number(match[2])
  const patch = match[3] === undefined ? null : Number(match[3])
  const stage = (match[4] as UnityStage | undefined) ?? null
  const stageNumber = match[5] === undefined ? null : Number(match[5])
  const china = match[6] === undefined ? null : Number(match[6])
  if (!Number.isSafeInteger(major) || major < 0) return null
  if ((minor !== null && !Number.isSafeInteger(minor)) || (patch !== null && !Number.isSafeInteger(patch))) return null
  if ((stage === null) !== (stageNumber === null)) return null
  if (stageNumber !== null && (!Number.isSafeInteger(stageNumber) || stageNumber < 0)) return null
  if (china !== null && (!Number.isSafeInteger(china) || china < 0)) return null
  if (stage !== null && patch === null) return null
  if (china !== null && stage === null) return null
  const base = china === null ? raw : raw.replace(/c\d+$/, '')
  return { major, minor, patch, stage, stageNumber, china, raw, base }
}

export function parseUnityVersionOrThrow(input: unknown): UnityVersion {
  const parsed = parseUnityVersion(input)
  if (!parsed) throw new VpmError('vpmUnityVersionInvalid')
  return parsed
}

function stageRank(stage: UnityStage | null): number {
  return stage === null ? -1 : STAGE_RANK[stage]
}

/** 部分版本缺省段按 0；stage 缺失低于 a；中国版后缀不参与比较。 */
export function compareUnityVersions(a: UnityVersion, b: UnityVersion): number {
  if (a.major !== b.major) return a.major < b.major ? -1 : 1
  const aMinor = a.minor ?? 0
  const bMinor = b.minor ?? 0
  if (aMinor !== bMinor) return aMinor < bMinor ? -1 : 1
  const aPatch = a.patch ?? 0
  const bPatch = b.patch ?? 0
  if (aPatch !== bPatch) return aPatch < bPatch ? -1 : 1
  const aStage = stageRank(a.stage)
  const bStage = stageRank(b.stage)
  if (aStage !== bStage) return aStage < bStage ? -1 : 1
  const aNumber = a.stageNumber ?? 0
  const bNumber = b.stageNumber ?? 0
  if (aNumber !== bNumber) return aNumber < bNumber ? -1 : 1
  return 0
}

export function formatUnityVersion(version: UnityVersion): string {
  return version.raw
}

export function isPartialUnityVersion(version: UnityVersion): boolean {
  return version.minor === null || version.patch === null || version.stage === null
}

/** 包声明的最低 Unity 版本是否不超过当前工程/编辑器版本；中国版按 base 比较。 */
export function isUnityVersionCompatible(minimum: string | UnityVersion, current: string | UnityVersion): boolean {
  const min = typeof minimum === 'string' ? parseUnityVersion(minimum) : minimum
  const now = typeof current === 'string' ? parseUnityVersion(current) : current
  if (!min || !now) return false
  return compareUnityVersions(min, now) <= 0
}

/** 用于 UI/诊断的稳定基础版本（去中国版后缀）。 */
export function unityVersionBase(input: string | UnityVersion): string | null {
  const parsed = typeof input === 'string' ? parseUnityVersion(input) : input
  return parsed ? parsed.base : null
}
