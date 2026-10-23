import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Badge, Button, Modal } from '../../../components/ui'
import { cleanText, vpmCodeLabel } from '../../lib/view'
import type { OperationRun } from '../../hooks/useVpmOperations'

function statusTone(status: string): 'ok' | 'bad' | 'warn' | 'default' {
  if (status === 'committed') return 'ok'
  if (status === 'failed' || status === 'rolled_back') return 'bad'
  if (status === 'needs_attention') return 'warn'
  return 'default'
}

/**
 * 操作进度 / 结果 / 撤销。
 *
 * - 运行中显示步骤与"取消"（提交点之后取消会返回 tooLate）；
 * - 成功显示摘要 + 撤销（受"最后一次且工程未变"限制）；
 * - 失败显示错误码、是否已回滚、旧资源清理警告。
 */
export function VpmOperationDialog({
  run,
  canUndo,
  onClose,
  onCancel,
  onUndo
}: {
  run: OperationRun | null
  canUndo: boolean
  onClose: () => void
  onCancel: () => Promise<boolean>
  onUndo: () => void
}): JSX.Element {
  const { t } = useTranslation()
  const [cancelling, setCancelling] = useState(false)
  const [cancelNote, setCancelNote] = useState<string | null>(null)

  const result = run?.result ?? null
  const running = run?.running === true

  return (
    <Modal
      open={run !== null}
      onOpenChange={(open) => {
        if (!open && !running) onClose()
      }}
      title={running ? t('vpm.packages.run.title') : t('vpm.packages.run.resultTitle')}
      footer={
        <>
          {running ? (
            <Button
              variant="ghost"
              disabled={cancelling || !run?.operationId}
              onClick={async () => {
                setCancelling(true)
                const ok = await onCancel()
                setCancelling(false)
                setCancelNote(ok ? null : t('vpm.errors.vpmCancelTooLate'))
              }}
            >
              {cancelling ? t('vpm.packages.run.cancelling') : t('vpm.packages.run.cancel')}
            </Button>
          ) : (
            <>
              {result?.status === 'committed' && canUndo ? (
                <Button variant="ghost" onClick={onUndo}>
                  {t('vpm.packages.run.undo')}
                </Button>
              ) : null}
              <Button onClick={onClose}>{t('vpm.packages.run.close')}</Button>
            </>
          )}
        </>
      }
    >
      <div className="space-y-3 text-[12px]">
        {running ? (
          <div className="space-y-2" data-vpm-operation-running role="status" aria-live="polite">
            <div className="flex items-center gap-2">
              <Badge tone="accent">{t('vpm.packages.run.running')}</Badge>
              {run?.progress ? (
                <span className="faint font-mono text-[11px]">
                  {t(`vpm.packages.step.${run.progress.step}`, {
                    defaultValue: run.progress.step
                  })}
                  {` · ${run.progress.index}/${run.progress.total}`}
                </span>
              ) : (
                <span className="faint text-[11px]">{t('vpm.packages.run.starting')}</span>
              )}
            </div>
            <p className="faint text-[11px] leading-relaxed">{t('vpm.packages.run.hint')}</p>
            {cancelNote ? (
              <p className="text-[11px]" style={{ color: 'var(--warn)' }} role="status">
                {cancelNote}
              </p>
            ) : null}
          </div>
        ) : null}

        {!running && run?.error ? (
          <div className="rounded border px-3 py-2 text-[11px]" role="alert" style={{ borderColor: 'var(--bad)', color: 'var(--bad)' }}>
            {run.error}
          </div>
        ) : null}

        {!running && result ? (
          <div className="space-y-2" data-vpm-operation-result>
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={statusTone(result.status)}>
                {t(`vpm.packages.run.status.${result.status}`)}
              </Badge>
              <span className="faint font-mono text-[10px]">{result.operationId}</span>
              <span className="faint text-[10px]">{`${(result.elapsedMs / 1000).toFixed(1)}s`}</span>
            </div>

            {result.errorCode ? (
              <div className="rounded border px-3 py-2 text-[11px]" role="alert" style={{ borderColor: 'var(--bad)', color: 'var(--bad)' }}>
                <div>{vpmCodeLabel(result.errorCode)}</div>
                {result.errorDetail ? (
                  <div className="faint mt-1 break-all font-mono text-[10px]">{cleanText(result.errorDetail, 600)}</div>
                ) : null}
              </div>
            ) : null}

            {result.installed.length || result.removed.length ? (
              <div className="grid grid-cols-[90px_1fr] gap-x-2 gap-y-1 text-[11px]">
                {result.installed.length ? (
                  <>
                    <span className="faint">{t('vpm.packages.run.installed')}</span>
                    <span className="break-all font-mono text-[10px]">
                      {result.installed.map((name) => cleanText(name, 214)).join(', ')}
                    </span>
                  </>
                ) : null}
                {result.removed.length ? (
                  <>
                    <span className="faint">{t('vpm.packages.run.removed')}</span>
                    <span className="break-all font-mono text-[10px]">
                      {result.removed.map((name) => cleanText(name, 214)).join(', ')}
                    </span>
                  </>
                ) : null}
              </div>
            ) : null}

            {result.status === 'rolled_back' ? (
              <p className="text-[11px]" style={{ color: 'var(--warn)' }}>
                {t('vpm.packages.run.rolledBack')}
              </p>
            ) : null}
            {result.status === 'needs_attention' ? (
              <p className="text-[11px]" style={{ color: 'var(--warn)' }}>
                {t('vpm.packages.run.needsAttention')}
              </p>
            ) : null}

            {result.warnings.length ? (
              <div className="space-y-1">
                {result.warnings.map((warning, index) => (
                  <div
                    key={`${warning.code}-${index}`}
                    className="rounded border px-3 py-1.5 text-[11px]"
                    style={{ borderColor: 'var(--line)' }}
                  >
                    <div>{vpmCodeLabel(warning.code)}</div>
                    {warning.detail ? (
                      <div className="faint mt-0.5 break-all font-mono text-[10px]">
                        {cleanText(warning.detail, 600)}
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : null}

            {result.vaultPending ? (
              <p className="faint text-[11px]">{t('vpm.packages.run.vaultPending')}</p>
            ) : null}
          </div>
        ) : null}
      </div>
    </Modal>
  )
}
