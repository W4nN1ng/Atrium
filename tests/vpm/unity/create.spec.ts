import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { closeVpmDb, openVpmDb, type VpmDb } from '../../../src/main/vpm/db'
import { TemplateService } from '../../../src/main/vpm/templates'
import { VaultStore } from '../../../src/main/vpm/vault'
import {
  ProjectCreateService,
  type CreateProjectInput,
  type TemplateAttachmentPort
} from '../../../src/main/vpm/unity/create'
import type { ProjectsService } from '../../../src/main/vpm/projects'
import type { PlanService } from '../../../src/main/vpm/planService'
import type { InstallTransactionService } from '../../../src/main/vpm/install'
import { RecentLocationStore } from '../../../src/main/vpm/projects'

let root: string
let dataRoot: string
let parent: string
let db: VpmDb
let templates: TemplateService
let addExisting: ReturnType<typeof vi.fn>
let resolve: ReturnType<typeof vi.fn>
let apply: ReturnType<typeof vi.fn>

function makeService(options: { attachments?: TemplateAttachmentPort; installed?: string[] } = {}): ProjectCreateService {
  return new ProjectCreateService({
    templates,
    dataRoot,
    vault: new VaultStore({ dataRoot }),
    projects: { addExisting } as unknown as ProjectsService,
    plans: { resolve } as unknown as PlanService,
    transactions: { apply } as unknown as InstallTransactionService,
    forbiddenRoots: () => [dataRoot],
    installedUnityVersions: () => options.installed ?? ['2022.3.22f1'],
    ...(options.attachments ? { attachments: options.attachments } : {})
  })
}

function input(overrides: Partial<CreateProjectInput> = {}): CreateProjectInput {
  return {
    parentDir: parent,
    name: 'DemoProject',
    unityVersion: '2022.3.22f1',
    templateId: 'builtin.blank',
    ...overrides
  }
}

function codes(validation: { issues: Array<{ code: string }> }): string[] {
  return validation.issues.map((item) => item.code)
}

beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'atrium-create-'))
  dataRoot = path.join(root, 'data')
  parent = path.join(root, 'projects')
  fs.mkdirSync(dataRoot)
  fs.mkdirSync(parent)
  db = await openVpmDb({ file: path.join(root, 'vpm.db'), backupsDir: path.join(root, 'backups') })
  templates = new TemplateService({ db, dataRoot })
  addExisting = vi.fn()
  resolve = vi.fn()
  apply = vi.fn()
})

afterEach(() => {
  closeVpmDb(db)
  fs.rmSync(root, { recursive: true, force: true })
})

describe('create validation', () => {
  it('accepts a clean input', () => {
    const service = makeService()
    const validation = service.validate(input())
    expect(validation.ok).toBe(true)
    expect(validation.targetPath).toBe(path.join(parent, 'DemoProject'))
    expect(validation.templateName).toBe('空白工程')
  })

  it('rejects missing / non-directory / unwritable parents', () => {
    const service = makeService()
    expect(codes(service.validate(input({ parentDir: path.join(root, 'nope') })))).toContain('parentMissing')

    const file = path.join(root, 'file.txt')
    fs.writeFileSync(file, 'x')
    expect(codes(service.validate(input({ parentDir: file })))).toContain('parentNotDirectory')
  })

  it('rejects a parent inside an existing Unity project', () => {
    const projectRoot = path.join(root, 'Existing')
    fs.mkdirSync(path.join(projectRoot, 'ProjectSettings'), { recursive: true })
    fs.writeFileSync(path.join(projectRoot, 'ProjectSettings', 'ProjectVersion.txt'), 'm_EditorVersion: 2022.3.22f1\n')
    const nested = path.join(projectRoot, 'nested')
    fs.mkdirSync(nested)
    expect(codes(makeService().validate(input({ parentDir: nested })))).toContain('parentInsideProject')
  })

  it('rejects parents inside forbidden roots', () => {
    const inside = path.join(dataRoot, 'nested')
    fs.mkdirSync(inside)
    expect(codes(makeService().validate(input({ parentDir: inside })))).toContain('parentUnsafe')
  })

  it('rejects illegal, reserved, trailing and too-long names', () => {
    const service = makeService()
    expect(codes(service.validate(input({ name: 'bad:name' })))).toContain('nameIllegal')
    expect(codes(service.validate(input({ name: 'CON' })))).toContain('nameReserved')
    expect(codes(service.validate(input({ name: 'com1.txt' })))).toContain('nameReserved')
    expect(codes(service.validate(input({ name: 'trailing.' })))).toContain('nameTrailing')
    expect(codes(service.validate(input({ name: ' leading' })))).toContain('nameTrailing')
    expect(codes(service.validate(input({ name: 'x'.repeat(81) })))).toContain('nameTooLong')
    expect(codes(service.validate(input({ name: '' })))).toContain('nameEmpty')
    expect(codes(service.validate(input({ name: '..' })))).toContain('nameIllegal')
  })

  it('rejects an existing target, even an empty directory', () => {
    fs.mkdirSync(path.join(parent, 'DemoProject'))
    expect(codes(makeService().validate(input()))).toContain('targetExists')
  })

  it('rejects a target path over the policy limit', () => {
    const deep = path.join(root, 'x'.repeat(200))
    fs.mkdirSync(deep)
    const validation = makeService().validate(input({ parentDir: deep, name: 'y'.repeat(60) }))
    expect(codes(validation)).toContain('longPath')
  })

  it('rejects unknown or uninstalled Unity versions', () => {
    expect(codes(makeService().validate(input({ unityVersion: 'not-a-version' })))).toContain(
      'unityVersionInvalid'
    )
    expect(
      codes(makeService({ installed: ['2021.3.0f1'] }).validate(input()))
    ).toContain('unityVersionMissing')
    // 没探测到任何编辑器时只给警告，不硬拒
    const warned = makeService({ installed: [] }).validate(input())
    expect(warned.ok).toBe(true)
    expect(warned.warnings.map((item) => item.code)).toContain('unityVersionUnverified')
  })

  it('rejects templates with attachments until P5-C injects a port', () => {
    const created = templates.create({
      name: 'With files',
      unitypackages: [{ path: 'files/a.unitypackage', name: 'a' }]
    })
    expect(codes(makeService().validate(input({ templateId: created.id })))).toContain(
      'attachmentsUnsupported'
    )
  })
})

describe('create project', () => {
  it('builds the minimal skeleton without meta files or ProjectSettings.asset', async () => {
    const service = makeService()
    const result = await service.create(input())

    expect(result.projectPath).toBe(path.join(parent, 'DemoProject'))
    expect(result.dependencyStatus).toBe('none')
    const projectPath = result.projectPath
    for (const dir of ['Assets', 'Packages', 'ProjectSettings']) {
      expect(fs.statSync(path.join(projectPath, dir)).isDirectory()).toBe(true)
    }
    const versionFile = fs.readFileSync(path.join(projectPath, 'ProjectSettings', 'ProjectVersion.txt'), 'utf8')
    expect(versionFile).toBe('m_EditorVersion: 2022.3.22f1\n')
    expect(fs.existsSync(path.join(projectPath, 'ProjectSettings', 'ProjectSettings.asset'))).toBe(false)

    const metaFiles = fs.readdirSync(projectPath, { recursive: true }) as string[]
    expect(metaFiles.filter((name) => name.endsWith('.meta'))).toEqual([])

    const manifest = JSON.parse(
      fs.readFileSync(path.join(projectPath, 'Packages', 'vpm-manifest.json'), 'utf8')
    ) as { dependencies: Record<string, string>; locked: Record<string, unknown> }
    expect(manifest).toEqual({ dependencies: {}, locked: {} })

    expect(addExisting).toHaveBeenCalledWith(projectPath)
    expect(resolve).not.toHaveBeenCalled()
    expect(templates.recentLocations(1)[0].path).toBe(parent)
  })

  it('writes the revision line when known', async () => {
    const result = await makeService().create(input({ unityRevision: '887be4894c44' }))
    expect(
      fs.readFileSync(path.join(result.projectPath, 'ProjectSettings', 'ProjectVersion.txt'), 'utf8')
    ).toBe('m_EditorVersion: 2022.3.22f1\nm_EditorVersionWithRevision: 2022.3.22f1 (887be4894c44)\n')
  })

  it('installs template dependencies through the normal plan + transaction', async () => {
    resolve.mockReturnValue({ planId: 'plan-1' })
    apply.mockResolvedValue({ operationId: 'op-1', status: 'committed', errorCode: null })

    const result = await makeService().create(input({ templateId: 'builtin.avatars' }))

    expect(result.dependencyStatus).toBe('installed')
    expect(result.operationId).toBe('op-1')
    expect(resolve).toHaveBeenCalledWith(
      expect.objectContaining({
        requests: [
          { kind: 'install', name: 'com.vrchat.avatars', range: '>=3.0.0 <4.0.0' }
        ]
      })
    )
    const manifest = JSON.parse(
      fs.readFileSync(path.join(result.projectPath, 'Packages', 'vpm-manifest.json'), 'utf8')
    ) as { dependencies: Record<string, string> }
    expect(manifest.dependencies).toEqual({ 'com.vrchat.avatars': '>=3.0.0 <4.0.0' })
  })

  it('keeps the project when dependency installation fails', async () => {
    resolve.mockReturnValue({ planId: 'plan-1' })
    apply.mockResolvedValue({
      operationId: 'op-2',
      status: 'rolled_back',
      errorCode: 'vpmProjectChanged'
    })

    const result = await makeService().create(input({ templateId: 'builtin.avatars' }))
    expect(result.dependencyStatus).toBe('failed')
    expect(result.errorCode).toBe('vpmProjectChanged')
    expect(result.warnings.map((item) => item.code)).toContain('dependenciesFailed')
    // 工程保留，骨架还在
    expect(fs.existsSync(path.join(result.projectPath, 'Packages', 'vpm-manifest.json'))).toBe(true)
  })

  it('keeps the project when resolving the plan throws', async () => {
    resolve.mockImplementation(() => {
      throw Object.assign(new Error('boom'), { code: 'vpmResolutionFailed' })
    })
    const result = await makeService().create(input({ templateId: 'builtin.worlds' }))
    expect(result.dependencyStatus).toBe('failed')
    expect(result.errorCode).toBe('vpmResolutionFailed')
  })

  it('parks a failed temporary directory instead of deleting it', async () => {
    const created = templates.create({
      name: 'With files',
      unitypackages: [{ path: 'files/a.unitypackage', name: 'a' }]
    })
    fs.writeFileSync(path.join(templates.filesDir(created.id), 'a.unitypackage'), 'x')
    const attachments: TemplateAttachmentPort = {
      apply: async () => {
        throw new Error('attachment boom')
      }
    }

    await expect(
      makeService({ attachments }).create(input({ templateId: created.id }))
    ).rejects.toMatchObject({ code: 'vpmCreateFailed' })

    // 目标目录没有出现
    expect(fs.existsSync(path.join(parent, 'DemoProject'))).toBe(false)
    // 临时目录被挪走（回滚仓可用时进 create-failed/，否则退到父目录旁的隐藏目录），
    // 但绝不删掉。
    const parked = [
      ...(fs.existsSync(path.join(dataRoot, 'vault'))
        ? (fs.readdirSync(path.join(dataRoot, 'vault'), { recursive: true }) as string[]).map(String)
        : []),
      ...fs.readdirSync(parent)
    ].filter((name) => name.includes('create-failed'))
    expect(parked.length).toBeGreaterThan(0)
    // 临时目录已经不在原位置了
    expect(
      fs.readdirSync(parent).filter((name) => name.startsWith('.atrium-create-') && !name.includes('failed'))
    ).toEqual([])
    expect(addExisting).not.toHaveBeenCalled()
  })

  it('applies attachments when a port is provided', async () => {
    const created = templates.create({
      name: 'With files',
      unitypackages: [{ path: 'files/a.unitypackage', name: 'a' }]
    })
    fs.writeFileSync(path.join(templates.filesDir(created.id), 'a.unitypackage'), 'x')
    const applyAttachments = vi.fn(async ({ projectPath }: { projectPath: string }) => {
      fs.writeFileSync(path.join(projectPath, 'Assets', 'copied.txt'), 'ok')
      return { applied: 1, warnings: [] }
    })

    const result = await makeService({ attachments: { apply: applyAttachments } }).create(
      input({ templateId: created.id })
    )
    expect(applyAttachments).toHaveBeenCalled()
    expect(fs.existsSync(path.join(result.projectPath, 'Assets', 'copied.txt'))).toBe(true)
  })

  it('refuses to create over an existing directory', async () => {
    fs.mkdirSync(path.join(parent, 'DemoProject'))
    await expect(makeService().create(input())).rejects.toMatchObject({ code: 'vpmCreateRejected' })
    expect(addExisting).not.toHaveBeenCalled()
  })
})

describe('recent locations', () => {
  it('keeps the newest eight and is stored in vpm.db, not core settings', () => {
    const store = new RecentLocationStore(db)
    for (let index = 0; index < 12; index++) store.record(`C:\\p${index}`)
    const list = store.list()
    expect(list).toHaveLength(8)
    expect(list[0].path).toBe('C:\\p11')
    store.remove('C:\\p11')
    expect(store.list().map((item) => item.path)).not.toContain('C:\\p11')
    store.clear()
    expect(store.list()).toEqual([])
  })
})
