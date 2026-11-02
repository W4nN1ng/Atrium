# Archive adapters and listing trust

## Public entry points

- `magic.ts`: recognize the actual bytes, including renamed RAR/7z files and fake ZIP downloads.
- `unzip.ts`: ZIP central-directory listing with full CRC32, plus the existing ZIP extraction/encoding behavior.
- `sevenZip.ts`: compatibility facade. RAR bytes use `unrar.ts`, ZIP listings use yauzl, remaining formats use a capable 7z CLI. It continues exporting the established password/corrupt/component errors.
- `unrar.ts`: `listRar(file, options)` returns structured members/CRCs; `extractRar(file, wanted, destination, options)` extracts only selected members. No installed UnRAR or 7-Zip executable is needed for RAR.
- `trust.ts`: `assertTrustworthyListing` and `UntrustworthyListingError`; M3 must catch the latter and preserve the original container with a warning, never skip it using partial evidence.
- `members.ts`: existing exact-member listing/extraction API remains the caller-facing abstraction for imports.

## RAR decoder and resources

`node-unrar-js` is pinned to 2.0.2. It exposes a file-backed UnRAR decoder, so listing large stored payloads need not load the whole archive into memory. Fully consume its generators; early exit leaves native archive handles open. Calls in one JS context are serialized because the library uses a singleton WASM instance.

The JS wrapper is inlined into the worker bundle. The npm package's `dist/js/unrar.wasm` is copied to `resources/bin/unrar.wasm` by electron-builder; development may read that file from node_modules. Initialization always supplies the local bytes, without fetching a decoder at runtime.

`rarEnvelope.ts` verifies plain RAR4/RAR5 block extents/end records and RAR5 header checksums. Encrypted headers are consumed by UnRAR after decryption. Malformed headers, failed reads, missing end records and unverified multipart archives are untrusted. A RAR4 encrypted-header failure can report `ERAR_BAD_DATA` for a wrong password; when a password was supplied and the encryption marker is present, request the password again instead of accepting a partial listing.

The upstream wrapper's MIT notice and the UnRAR license are shipped in `resources/licenses/`. The license's restriction against implementing a RAR compressor is also retained in source comments. This module only reads/extracts RAR.

## Content evidence and failure modes

Sizes must be nonnegative safe integers. Each file leaf needs a full unsigned CRC32; directories may omit it. Zero-byte files and CRC=0 are valid. `(size, crc32)` never includes filenames and is not a uniqueness constraint on stored SHA-256 blobs.

Reject incomplete enumeration, backend warnings, stderr diagnostics, nonzero exits, format mismatch, output truncation and missing/invalid CRCs. ZIP enumeration count must agree with the central directory; a validated empty ZIP is allowed. CLI stdout is capped without silently returning the captured prefix as a complete listing. CLI formats are forced from magic bytes, preventing embedded ZIP autodetection in RAR.

`UntrustworthyListingError` extends the existing corrupt-archive error so old callers still fail visibly; it does not itself implement M3/M7's opaque-container admission. Unsupported metadata remains conservative rather than pretending content is covered.

RAR extraction validates selected paths and rejects collisions/existing targets before writing. It uses only the caller's destination. Illegal-name transformation, global budgets, persistent caching and normalized ingestion are later milestones. Cancellation can be checked before synchronous decoder work; M3's worker lifecycle must handle interruption during long decoding.

## Password transport

RAR passwords remain library arguments in memory. For CLI 7z, write a password line to stdin and close it; do not put passwords in process arguments and do not pass an empty `-p` switch. Without a password, close stdin immediately so the process cannot hang on a prompt. CR/LF/NUL passwords cannot be represented by the console protocol and fail explicitly; the RAR library path does not have this transport restriction.

Never log plaintext passwords. Errors retain archive paths and reason codes, not the supplied password.

## Tests and sources

`tests/unpack/trust.spec.ts`, `unrar.spec.ts`, `archive-trust.spec.ts`, existing member/worker integration and password-vault suites cover the contract. Four tiny upstream MIT-licensed RAR fixtures are committed with provenance. The private M0 RAR is opt-in through `AVCA_INTAKE_FIXTURES`, pointing at copied fixtures, never the source directory.

- [Decoder API and generator requirements](https://github.com/YuJianrong/node-unrar.js/blob/master/README.md)
- [RARLAB source distribution and format notes](https://www.rarlab.com/rar_add.htm)
- License source: official `unrarsrc-6.1.7.tar.gz`, matching the source version used by the pinned wrapper.
