import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { RegroupPlanView } from '../../shared/api'
import { useUi } from '../stores/ui'
import { Badge, Button } from './ui'

/**
 * #40 存量清理：「跨目录误并的归并组」按目录拆开。
 *
 * 用户裁定原文：「归并的前提是**同一父容器（同目录）**，跨目录的 groupKey 相同
 * 不构成归并理由」。代码侧（`ensureGroup` 的 dirKey 闸门 + V4 迁移）只管住了"以后"，
 * 存量那批已经在库里的跨目录组要靠这里清。
 *
 * 真库实测 13 组里**只有 8 组该拆**，另 5 组是「同一产品的 zip 与已解压副本」
 * 被两个目录隔开，按裁定 #16 必须保持"一张卡"。所以界面**两栏都显示**：
 * 会让用户以为程序漏看了那 5 组。
 *
 * 全程只写库、不碰文件，执行后可以 Ctrl+Z 整批撤销。
 */
export function RegroupPanel(): JSX.Element {
  const { t } = useTranslation()
  const toast = useUi((s) => s.toast)
  const refreshList = useUi((s) => s.refreshList)
  const refreshMeta = useUi((s) => s.refreshMeta)
  const [plan, setPlan] = useState<RegroupPlanView | null>(null)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')

  async function scan(): Promise<void> {
    setBusy(true)
    try {
      const r = await window.a.health.planRegroup()
      setPlan(r)
      setNote('')
      if (!r.groups.length) toast('info', t('settings.regroupNone'))
    } catch (e) {
      toast('bad', e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  async function apply(): Promise<void> {
    setBusy(true)
    try {
      const r = await window.a.health.applyRegroup([])
      const msg = t('settings.regroupDone', { groups: r.groups, moved: r.moved })
      setNote(msg)
      setPlan(null)
      await Promise.all([refreshList(), refreshMeta()])
      toast('ok', msg)
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
          {t('settings.regroupScan')}
        </Button>
        {plan?.groups.length ? (
          <Button disabled={busy} onClick={() => void apply()}>
            {t('settings.regroupApply', { count: plan.groups.length })}
          </Button>
        ) : null}
        {plan && !plan.groups.length ? (
          <span className="text-[11px]" style={{ color: 'var(--muted)' }}>
            {t('settings.regroupNone')}
          </span>
        ) : null}
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

      {plan ? (
        <div className="text-[11px]" style={{ color: 'var(--muted)' }}>
          {t('settings.regroupScanned', { scanned: plan.scanned, affected: plan.affected })}
        </div>
      ) : null}

      {/* 会被拆开的组 */}
      {plan?.groups.length ? (
        <div
          className="max-h-56 overflow-y-auto rounded border text-[11px]"
          style={{ borderColor: 'var(--line-2)', background: 'var(--panel-2)' }}
        >
          {plan.groups.map((g) => (
            <div key={g.groupId} className="flex items-center gap-2 border-b px-2 py-1" style={{ borderColor: 'var(--line)' }}>
              <span className="min-w-0 flex-1 truncate" title={g.dirs.join('\n')}>
                {g.groupName}
              </span>
              <Badge tone="warn">{t('settings.regroupSplitBadge', { from: g.before.length, to: g.clusters.length })}</Badge>
              <span className="min-w-0 flex-[2] truncate" style={{ color: 'var(--faint)' }} title={g.dirs.join('\n')}>
                {g.dirs.join('  |  ')}
              </span>
            </div>
          ))}
        </div>
      ) : null}

      {/* 故意没动的那些：同一产品的 zip 与已解压副本（裁定 #16 要求保持一张卡） */}
      {plan?.kept.length ? (
        <div className="flex flex-col gap-1">
          <span className="text-[11px]" style={{ color: 'var(--muted)' }}>
            {t('settings.regroupKeptTitle', { count: plan.kept.length })}
          </span>
          <div
            className="max-h-40 overflow-y-auto rounded border text-[11px]"
            style={{ borderColor: 'var(--line-2)', background: 'var(--panel-2)' }}
          >
            {plan.kept.map((k) => (
              <div key={k.groupKey} className="flex items-center gap-2 border-b px-2 py-1" style={{ borderColor: 'var(--line)' }}>
                <span className="min-w-0 flex-1 truncate" title={k.groupName}>
                  {k.groupName}
                </span>
                <Badge tone="ok">{t('settings.regroupKeptBadge')}</Badge>
              </div>
            ))}
          </div>
          <span className="text-[11px]" style={{ color: 'var(--faint)' }}>
            {t('settings.regroupKeptWhy')}
          </span>
        </div>
      ) : null}
    </div>
  )
}
