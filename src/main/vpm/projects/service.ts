import {
  normalizeProjectPath,
  projectKeyOf,
  readProjectSnapshot,
  type ProjectReadOptions,
  type ProjectReaderPort,
  type ProjectSnapshot
} from '../../../shared/vpm/domain/project'
import { VpmError } from '../../../shared/vpm/errors'
import { ProjectFsReader } from './reader'
import type { ProjectLedgerRecord, ProjectLedgerStore } from './ledger'

export interface CoreProjectSummary {
  id: string
  path: string
  name: string
  unityVersion: string | null
  running: boolean
  detectedBy: string[]
  bridgeVersion: string | null
  busyReason?: string | null
}

export interface CoreProjectInput {
  path: string
  name: string
  unityVersion: string | null
}

/** 核心工程发现/运行的只读视图；register 是 P2-C 添加已有工程时的 DML 口。 */
export interface ProjectCorePort {
  list(): CoreProjectSummary[]
  register?(input: CoreProjectInput): CoreProjectSummary
}

export interface VccProjectsRead {
  paths: string[]
  error: string | null
}

export interface VccProjectSource {
  read(): VccProjectsRead
}

export interface ProjectListItem {
  projectKey: string
  coreId: string | null
  path: string
  name: string
  unityVersion: string | null
  running: boolean
  detectedBy: string[]
  bridgeVersion: string | null
  busyReason: string | null
  ledger: ProjectLedgerRecord | null
  /** 核心发现器是否仍认识这个工程；false = 台账还在、工程已从核心列表消失。 */
  linked: boolean
}

export interface ProjectScanResult {
  snapshot: ProjectSnapshot
  ledger: ProjectLedgerRecord
  core: CoreProjectSummary | null
}

export interface ProjectImportError {
  path: string
  code: string
  detail: string | null
}

export interface ProjectVccImportResult {
  imported: number
  skipped: number
  errors: ProjectImportError[]
  sourceError: string | null
}

export interface ProjectsServiceDeps {
  ledger: ProjectLedgerStore
  core?: ProjectCorePort
  vcc?: VccProjectSource
  reader?: (projectPath: string) => ProjectReaderPort
  readOptions?: ProjectReadOptions
}

/**
 * 工程台账应用服务。
 *
 * 核心工程发现仍是列表真相：本服务只把 P2-B 快照缓存到 `vpm_project`，
 * 并把核心的 running/detectedBy 合并给界面。它不启动 Unity、不写工程。
 */
export class ProjectsService {
  constructor(private readonly deps: ProjectsServiceDeps) {}

  list(): ProjectListItem[] {
    const ledgerRows = this.deps.ledger.list()
    const byKey = new Map(ledgerRows.map((row) => [row.projectKey, row]))
    const seen = new Set<string>()
    const items: ProjectListItem[] = []

    for (const project of this.deps.core?.list() ?? []) {
      let key: string
      try {
        key = projectKeyOf(project.path)
      } catch {
        continue
      }
      if (seen.has(key)) continue
      seen.add(key)
      items.push({
        projectKey: key,
        coreId: project.id,
        path: project.path,
        name: project.name,
        unityVersion: project.unityVersion,
        running: project.running,
        detectedBy: [...project.detectedBy],
        bridgeVersion: project.bridgeVersion,
        busyReason: project.busyReason ?? null,
        ledger: byKey.get(key) ?? null,
        linked: true
      })
    }

    for (const row of ledgerRows) {
      if (seen.has(row.projectKey)) continue
      items.push({
        projectKey: row.projectKey,
        coreId: null,
        path: row.projectPath,
        name: row.name,
        unityVersion: row.unityVersion,
        running: false,
        detectedBy: [],
        bridgeVersion: null,
        busyReason: null,
        ledger: row,
        linked: false
      })
    }

    return items.sort((a, b) => a.name.localeCompare(b.name) || a.projectKey.localeCompare(b.projectKey))
  }

  get(projectKey: string): ProjectListItem | null {
    return this.list().find((item) => item.projectKey === projectKey) ?? null
  }

  /**
   * 详情：优先读一次当前工程（只读），但不写台账。
   * 路径失效/读取失败时仍返回台账，让界面能解释"工程不在了"。
   */
  detail(projectKey: string): { item: ProjectListItem; snapshot: ProjectSnapshot | null } | null {
    const item = this.get(projectKey)
    if (!item?.ledger) return null
    let snapshot: ProjectSnapshot | null = null
    try {
      snapshot = this.scan(item.path)
    } catch {
      snapshot = null
    }
    return { item, snapshot }
  }

  scan(projectPath: string): ProjectSnapshot {
    const reader = this.deps.reader
      ? this.deps.reader(projectPath)
      : new ProjectFsReader(projectPath)
    const root = reader instanceof ProjectFsReader ? reader.root : normalizeProjectPath(projectPath)
    return readProjectSnapshot(reader, root, this.deps.readOptions)
  }

  addExisting(projectPath: string): ProjectScanResult {
    const snapshot = this.scan(projectPath)
    const core =
      this.deps.core?.register?.({
        path: snapshot.projectPath,
        name: snapshot.name,
        unityVersion: snapshot.unityVersion
      }) ?? null
    const ledger = this.deps.ledger.upsertSnapshot(snapshot)
    return { snapshot, ledger, core }
  }

  refresh(projectKeyOrPath: string): ProjectScanResult {
    const existing =
      this.deps.ledger.get(projectKeyOrPath) ?? this.deps.ledger.getByPath(projectKeyOrPath)
    if (!existing) throw new VpmError('vpmProjectInvalid', { field: 'project' })
    const snapshot = this.scan(existing.projectPath)
    const core =
      this.deps.core?.list().find(
        (project) => projectKeyOf(project.path) === existing.projectKey
      ) ?? null
    const ledger = this.deps.ledger.upsertSnapshot(snapshot, {
      unityExePath: existing.unityExePath,
      unityArgsJson: existing.unityArgsJson,
      lastOpId: existing.lastOpId
    })
    return { snapshot, ledger, core }
  }

  /**
   * 只读导入 VCC `settings.json` 的 userProjects。
   * 不写 VCC；坏路径只记错误，不中断其他工程。
   */
  importVcc(): ProjectVccImportResult {
    const result: ProjectVccImportResult = {
      imported: 0,
      skipped: 0,
      errors: [],
      sourceError: null
    }
    if (!this.deps.vcc) return result

    let source: VccProjectsRead
    try {
      source = this.deps.vcc.read()
    } catch (error) {
      result.sourceError = error instanceof Error ? error.message : String(error)
      return result
    }
    result.sourceError = source.error
    const seen = new Set<string>()
    for (const raw of source.paths) {
      let path: string
      try {
        path = normalizeProjectPath(raw)
      } catch (error) {
        result.skipped++
        result.errors.push({
          path: raw,
          code: error instanceof VpmError ? error.code : 'vpmProjectInvalid',
          detail: error instanceof Error ? error.message : null
        })
        continue
      }
      const key = path.toLowerCase()
      if (seen.has(key)) {
        result.skipped++
        continue
      }
      seen.add(key)
      try {
        this.addExisting(path)
        result.imported++
      } catch (error) {
        result.skipped++
        result.errors.push({
          path,
          code: error instanceof VpmError ? error.code : 'vpmProjectInvalid',
          detail: error instanceof Error ? error.message : null
        })
      }
    }
    return result
  }

  /** 只删 VPM 台账行；不删盘、不删核心工程、不删导入历史。 */
  remove(projectKey: string): boolean {
    return this.deps.ledger.remove(projectKey)
  }
}
