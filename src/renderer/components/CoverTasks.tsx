import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { AssetFilter } from '../../shared/types'
import type { CoverTask } from '../../shared/coverTasks'
import { useCoverTasks, type CoverTaskError } from '../stores/coverTasks'
import { Button, Modal } from './ui'

const stateKeys = { queued: 'coverTasks.states.queued', running: 'coverTasks.states.running', done: 'coverTasks.states.done',
  review: 'coverTasks.states.review', failed: 'coverTasks.states.failed', skipped: 'coverTasks.states.skipped',
  cancelled: 'coverTasks.states.cancelled', restored: 'coverTasks.states.restored' }

function Summary({ task }: { task: CoverTask }): JSX.Element {
  const { t } = useTranslation()
  const count = (state: string) => task.items.filter(item => item.state === state).length
  return <span data-cover-task-summary className="flex flex-wrap gap-x-4 gap-y-1" role="status">
    <span>{t('coverTasks.done', { count: count('done') })}</span>
    <span style={{ color: count('review') ? 'var(--warn)' : undefined }}>{t('coverTasks.review', { count: count('review') })}</span>
    <span style={{ color: count('failed') ? 'var(--bad)' : undefined }}>{t('coverTasks.failed', { count: count('failed') })}</span>
    <span>{t('coverTasks.skipped', { count: count('skipped') })}</span>
  </span>
}

function Failure({ error }: { error: CoverTaskError }): JSX.Element {
  const { t, i18n } = useTranslation()
  return <div role="alert" style={{ color: 'var(--bad)' }}>
    <p>{t(i18n.exists(error.key) ? error.key : 'coverTasks.requestFailed')}</p>
    {error.detail ? <details className="mt-1"><summary>{t('coverTasks.errorDetails')}</summary><pre className="whitespace-pre-wrap break-words text-[11px]">{error.detail}</pre></details> : null}
  </div>
}

/** The primary action starts immediately; alternative scopes capture their query at click time. */
export function CoverTaskButton({ assetIds, filter }: { assetIds: string[]; filter: AssetFilter }): JSX.Element {
  const { t } = useTranslation()
  const [menu, setMenu] = useState(false)
  const start = useCoverTasks(s => s.start)
  const disabled = useCoverTasks(s => s.starting || !!s.task?.running || s.applying || s.choicesLoading || !!s.mutation)
  return <div className="relative flex items-center gap-1">
    <button data-cover-task-start type="button" className="btn px-2 py-0.5" disabled={disabled} onClick={() => { setMenu(false); void start({ scope: 'all' }) }}>
      {t('coverTasks.updateAll')}
    </button>
    <button data-cover-task-scopes type="button" className="btn px-1.5 py-0.5" disabled={disabled}
      aria-label={t('coverTasks.scopes')} aria-expanded={menu} aria-haspopup="menu" onClick={() => setMenu(!menu)}>▾</button>
    {menu && !disabled ? <>
      <div className="fixed inset-0 z-20" onClick={() => setMenu(false)} />
      <div role="menu" className="absolute right-0 top-full z-30 mt-1 min-w-[180px] rounded border p-1 shadow-panel" style={{ background: 'var(--panel)', borderColor: 'var(--line-2)' }}>
        <button data-cover-task-scope-filtered role="menuitem" type="button" className="btn btn-ghost w-full text-left" onClick={() => { setMenu(false); void start({ scope: 'filtered', filter: { ...filter } }) }}>{t('coverTasks.updateFiltered')}</button>
        <button data-cover-task-scope-selected role="menuitem" type="button" className="btn btn-ghost w-full text-left" disabled={!assetIds.length} onClick={() => { setMenu(false); void start({ scope: 'ids', assetIds: [...assetIds] }) }}>{t('coverTasks.updateSelected', { count: assetIds.length })}</button>
      </div>
    </> : null}
  </div>
}

/** App owns this panel. Hiding/unmounting the UI never cancels main-process work. */
export function CoverTasks(): JSX.Element | null {
  const { t, i18n } = useTranslation()
  const s = useCoverTasks()
  const [itemLimit, setItemLimit] = useState(100)
  useEffect(() => { setItemLimit(100) }, [s.task?.id])
  useEffect(() => { void useCoverTasks.getState().refresh() }, [])
  useEffect(() => {
    if (!s.task?.running) return
    const timer = setInterval(() => { void useCoverTasks.getState().refresh() }, 500)
    return () => clearInterval(timer)
  }, [s.task?.id, s.task?.running])

  if (!s.task && !s.starting && !s.error && !s.open) return null
  const task = s.task
  const busy = s.starting || s.applying || s.choicesLoading || !!s.mutation || !!task?.running
  const canStop = !!task && !task.cancelled && (task.running || s.applying || s.choicesLoading)
  const stopDisabled = s.starting || !!s.mutation
  const review = task?.items.find(item => item.assetId === s.reviewAssetId && item.state === 'review')
  const current = task?.items.find(item => item.state === 'running')
  const finished = task?.items.filter(item => !['queued', 'running'].includes(item.state)).length ?? 0
  const failed = task?.items.some(item => item.state === 'failed')
  const reviewItems = task?.items.filter(item => item.state === 'review') ?? []
  const visibleReview = reviewItems.slice(0, 20)
  if (review && !visibleReview.includes(review)) visibleReview.splice(19, 1, review)

  return <>
    <div data-cover-task-banner className="flex shrink-0 flex-wrap items-center gap-3 border-b px-3 py-2 text-[12px]" style={{ background: 'var(--panel-2)', borderColor: 'var(--line)' }}>
      <span className="font-medium">{t(task?.running || s.starting ? 'coverTasks.running' : 'coverTasks.results')}</span>
      {task ? <Summary task={task} /> : null}
      {s.error && !s.open ? <div data-cover-task-error><Failure error={s.error} /></div> : null}
      {current ? <span className="max-w-[240px] truncate muted">{t('coverTasks.current', { name: current.name })}</span> : null}
      {s.starting ? <span data-cover-task-starting role="status">{t('coverTasks.starting')}</span> : null}
      {canStop && !s.open ? <button data-cover-task-stop type="button" className="btn" disabled={stopDisabled} onClick={() => void s.stop()}>{t('coverTasks.stop')}</button> : null}
      {!s.open ? <button data-cover-task-reopen type="button" className="btn ml-auto" onClick={s.show}>{t('coverTasks.reopen')}</button> : null}
    </div>
    <Modal open={s.open} onOpenChange={value => { if (!value) s.hide() }} title={t('coverTasks.title')} footer={<>
      {task?.canUndo ? <button data-cover-task-undo type="button" className="btn mr-auto" disabled={busy || task.running} onClick={() => void s.undo()}>{t(s.mutation === 'undo' ? 'coverTasks.undoing' : 'coverTasks.undo')}</button> : null}
      {failed ? <button data-cover-task-retry type="button" className="btn" disabled={busy || task?.running} onClick={() => void s.retry()}>{t(s.mutation === 'retry' ? 'coverTasks.retrying' : 'coverTasks.retry')}</button> : null}
      {canStop ? <button data-cover-task-stop type="button" className="btn" disabled={stopDisabled} onClick={() => void s.stop()}>{t(s.mutation === 'stop' ? 'coverTasks.stopping' : 'coverTasks.stop')}</button> : null}
      <button data-cover-task-hide type="button" className="btn" onClick={s.hide}>{t('coverTasks.hide')}</button>
    </>}>
      <div className="max-h-[65vh] space-y-3 overflow-y-auto text-[12px]">
        <p className="muted">{t('coverTasks.hint')}</p>
        {s.starting ? <p data-cover-task-starting role="status">{t('coverTasks.starting')}</p> : null}
        {task ? <>
          <Summary task={task} />
          {task.running ? <>
            <progress className="w-full" value={finished} max={Math.max(task.items.length, 1)} aria-label={t('coverTasks.progress')} />
            <p role="status">{current ? t('coverTasks.current', { name: current.name }) : t('coverTasks.queued')}</p>
          </> : task.cancelled ? <p>{t('coverTasks.stopped')}</p> : null}
          {s.undoResult ? <p data-cover-task-undo-result role="status" style={{ color: 'var(--ok)' }}>{t('coverTasks.undoResult', { ...s.undoResult })}</p> : null}
          {s.applying ? <p data-cover-task-applying role="status">{t('coverTasks.applying')}</p> : null}
          {reviewItems.length ? <section className="space-y-2 rounded border p-3" style={{ borderColor: 'var(--line)' }}>
            <p className="font-medium">{t('coverTasks.reviewHeading')}</p>
            <p className="muted">{t('coverTasks.chooseHint')}</p>
            <div className="flex max-h-[100px] flex-wrap gap-2 overflow-y-auto">
              {visibleReview.map(item => <button key={item.assetId} data-cover-task-review={item.assetId}
                type="button" className={'btn ' + (item.assetId === review?.assetId ? 'btn-accent' : '')} disabled={busy}
                aria-pressed={item.assetId === review?.assetId} onClick={() => void s.selectReview(item.assetId)}>{item.name}</button>)}
            </div>
            {reviewItems.length > visibleReview.length ? <p className="muted">{t('coverTasks.reviewListHint')}</p> : null}
            {review ? <div className="space-y-2" data-cover-task-review-panel>
              <p className="font-medium">{review.name}</p>
              {s.choicesLoading ? <p data-cover-task-choices-loading role="status">{t('coverTasks.loadingChoices')}</p> : null}
              {s.choicesError ? <div data-cover-task-choices-error><Failure error={s.choicesError} /><button data-cover-task-retry-choices type="button" className="btn mt-2" disabled={busy} onClick={() => void s.selectReview(review.assetId, s.choicesOffset)}>{t('coverTasks.retryChoices')}</button></div> : null}
              {s.choices ? <>
                <div className="grid grid-cols-4 gap-2">
                  {s.choices.choices.map(choice => <button key={choice.target.id} data-cover-task-candidate={choice.target.id}
                    type="button" className="overflow-hidden rounded border text-left" style={{ borderColor: 'var(--line)', background: 'var(--panel-2)' }}
                    disabled={busy || !choice.preview || !!choice.error} onClick={() => void s.applyChoice(choice.target.id)}
                    aria-label={t('coverTasks.chooseCandidate', { name: choice.target.name })}>
                    {choice.preview && !choice.error ? <img className="aspect-[4/3] w-full object-contain" src={choice.preview.url} alt={t('coverTasks.candidateAlt', { name: choice.target.name })} /> : <span className="flex aspect-[4/3] items-center p-2 text-[11px]" style={{ color: 'var(--bad)' }}>{t(choice.error && i18n.exists(choice.error) ? choice.error : 'coverTasks.previewFailed')}</span>}
                    <span className="block truncate px-2 py-1 text-[11px]" title={choice.target.path}>{choice.target.name}</span>
                  </button>)}
                </div>
                {!s.choices.choices.length ? <p>{t('coverTasks.noChoices')}</p> : null}
                {s.choices.truncated ? <p className="muted">{t('coverTasks.incomplete')}</p> : null}
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Button disabled={busy || s.choicesLoading} onClick={() => void s.selectReview(review.assetId, s.choicesOffset)}>{t('coverTasks.retryChoices')}</Button>
                  <span>{t('coverTasks.page', { page: Math.floor(s.choicesOffset / 8) + 1, pages: Math.max(1, Math.ceil(s.choices.total / 8)) })}</span>
                  <div className="flex gap-2">
                    <button data-cover-task-previous-page type="button" className="btn" disabled={busy || s.choicesOffset === 0} onClick={() => void s.selectReview(review.assetId, s.choicesOffset - 8)}>{t('coverTasks.previous')}</button>
                    <button data-cover-task-next-page type="button" className="btn" disabled={busy || s.choicesOffset + 8 >= s.choices.total} onClick={() => void s.selectReview(review.assetId, s.choicesOffset + 8)}>{t('coverTasks.next')}</button>
                  </div>
                </div>
              </> : null}
            </div> : null}
          </section> : null}
          <ul className="max-h-[180px] space-y-1 overflow-y-auto">
            {task.items.slice(0, itemLimit).map(item => <li key={item.assetId}>
              <span className="font-medium">{item.name}</span> · {t(stateKeys[item.state])}
              {item.reason && i18n.exists(item.reason) ? <span className="muted"> · {t(item.reason)}</span> : null}
              {item.detail ? <details><summary>{t('coverTasks.errorDetails')}</summary><pre className="whitespace-pre-wrap break-words text-[11px]">{item.detail}</pre></details> : null}
            </li>)}
          </ul>
          {task.items.length > itemLimit ? <Button onClick={() => setItemLimit(limit => limit + 100)}>{t('coverTasks.moreResults')}</Button> : null}
        </> : null}
        {s.error ? <div data-cover-task-error><Failure error={s.error} />{task ? <Button disabled={s.refreshing || busy} onClick={() => void s.refresh()}>{t('coverTasks.refresh')}</Button> : null}</div> : null}
      </div>
    </Modal>
  </>
}
