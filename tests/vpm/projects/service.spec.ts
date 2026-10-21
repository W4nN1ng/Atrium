import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { closeVpmDb, openVpmDb, type VpmDb } from '../../../src/main/vpm/db'
import {
  ProjectLedgerStore,
  ProjectsService,
  type CoreProjectInput,
  type CoreProjectSummary,
  type ProjectCorePort,
  type VccProjectSource
} from '../../../src/main/vpm/projects'

let root: string
let db: VpmDb | null
let ledger: ProjectLedgerStore
let coreProjects: CoreProjectSummary[]
let core: ProjectCorePort
let service: ProjectsService

function write(file: string, text: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, text)
}

function makeProject(name: string, version = '2022.3.22f1'): string {
  const project = path.join(root, name)
  write(path.join(project, 'ProjectSettings', 'ProjectVersion.txt'), `m_EditorVersion: ${version}\n`)
  write(
    path.join(project, 'Packages', 'vpm-manifest.json'),
    JSON.stringify({
      dependencies: { 'com.test.pkg': '1.0.0' },
      legacyFolders: { 'com.legacy': 'Legacy' }
    })
  )
  write(
    path.join(project, 'Packages', 'com.test.pkg', 'package.json'),
    JSON.stringify({ name: 'com.test.pkg', version: '1.0.0' })
  )
  write(path.join(project, 'Assets', 'Legacy', 'old.txt'), 'x')
  write(
    path.join(project, 'Assets', 'Legacy', 'package.json'),
    JSON.stringify({ name: 'com.legacy', version: '0.1.0' })
  )
  return project
}

beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'atrium-vpm-projects-'))
  db = await openVpmDb({
    file: path.join(root, 'vpm', 'vpm.db'),
    backupsDir: path.join(root, 'backups')
  })
  ledger = new ProjectLedgerStore(db)
  coreProjects = []
  core = {
    list: () => coreProjects.map((project) => ({ ...project, detectedBy: [...project.detectedBy] })),
    register: (input: CoreProjectInput) => {
      const existing = coreProjects.find((project) => project.path.toLowerCase() === input.path.toLowerCase())
      if (existing) {
        existing.name = input.name
        existing.unityVersion = input.unityVersion
        return { ...existing, detectedBy: [...existing.detectedBy] }
      }
      const created: CoreProjectSummary = {
        id: `core-${coreProjects.length + 1}`,
        path: input.path,
        name: input.name,
        unityVersion: input.unityVersion,
        running: false,
        detectedBy: ['scan'],
        bridgeVersion: null
      }
      coreProjects.push(created)
      return created
    }
  }
  service = new ProjectsService({ ledger, core })
})

afterEach(() => {
  closeVpmDb(db)
  db = null
  fs.rmSync(root, { recursive: true, force: true })
})

describe('ProjectsService', () => {
  it('adds an existing project, registers it with core and stores the snapshot', () => {
    const project = makeProject('Alpha')
    const result = service.addExisting(project)

    expect(result.snapshot).toMatchObject({ name: 'Alpha', unityVersion: '2022.3.22f1' })
    expect(result.core).toMatchObject({ id: 'core-1', path: result.snapshot.projectPath })
    expect(ledger.getByPath(project)).toMatchObject({
      name: 'Alpha',
      unityVersion: '2022.3.22f1',
      packages: expect.arrayContaining([
        expect.objectContaining({ name: 'com.test.pkg', state: 'installed', isLegacy: false }),
        expect.objectContaining({ name: 'com.legacy', isLegacy: true, state: 'legacy' })
      ])
    })

    const list = service.list()
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({
      coreId: 'core-1',
      name: 'Alpha',
      running: false,
      linked: true,
      ledger: expect.objectContaining({ name: 'Alpha' })
    })
    expect(service.detail(list[0].projectKey)?.snapshot).toMatchObject({
      name: 'Alpha',
      packages: expect.arrayContaining([expect.objectContaining({ name: 'com.test.pkg' })])
    })
  })

  it('keeps a ledger row after core/disk disappear, but marks it unlinked', () => {
    const project = makeProject('Alpha')
    service.addExisting(project)
    coreProjects.length = 0

    const list = service.list()
    expect(list[0]).toMatchObject({ coreId: null, linked: false, name: 'Alpha' })

    fs.rmSync(project, { recursive: true, force: true })
    expect(list[0].ledger?.lastScanAt).toBeTypeOf('number')
    expect(() => service.refresh(list[0].projectKey)).toThrowError(/vpmProjectInvalid/)
  })

  it('refreshes a changed project and preserves the core running state', () => {
    const project = makeProject('Alpha')
    service.addExisting(project)
    coreProjects[0].running = true
    coreProjects[0].detectedBy = ['bridge']
    write(
      path.join(project, 'Packages', 'com.test.pkg', 'package.json'),
      JSON.stringify({ name: 'com.test.pkg', version: '1.0.1' })
    )

    const key = service.list()[0].projectKey
    const refreshed = service.refresh(key)
    expect(refreshed.ledger.packages).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'com.test.pkg', version: '1.0.1', state: 'mismatch' })])
    )
    expect(service.list()[0]).toMatchObject({
      running: true,
      detectedBy: ['bridge'],
      ledger: expect.objectContaining({ projectKey: key })
    })
  })

  it('removes only the VPM ledger row, never the core project or files', () => {
    const project = makeProject('Alpha')
    service.addExisting(project)
    const key = service.list()[0].projectKey
    expect(service.remove(key)).toBe(true)

    expect(fs.existsSync(path.join(project, 'ProjectSettings', 'ProjectVersion.txt'))).toBe(true)
    expect(coreProjects).toHaveLength(1)
    const list = service.list()
    expect(list[0]).toMatchObject({ coreId: 'core-1', linked: true, ledger: null })
    expect(ledger.list()).toEqual([])
  })

  it('imports VCC projects read-only, skips duplicates/bad paths and reports errors', () => {
    const a = makeProject('Alpha')
    const b = makeProject('Beta')
    const vccFile = path.join(root, 'vcc-settings.json')
    const vccText = JSON.stringify({ userProjects: [a, b] })
    write(vccFile, vccText)
    const source: VccProjectSource = {
      read: () => ({
        paths: [a, b, a.toUpperCase(), 'relative\\Nope'],
        error: null
      })
    }
    service = new ProjectsService({ ledger, core, vcc: source })

    const result = service.importVcc()
    expect(result).toMatchObject({ imported: 2, skipped: 2, sourceError: null })
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0].code).toBe('vpmProjectInvalid')
    expect(service.list().map((item) => item.name)).toEqual(['Alpha', 'Beta'])
    expect(fs.readFileSync(vccFile, 'utf8')).toBe(vccText)

    const failed = new ProjectsService({
      ledger,
      core,
      vcc: { read: () => { throw new Error('vcc offline') } }
    }).importVcc()
    expect(failed.sourceError).toBe('vcc offline')
  })

  it('preserves ledger fields not supplied by later scans', () => {
    const project = makeProject('Alpha')
    const snapshot = service.scan(project)
    const first = ledger.upsertSnapshot(snapshot, {
      unityExePath: 'E:\\Unity\\2022.3.22f1\\Editor\\Unity.exe',
      unityArgsJson: '["-nographics"]',
      lastOpId: 'op-1'
    })
    const second = ledger.upsertSnapshot(service.scan(project))
    expect(second).toMatchObject({
      unityExePath: first.unityExePath,
      unityArgsJson: first.unityArgsJson,
      lastOpId: 'op-1',
      createdAt: first.createdAt
    })
  })
})
