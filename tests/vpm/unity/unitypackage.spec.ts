import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import * as tar from 'tar'
import { closeVpmDb, openVpmDb, type VpmDb } from '../../../src/main/vpm/db'
import { TemplateService } from '../../../src/main/vpm/templates'
import { createTemplateAttachmentPort, extractUnityPackage } from '../../../src/main/vpm/unity'

const GUID_A = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const GUID_B = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
const GUID_C = 'cccccccccccccccccccccccccccccccc'

const META_A = 'fileFormatVersion: 2\nguid: 0123456789abcdef0123456789abcdef\nPrefabImporter:\n  externalObjects: {}\n'

interface PkgEntry {
  guid: string
  pathname?: string
  asset?: Buffer | string
  meta?: string
  preview?: boolean
}

let root: string
let projectPath: string

function buildPackage(file: string, entries: PkgEntry[]): void {
  const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'up-src-'))
  for (const entry of entries) {
    const dir = path.join(staging, entry.guid)
    fs.mkdirSync(dir, { recursive: true })
    if (entry.pathname !== undefined) fs.writeFileSync(path.join(dir, 'pathname'), entry.pathname)
    if (entry.asset !== undefined) fs.writeFileSync(path.join(dir, 'asset'), entry.asset)
    if (entry.meta !== undefined) fs.writeFileSync(path.join(dir, 'asset.meta'), entry.meta)
    if (entry.preview) fs.writeFileSync(path.join(dir, 'preview.png'), 'PNG')
  }
  fs.mkdirSync(path.dirname(file), { recursive: true })
  tar.c({ gzip: true, sync: true, file, cwd: staging, portable: true }, fs.readdirSync(staging))
  fs.rmSync(staging, { recursive: true, force: true })
}

function codeOf(promise: Promise<unknown>): Promise<string | null> {
  return promise.then(
    () => null,
    (error: { code?: string }) => error.code ?? 'unknown'
  )
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'atrium-unitypackage-'))
  projectPath = path.join(root, 'project')
  fs.mkdirSync(path.join(projectPath, 'Assets'), { recursive: true })
})

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true })
})

describe('extractUnityPackage', () => {
  it('copies asset and meta byte-for-byte, ignores preview, creates nested folders', async () => {
    const pkg = path.join(root, 'a.unitypackage')
    const assetBytes = Buffer.from([0x01, 0x02, 0xff, 0x00, 0x41])
    buildPackage(pkg, [
      {
        guid: GUID_A,
        pathname: 'Assets/Prefabs/Thing.prefab',
        asset: assetBytes,
        meta: META_A,
        preview: true
      }
    ])

    const result = await extractUnityPackage({ packagePath: pkg, projectPath })

    expect(result.applied).toEqual(['Assets/Prefabs/Thing.prefab'])
    expect(result.warnings).toEqual([])
    const target = path.join(projectPath, 'Assets', 'Prefabs', 'Thing.prefab')
    expect(fs.readFileSync(target)).toEqual(assetBytes)
    expect(fs.readFileSync(`${target}.meta`, 'utf8')).toBe(META_A)
    // preview 不进工程
    expect(fs.existsSync(path.join(projectPath, 'Assets', 'Prefabs', 'preview.png'))).toBe(false)
    // 临时目录已清理
    expect(fs.readdirSync(path.join(projectPath, 'Temp'))).toEqual([])
  })

  it('does not invent a meta file when the package has none', async () => {
    const pkg = path.join(root, 'b.unitypackage')
    buildPackage(pkg, [{ guid: GUID_A, pathname: 'Assets/Thing.mat', asset: 'mat' }])

    const result = await extractUnityPackage({ packagePath: pkg, projectPath })

    expect(result.warnings).toEqual([{ path: 'Assets/Thing.mat', reason: 'missingMeta' }])
    expect(fs.existsSync(path.join(projectPath, 'Assets', 'Thing.mat'))).toBe(true)
    expect(fs.existsSync(path.join(projectPath, 'Assets', 'Thing.mat.meta'))).toBe(false)
  })

  it('rejects the whole package when a target already exists', async () => {
    fs.writeFileSync(path.join(projectPath, 'Assets', 'Taken.prefab'), 'original')
    const pkg = path.join(root, 'c.unitypackage')
    buildPackage(pkg, [
      { guid: GUID_A, pathname: 'Assets/Fresh.prefab', asset: 'fresh', meta: META_A },
      { guid: GUID_B, pathname: 'Assets/Taken.prefab', asset: 'other', meta: META_A }
    ])

    expect(await codeOf(extractUnityPackage({ packagePath: pkg, projectPath }))).toBe(
      'vpmUnityPackageConflict'
    )
    // 冲突前一个都不写：Fresh 也不该出现
    expect(fs.existsSync(path.join(projectPath, 'Assets', 'Fresh.prefab'))).toBe(false)
    // 原文件没被动
    expect(fs.readFileSync(path.join(projectPath, 'Assets', 'Taken.prefab'), 'utf8')).toBe('original')
  })

  it('skips only the conflicting entry when asked to', async () => {
    fs.writeFileSync(path.join(projectPath, 'Assets', 'Taken.prefab'), 'original')
    const pkg = path.join(root, 'd.unitypackage')
    buildPackage(pkg, [
      { guid: GUID_A, pathname: 'Assets/Fresh.prefab', asset: 'fresh', meta: META_A },
      { guid: GUID_B, pathname: 'Assets/Taken.prefab', asset: 'other', meta: META_A }
    ])

    const result = await extractUnityPackage({
      packagePath: pkg,
      projectPath,
      onConflict: 'skip'
    })
    expect(result.applied).toEqual(['Assets/Fresh.prefab'])
    expect(result.skipped).toEqual([{ path: 'Assets/Taken.prefab', reason: 'exists' }])
  })

  it('refuses pathnames that escape Assets', async () => {
    const pkg = path.join(root, 'e.unitypackage')
    buildPackage(pkg, [
      { guid: GUID_A, pathname: 'Assets/../evil.prefab', asset: 'evil', meta: META_A },
      { guid: GUID_B, pathname: '/abs/evil.prefab', asset: 'evil', meta: META_A },
      { guid: GUID_C, pathname: 'Assets/Ok.prefab', asset: 'ok', meta: META_A }
    ])

    const result = await extractUnityPackage({ packagePath: pkg, projectPath })
    expect(result.applied).toEqual(['Assets/Ok.prefab'])
    expect(result.skipped.map((item) => item.reason)).toEqual(['invalidPathname', 'invalidPathname'])
    expect(fs.existsSync(path.join(projectPath, 'evil.prefab'))).toBe(false)
    expect(fs.existsSync(path.join(root, 'evil.prefab'))).toBe(false)
  })

  it('rejects a file that is not a tar.gz', async () => {
    const pkg = path.join(root, 'not-a-package.unitypackage')
    fs.writeFileSync(pkg, 'definitely not a tar')
    expect(await codeOf(extractUnityPackage({ packagePath: pkg, projectPath }))).toBe(
      'vpmUnityPackageInvalid'
    )
  })

  it('enforces the entry limit', async () => {
    const pkg = path.join(root, 'many.unitypackage')
    buildPackage(pkg, [
      { guid: GUID_A, pathname: 'Assets/A.prefab', asset: 'a', meta: META_A },
      { guid: GUID_B, pathname: 'Assets/B.prefab', asset: 'b', meta: META_A }
    ])
    expect(
      await codeOf(extractUnityPackage({ packagePath: pkg, projectPath, maxEntries: 1 }))
    ).toBe('vpmUnityPackageTooLarge')
  })

  it('never writes .meta content of its own (source guard)', () => {
    const source = fs.readFileSync(
      path.join(__dirname, '../../../src/main/vpm/unity/unitypackage.ts'),
      'utf8'
    )
    // 只允许 rename 搬 meta；不允许 writeFile 生成/补写 meta。
    expect(/writeFile(Sync)?\([^)]*\.meta/.test(source)).toBe(false)
    const createSource = fs.readFileSync(
      path.join(__dirname, '../../../src/main/vpm/unity/create.ts'),
      'utf8'
    )
    expect(/writeFile(Sync)?\([^)]*\.meta/.test(createSource)).toBe(false)
  })
})

describe('template attachment port', () => {
  let db: VpmDb
  let templates: TemplateService

  beforeEach(async () => {
    db = await openVpmDb({ file: path.join(root, 'vpm.db'), backupsDir: path.join(root, 'backups') })
    templates = new TemplateService({ db, dataRoot: path.join(root, 'data') })
  })

  afterEach(() => {
    closeVpmDb(db)
  })

  it('extracts every attachment listed by the template', async () => {
    const template = templates.create({
      name: 'With attachments',
      unitypackages: [{ path: 'files/a.unitypackage', name: 'a' }]
    })
    buildPackage(path.join(templates.filesDir(template.id), 'a.unitypackage'), [
      { guid: GUID_A, pathname: 'Assets/A.prefab', asset: 'a', meta: META_A }
    ])

    const port = createTemplateAttachmentPort({ templates })
    const result = await port.apply({
      projectPath,
      templateId: template.id,
      attachments: template.unitypackages
    })

    expect(result.applied).toBe(1)
    expect(result.warnings).toEqual([])
    expect(fs.readFileSync(path.join(projectPath, 'Assets', 'A.prefab'), 'utf8')).toBe('a')
  })

  it('refuses an attachment path that escapes the template files dir', async () => {
    const template = templates.create({ name: 'Escape' })
    const port = createTemplateAttachmentPort({ templates })
    expect(
      await codeOf(
        port.apply({
          projectPath,
          templateId: template.id,
          attachments: [{ path: 'files/../evil.unitypackage', name: null }]
        })
      )
    ).toBe('vpmUnityPackageUnsafe')
  })
})
