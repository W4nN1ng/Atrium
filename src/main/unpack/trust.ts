import { CorruptArchiveError } from './errors'

export interface ListedEntry {
  path: string
  size: number
  isDir: boolean
  encrypted: boolean
  crc32?: number
}
export interface ListingCheck {
  file: string
  format: string
  backendFormat?: string
  entries: readonly ListedEntry[]
  complete: boolean
  expectedEntries?: number
  exitCode?: number
  stdout?: string
  stderr?: string
  warnings?: readonly string[]
  truncated?: boolean
}

/** Legacy callers still recognize a corrupt archive; intake can distinguish an untrusted listing. */
export class UntrustworthyListingError extends CorruptArchiveError {
  constructor(file: string, readonly reasons: readonly string[]) {
    super(file, 'Untrustworthy listing: ' + reasons.join(', '))
    this.name = 'UntrustworthyListingError'
  }
}

export function assertTrustworthyListing(input: ListingCheck): void {
  const reasons: string[] = []
  if ((input.exitCode ?? 0) !== 0) reasons.push('backend-exit')
  if (input.stderr?.trim() || input.warnings?.length) reasons.push('backend-warning')
  if (/(?:^|\n)\s*(?:warn(?:ing)?s?|errors?|警告|错误)\s*[:!：]/i.test(input.stdout ?? '')) reasons.push('backend-diagnostic')
  if (!input.complete || input.truncated) reasons.push('incomplete-listing')
  if (input.backendFormat && input.backendFormat !== input.format) reasons.push('format-mismatch')
  if (input.expectedEntries !== undefined && input.expectedEntries !== input.entries.length) reasons.push('member-count-mismatch')
  if (!input.entries.length && input.expectedEntries !== 0) reasons.push('unproven-empty-listing')
  let total = 0
  for (const entry of input.entries) {
    if (!entry.path || !Number.isSafeInteger(entry.size) || entry.size < 0) reasons.push('invalid-entry')
    if (!entry.isDir && (!Number.isInteger(entry.crc32) || entry.crc32! < 0 || entry.crc32! > 0xffffffff)) reasons.push('missing-or-invalid-crc')
    if (!entry.isDir) total += entry.size
  }
  if (!Number.isSafeInteger(total)) reasons.push('invalid-total-size')
  if (reasons.length) throw new UntrustworthyListingError(input.file, [...new Set(reasons)])
}
