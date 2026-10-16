import { useTranslation } from 'react-i18next'
import type { ConnectionPhase } from '../../shared/unityConnection'
import { useUi } from '../stores/ui'
import { Badge, Button, Modal } from './ui'

/** Static, complete locale keys keep status wording consistent across entry points. */
export function connectionText(t: (key: string) => string, phase: ConnectionPhase): string {
  const keys: Record<ConnectionPhase, string> = {
    closed: 'project.connectionClosed',
    disabled: 'project.connectionDisabled',
    unsupported: 'project.connectionUnsupported',
    installing: 'project.connectionInstalling',
    connecting: 'project.connectionWaiting',
    ready: 'project.connectionReady',
    failed: 'project.connectionFailed'
  }
  return t(keys[phase])
}

export function ConnectionBadge({ phase }: { phase: ConnectionPhase }): JSX.Element {
  const { t } = useTranslation()
  return <Badge tone={phase === 'ready' ? 'ok' : phase === 'failed' ? 'bad' : phase === 'connecting' || phase === 'installing' ? 'warn' : 'default'}>
    {connectionText(t, phase)}
  </Badge>
}

/** One explicit choice resolves the pending import; opening Unity never imports. */
export function ImportTargetPicker(): JSX.Element | null {
  const { t } = useTranslation()
  const picker = useUi((s) => s.targetPicker)
  const connection = useUi((s) => s.connection)
  const choose = useUi((s) => s.chooseImportTarget)
  if (!picker.open) return null
  const candidates = connection.projects.filter((p) => picker.projectIds.includes(p.projectId) && p.phase !== 'closed' && p.phase !== 'unsupported' && p.phase !== 'disabled')

  return <Modal open onOpenChange={(open) => { if (!open) void choose(null) }} title={t('project.chooseImportTarget')}
    footer={<Button onClick={() => void choose(null)}>{t('common.cancel')}</Button>}>
    <div className="flex flex-col gap-3 text-[12px]">
      <p style={{ color: 'var(--muted)' }}>{t('project.chooseImportTargetHint')}</p>
      {!candidates.length ? <p style={{ color: 'var(--warn)' }}>{t('project.openUnityHint')}</p> : candidates.map((p) => (
        <button key={p.projectId} type="button" data-import-target={p.projectId}
          className="flex items-center gap-3 rounded border p-3 text-left"
          style={{ borderColor: 'var(--line)', background: 'var(--panel-2)' }} onClick={() => void choose(p.projectId)}>
          <span className="min-w-0 flex-1"><strong className="block truncate">{p.name}</strong>
            <span className="mt-1 block break-all text-[11px]" style={{ color: 'var(--muted)' }}>{p.projectPath}</span>
          </span>
          <ConnectionBadge phase={p.phase} />
        </button>
      ))}
    </div>
  </Modal>
}
