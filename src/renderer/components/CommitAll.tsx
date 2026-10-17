import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { CommitAllSummary, IngestItemState } from '../../shared/api'
import type { LocaleKey } from '../../shared/types'
import { humanBytes } from '../lib/format'
import { useUi } from '../stores/ui'
import { Badge, Button, Modal, Select } from './ui'

/** 「全部入库」的范围（改动单 §1.4） */
type Scope = 'filtered' | 'high' | 'all'

/**
 * 「全部入库」按钮 + 范围选择 + 安全阀 + 事后补救条。
 *
 * 单独一个组件的理由：这是收编流程里唯一会**批量**改状态的入口，
 * 它的确认逻辑（动不动磁盘、动多少字节）必须一眼看得清，不该埋在页面 JSX 里。
 */
export function CommitAllButton({
  items,
  search,
  locale,
  confidenceAuto,
  libraryRoot,
  wouldMove,
  onDone
}: {
  items: IngestItemState[]
  search: string
  locale: LocaleKey
  confidenceAuto: number
  libraryRoot: string | null
  /** 设置里"入库会把文件搬进分类目录"是否开着（storageMode=archived） */
  wouldMove: boolean
  onDone: () => void
}): JSX.Element {
  const { t } = useTranslation()
  const toast = useUi((s) => s.toast)
  const setNav = useUi((s) => s.setNav)
  const refresh = useUi((s) => s.refreshList)
  const refreshMeta = useUi((s) => s.refreshMeta)
  const [scope, setScope] = useState<Scope>('filtered')
  const [busy, setBusy] = useState(false)
  const [prog, setProg] = useState<{ done: number; total: number } | null>(null)
  const [ask, setAsk] = useState(false)
  const [result, setResult] = useState<CommitAllSummary | null>(null)

  const waiting = useMemo(() => items.filter((i) => i.stage === 'awaiting_confirm'), [items])
  /**
   * "当前筛选结果"在收件箱这一页就是搜索框那条：搜 'Grimoir' 再一键入库，
   * 只放得进这十几件，其余留在原地。没有这条，搜索就只是高亮，改不了动作范围。
   */
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return waiting
    return waiting.filter((i) => (`${i.name} ${i.sourcePath ?? ''}`).toLowerCase().includes(q))
  }, [search, waiting])

  const targets = useMemo(() => {
    if (scope === 'high') return waiting.filter((i) => (i.units?.[0]?.confidence ?? 0) >= confidenceAuto)
    if (scope === 'all') return waiting
    return filtered
  }, [scope, waiting, filtered, confidenceAuto])

  const bytes = targets.reduce((a, i) => a + (i.bytes ?? 0), 0)

  useEffect(() => {
    const off = window.a.on('ingest:commit-progress', (...args: unknown[]) => {
      const p = args[0] as { done?: number; total?: number } | undefined
      if (p && typeof p.done === 'number') setProg({ done: p.done, total: p.total ?? 0 })
    })
    return off
  }, [])

  async function run(move: boolean): Promise<void> {
    setAsk(false)
    setBusy(true)
    setProg({ done: 0, total: targets.length })
    try {
      const r = await window.a.ingest.commitAll({ jobIds: targets.map((i) => i.jobId), move })
      setResult(r)
      toast(
        r.failed.length ? 'warn' : 'ok',
        t('inbox.commitAllDone', { count: r.committed })
      )
      await Promise.all([refresh(), refreshMeta()])
      onDone()
    } catch (e) {
      toast('bad', e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
      setProg(null)
    }
  }

  function start(): void {
    if (!targets.length) return
    if (!libraryRoot) {
      toast('bad', t('settings.libraryRootMissing'))
      return
    }
    // 会动磁盘就先问一句，默认停在"只登记"（改动单 §1.5）
    if (wouldMove) setAsk(true)
    else void run(false)
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-2">
        {prog ? (
          <span className="text-[11px] tabular-nums" style={{ color: 'var(--muted)' }}>
            {t('inbox.commitAllProgress', { done: prog.done, total: prog.total })}
          </span>
        ) : null}
        <Select
          value={scope}
          onChange={(v) => setScope(v as Scope)}
          options={[
            { value: 'filtered', label: t('inbox.scopeFiltered') },
            { value: 'high', label: t('inbox.scopeHigh', { n: Math.round(confidenceAuto * 100) }) },
            { value: 'all', label: t('inbox.scopeAll') }
          ]}
        />
        <Button variant="accent" disabled={busy || !targets.length} onClick={start}>
          {t('inbox.commitAll', { count: targets.length })}
        </Button>
      </div>
      {result ? (
        <div
          className="flex max-w-[720px] flex-wrap items-center gap-2 rounded border px-2 py-1 text-[11px]"
          style={{ borderColor: 'var(--line-2)', background: 'var(--panel-2)' }}
        >
          <span>
            {t('inbox.commitAllDone', { count: result.committed })}
            {result.bundles ? t('inbox.commitAllBundles', { count: result.bundles }) : ''}
            {result.failed.length ? t('inbox.commitAllFailed', { count: result.failed.length }) : ''}
          </span>
          <Badge tone={result.moved ? 'warn' : 'default'}>
            {result.moved ? t('inbox.commitAllMoved') : t('inbox.commitAllKept')}
          </Badge>
          <button
            type="button"
            className="btn btn-ghost px-1.5 py-0.5 text-[11px]"
            disabled={busy}
            onClick={async () => {
              setBusy(true)
              try {
                const u = await window.a.journal.undoLast()
                toast(u.ok ? 'ok' : 'bad', u.message ?? '')
                setResult(null)
                await Promise.all([refresh(), refreshMeta()])
                onDone()
              } finally {
                setBusy(false)
              }
            }}
          >
            {t('inbox.commitAllUndo')}
          </button>
          <button type="button" className="btn btn-ghost px-1.5 py-0.5 text-[11px]" onClick={() => setResult(null)}>
            {t('common.close')}
          </button>
        </div>
      ) : null}

      <Modal
        open={ask}
        onOpenChange={setAsk}
        title={t('inbox.commitAllAskTitle')}
        footer={
          <>
            <Button onClick={() => setAsk(false)}>{t('common.cancel')}</Button>
            <Button autoFocus variant="accent" onClick={() => void run(false)}>
              {t('inbox.commitAllKeepPut')}
            </Button>
            <Button onClick={() => void run(true)}>{t('inbox.commitAllMove')}</Button>
          </>
        }
      >
        <div className="text-[12px] leading-relaxed" style={{ color: 'var(--muted)' }}>
          <div>{t('inbox.commitAllAsk1', { count: targets.length, size: humanBytes(bytes, locale) })}</div>
          <div className="mt-1 break-all" style={{ color: 'var(--faint)' }}>
            {t('inbox.commitAllAsk2', { root: libraryRoot ?? '-' })}
          </div>
          <div className="mt-2" style={{ color: 'var(--warn)' }}>
            {t('inbox.commitAllAskHint')}
          </div>
        </div>
      </Modal>
    </div>
  )
}
