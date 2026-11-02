import fs from 'node:fs'
import path from 'node:path'
import { createExtractorFromFile } from 'node-unrar-js/dist/index'
import { probeFile } from './magic'
import { PasswordNeededError } from './errors'
import { assertTrustworthyListing, UntrustworthyListingError, type ListedEntry } from './trust'
import { assertRarEnvelope } from './rarEnvelope'
import { safeJoin } from '../security/paths'
import { memberMatches } from './entryMatch'

/* UnRAR source code may be used in any software to handle
 * RAR archives without limitations free of charge, but cannot be
 * used to develop RAR (WinRAR) compatible archiver and to
 * re-create RAR compression algorithm, which is proprietary.
 * Distribution of modified UnRAR source code in separate form
 * or as a part of other software is permitted, provided that
 * full text of this paragraph, starting from "UnRAR source code"
 * words, is included in license, or in documentation if license
 * is not available, and in source code comments of resulting package.
 * Full upstream terms ship in resources/licenses/UnRAR.txt.
 */
interface RarOptions {
  password?: string
  extraBackendDirs?: string[]
  signal?: AbortSignal
  onProgress?: (percent: number, current: string) => void
  /** Trusted caller-supplied flat placement map; archive names remain provenance. */
  targetNames?: ReadonlyMap<string, string>
}
export interface RarListResult { members: ListedEntry[]; warnings: string[]; encrypted: boolean; backend: string }

let queue: Promise<unknown> = Promise.resolve()
let wasm: ArrayBuffer | undefined
function serialized<T>(work: () => Promise<T>): Promise<T> {
  const pending = queue.then(work)
  queue = pending.catch(() => {})
  return pending
}

function wasmBinary(extraDirs: string[] = []): ArrayBuffer {
  if (!wasm) {
    const candidates = [
      ...extraDirs.map((dir) => path.join(dir, 'unrar.wasm')),
      path.join(path.dirname(process.execPath), 'resources/bin/unrar.wasm'),
      path.join(process.cwd(), 'node_modules/node-unrar-js/dist/js/unrar.wasm')
    ]
    const file = candidates.find((candidate) => fs.existsSync(candidate))
    if (!file) throw new Error('Missing bundled unrar.wasm')
    wasm = new Uint8Array(fs.readFileSync(file)).buffer
  }
  return wasm
}

function failed(file: string, error: unknown, encryptedPassword = false): never {
  if (error instanceof PasswordNeededError || error instanceof UntrustworthyListingError) throw error
  const reason = (error as { reason?: string })?.reason
  if (reason === 'ERAR_MISSING_PASSWORD' || reason === 'ERAR_BAD_PASSWORD' || (reason === 'ERAR_BAD_DATA' && encryptedPassword)) throw new PasswordNeededError(file)
  throw new UntrustworthyListingError(file, [reason ?? 'rar-backend-failed'])
}

async function scan(file: string, opts: RarOptions): Promise<RarListResult> {
  let encryptedHeaders = false
  try {
    const probe = await probeFile(file)
    if (probe.format !== 'rar') throw new UntrustworthyListingError(file, ['not-rar'])
    encryptedHeaders = await assertRarEnvelope(file, probe.subtype === 'rar5')
    const extractor = await createExtractorFromFile({ filepath: file, password: opts.password, wasmBinary: wasmBinary(opts.extraBackendDirs) })
    const listing = extractor.getFileList()
    const headers = [...listing.fileHeaders] // Exhaustion closes the native archive; never stop at the first match.
    if (listing.arcHeader.flags.volume) throw new UntrustworthyListingError(file, ['rar-volume-unverified'])
    const members = headers.map((entry) => ({
      path: entry.name.replace(/\\/g, '/'), size: entry.unpSize, crc32: entry.crc,
      isDir: entry.flags.directory, encrypted: entry.flags.encrypted
    }))
    assertTrustworthyListing({ file, format: 'rar', backendFormat: 'rar', entries: members, complete: true, expectedEntries: members.length })
    return { members, warnings: [], encrypted: listing.arcHeader.flags.headerEncrypted || members.some((entry) => entry.encrypted), backend: 'unrar-wasm' }
  } catch (error) { return failed(file, error, encryptedHeaders && !!opts.password) }
}

export function listRar(file: string, opts: RarOptions = {}): Promise<RarListResult> {
  return serialized(() => scan(file, opts))
}

export function extractRar(file: string, wanted: string[] | undefined, dest: string, opts: RarOptions = {}): Promise<{ files: number; bytes: number }> {
  if (wanted?.length === 0) return Promise.resolve({ files: 0, bytes: 0 })
  return serialized(async () => {
    opts.signal?.throwIfAborted()
    const listing = await scan(file, opts)
    const selected = listing.members.filter((entry) => !entry.isDir && (!wanted || wanted.some((name) => memberMatches(entry.path, name))))
    const names = new Set(selected.map((entry) => entry.path))
    if (names.size !== selected.length) throw new UntrustworthyListingError(file, ['duplicate-rar-member-path'])
    const targetName = (name: string): string => {
      const normalized = name.replace(/\\/g, '/')
      if (!opts.targetNames) return normalized
      const mapped = opts.targetNames.get(normalized)
      if (!mapped) throw new UntrustworthyListingError(file, ['missing-target-mapping'])
      return mapped
    }
    const targets = new Set<string>()
    for (const entry of selected) {
      const target = safeJoin(dest, targetName(entry.path))
      if (!target || fs.existsSync(target) || targets.has(target.toLowerCase())) throw new UntrustworthyListingError(file, ['unsafe-or-conflicting-target'])
      targets.add(target.toLowerCase())
    }
    if (!selected.length) return { files: 0, bytes: 0 }
    try {
      fs.mkdirSync(dest, { recursive: true })
      const extractor = await createExtractorFromFile({ filepath: file, targetPath: dest, password: opts.password, wasmBinary: wasmBinary(opts.extraBackendDirs), filenameTransform: targetName })
      let files = 0, bytes = 0
      let deferred: unknown
      let validationFailed = false
      // SDK generators have no finally: drain to EOF even on cancellation/callback errors,
      // skipping remaining payloads so closeArc always runs before releasing the decoder.
      for (const item of extractor.extract({ files: (header) => !validationFailed && !opts.signal?.aborted && names.has(header.name.replace(/\\/g, '/')) }).files) {
        try {
          const member = item.fileHeader
          const target = safeJoin(dest, targetName(member.name))!
          if (fs.statSync(target).size !== member.unpSize) throw new UntrustworthyListingError(file, ['rar-extraction-size'])
          files++; bytes += member.unpSize
          opts.onProgress?.(files / selected.length, member.name)
        } catch (error) { deferred = error; validationFailed = true }
      }
      opts.signal?.throwIfAborted()
      if (validationFailed) throw deferred
      if (files !== selected.length) throw new UntrustworthyListingError(file, ['rar-extraction-missing'])
      return { files, bytes }
    } catch (error) { opts.signal?.throwIfAborted(); return failed(file, error, !!opts.password && listing.encrypted) }
  })
}
