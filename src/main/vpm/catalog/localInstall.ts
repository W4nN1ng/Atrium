import fs from 'node:fs'
import path from 'node:path'
import { VpmError } from '../../../shared/vpm/errors'
import type { ProjectActivityPort } from '../../../shared/vpm/linkage'
import { ulid } from '../../../shared/ulid'
import type { ProjectsService } from '../projects'
import type { LocalPackage, LocalPackageStore } from './local'

/**
 * 把本地包目录装进工程（P7-C 第四批）。
 *
 * 为什么**不走 zip 事务**：事务的 download/extract 两步假设"下载 zip + sha256 校验"，
 * 而本地包既没有 zip 也没有远端 hash（内容就是磁盘上那份目录）。硬塞进去会把
 * 两条完全不同的失败路径搅在一起。
 *
 * 所以这里是一条独立的、同样保守的路径：
 *   校验工程 → 解析包 → 目标不能已存在 → 拿维护租约 → 拷贝到临时目录 → rename
 *   → 最后一步才写 `Packages/vpm-manifest.json`（提交点）
 * 任何一步失败：删临时目录；manifest 没写就等同于没发生。
 */

export interface LocalInstallInput {
  projectKey: string
  packageName: string
}

export interface LocalInstallResult {
  name: string
  version: string
  installedAt: string
}

export interface LocalInstallDeps {
  projects: ProjectsService
  local: LocalPackageStore
  activity?: ProjectActivityPort
}

const PACKAGE_NAME = /^[a-z0-9][a-z0-9._-]*\.[a-z0-9][a-z0-9._-]*$/

function pickHighest(packages: LocalPackage[]): LocalPackage {
  return [...packages].sort((a, b) => b.version.localeCompare(a.version, 'en', { numeric: true }))[0]
}

function copyTree(source: string, target: string): void {
  fs.mkdirSync(target, { recursive: true })
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const from = path.join(source, entry.name)
    const to = path.join(target, entry.name)
    if (entry.isSymbolicLink()) continue
    if (entry.isDirectory()) copyTree(from, to)
    else if (entry.isFile()) fs.copyFileSync(from, to)
  }
}

export class LocalInstallService {
  constructor(private readonly deps: LocalInstallDeps) {}

  /** 预演：告诉界面"这个包能不能装、装到哪、版本多少"。 */
  plan(input: { projectKey: string; packageName: string }): {
    ok: boolean
    reason: string | null
    package: LocalPackage | null
    target: string
  } {
    const project = this.deps.projects.get(input.projectKey)
    if (!project) return { ok: false, reason: 'projectMissing', package: null, target: '' }
    const target = path.join(project.path, 'Packages', input.packageName)
    if (!PACKAGE_NAME.test(input.packageName)) {
      return { ok: false, reason: 'nameInvalid', package: null, target }
    }
    const matches = this.deps.local.scanAll().filter((pkg) => pkg.name === input.packageName)
    if (matches.length === 0) return { ok: false, reason: 'notFound', package: null, target }
    if (fs.existsSync(target)) {
      return { ok: false, reason: 'targetExists', package: pickHighest(matches), target }
    }
    return { ok: true, reason: null, package: pickHighest(matches), target }
  }

  install(input: LocalInstallInput): LocalInstallResult {
    const project = this.deps.projects.get(input.projectKey)
    if (!project) throw new VpmError('vpmProjectInvalid', { field: 'projectKey' })
    if (project.running) throw new VpmError('vpmUnityRunning', { kind: 'install' })
    if (!PACKAGE_NAME.test(input.packageName)) {
      throw new VpmError('vpmLocalRootInvalid', { reason: 'nameInvalid' })
    }

    const matches = this.deps.local.scanAll().filter((pkg) => pkg.name === input.packageName)
    if (matches.length === 0) throw new VpmError('vpmLocalRootInvalid', { reason: 'notFound' })
    const pkg = pickHighest(matches)

    const packagesDir = path.join(project.path, 'Packages')
    const target = path.join(packagesDir, pkg.name)
    if (fs.existsSync(target)) {
      throw new VpmError('vpmLocalRootInvalid', { reason: 'targetExists' })
    }
    if (!fs.existsSync(packagesDir)) {
      throw new VpmError('vpmProjectInvalid', { field: 'Packages' })
    }

    const lease = this.deps.activity?.acquireMaintenance(project.path, 'install') ?? null
    const temp = path.join(packagesDir, `.atrium-local-${ulid().toLowerCase()}`)
    try {
      // 1) 先拷贝到临时目录，再整体 rename —— 不会留下半个包。
      copyTree(pkg.path, temp)
      const manifest = JSON.parse(
        fs.readFileSync(path.join(temp, 'package.json'), 'utf8')
      ) as { name?: unknown; version?: unknown }
      if (manifest.name !== pkg.name || manifest.version !== pkg.version) {
        throw new VpmError('vpmLocalRootInvalid', { reason: 'manifestChanged' })
      }
      fs.renameSync(temp, target)

      // 2) 最后写 manifest（提交点）。写失败就把刚拷进去的目录撤掉。
      try {
        this.addDependency(project.path, pkg.name, pkg.version)
      } catch (error) {
        fs.rmSync(target, { recursive: true, force: true })
        throw error
      }

      return { name: pkg.name, version: pkg.version, installedAt: target }
    } catch (error) {
      if (fs.existsSync(temp)) fs.rmSync(temp, { recursive: true, force: true })
      throw error instanceof VpmError
        ? error
        : new VpmError('vpmLocalRootInvalid', { reason: 'copy' }, error)
    } finally {
      lease?.release()
    }
  }

  /** 往 `Packages/vpm-manifest.json` 的 dependencies 里加一条（保留原有格式）。 */
  private addDependency(projectPath: string, name: string, version: string): void {
    const file = path.join(projectPath, 'Packages', 'vpm-manifest.json')
    let data: Record<string, unknown> = {}
    if (fs.existsSync(file)) {
      const raw = fs.readFileSync(file, 'utf8')
      const parsed: unknown = JSON.parse(raw)
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new VpmError('vpmManifestInvalid', { field: 'manifest' })
      }
      data = parsed as Record<string, unknown>
    }
    const dependencies =
      data.dependencies && typeof data.dependencies === 'object' && !Array.isArray(data.dependencies)
        ? { ...(data.dependencies as Record<string, unknown>) }
        : {}
    dependencies[name] = version
    const next = { ...data, dependencies }
    const temp = `${file}.atrium-tmp`
    fs.writeFileSync(temp, `${JSON.stringify(next, null, 2)}\n`)
    fs.renameSync(temp, file)
  }
}
