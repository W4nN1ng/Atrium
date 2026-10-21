import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { ProjectFsReader } from '../../../src/main/vpm/projects/reader'

let root: string
let project: string

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'atrium-vpm-reader-'))
  project = path.join(root, 'Project')
  fs.mkdirSync(path.join(project, 'ProjectSettings'), { recursive: true })
  fs.mkdirSync(path.join(project, 'Packages', 'com.test'), { recursive: true })
  fs.mkdirSync(path.join(project, 'Assets', 'Legacy'), { recursive: true })
  fs.writeFileSync(path.join(project, 'ProjectSettings', 'ProjectVersion.txt'), 'm_EditorVersion: 2022.3.22f1\n')
  fs.writeFileSync(path.join(project, 'Packages', 'com.test', 'package.json'), '{"name":"com.test","version":"1.0.0"}')
  fs.writeFileSync(path.join(project, 'Assets', 'Legacy', 'old.txt'), 'x')
})

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true })
})

describe('ProjectFsReader', () => {
  it('reads files, lists direct children and stats paths inside the project', () => {
    const reader = new ProjectFsReader(project)
    expect(reader.root).toBe(fs.realpathSync.native(project))
    expect(reader.read('ProjectSettings/ProjectVersion.txt')?.text).toContain('2022.3.22f1')
    expect(reader.read('Packages/missing.json')).toBeNull()
    expect(reader.list('Packages')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'com.test', kind: 'dir', symlink: false })
      ])
    )
    expect(reader.stat('Assets/Legacy')).toMatchObject({ kind: 'dir', symlink: false })
    expect(reader.stat('Assets/Legacy/old.txt')).toMatchObject({ kind: 'file', symlink: false })
    expect(reader.stat('Assets/Nope')).toBeNull()
  })

  it('rejects path escapes and non-project roots', () => {
    const reader = new ProjectFsReader(project)
    expect(() => reader.read('../outside.txt')).toThrowError(/vpmProjectAccessDenied/)
    expect(() => reader.list('C:\\Windows')).toThrowError(/vpmProjectAccessDenied/)
    expect(() => reader.stat('/etc/passwd')).toThrowError(/vpmProjectAccessDenied/)
    expect(() => new ProjectFsReader(path.join(root, 'Nope'))).toThrowError(/vpmProjectInvalid/)

    const file = path.join(root, 'not-a-project.txt')
    fs.writeFileSync(file, 'x')
    expect(() => new ProjectFsReader(file)).toThrowError(/vpmProjectInvalid/)
  })
})
