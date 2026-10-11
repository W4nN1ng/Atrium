import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ImportHistoryGroup, ImportHistoryPage } from '../../shared/types'
import { useUi } from '../stores/ui'
import { errorText } from '../lib/msg'
import { Badge, Button, Modal } from './ui'

const PAGE_SIZE = 20

export function ImportHistoryDialog({ projectId: initialProject, onClose }: {
  projectId: string | null; onClose: () => void
}): JSX.Element {
  const { t } = useTranslation()
  const statusLabels = {
    queued: t('importHistory.status.queued'), running: t('importHistory.status.running'),
    ok: t('importHistory.status.ok'), failed: t('importHistory.status.failed'),
    cancelled: t('importHistory.status.cancelled'), rolledback: t('importHistory.status.rolledback'),
    rollbackpartial: t('importHistory.status.rollbackpartial')
  }
  const projects = useUi(s => s.projects)
  const toast = useUi(s => s.toast)
  const [projectId, setProjectId] = useState(initialProject)
  const [offset, setOffset] = useState(0)
  const [page, setPage] = useState<ImportHistoryPage>({ groups: [], total: 0, offset: 0 })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [selected, setSelected] = useState<ImportHistoryGroup | null>(null)
  const [rollingBack, setRollingBack] = useState(false)
  const request = useRef(0)
  const load = useCallback(async (): Promise<void> => {
    const seq = ++request.current
    setBusy(true); setError('')
    try {
      const next = await window.a.unity.importHistory({ projectId, offset, limit: PAGE_SIZE })
      if (seq === request.current) setPage(next)
    } catch (e) { if (seq === request.current) setError(errorText(e)) }
    finally { if (seq === request.current) setBusy(false) }
  }, [projectId, offset])
  useEffect(() => { void load(); return () => { request.current++ } }, [load])

  async function rollback(): Promise<void> {
    if (!selected || rollingBack) return
    setRollingBack(true)
    try {
      let ok = false, count = 0, incomplete = 0
      let reason: string | null = null
      if (selected.batchId !== null) {
        const result = await window.a.unity.rollbackBatch(selected.batchId)
        if ('details' in result) {
          ok = result.ok; count = result.rolledBack
          incomplete = result.details.reduce((n, d) => n + d.unrestorable + (d.failedToDelete ?? 0), 0)
          reason = result.details.find(d => !d.ok)?.error ?? null
        } else reason = result.reasonKey ? t(result.reasonKey) : t('importHistory.rollbackFailed')
      } else {
        const result = await window.a.unity.rollbackImport(selected.items[0].id)
        ok = result.ok; count = result.ok ? 1 : 0
        incomplete = 'unrestorable' in result ? result.unrestorable + (result.failedToDelete?.length ?? 0) : 0
        reason = result.error
      }
      toast(ok && !incomplete ? 'ok' : 'warn', [
        t(ok ? 'importHistory.rollbackDone' : 'importHistory.rollbackStopped', { count }),
        incomplete ? t('importHistory.incomplete', { count: incomplete }) : '',
        reason ? errorText(reason) : ''
      ].filter(Boolean).join(' · '))
      setSelected(null); await load()
    } catch (e) { toast('bad', errorText(e)) }
    finally { setRollingBack(false) }
  }

  const success = selected?.items.filter(i => i.canRollback) ?? []
  const noBackup = success.reduce((n, i) => n + (i.hasBackup ? 0 : i.overwritten), 0)
  return <Modal open onOpenChange={v => { if (!v && !rollingBack) onClose() }} title={t('importHistory.title')}
    footer={selected ? <>
      <Button disabled={rollingBack} onClick={() => setSelected(null)}>{t('common.cancel')}</Button>
      <Button variant="accent" disabled={rollingBack} onClick={() => void rollback()}>{t(rollingBack ? 'importHistory.rollingBack' : 'importHistory.confirmRollback')}</Button>
    </> : <Button onClick={onClose}>{t('common.close')}</Button>}>
    <div className="flex max-h-[65vh] flex-col gap-3 overflow-y-auto">
      {selected ? <>
        <p>{t('importHistory.confirm', { count: success.length, project: selected.projectName })}</p>
        <p className="text-[12px] muted">{selected.projectPath}</p>
        <ul className="list-disc pl-5 text-[12px]">{success.map(i => <li key={i.id}>{i.name}</li>)}</ul>
        <p className="text-[12px]" style={{ color: 'var(--warn)' }}>{t('importHistory.rollbackWarning')}</p>
        {noBackup > 0 ? <p className="text-[12px]" style={{ color: 'var(--warn)' }}>{t('importHistory.noBackup', { count: noBackup })}</p> : null}
      </> : <>
        <div className="flex items-center gap-2">
          <select className="input min-w-0 flex-1" aria-label={t('importHistory.projectFilter')} value={projectId ?? ''} disabled={busy}
            onChange={e => { setProjectId(e.target.value || null); setOffset(0) }}>
            <option value="">{t('importHistory.allProjects')}</option>
            {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <Button disabled={busy} onClick={() => void load()}>{t('project.refresh')}</Button>
        </div>
        <p className="text-[12px] muted">{t('importHistory.hint')}</p>
        {error ? <p role="alert" style={{ color: 'var(--bad)' }}>{error}</p> : null}
        {busy ? <p>{t('importHistory.loading')}</p> : page.groups.length === 0 ? <p>{t('importHistory.empty')}</p> :
          page.groups.map(group => <div key={group.key} className="rounded border p-3" style={{ borderColor: 'var(--line)' }}>
            <div className="flex items-center gap-2">
              <div className="min-w-0 flex-1"><div className="font-medium">{group.projectName}</div>
                <div className="text-[11px] faint">{group.at ? new Date(group.at).toLocaleString() : t('importHistory.unknownTime')}
                  {' · '}{t('importHistory.packages', { count: group.items.length })}</div>
              </div>
              <Button disabled={!!group.rollbackBlockKey || !group.items.some(i => i.canRollback)} onClick={() => setSelected(group)}>{t('importHistory.rollback')}</Button>
            </div>
            {group.rollbackBlockKey ? <p className="mt-2 text-[11px]" style={{ color: 'var(--warn)' }}>{t(group.rollbackBlockKey)}</p> : null}
            {group.items.some(i => i.status === 'rollbackpartial') ? <p className="mt-2 text-[11px]" style={{ color: 'var(--warn)' }}>{t('importHistory.partialWarning')}</p> : null}
            <details className="mt-2 text-[12px]"><summary className="cursor-pointer">{t('importHistory.details')}</summary>
              <div className="mt-2 flex flex-col gap-2">{group.items.map(item => <div key={item.id}>
                <div className="flex items-center gap-2"><span className="min-w-0 flex-1 break-all">{item.name}</span>
                  <Badge tone={item.status === 'ok' ? 'ok' : item.status === 'failed' ? 'warn' : 'default'}>{statusLabels[item.status]}</Badge>
                </div>
                <div className="text-[11px] faint">{t('importHistory.files', { created: item.created, overwritten: item.overwritten })}</div>
                {item.message ? <div className="break-all text-[11px] muted">{errorText(item.message)}</div> : null}
              </div>)}</div>
            </details>
          </div>)}
        <div className="flex items-center justify-between gap-2">
          <Button disabled={busy || offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>{t('importHistory.previous')}</Button>
          <span className="text-[11px]">{t('importHistory.batchCount', { count: page.total })}</span>
          <Button disabled={busy || offset + PAGE_SIZE >= page.total} onClick={() => setOffset(offset + PAGE_SIZE)}>{t('importHistory.next')}</Button>
        </div>
      </>}
    </div>
  </Modal>
}
