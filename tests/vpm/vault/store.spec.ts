import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { VaultStore } from '../../../src/main/vpm/vault'

const OP_ID = '01ARZ3NDEKTSV4RRFFQ69G5FAV'
const SLUG = 'demoproject-1234abcd'

let root: string
let dataRoot: string
let vault: VaultStore

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'atrium-vpm-vault-'))
  dataRoot = path.join(root, 'data')
  fs.mkdirSync(dataRoot)
  vault = new VaultStore({ dataRoot })
})

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true })
})

function writeFile(relative: string, contents = 'x'): string {
  const file = path.join(root, 'trash', relative)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, contents)
  return file
}

describe('VaultStore', () => {
  it('creates the vault as a strict subdirectory of the data root', () => {
    expect(vault.vaultRoot).toBe(path.join(fs.realpathSync.native(dataRoot), 'vault'))
    expect(fs.existsSync(vault.vaultRoot)).toBe(true)
    expect(vault.ensureUsable()).toBe(true)
  })

  it('rejects a missing data root, a vault root outside it and an equal root', () => {
    expect(() => new VaultStore({ dataRoot: path.join(root, 'missing') })).toThrow()
    expect(
      () => new VaultStore({ dataRoot, vaultRoot: path.join(root, 'outside') })
    ).toThrow()
    expect(() => new VaultStore({ dataRoot, vaultRoot: dataRoot })).toThrow()
  })

  it('rejects unsafe project slugs and operation ids', () => {
    expect(() => vault.opDir('../escape', OP_ID)).toThrow()
    expect(() => vault.opDir(SLUG, '../escape')).toThrow()
    expect(() => vault.opDir(SLUG, 'not-a-ulid')).toThrow()
  })

  it('archives a package folder, verifies it and removes the temporary copy', async () => {
    writeFile('packages/com.example.a/package.json', '{"name":"com.example.a","version":"1.0.0"}')
    writeFile('packages/com.example.a/Textures/a.png', 'png')
    writeFile('packages/com.example.a/Textures/a.png.meta', 'meta')

    const result = await vault.archive({
      projectSlug: SLUG,
      opId: OP_ID,
      sourceDir: path.join(root, 'trash'),
      entries: [{ relativePath: 'packages/com.example.a', kind: 'dir' }]
    })

    expect(result.entries).toHaveLength(1)
    expect(result.entries[0].files).toBe(3)
    expect(result.entries[0].sha256).toMatch(/^[a-f0-9]{64}$/)
    expect(result.files).toBe(3)
    expect(result.bytes).toBeGreaterThan(0)
    const archived = path.join(vault.opDir(SLUG, OP_ID), 'packages', 'com.example.a')
    expect(fs.readFileSync(path.join(archived, 'package.json'), 'utf8')).toContain('com.example.a')
    expect(fs.readFileSync(path.join(archived, 'Textures', 'a.png.meta'), 'utf8')).toBe('meta')
    expect(fs.existsSync(path.join(root, 'trash', 'packages', 'com.example.a'))).toBe(false)
    expect(vault.exists(SLUG, OP_ID)).toBe(true)
  })

  it('archives single files and keeps the source when an entry is missing', async () => {
    writeFile('legacy/Assets/Foo.cs', 'class Foo {}')
    await vault.archive({
      projectSlug: SLUG,
      opId: OP_ID,
      sourceDir: path.join(root, 'trash'),
      entries: [{ relativePath: 'legacy/Assets/Foo.cs', kind: 'file' }]
    })
    expect(
      fs.readFileSync(path.join(vault.opDir(SLUG, OP_ID), 'legacy', 'Assets', 'Foo.cs'), 'utf8')
    ).toBe('class Foo {}')
    expect(fs.existsSync(path.join(root, 'trash', 'legacy', 'Assets', 'Foo.cs'))).toBe(false)

    await expect(
      vault.archive({
        projectSlug: SLUG,
        opId: OP_ID,
        sourceDir: path.join(root, 'trash'),
        entries: [{ relativePath: 'legacy/Assets/Missing.cs', kind: 'file' }]
      })
    ).rejects.toMatchObject({ code: 'vpmVaultArchiveFailed' })
  })

  it('refuses path traversal and symlinks instead of following them', async () => {
    writeFile('packages/com.example.a/package.json', '{}')
    await expect(
      vault.archive({
        projectSlug: SLUG,
        opId: OP_ID,
        sourceDir: path.join(root, 'trash'),
        entries: [{ relativePath: '../escape', kind: 'dir' }]
      })
    ).rejects.toMatchObject({ code: 'vpmVaultArchiveFailed' })

    const outside = path.join(root, 'outside')
    fs.mkdirSync(outside)
    fs.writeFileSync(path.join(outside, 'secret.txt'), 'secret')
    fs.symlinkSync(outside, path.join(root, 'trash', 'linked'), 'junction')
    await expect(
      vault.archive({
        projectSlug: SLUG,
        opId: OP_ID,
        sourceDir: path.join(root, 'trash'),
        entries: [{ relativePath: 'linked', kind: 'dir' }]
      })
    ).rejects.toMatchObject({ code: 'vpmVaultArchiveFailed' })
    // 源目录必须原样保留：失败不动现场。
    expect(fs.existsSync(path.join(root, 'trash', 'linked'))).toBe(true)
  })

  it('keeps every source entry when a later entry fails', async () => {
    writeFile('packages/com.example.a/package.json', '{}')
    await expect(
      vault.archive({
        projectSlug: SLUG,
        opId: OP_ID,
        sourceDir: path.join(root, 'trash'),
        entries: [
          { relativePath: 'packages/com.example.a', kind: 'dir' },
          { relativePath: 'packages/missing', kind: 'dir' }
        ]
      })
    ).rejects.toMatchObject({ code: 'vpmVaultArchiveFailed' })
    expect(fs.existsSync(path.join(root, 'trash', 'packages', 'com.example.a', 'package.json'))).toBe(true)
  })

  it('reports usage across operations', async () => {
    writeFile('packages/com.example.a/package.json', '{}')
    await vault.archive({
      projectSlug: SLUG,
      opId: OP_ID,
      sourceDir: path.join(root, 'trash'),
      entries: [{ relativePath: 'packages/com.example.a', kind: 'dir' }]
    })
    const usage = vault.usage()
    expect(usage.operations).toBe(1)
    expect(usage.files).toBe(1)
    expect(usage.bytes).toBeGreaterThan(0)
  })
})
