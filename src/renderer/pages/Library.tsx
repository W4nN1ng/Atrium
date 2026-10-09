import { useUi } from '../stores/ui'
import { AssetGrid } from '../components/AssetGrid'
import { BundleDetail } from '../components/BundleDetail'
import { DetailPanel } from '../components/DetailPanel'

export function Library(): JSX.Element {
  const nav = useUi((s) => s.nav)
  /** 合集点进来是二级列表（子项 + 版本），不套普通网格 */
  if (nav.startsWith('bundle:')) return <BundleDetail bundleId={nav.slice(7)} />
  return (
    <div className="flex min-h-0 flex-1">
      <AssetGrid />
      <DetailPanel />
    </div>
  )
}
