import { useTranslation } from 'react-i18next'
import { backfillRenderState } from '../../shared/backfillState'
import { useUi } from '../stores/ui'
import { Badge, Button, Modal } from './ui'

/**
 * M6 ④ · 「按库里出现过的模型补建集合」的预览面板。
 *
 * ⚠ 这个组件**刻意没有分支逻辑**：该画什么（loading / 空 / 清单、按钮可不可点、
 * 那句"跳过了 N 个通用值"要不要出现）全在 `shared/backfillState.ts` 里算好，
 * 这里只做 state → 节点的映射。理由是他点出来的那条：
 * 渲染层零 DOM 测试的根因不是缺 jsdom，而是逻辑漏进了 JSX ——
 * 逻辑抽干净之后，这个组件改坏了也只会是"样式不对"，不会是"该确认时没确认"。
 */
export function ModelBackfillDialog(): JSX.Element | null {
  const { t } = useTranslation()
  const b = useUi((s) => s.backfill)
  const close = useUi((s) => s.closeModelBackfill)
  const toggle = useUi((s) => s.toggleBackfillPick)
  const pickAll = useUi((s) => s.pickAllBackfill)
  const clearPicks = useUi((s) => s.clearBackfillPicks)
  const run = useUi((s) => s.runModelBackfill)

  if (!b.open) return null
  const view = backfillRenderState(b.plan, b.picked, b.loading)

  return (
    <Modal open onOpenChange={(v) => { if (!v) close() }} title={t(view.titleKey)}>
      <div className="flex flex-col gap-2 text-[12px]">
        {view.bodyKey ? (
          <div className="text-[11px]" style={{ color: 'var(--muted)' }}>
            {t(view.bodyKey, view.bodyParams ?? {})}
          </div>
        ) : null}
        {view.skippedNote ? (
          <div
            className="rounded border px-2 py-1 text-[11px]"
            style={{ borderColor: 'var(--line-2)', background: 'var(--warn-soft)', color: 'var(--warn)' }}
          >
            {t(view.skippedNote.key, view.skippedNote.params)}
          </div>
        ) : null}

        {view.phase === 'ready' ? (
          <>
            <div className="flex items-center gap-2 text-[11px]">
              <Button variant="accent" disabled={!view.confirmEnabled || b.busy} onClick={() => void run()}>
                {t('collections.backfillConfirm', view.confirmParams)}
              </Button>
              {view.showBulk ? (
                <>
                  <Button disabled={b.busy} onClick={pickAll}>
                    {t('common.selectAll')}
                  </Button>
                  <Button disabled={b.picked.length === 0 || b.busy} onClick={clearPicks}>
                    {t('common.clear')}
                  </Button>
                </>
              ) : null}
              <span className="ml-auto" style={{ color: 'var(--faint)' }}>
                {t('collections.backfillUndoHint')}
              </span>
            </div>

            <div className="max-h-[52vh] overflow-y-auto rounded border" style={{ borderColor: 'var(--line)' }}>
              {view.rows.map((r) => (
                <label
                  key={r.id}
                  className="flex cursor-pointer items-center gap-2 border-b px-2 py-1 text-[11px] last:border-b-0"
                  style={{ borderColor: 'var(--line)', background: r.picked ? 'var(--accent-soft)' : 'transparent' }}
                >
                  <input type="checkbox" checked={r.picked} onChange={() => toggle(r.id)} />
                  <span className="min-w-0 flex-1 truncate">{r.name}</span>
                  <span style={{ color: 'var(--muted)' }}>{t('collections.backfillHits', { count: r.count })}</span>
                  <Badge tone="default">{t('collections.backfillKeywords', { count: r.keywords.length })}</Badge>
                </label>
              ))}
            </div>
          </>
        ) : null}

        <div className="flex justify-end">
          <Button disabled={b.busy} onClick={close}>
            {t('common.cancel')}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
