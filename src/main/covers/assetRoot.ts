import fs from 'node:fs'
import path from 'node:path'
import type { Db } from '../db'
import { getAsset } from '../db/repos/asset'

/**
 * 素材在磁盘上的**根目录**。
 *
 * ## 口径
 *
 * 按 `library_path` → `source_path` 的顺序试（与 `covers/packageSource.ts` 找包的
 * 顺序一致，别改成反过来：归档模式下 `library_path` 才是当前位置）：
 *
 * | 命中的路径 | 返回 |
 * |---|---|
 * | 目录 | 它本身 |
 * | 文件 | 它的**父目录**（素材是单个包时，根目录 = 包所在目录）|
 * | 不在盘上 / 两个都空 | 试下一个；都没有就 `null` |
 *
 * ## 为什么需要它
 *
 * 2026-10-15 用户报的 bug：在封面编辑器里点「选择本地图片」，
 * 文件对话框打开的是**上一个素材**的目录（`…\5812460史莱姆化`），
 * 而不是当前素材（`…\5354575真实亲吻Realkisssystem`）。
 * 根因是 `system:pick-files` **没有 `defaultPath` 参数**，
 * 于是 Windows 沿用了上一次用过的目录 —— 用户得自己一层层翻回去。
 *
 * 注意素材的路径形态是**两种都有的**（同一个合集里就能同时出现）：
 *   - `5354575真实亲吻Realkisssystem` → `source_path` 是**目录**
 *   - `RealKissSystemV1.4.0-beta.2.zip` → `source_path` 是**文件**
 * 所以这里必须区分文件与目录，不能直接把 `source_path` 丢给对话框。
 *
 * **只读**：只 `statSync` 探一下存在性，不创建、不修改任何东西。
 */
export function assetRootDirectory(db: Db, assetId: string): string | null {
  const asset = getAsset(db, assetId)
  if (!asset) return null
  for (const candidate of [asset.library_path, asset.source_path]) {
    if (!candidate) continue
    const resolved = path.resolve(candidate)
    try {
      const stat = fs.statSync(resolved)
      return stat.isDirectory() ? resolved : path.dirname(resolved)
    } catch {
      /* 这条路径不在盘上（被移走/删了）→ 试下一个，别把不存在的目录给对话框 */
    }
  }
  return null
}
