import type { Db } from '../index'
import {
  MAX_IMPORT_NAME_HISTORY,
  parseImportNameHistory,
  pushImportName,
  topLevelNames,
  type ImportNameEntry
} from '../../../shared/importNames'
import { normalizeProjectLayout, type ProjectLayout } from '../../../shared/projectLayout'
import { getAsset } from './asset'
import { getProject } from './unity'

/**
 * 两个很小的界面偏好，都住在 `setting` 表里，**不为它们动 schema**
 * （和 `bridgeAsk:<projectId>`、`projectGuids:<id>` 一个路子；改库结构意味着迁移 + 回滚演练全要重跑）。
 *
 *  - `ui.projectLayout`：项目列表的顺序与 📌 固定
 *  - `ui.importNames`：导入历史（素材 → Unity 里的名字），最多 100 条
 */

const LAYOUT_KEY = 'ui.projectLayout'
const IMPORT_NAMES_KEY = 'ui.importNames'

function readJson(db: Db, key: string): unknown {
  const row = db.prepare(`SELECT value_json FROM setting WHERE key = ?`).get(key) as { value_json: string } | undefined
  if (!row) return null
  try {
    return JSON.parse(row.value_json) as unknown
  } catch {
    return null
  }
}

function writeJson(db: Db, key: string, value: unknown): void {
  db.prepare(`INSERT OR REPLACE INTO setting (key, value_json) VALUES (?, ?)`).run(key, JSON.stringify(value))
}

export function getProjectLayout(db: Db): ProjectLayout {
  return normalizeProjectLayout(readJson(db, LAYOUT_KEY))
}

export function setProjectLayout(db: Db, raw: unknown): ProjectLayout {
  const layout = normalizeProjectLayout(raw)
  writeJson(db, LAYOUT_KEY, layout)
  return layout
}

export function listImportNames(db: Db): ImportNameEntry[] {
  return parseImportNameHistory(readJson(db, IMPORT_NAMES_KEY))
}

/** 导入成功后追加一条；返回追加后的整张表（调用方一般不用，单测用得上） */
export function appendImportName(
  db: Db,
  entry: Omit<ImportNameEntry, 'id'> & { id?: string }
): ImportNameEntry[] {
  const row: ImportNameEntry = {
    id: entry.id ?? `${entry.at}-${Math.random().toString(36).slice(2, 8)}`,
    at: entry.at,
    assetName: entry.assetName,
    projectName: entry.projectName,
    names: entry.names.slice()
  }
  const next = pushImportName(listImportNames(db), row, MAX_IMPORT_NAME_HISTORY)
  writeJson(db, IMPORT_NAMES_KEY, next)
  return next
}

/** 只清这张表 —— `import_log` 是撤销功能的地基，一行都不许动 */
export function clearImportNames(db: Db): void {
  db.prepare(`DELETE FROM setting WHERE key = ?`).run(IMPORT_NAMES_KEY)
}

/**
 * 导入成功后记一笔「素材 → Unity 里的名字」。
 *
 * 名字来源是**这个包真实落盘路径的一级目录**（`preflight` 已整包解析过，
 * 见 `PreflightResult.paths`），Unity 的 ImportPackage 就照这些路径落盘，
 * 所以这就是用户在 Project 窗口里看到的文件夹名 —— 不是从素材名猜的。
 *
 * 只在 `ok` 之后调用；`names` 为空就什么都不写（纯代码包没有可显示的名字，
 * 记一行空白只会变噪音）。
 */
export function recordImportName(
  db: Db,
  input: {
    assetId: string | null
    projectId: string
    unityPaths: Iterable<string>
    packagePath: string
    at?: number
  }
): void {
  const names = topLevelNames(input.unityPaths)
  if (!names.length) return
  const asset = input.assetId ? getAsset(db, input.assetId) : null
  const project = getProject(db, input.projectId)
  appendImportName(db, {
    at: input.at ?? Date.now(),
    assetName: asset?.name ?? basenameOf(input.packagePath),
    projectName: project?.name ?? '',
    names
  })
}

function basenameOf(p: string): string {
  const parts = p.split(/[\\/]/)
  const last = parts[parts.length - 1] ?? p
  return last.replace(/\.unitypackage$/i, '')
}
