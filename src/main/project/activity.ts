import fs from 'node:fs'
import path from 'node:path'
import { VpmError } from '../../shared/vpm/errors'
import type {
  LegacyGuardPort,
  MaintenanceKind,
  MaintenanceLease,
  ProjectActivityPort,
  ProjectActivitySnapshot
} from '../../shared/vpm/linkage'
import type { Db } from '../db'

/**
 * 工程活动闸门（P4-F）。
 *
 * 只做一件事：让**同一个工程**上的"素材写入"和"维护写"互斥。
 * - 素材写入（导入/撤销/成员导入）由核心在开始时 `beginImport()`，结束时释放；
 * - 维护写（装包/备份/复制/迁移/换版本/建工程）通过 `acquireMaintenance()` 拿独占租约；
 * - Unity 运行状态每次现问，不缓存（心跳会变）。
 *
 * 这里**不写工程、不排队、不重试**：拿不到就返回可解释的错误，由调用方决定下一步。
 * 状态全在进程内；Atrium 是单实例，跨进程靠 Unity 心跳与文件指纹。
 */

export function normalizeProjectPath(projectPath: string): string {
  const resolved = path.resolve(projectPath)
  return (resolved.length > 3 ? resolved.replace(/[\\/]+$/, '') : resolved).toLowerCase()
}

export interface ProjectActivityOptions {
  /** Unity 是否正在运行这个工程；每次 `state()` 现问，不缓存。 */
  isUnityRunning?: (projectPath: string) => boolean
  now?: () => number
}

interface ImportMark {
  count: number
  since: number
}

interface LeaseMark {
  kind: MaintenanceKind
  since: number
}

export interface ProjectActivityDiagnostic extends ProjectActivitySnapshot {
  projectPath: string
  importingSince: number | null
  maintenanceSince: number | null
}

export class ProjectActivityRegistry {
  private readonly imports = new Map<string, ImportMark>()
  private readonly leases = new Map<string, LeaseMark>()
  private readonly isUnityRunning: (projectPath: string) => boolean
  private readonly now: () => number

  constructor(options: ProjectActivityOptions = {}) {
    this.isUnityRunning = options.isUnityRunning ?? (() => false)
    this.now = options.now ?? Date.now
  }

  state(projectPath: string): ProjectActivitySnapshot {
    const key = normalizeProjectPath(projectPath)
    return {
      unityRunning: this.unityRunning(key, projectPath),
      importing: (this.imports.get(key)?.count ?? 0) > 0,
      maintenance: this.leases.get(key)?.kind ?? null
    }
  }

  /**
   * 标记一次素材写入开始；返回的释放函数**幂等**。
   * 嵌套调用按计数累加（成员导入里逐项调用 importUnitypackage 时就是嵌套）。
   */
  beginImport(projectPath: string): () => void {
    const key = normalizeProjectPath(projectPath)
    const current = this.imports.get(key)
    if (current) {
      current.count++
    } else {
      this.imports.set(key, { count: 1, since: this.now() })
    }
    let released = false
    return (): void => {
      if (released) return
      released = true
      const mark = this.imports.get(key)
      if (!mark) return
      mark.count--
      if (mark.count <= 0) this.imports.delete(key)
    }
  }

  /**
   * 申请独占维护租约。
   *
   * 顺序有意义：先报"已经有维护在跑"（`vpmProjectBusy`），再报导入/Unity，
   * 这样用户看到的永远是"谁占着"，而不是"两个都占着时随便挑一个"。
   */
  acquireMaintenance(projectPath: string, kind: MaintenanceKind): MaintenanceLease {
    const key = normalizeProjectPath(projectPath)
    const held = this.leases.get(key)
    if (held) throw new VpmError('vpmProjectBusy', { kind, heldBy: held.kind })
    if ((this.imports.get(key)?.count ?? 0) > 0) throw new VpmError('vpmProjectImporting', { kind })
    if (this.unityRunning(key, projectPath)) throw new VpmError('vpmUnityRunning', { kind })

    const mark: LeaseMark = { kind, since: this.now() }
    this.leases.set(key, mark)
    let released = false
    return {
      projectPath,
      kind,
      release: (): void => {
        if (released) return
        released = true
        // 只删自己那一个：防御"过期租约的 release 把后来者的租约删了"。
        if (this.leases.get(key) === mark) this.leases.delete(key)
      }
    }
  }

  /** 诊断用：谁占着、占了多久。 */
  diagnose(): ProjectActivityDiagnostic[] {
    const keys = new Set([...this.imports.keys(), ...this.leases.keys()])
    return [...keys].map((key) => {
      const mark = this.imports.get(key)
      const lease = this.leases.get(key)
      return {
        projectPath: key,
        unityRunning: this.unityRunning(key, key),
        importing: (mark?.count ?? 0) > 0,
        maintenance: lease?.kind ?? null,
        importingSince: mark?.since ?? null,
        maintenanceSince: lease?.since ?? null
      }
    })
  }

  /** 测试/退出清理；不传就全清。 */
  clear(projectPath?: string): void {
    if (projectPath === undefined) {
      this.imports.clear()
      this.leases.clear()
      return
    }
    const key = normalizeProjectPath(projectPath)
    this.imports.delete(key)
    this.leases.delete(key)
  }

  private unityRunning(key: string, original: string): boolean {
    try {
      return this.isUnityRunning(original) === true || this.isUnityRunning(key) === true
    } catch {
      // 运行状态自己坏了：按"可能在跑"处理，宁可不写。
      return true
    }
  }
}

/** 给 VPM 的端口（gate 注入）。 */
export function createProjectActivityPort(registry: ProjectActivityRegistry): ProjectActivityPort {
  return {
    state: (projectPath: string) => registry.state(projectPath),
    acquireMaintenance: (projectPath: string, kind: MaintenanceKind) =>
      registry.acquireMaintenance(projectPath, kind)
  }
}

const GUID_RE = /^guid:\s*([0-9a-fA-F]{32})\s*$/m
const META_MAX_BYTES = 8 * 1024

function readGuid(metaFile: string): string | null {
  try {
    const stat = fs.lstatSync(metaFile)
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > META_MAX_BYTES) return null
    const match = GUID_RE.exec(fs.readFileSync(metaFile, 'utf8'))
    return match ? match[1].toLowerCase() : null
  } catch {
    return null
  }
}

/**
 * 旧 Assets 清理的保护集合：`import_log` 里出现过（导入过 / 被覆盖过）的 GUID 一律保留。
 *
 * 判定是机械的：读 `Assets/.../x.meta` 的 guid → 在 `import_log` 的
 * `created_guids_json` / `overwritten_json` 里出现过 → 保护。
 * 读不到 `.meta`（没有 guid）→ 不保护（那是包自带的资源，P4-C 只清包声明的路径）。
 */
export function createLegacyGuard(getDb: () => Db): LegacyGuardPort {
  const cache = new Map<string, Set<string>>()

  const guidsOf = (projectPath: string): Set<string> => {
    const key = normalizeProjectPath(projectPath)
    const hit = cache.get(key)
    if (hit) return hit
    const set = new Set<string>()
    try {
      const rows = getDb()
        .prepare(
          `SELECT i.created_guids_json AS created, i.overwritten_json AS overwritten
             FROM import_log i JOIN project p ON p.id = i.project_id
            WHERE lower(p.path) = ?`
        )
        .all(key) as Array<{ created: string | null; overwritten: string | null }>
      for (const row of rows) {
        for (const json of [row.created, row.overwritten]) {
          if (!json) continue
          try {
            const values: unknown = JSON.parse(json)
            if (!Array.isArray(values)) continue
            for (const value of values) {
              if (typeof value === 'string' && value.length >= 8) set.add(value.toLowerCase())
            }
          } catch {
            /* 坏行跳过：宁可少保护一条，也不能让整次清理失败 */
          }
        }
      }
    } catch {
      // 数据库没开/表还没建：不缓存空集，下次再试。
      return set
    }
    cache.set(key, set)
    return set
  }

  return {
    prime(projectPath: string): void {
      cache.delete(normalizeProjectPath(projectPath))
      guidsOf(projectPath)
    },
    isProtected(projectPath: string, relativePath: string): boolean {
      if (!relativePath || relativePath.includes('\0')) return true
      const absolute = path.resolve(projectPath, relativePath)
      if (!absolute.toLowerCase().startsWith(path.resolve(projectPath).toLowerCase())) return true
      const guid = readGuid(`${absolute}.meta`)
      if (!guid) return false
      return guidsOf(projectPath).has(guid)
    }
  }
}
