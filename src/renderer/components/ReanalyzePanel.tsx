import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ReanalyzePlanView } from '../../shared/api'
import { useUi } from '../stores/ui'
import { Badge, Button } from './ui'

/**
 * 「重新分析」（增量改动单 2 §交付 4）。
 *
 * 交互顺序是规格点名要求的：**先只读扫描 → 把影响条数摆出来 → 用户按下才写库**。
 * 所以第一个按钮叫"先看看会影响多少条"，它只调 plan，什么都不改；
 * "重新分析这 N 条"那个按钮才是执行，而且它重新扫一遍再执行，
 * 免得预览是十分钟前的、期间库又变了。
 *
 * 全程只 UPDATE 库里的列，一个文件都不移动；写 journal，Ctrl+Z 整批退回。
 * 垃圾记录那条按钮删的是库里的行，磁盘上的文件留在原地 —— 删用户文件这件事
 * 永远只走回收站，而且不在这里顺手做。
 */
export function ReanalyzePanel(): JSX.Element {
  const { t } = useTranslation()
  const toast = useUi((s) => s.toast)
  const refreshList = useUi((s) => s.refreshList)
  const refreshMeta = useUi((s) => s.refreshMeta)
  const [plan, setPlan] = useState<ReanalyzePlanView | null>(null)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')

  async function scan(): Promise<void> {
    setBusy(true)
    try {
      setPlan(await window.a.health.planReanalyze())
      setNote('')
    } catch (e) {
      toast('bad', e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  async function apply(): Promise<void> {
    if (!plan?.affected) return
    setBusy(true)
    try {
      const r = await window.a.health.applyReanalyze()
      setNote(t('settings.reanalyzeDone', { count: r.updated }))
      toast('ok', t('settings.reanalyzeDone', { count: r.updated }))
      setPlan(null)
      await Promise.all([refreshList(), refreshMeta()])
    } catch (e) {
      toast('bad', e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  async function dropJunk(): Promise<void> {
    if (!plan?.junk.length) return
    setBusy(true)
    try {
      const r = await window.a.health.dropJunkRows(plan.junk.map((j) => j.id))
      toast('ok', t('settings.reanalyzeJunkDone', { count: r.deleted }))
      setNote(t('settings.reanalyzeJunkDone', { count: r.deleted }))
      setPlan(await window.a.health.planReanalyze())
      await Promise.all([refreshList(), refreshMeta()])
    } catch (e) {
      toast('bad', e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="text-[11px] leading-relaxed" style={{ color: 'var(--muted)' }}>
        {t('settings.reanalyzeWhy')}
      </div>

      <div className="flex items-center gap-2">
        <Button variant="accent" disabled={busy} onClick={() => void scan()}>
          {busy ? t('settings.reanalyzeScanning') : t('settings.reanalyzeScan')}
        </Button>
        {plan && plan.affected > 0 ? (
          <Button disabled={busy} onClick={() => void apply()}>
            {t('settings.reanalyzeApply', { count: plan.affected })}
          </Button>
        ) : null}
        {plan && plan.junk.length ? (
          <Button disabled={busy} onClick={() => void dropJunk()}>
            {t('settings.reanalyzeDropJunk', { count: plan.junk.length })}
          </Button>
        ) : null}
        {plan && plan.affected === 0 && !plan.junk.length ? (
          <span className="text-[11px]" style={{ color: 'var(--ok)' }}>
            {t('settings.reanalyzeClean', { scanned: plan.scanned })}
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
        <>
          <div className="flex flex-wrap items-center gap-2 text-[11px]">
            <Badge tone="default">{t('settings.reanalyzeAffected', { scanned: plan.scanned, affected: plan.affected })}</Badge>
            {plan.renamed ? <Badge tone="accent">{t('settings.reanalyzeRenamed', { count: plan.renamed })}</Badge> : null}
            {plan.uuidNamed ? <Badge tone="warn">{t('settings.reanalyzeUuid', { count: plan.uuidNamed })}</Badge> : null}
            {plan.demoted ? <Badge tone="accent">{t('settings.reanalyzeDemote', { count: plan.demoted })}</Badge> : null}
            {plan.junk.length ? <Badge tone="bad">{t('settings.reanalyzeJunk', { count: plan.junk.length })}</Badge> : null}
          </div>

          {plan.demotePreview?.length ? (
            <div
              className="max-h-40 overflow-y-auto rounded border text-[11px]"
              style={{ borderColor: 'var(--line-2)', background: 'var(--panel-2)' }}
            >
              {plan.demotePreview.map((d) => (
                <div key={d.id} className="flex items-center gap-2 border-b px-2 py-1" style={{ borderColor: 'var(--line)' }}>
                  <span className="w-[200px] shrink-0 truncate" title={d.name}>
                    {d.name}
                  </span>
                  <span style={{ color: 'var(--faint)' }}>→</span>
                  <span className="chip shrink-0">{d.kind}</span>
                  <span className="min-w-0 flex-1 truncate" style={{ color: 'var(--muted)' }}>
                    {d.host}
                  </span>
                </div>
              ))}
            </div>
          ) : null}

          {plan.preview.length ? (
            <div
              className="max-h-64 overflow-y-auto rounded border text-[11px]"
              style={{ borderColor: 'var(--line-2)', background: 'var(--panel-2)' }}
            >
              {plan.preview.map((p) => (
                <div key={p.id} className="flex items-center gap-2 border-b px-2 py-1" style={{ borderColor: 'var(--line)' }}>
                  <span className="w-[190px] shrink-0 truncate" title={p.name}>
                    {p.fromName}
                  </span>
                  <span style={{ color: 'var(--faint)' }}>→</span>
                  <span className="w-[190px] shrink-0 truncate font-medium" title={p.toName}>
                    {p.toName}
                  </span>
                  {p.fromVersion !== p.toVersion ? (
                    <span className="shrink-0" style={{ color: 'var(--muted)' }}>
                      {p.fromVersion ?? '—'} → {p.toVersion ?? '—'}
                    </span>
                  ) : null}
                  <span className="ml-auto shrink-0" style={{ color: 'var(--faint)' }}>
                    {p.fields.join(', ')}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-[11px]" style={{ color: 'var(--muted)' }}>
              {t('settings.reanalyzeNone')}
            </div>
          )}

          {plan.junk.length ? (
            <div
              className="max-h-40 overflow-y-auto rounded border text-[11px]"
              style={{ borderColor: 'var(--line-2)', background: 'var(--panel-2)' }}
            >
              {plan.junk.map((j) => (
                <div key={j.id} className="flex items-center gap-2 border-b px-2 py-1" style={{ borderColor: 'var(--line)' }}>
                  <span className="w-[190px] shrink-0 truncate">{j.name}</span>
                  <span className="min-w-0 flex-1 truncate" style={{ color: 'var(--faint)' }} title={j.path ?? ''}>
                    {j.path ?? ''}
                  </span>
                </div>
              ))}
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  )
}
