import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { closeVpmDb, openVpmDb, type VpmDb } from '../../../src/main/vpm/db'
import { TemplateService, builtinTemplate } from '../../../src/main/vpm/templates'
import { tryParseVpmRange } from '../../../src/shared/vpm/domain/range'

let root: string
let dataRoot: string
let db: VpmDb
let service: TemplateService
let clock: number

beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'atrium-templates-'))
  dataRoot = path.join(root, 'data')
  fs.mkdirSync(dataRoot)
  db = await openVpmDb({ file: path.join(root, 'vpm.db'), backupsDir: path.join(root, 'backups') })
  clock = 1_000
  service = new TemplateService({ db, dataRoot, now: () => ++clock })
})

afterEach(() => {
  closeVpmDb(db)
  fs.rmSync(root, { recursive: true, force: true })
})

function codeOf(fn: () => unknown): string | null {
  try {
    fn()
    return null
  } catch (error) {
    return (error as { code?: string }).code ?? null
  }
}

describe('built-in templates', () => {
  it('ships blank, avatars and worlds with only package ids and ranges', () => {
    const list = service.list()
    expect(list.map((item) => item.id)).toEqual(['builtin.blank', 'builtin.avatars', 'builtin.worlds'])
    expect(list.every((item) => item.builtin && !item.broken)).toBe(true)
    expect(list[0].dependencies).toEqual({})
    expect(list[0].unitypackages).toEqual([])
    expect(list[0].unity.recommended).toBe('2022.3.22f1')

    for (const entry of list.slice(1)) {
      const names = Object.keys(entry.dependencies)
      expect(names).toHaveLength(1)
      expect(tryParseVpmRange(entry.dependencies[names[0]])).not.toBeNull()
      // 只写包 ID + 范围：没有附件、没有美术资源
      expect(entry.unitypackages).toEqual([])
    }
    expect(Object.keys(list[1].dependencies)).toEqual(['com.vrchat.avatars'])
    expect(Object.keys(list[2].dependencies)).toEqual(['com.vrchat.worlds'])
  })

  it('resolves builtin inheritance through blank', () => {
    const resolved = service.get('builtin.avatars')
    expect(resolved.chain).toEqual(['builtin.avatars', 'builtin.blank'])
    expect(resolved.manifest.unity).toEqual({
      min: '2022.3',
      max: null,
      recommended: '2022.3.22f1'
    })
    expect(resolved.manifest.dependencies).toEqual({ 'com.vrchat.avatars': '>=3.0.0 <4.0.0' })
  })

  it('keeps built-in templates read-only', () => {
    expect(codeOf(() => service.update('builtin.blank', { name: 'x' }))).toBe('vpmTemplateReadOnly')
    expect(codeOf(() => service.removeReference('builtin.blank'))).toBe('vpmTemplateReadOnly')
    expect(codeOf(() => service.setFavorite('builtin.blank', true))).toBe('vpmTemplateReadOnly')
  })
})

describe('user templates', () => {
  it('writes template.json atomically and lists it', () => {
    const entry = service.create({
      name: 'My Avatar',
      description: 'desc',
      dependencies: { 'com.vrchat.avatars': '>=3.0.0 <4.0.0' }
    })
    const file = service.manifestPath(entry.id)
    expect(fs.existsSync(file)).toBe(true)
    // 原子写不留临时文件
    expect(fs.readdirSync(path.dirname(file)).filter((name) => name.includes('.tmp'))).toEqual([])
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as { schemaVersion: number; id: string }
    expect(parsed.schemaVersion).toBe(1)
    expect(parsed.id).toBe(entry.id)

    const list = service.list()
    expect(list.map((item) => item.id)).toContain(entry.id)
    expect(list.find((item) => item.id === entry.id)?.dependencies).toEqual({
      'com.vrchat.avatars': '>=3.0.0 <4.0.0'
    })
  })

  it('rejects invalid input before touching the disk', () => {
    expect(
      codeOf(() =>
        service.create({ name: 'bad', dependencies: { 'com.example.a': 'not-a-range' } })
      )
    ).toBe('vpmTemplateInvalid')
    expect(fs.existsSync(path.join(dataRoot, 'templates'))).toBe(false)
  })

  it('updates a user template and keeps unknown fields', () => {
    const entry = service.create({ name: 'First' })
    const file = service.manifestPath(entry.id)
    const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>
    raw.futureField = { keep: true }
    fs.writeFileSync(file, JSON.stringify(raw, null, 2))

    const updated = service.update(entry.id, { name: 'Second', dependencies: { 'com.a': '^1.0.0' } })
    expect(updated.name).toBe('Second')
    expect(updated.dependencies).toEqual({ 'com.a': '^1.0.0' })
    const reread = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>
    expect(reread.futureField).toEqual({ keep: true })
  })

  it('duplicates a template including its files, leaving the source alone', () => {
    const entry = service.create({ name: 'Source' })
    fs.writeFileSync(path.join(service.filesDir(entry.id), 'a.txt'), 'payload')

    const copy = service.duplicate(entry.id, 'Copy')
    expect(copy.id).not.toBe(entry.id)
    expect(copy.name).toBe('Copy')
    expect(fs.readFileSync(path.join(service.filesDir(copy.id), 'a.txt'), 'utf8')).toBe('payload')
    expect(fs.readFileSync(path.join(service.filesDir(entry.id), 'a.txt'), 'utf8')).toBe('payload')
  })

  it('can duplicate a built-in template into a user template', () => {
    const copy = service.duplicate('builtin.avatars', 'My Avatars')
    expect(copy.builtin).toBe(false)
    expect(copy.base).toBe('builtin.blank')
    expect(copy.dependencies).toEqual({ 'com.vrchat.avatars': '>=3.0.0 <4.0.0' })
    expect(fs.existsSync(service.manifestPath(copy.id))).toBe(true)
  })

  it('orders favorites first and remembers recent use', () => {
    const a = service.create({ name: 'A' })
    const b = service.create({ name: 'B' })
    service.setFavorite(b.id, true)
    service.markUsed(a.id)

    const ids = service.list().map((item) => item.id)
    expect(ids.indexOf(b.id)).toBeLessThan(ids.indexOf(a.id))
    expect(ids.slice(0, 3)).toEqual(['builtin.blank', 'builtin.avatars', 'builtin.worlds'])
  })

  it('removes only the reference: hidden from the list, file untouched', () => {
    const entry = service.create({ name: 'Gone' })
    const file = service.manifestPath(entry.id)

    const hidden = service.removeReference(entry.id)
    expect(hidden.visible).toBe(false)
    expect(service.list().map((item) => item.id)).not.toContain(entry.id)
    expect(service.list({ includeHidden: true }).map((item) => item.id)).toContain(entry.id)
    expect(fs.existsSync(file)).toBe(true)

    const restored = service.restore(entry.id)
    expect(restored.visible).toBe(true)
    expect(service.list().map((item) => item.id)).toContain(entry.id)
  })

  it('marks a broken manifest instead of pretending it is fine', () => {
    const entry = service.create({ name: 'Broken' })
    fs.writeFileSync(service.manifestPath(entry.id), '{')

    const listed = service.list().find((item) => item.id === entry.id)
    expect(listed?.broken).toBe(true)
    expect(listed?.issues.length).toBeGreaterThan(0)
    expect(codeOf(() => service.get(entry.id))).toBe('vpmTemplateInvalid')
  })

  it('reports a missing template file as invalid, not as missing template', () => {
    const entry = service.create({ name: 'Vanished' })
    fs.rmSync(service.manifestPath(entry.id))
    expect(codeOf(() => service.get(entry.id))).toBe('vpmTemplateInvalid')
  })

  it('refuses a base that does not exist', () => {
    expect(codeOf(() => service.create({ name: 'Orphan', base: 'user.missing' }))).toBe(
      'vpmTemplateInvalid'
    )
  })

  it('refuses self/descendant base edits and leaves the file untouched', () => {
    const a = service.create({ name: 'A' })
    const b = service.create({ name: 'B', base: a.id })
    const c = service.create({ name: 'C', base: b.id })

    expect(codeOf(() => service.update(a.id, { base: c.id }))).toBe('vpmTemplateInvalid')
    expect(service.raw(a.id)?.base).toBeNull()
    expect(codeOf(() => service.update(b.id, { base: b.id }))).toBe('vpmTemplateInvalid')
    expect(service.raw(b.id)?.base).toBe(a.id)
  })

  it('keeps recent locations bounded and newest first', () => {
    service.recordLocation('C:\\a')
    service.recordLocation('C:\\b')
    service.recordLocation('C:\\c')
    service.recordLocation('C:\\b')
    const recent = service.recentLocations(2)
    expect(recent.map((item) => item.path)).toEqual(['C:\\b', 'C:\\c'])

    for (let index = 0; index < 20; index++) service.recordLocation(`C:\\p${index}`)
    expect(service.recentLocations(50).length).toBeLessThanOrEqual(8)
  })
})

describe('template ids in storage', () => {
  it('refuses traversal ids', () => {
    expect(codeOf(() => service.get('../escape'))).toBe('vpmTemplateNotFound')
    expect(codeOf(() => service.manifestPath('a/b'))).toBe('vpmTemplateNotFound')
  })

  it('exposes builtin manifests through raw()', () => {
    expect(builtinTemplate('builtin.blank')?.id).toBe('builtin.blank')
    expect(service.raw('builtin.blank')?.name).toBe('空白工程')
  })
})
