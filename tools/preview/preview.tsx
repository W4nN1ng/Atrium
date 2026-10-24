import React from 'react'
import { createRoot } from 'react-dom/client'
import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import zh from '../../src/renderer/i18n/zh-CN.json'
import { ReposPanel } from '../../src/renderer/vpm/components/ReposPanel'
import { VpmMaintenancePanel } from '../../src/renderer/vpm/components/projects/VpmMaintenancePanel'
import type { VpmProjectDetailDto, VpmRepoDto } from '../../src/shared/vpm/dto'

const repos: VpmRepoDto[] = [
  {
    id: 'vrchat-official',
    url: 'https://packages.vrchat.com/official?download',
    name: 'Official',
    kind: 'remote',
    enabled: true,
    sortOrder: 0,
    packageCount: 42,
    lastFetchAt: 1_700_000_000_000,
    lastSuccessAt: 1_700_000_000_000,
    lastErrorCode: null
  },
  {
    id: 'vrchat-curated',
    url: 'https://packages.vrchat.com/curated?download',
    name: 'Curated',
    kind: 'remote',
    enabled: false,
    sortOrder: 1,
    packageCount: 128,
    lastFetchAt: 1_700_000_000_000,
    lastSuccessAt: null,
    lastErrorCode: 'vpmHttpTimeout'
  }
]

const detail = {
  projectKey: 'e://projects//Demo',
  coreId: 'core-1',
  path: 'E://projects//Demo',
  name: 'Demo',
  unityVersion: '2022.3.22f1',
  unityRevision: null,
  running: false,
  detectedBy: ['heartbeat'],
  bridgeVersion: '1.4.0',
  busyReason: null,
  linked: true,
  hasLedger: true,
  lastScanAt: 1_700_000_000_000,
  packageCount: 12,
  legacyCount: 2,
  hasVpmManifest: true,
  manifestHash: 'a'.repeat(64),
  manifestMtime: 1_700_000_000_000,
  unityExePath: null,
  unityArgsJson: null,
  packages: [],
  warnings: [],
  legacy: {
    readOnly: true,
    truncated: false,
    candidates: [
      { name: 'com.vrchat.avatars', relativePath: 'Assets/VRCSDK', match: 'packageJson', confidence: 'high' },
      { name: null, relativePath: 'Assets/OldStuff', match: 'legacyFolder', confidence: 'medium' }
    ]
  }
} as unknown as VpmProjectDetailDto

const stub = {
  vpm: {
    backupList: async () => [
      {
        id: 'b1',
        projectKey: detail.projectKey,
        projectName: 'Demo',
        filePath: 'E://data//backups//demo//Demo-20261022-201500.zip',
        size: 128_400_000,
        sha256: 'f'.repeat(64),
        unityVersion: '2022.3.22f1',
        packageCount: 128,
        status: 'ok',
        createdAt: 1_700_000_000_000,
        finishedAt: 1_700_000_090_000,
        errorCode: null
      },
      {
        id: 'b2',
        projectKey: detail.projectKey,
        projectName: 'Demo',
        filePath: 'E://data//backups//demo//Demo-20261021-101500.zip',
        size: 0,
        sha256: null,
        unityVersion: null,
        packageCount: 0,
        status: 'failed',
        createdAt: 1_699_000_000_000,
        finishedAt: 1_699_000_010_000,
        errorCode: 'vpmBackupFailed'
      }
    ],
    unityInstalls: async () => [],
    repoHeaders: async () => ({ available: true, names: [] }),
    repoTest: async () => ({ ok: true, status: 200, errorCode: null }),
    repoExport: async () => '{}',
    repoImport: async () => ({ added: [], skipped: [] }),
    repoUpdate: async () => repos[0],
    repoReorder: async () => repos
  },
  on: () => () => undefined,
  system: { openExternal: async () => undefined, pickDirectory: async () => null }
}
;(window as unknown as { a: unknown }).a = stub

void i18n.use(initReactI18next).init({
  lng: 'zh-CN',
  fallbackLng: 'zh-CN',
  resources: { 'zh-CN': { translation: zh } },
  interpolation: { escapeValue: false }
})

function App(): JSX.Element {
  return (
    <div className="min-h-screen p-6" style={{ background: 'var(--bg)', color: 'var(--text)' }}>
      <div className="mx-auto max-w-[1180px] space-y-6">
        <div className="rounded border p-4" style={{ borderColor: 'var(--line)', background: 'var(--panel)' }}>
          <div className="mb-2 flex items-center gap-2">
            <span className="text-[15px] font-medium">项目</span>
            <span className="badge">3</span>
          </div>
          {[
            { name: '22', path: 'E:////AtriumProject////22', version: '2022.3.22f1', running: true },
            { name: '33', path: 'E:////AtriumProject////33', version: '2022.3.22f1', running: false },
            { name: 'shinano-Little Candy', path: 'E:////ALCOMProjects////shinano-Little Candy', version: '2022.3.22f1', running: false }
          ].map((item) => (
            <div
              key={item.name}
              className="flex min-h-[56px] items-center gap-3 border-b px-3 py-3 text-[13px] last:border-b-0"
              style={{ borderColor: 'var(--line)' }}
            >
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ background: item.running ? 'var(--ok)' : 'var(--faint)' }}
              />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="truncate text-[17px] font-semibold">{item.name}</span>
                  <span className="text-[12px]" style={{ color: 'var(--muted)' }}>
                    {item.version}
                  </span>
                </div>
                <div className="truncate text-[12px]" style={{ color: 'var(--faint)' }}>
                  {item.path}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                <button className="btn">{item.running ? '已打开' : '打开'}</button>
                <button className="btn btn-ghost">管理</button>
                <span className="cursor-pointer px-1.5 text-[14px]" style={{ color: 'var(--muted)' }}>
                  ⋯
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="mx-auto mt-6 grid max-w-[1180px] gap-6 lg:grid-cols-2">
        <div className="rounded border p-4" style={{ borderColor: 'var(--line)', background: 'var(--panel)' }}>
          <ReposPanel
            repos={repos}
            network={{ allowed: true, reason: null } as never}
            operation={null}
            loading={false}
            busy={false}
            error={null}
            notice={null}
            onSetNetwork={() => undefined}
            onReload={() => undefined}
            onAdd={() => undefined}
            onRemove={() => undefined}
            onRefresh={() => undefined}
            onRefreshAll={() => undefined}
            onUseOfficial={() => undefined}
            onBrowse={() => undefined}
            onDismissNotice={() => undefined}
          />
        </div>
        <div className="rounded border p-4" style={{ borderColor: 'var(--line)', background: 'var(--panel)' }}>
          <VpmMaintenancePanel projectKey={detail.projectKey} detail={detail} onChanged={() => undefined} />
        </div>
      </div>
    </div>
  )
}

createRoot(document.getElementById('root') as HTMLElement).render(<App />)
