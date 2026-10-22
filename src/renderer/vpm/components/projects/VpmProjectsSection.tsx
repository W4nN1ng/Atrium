import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { VpmProjectDetailDto, VpmProjectSummaryDto } from '../../../../shared/vpm/dto'
import { Badge, Button, Field, MenuButton, Modal } from '../../../components/ui'
import { errorText } from '../../../lib/msg'
import { cleanText, formatTimestamp, vpmCodeLabel } from '../../lib/view'
import { targetBadge } from '../../lib/target'
import { useVpmProjects } from '../../hooks/useProjects'
import { VpmPlanSheet } from '../plan/VpmPlanSheet'
import { VpmPackagesPanel } from '../packages/VpmPackagesPanel'
import { VpmCreateProjectDialog } from './VpmCreateProjectDialog'
import { VpmMaintenancePanel } from './VpmMaintenancePanel'
import { vpmApi } from '../../api'
import type { VpmUnityInstallDto } from '../../../../shared/vpm/dto'

function shortHash(value: string | null): string {
  if (!value) return ''
  return value.length > 18 ? `${value.slice(0, 12)}…${value.slice(-4)}` : value
}

function stateTone(state: string): 'default' | 'accent' | 'ok' | 'warn' | 'bad' {
  if (state === 'installed') return 'ok'
  if (state === 'missing') return 'bad'
  if (state === 'mismatch') return 'warn'
  if (state === 'protected') return 'accent'
  return 'default'
}

/**
 * "打开 Unity"：默认按工程版本匹配，也可以本次临时选另一个编辑器。
 * 启动前主进程会先绑定导入目标；失败会清掉绑定并给错误。
 */
function LaunchControl({
  projectKey,
  running,
  onError
}: {
  projectKey: string
  running: boolean
  onError: (message: string | null) => void
}): JSX.Element {
  const { t } = useTranslation()
  const [editors, setEditors] = useState<VpmUnityInstallDto[]>([])
  const [editorPath, setEditorPath] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [waiting, setWaiting] = useState(false)

  useEffect(() => {
    let cancelled = false
    vpmApi
      .unityInstalls()
      .then((list) => {
        if (!cancelled) setEditors(list.filter((item) => !item.missing))
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [])

  /**
   * 启动后最多等 60 秒：Unity 起来但没连上（登录/许可证对话框、桥接没装）时
   * 不能一直显示"正在连接"，要给一句能照着做的话。
   */
  useEffect(() => {
    if (!waiting) return
    if (running) {
      setWaiting(false)
      setNotice(t('vpm.projects.launched'))
      return
    }
    const timer = setTimeout(() => {
      setWaiting(false)
      setNotice(t('vpm.projects.launchTimeout'))
    }, 60_000)
    return () => clearTimeout(timer)
  }, [waiting, running, t])

  const launch = async (): Promise<void> => {
    setBusy(true)
    setNotice(null)
    onError(null)
    try {
      const result = await vpmApi.projectLaunch({
        projectKey,
        ...(editorPath ? { editorPath } : {})
      })
      if (result.status === 'alreadyRunning') {
        setNotice(t('vpm.projects.alreadyRunning'))
      } else if (result.status === 'unverified') {
        // 命令发出去了，但 45 秒没看到工程被打开：不要再装作"正在连接"。
        setWaiting(false)
        setNotice(null)
        onError(t('vpm.projects.launchUnverified'))
      } else {
        setNotice(t('vpm.projects.launching'))
        setWaiting(true)
      }
    } catch (cause) {
      onError(errorText(cause))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <select
        className="input h-7 w-[190px] text-[11px]"
        value={editorPath}
        onChange={(event) => setEditorPath(event.target.value)}
        aria-label={t('vpm.projects.editor')}
      >
        <option value="">{t('vpm.projects.editorAuto')}</option>
        {editors.map((item) => (
          <option key={item.id} value={item.path}>
            {item.version ?? item.path}
          </option>
        ))}
      </select>
      <Button variant="accent" disabled={busy} onClick={() => void launch()}>
        {busy ? t('vpm.projects.launching') : t('vpm.projects.openUnity')}
      </Button>
      {notice ? (
        <span className="text-[10px]" style={{ color: 'var(--ok)' }}>
          {notice}
        </span>
      ) : null}
    </div>
  )
}

function DetailBody({
  detail,
  onChanged,
  onOpenFolder,
  onRescan,
  onPreview,
  onRemove
}: {
  detail: VpmProjectDetailDto
  onChanged: () => void
  onOpenFolder: () => void
  onRescan: () => void
  onPreview: () => void
  onRemove: () => void
}): JSX.Element {
  const { t } = useTranslation()
  const [advancedOpen, setAdvancedOpen] = useState(false)
  return (
    <div className="max-h-[76vh] space-y-4 overflow-y-auto pr-1 text-[13px]" data-vpm-project-detail>
      {/* 头部只放名字、版本、运行点；路径/哈希这些排障信息在下面的"高级"里 */}
      <div className="flex flex-wrap items-center gap-2">
        <span
          className="h-2.5 w-2.5 shrink-0 rounded-full"
          style={{ background: detail.running ? 'var(--ok)' : 'var(--faint)' }}
        />
        {/* 名字只在弹窗标题里出现一次（R10） */}
        {detail.unityVersion ? <Badge>{detail.unityVersion}</Badge> : null}
        {!detail.linked ? <Badge tone="warn">{t('vpm.projects.unlinkedShort')}</Badge> : null}
        <MenuButton
          className="ml-auto"
          title={t('vpm.projects.more')}
          items={[
            { key: 'folder', label: t('vpm.projects.openFolder'), onSelect: onOpenFolder },
            { key: 'rescan', label: t('vpm.projects.rescan'), onSelect: onRescan },
            { key: 'plan', label: t('vpm.plan.preview'), onSelect: onPreview },
            { key: 'remove', label: t('vpm.projects.remove'), danger: true, onSelect: onRemove }
          ]}
        />
      </div>

      {!detail.linked ? (
        <div className="rounded border px-3 py-2 text-[11px]" style={{ borderColor: 'var(--warn)', color: 'var(--warn)' }}>
          {t('vpm.projects.notLinked')}
        </div>
      ) : null}

      {detail.warnings.length ? (
        <div className="space-y-1.5">
          {detail.warnings.map((warning, index) => (
            <div
              key={`${warning.code}-${index}`}
              className="rounded border px-3 py-2 text-[11px]"
              style={{ borderColor: 'var(--warn)', color: 'var(--warn)' }}
            >
              {vpmCodeLabel(warning.code)}
              {warning.path ? (
                <span className="faint ml-2 break-all font-mono">{cleanText(warning.path, 400)}</span>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}

      <VpmPackagesPanel projectKey={detail.projectKey} detail={detail} onChanged={onChanged} />

      <VpmMaintenancePanel projectKey={detail.projectKey} detail={detail} onChanged={onChanged} />

      <details
        open={advancedOpen}
        onToggle={(event) => setAdvancedOpen((event.target as HTMLDetailsElement).open)}
      >
        <summary className="cursor-pointer select-none text-[12px]" style={{ color: 'var(--muted)' }}>
          {t('vpm.projects.advanced')}
        </summary>
        <div className="mt-2 grid grid-cols-[96px_1fr] gap-x-3 gap-y-1.5 text-[11px]">
          <span className="faint">{t('vpm.projects.path')}</span>
          <span className="break-all font-mono">{cleanText(detail.path, 1000)}</span>
          <span className="faint">{t('vpm.projects.editor')}</span>
          <span className="break-all font-mono">
            {detail.unityExePath ? cleanText(detail.unityExePath, 1000) : t('vpm.projects.notRecorded')}
          </span>
          <span className="faint">{t('vpm.projects.manifest')}</span>
          <span>
            {detail.hasVpmManifest ? t('vpm.projects.manifestPresent') : t('vpm.projects.manifestMissing')}
            {detail.manifestHash ? (
              <span className="faint ml-2 font-mono">{shortHash(detail.manifestHash)}</span>
            ) : null}
          </span>
          <span className="faint">{t('vpm.projects.lastScan')}</span>
          <span>{formatTimestamp(detail.lastScanAt) || t('vpm.projects.notRecorded')}</span>
        </div>
      </details>
    </div>
  )
}

export function VpmProjectsSection({
  targetProjectId = null,
  targetPending = false,
  onOpenHistory
}: {
  targetProjectId?: string | null
  targetPending?: boolean
  /** 打开该工程的素材导入历史（R11：入口从行内按钮挪进 ⋯）。 */
  onOpenHistory?: (coreId: string) => void
}): JSX.Element | null {
  const { t } = useTranslation()
  const projects = useVpmProjects()
  const [query, setQuery] = useState('')
  const [addOpen, setAddOpen] = useState(false)
  const [addPath, setAddPath] = useState('')
  const [addError, setAddError] = useState<string | null>(null)
  const [removeTarget, setRemoveTarget] = useState<VpmProjectSummaryDto | null>(null)
  const [removeError, setRemoveError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [planProjectKey, setPlanProjectKey] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)

  useEffect(() => {
    if (!projects.notice) return
    const timer = setTimeout(() => projects.dismissNotice(), 4000)
    return () => clearTimeout(timer)
  }, [projects.notice, projects.dismissNotice])

  if (projects.statusLoading || !projects.status) return null
  if (!projects.status.enabled || projects.status.safeMode || projects.status.degraded) {
    // R11：这一页现在只有项目列表，停用时不能整页空白。
    return (
      <div className="rounded border px-3 py-6 text-center" style={{ borderColor: 'var(--line)' }}>
        <div className="text-[14px]">{t('vpm.projects.disabledTitle')}</div>
        <p className="mt-1 text-[12px]" style={{ color: 'var(--muted)' }}>
          {t('vpm.projects.disabledHint')}
        </p>
      </div>
    )
  }

  const visible = projects.items.filter((item) => item.hasLedger)
  const filtered = visible.filter((item) => {
    const text = query.trim().toLowerCase()
    return !text || item.name.toLowerCase().includes(text) || item.path.toLowerCase().includes(text)
  })

  const openAdd = (): void => {
    setAddPath('')
    setAddError(null)
    setAddOpen(true)
  }

  const pickPath = async (): Promise<void> => {
    setAddError(null)
    try {
      const picked = await projects.pickDirectory(t('vpm.projects.addTitle'))
      if (picked) setAddPath(picked)
    } catch (cause) {
      setAddError(errorText(cause))
    }
  }

  const submitAdd = async (): Promise<void> => {
    setAddError(null)
    try {
      await projects.add(addPath.trim())
      setAddOpen(false)
    } catch (cause) {
      setAddError(errorText(cause))
    }
  }

  const openFromRow = async (key: string): Promise<void> => {
    setActionError(null)
    try {
      await vpmApi.projectLaunch({ projectKey: key })
      await projects.refresh()
    } catch (cause) {
      setActionError(errorText(cause))
    }
  }

  const openDetail = async (key: string): Promise<void> => {
    setActionError(null)
    await projects.select(key)
  }

  const rescan = async (key: string): Promise<void> => {
    setActionError(null)
    try {
      await projects.rescan(key)
    } catch (cause) {
      setActionError(errorText(cause))
    }
  }

  const confirmRemove = async (): Promise<void> => {
    if (!removeTarget) return
    setRemoveError(null)
    try {
      const ok = await projects.remove(removeTarget.projectKey)
      if (ok) {
        setRemoveTarget(null)
        setActionError(null)
      } else {
        setRemoveError(t('vpm.projects.notLinked'))
      }
    } catch (cause) {
      setRemoveError(errorText(cause))
    }
  }

  const detail = projects.detail

  return (
    <section className="space-y-2" data-vpm-projects>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[15px] font-medium">{t('vpm.projects.title')}</span>
        <Badge>{visible.length}</Badge>
        <div className="ml-auto flex gap-2">
          <Button variant="accent" onClick={() => setCreateOpen(true)} disabled={projects.busy}>
            {t('vpm.create.title')}
          </Button>
          <Button variant="ghost" onClick={openAdd} disabled={projects.busy}>
            {t('vpm.projects.add')}
          </Button>
          <Button onClick={() => void projects.refresh()} disabled={projects.loading || projects.busy}>
            {t('vpm.projects.refresh')}
          </Button>
        </div>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <input
          className="input min-w-[220px] flex-1"
          value={query}
          placeholder={t('vpm.projects.search')}
          onChange={(event) => setQuery(event.target.value)}
        />
        {projects.notice ? (
          <span className="text-[11px]" style={{ color: 'var(--ok)' }}>
            {t('vpm.projects.removeDone')}
          </span>
        ) : null}
      </div>

      {projects.error ? (
        <div className="mt-2 rounded border px-3 py-2 text-[11px]" style={{ borderColor: 'var(--bad)', color: 'var(--bad)' }}>
          {projects.error}
        </div>
      ) : null}

      {filtered.length ? (
        <div className="mt-2 max-h-[46vh] overflow-y-auto rounded border" style={{ borderColor: 'var(--line)' }}>
          {filtered.map((item) => (
            <div
              key={item.projectKey}
              className="flex min-h-[56px] items-center gap-3 border-b px-3 py-3 text-[13px] last:border-b-0"
              style={{ borderColor: 'var(--line)' }}
              data-vpm-project={item.projectKey}
            >
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ background: item.running ? 'var(--ok)' : 'var(--faint)' }}
                title={item.running ? t('vpm.projects.running') : undefined}
              />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="truncate text-[17px] font-semibold">{cleanText(item.name, 200)}</span>
                  {item.unityVersion ? (
                    <span className="text-[12px]" style={{ color: 'var(--muted)' }}>
                      {item.unityVersion}
                    </span>
                  ) : null}
                  {(() => {
                    const badge = targetBadge(item, targetProjectId, targetPending)
                    if (!badge) return null
                    // 静态 key：i18n 检查脚本要能扫到，不用动态拼接。
                    return (
                      <Badge tone={badge.tone}>
                        {badge.key === 'isTarget' ? t('project.isTarget') : t('project.targetWaiting')}
                      </Badge>
                    )
                  })()}
                  {!item.linked ? <Badge tone="warn">{t('vpm.projects.unlinkedShort')}</Badge> : null}
                  {item.legacyCount ? (
                    <Badge tone="warn">{t('vpm.projects.legacyCount', { count: item.legacyCount })}</Badge>
                  ) : null}
                </div>
                <div className="truncate text-[12px]" style={{ color: 'var(--faint)' }}>
                  {cleanText(item.path, 1000)}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                <Button onClick={() => void openFromRow(item.projectKey)} disabled={projects.busy}>
                  {item.running ? t('vpm.projects.opened') : t('vpm.projects.open')}
                </Button>
                <Button variant="ghost" onClick={() => void openDetail(item.projectKey)}>
                  {t('vpm.projects.manage')}
                </Button>
                <MenuButton
                  title={t('vpm.projects.more')}
                  items={[
                    ...(onOpenHistory && item.coreId
                      ? [
                          {
                            key: 'history',
                            label: t('vpm.projects.importHistory'),
                            onSelect: () => onOpenHistory(item.coreId as string)
                          }
                        ]
                      : []),
                    { key: 'rescan', label: t('vpm.projects.rescan'), onSelect: () => void rescan(item.projectKey) },
                    {
                      key: 'folder',
                      label: t('vpm.projects.openFolder'),
                      onSelect: () => void projects.openFolder(item.projectKey)
                    },
                    {
                      key: 'remove',
                      label: t('vpm.projects.remove'),
                      danger: true,
                      onSelect: () => {
                        setRemoveError(null)
                        setRemoveTarget(item)
                      }
                    }
                  ]}
                />
              </div>
            </div>
          ))}
        </div>
      ) : visible.length === 0 ? (
        <div className="mt-3 rounded border px-3 py-4 text-center" style={{ borderColor: 'var(--line)' }}>
          <div className="text-[12px]">{t('vpm.projects.empty')}</div>
          <div className="faint mt-1 text-[11px]">{t('vpm.projects.emptyHint')}</div>
          <div className="mt-2">
            <Button variant="accent" onClick={openAdd} disabled={projects.busy}>
              {t('vpm.projects.add')}
            </Button>
          </div>
        </div>
      ) : (
        <div className="faint mt-3 text-[11px]">{t('vpm.projects.noMatch')}</div>
      )}

      <Modal
        open={addOpen}
        onOpenChange={(open) => {
          if (!projects.busy) setAddOpen(open)
        }}
        title={t('vpm.projects.addTitle')}
        footer={
          <>
            <Button onClick={() => setAddOpen(false)} disabled={projects.busy}>
              {t('common.cancel')}
            </Button>
            <Button variant="accent" onClick={() => void submitAdd()} disabled={projects.busy || !addPath.trim()}>
              {projects.busy ? t('vpm.projects.adding') : t('vpm.projects.add')}
            </Button>
          </>
        }
      >
        <div className="space-y-3 text-[12px]">
          <Field label={t('vpm.projects.path')} hint={t('vpm.projects.addHint')}>
            <div className="flex gap-2">
              <input
                className="input flex-1 font-mono"
                value={addPath}
                placeholder={t('vpm.projects.pathPlaceholder')}
                onChange={(event) => {
                  setAddPath(event.target.value)
                  setAddError(null)
                }}
              />
              <Button variant="ghost" onClick={() => void pickPath()} disabled={projects.busy}>
                {t('vpm.projects.pick')}
              </Button>
            </div>
          </Field>
          {addError ? (
            <div className="rounded border px-2 py-1.5 text-[11px]" style={{ borderColor: 'var(--bad)', color: 'var(--bad)' }}>
              {addError}
            </div>
          ) : null}
        </div>
      </Modal>

      <Modal
        open={projects.selectedKey !== null}
        onOpenChange={(open) => {
          if (!open) {
            projects.closeDetail()
            setActionError(null)
            setRemoveTarget(null)
          }
        }}
        width={1080}
        title={detail ? cleanText(detail.name, 120) : t('vpm.projects.detailTitle')}
        footer={
          <>
            {detail ? (
              <LaunchControl
                projectKey={detail.projectKey}
                running={detail.running}
                onError={(message) => setActionError(message)}
              />
            ) : null}
            <Button onClick={() => projects.closeDetail()}>{t('vpm.projects.close')}</Button>
          </>
        }
      >
        <div className="space-y-3 text-[12px]">
          {projects.detailLoading ? (
            <p className="faint">{t('vpm.projects.loading')}</p>
          ) : detail ? (
            <>
              {actionError ? (
                <div className="rounded border px-3 py-2 text-[11px]" style={{ borderColor: 'var(--bad)', color: 'var(--bad)' }}>
                  {actionError}
                </div>
              ) : null}
              <DetailBody
                detail={detail}
                onChanged={() => {
                  void projects.select(detail.projectKey)
                }}
                onOpenFolder={() => void projects.openFolder(detail.projectKey)}
                onRescan={() => void rescan(detail.projectKey)}
                onPreview={() => {
                  setPlanProjectKey(detail.projectKey)
                  projects.closeDetail()
                  setActionError(null)
                  setRemoveTarget(null)
                }}
                onRemove={() => {
                  setRemoveError(null)
                  setRemoveTarget(detail)
                }}
              />
            </>
          ) : (
            <p className="faint">{projects.error ?? t('vpm.projects.noMatch')}</p>
          )}

          <Modal
            open={removeTarget !== null}
            onOpenChange={(open) => {
              if (!open && !projects.busy) setRemoveTarget(null)
            }}
            title={t('vpm.projects.removeTitle')}
            footer={
              <>
                <Button onClick={() => setRemoveTarget(null)} disabled={projects.busy}>
                  {t('common.cancel')}
                </Button>
                <Button onClick={() => void confirmRemove()} disabled={projects.busy}>
                  {t('vpm.projects.remove')}
                </Button>
              </>
            }
          >
            <div className="text-[12px] leading-relaxed" style={{ color: 'var(--muted)' }}>
              <div>{t('vpm.projects.removeBody')}</div>
              {removeTarget ? <div className="mt-2 break-all font-mono text-[11px]">{cleanText(removeTarget.name, 200)}</div> : null}
              {removeError ? (
                <div className="mt-2 rounded border px-2 py-1.5 text-[11px]" style={{ borderColor: 'var(--bad)', color: 'var(--bad)' }}>
                  {removeError}
                </div>
              ) : null}
            </div>
          </Modal>
        </div>
      </Modal>

      <VpmCreateProjectDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={(projectKey) => {
          void projects.refresh()
          void projects.select(projectKey)
        }}
      />

      <VpmPlanSheet
        open={planProjectKey !== null}
        projectKey={planProjectKey ?? ''}
        onOpenChange={(next) => {
          if (!next) setPlanProjectKey(null)
        }}
      />
    </section>
  )
}
