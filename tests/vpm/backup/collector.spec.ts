import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  collectProjectFiles,
  isExcluded,
  readManagedPackages
} from '../../../src/main/vpm/backup/collector'

let root: string

function writeTree(files: Record<string, string>): void {
  for (const [relative, content] of Object.entries(files)) {
    const absolute = path.join(root, ...relative.split('/'))
    fs.mkdirSync(path.dirname(absolute), { recursive: true })
    fs.writeFileSync(absolute, content)
  }
}

function names(result: { files: Array<{ relativePath: string }> }): string[] {
  return result.files.map((item) => item.relativePath)
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'atrium-collect-'))
  writeTree({
    'Assets/a.txt': 'a',
    'Assets/.hidden': 'h',
    'Assets/sub/b.prefab': 'bb',
    'Assets/Logs/keep.txt': 'kept: Logs is only excluded at the root',
    'Logs/Editor.log': 'log',
    'Temp/tmp.bin': 'tmp',
    'obj/Debug/x.dll': 'obj',
    '.git/config': 'git',
    '.atrium-tx/op/journal': 'tx',
    'Library/ArtifactDB/x': 'lib',
    'Library/LastSceneManagerSetup.txt': 'scene',
    'ProjectSettings/ProjectVersion.txt': 'm_EditorVersion: 2022.3.22f1\n',
    'Packages/manifest.json': '{}',
    'Packages/vpm-manifest.json': JSON.stringify({
      dependencies: { 'com.vpm.managed': '1.0.0' },
      locked: { 'com.vpm.locked': { version: '2.0.0' } }
    }),
    'Packages/com.vpm.managed/package.json': '{}',
    'Packages/com.vpm.locked/package.json': '{}',
    'Packages/local.pkg/package.json': '{}'
  })
})

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true })
})

describe('isExcluded', () => {
  const none = new Set<string>()

  it('excludes root-level build/temp folders only at the root', () => {
    expect(isExcluded('Logs/Editor.log', 0, none)).toBe(true)
    expect(isExcluded('Temp/x', 0, none)).toBe(true)
    expect(isExcluded('obj/x', 0, none)).toBe(true)
    expect(isExcluded('.atrium-tx/op', 0, none)).toBe(true)
    // 非根目录下的同名目录保留
    expect(isExcluded('Assets/Logs/keep.txt', 1, none)).toBe(false)
    expect(isExcluded('Assets/Temp/x', 1, none)).toBe(false)
  })

  it('excludes .git at any depth', () => {
    expect(isExcluded('.git/config', 0, none)).toBe(true)
    expect(isExcluded('Assets/sub/.git/config', 2, none)).toBe(true)
  })

  it('excludes every Library* folder but keeps the last scene setup file', () => {
    expect(isExcluded('Library/ArtifactDB/x', 0, none)).toBe(true)
    expect(isExcluded('Library2022/x', 0, none)).toBe(true)
    expect(isExcluded('Library/LastSceneManagerSetup.txt', 0, none)).toBe(false)
  })

  it('never excludes the files that must survive', () => {
    expect(isExcluded('Packages/manifest.json', 0, none)).toBe(false)
    expect(isExcluded('Packages/vpm-manifest.json', 0, none)).toBe(false)
    expect(isExcluded('ProjectSettings/ProjectVersion.txt', 0, none)).toBe(false)
  })

  it('excludes managed VPM packages only when asked', () => {
    const managed = new Set(['com.vpm.managed'])
    expect(isExcluded('Packages/com.vpm.managed/package.json', 0, managed)).toBe(true)
    expect(isExcluded('Packages/local.pkg/package.json', 0, managed)).toBe(false)
    expect(isExcluded('Packages/manifest.json', 0, managed)).toBe(false)
    expect(isExcluded('Packages/com.vpm.managed/package.json', 0, none)).toBe(false)
  })
})

describe('collectProjectFiles', () => {
  it('collects the project tree with the documented exclusions', async () => {
    const result = await collectProjectFiles({ root, mode: 'backup' })
    expect(names(result)).toEqual([
      'Assets/.hidden',
      'Assets/Logs/keep.txt',
      'Assets/a.txt',
      'Assets/sub/b.prefab',
      'Library/LastSceneManagerSetup.txt',
      'Packages/com.vpm.locked/package.json',
      'Packages/com.vpm.managed/package.json',
      'Packages/local.pkg/package.json',
      'Packages/manifest.json',
      'Packages/vpm-manifest.json',
      'ProjectSettings/ProjectVersion.txt'
    ])
    expect(result.truncated).toBe(false)
    expect(result.fileCount).toBe(11)
    expect(result.byteCount).toBeGreaterThan(0)
    expect(result.directories.map((item) => item.relativePath)).toEqual(
      expect.arrayContaining(['Assets', 'Assets/sub', 'Packages', 'ProjectSettings'])
    )
  })

  it('excludes managed VPM packages but keeps local ones and the manifests', async () => {
    const result = await collectProjectFiles({ root, mode: 'copy', excludeVpmPackages: true })
    const list = names(result)
    expect(list).not.toContain('Packages/com.vpm.managed/package.json')
    expect(list).not.toContain('Packages/com.vpm.locked/package.json')
    expect(list).toContain('Packages/local.pkg/package.json')
    expect(list).toContain('Packages/manifest.json')
    expect(list).toContain('Packages/vpm-manifest.json')
    expect(result.mode).toBe('copy')
  })

  it('reads managed package names defensively', async () => {
    const managed = await readManagedPackages(root)
    expect([...managed].sort()).toEqual(['com.vpm.locked', 'com.vpm.managed'])
    fs.writeFileSync(path.join(root, 'Packages', 'vpm-manifest.json'), '{')
    expect(await readManagedPackages(root)).toEqual(new Set())
  })

  it('does not follow symlinks and reports them', async () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'atrium-outside-'))
    fs.writeFileSync(path.join(outside, 'secret.txt'), 'secret')
    const link = path.join(root, 'Assets', 'linked')
    let linked = true
    try {
      // Windows 上 junction 不需要管理员权限
      fs.symlinkSync(outside, link, 'junction')
    } catch {
      linked = false
    }
    try {
      if (!linked) return
      const result = await collectProjectFiles({ root, mode: 'backup' })
      expect(names(result)).not.toContain('Assets/linked/secret.txt')
      expect(result.warnings.some((item) => item.reason === 'symlink')).toBe(true)
    } finally {
      fs.rmSync(outside, { recursive: true, force: true })
    }
  })

  it('stops immediately when cancelled', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(
      collectProjectFiles({ root, mode: 'backup', signal: controller.signal })
    ).rejects.toMatchObject({ code: 'vpmCollectCancelled' })
  })

  it('produces a stable order across runs', async () => {
    const first = await collectProjectFiles({ root, mode: 'backup' })
    const second = await collectProjectFiles({ root, mode: 'backup' })
    expect(names(first)).toEqual(names(second))
    expect(first.files.map((item) => item.size)).toEqual(second.files.map((item) => item.size))
  })

  it('flags truncation instead of silently returning a partial list', async () => {
    const result = await collectProjectFiles({ root, mode: 'backup', maxFiles: 2 })
    expect(result.truncated).toBe(true)
    expect(result.warnings.some((item) => item.reason === 'truncated')).toBe(true)
    expect(result.fileCount).toBeLessThanOrEqual(3)
  })

  it('reports progress', async () => {
    const seen: number[] = []
    await collectProjectFiles({
      root,
      mode: 'backup',
      progressIntervalMs: 0,
      onProgress: (progress) => seen.push(progress.files)
    })
    expect(seen.length).toBeGreaterThan(1)
    expect(seen[0]).toBe(0)
    expect(seen[seen.length - 1]).toBeGreaterThan(0)
  })

  it('rejects a missing root', async () => {
    await expect(
      collectProjectFiles({ root: path.join(root, 'nope'), mode: 'backup' })
    ).rejects.toMatchObject({ code: 'vpmProjectInvalid' })
  })
})
