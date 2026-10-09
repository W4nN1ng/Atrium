/**
 * M6 ② · 工程指纹采集（第 3 份 §4.3 步骤 1 那四段）
 *
 * ## 为什么"能读盘的就别等桥接"
 *
 * 规格写的是 `topFolders` / `avatarDescriptors` 来自桥接的 `list_project_assets`，
 * 但实测（2026-10-06 读 C# 源码）那条命令**只回 `installedPackages`** ——
 * 而且 A 侧从来没发过它。所以这一版按 Q5 的裁定**先不改 C#**，改成：
 *
 *  - `dirName` / `topFolders` / `installedPackages`：**A 侧读盘**（`Assets` 浅一层目录名 +
 *    `Packages/manifest.json` 的依赖键名）。好处是**Unity 没开也有指纹**，
 *    首帧不再是"只有项目名"这种半残状态；
 *  - `avatarDescriptors`：**只有桥接够新才拿得到**。按心跳里的 `bridgeVersion` 判，
 *    **绝不假设所有工程都装了新版** —— 装了旧版桥接的工程必须照样能用，
 *    症状不能是"指纹全空 → 永远不自动切"还不报错。
 *
 * ## 三条纪律
 *
 * 1. **只读**：不建目录、不写工程、不碰 `Temp/`（信箱那边除外）。
 * 2. **有上限并记账**：`Assets` 顶层目录最多收 `TOP_FOLDERS_MAX` 个，撞线要能说出来
 *    （M5-B 的 `MEMBER_SCAN_MAX` 同一条纪律：撞线不记账就等于没撞线）。
 * 3. **桥接抛错不许把整个功能带停**：拿不到就退回磁盘那半边，`notes` 里写明。
 */
import fs from 'node:fs'
import path from 'node:path'
import { compareVersion } from '../../shared/version'
import type { ProjectFingerprint } from '../../shared/projectMatch'
import { isBridgeInstalled, isHeartbeatStale, readHeartbeat } from '../bridge/mailbox'
import type { Db } from '../db'
import { upsertProject } from '../db/repos/unity'
import { getProjectByPath } from '../db/repos/unity'
import log from 'electron-log'

/** `Assets` 顶层目录收多少个就停（真库旁边的工程实测有多少个**未验证**，撞线会记在 notes 里） */
export const TOP_FOLDERS_MAX = 200
/**
 * 从哪个桥接版本起 `list_project_assets` 会回 `topFolders` / `avatarDescriptors`。
 * 现在发布的模板是 1.0.0 → 这一版**永远走降级分支**，`avatarDescriptors` 恒为空。
 * 等 Q5 改成"要动 C#"时，把模板版本号抬到 1.1.0，这里就自动接上。
 */
export const BRIDGE_WITH_ASSET_LIST = '1.1.0'
/** 指纹采集是"顺手做的"，桥接慢就不要它 —— 5 秒拿不到就退回磁盘那半边 */
const BRIDGE_ACK_TIMEOUT_MS = 5_000

/** 只要这一条命令的桥接端口（结构上 BridgeManager 满足；不共用 `BridgeLike` 是为了不把窄白名单撑大） */
export interface FingerprintBridge {
  execute(
    projectPath: string,
    type: 'list_project_assets',
    payload: unknown,
    opts?: { label?: string; ackTimeoutMs?: number; watchdogMs?: number }
  ): Promise<{ ok: boolean; status: string; data: unknown; error: string | null }>
}

export interface FingerprintResult {
  fp: ProjectFingerprint
  /** 这次每一段是从哪来的：`disk` / `bridge` / `name-only`（写日志与排查用） */
  sources: string[]
  /** 如实记账：撞线、桥接不在线、旧版桥接拿不到 avatarDescriptors… */
  notes: string[]
}

/** `Assets/` 顶层目录名（浅一层，只取目录，不递归、不进包） */
export function readTopFolders(projectPath: string): { folders: string[]; capped: boolean } {
  const dir = path.join(projectPath, 'Assets')
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    /** 没有 Assets（工程被挪走 / 权限读不到）就什么都没有，不猜也不报错 */
    return { folders: [], capped: false }
  }
  const all = entries.filter((e) => e.isDirectory()).map((e) => e.name).sort()
  return { folders: all.slice(0, TOP_FOLDERS_MAX), capped: all.length > TOP_FOLDERS_MAX }
}

/**
 * `Packages/manifest.json` 的 dependencies 键名 = 已装包列表。
 *
 * ⚠ 这份逻辑 C# 那边也有一份（`ListProjectAssets()`）。两边读的是**同一个文件**、
 * 只要键名，规则简单到不会漂；真要漂也是"工程离线时 A 自己算的那份"和"桥接回的那份"，
 * 所以下面桥接回来时**以桥接为准**（磁盘那份只当兜底）。
 */
export function readInstalledPackages(projectPath: string): string[] {
  const file = path.join(projectPath, 'Packages', 'manifest.json')
  let text: string
  try {
    text = fs.readFileSync(file, 'utf8')
  } catch {
    return []
  }
  /**
   * 不引 JSON5 也不写正则解析整个文件：只抠 `"dependencies"` 那一段里的键名。
   * manifest.json 长得很规矩（Unity 自己写的），而这里只要键名 ——
   * 解析失败就返回空数组，让桥接那份去补，绝不让指纹采集把启动流程挂住。
   */
  const start = text.indexOf('"dependencies"')
  if (start < 0) return []
  const open = text.indexOf('{', start)
  const close = text.indexOf('}', open + 1)
  if (open < 0 || close < open) return []
  const out: string[] = []
  for (const m of text.slice(open + 1, close).matchAll(/"([^"]+)"\s*:/g)) out.push(m[1])
  return out
}

/** 桥接回包里的可选字段（旧版只有 installedPackages，缺的一律当"没拿到"） */
interface AssetListData {
  installedPackages?: string[]
  topFolders?: string[]
  avatarDescriptors?: string[]
}

/**
 * 采一次指纹。**永不抛错**：任何一环拿不到就退回还能拿的那几段，并把原因写进 `notes`。
 *
 * @param bridge 传 `null` 表示"这次不问桥接"（比如工程还没心跳）
 */
export async function collectFingerprint(
  projectPath: string,
  bridge: FingerprintBridge | null
): Promise<FingerprintResult> {
  const dirName = path.basename(projectPath.replace(/[\\/]+$/, '')) || projectPath
  const disk = readTopFolders(projectPath)
  const sources: string[] = ['name']
  const notes: string[] = []
  if (disk.capped) notes.push('topFoldersCapped')

  const fp: ProjectFingerprint = {
    dirName,
    topFolders: disk.folders,
    installedPackages: readInstalledPackages(projectPath),
    avatarDescriptors: []
  }
  if (disk.folders.length) sources.push('topFolders:disk')
  if (fp.installedPackages.length) sources.push('packages:disk')

  if (!bridge) {
    notes.push('bridgeSkipped')
    return { fp, sources, notes }
  }
  let r
  try {
    r = await bridge.execute(projectPath, 'list_project_assets', {}, {
      label: '读取工程指纹',
      ackTimeoutMs: BRIDGE_ACK_TIMEOUT_MS,
      watchdogMs: BRIDGE_ACK_TIMEOUT_MS * 2
    })
  } catch (e) {
    /** 桥接抛错 = 这次拿不到，不是"这个工程没东西"。磁盘那份照用，如实记一笔 */
    notes.push('bridgeThrew')
    log.warn(`[fingerprint] 问桥接要资产清单失败（退回磁盘那半边）：${projectPath} —— ${String((e as Error)?.message ?? e)}`)
    return { fp, sources, notes }
  }
  if (!r.ok) {
    notes.push('bridgeFailed')
    return { fp, sources, notes }
  }
  const data = (r.data ?? {}) as AssetListData
  /**
   * 降级口径（Q5 的落地）：**按心跳里的 bridgeVersion 判**，不看"字段有没有回来"。
   * 只认字段的话，旧版桥接哪天回了一个同名字段但语义不同，就会被当成新版用 ——
   * 那比拿不到更糟。
   */
  const probe = readHeartbeat(projectPath)
  const ver = probe.heartbeat?.bridgeVersion ?? null
  const canListAssets = !!ver && compareVersion(ver, BRIDGE_WITH_ASSET_LIST) >= 0
  if (Array.isArray(data.installedPackages) && data.installedPackages.length) {
    fp.installedPackages = data.installedPackages
    sources.push('packages:bridge')
  }
  if (canListAssets) {
    if (Array.isArray(data.topFolders) && data.topFolders.length) {
      fp.topFolders = data.topFolders.slice(0, TOP_FOLDERS_MAX)
      sources.push('topFolders:bridge')
    }
    if (Array.isArray(data.avatarDescriptors)) {
      fp.avatarDescriptors = data.avatarDescriptors.slice(0, TOP_FOLDERS_MAX)
      sources.push('descriptors:bridge')
    } else {
      notes.push('noAvatarDescriptors')
    }
  } else {
    /** 旧版桥接：这一项就是拿不到，写清楚，别让上层以为"这个工程没有 AvatarDescriptor" */
    notes.push('bridgeTooOld')
  }
  return { fp, sources, notes }
}

/** 心跳新鲜 + 桥接装了，才值得去问一句（否则就是白等 5 秒） */
export function bridgeWorthAsking(projectPath: string): boolean {
  if (!isBridgeInstalled(projectPath)) return false
  const probe = readHeartbeat(projectPath)
  return !isHeartbeatStale(probe)
}

/**
 * 把指纹落到 `project.fingerprint_json`（列早就建好了，一直没人写）。
 *
 * ⚠ 走 `upsertProject` 而不是自己写 UPDATE：它对 `isRunning` / `bridgeVersion`
 * 有"传 undefined 就保留原值"的口径，绕过它就会把运行状态抹掉
 * （M5-A 的每轮 refresh 清运行状态就是这么来的）。
 */
export function saveFingerprint(db: Db, projectPath: string, fp: ProjectFingerprint): void {
  const existing = getProjectByPath(db, projectPath)
  if (!existing) {
    log.warn(`[fingerprint] 库里没有这个工程，指纹不落：${projectPath}`)
    return
  }
  upsertProject(db, { path: projectPath, name: existing.name, fingerprint: fp })
}

/** 读回库里存的指纹（重启后不用重新问桥接）。坏 JSON 一律当"没有" */
export function storedFingerprint(db: Db, projectPath: string): ProjectFingerprint | null {
  const row = getProjectByPath(db, projectPath)
  if (!row?.fingerprint_json) return null
  try {
    const v = JSON.parse(row.fingerprint_json) as Partial<ProjectFingerprint>
    return {
      dirName: String(v.dirName ?? row.name ?? ''),
      topFolders: Array.isArray(v.topFolders) ? v.topFolders.map(String) : [],
      installedPackages: Array.isArray(v.installedPackages) ? v.installedPackages.map(String) : [],
      avatarDescriptors: Array.isArray(v.avatarDescriptors) ? v.avatarDescriptors.map(String) : []
    }
  } catch {
    return null
  }
}
