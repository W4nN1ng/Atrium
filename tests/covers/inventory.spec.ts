import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'
import { migrate, type Db } from '../../src/main/db'
import { makeAssetRow, upsertAsset } from '../../src/main/db/repos/asset'
import { buildPackageWithGuids, makeZip } from '../helpers/containers'
import { collectCoverSources } from '../../src/main/covers/inventory'

const A = 'a'.repeat(32), B = 'b'.repeat(32), C = 'c'.repeat(32)
let root: string, db: Db
beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'atrium-cover-inventory-')))
  db = new Database(path.join(root, 'isolated.sqlite')); migrate(db)
  upsertAsset(db, makeAssetRow({ id: 'card', name: 'Chocolate', raw_name: 'Chocolate', category: 'props' }))
})
afterEach(() => { db.close(); fs.rmSync(root, { recursive: true, force: true }) })
function location(library: string | null, source: string | null = null): void {
  db.prepare('UPDATE asset SET library_path = ?, source_path = ? WHERE id = ?').run(library, source, 'card')
}
function entry(guid: string, unityPath = 'Assets/Chocolate.prefab'): void {
  db.prepare('INSERT INTO package_entry(asset_id, guid, unity_path, entry_kind) VALUES (?, ?, ?, ?)')
    .run('card', guid, unityPath, /\.prefab$/i.test(unityPath) ? 'prefab' : 'png')
}
function log(id: string, created: unknown, overwritten: unknown, member: string | null,
  status = 'ok', project = 'project', container = 'card'): void {
  db.prepare(`INSERT INTO import_log(id, project_id, asset_id, container_asset_id, member_rel_path,
    created_guids_json, overwritten_json, unitypackage_path, status, kind)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'import')`).run(id, project, container === 'card' ? null : 'card',
    container, member, JSON.stringify(created), JSON.stringify(overwritten), path.join(root, 'deleted-extract', id + '.unitypackage'), status)
}
function relatedCard(id: string, rawName: string, file: string, parent: string | null, isBundle = 0): void {
  upsertAsset(db, makeAssetRow({ id, name: rawName, raw_name: rawName, category: 'props',
    library_path: file, parent_asset_id: parent, is_bundle: isBundle }))
}
async function scopeZip(entries: Array<{ member: string; guid: string }>): Promise<string> {
  const src = path.join(root, 'scoped-source')
  for (const row of entries) await buildPackageWithGuids(path.join(src, ...row.member.split('/')),
    [{ guid: row.guid, unityPath: 'Assets/Prop.prefab' }])
  return makeZip(src, path.join(root, 'Bundle.zip'), fs.readdirSync(src))
}

// Valid stored ZIP entries allow names that the Windows filesystem cannot create.
function metadataZip(file: string, entries: Array<{ name: string; bytes: Buffer }>): string {
  const local: Buffer[] = [], central: Buffer[] = []
  let offset = 0
  for (const { name, bytes } of entries) {
    const filename = Buffer.from(name, 'utf8')
    let crc = 0xffffffff
    for (const byte of bytes) {
      crc ^= byte
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
    }
    crc = (crc ^ 0xffffffff) >>> 0
    const header = Buffer.alloc(30)
    header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20, 4); header.writeUInt16LE(0x800, 6)
    header.writeUInt32LE(crc, 14); header.writeUInt32LE(bytes.length, 18); header.writeUInt32LE(bytes.length, 22)
    header.writeUInt16LE(filename.length, 26)
    const directory = Buffer.alloc(46)
    directory.writeUInt32LE(0x02014b50); directory.writeUInt16LE(20, 4); directory.writeUInt16LE(20, 6)
    directory.writeUInt16LE(0x800, 8); directory.writeUInt32LE(crc, 16)
    directory.writeUInt32LE(bytes.length, 20); directory.writeUInt32LE(bytes.length, 24)
    directory.writeUInt16LE(filename.length, 28); directory.writeUInt32LE(offset, 42)
    local.push(header, filename, bytes); central.push(directory, filename)
    offset += header.length + filename.length + bytes.length
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16)
  fs.writeFileSync(file, Buffer.concat([...local, directory, end]))
  return file
}

describe('read-only source inventory for automatic Unity covers', () => {
  it('uses exact cached GUIDs and prioritizes renderable source assets without writing the database', async () => {
    entry(C, 'Assets/Chocolate.png'); entry(A.toUpperCase()); entry('.'); entry('Chocolate')
    const before = db.prepare('SELECT total_changes() AS n').get()
    const result = await collectCoverSources(db, 'card', 'project')
    expect(result.sources).toEqual([{ guid: A, memberPath: null }, { guid: C, memberPath: null }])
    expect(db.prepare('SELECT total_changes() AS n').get()).toEqual(before)
  })

  it('collects created and overwritten GUIDs only from successful imports in the selected project', async () => {
    log('one', [A, A.toUpperCase(), 'invalid'], [B], 'Original/Chocolate.unitypackage')
    log('failed', [C], [], 'Failed.unitypackage', 'failed')
    log('other-project', [C], [], 'Other.unitypackage', 'ok', 'other')
    const result = await collectCoverSources(db, 'card', 'project')
    expect(result.sources).toEqual([
      { guid: A, memberPath: 'Original/Chocolate.unitypackage' },
      { guid: B, memberPath: 'Original/Chocolate.unitypackage' }
    ])
    // The recorded import path was temporary and has disappeared; GUID facts remain useful.
    expect(fs.existsSync(path.join(root, 'deleted-extract'))).toBe(false)
  })

  it('preserves a repeated GUID from different container members', async () => {
    log('one', [A], [], 'A/Prop.unitypackage'); log('two', [], [A], 'B/Prop.unitypackage')
    const result = await collectCoverSources(db, 'card', 'project')
    expect(result.sources).toEqual(expect.arrayContaining([
      { guid: A, memberPath: 'A/Prop.unitypackage' }, { guid: A, memberPath: 'B/Prop.unitypackage' }
    ]))
    expect(result.sources).toHaveLength(2)
  })

  it('never reopens an import extraction path even when another file now occupies it', async () => {
    log('one', [A], [], 'Original/Chocolate.unitypackage')
    await buildPackageWithGuids(path.join(root, 'deleted-extract', 'one.unitypackage'), [{ guid: C, unityPath: 'Assets/Unrelated.prefab' }])
    const result = await collectCoverSources(db, 'card', 'project')
    expect(result.sources).toEqual([{ guid: A, memberPath: 'Original/Chocolate.unitypackage' }])
  })

  it('reads the original dotted gzip/tar package when Unity imports were performed manually', async () => {
    const file = await buildPackageWithGuids(path.join(root, 'Chocolate.unitypackage'), [
      { guid: B, unityPath: 'Assets/Chocolate.png' }, { guid: A, unityPath: 'Assets/Chocolate.prefab' }
    ])
    location(file)
    const original = fs.readFileSync(file)
    const result = await collectCoverSources(db, 'card', 'project')
    expect(result.sources).toEqual([{ guid: A, memberPath: null }, { guid: B, memberPath: null }])
    expect(result.warnings).toEqual([]); expect(result.truncated).toBe(false)
    expect(fs.readFileSync(file)).toEqual(original)
    expect(db.prepare('SELECT COUNT(*) AS n FROM import_log').get()).toEqual({ n: 0 })
  })

  it('streams manually imported nested ZIP packages with exact member provenance, even when cache lacks it', async () => {
    const src = path.join(root, 'zip-source')
    await buildPackageWithGuids(path.join(src, '百奇', 'A.unitypackage'), [{ guid: A, unityPath: 'Assets/Pocky.prefab' }])
    await buildPackageWithGuids(path.join(src, '巧克力', 'B.unitypackage'), [
      { guid: A, unityPath: 'Assets/Pocky.prefab' }, { guid: B, unityPath: 'Assets/Chocolate.fbx' }
    ])
    fs.writeFileSync(path.join(src, 'unused.txt'), 'Never extract this unrelated member')
    const file = makeZip(src, path.join(root, 'Props.zip'), ['百奇', '巧克力', 'unused.txt'])
    entry(A); location(file)
    fs.rmSync(src, { recursive: true, force: true })
    const before = fs.readdirSync(root).sort()
    const result = await collectCoverSources(db, 'card', 'project')
    expect(result.sources).toEqual(expect.arrayContaining([
      { guid: A, memberPath: '百奇/A.unitypackage' },
      { guid: A, memberPath: '巧克力/B.unitypackage' },
      { guid: B, memberPath: '巧克力/B.unitypackage' }
    ]))
    expect(result.sources.some(s => s.memberPath === null && s.guid === A)).toBe(false)
    expect(result.warnings).toEqual([])
    expect(fs.readdirSync(root).sort()).toEqual(before)
  })

  it('uses the still-existing source when the archived library file is missing and explains the fallback', async () => {
    const file = await buildPackageWithGuids(path.join(root, 'original.unitypackage'), [{ guid: A, unityPath: 'Assets/Prop.prefab' }])
    location(path.join(root, 'missing.unitypackage'), file)
    const result = await collectCoverSources(db, 'card', 'project')
    expect(result.sources).toEqual([{ guid: A, memberPath: null }])
    expect(result.warnings).toContain('covers.sourceUnavailable')
  })

  it('falls back to the recorded ZIP inside an archived directory when manual Unity imports have no logs', async () => {
    const archived = path.join(root, '3867205百奇游戏')
    const src = path.join(root, 'zip-fallback-source')
    await buildPackageWithGuids(path.join(src, '百奇', 'Pocky.unitypackage'), [{ guid: A, unityPath: 'Assets/Pocky.prefab' }])
    const zip = makeZip(src, path.join(archived, '3867205百奇游戏.zip'), ['百奇'])
    location(archived, zip)
    const before = fs.readdirSync(archived)
    const result = await collectCoverSources(db, 'card', 'project')
    expect(result.sources).toEqual([{ guid: A, memberPath: '百奇/Pocky.unitypackage' }])
    expect(result.warnings).toEqual([])
    expect(fs.readdirSync(archived)).toEqual(before)
    expect(db.prepare('SELECT COUNT(*) AS n FROM import_log').get()).toEqual({ n: 0 })
  })

  it('does not rescan a source ZIP after the archived directory already provides a valid package inventory', async () => {
    const archived = path.join(root, 'Archived')
    await buildPackageWithGuids(path.join(archived, 'Pocky.unitypackage'), [{ guid: A, unityPath: 'Assets/Pocky.prefab' }])
    const src = path.join(root, 'other-source')
    await buildPackageWithGuids(path.join(src, 'Unrelated.unitypackage'), [{ guid: B, unityPath: 'Assets/Unrelated.prefab' }])
    log('known', [A], [], 'Pocky.unitypackage')
    location(archived, makeZip(src, path.join(root, 'source.zip'), ['Unrelated.unitypackage']))
    expect((await collectCoverSources(db, 'card', 'project')).sources).toEqual([{ guid: A, memberPath: 'Pocky.unitypackage' }])
  })

  it('walks directory containers with exact relative provenance and skips symlinks', async () => {
    const dir = path.join(root, 'Model.zip')
    await buildPackageWithGuids(path.join(dir, 'Nested', 'Prop.unitypackage'), [{ guid: A, unityPath: 'Assets/Prop.prefab' }])
    await buildPackageWithGuids(path.join(root, 'outside', 'Other.unitypackage'), [{ guid: B, unityPath: 'Assets/Other.prefab' }])
    fs.symlinkSync(path.join(root, 'outside'), path.join(dir, 'linked'), 'junction')
    location(dir)
    const result = await collectCoverSources(db, 'card', 'project')
    expect(result.sources).toEqual([{ guid: A, memberPath: 'Nested/Prop.unitypackage' }])
  })

  it('reports encrypted package members instead of starting password prompts or guessing names', async () => {
    const src = path.join(root, 'encrypted-source')
    await buildPackageWithGuids(path.join(src, 'Chocolate.unitypackage'), [{ guid: A, unityPath: 'Assets/Chocolate.prefab' }])
    location(makeZip(src, path.join(root, 'Encrypted.zip'), ['Chocolate.unitypackage'], undefined, ['-pfixture-pass']))
    const result = await collectCoverSources(db, 'card', 'project')
    expect(result.sources).toEqual([])
    expect(result.warnings).toContain('covers.sourceEncrypted')
  })

  it('rejects unsafe ZIP member paths without extracting or treating their GUIDs as candidates', async () => {
    const src = path.join(root, 'unsafe-source')
    await buildPackageWithGuids(path.join(src, 'xx', 'Prop.unitypackage'), [{ guid: A, unityPath: 'Assets/Prop.prefab' }])
    const file = makeZip(src, path.join(root, 'Unsafe.zip'), ['xx'])
    const bytes = fs.readFileSync(file)
    const safe = Buffer.from('xx/Prop.unitypackage'), unsafe = Buffer.from('../Prop.unitypackage')
    let replacements = 0
    for (let offset = bytes.indexOf(safe); offset >= 0; offset = bytes.indexOf(safe, offset + safe.length)) {
      unsafe.copy(bytes, offset); replacements++
    }
    expect(replacements).toBe(2) // Local and central filename records, with data CRC unchanged.
    fs.writeFileSync(file, bytes); location(file)
    const result = await collectCoverSources(db, 'card', 'project')
    expect(result.sources).toEqual([])
    expect(result.warnings).toContain('covers.sourceUnreadable')
    expect(fs.existsSync(path.join(root, 'Prop.unitypackage'))).toBe(false)
  })

  it('reports unreadable or unsupported sources while retaining factual imported GUIDs', async () => {
    const file = path.join(root, 'broken.unitypackage'); fs.writeFileSync(file, 'invalid gzip')
    location(file); log('one', [A], [], null, 'ok', 'project', 'direct')
    const result = await collectCoverSources(db, 'card', 'project')
    expect(result.sources).toEqual([{ guid: A, memberPath: null }])
    expect(result.warnings).toContain('covers.sourceUnreadable')
    location(path.join(root, 'Unknown.rar')); fs.writeFileSync(path.join(root, 'Unknown.rar'), 'Rar!')
    const unsupported = await collectCoverSources(db, 'card', 'project')
    expect(unsupported.warnings).toContain('covers.sourceUnsupported')
  })

  it('marks a capped source inventory as incomplete rather than silently losing matches', async () => {
    const insert = db.prepare('INSERT INTO package_entry(asset_id, guid, unity_path, entry_kind) VALUES (?, ?, ?, ?)')
    db.transaction(() => { for (let i = 0; i < 10001; i++) insert.run('card', i.toString(16).padStart(32, '0'), 'Assets/Prop.prefab', 'prefab') })()
    const result = await collectCoverSources(db, 'card', 'project')
    expect(result.sources.length).toBeLessThan(10001)
    expect(result.sources.length).toBeGreaterThan(0)
    expect(result.truncated).toBe(true)
    expect(result.warnings).toContain('covers.inventoryLimited')
  })

  it('caps the number of ZIP packages and reports that unscanned members may contain more matches', async () => {
    const src = path.join(root, 'many-packages')
    const packageFile = await buildPackageWithGuids(path.join(src, '00.unitypackage'), [{ guid: A, unityPath: 'Assets/Prop.prefab' }])
    for (let i = 1; i < 33; i++) fs.copyFileSync(packageFile, path.join(src, i.toString().padStart(2, '0') + '.unitypackage'))
    location(makeZip(src, path.join(root, 'Many.zip'), ['*.unitypackage']))
    const result = await collectCoverSources(db, 'card', 'project')
    expect(result.sources).toHaveLength(32)
    expect(result.truncated).toBe(true)
    expect(result.warnings).toContain('covers.inventoryLimited')
  })

  it('rejects cancellation after scanning starts and does not create extraction files', async () => {
    const file = await buildPackageWithGuids(path.join(root, 'Prop.unitypackage'), [{ guid: A, unityPath: 'Assets/Prop.prefab' }])
    location(file)
    const before = fs.readdirSync(root).sort()
    const controller = new AbortController()
    const result = collectCoverSources(db, 'card', 'project', controller.signal)
    setImmediate(() => controller.abort())
    await expect(result).rejects.toThrow('covers.cancelled')
    expect(fs.readdirSync(root).sort()).toEqual(before)
  })

  it('honors cancellation without returning a partial inventory as complete', async () => {
    const controller = new AbortController(); controller.abort()
    await expect(collectCoverSources(db, 'card', 'project', controller.signal)).rejects.toThrow('covers.cancelled')
  })

  it('limits a bundle child sharing the parent ZIP to its exact member and keeps root container scans complete', async () => {
    const file = await scopeZip([{ member: 'A.unitypackage', guid: A }, { member: 'B.unitypackage', guid: B }])
    relatedCard('bundle', 'Bundle.zip', file, null, 1)
    relatedCard('card', 'A.unitypackage', file, 'bundle')
    relatedCard('sibling', 'B.unitypackage', file, 'bundle')
    db.prepare('INSERT INTO package_entry(asset_id,guid,unity_path) VALUES(?,?,?)').run('bundle', B, 'Assets/Other.prefab')
    expect((await collectCoverSources(db, 'card', 'project')).sources).toEqual([{ guid: A, memberPath: 'A.unitypackage' }])
    expect((await collectCoverSources(db, 'bundle', 'project')).sources).toEqual(expect.arrayContaining([
      { guid: A, memberPath: 'A.unitypackage' }, { guid: B, memberPath: 'B.unitypackage' }
    ]))
  })

  it('limits a logical bundle child to its own version members while a selected version sees only itself', async () => {
    const file = await scopeZip([{ member: 'Group/A1.unitypackage', guid: A },
      { member: 'Group/A2.unitypackage', guid: B }, { member: 'Sibling/C.unitypackage', guid: C }])
    relatedCard('bundle', 'Bundle.zip', file, null, 1)
    relatedCard('card', 'Group', file, 'bundle')
    relatedCard('v1', 'A1.unitypackage', file, 'card'); relatedCard('v2', 'A2.unitypackage', file, 'card')
    relatedCard('sibling', 'Sibling', file, 'bundle')
    expect((await collectCoverSources(db, 'card', 'project')).sources).toEqual([
      { guid: A, memberPath: 'Group/A1.unitypackage' }, { guid: B, memberPath: 'Group/A2.unitypackage' }
    ])
    expect((await collectCoverSources(db, 'v1', 'project')).sources).toEqual([{ guid: A, memberPath: 'Group/A1.unitypackage' }])
  })

  it('refuses ambiguous child basenames rather than returning either sibling package as a candidate', async () => {
    const file = await scopeZip([{ member: 'One/Same.unitypackage', guid: A }, { member: 'Two/Same.unitypackage', guid: B }])
    relatedCard('bundle', 'Bundle.zip', file, null, 1); relatedCard('card', 'Same.unitypackage', file, 'bundle')
    const result = await collectCoverSources(db, 'card', 'project')
    expect(result.sources).toEqual([])
    expect(result.warnings).toContain('covers.sourceUnreadable')
  })

  it('refuses a child basename that appears at both ZIP root and in another directory', async () => {
    const file = await scopeZip([{ member: 'Same.unitypackage', guid: A }, { member: 'Two/Same.unitypackage', guid: B }])
    relatedCard('bundle', 'Bundle.zip', file, null, 1); relatedCard('card', 'Same.unitypackage', file, 'bundle')
    const result = await collectCoverSources(db, 'card', 'project')
    expect(result.sources).toEqual([])
    expect(result.warnings).toContain('covers.sourceUnreadable')
  })

  it('does not infer unique child identity from a ZIP listing that skips an oversized filename', async () => {
    const a = await buildPackageWithGuids(path.join(root, 'a.unitypackage'), [{ guid: A, unityPath: 'Assets/A.prefab' }])
    const b = await buildPackageWithGuids(path.join(root, 'b.unitypackage'), [{ guid: B, unityPath: 'Assets/B.prefab' }])
    const file = metadataZip(path.join(root, 'LongNames.zip'), [
      { name: 'Same.unitypackage', bytes: fs.readFileSync(a) },
      { name: 'q'.repeat(4096) + '/Same.unitypackage', bytes: fs.readFileSync(b) }
    ])
    relatedCard('bundle', 'Bundle.zip', file, null, 1); relatedCard('card', 'Same.unitypackage', file, 'bundle')
    const result = await collectCoverSources(db, 'card', 'project')
    expect(result.sources).toEqual([])
    expect(result.warnings).toContain('covers.sourceUnreadable')
  })

  it('refuses ambiguous version paths assembled from parent basenames at root and in another directory', async () => {
    const file = await scopeZip([{ member: 'Group/A1.unitypackage', guid: A },
      { member: 'Other/Group/A1.unitypackage', guid: B }])
    relatedCard('bundle', 'Bundle.zip', file, null, 1)
    relatedCard('card', 'Group', file, 'bundle'); relatedCard('v1', 'A1.unitypackage', file, 'card')
    const result = await collectCoverSources(db, 'v1', 'project')
    expect(result.sources).toEqual([])
    expect(result.warnings).toContain('covers.sourceUnreadable')
  })

  it('retains explicitly owned child import facts when its shared archive disappeared but rejects contradictory or sibling logs', async () => {
    const file = path.join(root, 'MissingBundle.zip')
    relatedCard('bundle', 'Bundle.zip', file, null, 1); relatedCard('card', 'A.unitypackage', file, 'bundle')
    relatedCard('sibling', 'B.unitypackage', file, 'bundle')
    const insert = db.prepare(`INSERT INTO import_log(id,project_id,asset_id,container_asset_id,member_rel_path,
      created_guids_json,overwritten_json,status,kind) VALUES(?,'project',?,?,?,?,'[]','ok','import')`)
    insert.run('owned', 'card', 'card', 'A.unitypackage', JSON.stringify([A]))
    insert.run('contradiction', 'card', 'card', 'B.unitypackage', JSON.stringify([B]))
    insert.run('sibling-owned', 'sibling', 'card', 'A.unitypackage', JSON.stringify([C]))
    const result = await collectCoverSources(db, 'card', 'project')
    expect(result.sources).toEqual([{ guid: A, memberPath: 'A.unitypackage' }])
    expect(result.warnings).toContain('covers.sourceUnavailable')
    expect(fs.existsSync(file)).toBe(false)
  })

  it('checks exact log ownership and member association for a child rather than trusting its container ID', async () => {
    const file = await scopeZip([{ member: 'A.unitypackage', guid: A }, { member: 'B.unitypackage', guid: B }])
    relatedCard('bundle', 'Bundle.zip', file, null, 1); relatedCard('card', 'A.unitypackage', file, 'bundle')
    relatedCard('sibling', 'B.unitypackage', file, 'bundle')
    const insert = db.prepare(`INSERT INTO import_log(id,project_id,asset_id,container_asset_id,member_rel_path,
      created_guids_json,overwritten_json,status,kind) VALUES(?,'project',?,?,?,?,'[]','ok','import')`)
    insert.run('sibling-owned', 'sibling', 'card', 'B.unitypackage', JSON.stringify([B]))
    insert.run('contradictory-member', 'card', 'bundle', 'B.unitypackage', JSON.stringify([C]))
    insert.run('parent-owned-selected-member', 'bundle', 'bundle', 'A.unitypackage', JSON.stringify([A]))
    expect((await collectCoverSources(db, 'card', 'project')).sources).toEqual([{ guid: A, memberPath: 'A.unitypackage' }])
  })

  it('keeps an independently stored child source unrestricted instead of treating its display label as an archive member', async () => {
    const file = await scopeZip([{ member: 'A.unitypackage', guid: A }])
    relatedCard('bundle', 'Bundle.zip', path.join(root, 'different-container.zip'), null, 1)
    relatedCard('card', 'A display label', file, 'bundle')
    expect((await collectCoverSources(db, 'card', 'project')).sources).toEqual([{ guid: A, memberPath: 'A.unitypackage' }])
  })
})
