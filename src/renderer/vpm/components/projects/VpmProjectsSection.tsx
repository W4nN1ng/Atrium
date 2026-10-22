import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { VpmProjectDetailDto, VpmProjectSummaryDto } from '../../../../shared/vpm/dto'
import { Badge, Button, Field, Modal } from '../../../components/ui'
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
  onError
}: {
  projectKey: string
  onError: (message: string | null) => void
}): JSX.Element {
  const { t } = useTranslation()
  const [editors, setEditors] = useState<VpmUnityInstallDto[]>([])
  const [editorPath, setEditorPath] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

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

  const launch = async (): Promise<void> => {
    setBusy(true)
    setNotice(null)
    onError(null)
    try {
      const result = await vpmApi.projectLaunch({
        projectKey,
        ...(editorPath ? { editorPath } : {})
      })
      setNotice(result.status === 'alreadyRunning' ? t('vpm.projects.alreadyRunning') : t('vpm.projects.launched'))
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
  onChanged
}: {
  detail: VpmProjectDetailDto
  onChanged: () => void
}): JSX.Element {
  const { t } = useTranslation()
  return (
    <div className="max-h-[62vh] space-y-4 overflow-y-auto pr-1 text-[12px]" data-vpm-project-detail>
      {!detail.linked ? (
        <div className="rounded border px-3 py-2 text-[11px]" style={{ borderColor: 'var(--warn)', color: 'var(--warn)' }}>
          {t('vpm.projects.notLinked')}
        </div>
      ) : null}

      <section>
        <div className="mb-2 text-[12px] font-medium">{t('vpm.projects.overview')}</div>
        <div className="grid grid-cols-[120px_1fr] gap-x-3 gap-y-1.5 text-[11px]">
          <span className="faint">{t('vpm.projects.path')}</span>
          <span className="break-all font-mono">{cleanText(detail.path, 1000)}</span>
          <span className="faint">{t('vpm.projects.unityVersion')}</span>
          <span>
            {detail.unityVersion ?? t('vpm.projects.notRecorded')}
            {detail.unityRevision ? ` · ${t('vpm.projects.revision')} ${detail.unityRevision}` : ''}
          </span>
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
          <span className="faint">{t('vpm.projects.stateLabel')}</span>
          <span>
            {detail.running ? t('vpm.projects.running') : t('vpm.projects.notRunning')}
            {detail.running && detail.detectedBy.length ? ` · ${detail.detectedBy.join('+')}` : ''}
          </span>
        </div>
      </section>

      <VpmPackagesPanel projectKey={detail.projectKey} detail={detail} onChanged={onChanged} />

      <VpmMaintenancePanel projectKey={detail.projectKey} detail={detail} onChanged={onChanged} />

      <section>
        <div className="mb-2 text-[12px] font-medium">{t('vpm.projects.warnings')}</div>
        {detail.warnings.length ? (
          <div className="space-y-1.5">
            {detail.warnings.map((warning, index) => (
              <div
                key={`${warning.code}-${index}`}
                className="rounded border px-3 py-2 text-[11px]"
                style={{ borderColor: 'var(--line)' }}
              >
                <div>{vpmCodeLabel(warning.code)}</div>
                {warning.path ? <div className="faint mt-1 break-all font-mono">{cleanText(warning.path, 1000)}</div> : null}
              </div>
            ))}
          </div>
        ) : (
          <p className="faint text-[11px]">{t('vpm.projects.noWarnings')}</p>
        )}
      </section>

      <section>
        <div className="mb-2 flex flex-wrap items-center gap-2 text-[12px] font-medium">
          {t('vpm.projects.legacy')}
          {detail.legacyCount ? <Badge tone="warn">{t('vpm.projects.legacyCount', { count: detail.legacyCount })}</Badge> : null}
        </div>
        <p className="faint mb-2 text-[11px] leading-relaxed">{t('vpm.projects.legacyHint')}</p>
        {detail.legacy.candidates.length ? (
          <div className="rounded border" style={{ borderColor: 'var(--line)' }}>
            {detail.legacy.candidates.map((candidate, index) => (
              <div
                key={`${candidate.match}-${candidate.relativePath ?? candidate.name ?? index}`}
                className="border-b px-3 py-2 last:border-b-0"
                style={{ borderColor: 'var(--line)' }}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="min-w-[160px] flex-1 break-all font-mono text-[11px]">
                    {cleanText(candidate.name ?? candidate.relativePath ?? '—', 400)}
                  </span>
                  <Badge>{t(`vpm.projects.match.${candidate.match}`)}</Badge>
                  <span className="faint text-[10px]">
                    {t('vpm.projects.legacyConfidence')} · {t(`vpm.projects.confidence.${candidate.confidence}`)}
                  </span>
                </div>
                {candidate.relativePath ? (
                  <div className="faint mt-1 break-all font-mono text-[10px]">{cleanText(candidate.relativePath, 600)}</div>
                ) : null}
              </div>
            ))}
          </div>
        ) : (
          <p className="faint text-[11px]">{t('vpm.projects.legacyNone')}</p>
        )}
      </section>

      <p className="faint text-[11px] leading-relaxed">{t('vpm.projects.actionsLater')}</p>
    </div>
  )
}

export function VpmProjectsSection({
  targetProjectId = null,
  targetPending = false
}: {
  targetProjectId?: string | null
  targetPending?: boolean
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
  if (!projects.status.enabled || projects.status.safeMode || projects.status.degraded) return null

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
    <section
      className="shrink-0 border-t px-3 py-3"
      style={{ borderColor: 'var(--line)' }}
      data-vpm-projects
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[13px] font-medium">{t('vpm.projects.title')}</span>
        <Badge>{visible.length}</Badge>
        <Badge>{t('vpm.projects.readOnly')}</Badge>
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
      <p className="faint mt-1 text-[11px] leading-relaxed">{t('vpm.projects.intro')}</p>

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
        <div className="mt-2 max-h-[32vh] overflow-y-auto rounded border" style={{ borderColor: 'var(--line)' }}>
          {filtered.map((item) => (
            <div
              key={item.projectKey}
              className="flex flex-wrap items-center gap-2 border-b px-3 py-2 last:border-b-0"
              style={{ borderColor: 'var(--line)' }}
              data-vpm-project={item.projectKey}
            >
              <span
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ background: item.running ? 'var(--ok)' : 'var(--faint)' }}
              />
              <div className="min-w-[160px] flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="truncate text-[12px]">{cleanText(item.name, 200)}</span>
                  <Badge tone={item.running ? 'ok' : 'default'}>
                    {item.running ? t('vpm.projects.running') : t('vpm.projects.notRunning')}
                  </Badge>
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
                <div className="faint truncate text-[10px]">{cleanText(item.path, 1000)}</div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {item.unityVersion ? <Badge>{item.unityVersion}</Badge> : null}
                <span className="faint text-[10px]">{t('vpm.projects.packageCount', { count: item.packageCount })}</span>
                <Button variant="ghost" onClick={() => void openDetail(item.projectKey)}>
                  {t('vpm.projects.details')}
                </Button>
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
        title={t('vpm.projects.detailTitle')}
        footer={
          detail ? (
            <>
              <Button onClick={() => projects.closeDetail()}>{t('vpm.projects.close')}</Button>
              <Button variant="ghost" onClick={() => void projects.openFolder(detail.projectKey)}>
                {t('vpm.projects.openFolder')}
              </Button>
              <Button variant="ghost" onClick={() => void rescan(detail.projectKey)} disabled={projects.busy}>
                {t('vpm.projects.rescan')}
              </Button>
              <LaunchControl
                projectKey={detail.projectKey}
                onError={(message) => setActionError(message)}
              />
              <Button
                variant="ghost"
                onClick={() => {
                  setPlanProjectKey(detail.projectKey)
                  projects.closeDetail()
                  setActionError(null)
                  setRemoveTarget(null)
                }}
              >
                {t('vpm.plan.preview')}
              </Button>
              <button
                type="button"
                className="btn"
                style={{ color: 'var(--bad)' }}
                disabled={projects.busy}
                onClick={() => {
                  setRemoveError(null)
                  setRemoveTarget(detail)
                }}
              >
                {t('vpm.projects.remove')}
              </button>
            </>
          ) : (
            <Button onClick={() => projects.closeDetail()}>{t('vpm.projects.close')}</Button>
          )
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
