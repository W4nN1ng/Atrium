import fs from 'node:fs'
import path from 'node:path'
import { SIDECAR_FILENAME } from '../../shared/constants'
import type { AssetRow, PackageEntry, VariantKind } from '../../shared/types'

/**
 * 每个归档素材目录里都写一份 .avca.json：数据库损坏时能靠它把索引整库重建回来
 * （第 1 份 §5 的硬约束，"重建索引"必须是设置页里一个能按的按钮）。
 *
 * 侧车里**不存绝对路径** —— 库可以整体挪盘/改盘符，路径由"它在哪个目录里"推出来。
 */

export interface SidecarVariant {
  assetId: string
  kind: VariantKind
  value: string
}

export interface SidecarData {
  /** 侧车格式版本，跟 app 版本分开，升级时能兼容老库 */
  schema: number
  appVersion: string
  generatedAt: number
  /**
   * 三级模型那三列在侧车里是**可选**的：已经写在库里的 `.avca.json` 里没有它们，
   * 读老侧车必须照常成功（needs_review 能从 confidence 推，parent/is_bundle 从目录结构推）。
   */
  asset: Omit<
    AssetRow,
    | 'library_path'
    | 'source_path'
    | 'created_at'
    | 'updated_at'
    | 'parent_asset_id'
    | 'is_bundle'
    | 'needs_review'
  > &
    Partial<Pick<AssetRow, 'parent_asset_id' | 'is_bundle' | 'needs_review'>> & {
      created_at?: number
      updated_at?: number
    }
  group?: { id: string; key: string; name: string }
  /** @deprecated 合集现在是 asset 行（is_bundle=1），这个字段只为读老侧车保留 */
  bundle?: { id: string; name: string }
  variants?: SidecarVariant[]
  tags?: string[]
  packageEntries?: PackageEntry[]
  /** 相对素材目录的封面文件路径 */
  coverRelative?: string | null
  /** 分类理由，重建后 UI 还能告诉用户"当初为什么这么分" */
  reason?: string
}

export const SIDECAR_SCHEMA = 1

export function sidecarPath(assetDir: string): string {
  return path.join(assetDir, SIDECAR_FILENAME)
}

export async function writeSidecar(assetDir: string, data: SidecarData): Promise<string> {
  await fs.promises.mkdir(assetDir, { recursive: true })
  const p = sidecarPath(assetDir)
  const tmp = p + '.tmp'
  await fs.promises.writeFile(tmp, JSON.stringify(data, null, 2), 'utf8')
  await fs.promises.rename(tmp, p)
  return p
}

export async function readSidecar(assetDir: string): Promise<SidecarData | null> {
  try {
    const raw = await fs.promises.readFile(sidecarPath(assetDir), 'utf8')
    const parsed = JSON.parse(raw) as SidecarData
    if (!parsed || typeof parsed !== 'object' || !parsed.asset || !parsed.asset.id) return null
    return parsed
  } catch {
    return null
  }
}

export function isSidecarFile(name: string): boolean {
  return name === SIDECAR_FILENAME
}

/** 从侧车 + 所在目录还原出一行 asset（重建索引用） */
export function assetFromSidecar(data: SidecarData, assetDir: string, libraryRoot: string): AssetRow {
  const rel = path.relative(libraryRoot, assetDir).replace(/\\/g, '/')
  const cover = data.coverRelative ? path.join(assetDir, data.coverRelative) : null
  const rest = data.asset as unknown as Omit<
    AssetRow,
    'library_path' | 'source_path' | 'cover_image' | 'parent_asset_id' | 'is_bundle' | 'needs_review'
  >
  return {
    ...rest,
    library_path: assetDir,
    // 侧车不存绝对路径；原件就在同一个目录里，重建时按目录内容找
    source_path: null,
    cover_image: cover ?? null,
    /**
     * 三级模型那三列必须给默认值：老侧车里根本没有它们，
     * 直接展开会撞上 is_bundle / needs_review 的 NOT NULL，整条重建被 catch 吞掉
     * （实测：rebuildFromSidecars 报 inserted=0，界面上一张卡都没回来）。
     */
    parent_asset_id: data.asset.parent_asset_id ?? null,
    is_bundle: data.asset.is_bundle ?? 0,
    needs_review: data.asset.needs_review ?? (Number(data.asset.confidence ?? 0) < 0.75 ? 1 : 0),
    created_at: data.asset.created_at ?? data.generatedAt,
    updated_at: data.asset.updated_at ?? data.generatedAt,
    notes: data.asset.notes ? `${data.asset.notes}\n[重建自侧车 ${rel}]` : `[重建自侧车 ${rel}]`
  }
}
