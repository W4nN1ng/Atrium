import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ChangePlanRequest } from '../../../../shared/vpm/domain/plan'
import type { VpmPlanDto } from '../../../../shared/vpm/dto'
import { Button, Modal } from '../../../components/ui'
import { useVpmPlan } from '../../hooks/useVpmPlan'
import { PlanBody } from '../plan/VpmPlanSheet'

/**
 * 变更单 + 应用。
 *
 * 计划内容永远由主进程按 `requests` 重新解析；这里不拼计划、不改计划。
 */
export function VpmApplyPlanSheet({
  open,
  onOpenChange,
  projectKey,
  requests,
  preset,
  acknowledged,
  onAcknowledge,
  onApply
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  projectKey: string
  requests: ChangePlanRequest[]
  preset?: 'upgradeAll'
  acknowledged: boolean
  onAcknowledge: (value: boolean) => void
  onApply: (planId: string) => void
}): JSX.Element {
  const { t } = useTranslation()
  const state = useVpmPlan()
  const [confirming, setConfirming] = useState(false)

  useEffect(() => {
    if (!open) {
      state.reset()
      setConfirming(false)
      return
    }
    void state.resolve({
      projectKey,
      ...(preset ? { preset } : {}),
      ...(requests.length ? { requests } : {})
    })
    // 只在打开时解析一次；用户改变更单会重新打开。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, projectKey])

  const plan: VpmPlanDto | null = state.plan
  const canApply = !!plan && !plan.blocked && !state.loading && acknowledged

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={t('vpm.plan.title')}
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>{t('vpm.plan.close')}</Button>
          <Button
            variant="accent"
            disabled={!canApply}
            title={!acknowledged ? t('vpm.packages.apply.ackFirst') : undefined}
            onClick={() => {
              if (!plan) return
              if (!confirming) {
                setConfirming(true)
                return
              }
              onApply(plan.planId)
              onOpenChange(false)
            }}
          >
            {confirming ? t('vpm.packages.apply.confirm') : t('vpm.plan.apply')}
          </Button>
        </>
      }
    >
      <div className="space-y-3 text-[12px]">
        <p className="faint text-[11px] leading-relaxed">{t('vpm.packages.planHint')}</p>

        <label className="flex items-start gap-2 rounded border px-3 py-2 text-[11px]" style={{ borderColor: 'var(--warn)' }}>
          <input
            type="checkbox"
            className="mt-0.5"
            checked={acknowledged}
            onChange={(event) => onAcknowledge(event.target.checked)}
          />
          <span style={{ color: 'var(--warn)' }}>{t('vpm.packages.apply.risk')}</span>
        </label>

        {state.loading ? <p className="faint">{t('vpm.plan.loading')}</p> : null}
        {state.error ? (
          <div className="rounded border px-3 py-2 text-[11px]" style={{ borderColor: 'var(--bad)', color: 'var(--bad)' }}>
            {state.error}
          </div>
        ) : null}
        {plan ? <PlanBody plan={plan} /> : null}
        {plan && plan.changes.length === 0 ? (
          <p className="faint text-[11px]">{t('vpm.packages.apply.noChanges')}</p>
        ) : null}
      </div>
    </Modal>
  )
}
