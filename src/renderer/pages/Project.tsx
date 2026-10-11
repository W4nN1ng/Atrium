import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ProjectInfo } from '../../shared/types'
import { useUi } from '../stores/ui'
import { Badge, Button, EmptyState } from '../components/ui'
import { ImportHistoryDialog } from '../components/ImportHistoryDialog'

/**
 * Unity 工程页。
 *
 * M5-A 之后这里不再是"只做发现"：
 *  - 运行状态由**三路取并集**判定（`project/running.ts`），`detectedBy` 会显示依据
 *  - 可以装/卸桥接（`bridge/installer.ts`，卸载走回收站）
 *  - 可以选导入目标（和顶栏切换器是同一个状态）
 *
 * ⚠ 自动切换集合（打开 shinano-Main2 → 切到「Shinano」集合 + 横幅）是 M5-A 剩下的活，
 * 这里**不写**"已支持"。
 */
export function Project(): JSX.Element {
  const { t } = useTranslation()
  const [busy, setBusy] = useState(false)
  const [installing, setInstalling] = useState<string | null>(null)
  const [historyProject, setHistoryProject] = useState<string | null | undefined>(undefined)
  const rows = useUi((s) => s.projects)
  const refreshProjects = useUi((s) => s.refreshProjects)
  const setUnityTarget = useUi((s) => s.setUnityTarget)
  const unity = useUi((s) => s.unity)
  const toast = useUi((s) => s.toast)
  const settleBridgeAsk = useUi((s) => s.settleBridgeAsk)

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

  async function install(p: ProjectInfo): Promise<void> {
    setInstalling(p.id)
    try {
      const r = await window.a.unity.installBridge(p.id)
      if (r.ok) {
        /** 装成了这条待答就有着落了（不然弹窗还会拿旧事件问"这个工程没装桥接"） */
        settleBridgeAsk(p.id)
        toast(
          'ok',
          r.alreadyInstalled
            ? t('project.installAlready', { name: p.name })
            : t('project.installDone', { name: p.name, count: r.copied })
        )
      } else {
        toast('bad', r.error ?? t('project.installFailed'))
      }
      await load()
    } catch (e) {
      toast('bad', e instanceof Error ? e.message : String(e))
    } finally {
      setInstalling(null)
    }
  }

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
            const isTarget = p.id === unity.targetProjectId
            return (
              <div
                key={p.id}
                className="flex items-center gap-3 border-b px-3 py-2"
                style={{ borderColor: 'var(--line)', background: isTarget ? 'var(--accent-soft)' : 'transparent' }}
              >
                <span
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{ background: p.running ? 'var(--ok)' : 'var(--faint)' }}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-[13px]">{p.name}</span>
                    {isTarget ? <Badge tone="accent">{t('project.isTarget')}</Badge> : null}
                  </div>
                  <div className="truncate text-[11px]" style={{ color: 'var(--faint)' }}>
                    {p.path}
                  </div>
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
                  {p.bridgeInstalled ? (
                    <Badge tone="ok">
                      {t('project.bridgeReady')}
                      {p.bridgeVersion ? ` ${p.bridgeVersion}` : ''}
                    </Badge>
                  ) : (
                    <Badge tone="warn">{t('project.bridgeMissing')}</Badge>
                  )}
                  {p.lockfilePresent && !p.running ? (
                    <Badge tone="default">{t('project.staleLockfile')}</Badge>
                  ) : null}
                </div>

                <div className="flex shrink-0 items-center gap-1">
                  <Button onClick={() => setHistoryProject(p.id)}>{t('importHistory.title')}</Button>
                  <Button onClick={() => void setUnityTarget(p.id)} disabled={isTarget}>
                    {t('project.setTarget')}
                  </Button>
                  {p.bridgeInstalled ? (
                    <Button onClick={() => void uninstall(p)} disabled={installing === p.id}>
                      {t('project.uninstallBridge')}
                    </Button>
                  ) : (
                    <Button variant="accent" onClick={() => void install(p)} disabled={installing === p.id}>
                      {t('project.installBridge')}
                    </Button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {historyProject !== undefined ? <ImportHistoryDialog projectId={historyProject} onClose={() => setHistoryProject(undefined)} /> : null}
      <div className="shrink-0 border-t px-3 py-2 text-[11px]" style={{ borderColor: 'var(--line)', color: 'var(--muted)' }}>
        {t('project.target')}:{' '}
        {unity.targetProjectId
          ? (rows.find((p) => p.id === unity.targetProjectId)?.name ?? unity.targetProjectId)
          : t('project.noTarget')}
        {unity.targetProjectId ? (unity.running ? ` · ${t('project.running')}` : ` · ${t('project.notRunning')}`) : ''}
      </div>
    </div>
  )
}
