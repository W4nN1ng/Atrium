import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { RebundleGroup } from '../../shared/api'
import { useUi } from '../stores/ui'
import { Badge, Button } from './ui'

/**
 * 归并理由：写成两个明确的 key，不做"前缀 + 变量"的动态拼接 ——
 * 那条会让"每个用到的 key 都存在"的自检失效（i18n.spec 就是这么抓出来的）。
 */
function whyLabel(why: string, t: (k: string) => string): string {
  if (why === 'same-dir-and-versions') return t('settings.rebundleWhyVersions')
  if (why === 'same-dir-container') return t('settings.rebundleWhyContainer')
  return why
}

/**
 * 「重新整理合集」（改动单 §5）。
 *
 * 上一版把合集拆成了一堆顶层素材，这一版要能把它们吸回去而不重建整库：
 * 先只读扫描 → 列出"几个变几个" → 用户确认才写库，全程不动一个文件，且可 Ctrl+Z。
 */
export function RebundlePanel(): JSX.Element {
  const { t } = useTranslation()
  const toast = useUi((s) => s.toast)
  const refreshList = useUi((s) => s.refreshList)
  const refreshMeta = useUi((s) => s.refreshMeta)
  const [groups, setGroups] = useState<RebundleGroup[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')

  async function scan(): Promise<void> {
    setBusy(true)
    try {
      const r = await window.a.health.scanRebundle()
      setGroups(r)
      setNote('')
      if (!r.length) toast('info', t('settings.rebundleNone'))
    } catch (e) {
      toast('bad', e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  async function apply(list: RebundleGroup[]): Promise<void> {
    setBusy(true)
    try {
      const r = await window.a.health.applyRebundle(list.map((g) => g.dir))
      setNote(t('settings.rebundleDone', { bundles: r.bundles, moved: r.moved, versions: r.versions }))
      setGroups(null)
      await Promise.all([refreshList(), refreshMeta()])
      toast('ok', t('settings.rebundleDone', { bundles: r.bundles, moved: r.moved, versions: r.versions }))
    } catch (e) {
      toast('bad', e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <Button variant="accent" disabled={busy} onClick={() => void scan()}>
          {t('settings.rebundleScan')}
        </Button>
        {groups?.length ? (
          <Button disabled={busy} onClick={() => void apply(groups)}>
            {t('settings.rebundleApply', { count: groups.length })}
          </Button>
        ) : null}
        {groups && !groups.length ? <span className="text-[11px]" style={{ color: 'var(--muted)' }}>{t('settings.rebundleNone')}</span> : null}
      </div>
      {note ? (
        <div className="text-[11px]" style={{ color: 'var(--ok)' }}>
          {note} ·{' '}
          <button
            type="button"
            className="btn btn-ghost px-1.5 py-0.5 text-[11px]"
            onClick={async () => {
              const u = await window.a.journal.undoLast()
              toast(u.ok ? 'ok' : 'bad', u.message ?? '')
              await Promise.all([refreshList(), refreshMeta()])
            }}
          >
            {t('inbox.commitAllUndo')}
          </button>
        </div>
      ) : null}
      {groups?.length ? (
        <div
          className="max-h-64 overflow-y-auto rounded border text-[11px]"
          style={{ borderColor: 'var(--line-2)', background: 'var(--panel-2)' }}
        >
          {groups.map((g) => (
            <div key={g.dir} className="flex items-center gap-2 border-b px-2 py-1" style={{ borderColor: 'var(--line)' }}>
              <span className="min-w-0 flex-1 truncate" title={g.dir}>
                {g.bundleName}
              </span>
              <Badge tone="warn">
                {t('settings.rebundleFromTo', { from: g.from, to: g.to })}
              </Badge>
              <span style={{ color: 'var(--faint)' }}>{whyLabel(g.why, t)}</span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}
