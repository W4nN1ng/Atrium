import { afterAll, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { libraryRootProblem } from '../../src/main/security/libraryRoot'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atrium-library-root-'))
afterAll(() => fs.rmSync(root, { recursive: true, force: true }))
describe('素材库不能选到 Unity 工程里', () => {
  it('拒绝 Unity 工程根目录及内部目录', () => {
    const project = path.join(root, 'Unity')
    fs.mkdirSync(path.join(project, 'ProjectSettings'), { recursive: true })
    fs.writeFileSync(path.join(project, 'ProjectSettings', 'ProjectVersion.txt'), 'm_EditorVersion: 2022.3.22f1')
    expect(libraryRootProblem(project)).toBe('wizard.step1.unityProject')
    expect(libraryRootProblem(path.join(project, 'Assets', 'Materials'))).toBe('wizard.step1.unityProject')
  })
  it('允许专门的素材文件夹和尚未创建的目录', () => {
    expect(libraryRootProblem(path.join(root, '素材库'))).toBeNull()
  })
  it('拒绝盘符根目录', () => {
    expect(libraryRootProblem('C:\\')).toBe('wizard.step1.forbidden')
    expect(libraryRootProblem('C:\\Windows\\System32')).toBe('wizard.step1.forbidden')
    expect(libraryRootProblem('C:\\Users\\..')).toBe('wizard.step1.forbidden')
    expect(libraryRootProblem('C:\\Temp\\..\\Windows\\System32')).toBe('wizard.step1.forbidden')
  })
})
