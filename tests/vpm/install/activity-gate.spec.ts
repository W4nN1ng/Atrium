import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { cleanupLegacyAssets } from '../../../src/main/vpm/install'
import {
  ProjectActivityRegistry,
  createProjectActivityPort
} from '../../../src/main/project/activity'
import { TxHarness, failAt } from './harness'

let h: TxHarness
let project: string
let registry: ProjectActivityRegistry
let port: ReturnType<typeof createProjectActivityPort>

beforeEach(async () => {
  h = await TxHarness.create()
  project = h.addProject()
  registry = new ProjectActivityRegistry()
  port = createProjectActivityPort(registry)
})

afterEach(() => {
  registry.clear()
  h.dispose()
})

function installPlan(target = project, name = 'com.example.a'): string {
  return h.makePlan(target, {
    catalog: [h.catalogEntry(name, '1.0.0')],
    requests: [{ kind: 'install', name }]
  }).planId
}

describe('package transaction vs asset import', () => {
  it('refuses to write while an import is running', async () => {
    const release = registry.beginImport(project)
    try {
      const result = await h.apply(project, installPlan(), { activity: port })
      expect(result.status).toBe('failed')
      expect(result.errorCode).toBe('vpmProjectImporting')
      expect(h.exists(h.packageDir(project, 'com.example.a'))).toBe(false)
      expect(h.readManifest(project).dependencies).toEqual({})
    } finally {
      release()
    }
  })

  it('refuses when another maintenance lease is held', async () => {
    const lease = registry.acquireMaintenance(project, 'backup')
    try {
      const result = await h.apply(project, installPlan(), { activity: port })
      expect(result.status).toBe('failed')
      expect(result.errorCode).toBe('vpmProjectBusy')
      expect(h.exists(h.packageDir(project, 'com.example.a'))).toBe(false)
    } finally {
      lease.release()
    }
  })

  it('releases the lease after a successful apply, so imports can start again', async () => {
    const result = await h.apply(project, installPlan(), { activity: port })
    expect(result.status).toBe('committed')
    expect(registry.state(project).maintenance).toBeNull()

    // 现在导入可以拿到"没有维护写"的状态。
    const release = registry.beginImport(project)
    expect(registry.state(project).importing).toBe(true)
    let code: string | null = null
    try {
      registry.acquireMaintenance(project, 'install')
    } catch (error) {
      code = (error as { code?: string }).code ?? null
    }
    expect(code).toBe('vpmProjectImporting')
    release()
  })

  it('releases the lease when the transaction fails midway', async () => {
    const planId = installPlan()
    const result = await h.apply(project, planId, {
      activity: port,
      hooks: failAt(['move-in:item:after'])
    })
    expect(result.status).toBe('rolled_back')
    expect(registry.state(project).maintenance).toBeNull()
    expect(h.exists(h.packageDir(project, 'com.example.a'))).toBe(false)
  })

  it('keeps two projects independent', async () => {
    const other = h.addProject('OtherProject')
    const first = installPlan(project, 'com.example.a')
    const second = installPlan(other, 'com.example.b')

    const [a, b] = await Promise.all([
      h.apply(project, first, { activity: port }),
      h.apply(other, second, { activity: port })
    ])
    expect(a.status).toBe('committed')
    expect(b.status).toBe('committed')
    expect(registry.state(project).maintenance).toBeNull()
    expect(registry.state(other).maintenance).toBeNull()
  })

  it('never leaves a stale lease behind when the plan is rejected by preflight', async () => {
    const lease = registry.acquireMaintenance(project, 'install')
    // 让预检自己失败（Unity 运行中）：此时连租约申请都不会走到。
    const result = await h.apply(project, installPlan(), {
      activity: {
        state: () => ({ unityRunning: true, importing: false, maintenance: 'install' }),
        acquireMaintenance: port.acquireMaintenance
      }
    })
    expect(result.status).toBe('failed')
    expect(result.errorCode).toBe('vpmUnityRunning')
    expect(fs.existsSync(h.packageDir(project, 'com.example.a'))).toBe(false)
    lease.release()
  })
})

describe('protected package in legacy cleanup', () => {
  it('never cleans legacy paths declared by the bridge package', async () => {
    fs.mkdirSync(path.join(project, 'Assets', 'Bridge'), { recursive: true })
    fs.writeFileSync(path.join(project, 'Assets', 'Bridge', 'bridge.dll'), 'x')
    h.writeManifest(project, {
      dependencies: { 'com.avca.bridge': '1.2.0' },
      locked: {},
      legacyFolders: { 'com.avca.bridge': 'Assets/Bridge' }
    })
    const trashDir = path.join(project, '.atrium-tx', 'probe', 'trash')
    fs.mkdirSync(trashDir, { recursive: true })

    const result = await cleanupLegacyAssets({
      projectPath: project,
      trashDir,
      snapshot: h.snapshot(project),
      removedPackages: ['com.avca.bridge']
    })

    expect(result.moved).toHaveLength(0)
    expect(result.skipped.some((item) => item.reason === 'protectedPackage')).toBe(true)
    expect(fs.existsSync(path.join(project, 'Assets', 'Bridge', 'bridge.dll'))).toBe(true)
  })

  it('still cleans a normal package declaration', async () => {
    fs.mkdirSync(path.join(project, 'Assets', 'OldThing'), { recursive: true })
    fs.writeFileSync(path.join(project, 'Assets', 'OldThing', 'model.prefab'), 'x')
    h.writeManifest(project, {
      dependencies: { 'com.example.old': '1.0.0' },
      locked: {},
      legacyFolders: { 'com.example.old': 'Assets/OldThing' }
    })
    const trashDir = path.join(project, '.atrium-tx', 'probe', 'trash')
    fs.mkdirSync(trashDir, { recursive: true })

    const result = await cleanupLegacyAssets({
      projectPath: project,
      trashDir,
      snapshot: h.snapshot(project),
      removedPackages: ['com.example.old']
    })

    expect(result.moved.map((item) => item.path)).toEqual(['Assets/OldThing'])
    expect(fs.existsSync(path.join(project, 'Assets', 'OldThing'))).toBe(false)
  })
})
