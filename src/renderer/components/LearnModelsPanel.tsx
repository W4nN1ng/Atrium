import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { LearnCandidate } from '../../shared/api'
import { useUi } from '../stores/ui'
import { Badge, Button } from './ui'

/**
 * §B4「从库中学习模型名」。
 *
 * 词表写死在代码里的话，每来一个新模型就得改源码重打包 —— 库越攒越大，这条路走不通。
 * 所以这里扫库里 `<模型>_<系列>` 这种方括号槽位，把词典还不认识的名字列出来，
 * 用户勾一下点「加入词典」，写进 %APPDATA%\A\lexicon.user.json（可导出分享，不动内置词典）。
 *
 * 判据和规格写的「频次 ≥3」不一样，原因在这个面板底部那行小字里说清楚了：
 * 真库那 20 个 Libero 是 20 个不同模型各出现 1 次，按 ≥3 一个都捞不到。
 */
export function LearnModelsPanel(): JSX.Element {
  const { t } = useTranslation()
  const toast = useUi((s) => s.toast)
  const refreshList = useUi((s) => s.refreshList)
  const refreshMeta = useUi((s) => s.refreshMeta)
  const [rows, setRows] = useState<LearnCandidate[] | null>(null)
  const [picked, setPicked] = useState<string[]>([])
  const [busy, setBusy] = useState(false)

  async function scan(): Promise<void> {
    setBusy(true)
    try {
      const r = await window.a.assets.learnScan()
      setRows(r)
      // 默认全勾：扫出来的本来就都是"同一系列下的一批名字"，逐个点太累
      setPicked(r.map((x) => x.token))
    } catch (e) {
      toast('bad', e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  async function add(): Promise<void> {
    if (!picked.length) return
    setBusy(true)
    try {
      const r = await window.a.assets.learnAdd(picked)
      toast('ok', t('settings.learnAdded', { count: r.added }))
      setPicked([])
      setRows(null)
      // 词典变了，归并结果也会变：列表和侧栏计数都要重算
      await Promise.all([refreshList(), refreshMeta()])
    } catch (e) {
      toast('bad', e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const toggle = (tok: string, on: boolean): void =>
    setPicked(on ? [...picked, tok] : picked.filter((x) => x !== tok))

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <Button variant="accent" disabled={busy} onClick={() => void scan()}>
          {busy ? t('settings.learnScanning') : t('settings.learnScan')}
        </Button>
        {rows?.length ? (
          <Button disabled={busy || !picked.length} onClick={() => void add()}>
            {t('settings.learnAdd')} · {picked.length}
          </Button>
        ) : null}
        {rows && !rows.length ? (
          <span className="text-[11px]" style={{ color: 'var(--muted)' }}>
            {t('settings.learnNone')}
          </span>
        ) : null}
        {rows?.length ? (
          <span className="text-[11px]" style={{ color: 'var(--muted)' }}>
            {t('settings.learnFound', { count: rows.length })}
          </span>
        ) : null}
      </div>

      <div className="text-[11px]" style={{ color: 'var(--muted)' }}>
        {t('settings.learnWhy')}
      </div>

      {rows?.length ? (
        <div
          className="max-h-64 overflow-y-auto rounded border text-[11px]"
          style={{ borderColor: 'var(--line-2)', background: 'var(--panel-2)' }}
        >
          {rows.map((r) => (
            <label
              key={r.token}
              className="flex cursor-pointer items-center gap-2 border-b px-2 py-1"
              style={{ borderColor: 'var(--line)' }}
            >
              <input type="checkbox" checked={picked.includes(r.token)} onChange={(e) => toggle(r.token, e.target.checked)} />
              <span className="w-[160px] shrink-0 truncate font-medium">{r.token}</span>
              <span className="min-w-0 flex-1 truncate" style={{ color: 'var(--muted)' }} title={r.series ?? ''}>
                {r.series ?? '—'}
              </span>
              {r.seriesSize >= 3 ? (
                <Badge tone="accent">
                  {t('settings.learnSeries')} · {r.seriesSize}
                </Badge>
              ) : null}
              <span className="w-[54px] shrink-0 text-right tabular-nums" style={{ color: 'var(--faint)' }}>
                {t('settings.learnFreq')} {r.hits}
              </span>
            </label>
          ))}
        </div>
      ) : null}

      <div className="text-[10px]" style={{ color: 'var(--faint)' }}>
        {t('settings.learnThresholdNote')}
      </div>
    </div>
  )
}
