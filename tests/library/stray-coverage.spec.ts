import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import yazl from 'yazl'
import { afterEach, describe, expect, it } from 'vitest'
import { matchStrayContents, projectStrayCoverage } from '../../src/main/library/strayCoverage'
import type { HealthReport } from '../../src/shared/types'
import type { ClosureSource } from '../../src/main/intake/match'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }) })
function setup() { const root = fs.mkdtempSync(path.join(os.tmpdir(), 'avca-health-content-')); roots.push(root); return root }
function item(file: string): HealthReport['strays'][number] { const st = fs.lstatSync(file); return { path: file, isDir: st.isDirectory(), entries: 1, sizeBytes: st.size } }
async function zip(file: string, entries: Array<[string, string | Buffer]>) {
  const archive = new yazl.ZipFile()
  for (const [name, content] of entries) archive.addBuffer(Buffer.from(content), name)
  archive.end()
  await new Promise<void>((resolve, reject) => archive.outputStream.pipe(fs.createWriteStream(file)).on('finish', resolve).on('error', reject))
  return file
}
const run = (root: string, files: string[]) => matchStrayContents(files.map(item), { cacheRoot: path.join(root, 'cache'), cacheNamespace: path.join(root, 'library.db'), extraBackendDirs: [path.resolve('resources/bin')] })

describe('M8 health content coverage', () => {
  it('different directory/member names and extra wrapper levels still match; sources are unchanged', async () => {
    const root = setup(), dir = path.join(root, '完全不同的目录'), nested = path.join(dir, 'shell')
    fs.mkdirSync(nested, { recursive: true }); fs.writeFileSync(path.join(nested, '乱码.url'), 'same bytes')
    const archive = await zip(path.join(root, 'download.zip'), [['original/readme.txt', 'same bytes']])
    const before = [archive, path.join(nested, '乱码.url')].map(p => ({ bytes: fs.readFileSync(p), mtime: fs.statSync(p).mtimeMs }))
    const result = await run(root, [archive, dir])
    expect(result.items.map(i => i.path)).toEqual([dir])
    expect(result.items[0].coveredArchives?.[0].evidence.matches[0]).toMatchObject({ leafRelPath: 'original/readme.txt', coveringRelPath: 'shell/乱码.url' })
    expect([archive, path.join(nested, '乱码.url')].map(p => ({ bytes: fs.readFileSync(p), mtime: fs.statSync(p).mtimeMs }))).toEqual(before)
  })
  it('same names with different bytes and partially covered archives stay separate', async () => {
    const root = setup(), dir = path.join(root, 'same'); fs.mkdirSync(dir)
    fs.writeFileSync(path.join(dir, 'a.txt'), 'different')
    const archive = await zip(path.join(root, 'same.zip'), [['a.txt', 'payload']])
    expect((await run(root, [dir, archive])).items).toHaveLength(2)
    fs.writeFileSync(path.join(dir, 'a.txt'), 'payload')
    await zip(archive, [['a.txt', 'payload'], ['missing.txt', 'missing']])
    expect((await run(root, [dir, archive])).items).toHaveLength(2)
  })
  it('supports union coverage by independent loose files with shared evidence', async () => {
    const root = setup(), a = path.join(root, 'a.unitypackage'), b = path.join(root, 'b.psd')
    fs.writeFileSync(a, 'aaa'); fs.writeFileSync(b, 'bbb')
    const archive = await zip(path.join(root, 'combined.zip'), [['renamed-a', 'aaa'], ['renamed-b', 'bbb']])
    const result = await run(root, [archive, a, b])
    expect(result.items.map(i => i.path).sort()).toEqual([a, b].sort())
    for (const representative of result.items) expect(representative.coveredArchives?.[0].evidence).toMatchObject({ coveredCount: 2, totalCount: 2 })
  })
  it('respects multiplicity and does not count overlapping directory views twice', async () => {
    const root = setup(), dir = path.join(root, 'dir'); fs.mkdirSync(dir)
    const file = path.join(dir, 'once.txt'); fs.writeFileSync(file, 'same')
    const archive = await zip(path.join(root, 'twice.zip'), [['one.txt', 'same'], ['two.txt', 'same']])
    expect((await run(root, [dir, file, archive])).items.some(i => i.path === archive)).toBe(true)
  })
  it('recurses nested containers but never expands unitypackage as material', async () => {
    const root = setup(), leaf = path.join(root, 'loose.unitypackage'); fs.writeFileSync(leaf, 'leaf bytes')
    const inner = await zip(path.join(root, 'inner.zip'), [['inside.unitypackage', 'leaf bytes']])
    const outer = await zip(path.join(root, 'outer.zip'), [['inner.zip', fs.readFileSync(inner)]])
    const result = await run(root, [leaf, outer])
    expect(result.items.map(i => i.path)).toEqual([leaf]); expect(result.items[0].coveredArchives?.[0].evidence.totalCount).toBe(1)
  })
  it('a directory containing only the archive cannot cover that archive', async () => {
    const root = setup(), dir = path.join(root, 'dir'); fs.mkdirSync(dir)
    const archive = await zip(path.join(dir, 'own.zip'), [['a.txt', 'payload']])
    const result = await run(root, [dir, archive])
    expect(result.items).toHaveLength(2)
  })
  it('keeps empty/corrupt containers, reports diagnostics, and accepts zero-byte leaves', async () => {
    const root = setup(), empty = path.join(root, 'empty.txt'); fs.writeFileSync(empty, '')
    const zeroZip = await zip(path.join(root, 'zero.zip'), [['empty.txt', '']])
    const emptyZip = await zip(path.join(root, 'empty.zip'), [])
    const corrupt = path.join(root, 'bad.zip'); fs.writeFileSync(corrupt, Buffer.from('504b03040102', 'hex'))
    const result = await run(root, [empty, zeroZip, emptyZip, corrupt])
    expect(result.items.map(i => i.path).sort()).toEqual([empty, emptyZip, corrupt].sort())
    expect(result.warnings.join()).toContain('opaque')
  })
  it('never follows a junction to obtain coverage', async () => {
    const root = setup(), target = path.join(root, 'target'), dir = path.join(root, 'dir')
    fs.mkdirSync(target); fs.mkdirSync(dir); fs.writeFileSync(path.join(target, 'a.txt'), 'payload')
    fs.symlinkSync(target, path.join(dir, 'link'), 'junction')
    const archive = await zip(path.join(root, 'a.zip'), [['a.txt', 'payload']])
    const result = await run(root, [dir, archive])
    expect(result.items).toHaveLength(2); expect(result.warnings.join()).toContain('reparse-point-not-followed')
  })
  it('does not hide a CRC/size collision or a listing without full SHA evidence', () => {
    const root = setup(), a = path.join(root, 'a.zip'), b = path.join(root, 'b')
    const source = (p: string, blobId?: string): ClosureSource => ({ sourcePath: p, kind: p === a ? 'archive' : 'directory', closure: { opaque: false, warnings: [], leaves: [{ key: { size: 4, crc32: 123 }, relPath: 'a', localPath: null, chain: [], blobId }] } })
    const items = [a, b].map(p => ({ path: p, isDir: p === b, entries: 1, sizeBytes: 4 }))
    expect(projectStrayCoverage(items, [source(b, 'b'.repeat(64))], [source(a, 'a'.repeat(64))]).items).toHaveLength(2)
    expect(projectStrayCoverage(items, [source(b)], [source(a)]).items).toHaveLength(2)
  })
})
