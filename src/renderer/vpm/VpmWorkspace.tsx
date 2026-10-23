import { useState } from 'react'
import { CatalogDialog } from './components/CatalogDialog'
import { InteropPanel } from './components/interop/InteropPanel'
import { MaintenanceLogPanel } from './components/log/MaintenanceLogPanel'
import { LocalPackagesPanel } from './components/local/LocalPackagesPanel'
import { ReposPanel } from './components/ReposPanel'
import { useVpmRepos } from './hooks/useVpmRepos'

export function VpmWorkspace({ enabled }: { enabled: boolean }): JSX.Element {
  const state = useVpmRepos(enabled)
  const [catalogOpen, setCatalogOpen] = useState(false)

  return (
    <div className="mt-4 space-y-4 border-t pt-4" style={{ borderColor: 'var(--line)' }}>
      <ReposPanel
        repos={state.repos}
        network={state.network}
        operation={state.operation}
        loading={state.loading}
        busy={state.busy}
        error={state.error}
        notice={state.notice}
        onSetNetwork={state.setNetwork}
        onReload={() => void state.reload()}
        onAdd={state.addRepo}
        onRemove={state.removeRepo}
        onRefresh={state.refreshRepo}
        onRefreshAll={state.refreshAll}
        onUseOfficial={state.useOfficialRepos}
        onBrowse={() => setCatalogOpen(true)}
        onDismissNotice={state.dismissNotice}
      />

      <LocalPackagesPanel />

      <InteropPanel />

      <MaintenanceLogPanel />

      <CatalogDialog
        open={catalogOpen}
        onOpenChange={setCatalogOpen}
        networkAllowed={state.network?.allowed === true}
        onEnableNetwork={() => void state.setNetwork(true)}
      />

    </div>
  )
}
