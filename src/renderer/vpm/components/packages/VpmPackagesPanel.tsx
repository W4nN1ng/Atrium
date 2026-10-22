import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type {
  VpmPackageCatalogInfoDto,
  VpmProjectCatalogDto,
  VpmProjectDetailDto,
  VpmProjectPackageDto
} from '../../../../shared/vpm/dto'
import { Badge, Button, Modal } from '../../../components/ui'
import { errorText } from '../../../lib/msg'
import { cleanText, formatTimestamp, vpmCodeLabel } from '../../lib/view'
import {
  countUpdates,
  filterRows,
  removeEntry,
  rowModel,
  sanitizeCart,
  setVersionEntry,
  toRequests,
  toggleEntry,
  type CartEntry,
  type PackageFilter,
  type PackageRowModel
} from '../../lib/cart'
import { useVpmOperations } from '../../hooks/useVpmOperations'
import { vpmApi } from '../../api'
import { VpmApplyPlanSheet } from './VpmApplyPlanSheet'
import { VpmOperationDialog } from './VpmOperationDialog'

function stateTone(state: string): 'default' | 'accent' | 'ok' | 'warn' | 'bad' {
  if (state === 'installed') return 'ok'
  if (state === 'missing') return 'bad'
  if (state === 'mismatch') return 'warn'
  if (state === 'protected') return 'accent'
  return 'default'
}

function Row({
  row,
  selected,
  onToggle,
  onVersion,
  onRemove,
  onReinstall,
  disabled
}: {
  row: PackageRowModel
  selected: CartEntry | undefined
  onToggle: () => void
  onVersion: (version: string) => void
  onRemove: () => void
  onReinstall: () => void
  disabled: boolean
}): JSX.Element {
  const { t } = useTranslation()
  const options = useMemo(() => {
    const versions = new Set<string>()
    if (row.installedVersion) versions.add(row.installedVersion)
    for (const version of row.versions) versions.add(version.version)
    return [...versions]
  }, [row.installedVersion, row.versions])

  return (
    <div
      className="flex flex-wrap items-center gap-2 border-b px-3 py-2 last:border-b-0"
      style={{ borderColor: 'var(--line)' }}
      data-vpm-package={row.name}
    >
      {row.protected ? (
        <span className="w-4 shrink-0" />
      ) : (
        <input
          type="checkbox"
          aria-label={row.name}
          checked={!!selected}
          disabled={disabled}
          onChange={onToggle}
        />
      )}
      <div className="min-w-[180px] flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="break-all font-mono text-[11px]">{cleanText(row.name, 214)}</span>
          {row.protected ? <Badge tone="accent">{t('vpm.packages.system')}</Badge> : null}
          {row.updateAvailable ? <Badge tone="ok">{t('vpm.packages.updateAvailable')}</Badge> : null}
          {row.hasConflict ? <Badge tone="warn">{t('vpm.packages.conflict')}</Badge> : null}
        </div>
        <div className="faint mt-0.5 text-[10px]">
          {row.protected ? t('vpm.packages.systemHint') : cleanText(row.source, 40)}
        </div>
      </div>

      {row.protected ? (
        <span className="faint font-mono text-[11px]">{row.installedVersion ?? '—'}</span>
      ) : (
        <select
          className="input h-7 w-[130px] font-mono text-[11px]"
          value={selected?.version ?? row.installedVersion ?? ''}
          disabled={disabled || options.length === 0}
          onChange={(event) => onVersion(event.target.value)}
          aria-label={`${row.name} version`}
        >
          {options.length === 0 ? <option value="">—</option> : null}
          {options.map((version) => (
            <option key={version} value={version}>
              {version}
              {version === row.installedVersion ? ` ${t('vpm.packages.current')}` : ''}
            </option>
          ))}
        </select>
      )}

      <span className="faint w-[90px] shrink-0 font-mono text-[11px]">
        {row.latestVersion ?? '—'}
      </span>

      <Badge tone={stateTone(row.state)}>{t(`vpm.projects.state.${row.state}`)}</Badge>

      {row.protected ? null : (
        <div className="flex shrink-0 items-center gap-1">
          <Button variant="ghost" disabled={disabled} onClick={onReinstall}>
            {t('vpm.packages.reinstall')}
          </Button>
          <button
            type="button"
            className="btn"
            style={{ color: 'var(--bad)' }}
            disabled={disabled}
            title={t('vpm.packages.remove')}
            onClick={onRemove}
          >
            −
          </button>
        </div>
      )}
    </div>
  )
}

/**
 * 工程详情里的包管理面板。
 *
 * 所有写操作都走"变更单 → 计划 → 事务"，界面不直接改工程。
 */
export function VpmPackagesPanel({
  projectKey,
  detail,
  onChanged
}: {
  projectKey: string
  detail: VpmProjectDetailDto
  onChanged: () => void
}): JSX.Element {
  const { t } = useTranslation()
  const ops = useVpmOperations(projectKey)
  const [catalog, setCatalog] = useState<VpmProjectCatalogDto | null>(null)
  const [catalogError, setCatalogError] = useState<string | null>(null)
  const [text, setText] = useState('')
  const [only, setOnly] = useState<PackageFilter['only']>('all')
  const [cart, setCart] = useState<Map<string, CartEntry>>(new Map())
  const [sheet, setSheet] = useState<'cart' | 'all' | null>(null)
  const [acknowledged, setAcknowledged] = useState(false)
  const [removeTarget, setRemoveTarget] = useState<PackageRowModel | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setCatalogError(null)
    vpmApi
      .projectCatalog(projectKey)
      .then((value) => {
        if (!cancelled) setCatalog(value)
      })
      .catch((cause) => {
        if (!cancelled) setCatalogError(errorText(cause))
      })
    return () => {
      cancelled = true
    }
  }, [projectKey, detail.lastScanAt])

  const catalogByName = useMemo(() => {
    const map = new Map<string, VpmPackageCatalogInfoDto>()
    for (const item of catalog?.packages ?? []) map.set(item.name, item)
    return map
  }, [catalog])

  const rows = useMemo(
    () => detail.packages.map((pkg: VpmProjectPackageDto) => rowModel(pkg, catalogByName.get(pkg.name))),
    [detail.packages, catalogByName]
  )
  const visible = useMemo(() => filterRows(rows, { text, only }), [rows, text, only])
  const updates = countUpdates(rows)
  const safeCart = useMemo(() => sanitizeCart(cart, rows), [cart, rows])
  const cartSize = safeCart.size
  const locked = detail.running || ops.run?.running === true

  // 操作结束后刷新工程快照，并清掉已提交的变更单。
  useEffect(() => {
    if (!ops.run?.result) return
    if (ops.run.result.status === 'committed') setCart(new Map())
    onChanged()
    // 只在结果对象变化时触发
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ops.run?.result])

  const toggle = useCallback(
    (row: PackageRowModel) => setCart((current) => toggleEntry(current, row)),
    []
  )
  const chooseVersion = useCallback((row: PackageRowModel, version: string) => {
    setActionError(null)
    setCart((current) => setVersionEntry(current, row, version))
  }, [])
  const reinstall = useCallback((row: PackageRowModel) => {
    if (!row.installedVersion) return
    setCart((current) =>
      new Map(current).set(row.name, {
        name: row.name,
        action: 'reinstall',
        version: row.installedVersion
      })
    )
  }, [])

  const confirmRemove = useCallback(() => {
    if (!removeTarget) return
    setCart((current) => removeEntry(current, removeTarget))
    setRemoveTarget(null)
  }, [removeTarget])

  const openCart = useCallback(() => {
    if (cartSize === 0) return
    setActionError(null)
    setSheet('cart')
  }, [cartSize])

  const applyPlan = useCallback(
    (planId: string) => {
      void ops.apply(planId)
    },
    [ops]
  )

  const undo = useCallback(() => {
    const latest = ops.history.find((item) => item.canUndo)
    if (latest) void ops.undo(latest.operationId)
  }, [ops])

  return (
    <section className="space-y-2" data-vpm-packages>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[12px] font-medium">{t('vpm.packages.title')}</span>
        <Badge>{t('vpm.packages.installedCount', { count: rows.filter((row) => row.installedVersion).length })}</Badge>
        <Badge tone={updates > 0 ? 'ok' : 'default'}>
          {t('vpm.packages.updatesCount', { count: updates })}
        </Badge>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Button
            variant="accent"
            disabled={locked}
            title={locked ? t('vpm.packages.lockedHint') : undefined}
            onClick={() => {
              setActionError(null)
              setSheet('all')
            }}
          >
            {t('vpm.packages.upgradeAll')}
          </Button>
        </div>
      </div>

      {detail.running ? (
        <div className="rounded border px-3 py-2 text-[11px]" style={{ borderColor: 'var(--warn)', color: 'var(--warn)' }}>
          {t('vpm.packages.unityRunning')}
        </div>
      ) : null}
      {catalogError ? (
        <div className="rounded border px-3 py-2 text-[11px]" style={{ borderColor: 'var(--warn)', color: 'var(--warn)' }}>
          {catalogError}
        </div>
      ) : null}
      {actionError ? (
        <div className="rounded border px-3 py-2 text-[11px]" style={{ borderColor: 'var(--bad)', color: 'var(--bad)' }}>
          {actionError}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <input
          className="input min-w-[200px] flex-1"
          value={text}
          placeholder={t('vpm.packages.search')}
          onChange={(event) => setText(event.target.value)}
        />
        <select
          className="input h-8 w-[130px] text-[11px]"
          value={only}
          onChange={(event) => setOnly(event.target.value as PackageFilter['only'])}
          aria-label={t('vpm.packages.filter.label')}
        >
          <option value="all">{t('vpm.packages.filter.all')}</option>
          <option value="installed">{t('vpm.packages.filter.installed')}</option>
          <option value="updates">{t('vpm.packages.filter.updates')}</option>
          <option value="conflicts">{t('vpm.packages.filter.conflicts')}</option>
        </select>
      </div>

      <div className="rounded border" style={{ borderColor: 'var(--line)' }}>
        <div
          className="faint flex items-center gap-2 border-b px-3 py-1.5 text-[10px]"
          style={{ borderColor: 'var(--line)' }}
        >
          <span className="w-4 shrink-0" />
          <span className="min-w-[180px] flex-1">{t('vpm.packages.col.name')}</span>
          <span className="w-[130px] shrink-0">{t('vpm.packages.col.version')}</span>
          <span className="w-[90px] shrink-0">{t('vpm.packages.col.latest')}</span>
          <span>{t('vpm.packages.col.status')}</span>
        </div>
        {visible.length ? (
          visible.map((row) => (
            <Row
              key={row.name}
              row={row}
              selected={safeCart.get(row.name)}
              disabled={locked}
              onToggle={() => toggle(row)}
              onVersion={(version) => chooseVersion(row, version)}
              onRemove={() => {
                setActionError(null)
                setRemoveTarget(row)
              }}
              onReinstall={() => reinstall(row)}
            />
          ))
        ) : (
          <p className="faint px-3 py-3 text-[11px]">{t('vpm.packages.empty')}</p>
        )}
      </div>

      {cartSize > 0 ? (
        <div
          className="sticky bottom-0 flex flex-wrap items-center gap-2 rounded border px-3 py-2"
          style={{ borderColor: 'var(--accent)', background: 'var(--panel)' }}
          data-vpm-change-bar
        >
          <span className="text-[11px]">
            {t('vpm.packages.cart.summary', { count: cartSize })}
          </span>
          <span className="faint text-[10px]">
            {[...safeCart.values()]
              .slice(0, 4)
              .map((entry) => `${entry.name} ${entry.action}`)
              .join(' · ')}
          </span>
          <div className="ml-auto flex items-center gap-2">
            <Button variant="ghost" onClick={() => setCart(new Map())}>
              {t('vpm.packages.cart.clear')}
            </Button>
            <Button variant="accent" onClick={openCart} disabled={locked}>
              {t('vpm.packages.cart.view')}
            </Button>
          </div>
        </div>
      ) : null}

      <section className="pt-1">
        <div className="mb-1 flex items-center gap-2">
          <span className="text-[12px] font-medium">{t('vpm.packages.history.title')}</span>
          {ops.historyLoading ? <span className="faint text-[10px]">{t('vpm.packages.history.loading')}</span> : null}
          <Button variant="ghost" className="ml-auto" onClick={() => void ops.reloadHistory()}>
            {t('vpm.packages.history.refresh')}
          </Button>
        </div>
        {ops.historyError ? (
          <div className="rounded border px-3 py-2 text-[11px]" style={{ borderColor: 'var(--bad)', color: 'var(--bad)' }}>
            {ops.historyError}
          </div>
        ) : null}
        {ops.history.length ? (
          <div className="rounded border" style={{ borderColor: 'var(--line)' }}>
            {ops.history.slice(0, 8).map((item) => (
              <div
                key={item.operationId}
                className="flex flex-wrap items-center gap-2 border-b px-3 py-1.5 last:border-b-0"
                style={{ borderColor: 'var(--line)' }}
              >
                <Badge tone={item.status === 'committed' ? 'ok' : item.status === 'needs_attention' ? 'warn' : 'default'}>
                  {t(`vpm.packages.run.status.${item.status}`)}
                </Badge>
                <span className="faint text-[10px]">{t(`vpm.packages.kind.${item.kind}`)}</span>
                <span className="faint text-[10px]">{formatTimestamp(item.createdAt)}</span>
                <span className="faint text-[10px]">
                  {t('vpm.packages.history.changes', { count: item.changeCount })}
                </span>
                {item.errorCode ? <span className="faint text-[10px]">{vpmCodeLabel(item.errorCode)}</span> : null}
                <div className="ml-auto">
                  {item.canUndo ? (
                    <Button variant="ghost" disabled={ops.run?.running === true} onClick={() => void ops.undo(item.operationId)}>
                      {t('vpm.packages.history.undo')}
                    </Button>
                  ) : item.status === 'committed' ? (
                    <span className="faint text-[10px]">
                      {t(`vpm.packages.undoBlocked.${item.undoBlockedReason ?? 'unsupported'}`)}
                    </span>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="faint text-[11px]">{t('vpm.packages.history.empty')}</p>
        )}
      </section>

      <Modal
        open={removeTarget !== null}
        onOpenChange={(open) => {
          if (!open) setRemoveTarget(null)
        }}
        title={t('vpm.packages.removeTitle')}
        footer={
          <>
            <Button onClick={() => setRemoveTarget(null)}>{t('common.cancel')}</Button>
            <Button onClick={confirmRemove}>{t('vpm.packages.remove')}</Button>
          </>
        }
      >
        <div className="space-y-2 text-[12px] leading-relaxed" style={{ color: 'var(--muted)' }}>
          <p>{t('vpm.packages.removeBody')}</p>
          {removeTarget ? (
            <p className="break-all font-mono text-[11px]">{cleanText(removeTarget.name, 214)}</p>
          ) : null}
        </div>
      </Modal>

      <VpmApplyPlanSheet
        open={sheet !== null}
        onOpenChange={(open) => {
          if (!open) setSheet(null)
        }}
        projectKey={projectKey}
        requests={sheet === 'cart' ? toRequests(safeCart) : []}
        preset={sheet === 'all' ? 'upgradeAll' : undefined}
        acknowledged={acknowledged}
        onAcknowledge={setAcknowledged}
        onApply={applyPlan}
      />

      <VpmOperationDialog
        run={ops.run}
        canUndo={ops.history.some((item) => item.canUndo)}
        onClose={ops.dismiss}
        onCancel={ops.cancel}
        onUndo={undo}
      />
    </section>
  )
}
