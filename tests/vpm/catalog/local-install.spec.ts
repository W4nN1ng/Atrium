import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { LocalInstallService } from '../../../src/main/vpm/catalog/localInstall'
import type { LocalPackage, LocalPackageStore } from '../../../src/main/vpm/catalog/local'
import type { ProjectsService } from '../../../src/main/vpm/projects'

let root: string
let projectPath: string
let packageRoot: string

function writePackage(dir: string, manifest: Record<string, unknown>): void {
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(manifest, null, 2))
  fs.writeFileSync(path.join(dir, 'index.js'), '// body')
}

function localStore(packages: Array<{ name: string; version: string; path: string }>): LocalPackageStore {
  return {
    scanAll: () =>
      packages.map(
        (pkg): LocalPackage & { rootId: string } => ({
          ...pkg,
          displayName: null,
          description: null,
          unity: '2022.3',
          dependencies: {},
          hash: 'h',
          rootId: 'root-1'
        })
      )
  } as unknown as LocalPackageStore
}

function service(
  packages: Array<{ name: string; version: string; path: string }>,
  running = false
): LocalInstallService {
  return new LocalInstallService({
    projects: {
      get: () => ({ projectKey: 'k', name: 'Demo', path: projectPath, running })
    } as unknown as ProjectsService,
    local: localStore(packages)
  })
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'atrium-localinstall-'))
  projectPath = path.join(root, 'project')
  fs.mkdirSync(path.join(projectPath, 'Packages'), { recursive: true })
  fs.writeFileSync(path.join(projectPath, 'Packages', 'manifest.json'), '{}\n')
  packageRoot = path.join(root, 'local')
  writePackage(path.join(packageRoot, 'com.example.a'), { name: 'com.example.a', version: '1.2.0' })
})

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true })
})

describe('local install (P7-C)', () => {
  it('copies the package into Packages/ and writes the manifest entry', () => {
    const svc = service([{ name: 'com.example.a', version: '1.2.0', path: path.join(packageRoot, 'com.example.a') }])
    const result = svc.install({ projectKey: 'k', packageName: 'com.example.a' })

    expect(result.version).toBe('1.2.0')
    const installed = path.join(projectPath, 'Packages', 'com.example.a')
    expect(fs.existsSync(path.join(installed, 'index.js'))).toBe(true)

    const manifest = JSON.parse(
      fs.readFileSync(path.join(projectPath, 'Packages', 'vpm-manifest.json'), 'utf8')
    ) as { dependencies: Record<string, string> }
    expect(manifest.dependencies['com.example.a']).toBe('1.2.0')
    // 不留临时目录
    expect(fs.readdirSync(path.join(projectPath, 'Packages')).filter((n) => n.startsWith('.atrium-local'))).toEqual([])
  })

  it('picks the highest version when several roots have the same package', () => {
    // 两个不同目录、不同版本（同一目录里不可能有两个版本）
    const older = path.join(root, 'local-old', 'com.example.a')
    writePackage(older, { name: 'com.example.a', version: '1.0.0' })
    const newer = path.join(packageRoot, 'com.example.a')
    writePackage(newer, { name: 'com.example.a', version: '1.10.0' })

    const svc = service([
      { name: 'com.example.a', version: '1.0.0', path: older },
      { name: 'com.example.a', version: '1.10.0', path: newer }
    ])
    expect(svc.install({ projectKey: 'k', packageName: 'com.example.a' }).version).toBe('1.10.0')
  })

  it('refuses when the package is already installed in the project', () => {
    fs.mkdirSync(path.join(projectPath, 'Packages', 'com.example.a'))
    const svc = service([{ name: 'com.example.a', version: '1.2.0', path: path.join(packageRoot, 'com.example.a') }])
    expect(() => svc.install({ projectKey: 'k', packageName: 'com.example.a' })).toThrow(
      expect.objectContaining({ code: 'vpmLocalRootInvalid' })
    )
  })

  it('refuses while Unity is running and for unknown packages', () => {
    const pkg = { name: 'com.example.a', version: '1.2.0', path: path.join(packageRoot, 'com.example.a') }
    expect(() => service([pkg], true).install({ projectKey: 'k', packageName: 'com.example.a' })).toThrow(
      expect.objectContaining({ code: 'vpmUnityRunning' })
    )
    expect(() => service([]).install({ projectKey: 'k', packageName: 'com.example.a' })).toThrow(
      expect.objectContaining({ code: 'vpmLocalRootInvalid' })
    )
  })

  it('plan() reports why an install would fail', () => {
    const svc = service([{ name: 'com.example.a', version: '1.2.0', path: path.join(packageRoot, 'com.example.a') }])
    expect(svc.plan({ projectKey: 'k', packageName: 'com.example.a' })).toMatchObject({ ok: true })
    expect(svc.plan({ projectKey: 'k', packageName: 'com.example.b' })).toMatchObject({
      ok: false,
      reason: 'notFound'
    })
    fs.mkdirSync(path.join(projectPath, 'Packages', 'com.example.a'))
    expect(svc.plan({ projectKey: 'k', packageName: 'com.example.a' })).toMatchObject({
      ok: false,
      reason: 'targetExists'
    })
  })
})
