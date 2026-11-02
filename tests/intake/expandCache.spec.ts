import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import Database from 'better-sqlite3'
import { afterEach, describe, expect, it } from 'vitest'
import { ExpandCache, EXPAND_CACHE_TTL_MS } from '../../src/main/intake/expandCache'
import { fileIdentity } from '../../src/main/intake/identity'
import { pruneIntakeCache } from '../../src/main/intake/lifecycle'

const roots: string[] = []
function setup(options: { maxBytes?: number; freeBytes?: () => number; now?: () => number } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'avca-cache-')); roots.push(root)
  return { root, cache: new ExpandCache({ root, ...options }) }
}
const hash = (text: string) => createHash('sha256').update(text).digest('hex')
async function add(cache: ExpandCache, owner: string, content = '12345678', producer?: (dest: string) => Promise<void>) {
  const source = path.join(cache.root, 'test-source'); fs.writeFileSync(source, content)
  const identity = await fileIdentity(source); fs.unlinkSync(source)
  return cache.materialize(hash(content), owner, [{ originalPath: 'bad|dir/source.txt', key: identity.key, file: '00000000.bin' }], producer ?? (async dest => { fs.writeFileSync(path.join(dest, '00000000.bin'), content) }))
}
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }) })
describe('persistent expansion cache', () => {
  it('reuses a verified container after reopening and preserves its original names', async () => {
    const { root, cache } = setup(); const first = await add(cache, 'plan-1')
    const second = await add(new ExpandCache({ root }), 'plan-2', '12345678', async () => { throw new Error('must not extract again') })
    expect(second).toEqual(first); expect(second.members[0].originalPath).toBe('bad|dir/source.txt')
  })
  it('refuses changed cached bytes rather than silently returning them', async () => {
    const { cache } = setup(); const result = await add(cache, 'plan')
    fs.writeFileSync(result.members[0].localPath, '87654321')
    await expect(cache.locate(result.key, 'plan')).rejects.toThrow(/integrity/)
  })
  it('preflights disk space before invoking a producer', async () => {
    const { cache } = setup({ freeBytes: () => 0 }); let invoked = false
    await expect(add(cache, 'plan', '12345678', async () => { invoked = true })).rejects.toThrow(/space/)
    expect(invoked).toBe(false); expect(fs.readdirSync(path.join(cache.root, 'staging'))).toEqual([])
  })
  it('preserves referenced objects under quota pressure, evicts unreferenced LRU after release', async () => {
    const { cache } = setup({ maxBytes: 8 }); const first = await add(cache, 'one')
    await expect(add(cache, 'two', 'abcdefgh')).rejects.toThrow(/space/)
    expect(fs.existsSync(first.members[0].localPath)).toBe(true)
    await cache.release('one'); const second = await add(cache, 'two', 'abcdefgh')
    expect(fs.existsSync(first.members[0].localPath)).toBe(false); expect(fs.existsSync(second.members[0].localPath)).toBe(true)
  })
  it('cleans unreferenced stale objects and protects DB-referenced restart data', async () => {
    let now = 1; const { cache } = setup({ now: () => now }); const result = await add(cache, 'old')
    await cache.release('old'); now += EXPAND_CACHE_TTL_MS + 1
    const db = new Database(':memory:')
    try {
      db.exec('CREATE TABLE intake_plan(status TEXT, plan_json TEXT, progress_json TEXT)')
      db.prepare('INSERT INTO intake_plan VALUES(?,?,?)').run('cancelled', JSON.stringify({ cacheKeys: [result.key] }), null)
      await pruneIntakeCache(db, cache); expect(fs.existsSync(result.members[0].localPath)).toBe(true)
      db.exec("UPDATE intake_plan SET status='completed'")
      await pruneIntakeCache(db, cache); expect(fs.existsSync(result.members[0].localPath)).toBe(false)
    } finally { db.close() }
  })
  it('retains everything if persisted references are malformed', async () => {
    let now = 1; const { cache } = setup({ now: () => now }); const result = await add(cache, 'old'); await cache.release('old'); now += EXPAND_CACHE_TTL_MS + 1
    const db = new Database(':memory:')
    try {
      db.exec('CREATE TABLE intake_plan(status TEXT, plan_json TEXT, progress_json TEXT)')
      db.prepare('INSERT INTO intake_plan VALUES(?,?,?)').run('running', '{}', null)
      await expect(pruneIntakeCache(db, cache)).rejects.toThrow(/references/)
      expect(fs.existsSync(result.members[0].localPath)).toBe(true)
    } finally { db.close() }
  })
  it('cleans a failed extraction and never publishes unchecked/partial members', async () => {
    const { cache } = setup()
    await expect(add(cache, 'failed', '12345678', async dest => { fs.writeFileSync(path.join(dest, '00000000.bin'), 'partial'); throw new Error('failure') })).rejects.toThrow('failure')
    expect(fs.readdirSync(path.join(cache.root, 'objects'))).toEqual([])
    expect(fs.readdirSync(path.join(cache.root, 'staging'))).toEqual([])
    await expect(add(cache, 'retry')).resolves.toBeDefined()
  })
  it('serializes competing writers and never re-extracts a complete object', async () => {
    const { cache } = setup(); let writes = 0
    const source = path.join(cache.root, 'test-source'); fs.writeFileSync(source, '12345678'); const identity = await fileIdentity(source); fs.unlinkSync(source)
    const run = (owner: string) => cache.materialize(identity.sha256, owner, [{ originalPath: 'a', key: identity.key, file: '00000000.bin' }], async dest => { writes++; fs.writeFileSync(path.join(dest, '00000000.bin'), '12345678') })
    const [a, b] = await Promise.all([run('one'), run('two')]); expect(writes).toBe(1); expect(a).toEqual(b)
  })
  it('rejects cache roots outside temp, unowned roots, and junctions', async () => {
    expect(() => new ExpandCache({ root: process.cwd() })).toThrow(/temp/)
    const { root } = setup(); const target = path.join(root, 'other'); fs.mkdirSync(target); fs.writeFileSync(path.join(target, 'keep'), 'safe')
    expect(() => new ExpandCache({ root: target })).toThrow(/owned/)
    const link = path.join(root, 'link'); fs.symlinkSync(target, link, 'junction')
    expect(() => new ExpandCache({ root: link })).toThrow(/reparse/)
    expect(fs.readFileSync(path.join(target, 'keep'), 'utf8')).toBe('safe')
  })
  it('uses a full CRC32 and SHA-256, including empty files and late-byte changes', async () => {
    const { root } = setup(); const file = path.join(root, 'identity'); fs.writeFileSync(file, '123456789')
    expect((await fileIdentity(file)).key).toEqual({ size: 9, crc32: 0xcbf43926 })
    fs.writeFileSync(file, ''); expect((await fileIdentity(file)).key).toEqual({ size: 0, crc32: 0 })
    const bytes = Buffer.alloc(100_000); fs.writeFileSync(file, bytes); const before = await fileIdentity(file)
    bytes[bytes.length - 1] = 1; fs.writeFileSync(file, bytes); const after = await fileIdentity(file)
    expect(before.key).not.toEqual(after.key); expect(before.sha256).not.toBe(after.sha256)
  })
  it('does not publish a member with the right size and wrong CRC', async () => {
    const { cache } = setup()
    await expect(add(cache, 'plan', '12345678', async dest => { fs.writeFileSync(path.join(dest, '00000000.bin'), 'abcdefgh') })).rejects.toThrow(/integrity/)
    expect(fs.readdirSync(path.join(cache.root, 'objects'))).toEqual([])
    expect(fs.readdirSync(path.join(cache.root, 'staging'))).toEqual([])
  })
  it('cleans cancelled work while keeping already-published references', async () => {
    const { cache } = setup(); const first = await add(cache, 'plan'); const controller = new AbortController()
    const source = path.join(cache.root, 'test-source'); fs.writeFileSync(source, 'abcdefgh'); const id = await fileIdentity(source); fs.unlinkSync(source)
    await expect(cache.materialize(id.sha256, 'plan', [{ originalPath: 'b', file: '00000000.bin', key: id.key }], async dest => {
      fs.writeFileSync(path.join(dest, '00000000.bin'), 'abcdefgh'); controller.abort()
    }, controller.signal)).rejects.toThrow()
    expect(fs.existsSync(first.members[0].localPath)).toBe(true)
    expect(fs.readdirSync(path.join(cache.root, 'staging'))).toEqual([])
  })
  it('honors young dead-process leases and retires them after the retention window', async () => {
    let now = 1; const { cache, root } = setup({ now: () => now }); const item = await add(cache, 'dead')
    const reference = path.join(root, 'refs', `${hash('dead')}.json`)
    const value = JSON.parse(fs.readFileSync(reference, 'utf8')); value.pid = 99999999; fs.writeFileSync(reference, JSON.stringify(value))
    await cache.prune(); expect(fs.existsSync(item.members[0].localPath)).toBe(true)
    now += EXPAND_CACHE_TTL_MS + 1; await cache.prune()
    expect(fs.existsSync(item.members[0].localPath)).toBe(false)
  })
  it('isolates cache cleanup between different database namespaces', async () => {
    const { root } = setup()
    const one = new ExpandCache({ namespace: path.join(root, 'one.db') })
    const two = new ExpandCache({ namespace: path.join(root, 'two.db') })
    // Register only these exact generated subtrees for the test cleanup.
    roots.push(one.root, two.root)
    expect(one.root).not.toBe(two.root)
    const item = await add(one, 'active')
    await two.prune()
    expect(fs.existsSync(item.members[0].localPath)).toBe(true)
  })
})
