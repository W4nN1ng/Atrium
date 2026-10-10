import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { RemergePlanView } from '../../shared/api'
import { useUi } from '../stores/ui'
import { Badge, Button } from './ui'

/**
 * 第 9 轮 ② · B4「存量重并」：按现在的键规则，把库里老行重新归一次组。
 *
 * ## 为什么要有这一块（用户看不见的那段历史）
 *
 * 他的原话是「同一件衣服，比如 Libero 还是没用自动分成一个合集」。量完发现判据**早就修对了** ——
 * 那 20 个文件名喂给现在的规则全塌成一个键 —— 可库里 13 个组挂的还是老键，
 * 而「重新分析」刻意不动 `group_key`（`reanalyze.ts` 的 `recompute()`），所以点多少次都没用。
 * 这块面板就是"把已经修好的规则重新作用到存量上"那一步。
 *
 * ## 界面上刻意做的三件事
 *
 *  - **先扫再看，扫本身一行都不改**（`planRemerge` 只读）；
 *  - **每一簇都写明"从哪个键 → 到哪个键"**：只报"要合并 12 条"没人敢点，
 *    看见 `libero ichigo attitude the royal bunny → libero attitude` 才知道程序在想什么；
 *  - **挡掉了几处也要说**（`skippedAmbiguous`）：§B2 那道歧义闸门拦下来的东西，
 *    不报出来用户会以为程序漏看了。
 *
 * 全程只写库、一个文件都不搬，执行后 Ctrl+Z 整批退回。
 */
export function RemergePanel(): JSX.Element {
  const { t } = useTranslation()
  const toast = useUi((s) => s.toast)
  const refreshList = useUi((s) => s.refreshList)
  const refreshMeta = useUi((s) => s.refreshMeta)
  const [plan, setPlan] = useState<RemergePlanView | null>(null)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')

  async function scan(): Promise<void> {
    setBusy(true)
    try {
      const r = await window.a.health.planRemerge()
      setPlan(r)
      setNote('')
      if (!r.clusters.length) toast('info', t('settings.remergeNone'))
    } catch (e) {
      toast('bad', e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  async function apply(): Promise<void> {
    setBusy(true)
    try {
      /** 空数组 = 处理预览里的全部；主进程会**重扫一遍**再落地，不信这份预览 */
      const r = await window.a.health.applyRemerge([])
      const msg = t('settings.remergeDone', { clusters: r.clusters, moved: r.moved, groups: r.droppedGroups })
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

  const movedTotal = plan?.clusters.reduce((n, c) => n + c.moved, 0) ?? 0

  return (
    <div className="flex flex-col gap-2">
      <div className="text-[11px]" style={{ color: 'var(--muted)' }}>
        {t('settings.remergeHint')}
      </div>
      <div className="flex items-center gap-2">
        <Button variant="accent" disabled={busy} onClick={() => void scan()}>
          {t('settings.remergeScan')}
        </Button>
        {plan?.clusters.length ? (
          <Button disabled={busy} onClick={() => void apply()}>
            {t('settings.remergeApply', { count: plan.clusters.length })}
          </Button>
        ) : null}
        {plan && !plan.clusters.length ? (
          <span className="text-[11px]" style={{ color: 'var(--muted)' }}>
            {t('settings.remergeNone')}
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
          {t('settings.remergeScanned', { scanned: plan.scanned, moved: movedTotal })}
          {plan.skippedAmbiguous ? `　${t('settings.remergeAmbiguous', { count: plan.skippedAmbiguous })}` : ''}
        </div>
      ) : null}

      {plan?.clusters.length ? (
        <div
          className="max-h-56 overflow-y-auto rounded border text-[11px]"
          style={{ borderColor: 'var(--line-2)', background: 'var(--panel-2)' }}
        >
          {plan.clusters.map((c) => (
            <div key={c.groupKey} className="flex flex-col gap-0.5 border-b px-2 py-1" style={{ borderColor: 'var(--line)' }}>
              <div className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate" title={c.groupKey}>
                  {c.name}
                </span>
                {/*
                  ⚠ 数字用"这一簇一共几张卡"，不是 `moved + droppedGroups` ——
                  后者在 20 张 / 13 组的真库形状上会写成「24 张并成 1 张」，
                  比实际卡数多出 4 张（挪的 12 张和被清掉的 12 个组是同一批东西，加两遍）。
                  活体第一次跑抓出来的，界面上报错数比不报更糟。
                */}
                <Badge tone="warn">{t('settings.remergeBadge', { from: c.rows.length })}</Badge>
                {c.newGroup ? <span style={{ color: 'var(--faint)' }}>{t('settings.remergeNewGroup')}</span> : null}
              </div>
              {/* 逐条"从哪个键 → 到哪个键"：只给数字没人敢点 */}
              {c.rows.slice(0, 8).map((r) => (
                <div key={r.name + String(r.fromKey)} className="truncate pl-2" style={{ color: 'var(--faint)' }} title={`${r.fromKey ?? '—'} → ${r.toKey}`}>
                  {r.fromKey} <span style={{ color: 'var(--muted)' }}>→</span> {r.toKey}
                </div>
              ))}
              {c.rows.length > 8 ? (
                <div className="pl-2" style={{ color: 'var(--faint)' }}>
                  {t('settings.remergeMore', { count: c.rows.length - 8 })}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}
