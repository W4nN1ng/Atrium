import { lazy, Suspense, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ProjectInfo } from '../../shared/types'
import { useUi } from '../stores/ui'
import { Badge, Button, EmptyState } from '../components/ui'
import { ImportHistoryDialog } from '../components/ImportHistoryDialog'
import { ConnectionBadge } from '../components/ImportTargetPicker'

/** VPM 工程台账按需加载；VPM 停用时组件自身返回 null，不影响核心工程页。 */
const VpmProjectsSection = lazy(() =>
  import('../vpm/components/projects/VpmProjectsSection').then((module) => ({
    default: module.VpmProjectsSection
  }))
)

/**
 * Unity 工程页。
 *
 * Connection status comes from the main-process controller. A copied plugin is
 * not a ready connection; retry and advanced removal remain explicit actions.
 */
export function Project(): JSX.Element {
  const { t } = useTranslation()
  const [busy, setBusy] = useState(false)
  const [installing, setInstalling] = useState<string | null>(null)
  const [historyProject, setHistoryProject] = useState<string | null | undefined>(undefined)
  const rows = useUi((s) => s.projects)
  const refreshProjects = useUi((s) => s.refreshProjects)
  const setUnityTarget = useUi((s) => s.setUnityTarget)
  const connection = useUi((s) => s.connection)
  const retryConnection = useUi((s) => s.retryUnityConnection)
  const toast = useUi((s) => s.toast)

  async function load(): Promise<void> {
    setBusy(true)
    try {
      await refreshProjects()
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  async function uninstall(p: ProjectInfo): Promise<void> {
    setInstalling(p.id)
    try {
      const r = await window.a.unity.uninstallBridge(p.id)
      if (r.ok) {
        toast('ok', r.notInstalled ? t('project.uninstallNotInstalled') : t('project.uninstallDone', { name: p.name }))
      } else {
        toast('bad', r.error ?? t('project.uninstallFailed'))
      }
      await load()
    } catch (e) {
      toast('bad', e instanceof Error ? e.message : String(e))
    } finally {
      setInstalling(null)
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b px-3 py-2" style={{ borderColor: 'var(--line)' }}>
        <span className="text-[13px] font-medium">{t('project.title')}</span>
        <Badge>{rows.length}</Badge>
        <span className="text-[11px]" style={{ color: 'var(--faint)' }}>
          {t('project.detectNote')}
        </span>
        <div className="ml-auto flex gap-2">
          <Button onClick={() => setHistoryProject(null)}>{t('importHistory.title')}</Button>
          <Button onClick={() => void load()} disabled={busy}>
            {t('project.refresh')}
          </Button>
        </div>
      </div>

      {rows.length === 0 ? (
        <EmptyState title={t('project.none')} hint={t('settings.projectRoots')} />
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto">
          {rows.map((p) => {
            const isTarget = p.id === connection.targetProjectId
            const state = connection.projects.find((item) => item.projectId === p.id)
            const phase = state?.phase ?? (p.running ? 'connecting' : 'closed')
            const canRetry = p.running && (phase === 'failed' || phase === 'connecting' || phase === 'disabled')
            return (
              <div
                key={p.id}
                data-project-connection={p.id}
                className="flex flex-wrap items-center gap-3 border-b px-3 py-3"
                style={{ borderColor: 'var(--line)', background: isTarget ? 'var(--accent-soft)' : 'transparent' }}
              >
                <span
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{ background: p.running ? 'var(--ok)' : 'var(--faint)' }}
                />
                <div className="min-w-[180px] flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-[13px]">{p.name}</span>
                    {isTarget ? <Badge tone="accent">{t('project.isTarget')}</Badge> : null}
                    {isTarget && connection.targetPending ? (
                      <Badge tone="warn">{t('project.targetWaiting')}</Badge>
                    ) : null}
                  </div>
                  <div className="truncate text-[11px]" style={{ color: 'var(--faint)' }}>
                    {p.path}
                  </div>
                  {state?.reasonKey && phase !== 'ready' ? <div className="mt-1 text-[11px]" style={{ color: phase === 'failed' ? 'var(--bad)' : 'var(--muted)' }}>
                    {t(state.reasonKey)}
                  </div> : null}
                  {state?.detail ? <details className="mt-1 text-[11px]" style={{ color: 'var(--muted)' }}>
                    <summary className="cursor-pointer">{t('project.connectionDetails')}</summary>
                    <pre className="mt-1 whitespace-pre-wrap break-all">{state.detail}</pre>
                  </details> : null}
                </div>

                <div className="flex shrink-0 items-center gap-1">
                  {p.unityVersion ? <Badge>{p.unityVersion}</Badge> : null}
                  {/*
                    运行判定的**依据**要露出来：`lockfile`/`bridge` 是硬证据，`wmi` 只是兜底
                    （管理员启动的 Unity 读不到 CommandLine）。排障时"它凭什么说 Unity 开着"
                    必须有答案。
                  */}
                  <Badge tone={p.running ? 'ok' : 'default'}>
                    {p.running ? t('project.running') : t('project.notRunning')}
                    {p.running && p.detectedBy?.length ? ` · ${p.detectedBy.join('+')}` : ''}
                  </Badge>
                  <ConnectionBadge phase={phase} />
                  {p.lockfilePresent && !p.running ? (
                    <Badge tone="default">{t('project.staleLockfile')}</Badge>
                  ) : null}
                </div>

                <div className="flex shrink-0 items-center gap-1">
                  <Button onClick={() => setHistoryProject(p.id)}>{t('importHistory.title')}</Button>
                  <Button onClick={() => void setUnityTarget(p.id)} disabled={isTarget || !p.running || phase === 'closed' || phase === 'unsupported' || phase === 'disabled' || state?.reasonKey === 'project.connectionUnsafe'}>
                    {t('project.setTarget')}
                  </Button>
                  {canRetry ? <button type="button" className="btn" data-connection-retry disabled={installing === p.id}
                    onClick={() => void retryConnection(p.id)}>{t('project.retryConnection')}</button> : null}
                  {p.bridgeInstalled ? <details className="relative text-[11px]">
                    <summary className="cursor-pointer px-2 py-1" style={{ color: 'var(--muted)' }}>{t('project.connectionAdvanced')}</summary>
                    <div className="absolute right-0 z-10 mt-1 w-[240px] rounded border p-3 shadow-lg" style={{ borderColor: 'var(--line)', background: 'var(--panel)' }}>
                      <p className="mb-2" style={{ color: 'var(--muted)' }}>{t('project.uninstallAutoConnectHint')}</p>
                      <Button onClick={() => void uninstall(p)} disabled={installing === p.id}>{t('project.uninstallBridge')}</Button>
                    </div>
                  </details> : null}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {historyProject !== undefined ? <ImportHistoryDialog projectId={historyProject} onClose={() => setHistoryProject(undefined)} /> : null}
      <Suspense fallback={null}>
        <VpmProjectsSection
          targetProjectId={connection.targetProjectId}
          targetPending={connection.targetPending === true}
        />
      </Suspense>
      <div className="shrink-0 border-t px-3 py-2 text-[11px]" style={{ borderColor: 'var(--line)', color: 'var(--muted)' }}>
        {t('project.target')}:{' '}
        {connection.targetProjectId
          ? (rows.find((p) => p.id === connection.targetProjectId)?.name ?? connection.targetProjectId)
          : t('project.noTarget')}
      </div>
    </div>
  )
}
