import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { closeVpmDb, openVpmDb, type VpmDb } from '../../../src/main/vpm/db'
import { TemplateService } from '../../../src/main/vpm/templates'
import { resolveVpmDependencies } from '../../../src/shared/vpm/domain/resolver'

let root: string
let db: VpmDb | null = null
let service: TemplateService

beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'atrium-security-templates-'))
  const dataRoot = path.join(root, 'data')
  fs.mkdirSync(dataRoot)
  db = await openVpmDb({ file: path.join(root, 'vpm.db'), backupsDir: path.join(root, 'backups') })
  service = new TemplateService({ db, dataRoot })
})

afterEach(() => {
  closeVpmDb(db)
  db = null
  fs.rmSync(root, { recursive: true, force: true })
})

function codeOf(fn: () => unknown): string | null {
  try {
    fn()
    return null
  } catch (error) {
    return (error as { code?: string }).code ?? 'unknown'
  }
}

describe('protected package and template security (P9-A)', () => {
  it('never resolves or plans com.avca.bridge as an install', () => {
    const result = resolveVpmDependencies({
      roots: {},
      requests: [{ kind: 'install', name: 'com.avca.bridge' }],
      catalog: [
        {
          name: 'com.avca.bridge',
          version: '9.9.9',
          dependencies: {},
          repoId: 'evil',
          sha256: 'a'.repeat(64),
          url: 'https://evil.test/bridge.zip'
        }
      ]
    })
    expect(result.blocked).toBe(true)
    expect(result.selected).toEqual([])
    expect(result.conflicts.some((item) => item.reason === 'protectedPackage')).toBe(true)
  })

  it('rejects traversal ids, bases and attachment paths', () => {
    expect(codeOf(() => service.get('../escape'))).toBe('vpmTemplateNotFound')
    expect(codeOf(() => service.manifestPath('a/b'))).toBe('vpmTemplateNotFound')
    expect(codeOf(() => service.create({ name: 'bad-base', base: '../../evil' }))).toBe(
      'vpmTemplateInvalid'
    )
    expect(
      codeOf(() =>
        service.create({
          name: 'bad-file',
          unitypackages: [{ path: '../evil.unitypackage', name: null }]
        })
      )
    ).toBe('vpmTemplateInvalid')
  })

  it('removes only the reference and keeps the template file on disk', () => {
    const entry = service.create({ name: 'Keep me' })
    const file = service.manifestPath(entry.id)
    expect(fs.existsSync(file)).toBe(true)

    expect(service.removeReference(entry.id).visible).toBe(false)
    expect(fs.existsSync(file)).toBe(true)
    expect(service.list().some((item) => item.id === entry.id)).toBe(false)
    expect(service.list({ includeHidden: true }).some((item) => item.id === entry.id)).toBe(true)

    expect(service.restore(entry.id).visible).toBe(true)
    expect(fs.existsSync(file)).toBe(true)
  })

  it('refuses self/descendant base cycles without corrupting the source file', () => {
    const a = service.create({ name: 'A' })
    const b = service.create({ name: 'B', base: a.id })
    expect(codeOf(() => service.update(a.id, { base: b.id }))).toBe('vpmTemplateInvalid')
    expect(service.raw(a.id)?.base).toBeNull()
  })
})
