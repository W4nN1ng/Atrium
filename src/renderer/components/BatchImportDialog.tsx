import { useTranslation } from 'react-i18next'
import { importQueueRenderState } from '../../shared/importQueue'
import { planSummary } from '../../shared/memberPick'
import { useUi } from '../stores/ui'
import { Badge, Button, Modal } from './ui'

/**
 * R4 ② · 多选卡批量的确认 / 结果面板。
 *
 * ## 为什么另开一个组件而不是复用 `MemberPicker`
 *
 * `MemberPicker` 的第一步是"列一张卡的成员、让用户勾"，这里没有那一步 ——
 * 用户在网格上已经框选好了卡，每张卡各取一个可直导的包。
 * 硬塞进同一个面板会让它的状态机多出一条"有时候没有勾选步"的分支，
 * 而那条分支下整个 `picked/packages/reasons` 都是空的，读的人得来回跳才看得懂。
 *
 * ## 为什么挂在 `App` 而不是网格上
 *
 * 和 `MemberPicker` 同一个理由：发起方（网格 / 详情面板 / 快捷键）一卸载，
 * 挂在它里面的确认框就没了，而导入还挂在那儿 —— 用户会觉得程序卡死。
 *
 * ## 这里刻意**没有**的东西
 *
 * 没有"要不要覆盖"的逐包开关：一次决定覆盖这一批全部（Q3 的裁定），
 * 和 M5-B 成员面板一致。两套不同的冲突决定方式并存，用户记不住哪个是哪个。
 */
export function BatchImportDialog(): JSX.Element | null {
  const { t } = useTranslation()
  const b = useUi((s) => s.batchImport)
  const queue = useUi((s) => s.importFlow.queue)
  const decide = useUi((s) => s.decideBatchPlan)
  const next = useUi((s) => s.nextBatch)
  const stop = useUi((s) => s.stopBatches)
  const close = useUi((s) => s.closeBatchImport)
  const rollback = useUi((s) => s.rollbackBatchOutcome)

  if (!b.open) return null

  const sum = b.plan ? planSummary(b.plan) : null
  /**
   * 标题里的包数：跑完之后 `plan` 已经清空，得改从结果里数。
   * （沙盒活体截图上写的是"批量导入 · 0 个包"—— 就是漏了这一眼。）
   */
  const packageCount = b.plan?.items.length ?? b.outcome?.results.length ?? 0
  /** 已经跑完的批数 = 总批数 - 剩下的。只给个"第几批"，不吹"进度 62%" */
  const batchNo = b.queue.length + 1
  const totalBatches = b.queue.length + (b.plan || b.outcome ? 1 : 0)

  return (
    <Modal
      open
      onOpenChange={(v) => {
        if (!v) close()
      }}
      title={t('library.batchTitle', { count: packageCount, batch: batchNo, batches: Math.max(totalBatches, 1) })}
      footer={
        <>
          {b.plan ? (
            <>
              <Button onClick={() => void decide('cancel')}>{t('common.cancel')}</Button>
              <Button onClick={() => void decide('continue')}>{t('library.conflictContinue')}</Button>
              <Button variant="accent" onClick={() => void decide('continue-with-backup')}>
                {t('library.conflictContinueBackup')}
              </Button>
            </>
          ) : b.outcome ? (
            <>
              <Button onClick={() => void rollback()}>{t('library.rollbackBatch')}</Button>
              {b.queue.length ? (
                <Button variant="accent" onClick={() => void next()}>
                  {t('library.memberNextBatch', { left: b.queue.length })}
                </Button>
              ) : (
                <Button variant="accent" onClick={close}>
                  {t('common.close')}
                </Button>
              )}
              {b.queue.length ? (
                <Button className="mr-auto" variant="ghost" onClick={stop}>
                  {t('library.memberStopBatches')}
                </Button>
              ) : null}
            </>
          ) : (
            <Button onClick={close}>{t('common.close')}</Button>
          )}
        </>
      }
    >
      <div className="flex flex-col gap-3 text-[12px]">
        {b.reasonKey ? (
          <div className="rounded border px-2 py-1.5" style={{ borderColor: 'var(--bad)', color: 'var(--bad)' }}>
            {t(b.reasonKey, b.reasonParams ?? {})}
          </div>
        ) : null}

        {/* 抽好了还没按确认，或者正在跑：这批的账要先说清 */}
        {sum ? (
          <>
            <div style={{ color: 'var(--muted)' }}>
              {t('library.memberPlanSummary', {
                packages: sum.packages,
                fresh: sum.fresh,
                withConflicts: sum.withConflicts,
                entries: sum.conflictEntries
              })}
            </div>
            <div
              className="max-h-[200px] overflow-y-auto rounded border px-2 py-1 font-mono text-[11px]"
              style={{ borderColor: 'var(--line-2)', background: 'var(--panel-2)' }}
            >
              {(b.plan?.items ?? []).map((it) => (
                <div key={it.relPath} className="flex items-center gap-2 border-b py-0.5 last:border-b-0" style={{ borderColor: 'var(--line)' }}>
                  <span className="min-w-0 flex-1 truncate" title={it.relPath}>
                    {it.relPath}
                  </span>
                  {it.conflictCount > 0 ? (
                    <Badge tone="warn">{t('library.memberConflicts', { count: it.conflictCount })}</Badge>
                  ) : (
                    <span style={{ color: 'var(--faint)' }}>{t('library.memberAllFresh', { count: it.fresh })}</span>
                  )}
                </div>
              ))}
            </div>
            <div style={{ color: 'var(--muted)' }}>{t('library.memberOneDecision', { count: sum.packages })}</div>
            {b.plan && b.plan.blocked.length ? (
              <div style={{ color: 'var(--warn)' }}>{t('library.memberBlocked', { count: b.plan.blocked.length })}</div>
            ) : null}
          </>
        ) : null}

        {/* 跑完了：逐条结果 + 整批退回的口径 */}
        {b.outcome ? (
          <>
            <div style={{ color: 'var(--muted)' }}>
              {t('library.memberOutcome', { ok: b.outcome.imported, bad: b.outcome.failed, skip: b.outcome.notRun })}
            </div>
            <div className="flex flex-col gap-0.5">
              {importQueueRenderState(queue).rows.map((r) => (
                <div key={r.key} className="flex items-center gap-2 text-[11px]">
                  <span
                    style={{
                      color: r.tone === 'ok' ? 'var(--ok)' : r.tone === 'bad' ? 'var(--bad)' : r.tone === 'warn' ? 'var(--warn)' : 'var(--muted)'
                    }}
                  >
                    {t(r.statusKey, r.statusParams ?? {})}
                  </span>
                  <span className="min-w-0 flex-1 truncate" title={r.label} style={{ color: 'var(--muted)' }}>
                    {r.label}
                  </span>
                  {r.noteKey ? <span style={{ color: 'var(--faint)' }}>{t(r.noteKey, r.noteParams ?? {})}</span> : null}
                </div>
              ))}
            </div>
            <div style={{ color: 'var(--faint)' }}>{t('library.memberUndoHint')}</div>
          </>
        ) : null}

        {/* 跳过了几张卡必须写在脸上：勾 5 张导 3 张还一声不吭 = 替用户做了决定 */}
        {b.skipped > 0 ? (
          <div style={{ color: 'var(--warn)' }}>{t('library.batchSkipped', { count: b.skipped })}</div>
        ) : null}
      </div>
    </Modal>
  )
}
