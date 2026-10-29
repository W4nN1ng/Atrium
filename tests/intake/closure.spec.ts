import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import yazl from 'yazl'
import { buildClosure } from '../../src/main/intake/closure'
import { ExpandCache } from '../../src/main/intake/expandCache'
import { intakeBudget } from '../../src/shared/constants'
import { buildRealUnitypackage, makeZip } from '../helpers/containers'

const roots: string[] = []
function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'avca-closure-')); roots.push(root)
  const source = path.join(root, 'source'); fs.mkdirSync(source)
  const cache = new ExpandCache({ root: path.join(root, 'cache') })
  return { root, source, cache, opts: { ...intakeBudget(0), cache, ownerId: root, extraBackendDirs: [path.resolve('resources/bin')] } }
}
async function zip(file: string, entries: [string, Buffer][]) {
  const archive = new yazl.ZipFile()
  for (const [name, bytes] of entries) archive.addBuffer(bytes, name)
  archive.end()
  await new Promise<void>((resolve, reject) => archive.outputStream.pipe(fs.createWriteStream(file)).on('finish', resolve).on('error', reject))
  return file
}
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }) })

describe('normalized intake closure', () => {
  it('recurses ZIP → 7z → ZIP → file by actual bytes and preserves its chain', async () => {
    const { source, opts } = setup()
    await zip(path.join(source, 'inner.zip'), [['叶.txt', Buffer.from('payload')]])
    makeZip(source, path.join(source, 'middle.7z'), ['inner.zip'], undefined, [], '7z')
    const outer = await zip(path.join(source, 'outer.zip'), [['misnamed.bin', fs.readFileSync(path.join(source, 'middle.7z'))]])
    const result = await buildClosure(outer, opts)
    expect(result.warnings).toEqual([]); expect(result.opaque).toBe(false)
    expect(result.leaves).toHaveLength(1)
    expect(result.leaves[0].chain.map(c => c.format)).toEqual(['zip', '7z', 'zip'])
    expect(fs.readFileSync(result.leaves[0].localPath!, 'utf8')).toBe('payload')
  })
  it('stops at a real unitypackage and retains repeated contents as separate leaves', async () => {
    const { source, opts } = setup()
    const pkg = await buildRealUnitypackage(path.join(source, 'a.unitypackage'))
    const outer = await zip(path.join(source, 'a.zip'), [['one.unitypackage', fs.readFileSync(pkg)], ['two.unitypackage', fs.readFileSync(pkg)]])
    const result = await buildClosure(outer, opts)
    expect(result.leaves.map(l => l.kind)).toEqual(['unitypackage', 'unitypackage'])
    expect(result.leaves[0].key).toEqual(result.leaves[1].key)
    expect(result.warnings).toEqual([])
  })
  it.each(['depth', 'entries', 'total', 'file'])('retains the complete raw container when %s budget is exceeded', async (budget) => {
    const { source, opts } = setup()
    const file = await zip(path.join(source, 'a.zip'), [['a.txt', Buffer.from('12345')], ['b.txt', Buffer.from('abc')]])
    const limited = { ...opts, ...({ depth: { maxDepth: 0 }, entries: { maxEntriesPerContainer: 1 }, total: { maxTotalBytes: 7 }, file: { maxFileBytes: 4 } }[budget]) }
    const result = await buildClosure(file, limited)
    expect(result.opaque).toBe(true); expect(result.warnings.join()).toMatch(/budget/)
    expect(result.leaves).toHaveLength(1); expect(result.leaves[0].localPath).toBe(file)
    expect(result.leaves[0].kind).toBe('opaque')
  })
  it('maps garbled and illegal Windows names to flat cache paths without losing their names', async () => {
    const { source, opts } = setup()
    const file = await zip(path.join(source, 'a.zip'), [['_Éαû╛Åæ.url', Buffer.from('[InternetShortcut]\nURL=https://example.com\n')], ['bad|dir/a.txt', Buffer.from('abc')]])
    const result = await buildClosure(file, opts)
    expect(result.warnings).toEqual([])
    expect(result.leaves.map(l => l.relPath).sort()).toEqual(['_Éαû╛Åæ.url', 'bad|dir/a.txt'].sort())
    expect(result.leaves.every(l => fs.existsSync(l.localPath!))).toBe(true)
  })
  it('keeps valid siblings and marks unreadable/reparse paths explicitly', async () => {
    const { source, opts } = setup()
    fs.writeFileSync(path.join(source, 'good.txt'), 'ok')
    fs.symlinkSync(source, path.join(source, 'loop'), 'junction')
    const result = await buildClosure(source, opts)
    expect(result.leaves).toHaveLength(1); expect(result.opaque).toBe(true)
    expect(result.unreadable).toHaveLength(1); expect(result.warnings.join()).toMatch(/reparse/)
  })
  it('retains corrupt archives and reports extension mismatches', async () => {
    const { source, opts } = setup()
    fs.writeFileSync(path.join(source, 'bad.zip'), Buffer.from('504b0304010203', 'hex'))
    fs.writeFileSync(path.join(source, 'fake.zip'), 'Entry not found')
    const result = await buildClosure(source, opts)
    expect(result.leaves).toHaveLength(2); expect(result.opaque).toBe(true)
    expect(result.warnings.join()).toMatch(/mismatch/)
  })
  it('propagates cancellation without turning it into an opaque success', async () => {
    const { source, opts } = setup(); const controller = new AbortController(); controller.abort()
    await expect(buildClosure(source, { ...opts, signal: controller.signal })).rejects.toThrow()
  })
  it('falls back only the inner container at the depth boundary', async () => {
    const { source, opts } = setup()
    const inner = await zip(path.join(source, 'inner.zip'), [['leaf.txt', Buffer.from('leaf')]])
    const outer = await zip(path.join(source, 'outer.zip'), [['inner.zip', fs.readFileSync(inner)], ['sibling.txt', Buffer.from('sibling')]])
    const result = await buildClosure(outer, { ...opts, maxDepth: 1 })
    expect(result.opaque).toBe(true); expect(result.leaves).toHaveLength(2)
    expect(result.leaves.map(l => l.kind).sort()).toEqual(['file', 'opaque'])
    expect(result.leaves.find(l => l.kind === 'opaque')!.chain).toHaveLength(1)
  })
  it('keeps a password-declined container raw and retries using the actual inner container', async () => {
    const { source, opts } = setup(); fs.writeFileSync(path.join(source, 'secret.txt'), 'secret')
    const encrypted = makeZip(source, path.join(source, 'encrypted.7z'), ['secret.txt'], undefined, ['-p1234', '-mhe=on'], '7z')
    const outer = await zip(path.join(source, 'outer.zip'), [['inner.7z', fs.readFileSync(encrypted)]])
    const declined = await buildClosure(outer, { ...opts, requestPassword: async () => null })
    expect(declined.opaque).toBe(true); expect(declined.leaves[0].kind).toBe('opaque')
    const prompted: string[] = []
    const unlocked = await buildClosure(outer, { ...opts, requestPassword: async file => { prompted.push(file); return '1234' } })
    expect(unlocked.warnings).toEqual([]); expect(unlocked.leaves).toHaveLength(1)
    expect(fs.readFileSync(unlocked.leaves[0].localPath!, 'utf8')).toBe('secret')
    expect(prompted).toHaveLength(1); expect(prompted[0]).not.toBe(outer)
  })
  it('keeps same-path ZIP entries as separate occurrences, including empty files', async () => {
    const { source, opts } = setup()
    const file = await zip(path.join(source, 'a.zip'), [['same.txt', Buffer.from('one')], ['same.txt', Buffer.from('two')], ['empty.bin', Buffer.alloc(0)]])
    const result = await buildClosure(file, opts)
    expect(result.warnings).toEqual([]); expect(result.leaves).toHaveLength(3)
    expect(result.leaves.filter(l => l.relPath === 'same.txt').map(l => fs.readFileSync(l.localPath!, 'utf8'))).toEqual(['one', 'two'])
    expect(result.leaves.find(l => l.relPath === 'empty.bin')!.key).toEqual({ size: 0, crc32: 0 })
  })
  it('preserves the original spelling of ZIP names including trailing spaces', async () => {
    const { source, opts } = setup()
    const file = await zip(path.join(source, 'a.zip'), [[' folder|/spaced.txt ', Buffer.from('payload')]])
    const result = await buildClosure(file, opts)
    expect(result.warnings).toEqual([])
    expect(result.leaves[0].relPath).toBe(' folder|/spaced.txt ')
    expect(fs.readFileSync(result.leaves[0].localPath!, 'utf8')).toBe('payload')
  })
  it('reuses an identical inner container while retaining both logical occurrences', async () => {
    const { source, opts } = setup()
    const inner = await zip(path.join(source, 'inner.zip'), [['a.txt', Buffer.from('payload')]])
    const bytes = fs.readFileSync(inner)
    const outer = await zip(path.join(source, 'outer.zip'), [['one.zip', bytes], ['two.zip', bytes]])
    const result = await buildClosure(outer, opts)
    expect(result.warnings).toEqual([]); expect(result.leaves).toHaveLength(2)
    expect(result.cacheKeys).toHaveLength(2)
    expect(result.leaves[0].localPath).toBe(result.leaves[1].localPath)
    expect(result.leaves[0].relPath).not.toBe(result.leaves[1].relPath)
  })
  it.skipIf(!process.env.AVCA_INTAKE_FIXTURES)('real 西装 RAR has exactly 13 unitypackage leaves including Sio', async () => {
    const { opts } = setup()
    const file = path.join(process.env.AVCA_INTAKE_FIXTURES!, 'A/衣服/西装/6447797.rar')
    const result = await buildClosure(file, opts)
    expect(result.warnings).toEqual([]); expect(result.opaque).toBe(false)
    expect(result.leaves).toHaveLength(13)
    expect(result.leaves.every(l => l.kind === 'unitypackage')).toBe(true)
    expect(result.leaves.some(l => l.relPath.includes('Sio'))).toBe(true)
    const directory = await buildClosure(path.dirname(file), opts)
    expect(directory.warnings).toEqual([])
    expect(directory.leaves.filter(l => l.kind === 'unitypackage')).toHaveLength(18)
  }, 180_000)
})
