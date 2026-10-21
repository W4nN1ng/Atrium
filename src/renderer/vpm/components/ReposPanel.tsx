import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { VpmNetworkStatus, VpmRepoDto } from '../../../shared/vpm/dto'
import { errorText } from '../../lib/msg'
import { Badge, Button, Field, Modal, Switch } from '../../components/ui'
import type { VpmOperationState } from '../hooks/useVpmRepos'
import { formatTimestamp, repoErrorLabel, repoHost } from '../lib/view'

interface ReposPanelProps {
  repos: VpmRepoDto[]
  network: VpmNetworkStatus | null
  operation: VpmOperationState | null
  loading: boolean
  busy: boolean
  error: string | null
  notice: string | null
  onSetNetwork: (enabled: boolean) => Promise<void>
  onReload: () => void
  onAdd: (input: { url: string; name?: string }) => Promise<VpmRepoDto>
  onRemove: (id: string) => Promise<void>
  onRefresh: (id: string) => void
  onRefreshAll: () => void
  onUseOfficial: () => void
  onBrowse: () => void
  onDismissNotice: () => void
}

export function ReposPanel(props: ReposPanelProps): JSX.Element {
  const { t } = useTranslation()
  const [addOpen, setAddOpen] = useState(false)
  const [url, setUrl] = useState('')
  const [name, setName] = useState('')
  const [adding, setAdding] = useState(false)
  const [addError, setAddError] = useState<string | null>(null)
  const [removeTarget, setRemoveTarget] = useState<VpmRepoDto | null>(null)
  const [removing, setRemoving] = useState(false)
  const [removeError, setRemoveError] = useState<string | null>(null)

  const openAdd = (): void => {
    setUrl('')
    setName('')
    setAddError(null)
    setAddOpen(true)
  }

  const submitAdd = async (): Promise<void> => {
    if (!url.trim() || adding) return
    setAdding(true)
    setAddError(null)
    try {
      await props.onAdd({ url: url.trim(), name: name.trim() || undefined })
      setAddOpen(false)
      setUrl('')
      setName('')
    } catch (cause) {
      setAddError(errorText(cause))
    } finally {
      setAdding(false)
    }
  }

  const submitRemove = async (): Promise<void> => {
    if (!removeTarget || removing) return
    setRemoving(true)
    setRemoveError(null)
    try {
      await props.onRemove(removeTarget.id)
      setRemoveTarget(null)
    } catch (cause) {
      setRemoveError(errorText(cause))
    } finally {
      setRemoving(false)
    }
  }

  const networkAllowed = props.network?.allowed === true
  const progress = props.operation
    ? Math.min(100, Math.round((props.operation.done / Math.max(1, props.operation.total)) * 100))
    : 0

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h4 className="text-[13px] font-medium">{t('vpm.repos.title')}</h4>
            {networkAllowed ? (
              <Badge tone="ok">{t('vpm.repos.networkAllowed')}</Badge>
            ) : (
              <Badge tone="warn">{t('vpm.repos.cacheOnly')}</Badge>
            )}
          </div>
          <p className="faint mt-1 text-[11px] leading-relaxed">{t('vpm.repos.intro')}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className="faint text-[11px]">{t('vpm.repos.network')}</span>
          <Switch
            checked={networkAllowed}
            onChange={(value) => void props.onSetNetwork(value)}
          />
          <Button variant="accent" onClick={openAdd} disabled={props.busy}>
            {t('vpm.repos.add')}
          </Button>
        </div>
      </div>

      {!networkAllowed ? (
        <div
          className="rounded border px-3 py-2 text-[11px] leading-relaxed"
          style={{ borderColor: 'var(--warn)', color: 'var(--warn)' }}
        >
          <div>{t('vpm.repos.noConsent')}</div>
          <div className="mt-2 flex items-center gap-2">
            <Button variant="ghost" onClick={() => void props.onSetNetwork(true)}>
              {t('vpm.repos.allowNetwork')}
            </Button>
            <span>{t('vpm.repos.officialHint')}</span>
          </div>
        </div>
      ) : null}

      {props.notice ? (
        <div
          className="flex items-center justify-between gap-3 rounded border px-3 py-2 text-[11px]"
          style={{ borderColor: 'var(--line-2)', color: 'var(--muted)' }}
        >
          <span>{props.notice}</span>
          <Button variant="ghost" onClick={props.onDismissNotice}>
            {t('common.close')}
          </Button>
        </div>
      ) : null}

      {props.error ? (
        <div
          className="rounded border px-3 py-2 text-[11px] leading-relaxed"
          style={{ borderColor: 'var(--bad)', color: 'var(--bad)' }}
        >
          <div>{props.error}</div>
          <div className="mt-2">
            <Button variant="ghost" onClick={props.onReload}>
              {t('common.reload')}
            </Button>
          </div>
        </div>
      ) : null}

      {props.operation ? (
        <div className="rounded border px-3 py-2 text-[11px]" style={{ borderColor: 'var(--line-2)' }}>
          <div className="flex items-center justify-between gap-3">
            <span>
              {t('vpm.operation.refreshing', {
                done: props.operation.done,
                total: props.operation.total
              })}
            </span>
            <span className="faint">{progress}%</span>
          </div>
          <div className="mt-1.5 h-1 overflow-hidden rounded" style={{ background: 'var(--line)' }}>
            <div
              className="h-full transition-[width]"
              style={{ width: `${progress}%`, background: 'var(--accent)' }}
            />
          </div>
        </div>
      ) : null}

      {props.loading && !props.repos.length ? (
        <div className="faint rounded border px-3 py-4 text-[11px]" style={{ borderColor: 'var(--line)' }}>
          {t('common.loading')}
        </div>
      ) : null}

      {!props.loading && !props.error && !props.repos.length ? (
        <div className="rounded border p-3" style={{ borderColor: 'var(--line)' }}>
          <div className="text-[12px]">{t('vpm.repos.empty')}</div>
          <p className="faint mt-1 text-[11px] leading-relaxed">{t('vpm.repos.emptyHint')}</p>
          <div className="mt-3 flex items-center gap-2">
            <Button variant="accent" onClick={openAdd} disabled={props.busy}>
              {t('vpm.repos.add')}
            </Button>
            <Button variant="ghost" onClick={props.onUseOfficial} disabled={props.busy}>
              {t('vpm.repos.useOfficial')}
            </Button>
          </div>
        </div>
      ) : null}

      {props.repos.length ? (
        <div className="space-y-2">
          <div className="flex items-center justify-end">
            <Button
              variant="ghost"
              onClick={props.onRefreshAll}
              disabled={props.busy || !!props.operation || !networkAllowed}
            >
              {props.operation ? t('vpm.repos.refreshing') : t('vpm.repos.refreshAll')}
            </Button>
          </div>
          {props.repos.map((repo) => {
            const lastSuccess = formatTimestamp(repo.lastSuccessAt)
            const lastError = repoErrorLabel(repo.lastErrorCode)
            return (
              <div
                key={repo.id}
                className="rounded border p-3"
                style={{ borderColor: 'var(--line)' }}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[12px] font-medium">{repo.name}</span>
                      <Badge>{t('vpm.repos.packages', { count: repo.packageCount })}</Badge>
                    </div>
                    <div className="faint mt-1 break-all text-[11px]">{repoHost(repo.url)}</div>
                    <div className="faint mt-1 text-[11px]">
                      {lastSuccess
                        ? t('vpm.repos.lastSuccess', { time: lastSuccess })
                        : t('vpm.repos.never')}
                    </div>
                    {lastError ? (
                      <div className="mt-1 text-[11px]" style={{ color: 'var(--bad)' }}>
                        {t('vpm.repos.lastError', { error: lastError })}
                      </div>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Button
                      variant="ghost"
                      onClick={() => props.onRefresh(repo.id)}
                      disabled={props.busy || !!props.operation || !networkAllowed}
                    >
                      {t('vpm.repos.refresh')}
                    </Button>
                    <Button
                      variant="ghost"
                      onClick={() => {
                        setRemoveError(null)
                        setRemoveTarget(repo)
                      }}
                      disabled={props.busy || !!props.operation}
                    >
                      {t('vpm.repos.remove')}
                    </Button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      ) : null}

      <div className="rounded border p-3" style={{ borderColor: 'var(--line)' }}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[12px] font-medium">{t('vpm.catalog.title')}</div>
            <p className="faint mt-1 text-[11px] leading-relaxed">{t('vpm.catalog.intro')}</p>
          </div>
          <Button
            variant="accent"
            onClick={props.onBrowse}
            disabled={!props.repos.length || props.busy}
          >
            {t('vpm.catalog.browse')}
          </Button>
        </div>
        <p className="faint mt-2 text-[11px] leading-relaxed">{t('vpm.catalog.installLater')}</p>
      </div>

      <Modal
        open={addOpen}
        onOpenChange={(open) => {
          if (!adding) setAddOpen(open)
        }}
        title={t('vpm.repos.addTitle')}
        footer={
          <>
            <Button onClick={() => setAddOpen(false)} disabled={adding}>
              {t('common.cancel')}
            </Button>
            <Button variant="accent" onClick={() => void submitAdd()} disabled={adding || !url.trim()}>
              {adding ? t('vpm.repos.adding') : t('vpm.repos.add')}
            </Button>
          </>
        }
      >
        <div className="space-y-3 text-[12px]">
          <Field label={t('vpm.repos.url')} hint={t('vpm.repos.urlHint')}>
            <input
              className="input font-mono"
              value={url}
              placeholder="https://example.com/repo.json"
              onChange={(event) => {
                setUrl(event.target.value)
                setAddError(null)
              }}
            />
          </Field>
          <Field label={t('vpm.repos.name')}>
            <input
              className="input"
              value={name}
              placeholder={t('vpm.repos.namePlaceholder')}
              onChange={(event) => setName(event.target.value)}
            />
          </Field>
          {addError ? (
            <div className="rounded border px-2 py-1.5 text-[11px]" style={{ borderColor: 'var(--bad)', color: 'var(--bad)' }}>
              {addError}
            </div>
          ) : null}
        </div>
      </Modal>

      <Modal
        open={!!removeTarget}
        onOpenChange={(open) => {
          if (!removing && !open) setRemoveTarget(null)
        }}
        title={t('vpm.repos.removeTitle')}
        footer={
          <>
            <Button onClick={() => setRemoveTarget(null)} disabled={removing}>
              {t('common.cancel')}
            </Button>
            <Button onClick={() => void submitRemove()} disabled={removing}>
              {t('vpm.repos.remove')}
            </Button>
          </>
        }
      >
        <div className="text-[12px] leading-relaxed" style={{ color: 'var(--muted)' }}>
          <div>{t('vpm.repos.removeBody')}</div>
          {removeTarget ? <div className="mt-2 font-mono text-[11px]">{removeTarget.name}</div> : null}
          {removeError ? (
            <div className="mt-2 rounded border px-2 py-1.5 text-[11px]" style={{ borderColor: 'var(--bad)', color: 'var(--bad)' }}>
              {removeError}
            </div>
          ) : null}
        </div>
      </Modal>
    </div>
  )
}
