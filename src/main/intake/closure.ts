import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type { Budget, ClosurePayload, ContainerRef, LeafRef, ContentKey } from '../../shared/intake'
import { probeBuffer, type ProbeResult } from '../unpack/magic'
import { listMembers } from '../unpack/members'
import { PasswordNeededError } from '../unpack/errors'
import { ExpandCache, type CacheMember } from './expandCache'
import { fileIdentity, sameFile } from './identity'
import { extractFlat } from './memberIO'

export interface ClosureOptions extends Budget {
  cache?: ExpandCache
  ownerId?: string
  cacheNamespace?: string // Database file path; isolates libraries/sandboxes during cleanup.
  signal?: AbortSignal
  extraBackendDirs?: string[]
  /** Called for the actual (possibly inner cached) container; null explicitly declines. Never persisted. */
  requestPassword?: (container: string) => Promise<string | null>
}
async function probe(file: string, name: string): Promise<ProbeResult> {
  const handle = await fs.promises.open(file, 'r')
  try { const head = Buffer.alloc(1024); const { bytesRead } = await handle.read(head, 0, head.length, 0); return probeBuffer(head.subarray(0, bytesRead), name) }
  finally { await handle.close() }
}

export async function buildClosure(root: string, opts: ClosureOptions): Promise<ClosurePayload> {
  for (const value of [opts.maxDepth, opts.maxEntriesPerContainer, opts.maxTotalBytes, opts.maxFileBytes]) {
    if (!Number.isSafeInteger(value) || value < 0) throw new RangeError('Invalid intake budget')
  }
  opts.signal?.throwIfAborted()
  const cache = opts.cache ?? new ExpandCache({ namespace: opts.cacheNamespace }), ownerId = opts.ownerId ?? randomUUID()
  const warnings: string[] = [], unreadable: { path: string; reason: string }[] = [], keys = new Set<string>()
  let opaque = false, expandedBytes = 0
  const failPath = (rel: string, error: unknown): LeafRef[] => {
    opts.signal?.throwIfAborted(); opaque = true
    const reason = error instanceof Error ? error.message : String(error)
    unreadable.push({ path: rel, reason }); warnings.push(`${rel}: unreadable (${reason})`); return []
  }
  async function visit(file: string, rel: string, chain: ContainerRef[], depth: number, cacheKey?: string, knownKey?: ContentKey): Promise<LeafRef[]> {
    opts.signal?.throwIfAborted()
    let stat: fs.Stats
    try { stat = await fs.promises.lstat(file) } catch (error) { return failPath(rel, error) }
    if (stat.isSymbolicLink()) return failPath(rel, new Error('reparse-point-not-followed'))
    if (stat.isDirectory()) {
      const leaves: LeafRef[] = []
      let children: string[]
      try { children = (await fs.promises.readdir(file)).sort() } catch (error) { return failPath(rel, error) }
      for (const child of children) leaves.push(...await visit(path.join(file, child), rel ? `${rel}/${child}` : child, chain, depth))
      return leaves
    }
    if (!stat.isFile()) return failPath(rel, new Error('not-regular-file'))
    let identity: Awaited<ReturnType<typeof fileIdentity>>, kind: ProbeResult
    try {
      identity = await fileIdentity(file, opts.signal); kind = await probe(file, rel)
      if (knownKey && (knownKey.size !== identity.key.size || knownKey.crc32 !== identity.key.crc32)) throw new Error('cached-member-changed')
    } catch (error) { return failPath(rel, error) }
    const leaf: LeafRef = { key: identity.key, blobId: identity.sha256, relPath: rel, chain, localPath: file, kind: 'file', ...(cacheKey ? { cacheKey } : {}) }
    if (kind.extMismatch) warnings.push(`${rel}: extension-mismatch (${kind.format})`)
    // The original member name is used for this decision, never the flat cache filename.
    if (path.extname(rel).toLowerCase() === '.unitypackage') return [{ ...leaf, kind: 'unitypackage' }]
    if (!kind.isArchive) return [leaf]
    try {
      if (!['zip', 'rar', 'sevenz'].includes(kind.format)) throw new Error(`unsupported-container-${kind.format}`)
      if (depth + 1 > opts.maxDepth) throw new Error('budget-depth')
      const format: ContainerRef['format'] = kind.format === 'sevenz' ? '7z' : kind.format as 'zip' | 'rar'
      let password: string | undefined
      let expansion: Awaited<ReturnType<ExpandCache['materialize']>> | undefined
      let charged = false
      for (let attempt = 0; attempt < 4; attempt++) {
        try {
          opts.signal?.throwIfAborted()
          const listing = await listMembers(file, { password, extraBackendDirs: opts.extraBackendDirs, signal: opts.signal })
          const files = listing.entries.filter(e => !e.isDir)
          const bytes = files.reduce((sum, e) => sum + e.size, 0)
          if (listing.entries.length > opts.maxEntriesPerContainer) throw new Error('budget-entries')
          if (files.some(e => e.size > opts.maxFileBytes)) throw new Error('budget-file')
          if (!Number.isSafeInteger(bytes) || (!charged && expandedBytes + bytes > opts.maxTotalBytes)) throw new Error('budget-total')
          if (!charged) { expandedBytes += bytes; charged = true }
          const members: CacheMember[] = files.map((e, index) => ({ originalPath: e.originalPath ?? e.path, key: { size: e.size, crc32: e.crc32! }, file: `${String(index).padStart(8, '0')}.bin` }))
          keys.add(identity.sha256)
          expansion = await cache.materialize(identity.sha256, ownerId, members,
            dest => extractFlat(file, kind.format, listing.entries, members, dest, { password, extraBackendDirs: opts.extraBackendDirs, signal: opts.signal }), opts.signal)
          break
        } catch (error) {
          opts.signal?.throwIfAborted()
          if (!(error instanceof PasswordNeededError) || !opts.requestPassword || attempt === 3) throw error
          const answer = await opts.requestPassword(file)
          if (answer === null) throw new Error('password-declined')
          password = answer
        }
      }
      if (!expansion) throw new Error('container-not-expanded')
      if (!sameFile(stat, await fs.promises.lstat(file))) throw new Error('source-changed-during-expansion')
      const next: ContainerRef = { sourcePath: chain.length ? chain[chain.length - 1].sourcePath : file, memberPath: chain.length ? rel : null, format, key: identity.key }
      const leaves: LeafRef[] = []
      const unreadableBefore = unreadable.length
      for (const member of expansion.members) {
        const nestedRel = chain.length || depth || rootIsDirectory ? `${rel}!/${member.originalPath}` : member.originalPath
        leaves.push(...await visit(member.localPath, nestedRel, [next, ...chain], depth + 1, expansion.key, member.key))
      }
      if (unreadable.length !== unreadableBefore) throw new Error('member-unreadable; raw-container-retained')
      return leaves
    } catch (error) {
      opts.signal?.throwIfAborted(); opaque = true
      warnings.push(`${rel}: opaque (${error instanceof Error ? error.message : String(error)})`)
      return [{ ...leaf, kind: 'opaque' }]
    }
  }
  const absolute = path.resolve(root)
  let rootIsDirectory = false
  let rootRel: string
  try { rootIsDirectory = (await fs.promises.lstat(absolute)).isDirectory(); rootRel = rootIsDirectory ? '' : path.basename(absolute) } catch { rootRel = path.basename(absolute) }
  const leaves = await visit(absolute, rootRel, [], 0)
  return { leaves, opaque, warnings, unreadable, cacheKeys: [...keys].sort(), cacheOwnerId: ownerId }
}
