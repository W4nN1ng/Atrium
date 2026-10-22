import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { closeVpmDb, openVpmDb, type VpmDb } from '../../../src/main/vpm/db'
import { LocalPackageStore } from '../../../src/main/vpm/catalog'

let root: string
let db: VpmDb
let store: LocalPackageStore

function writePackage(dir: string, manifest: Record<string, unknown>): void {
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(manifest, null, 2))
}

beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'atrium-localstore-'))
  db = await openVpmDb({ file: path.join(root, 'vpm.db'), backupsDir: path.join(root, 'backups') })
  store = new LocalPackageStore(db, { now: () => 1_700_000_000_000 })
})

afterEach(() => {
  closeVpmDb(db)
  fs.rmSync(root, { recursive: true, force: true })
})

describe('local package store (P7-C)', () => {
  it('trusts a folder that contains at least one package', () => {
    const dir = path.join(root, 'packages')
    writePackage(path.join(dir, 'a'), { name: 'com.example.a', version: '1.0.0' })
    writePackage(path.join(dir, 'b'), { name: 'com.example.b', version: '2.0.0' })

    const added = store.add({ path: dir, label: '我的包' })
    expect(added.packageCount).toBe(2)
    expect(added.label).toBe('我的包')
    expect(store.list()).toHaveLength(1)
  })

  it('rejects duplicates, missing folders and folders without packages', () => {
    const empty = path.join(root, 'empty')
    fs.mkdirSync(empty)
    expect(() => store.add({ path: empty })).toThrow(
      expect.objectContaining({ code: 'vpmLocalRootInvalid' })
    )
    expect(() => store.add({ path: path.join(root, 'nope') })).toThrow(
      expect.objectContaining({ code: 'vpmLocalRootInvalid' })
    )

    const dir = path.join(root, 'ok')
    writePackage(path.join(dir, 'a'), { name: 'com.example.a', version: '1.0.0' })
    store.add({ path: dir })
    expect(() => store.add({ path: dir })).toThrow(
      expect.objectContaining({ code: 'vpmLocalRootInvalid' })
    )
  })

  it('scans trusted roots and returns packages tagged with their root', () => {
    const dir = path.join(root, 'packages')
    writePackage(path.join(dir, 'a'), { name: 'com.example.a', version: '1.0.0' })
    const added = store.add({ path: dir })

    const scanned = store.scanAll()
    expect(scanned).toHaveLength(1)
    expect(scanned[0]).toMatchObject({ name: 'com.example.a', rootId: added.id })
    expect(store.get(added.id)?.lastScanAt).toBe(1_700_000_000_000)
  })

  it('forgets a root without touching the folder', () => {
    const dir = path.join(root, 'packages')
    writePackage(path.join(dir, 'a'), { name: 'com.example.a', version: '1.0.0' })
    const added = store.add({ path: dir })

    expect(store.remove(added.id)).toBe(true)
    expect(store.list()).toEqual([])
    // 文件夹还在——移除信任不等于删文件
    expect(fs.existsSync(path.join(dir, 'a', 'package.json'))).toBe(true)
  })
})
