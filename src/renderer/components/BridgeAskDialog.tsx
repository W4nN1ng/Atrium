import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useUi } from '../stores/ui'
import { Button, Modal } from './ui'

/** One explicit selection for all discovered projects; skipping only affects this session. */
export function BridgeAskDialog(): JSX.Element | null {
  const { t } = useTranslation()
  const projects = useUi((s) => s.bridgeAsk)
  const resolve = useUi((s) => s.resolveBridgeAsks)
  const [selected, setSelected] = useState<string[]>([])
  const [automatic, setAutomatic] = useState(false)
  const [busy, setBusy] = useState(false)
  if (!projects.length) return null
  const picked = selected.filter((id) => projects.some((p) => p.projectId === id))
  const finish = async (ids: string[]): Promise<void> => {
    if (busy) return
    setBusy(true)
    try { await resolve(ids, automatic) }
    finally { setSelected([]); setAutomatic(false); setBusy(false) }
  }
  return (
    <Modal open onOpenChange={(open) => { if (!open && !busy) void finish([]) }} title={t('project.connectTitle')}
      footer={<>
        <Button disabled={busy} onClick={() => void finish([])}>{t('project.connectLater')}</Button>
        <Button variant="accent" disabled={busy || !picked.length} onClick={() => void finish(picked)}>
          {t('project.connectSelected', { n: picked.length })}
        </Button>
      </>}>
      <div className="flex flex-col gap-4 text-[13px]">
        <p style={{ color: 'var(--muted)', lineHeight: 1.7 }}>{t('project.connectIntro')}</p>
        <div className="flex max-h-[280px] flex-col gap-2 overflow-y-auto">
          {projects.map((project) => (
            <label key={project.projectId} className="flex cursor-pointer items-start gap-3 rounded border p-3" style={{ borderColor: 'var(--line)' }}>
              <input type="checkbox" disabled={busy} checked={picked.includes(project.projectId)} className="mt-1"
                onChange={(e) => setSelected((ids) => e.target.checked ? [...ids, project.projectId] : ids.filter((id) => id !== project.projectId))} />
              <span className="min-w-0"><strong>{project.name}</strong><span className="mt-1 block break-all text-[11px]" style={{ color: 'var(--muted)' }}>{project.projectPath}</span></span>
            </label>
          ))}
        </div>
        <label className="flex items-center gap-2"><input type="checkbox" checked={automatic} disabled={busy}
          onChange={(e) => setAutomatic(e.target.checked)} />{t('project.connectAutomatic')}</label>
        <p className="text-[12px]" style={{ color: 'var(--muted)' }}>{t('project.connectFilesNote')}</p>
      </div>
    </Modal>
  )
}
