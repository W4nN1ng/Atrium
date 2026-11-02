import fs from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import type { MemberSource } from '../../shared/intake'
import { ExpandCache, type CachedExpansion } from './expandCache'
import { fileIdentity, sameFile } from './identity'
import { extractOne } from './memberIO'
import { listMembers } from '../unpack/members'
import { PasswordNeededError } from '../unpack/errors'
import type { ArchiveEntry } from '../unpack/sevenZip'
import path from 'node:path'
import { isInside } from '../security/paths'

export interface MemberReadOptions {
  signal?: AbortSignal
  extraBackendDirs?: string[]
  requestPassword?: (file: string) => Promise<string | null>
  onSpaceWait?: (requiredBytes: number) => void
  sourceRoot?: string
  passwordCache?: Map<string, string>
  archiveIdentities?: Map<string, { sha256: string; stat: fs.Stats }>
}
export const memberCacheKey = (containerSha: string, index: number): string => createHash('sha256').update(JSON.stringify(['member-batch-v1', containerSha, index])).digest('hex')
export async function releaseMember(cache: ExpandCache, ownerId: string, key: string): Promise<void> {
  await cache.releaseKeys(ownerId, [key])
  await cache.discardUnreferenced([key])
}
export async function materializeBatchMember(file: string, containerSha: string, format: MemberSource['steps'][number]['format'], entries: ArchiveEntry[], index: number,
  password: string | undefined, cache: ExpandCache, ownerId: string, opts: MemberReadOptions, heldBytes = 0): Promise<CachedExpansion> {
  const entry = entries[index], key = memberCacheKey(containerSha, index)
  if (heldBytes + entry.size > cache.capacityBytes) throw new Error('batch-cache-working-set-budget')
  const member = { originalPath: entry.originalPath ?? entry.path, key: { size: entry.size, crc32: entry.crc32! }, file: '00000000.bin' }
  for (;;) {
    opts.signal?.throwIfAborted()
    try { return await cache.materialize(key, ownerId, [member], dest => extractOne(file, format, entries, index, member, dest, { ...opts, password }), opts.signal) }
    catch (error) {
      if (!(error instanceof Error) || error.message !== 'cache-insufficient-space' || !opts.onSpaceWait) throw error
      opts.onSpaceWait(Math.ceil(entry.size * 1.2) + 8192 + 1024 * 1024)
      await delay(1000, undefined, { signal: opts.signal })
    }
  }
}

/** Materialize only the requested leaf, releasing earlier chain steps as soon as the next exists. */
export async function readMemberSource(source: MemberSource, cache: ExpandCache, opts: MemberReadOptions = {}): Promise<{ file: string; release: () => Promise<void> }> {
  const owner = 'member-read:' + randomUUID()
  const touched = new Set<string>()
  let file = source.archivePath, heldKey: string | undefined, heldBytes = 0
  try {
    if (opts.sourceRoot) {
      if (!isInside(opts.sourceRoot, file)) throw new Error('member-source-outside-scan-root')
      for (let cursor = file; isInside(opts.sourceRoot, cursor); cursor = path.dirname(cursor)) {
        if ((await fs.promises.lstat(cursor)).isSymbolicLink()) throw new Error('member-source-reparse')
        if (cursor === path.dirname(cursor)) break
      }
    }
    const originalStat = await fs.promises.lstat(file), prior = opts.archiveIdentities?.get(file)
    const sha256 = prior && sameFile(originalStat, prior.stat) ? prior.sha256 : (await fileIdentity(file, opts.signal)).sha256
    if (sha256 !== source.archiveSha256) throw new Error('member-source-archive-changed')
    opts.archiveIdentities?.set(file, { sha256, stat: originalStat })
    let containerSha = source.archiveSha256
    for (const step of source.steps) {
      let password = opts.passwordCache?.get(containerSha), materialized: CachedExpansion | undefined
      for (let attempt = 0; attempt < 4; attempt++) {
        try {
          const listing = await listMembers(file, { ...opts, password })
          const entry = listing.entries[step.index]
          if (!entry || entry.isDir || (entry.originalPath ?? entry.path) !== step.originalPath || entry.size !== step.key.size || entry.crc32 !== step.key.crc32) throw new Error('member-source-listing-changed')
          const format = listing.format === 'sevenz' ? '7z' : listing.format
          if (format !== step.format) throw new Error('member-source-format-changed')
          touched.add(memberCacheKey(containerSha, step.index))
          materialized = await materializeBatchMember(file, containerSha, step.format, listing.entries, step.index, password, cache, owner, opts, heldBytes)
          break
        } catch (error) {
          if (!(error instanceof PasswordNeededError) || !opts.requestPassword || attempt === 3) throw error
          const answer = await opts.requestPassword(file)
          if (answer === null) throw new Error('password-declined')
          password = answer
        }
      }
      if (!materialized) throw new Error('member-source-not-materialized')
      if (materialized.members[0].sha256 !== step.sha256) throw new Error('member-source-content-changed')
      if (password) opts.passwordCache?.set(containerSha, password)
      if (heldKey) await releaseMember(cache, owner, heldKey)
      heldKey = materialized.key; file = materialized.members[0].localPath; heldBytes = step.key.size; containerSha = step.sha256
    }
    if (!sameFile(originalStat, await fs.promises.lstat(source.archivePath))) throw new Error('member-source-archive-changed')
    if (!heldKey || !fs.existsSync(file)) throw new Error('empty-member-source')
    const key = heldKey
    return { file, release: async () => { await releaseMember(cache, owner, key); await cache.release(owner) } }
  } catch (error) {
    await cache.release(owner)
    // Only this reader's generated keys are candidates; active peers remain protected.
    await cache.discardUnreferenced([...touched])
    throw error
  }
}
