import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { VpmPlanDto } from '../../../../shared/vpm/dto'
import type { ChangePlanChange } from '../../../../shared/vpm/domain/plan'
import { Badge, Button, Modal } from '../../../components/ui'
import { useVpmPlan } from '../../hooks/useVpmPlan'
import { cleanText } from '../../lib/view'

const ACTION_ORDER: ChangePlanChange['action'][] = [
  'install',
  'upgrade',
  'downgrade',
  'reinstall',
  'remove',
  'keep'
]

function shortHash(value: string): string {
  return value.length > 18 ? `${value.slice(0, 12)}…${value.slice(-4)}` : value
}

function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0'
  const units = ['B', 'KB', 'MB', 'GB']
  let size = value
  let index = 0
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024
    index++
  }
  return `${size.toFixed(index === 0 ? 0 : 1)} ${units[index]}`
}

function actionTone(action: ChangePlanChange['action']): 'default' | 'accent' | 'ok' | 'warn' | 'bad' {
  if (action === 'install') return 'accent'
  if (action === 'upgrade') return 'ok'
  if (action === 'downgrade') return 'warn'
  if (action === 'remove') return 'bad'
  if (action === 'reinstall') return 'warn'
  return 'default'
}

function sourceLabel(source: string, rootLabel: string): string {
  return source || rootLabel
}

function ChangeRow({ change }: { change: ChangePlanChange }): JSX.Element {
  const { t } = useTranslation()
  const requiredBy = change.requiredBy
    .map((item) => `${sourceLabel(item.source, t('vpm.plan.rootSource'))} · ${item.range}`)
    .join(' / ')
  return (
    <div className="border-b px-3 py-2 last:border-b-0" style={{ borderColor: 'var(--line)' }}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="min-w-[170px] flex-1 break-all font-mono text-[11px]">
          {cleanText(change.name, 214)}
        </span>
        <Badge tone={actionTone(change.action)}>{t(`vpm.plan.action.${change.action}`)}</Badge>
        {change.isMajor ? <Badge tone="warn">{t('vpm.plan.major')}</Badge> : null}
        {change.requested ? <Badge>{t('vpm.plan.requested')}</Badge> : null}
        {change.risk.map((risk) => <Badge key={risk} tone="warn">{t(`vpm.plan.risk.${risk}`)}</Badge>)}
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px]">
        <span className="faint">
          {change.from ?? '—'} → {change.to ?? '—'}
        </span>
        <span className="faint">{t(`vpm.plan.reason.${change.reason}`)}</span>
        {requiredBy ? <span className="faint break-all">{t('vpm.plan.requiredBy', { sources: requiredBy })}</span> : null}
      </div>
    </div>
  )
}

function PlanBody({ plan }: { plan: VpmPlanDto }): JSX.Element {
  const { t } = useTranslation()
  const groups = ACTION_ORDER
    .map((action) => ({ action, rows: plan.changes.filter((change) => change.action === action) }))
    .filter((group) => group.rows.length > 0)

  return (
    <div className="max-h-[64vh] space-y-3 overflow-y-auto pr-1 text-[12px]" data-vpm-plan>
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={plan.blocked ? 'bad' : 'ok'}>
          {plan.blocked ? t('vpm.plan.blocked') : t('vpm.plan.ready')}
        </Badge>
        <Badge>{t('vpm.plan.requiresUnityClosed')}</Badge>
        <span className="faint font-mono text-[10px]">{shortHash(plan.planHash)}</span>
      </div>

      {plan.blocked ? (
        <div className="rounded border px-3 py-2 text-[11px]" style={{ borderColor: 'var(--bad)', color: 'var(--bad)' }}>
          {t('vpm.plan.blockedHint')}
        </div>
      ) : null}

      {groups.length ? groups.map((group) => (
        <section key={group.action}>
          <div className="mb-1 flex items-center gap-2">
            <span className="text-[12px] font-medium">{t(`vpm.plan.action.${group.action}`)}</span>
            <Badge>{group.rows.length}</Badge>
          </div>
          <div className="rounded border" style={{ borderColor: 'var(--line)' }}>
            {group.rows.map((change) => <ChangeRow key={change.name} change={change} />)}
          </div>
        </section>
      )) : <p className="faint text-[11px]">{t('vpm.plan.empty')}</p>}

      {plan.conflicts.length ? (
        <section>
          <div className="mb-1 text-[12px] font-medium">{t('vpm.plan.conflicts')}</div>
          <div className="space-y-1.5">
            {plan.conflicts.map((conflict) => (
              <div key={`${conflict.name}-${conflict.reason}`} className="rounded border px-3 py-2 text-[11px]" style={{ borderColor: 'var(--bad)' }}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="break-all font-mono">{cleanText(conflict.name, 214)}</span>
                  <Badge tone="bad">{t(`vpm.plan.conflict.${conflict.reason}`)}</Badge>
                </div>
                <div className="faint mt-1 space-y-0.5">
                  {conflict.requirements.map((item) => (
                    <div key={`${item.source}-${item.range}`}>
                      {sourceLabel(item.source, t('vpm.plan.rootSource'))} · {item.range}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {plan.missing.length ? (
        <section>
          <div className="mb-1 text-[12px] font-medium">{t('vpm.plan.missing')}</div>
          <div className="space-y-1.5">
            {plan.missing.map((item) => (
              <div key={item.name} className="rounded border px-3 py-2 text-[11px]" style={{ borderColor: 'var(--warn)' }}>
                <div className="break-all font-mono">{cleanText(item.name, 214)}</div>
                <div className="faint mt-1">
                  {item.requirements.map((source) => `${sourceLabel(source.source, t('vpm.plan.rootSource'))} · ${source.range}`).join(' / ')}
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {plan.warnings.length ? (
        <section>
          <div className="mb-1 text-[12px] font-medium">{t('vpm.plan.warnings')}</div>
          <div className="space-y-1">
            {plan.warnings.map((warning, index) => (
              <div key={`${warning.code}-${warning.name ?? ''}-${index}`} className="text-[11px]" style={{ color: 'var(--warn)' }}>
                {t(`vpm.plan.warn.${warning.code}`)} {warning.name ? `· ${cleanText(warning.name, 214)}` : ''}
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <section>
        <div className="mb-1 text-[12px] font-medium">{t('vpm.plan.downloads')}</div>
        <div className="faint text-[11px]">
          {t('vpm.plan.diskLine', {
            download: formatBytes(plan.disk.downloadBytes),
            install: formatBytes(plan.disk.installBytes)
          })}
        </div>
        {plan.downloads.length ? (
          <div className="mt-1 rounded border" style={{ borderColor: 'var(--line)' }}>
            {plan.downloads.map((item) => (
              <div key={`${item.name}-${item.version}`} className="flex flex-wrap items-center gap-2 border-b px-3 py-1.5 last:border-b-0" style={{ borderColor: 'var(--line)' }}>
                <span className="min-w-[180px] flex-1 break-all font-mono text-[10px]">{cleanText(item.name, 214)}</span>
                <span className="faint text-[10px]">{item.version}</span>
                <span className="faint text-[10px]">{formatBytes(item.size ?? 0)}</span>
              </div>
            ))}
          </div>
        ) : null}
      </section>
    </div>
  )
}

export function VpmPlanSheet({
  open,
  onOpenChange,
  projectKey
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  projectKey: string
}): JSX.Element {
  const { t } = useTranslation()
  const state = useVpmPlan()
  const [packageName, setPackageName] = useState('')
  const [packageRange, setPackageRange] = useState('')
  const [allowPrerelease, setAllowPrerelease] = useState(false)

  useEffect(() => {
    if (!open) {
      state.reset()
      return
    }
    void state.resolve({
      projectKey,
      preset: 'upgradeAll',
      allowPrerelease
    })
    // 只在打开/工程变化时自动预览；输入框按钮可手动重跑。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, projectKey])

  const previewUpgradeAll = async (): Promise<void> => {
    await state.resolve({ projectKey, preset: 'upgradeAll', allowPrerelease })
  }

  const previewPackage = async (): Promise<void> => {
    const name = packageName.trim()
    if (!name) return
    await state.resolve({
      projectKey,
      requests: [{
        kind: 'install',
        name,
        ...(packageRange.trim() ? { range: packageRange.trim() } : {})
      }],
      allowPrerelease
    })
  }

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={t('vpm.plan.title')}
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>{t('vpm.plan.close')}</Button>
          <Button disabled title={t('vpm.plan.applyLater')}>
            {t('vpm.plan.apply')}
          </Button>
        </>
      }
    >
      <div className="space-y-3 text-[12px]">
        <p className="faint text-[11px] leading-relaxed">{t('vpm.plan.intro')}</p>

        <div className="flex flex-wrap items-end gap-2">
          <label className="flex min-w-[160px] flex-1 flex-col gap-1">
            <span className="faint text-[10px]">{t('vpm.plan.package')}</span>
            <input
              className="input font-mono"
              value={packageName}
              placeholder="com.example.package"
              onChange={(event) => setPackageName(event.target.value)}
            />
          </label>
          <label className="flex w-[150px] flex-col gap-1">
            <span className="faint text-[10px]">{t('vpm.plan.range')}</span>
            <input
              className="input font-mono"
              value={packageRange}
              placeholder="^1.0.0"
              onChange={(event) => setPackageRange(event.target.value)}
            />
          </label>
          <Button variant="ghost" onClick={() => void previewPackage()} disabled={state.loading || !packageName.trim()}>
            {t('vpm.plan.previewPackage')}
          </Button>
          <Button variant="accent" onClick={() => void previewUpgradeAll()} disabled={state.loading}>
            {t('vpm.plan.previewAll')}
          </Button>
        </div>

        <label className="flex items-center gap-2 text-[11px]">
          <input
            type="checkbox"
            checked={allowPrerelease}
            onChange={(event) => setAllowPrerelease(event.target.checked)}
          />
          {t('vpm.plan.allowPrerelease')}
        </label>

        {state.loading ? <p className="faint">{t('vpm.plan.loading')}</p> : null}
        {state.error ? (
          <div className="rounded border px-3 py-2 text-[11px]" style={{ borderColor: 'var(--bad)', color: 'var(--bad)' }}>
            {state.error}
          </div>
        ) : null}
        {state.plan ? <PlanBody plan={state.plan} /> : null}
      </div>
    </Modal>
  )
}
