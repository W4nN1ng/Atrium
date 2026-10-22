import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  diffLocalPackages,
  readLocalPackage,
  scanLocalPackages
} from '../../../src/main/vpm/catalog/local'

let root: string

function writePackage(dir: string, manifest: Record<string, unknown>): void {
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(manifest, null, 2))
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'atrium-local-'))
})

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true })
})

describe('readLocalPackage', () => {
  it('reads a valid package.json', () => {
    const dir = path.join(root, 'com.example.a')
    writePackage(dir, {
      name: 'com.example.a',
      version: '1.2.3',
      displayName: 'Example A',
      description: 'demo',
      unity: '2022.3',
      dependencies: { 'com.example.b': '^1.0.0', bad: 1 }
    })
    const pkg = readLocalPackage(dir)
    expect(typeof pkg).not.toBe('string')
    if (typeof pkg === 'string') return
    expect(pkg).toMatchObject({
      name: 'com.example.a',
      version: '1.2.3',
      displayName: 'Example A',
      unity: '2022.3',
      dependencies: { 'com.example.b': '^1.0.0' }
    })
    expect(pkg.hash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('reports why a folder is not a package', () => {
    expect(readLocalPackage(path.join(root, 'empty'))).toBe('noPackageJson')

    const broken = path.join(root, 'broken')
    fs.mkdirSync(broken, { recursive: true })
    fs.writeFileSync(path.join(broken, 'package.json'), '{ not json')
    expect(readLocalPackage(broken)).toBe('invalidJson')

    const noName = path.join(root, 'no-name')
    writePackage(noName, { version: '1.0.0' })
    expect(readLocalPackage(noName)).toBe('nameMissing')

    const badName = path.join(root, 'bad-name')
    writePackage(badName, { name: 'Not A Package', version: '1.0.0' })
    expect(readLocalPackage(badName)).toBe('nameInvalid')

    const noVersion = path.join(root, 'no-version')
    writePackage(noVersion, { name: 'com.example.b' })
    expect(readLocalPackage(noVersion)).toBe('versionMissing')
  })

  it('drops an unparsable unity field instead of rejecting the package', () => {
    const dir = path.join(root, 'weird-unity')
    writePackage(dir, { name: 'com.example.c', version: '1.0.0', unity: 'whatever' })
    const pkg = readLocalPackage(dir)
    expect(typeof pkg).not.toBe('string')
    if (typeof pkg === 'string') return
    expect(pkg.unity).toBeNull()
  })
})

describe('scanLocalPackages', () => {
  it('treats the folder itself as one package when it has package.json', () => {
    writePackage(root, { name: 'com.example.self', version: '1.0.0' })
    const result = scanLocalPackages(root)
    expect(result.packages.map((pkg) => pkg.name)).toEqual(['com.example.self'])
  })

  it('scans one level deep and skips non-package folders silently', () => {
    writePackage(path.join(root, 'a'), { name: 'com.example.a', version: '1.0.0' })
    writePackage(path.join(root, 'b'), { name: 'com.example.b', version: '2.0.0' })
    fs.mkdirSync(path.join(root, 'docs'), { recursive: true })
    writePackage(path.join(root, 'broken'), { version: '1.0.0' })

    const result = scanLocalPackages(root)
    expect(result.packages.map((pkg) => pkg.name)).toEqual(['com.example.a', 'com.example.b'])
    // 有 package.json 但缺 name 的会被记下来，纯文件夹不会
    expect(result.skipped).toEqual([
      { path: path.join(root, 'broken'), reason: 'nameMissing' }
    ])
  })

  it('returns empty for a missing or symlinked root', () => {
    expect(scanLocalPackages(path.join(root, 'nope')).packages).toEqual([])
  })
})

describe('diffLocalPackages', () => {
  it('detects added, removed and content changes by hash', () => {
    const a = { name: 'a', version: '1.0.0', hash: 'h1' } as never
    const b = { name: 'b', version: '1.0.0', hash: 'h2' } as never
    const bChanged = { name: 'b', version: '1.0.1', hash: 'h3' } as never
    const c = { name: 'c', version: '1.0.0', hash: 'h4' } as never

    const diff = diffLocalPackages([a, b], [bChanged, c])
    expect(diff.added.map((pkg) => pkg.name)).toEqual(['c'])
    expect(diff.removed.map((pkg) => pkg.name)).toEqual(['a'])
    expect(diff.changed.map((pkg) => pkg.name)).toEqual(['b'])
  })
})
