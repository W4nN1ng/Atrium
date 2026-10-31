import fs from 'node:fs'
import path from 'node:path'
import type { PlanReview, PreparedIntakePlan } from '../../shared/intake'

/** R17: compare actual bytes for each sampled coverage pair, never user approval alone. */
export async function verifyCoverageReview(plan: PreparedIntakePlan, review: PlanReview, signal?: AbortSignal): Promise<boolean> {
  const canonical = (value: string): string => { const normalized = path.resolve(value).replace(/\\/g, '/'); return process.platform === 'win32' ? normalized.toLowerCase() : normalized }
  if (review.kind !== 'coverage' || !review.matches.length) return false
  for (const match of review.matches) {
    signal?.throwIfAborted()
    const sameKey = (o: PreparedIntakePlan['occurrences'][number]) => o.key.size === match.key.size && o.key.crc32 === match.key.crc32
    const left = plan.occurrences.find(o => canonical(o.sourcePath) === canonical(review.sourcePath) && o.relPath === match.leafRelPath && sameKey(o))
    const right = plan.occurrences.find(o => canonical(o.sourcePath) === canonical(match.coveringPath) && (!match.coveringRelPath || o.relPath === match.coveringRelPath) && sameKey(o))
    if (!left?.localPath || !right?.localPath) return false
    const a = await fs.promises.open(left.localPath, 'r')
    try {
      const b = await fs.promises.open(right.localPath, 'r')
      try {
        const [sa, sb] = await Promise.all([a.stat(), b.stat()])
        if (sa.size !== match.key.size || sb.size !== sa.size) return false
        const aa = Buffer.alloc(1024 * 1024), bb = Buffer.alloc(1024 * 1024)
        for (let offset = 0; offset < sa.size;) {
          signal?.throwIfAborted()
          const length = Math.min(aa.length, sa.size - offset)
          const [ra, rb] = await Promise.all([a.read(aa, 0, length, offset), b.read(bb, 0, length, offset)])
          if (ra.bytesRead !== length || rb.bytesRead !== length || !aa.subarray(0, length).equals(bb.subarray(0, length))) return false
          offset += length
        }
        const [afterA, afterB] = await Promise.all([a.stat(), b.stat()])
        if (afterA.mtimeMs !== sa.mtimeMs || afterB.mtimeMs !== sb.mtimeMs || afterA.size !== sa.size || afterB.size !== sb.size) return false
      } finally { await b.close() }
    } finally { await a.close() }
  }
  return true
}
