import type { CoverCandidate, PreviewTarget } from './covers'

export type CoverCandidateKind = 'all' | 'prefab' | 'model'
export function candidateKind(target: Pick<PreviewTarget, 'path'>): 'prefab' | 'model' {
  return /\.prefab$/i.test(target.path) ? 'prefab' : 'model'
}
const normalized = (value: string): string => value.normalize('NFKC').toLowerCase()
export function selectCoverCandidates(candidates: CoverCandidate[], query: string, kind: CoverCandidateKind): CoverCandidate[] {
  const words = normalized(query).trim().split(/\s+/).filter(Boolean)
  return candidates.filter(item => {
    if (kind !== 'all' && candidateKind(item) !== kind) return false
    const haystack = normalized([item.name, item.path, ...item.memberPaths].join(' '))
    return words.every(word => haystack.includes(word))
  }).sort((a, b) => {
    const rank = Number(candidateKind(a) === 'model') - Number(candidateKind(b) === 'model')
    return rank || a.name.localeCompare(b.name) || a.path.localeCompare(b.path) || a.id.localeCompare(b.id)
  })
}

const advice: Record<string, string> = {
  'covers.dependencyMissing': 'covers.adviceDependency', 'covers.projectMissing': 'covers.adviceDependency',
  'covers.missingShader': 'covers.adviceShader', 'covers.packageMissingShader': 'covers.adviceShader',
  'covers.unityMissing': 'covers.adviceEditor', 'covers.packageEditorMissing': 'covers.adviceEditor',
  'covers.unityStartTimeout': 'covers.adviceStartup', 'covers.unityStartFailed': 'covers.adviceStartup',
  'covers.sourceUnavailable': 'covers.adviceSource', 'covers.sourceUnreadable': 'covers.adviceSource',
  'covers.sourceChanged': 'covers.adviceSourceChanged', 'covers.packageConflict': 'covers.adviceConflict',
  'covers.inventoryLimited': 'covers.adviceLimits', 'covers.packageLimitExceeded': 'covers.adviceLimits',
  'covers.targetMissing': 'covers.adviceTarget', 'covers.noMesh': 'covers.adviceTarget', 'covers.changed': 'covers.adviceChanged',
  'covers.invalidBounds': 'covers.adviceTarget', 'covers.offline': 'covers.adviceOffline',
  'covers.unityBusy': 'covers.adviceBusy'
}
export function coverErrorAdvice(key: string): string { return advice[key] ?? 'covers.adviceRetry' }
