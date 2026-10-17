import type { AssetFilter } from '../../shared/types'
import { assetIndex } from './index'

/** Both displayed cards and bulk actions must resolve the same normalized query. */
export function resolveIndexedAssetFilter(filter: AssetFilter): AssetFilter | null {
  const query = (filter.search ?? '').trim()
  if (!query || !assetIndex.ready) return filter
  const hits = assetIndex.search(query, 2000)
  return hits.length ? { ...filter, ids: hits.map(hit => hit.id) } : null
}
