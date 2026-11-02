import { describe, expect, it } from 'vitest'
import { assertTrustworthyListing, UntrustworthyListingError, type ListingCheck } from '../../src/main/unpack/trust'

const leaf = { path: 'a.txt', size: 1, crc32: 0, isDir: false, encrypted: false }
const good = (): ListingCheck => ({ file: 'test.rar', format: 'rar', backendFormat: 'rar', entries: [leaf], complete: true })

describe('archive listing trust', () => {
  it('allows real zero CRCs, empty files, empty ZIPs and directories without CRC', () => {
    expect(() => assertTrustworthyListing(good())).not.toThrow()
    expect(() => assertTrustworthyListing({ ...good(), entries: [{ ...leaf, size: 0 }] })).not.toThrow()
    expect(() => assertTrustworthyListing({ ...good(), format: 'zip', backendFormat: 'zip', entries: [], expectedEntries: 0 })).not.toThrow()
    expect(() => assertTrustworthyListing({ ...good(), entries: [{ ...leaf, isDir: true, crc32: undefined }] })).not.toThrow()
  })

  it.each([
    { exitCode: 1 }, { stderr: 'warning' }, { stdout: 'Warnings: 1' }, { warnings: ['partial'] },
    { complete: false }, { truncated: true }, { backendFormat: 'zip' }, { expectedEntries: 2 },
    { entries: [] }, { entries: [{ ...leaf, crc32: undefined }] },
    { entries: [{ ...leaf, crc32: -1 }] }, { entries: [{ ...leaf, crc32: 0x100000000 }] },
    { entries: [{ ...leaf, size: -1 }] }, { entries: [{ ...leaf, size: 1.2 }] },
    { entries: [{ ...leaf, size: Number.MAX_SAFE_INTEGER + 1 }] }, { entries: [{ ...leaf, path: '' }] }
  ])('rejects incomplete or inconsistent evidence: %j', (change) => {
    expect(() => assertTrustworthyListing({ ...good(), ...change })).toThrow(UntrustworthyListingError)
  })

  it('does not collapse repeated content or reject filenames containing the word warning', () => {
    expect(() => assertTrustworthyListing({ ...good(), entries: [leaf, { ...leaf, path: 'warning.txt' }], stdout: 'Path = warning.txt' })).not.toThrow()
  })
})
