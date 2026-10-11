import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { CoverBatch as Batch } from '../../shared/covers'
import { Button, Modal } from './ui'

const stateKeys = { queued: 'covers.queued', running: 'covers.generating', done: 'covers.done', failed: 'covers.failed', skipped: 'covers.skipped', cancelled: 'covers.cancelled' }
export function CoverBatch({ assetIds }: { assetIds: string[] }): JSX.Element {
  const { t, i18n } = useTranslation()
  const [open, setOpen] = useState(false)
  const [ids, setIds] = useState<string[]>([])
  const [batch, setBatch] = useState<Batch | null>(null)
  const [error, setError] = useState('')
  const [errorDetail, setErrorDetail] = useState('')
  const [starting, setStarting] = useState(false)
  const activeId = useRef<string | null>(null)
  const active = useRef(true)
  useEffect(() => {
    active.current = true
    return () => { active.current = false; if (activeId.current) void window.a.covers.cancelBatch(activeId.current) }
  }, [])
  useEffect(() => {
    if (!batch?.running) return
    let mounted = true
    const timer = setInterval(() => {
      void window.a.covers.batchStatus(batch.id).then(value => { if (mounted) setBatch(value) }).catch(() => { if (mounted) { setError('covers.renderFailed'); clearInterval(timer) } })
    }, 500)
    return () => { mounted = false; clearInterval(timer) }
  }, [batch?.id, batch?.running])
  function close(): void {
    if (activeId.current) void window.a.covers.cancelBatch(activeId.current)
    activeId.current = null; setOpen(false)
  }
  async function start(): Promise<void> {
    setStarting(true); setError('')
    try {
      const result = await window.a.covers.startBatch(ids)
      if (!active.current) { void window.a.covers.cancelBatch(result.id); return }
      activeId.current = result.id; setBatch(result)
    } catch (e) {
      const key = e instanceof Error ? e.message.match(/covers\.[A-Za-z]+/)?.[0] : null
      if (active.current) { setError(key && i18n.exists(key) ? key : 'covers.renderFailed'); setErrorDetail((e instanceof Error ? e.message : String(e)).slice(0, 4000)) }
    } finally { if (active.current) setStarting(false) }
  }
  const done = batch?.items.filter(item => item.state === 'done').length ?? 0
  return <>
    <Button disabled={!assetIds.length || starting} onClick={() => { setIds([...assetIds]); setBatch(null); setError(''); setOpen(true) }}>{t('covers.batch')}</Button>
    <Modal open={open} onOpenChange={value => { if (!value && !starting) close() }} title={t('covers.batchTitle')} footer={<>
      <Button disabled={starting} onClick={close}>{t(batch?.running ? 'common.cancel' : 'common.close')}</Button>
      {!batch ? <Button variant="accent" disabled={starting} onClick={() => void start()}>{t('covers.batchStart', { count: ids.length })}</Button> : null}
    </>}>
      <div className="space-y-3 text-[12px]">
        <p className="muted">{t('covers.batchHint')}</p>
        {batch ? <>
          <p role="status">{t('covers.batchProgress', { done, total: batch.items.length })}</p>
          <progress className="w-full" value={batch.items.filter(item => !['queued', 'running'].includes(item.state)).length} max={batch.items.length} />
          <ul className="max-h-[240px] space-y-1 overflow-y-auto">
            {batch.items.map(item => <li key={item.assetId}><span className="font-medium">{item.name}</span> · {t(stateKeys[item.state])}{item.reason && i18n.exists(item.reason) ? ' · ' + t(item.reason) : ''}
              {item.detail ? <details><summary>{t('covers.errorDetails')}</summary><pre className="whitespace-pre-wrap break-words text-[11px]">{item.detail}</pre></details> : null}
            </li>)}
          </ul>
        </> : null}
        {error ? <div role="alert" style={{ color: 'var(--bad)' }}><p>{t(error)}</p>{errorDetail ? <details><summary>{t('covers.errorDetails')}</summary><pre className="whitespace-pre-wrap break-words text-[11px]">{errorDetail}</pre></details> : null}</div> : null}
      </div>
    </Modal>
  </>
}
