import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'
import { randomBytes } from 'node:crypto'
import { getEventListeners } from 'node:events'
import Database from 'better-sqlite3'
import { migrate, type Db } from '../../src/main/db'
import { makeAssetRow, upsertAsset } from '../../src/main/db/repos/asset'
import { makeZip } from '../helpers/containers'
import { preparePackageSources } from '../../src/main/covers/packageSource'

const A = 'a'.repeat(32), B = 'b'.repeat(32), C = 'c'.repeat(32)
let root: string, db: Db, destination: string
interface Resource { guid: string; unityPath: string; bytes?: Buffer | string; meta?: string }
interface TarFile { name: string; bytes: Buffer; type?: string; link?: string; size?: number }
function archive(file: string, entries: TarFile[]): string {
  const chunks: Buffer[] = []
  for (const entry of entries) {
    const header = Buffer.alloc(512)
    header.write(entry.name, 0, 100); header.write('0000644\0', 100, 8)
    header.write('0000000\0', 108, 8); header.write('0000000\0', 116, 8)
    header.write((entry.size ?? entry.bytes.length).toString(8).padStart(11, '0') + '\0', 124, 12)
    header.write('00000000000\0', 136, 12); header.fill(32, 148, 156)
    header.write(entry.type ?? '0', 156, 1); header.write(entry.link ?? '', 157, 100)
    header.write('ustar\0', 257, 6); header.write('00', 263, 2)
    const sum = header.reduce((total, value) => total + value, 0)
    header.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 8)
    chunks.push(header, entry.bytes, Buffer.alloc((512 - entry.bytes.length % 512) % 512))
  }
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, zlib.gzipSync(Buffer.concat([...chunks, Buffer.alloc(1024)])))
  return file
}
function packageFile(file: string, resources: Resource[], extra: TarFile[] = []): string {
  return archive(file, [...resources.flatMap(resource => [
    // Real packages need not put pathname before the asset body.
    { name: './' + resource.guid + '/asset', bytes: Buffer.from(resource.bytes ?? '%YAML 1.1\n--- !u!1 &1\nGameObject:\n  m_Name: Prop\n') },
    { name: './' + resource.guid + '/asset.meta', bytes: Buffer.from(resource.meta ?? `fileFormatVersion: 2\nguid: ${resource.guid}\nDefaultImporter:\n  userData: preserved\n`) },
    { name: './' + resource.guid + '/pathname', bytes: Buffer.from(resource.unityPath) }
  ]), ...extra])
}
function location(file: string, id = 'card'): void {
  db.prepare('UPDATE asset SET library_path = ? WHERE id = ?').run(file, id)
}
function ownedProject(name: string): string {
  const projectPath = path.join(root, name)
  const assets = path.join(projectPath, 'Assets')
  fs.mkdirSync(assets, { recursive: true })
  fs.writeFileSync(path.join(projectPath, '.atrium-cover-preview.json'), JSON.stringify({
    kind: 'atrium-package-preview', version: 1, projectPath: fs.realpathSync(projectPath)
  }))
  return assets
}
function files(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => entry.isDirectory()
    ? files(path.join(dir, entry.name)).map(file => entry.name + '/' + file) : [entry.name]).sort()
}
beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'atrium-package-source-')))
  db = new Database(path.join(root, 'isolated.sqlite')); migrate(db)
  upsertAsset(db, makeAssetRow({ id: 'card', name: 'Prop', raw_name: 'Prop', category: 'props' }))
  destination = ownedProject('preview')
})
afterEach(() => { db.close(); fs.rmSync(root, { recursive: true, force: true }) })

describe('owned, read-only package render resource preparation', () => {
  it('preserves exact FBX, material, texture and valid metadata bytes without writing source or inventory', async () => {
    const meta = `fileFormatVersion: 2\nguid: ${A}\nModelImporter:\n  externalObjects: {}\n  globalScale: 0.01\n`
    const fbx = Buffer.from('Kaydara FBX Binary  \0\x1a\0actual-model-bytes')
    const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 5, 4, 3, 2])
    const material = '%YAML 1.1\n--- !u!21 &2100000\nMaterial:\n  m_Name: Chocolate\n'
    const source = packageFile(path.join(root, 'Prop.unitypackage'), [
      { guid: A, unityPath: 'Assets/Props/Prop.fbx', bytes: fbx, meta },
      { guid: B, unityPath: 'Assets/Props/Chocolate.mat', bytes: material },
      { guid: C, unityPath: 'Assets/Props/Chocolate.png', bytes: png }
    ])
    location(source)
    const original = fs.readFileSync(source), changes = db.prepare('SELECT total_changes() AS n').get()
    const result = await preparePackageSources(db, 'card', destination)
    expect(fs.readFileSync(path.join(destination, 'Props/Prop.fbx'))).toEqual(fbx)
    expect(fs.readFileSync(path.join(destination, 'Props/Prop.fbx.meta'), 'utf8')).toBe(meta)
    expect(fs.readFileSync(path.join(destination, 'Props/Chocolate.mat'), 'utf8')).toBe(material)
    expect(fs.readFileSync(path.join(destination, 'Props/Chocolate.png'))).toEqual(png)
    expect(result.guids).toEqual([A, B, C]); expect(result.memberPaths).toEqual({ [A]: [], [B]: [], [C]: [] })
    expect(result.warnings).toEqual([]); expect(result.fingerprint).toMatch(/^[a-f0-9]{64}$/)
    expect(result.sourceFiles?.map(stamp => stamp.path)).toEqual([source])
    expect(fs.readFileSync(source)).toEqual(original)
    expect(db.prepare('SELECT total_changes() AS n').get()).toEqual(changes)
  })

  it('never writes scripts, managed or native plugins, executable files, assembly definitions, or scriptable assets', async () => {
    const excluded = ['Editor/Supplier.cs', 'Supplier.dll', 'Native.so', 'Native.dylib', 'Tool.exe', 'Tool.cmd',
      'Supplier.asmdef', 'Supplier.asmref', 'Animation.controller', 'Animation.anim', 'Scene.unity', 'Model.blend']
    const resources = excluded.map((name, i) => ({ guid: i.toString(16).padStart(32, '0'), unityPath: 'Assets/' + name, bytes: 'supplier-code' }))
    resources.push({ guid: B, unityPath: 'Assets/Settings.asset', bytes: '%YAML 1.1\n--- !u!114 &11400000\nMonoBehaviour:\n  m_Script: {}\n' })
    const source = packageFile(path.join(root, 'Prop.unitypackage'), [
      { guid: A, unityPath: 'Assets/Prop.prefab' }, ...resources
    ])
    location(source)
    const result = await preparePackageSources(db, 'card', destination)
    expect(files(destination)).toEqual(['Prop.prefab', 'Prop.prefab.meta'])
    expect(result.guids).toEqual([A])
  })

  it('copies typed mesh and texture assets and shader includes', async () => {
    const source = packageFile(path.join(root, 'Prop.unitypackage'), [
      { guid: A, unityPath: 'Assets/PropMesh.asset', bytes: '%YAML 1.1\n--- !u!43 &4300000\nMesh:\n  m_Name: Prop\n' },
      { guid: B, unityPath: 'Assets/Texture.asset', bytes: '%YAML 1.1\n--- !u!28 &2800000\nTexture2D:\n  m_Name: Texture\n' },
      { guid: C, unityPath: 'Assets/Toon.hlsl', bytes: 'float4 frag() { return 1; }' }
    ])
    location(source)
    expect((await preparePackageSources(db, 'card', destination)).guids).toEqual([A, B, C])
    expect(files(destination)).toHaveLength(6)
  })

  it('preserves a mesh with UTF-8 text crossing the retained prefix boundary', async () => {
    const mesh = '%YAML 1.1\n--- !u!43 &4300000\nMesh:\n  m_Name: '.padEnd(255, 'a') + '熊\n'
    location(packageFile(path.join(root, 'Prop.unitypackage'), [{ guid: A, unityPath: 'Assets/Mesh.asset', bytes: mesh }]))
    expect((await preparePackageSources(db, 'card', destination)).guids).toEqual([A])
    expect(fs.readFileSync(path.join(destination, 'Mesh.asset'), 'utf8')).toBe(mesh)
  })

  it('excludes scriptable classes after the buffered YAML head rather than importing the first class only', async () => {
    const unsafe = '%YAML 1.1\n--- !u!43 &4300000\nMesh:\n' + '  padding: value\n'.repeat(6000) +
      '--- !u!114 &11400000\nMonoBehaviour:\n  m_Script: {}\n'
    location(packageFile(path.join(root, 'Prop.unitypackage'), [
      { guid: A, unityPath: 'Assets/Prop.prefab' }, { guid: B, unityPath: 'Assets/Unsafe.asset', bytes: unsafe }
    ]))
    expect((await preparePackageSources(db, 'card', destination)).guids).toEqual([A])
    expect(files(destination)).toEqual(['Prop.prefab', 'Prop.prefab.meta'])
  })

  it('deduplicates identical repeated tar entries without retrying an exclusive output write', async () => {
    const resource = { guid: A, unityPath: 'Assets/Prop.prefab', bytes: 'same' }
    location(packageFile(path.join(root, 'Prop.unitypackage'), [resource, resource]))
    expect((await preparePackageSources(db, 'card', destination)).guids).toEqual([A])
    expect(files(destination)).toEqual(['Prop.prefab', 'Prop.prefab.meta'])
  })

  it('accepts ordinary folder records without importing unrelated folder metadata as render candidates', async () => {
    location(packageFile(path.join(root, 'Prop.unitypackage'), [{ guid: A, unityPath: 'Assets/Props/Prop.prefab' }], [
      { name: './' + B + '/pathname', bytes: Buffer.from('Assets/Props') },
      { name: './' + B + '/asset.meta', bytes: Buffer.from(`fileFormatVersion: 2\nguid: ${B}\nfolderAsset: yes\nDefaultImporter:\n`) }
    ]))
    expect((await preparePackageSources(db, 'card', destination)).guids).toEqual([A])
    expect(files(destination)).toEqual(['Props/Prop.prefab', 'Props/Prop.prefab.meta'])
  })

  it('accepts real-package root and GUID directory tar records', async () => {
    location(packageFile(path.join(root, 'Prop.unitypackage'), [{ guid: A, unityPath: 'Assets/Prop.prefab' }], [
      { name: './', type: '5', bytes: Buffer.alloc(0) },
      { name: './' + A + '/', type: '5', bytes: Buffer.alloc(0) }
    ]))
    expect((await preparePackageSources(db, 'card', destination)).guids).toEqual([A])
    expect(files(destination)).toEqual(['Prop.prefab', 'Prop.prefab.meta'])
  })

  it('explains skipped binary assets rather than trusting native importer metadata to prove their type', async () => {
    location(packageFile(path.join(root, 'Prop.unitypackage'), [
      { guid: A, unityPath: 'Assets/Prop.prefab' },
      { guid: B, unityPath: 'Assets/Unknown.asset', bytes: Buffer.from([0, 1, 2, 3, 4]),
        meta: `fileFormatVersion: 2\nguid: ${B}\nNativeFormatImporter:\n  mainObjectFileID: 4300000\n` }
    ]))
    const result = await preparePackageSources(db, 'card', destination)
    expect(result.guids).toEqual([A]); expect(result.warnings).toContain('covers.packageAssetUnsupported')
    expect(files(destination)).toEqual(['Prop.prefab', 'Prop.prefab.meta'])
  })

  it('extracts only the inventory-owned child member despite an identical sibling GUID and basename', async () => {
    const src = path.join(root, 'zip-source')
    packageFile(path.join(src, 'A/Prop.unitypackage'), [{ guid: A, unityPath: 'Assets/Owned.prefab', bytes: 'owned' }])
    packageFile(path.join(src, 'B/Prop.unitypackage'), [{ guid: A, unityPath: 'Assets/Sibling.prefab', bytes: 'sibling' }])
    const zip = makeZip(src, path.join(root, 'Bundle.zip'), ['A', 'B'])
    upsertAsset(db, makeAssetRow({ id: 'bundle', name: 'Bundle', raw_name: 'Bundle.zip', category: 'props', library_path: zip, is_bundle: 1 }))
    db.prepare('UPDATE asset SET parent_asset_id = ?, raw_name = ? WHERE id = ?').run('bundle', 'A/Prop.unitypackage', 'card')
    location(zip)
    const result = await preparePackageSources(db, 'card', destination)
    expect(files(destination)).toEqual(['Owned.prefab', 'Owned.prefab.meta'])
    expect(result.memberPaths).toEqual({ [A]: ['A/Prop.unitypackage'] })
    expect(result.sourceFiles?.map(stamp => stamp.path)).toEqual([zip])
  })

  it('refuses ambiguous child basenames rather than importing either ZIP sibling', async () => {
    const src = path.join(root, 'zip-source')
    packageFile(path.join(src, 'A/Prop.unitypackage'), [{ guid: A, unityPath: 'Assets/A.prefab' }])
    packageFile(path.join(src, 'B/Prop.unitypackage'), [{ guid: B, unityPath: 'Assets/B.prefab' }])
    const zip = makeZip(src, path.join(root, 'Bundle.zip'), ['A', 'B'])
    upsertAsset(db, makeAssetRow({ id: 'bundle', name: 'Bundle', raw_name: 'Bundle.zip', category: 'props', library_path: zip, is_bundle: 1 }))
    db.prepare('UPDATE asset SET parent_asset_id = ?, raw_name = ? WHERE id = ?').run('bundle', 'Prop.unitypackage', 'card')
    location(zip)
    await expect(preparePackageSources(db, 'card', destination)).rejects.toThrow('covers.sourceUnreadable')
    expect(files(destination)).toEqual([])
  })

  it('rejects a ZIP package entry marked as a symbolic link before opening its bytes', async () => {
    const src = path.join(root, 'zip-source')
    packageFile(path.join(src, 'Prop.unitypackage'), [{ guid: A, unityPath: 'Assets/Prop.prefab' }])
    const zip = makeZip(src, path.join(root, 'Linked.zip'), ['Prop.unitypackage'])
    const bytes = fs.readFileSync(zip)
    const central = bytes.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]))
    expect(central).toBeGreaterThan(0)
    bytes.writeUInt32LE(0xa1ff0000, central + 38); fs.writeFileSync(zip, bytes)
    location(zip)
    await expect(preparePackageSources(db, 'card', destination)).rejects.toThrow('covers.sourceUnreadable')
    expect(files(destination)).toEqual([])
  })

  it('rejects unsafe ZIP member names before creating any render resource', async () => {
    const src = path.join(root, 'zip-source')
    packageFile(path.join(src, 'xx/Prop.unitypackage'), [{ guid: A, unityPath: 'Assets/Prop.prefab' }])
    const zip = makeZip(src, path.join(root, 'Traversal.zip'), ['xx'])
    const bytes = fs.readFileSync(zip), safe = Buffer.from('xx/Prop.unitypackage'), unsafe = Buffer.from('../Prop.unitypackage')
    for (let offset = bytes.indexOf(safe); offset >= 0; offset = bytes.indexOf(safe, offset + safe.length)) unsafe.copy(bytes, offset)
    fs.writeFileSync(zip, bytes); location(zip)
    await expect(preparePackageSources(db, 'card', destination)).rejects.toThrow('covers.sourceUnreadable')
    expect(files(destination)).toEqual([])
  })

  it('reads directory packages with exact member provenance while leaving linked directories unread', async () => {
    const src = path.join(root, 'directory')
    packageFile(path.join(src, 'Nested/Prop.unitypackage'), [{ guid: A, unityPath: 'Assets/Prop.prefab' }])
    packageFile(path.join(root, 'outside/Sibling.unitypackage'), [{ guid: B, unityPath: 'Assets/Sibling.prefab' }])
    fs.symlinkSync(path.join(root, 'outside'), path.join(src, 'linked'), 'junction')
    location(src)
    const result = await preparePackageSources(db, 'card', destination)
    expect(result.memberPaths).toEqual({ [A]: ['Nested/Prop.unitypackage'] })
    expect(result.guids).toEqual([A]); expect(files(destination)).toEqual(['Prop.prefab', 'Prop.prefab.meta'])
  })

  it.each(['Assets/../Escape.prefab', 'Assets/CON.prefab', 'Assets/Trailing .prefab.', 'Assets/Foo/../../Escape.prefab'])
  ('rejects unsafe resource pathname %s before any writes', async unityPath => {
    location(packageFile(path.join(root, 'unsafe.unitypackage'), [{ guid: A, unityPath: 'Assets/Good.prefab' }, { guid: B, unityPath }]))
    await expect(preparePackageSources(db, 'card', destination)).rejects.toThrow('covers.sourceUnreadable')
    expect(files(destination)).toEqual([])
  })

  it.each(['1', '2'])('rejects tar hard/symbolic links (type %s) without writing a target', async type => {
    location(packageFile(path.join(root, 'link.unitypackage'), [{ guid: A, unityPath: 'Assets/Good.prefab' }], [
      { name: './' + B + '/asset', type, link: '../../outside', bytes: Buffer.alloc(0) }
    ]))
    await expect(preparePackageSources(db, 'card', destination)).rejects.toThrow('covers.sourceUnreadable')
    expect(files(destination)).toEqual([])
  })

  it.each([
    [{ guid: A, unityPath: 'Assets/Shared.prefab', bytes: 'first' }, { guid: A, unityPath: 'Assets/Shared.prefab', bytes: 'different' }],
    [{ guid: A, unityPath: 'Assets/Shared.prefab', bytes: 'first' }, { guid: B, unityPath: 'Assets/shared.prefab', bytes: 'different' }],
    [{ guid: A, unityPath: 'Assets/First.prefab', bytes: 'same' }, { guid: A, unityPath: 'Assets/Second.prefab', bytes: 'same' }]
  ])('fails conflicting package GUID or Windows path content without leaving files', async (first, second) => {
    const src = path.join(root, 'directory')
    packageFile(path.join(src, 'First.unitypackage'), [first]); packageFile(path.join(src, 'Second.unitypackage'), [second])
    location(src)
    await expect(preparePackageSources(db, 'card', destination)).rejects.toThrow('covers.packageConflict')
    expect(files(destination)).toEqual([])
  })

  it('merges identical duplicate resources, retaining every owned member and deterministic content identity', async () => {
    const src = path.join(root, 'directory')
    const resources = [{ guid: A, unityPath: 'Assets/Prop.prefab', bytes: 'same' }]
    packageFile(path.join(src, 'First.unitypackage'), resources); packageFile(path.join(src, 'Second.unitypackage'), resources)
    location(src)
    const first = await preparePackageSources(db, 'card', destination)
    const second = await preparePackageSources(db, 'card', ownedProject('second'))
    expect(first.memberPaths).toEqual({ [A]: ['First.unitypackage', 'Second.unitypackage'] })
    expect(first.fingerprint).toBe(second.fingerprint); expect(files(destination)).toHaveLength(2)
  })

  it('refuses invalid or contradictory asset metadata GUIDs', async () => {
    location(packageFile(path.join(root, 'wrong-meta.unitypackage'), [
      { guid: A, unityPath: 'Assets/Prop.prefab', meta: `fileFormatVersion: 2\nguid: ${B}\n` }
    ]))
    await expect(preparePackageSources(db, 'card', destination)).rejects.toThrow('covers.sourceUnreadable')
    expect(files(destination)).toEqual([])
  })

  it('rejects unowned, nonempty, or linked destination directories without touching existing files', async () => {
    location(packageFile(path.join(root, 'Prop.unitypackage'), [{ guid: A, unityPath: 'Assets/Prop.prefab' }]))
    fs.writeFileSync(path.join(destination, 'existing.txt'), 'keep')
    await expect(preparePackageSources(db, 'card', destination)).rejects.toThrow('covers.previewOwnership')
    expect(fs.readFileSync(path.join(destination, 'existing.txt'), 'utf8')).toBe('keep')
    const unowned = path.join(root, 'unowned/Assets'); fs.mkdirSync(unowned, { recursive: true })
    await expect(preparePackageSources(db, 'card', unowned)).rejects.toThrow('covers.previewOwnership')
    const linked = path.join(root, 'linked/Assets'); fs.mkdirSync(path.dirname(linked)); fs.symlinkSync(destination, linked, 'junction')
    await expect(preparePackageSources(db, 'card', linked)).rejects.toThrow('covers.previewOwnership')
  })

  it('cancels after partial copy and cleans only files created by this preparation', async () => {
    location(packageFile(path.join(root, 'Prop.unitypackage'), [
      { guid: A, unityPath: 'Assets/Nested/A.prefab' }, { guid: B, unityPath: 'Assets/Nested/B.prefab' }
    ]))
    const controller = new AbortController()
    await expect(preparePackageSources(db, 'card', destination, controller.signal, done => {
      if (done > 0) controller.abort()
    })).rejects.toThrow('covers.cancelled')
    expect(fs.readdirSync(destination)).toEqual([])
  })

  it('keeps abort listeners bounded while copying many small resources with exact bytes', async () => {
    const resources = Array.from({ length: 64 }, (_, index) => ({
      guid: index.toString(16).padStart(32, '0'), unityPath: `Assets/Prop${index}.prefab`, bytes: `prop-${index}`
    }))
    location(packageFile(path.join(root, 'small.unitypackage'), resources))
    const originalAdd = AbortSignal.prototype.addEventListener
    let peak = 0
    const warnings: Error[] = []
    const warning = (value: Error): void => { warnings.push(value) }
    process.on('warning', warning)
    const observed = vi.spyOn(AbortSignal.prototype, 'addEventListener').mockImplementation(function (this: AbortSignal, type, listener, options) {
      originalAdd.call(this, type, listener, options)
      if (type === 'abort') peak = Math.max(peak, getEventListeners(this, 'abort').length)
    })
    try {
      const result = await preparePackageSources(db, 'card', destination)
      await new Promise<void>(resolve => setImmediate(resolve))
      expect(result.guids).toHaveLength(64)
      for (let index = 0; index < 64; index++) expect(fs.readFileSync(path.join(destination, `Prop${index}.prefab`), 'utf8')).toBe(`prop-${index}`)
      expect(peak).toBeLessThanOrEqual(10)
      expect(warnings.filter(value => value.name === 'MaxListenersExceededWarning')).toEqual([])
    } finally { observed.mockRestore(); process.off('warning', warning) }
  })

  it('cancels many queued entries without leaving writes or waiting for unread entry streams', async () => {
    const resources = Array.from({ length: 64 }, (_, index) => ({
      guid: index.toString(16).padStart(32, '0'), unityPath: `Assets/Shared/Nested/Prop${index}.prefab`, bytes: index % 2 ? `prop-${index}` : ''
    }))
    location(packageFile(path.join(root, 'queued.unitypackage'), resources))
    const controller = new AbortController()
    const preparation = preparePackageSources(db, 'card', destination, controller.signal, done => { if (done === 1) controller.abort() })
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      const completed = Promise.race([preparation, new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('Entry cancellation hung')), 5000)
      })])
      await expect(completed).rejects.toThrow('covers.cancelled')
      expect(fs.readdirSync(destination)).toEqual([])
    } finally { if (timer) clearTimeout(timer) }
  })

  it('releases an incomplete entry promptly when the gzip source is damaged', async () => {
    const source = packageFile(path.join(root, 'damaged.unitypackage'), [
      { guid: A, unityPath: 'Assets/Prop.prefab', bytes: randomBytes(256 * 1024) }
    ])
    const gzip = fs.readFileSync(source)
    fs.writeFileSync(source, gzip.subarray(0, gzip.length - 10_000))
    location(source)
    db.prepare('INSERT INTO package_entry(asset_id,guid,unity_path,entry_kind) VALUES(?,?,?,?)')
      .run('card', A, 'Assets/Prop.prefab', 'prefab')
    const controller = new AbortController()
    const preparation = preparePackageSources(db, 'card', destination, controller.signal)
    const outcome = preparation.then(() => 'unexpected success', error => (error as Error).message)
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      const result = await Promise.race([outcome, new Promise<string>(resolve => {
        timer = setTimeout(() => resolve('damaged source consumer stayed open'), 2000)
      })])
      expect(result).toBe('covers.sourceUnreadable')
      expect(fs.readdirSync(destination)).toEqual([])
    } finally {
      if (timer) clearTimeout(timer)
      controller.abort(); await outcome
    }
  })

  it('refuses an original source changed during preparation and removes its partial output', async () => {
    const source = packageFile(path.join(root, 'Prop.unitypackage'), [{ guid: A, unityPath: 'Assets/Prop.prefab' }])
    location(source)
    await expect(preparePackageSources(db, 'card', destination, undefined, done => {
      if (done > 0) fs.appendFileSync(source, 'changed')
    })).rejects.toThrow('covers.sourceChanged')
    expect(files(destination)).toEqual([])
  })

  it('rejects input beyond 512 MiB before reading or writing package contents', async () => {
    const source = path.join(root, 'oversize.unitypackage')
    fs.closeSync(fs.openSync(source, 'w')); fs.truncateSync(source, 512 * 1024 * 1024 + 1)
    location(source)
    await expect(preparePackageSources(db, 'card', destination)).rejects.toThrow('covers.inventoryLimited')
    expect(files(destination)).toEqual([])
  })

  it('rejects a tar asset advertising more than 2 GiB without writing its body', async () => {
    const source = packageFile(path.join(root, 'expanded.unitypackage'), [{ guid: A, unityPath: 'Assets/Good.prefab' }], [
      { name: './' + B + '/pathname', bytes: Buffer.from('Assets/Huge.fbx') },
      { name: './' + B + '/asset', size: 2 * 1024 * 1024 * 1024 + 1, bytes: Buffer.alloc(0) }
    ])
    location(source)
    // Cached identity survives the deliberately truncated oversized tar body;
    // the preparer must still validate the original before creating files.
    db.prepare('INSERT INTO package_entry(asset_id, guid, unity_path, entry_kind) VALUES (?, ?, ?, ?)')
      .run('card', A, 'Assets/Good.prefab', 'prefab')
    await expect(preparePackageSources(db, 'card', destination)).rejects.toThrow('covers.inventoryLimited')
    expect(files(destination)).toEqual([])
  })

  it('rejects resource directories deeper than eight components', async () => {
    location(packageFile(path.join(root, 'deep.unitypackage'), [
      { guid: A, unityPath: 'Assets/A/B/C/D/E/F/G/H/I/Prop.prefab' }
    ]))
    await expect(preparePackageSources(db, 'card', destination)).rejects.toThrow('covers.inventoryLimited')
    expect(files(destination)).toEqual([])
  })

  it('rejects a resource pathname larger than 4 KiB without preserving a shortened name', async () => {
    location(packageFile(path.join(root, 'long-path.unitypackage'), [
      { guid: A, unityPath: 'Assets/Good.prefab' }, { guid: B, unityPath: 'Assets/' + 'p'.repeat(4096) + '.prefab' }
    ]))
    await expect(preparePackageSources(db, 'card', destination)).rejects.toThrow('covers.inventoryLimited')
    expect(files(destination)).toEqual([])
  })

  it('rejects more than 20,000 tar entries without staging the inventory subset', async () => {
    const entries: TarFile[] = Array.from({ length: 20_001 }, (_, i) => ({
      name: './' + A + '/extra' + i, bytes: Buffer.alloc(0)
    }))
    entries.unshift({ name: './' + A + '/pathname', bytes: Buffer.from('Assets/Prop.prefab') })
    location(archive(path.join(root, 'entry-limit.unitypackage'), entries))
    await expect(preparePackageSources(db, 'card', destination)).rejects.toThrow('covers.inventoryLimited')
    expect(files(destination)).toEqual([])
  })

  it('rejects more than 10,000 GUIDs instead of importing an arbitrary subset', async () => {
    const entries: TarFile[] = Array.from({ length: 10_001 }, (_, i) => ({
      name: './' + i.toString(16).padStart(32, '0') + '/pathname', bytes: Buffer.from(`Assets/P${i}.prefab`)
    }))
    location(archive(path.join(root, 'guid-limit.unitypackage'), entries))
    await expect(preparePackageSources(db, 'card', destination)).rejects.toThrow('covers.inventoryLimited')
    expect(files(destination)).toEqual([])
  })

  it('rejects package collections beyond 32 members without copying a partial subset', async () => {
    const src = path.join(root, 'directory')
    for (let i = 0; i < 33; i++) packageFile(path.join(src, `${i}.unitypackage`), [
      { guid: i.toString(16).padStart(32, '0'), unityPath: `Assets/Prop${i}.prefab` }
    ])
    location(src)
    await expect(preparePackageSources(db, 'card', destination)).rejects.toThrow('covers.inventoryLimited')
    expect(files(destination)).toEqual([])
  })
})
