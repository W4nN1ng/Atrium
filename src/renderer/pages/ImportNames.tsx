import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ImportNameEntry } from '../../shared/importNames'
import { Button, EmptyState } from '../components/ui'
import { errorText } from '../lib/msg'

/**
 * 导入历史：**只回答一件事** —— 这个素材导进 Unity 以后叫什么。
 *
 * 用户反馈的原话：素材叫"糖果"，进工程以后变成 `Assets/shinano Candy/`，
 * 于是"哪个文件夹是哪个素材导进去的"完全分不清。
 *
 * 所以这一页只有两块：一个只读列表 + 一个清空按钮。
 * 不做搜索/筛选/跳转/重新导入/撤销（撤销在项目页那个"⋯ → 导入记录"里，别重复）。
 */
export function ImportNames(): JSX.Element {
  const { t } = useTranslation()
  const [rows, setRows] = useState<ImportNameEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  /** 「清空」点第一下变成「确认清空？」，3 秒不点就自己变回去 —— 比弹窗轻，又不至于误点 */
  const [confirming, setConfirming] = useState(false)
  const confirmTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const load = useCallback(async (): Promise<void> => {
    try {
      setRows(await window.a.uiPrefs.importNames())
    } catch (cause) {
      setError(errorText(cause))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
    return () => {
      if (confirmTimer.current) clearTimeout(confirmTimer.current)
    }
  }, [load])

  const armClear = (): void => {
    if (confirming) {
      if (confirmTimer.current) clearTimeout(confirmTimer.current)
      setConfirming(false)
      void window.a.uiPrefs
        .importNamesClear()
        .then(setRows)
        .catch((cause: unknown) => setError(errorText(cause)))
      return
    }
    setConfirming(true)
    if (confirmTimer.current) clearTimeout(confirmTimer.current)
    confirmTimer.current = setTimeout(() => setConfirming(false), 3000)
  }

  return (
    <div className="flex h-full min-h-0 flex-col" data-page="import-names">
      <div className="flex shrink-0 items-center gap-2 border-b px-3 py-2" style={{ borderColor: 'var(--line)' }}>
        <span className="text-[15px] font-medium">{t('nav.importNames')}</span>
        <span className="text-[11px]" style={{ color: 'var(--faint)' }}>
          {t('importNames.count', { count: rows.length })}
        </span>
        <div className="ml-auto">
          <Button variant="ghost" onClick={armClear} disabled={!rows.length} title={t('importNames.clearHint')}>
            {confirming ? t('importNames.clearConfirm') : t('importNames.clear')}
          </Button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {error ? (
          <div className="mb-2 rounded border px-3 py-2 text-[11px]" style={{ borderColor: 'var(--bad)', color: 'var(--bad)' }}>
            {error}
          </div>
        ) : null}

        {loading ? null : rows.length ? (
          <div className="rounded border" style={{ borderColor: 'var(--line)' }}>
            {rows.map((row) => (
              <div
                key={row.id}
                className="border-b px-3 py-2.5 last:border-b-0"
                style={{ borderColor: 'var(--line)' }}
                data-import-name={row.id}
              >
                <div className="flex flex-wrap items-baseline gap-2 text-[13px]">
                  <span className="truncate" style={{ color: 'var(--muted)' }}>
                    {row.assetName}
                  </span>
                  <span style={{ color: 'var(--faint)' }}>→</span>
                  <span className="truncate font-medium">{row.names.join('、')}</span>
                </div>
                <div className="mt-0.5 text-[11px]" style={{ color: 'var(--faint)' }}>
                  {[row.projectName, formatWhen(row.at, t('importNames.today'), t('importNames.yesterday'))]
                    .filter(Boolean)
                    .join(' · ')}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState title={t('importNames.empty')} hint={t('importNames.emptyHint')} />
        )}
      </div>
    </div>
  )
}

/** `今天 19:32` / `昨天 09:03` / `10-22 14:10`；0 时间戳（脏数据）直接留空 */
function formatWhen(at: number, today: string, yesterday: string): string {
  if (!at) return ''
  const d = new Date(at)
  if (Number.isNaN(d.getTime())) return ''
  const time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  const now = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const day = 24 * 60 * 60 * 1000
  if (at >= startOfToday) return `${today} ${time}`
  if (at >= startOfToday - day) return `${yesterday} ${time}`
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${mm}-${dd} ${time}`
}
