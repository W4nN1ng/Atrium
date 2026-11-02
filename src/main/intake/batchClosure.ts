import fs from 'node:fs'
import path from 'node:path'
import type { ClosurePayload, ContainerRef, LeafRef, MemberSource } from '../../shared/intake'
import type { ClosureOptions } from './closure'
import { ExpandCache } from './expandCache'
import { fileIdentity, sameFile } from './identity'
import { listMembers } from '../unpack/members'
import { probeBuffer } from '../unpack/magic'
import { PasswordNeededError } from '../unpack/errors'
import { materializeBatchMember, releaseMember } from './memberSource'

/** A bounded queue of archive members. Recipes survive cache reclamation and process restarts. */
export async function buildBatchedClosure(root: string, opts: ClosureOptions & { cache: ExpandCache; ownerId: string }): Promise<ClosurePayload> {
  const warnings: string[] = ['cache-pressure: processing loose files and small containers first in member batches'], unreadable: { path: string; reason: string }[] = []
  let opaque = false, expandedBytes = 0
  const cache = opts.cache, owner = opts.ownerId
  const absolute = path.resolve(root), rootDirectory = fs.lstatSync(absolute).isDirectory()
  async function visit(file: string, rel: string, chain: ContainerRef[], depth: number, source: MemberSource | undefined, heldBytes: number): Promise<LeafRef[]> {
    opts.signal?.throwIfAborted()
    const before = await fs.promises.lstat(file), identity = await fileIdentity(file, opts.signal)
    const leaf: LeafRef = { key: identity.key, blobId: identity.sha256, relPath: rel, chain, localPath: source ? null : file, ...(source ? { memberSource: source } : {}) }
    const handle = await fs.promises.open(file, 'r'), head = Buffer.alloc(1024)
    let bytesRead: number
    try { ({ bytesRead } = await handle.read(head, 0, head.length, 0)) } finally { await handle.close() }
    const probe = probeBuffer(head.subarray(0, bytesRead), rel)
    if (probe.extMismatch) warnings.push(`${rel}: extension-mismatch (${probe.format})`)
    if (/\.unitypackage$/i.test(rel)) return [{ ...leaf, kind: 'unitypackage' }]
    if (!probe.isArchive) return [{ ...leaf, kind: 'file' }]
    const format: MemberSource['steps'][number]['format'] = probe.format === 'sevenz' ? '7z' : probe.format as 'zip' | 'rar'
    try {
      if (!['zip', 'rar', '7z'].includes(format)) throw new Error('unsupported-container-' + probe.format)
      if (depth + 1 > opts.maxDepth) throw new Error('budget-depth')
      let password: string | undefined, entries: Awaited<ReturnType<typeof listMembers>>['entries'] | undefined
      for (let attempt = 0; attempt < 4; attempt++) {
        try { entries = (await listMembers(file, { ...opts, password })).entries; break }
        catch (error) {
          if (!(error instanceof PasswordNeededError) || !opts.requestPassword || attempt === 3) throw error
          const answer = await opts.requestPassword(file); if (answer === null) throw new Error('password-declined'); password = answer
        }
      }
      if (!entries) throw new Error('container-not-listed')
      const indices = entries.flatMap((entry, index) => entry.isDir ? [] : [index])
      if (!indices.length) throw new Error('empty-container-retained')
      if (entries.length > opts.maxEntriesPerContainer) throw new Error('budget-entries')
      if (indices.some(i => entries![i].size > opts.maxFileBytes)) throw new Error('budget-file')
      const bytes = indices.reduce((sum, i) => sum + entries![i].size, 0)
      if (!Number.isSafeInteger(bytes) || expandedBytes + bytes > opts.maxTotalBytes) throw new Error('budget-total')
      expandedBytes += bytes
      const next: ContainerRef = { sourcePath: chain.length ? chain[chain.length - 1].sourcePath : file, memberPath: chain.length ? rel : null, format, key: identity.key }
      const result = new Map<number, LeafRef[]>()
      // Small leaf/member batches make forward progress before larger ones. Original ordinals stay in recipes.
      for (const index of [...indices].sort((a, b) => entries![a].size - entries![b].size || a - b)) {
        const entry = entries[index]
        let expanded: Awaited<ReturnType<typeof materializeBatchMember>> | undefined
        try {
          for (let attempt = 0; attempt < 4; attempt++) {
            try { expanded = await materializeBatchMember(file, identity.sha256, format, entries, index, password, cache, owner, opts, heldBytes); break }
            catch (error) {
              if (!(error instanceof PasswordNeededError) || !opts.requestPassword || attempt === 3) throw error
              const answer = await opts.requestPassword(file); if (answer === null) throw new Error('password-declined'); password = answer
            }
          }
          if (!expanded) throw new Error('member-not-materialized')
          const member = expanded.members[0], spelling = entry.originalPath ?? entry.path
          const memberSource: MemberSource = { archivePath: source?.archivePath ?? file, archiveSha256: source?.archiveSha256 ?? identity.sha256,
            steps: [...(source?.steps ?? []), { format, index, originalPath: spelling, key: member.key, sha256: member.sha256! }] }
          const nestedRel = chain.length || depth || rootDirectory ? `${rel}!/${spelling}` : spelling
          result.set(index, await visit(member.localPath, nestedRel, [next, ...chain], depth + 1, memberSource, heldBytes + entry.size))
        } finally { if (expanded) await releaseMember(cache, owner, expanded.key) }
      }
      if (!sameFile(before, await fs.promises.lstat(file))) throw new Error('source-changed-during-expansion')
      return indices.flatMap(i => result.get(i)!)
    } catch (error) {
      opts.signal?.throwIfAborted(); opaque = true
      warnings.push(`${rel}: opaque (${error instanceof Error ? error.message : String(error)})`)
      return [{ ...leaf, kind: 'opaque' }]
    }
  }
  const loose: string[] = [], archives: { file: string; size: number }[] = []
  async function inventory(file: string): Promise<void> {
    opts.signal?.throwIfAborted()
    try {
      const st = await fs.promises.lstat(file)
      if (st.isSymbolicLink()) throw new Error('reparse-point-not-followed')
      if (st.isDirectory()) { for (const name of (await fs.promises.readdir(file)).sort()) await inventory(path.join(file, name)); return }
      if (!st.isFile()) throw new Error('not-regular-file')
      const handle = await fs.promises.open(file, 'r'), head = Buffer.alloc(1024)
      let bytesRead: number
      try { ({ bytesRead } = await handle.read(head, 0, head.length, 0)) } finally { await handle.close() }
      if (!/\.unitypackage$/i.test(file) && probeBuffer(head.subarray(0, bytesRead), file).isArchive) archives.push({ file, size: st.size }); else loose.push(file)
    } catch (error) { opts.signal?.throwIfAborted(); opaque = true; unreadable.push({ path: path.relative(absolute, file), reason: String(error) }) }
  }
  const leaves: LeafRef[] = []
  try {
    await inventory(absolute)
    for (const file of [...loose.sort(), ...archives.sort((a, b) => a.size - b.size || a.file.localeCompare(b.file)).map(a => a.file)]) {
      try { leaves.push(...await visit(file, rootDirectory ? path.relative(absolute, file).replace(/\\/g, '/') : path.basename(file), [], 0, undefined, 0)) }
      catch (error) { opts.signal?.throwIfAborted(); opaque = true; unreadable.push({ path: file, reason: String(error) }) }
    }
    warnings.push(...unreadable.map(u => `${u.path}: unreadable (${u.reason})`))
    return { leaves, opaque, warnings, unreadable, cacheKeys: [], cacheOwnerId: owner }
  } finally { await cache.release(owner) }
}
