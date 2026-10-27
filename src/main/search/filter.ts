import type { AssetFilter } from '../../shared/types'
import { assetIndex } from './index'

/** Both displayed cards and bulk actions must resolve the same normalized query. */
export function resolveIndexedAssetFilter(filter: AssetFilter): AssetFilter | null {
  const query = (filter.search ?? '').trim()
  // 普通浏览保留顶层结构；搜索默认覆盖子素材，明确的 top / parent 限定仍然有效。
  const scoped: AssetFilter = query && filter.scope === undefined && !filter.parentId ? { ...filter, scope: 'all' } : filter
  if (!query || !assetIndex.ready) return scoped
  const hits = assetIndex.search(query, 2000)
  return hits.length ? { ...scoped, ids: hits.map(hit => hit.id) } : null
}
