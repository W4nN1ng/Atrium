import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { VpmNetworkStatus, VpmRepoDto } from '../../../shared/vpm/dto'
import { errorText } from '../../lib/msg'
import { Badge, Button, Field, Modal, Switch } from '../../components/ui'
import type { VpmOperationState } from '../hooks/useVpmRepos'
import { formatTimestamp, repoErrorLabel, repoHost } from '../lib/view'
import { vpmApi } from '../api'
import type { VpmRepoHeadersDto } from '../../../shared/vpm/dto'

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
  const [editTarget, setEditTarget] = useState<VpmRepoDto | null>(null)
  const [editName, setEditName] = useState('')
  const [editUrl, setEditUrl] = useState('')
  const [editBusy, setEditBusy] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)
  const [headersTarget, setHeadersTarget] = useState<VpmRepoDto | null>(null)
  const [headerState, setHeaderState] = useState<VpmRepoHeadersDto | null>(null)
  const [headerRows, setHeaderRows] = useState<Array<{ name: string; value: string }>>([])
  const [headerBusy, setHeaderBusy] = useState(false)
  const [headerError, setHeaderError] = useState<string | null>(null)
  const [importOpen, setImportOpen] = useState(false)
  const [importText, setImportText] = useState('')
  const [importBusy, setImportBusy] = useState(false)
  const [importResult, setImportResult] = useState<string | null>(null)
  const [exportText, setExportText] = useState<string | null>(null)
  const [actionNotice, setActionNotice] = useState<string | null>(null)
  const [removeTarget, setRemoveTarget] = useState<VpmRepoDto | null>(null)
  const [removing, setRemoving] = useState(false)
  const [removeError, setRemoveError] = useState<string | null>(null)

  const toggleEnabled = async (repo: VpmRepoDto, enabled: boolean): Promise<void> => {
    setActionNotice(null)
    try {
      await vpmApi.repoUpdate({ id: repo.id, enabled })
      await props.onReload()
    } catch (cause) {
      setActionNotice(errorText(cause))
    }
  }

  /** 上移/下移：只交换相邻两项，然后整表提交顺序。 */
  const move = async (id: string, delta: -1 | 1): Promise<void> => {
    const ids = props.repos.map((repo) => repo.id)
    const index = ids.indexOf(id)
    const target = index + delta
    if (index < 0 || target < 0 || target >= ids.length) return
    ;[ids[index], ids[target]] = [ids[target], ids[index]]
    setActionNotice(null)
    try {
      await vpmApi.repoReorder(ids)
      await props.onReload()
    } catch (cause) {
      setActionNotice(errorText(cause))
    }
  }

  const openEdit = (repo: VpmRepoDto): void => {
    setEditTarget(repo)
    setEditName(repo.name)
    setEditUrl(repo.url)
    setEditError(null)
  }

  const submitEdit = async (): Promise<void> => {
    if (!editTarget) return
    setEditBusy(true)
    setEditError(null)
    try {
      await vpmApi.repoUpdate({
        id: editTarget.id,
        name: editName.trim(),
        url: editUrl.trim()
      })
      setEditTarget(null)
      await props.onReload()
    } catch (cause) {
      setEditError(errorText(cause))
    } finally {
      setEditBusy(false)
    }
  }

  const openHeaders = async (repo: VpmRepoDto): Promise<void> => {
    setHeadersTarget(repo)
    setHeaderError(null)
    setHeaderRows([])
    setHeaderState(null)
    try {
      const state = await vpmApi.repoHeaders(repo.id)
      setHeaderState(state)
      // 值不回渲染层：只能覆盖或清除，不能"看到原值再改一个字母"。
      setHeaderRows(state.names.map((name: string) => ({ name, value: '' })))
    } catch (cause) {
      setHeaderError(errorText(cause))
    }
  }

  const saveHeaders = async (): Promise<void> => {
    if (!headersTarget) return
    setHeaderBusy(true)
    setHeaderError(null)
    try {
      const headers: Record<string, string> = {}
      for (const row of headerRows) {
        const name = row.name.trim()
        const value = row.value.trim()
        if (!name && !value) continue
        if (!name || !value) throw new Error(t('vpm.repos.headersIncomplete'))
        headers[name] = value
      }
      const state = await vpmApi.repoHeadersSet({ id: headersTarget.id, headers })
      setHeaderState(state)
      setHeadersTarget(null)
      setActionNotice(t('vpm.repos.headersSaved'))
    } catch (cause) {
      setHeaderError(errorText(cause))
    } finally {
      setHeaderBusy(false)
    }
  }

  const clearHeaders = async (): Promise<void> => {
    if (!headersTarget) return
    setHeaderBusy(true)
    setHeaderError(null)
    try {
      await vpmApi.repoHeadersClear(headersTarget.id)
      setHeadersTarget(null)
      setActionNotice(t('vpm.repos.headersCleared'))
    } catch (cause) {
      setHeaderError(errorText(cause))
    } finally {
      setHeaderBusy(false)
    }
  }

  const testRepo = async (repo: VpmRepoDto): Promise<void> => {
    setActionNotice(null)
    try {
      const result = await vpmApi.repoTest(repo.id)
      setActionNotice(
        result.ok
          ? t('vpm.repos.testOk', { status: result.status ?? 200 })
          : t('vpm.repos.testFailed', { error: repoErrorLabel(result.errorCode) ?? '—' })
      )
    } catch (cause) {
      setActionNotice(errorText(cause))
    }
  }

  const openImport = async (): Promise<void> => {
    setImportText('')
    setImportResult(null)
    setImportOpen(true)
  }

  const submitImport = async (): Promise<void> => {
    setImportBusy(true)
    setImportResult(null)
    try {
      const result = await vpmApi.repoImport(importText)
      setImportResult(
        t('vpm.repos.importDone', { added: result.added.length, skipped: result.skipped.length })
      )
      await props.onReload()
    } catch (cause) {
      setImportResult(errorText(cause))
    } finally {
      setImportBusy(false)
    }
  }

  const doExport = async (): Promise<void> => {
    try {
      setExportText(await vpmApi.repoExport())
    } catch (cause) {
      setActionNotice(errorText(cause))
    }
  }

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

      {actionNotice ? (
        <div
          className="flex items-center justify-between gap-3 rounded border px-3 py-2 text-[11px]"
          style={{ borderColor: 'var(--line-2)', color: 'var(--muted)' }}
        >
          <span>{actionNotice}</span>
          <Button variant="ghost" onClick={() => setActionNotice(null)}>
            {t('common.close')}
          </Button>
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
          <div className="flex items-center justify-end gap-2">
            <Button variant="ghost" onClick={() => void openImport()} disabled={props.busy}>
              {t('vpm.repos.import')}
            </Button>
            <Button variant="ghost" onClick={() => void doExport()} disabled={props.busy}>
              {t('vpm.repos.export')}
            </Button>
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
                      <span className="text-[14px] font-semibold">{repo.name}</span>
                      <Badge>{t('vpm.repos.packages', { count: repo.packageCount })}</Badge>
                    </div>
                    <div className="mt-1 break-all text-[12px]" style={{ color: 'var(--faint)' }}>
                      {repoHost(repo.url)}
                    </div>
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
                  <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
                    <Switch
                      checked={repo.enabled}
                      onChange={(value) => void toggleEnabled(repo, value)}
                    />
                    <Button
                      variant="ghost"
                      onClick={() => void move(repo.id, -1)}
                      disabled={props.busy || props.repos[0]?.id === repo.id}
                      title={t('vpm.repos.moveUp')}
                      aria-label={t('vpm.repos.moveUp')}
                      className="px-2 text-[14px] font-bold leading-none"
                    >
                      ▲
                    </Button>
                    <Button
                      variant="ghost"
                      onClick={() => void move(repo.id, 1)}
                      disabled={props.busy || props.repos[props.repos.length - 1]?.id === repo.id}
                      title={t('vpm.repos.moveDown')}
                      aria-label={t('vpm.repos.moveDown')}
                      className="px-2 text-[14px] font-bold leading-none"
                    >
                      ▼
                    </Button>
                    <Button
                      variant="ghost"
                      onClick={() => openEdit(repo)}
                      disabled={props.busy || !!props.operation}
                    >
                      {t('vpm.repos.edit')}
                    </Button>
                    <Button
                      variant="ghost"
                      onClick={() => void openHeaders(repo)}
                      disabled={props.busy || !!props.operation}
                    >
                      {t('vpm.repos.headers')}
                    </Button>
                    <Button
                      variant="ghost"
                      onClick={() => void testRepo(repo)}
                      disabled={props.busy || !!props.operation || !networkAllowed}
                    >
                      {t('vpm.repos.test')}
                    </Button>
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
            variant="ghost"
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

      <Modal
        open={!!editTarget}
        onOpenChange={(open) => {
          if (!editBusy && !open) setEditTarget(null)
        }}
        title={t('vpm.repos.editTitle')}
        footer={
          <>
            <Button onClick={() => setEditTarget(null)} disabled={editBusy}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="accent"
              onClick={() => void submitEdit()}
              disabled={editBusy || !editName.trim() || !editUrl.trim()}
            >
              {editBusy ? t('common.saving') : t('common.save')}
            </Button>
          </>
        }
      >
        <div className="space-y-3 text-[12px]">
          <Field label={t('vpm.repos.name')}>
            <input
              className="input"
              value={editName}
              onChange={(event) => setEditName(event.target.value)}
            />
          </Field>
          <Field label={t('vpm.repos.url')} hint={t('vpm.repos.urlHint')}>
            <input
              className="input font-mono"
              value={editUrl}
              onChange={(event) => setEditUrl(event.target.value)}
            />
          </Field>
          {editError ? (
            <div className="rounded border px-2 py-1.5 text-[11px]" style={{ borderColor: 'var(--bad)', color: 'var(--bad)' }}>
              {editError}
            </div>
          ) : null}
        </div>
      </Modal>

      <Modal
        open={!!headersTarget}
        onOpenChange={(open) => {
          if (!headerBusy && !open) setHeadersTarget(null)
        }}
        title={t('vpm.repos.headersTitle')}
        footer={
          <>
            <Button onClick={() => setHeadersTarget(null)} disabled={headerBusy}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="ghost"
              onClick={() => void clearHeaders()}
              disabled={headerBusy || !headerState?.names.length}
            >
              {t('vpm.repos.headersClear')}
            </Button>
            <Button variant="accent" onClick={() => void saveHeaders()} disabled={headerBusy}>
              {headerBusy ? t('common.saving') : t('common.save')}
            </Button>
          </>
        }
      >
        <div className="space-y-3 text-[12px]">
          <p className="faint text-[11px] leading-relaxed">{t('vpm.repos.headersHint')}</p>
          {headerState && !headerState.available ? (
            <div className="rounded border px-3 py-2 text-[11px]" style={{ borderColor: 'var(--warn)', color: 'var(--warn)' }}>
              {t('vpm.repos.headersUnavailable')}
            </div>
          ) : null}
          {headerState?.names.length ? (
            <p className="text-[11px]">
              {t('vpm.repos.headersPresent', { names: headerState.names.join(', ') })}
            </p>
          ) : null}
          {headerRows.map((row, index) => (
            <div key={index} className="flex gap-2">
              <input
                className="input w-[45%] font-mono"
                placeholder="Authorization"
                value={row.name}
                onChange={(event) =>
                  setHeaderRows((current) =>
                    current.map((item, at) =>
                      at === index ? { ...item, name: event.target.value } : item
                    )
                  )
                }
              />
              <input
                className="input flex-1 font-mono"
                type="password"
                placeholder="Bearer …"
                value={row.value}
                onChange={(event) =>
                  setHeaderRows((current) =>
                    current.map((item, at) =>
                      at === index ? { ...item, value: event.target.value } : item
                    )
                  )
                }
              />
              <Button
                variant="ghost"
                onClick={() => setHeaderRows((current) => current.filter((_, at) => at !== index))}
              >
                −
              </Button>
            </div>
          ))}
          <Button
            variant="ghost"
            onClick={() => setHeaderRows((current) => [...current, { name: '', value: '' }])}
          >
            {t('vpm.repos.headersAdd')}
          </Button>
          {headerError ? (
            <div className="rounded border px-2 py-1.5 text-[11px]" style={{ borderColor: 'var(--bad)', color: 'var(--bad)' }}>
              {headerError}
            </div>
          ) : null}
        </div>
      </Modal>

      <Modal
        open={importOpen}
        onOpenChange={(open) => {
          if (!importBusy) setImportOpen(open)
        }}
        title={t('vpm.repos.importTitle')}
        footer={
          <>
            <Button onClick={() => setImportOpen(false)} disabled={importBusy}>
              {t('common.close')}
            </Button>
            <Button
              variant="accent"
              onClick={() => void submitImport()}
              disabled={importBusy || !importText.trim()}
            >
              {importBusy ? t('vpm.repos.importing') : t('vpm.repos.import')}
            </Button>
          </>
        }
      >
        <div className="space-y-3 text-[12px]">
          <p className="faint text-[11px] leading-relaxed">{t('vpm.repos.importHint')}</p>
          <textarea
            className="input h-40 w-full font-mono text-[11px]"
            value={importText}
            placeholder={'https://example.com/index.json\n# 或者粘贴导出的 JSON'}
            onChange={(event) => setImportText(event.target.value)}
          />
          {importResult ? <p className="text-[11px]">{importResult}</p> : null}
        </div>
      </Modal>

      <Modal
        open={exportText !== null}
        onOpenChange={(open) => {
          if (!open) setExportText(null)
        }}
        title={t('vpm.repos.exportTitle')}
        footer={<Button onClick={() => setExportText(null)}>{t('common.close')}</Button>}
      >
        <div className="space-y-2 text-[12px]">
          <p className="faint text-[11px] leading-relaxed">{t('vpm.repos.exportHint')}</p>
          <textarea
            className="input h-40 w-full font-mono text-[11px]"
            readOnly
            value={exportText ?? ''}
          />
        </div>
      </Modal>
    </div>
  )
}
