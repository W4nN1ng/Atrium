import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { MergeSuggestionView } from '../../shared/api'
import { useUi } from '../stores/ui'
import { Button } from './ui'

/**
 * §B5 同前缀建议合并的那条横幅。
 *
 * 三个按钮就是规格画的那三个：合并并进入 / 查看这几个 / 不再提示。
 * **默认不动手** —— 只有点了第一个才真的建容器，因为 Mint/Plum/Chocolate
 * 到底是配色还是不同产品，程序判不了（05 §B5 原话："可能真是不同产品"）。
 *
 * 合并完直接进容器视图，用户能立刻看见自己刚并出来的东西长什么样；
 * 不满意点「解散分组」就退回去，整批写 journal，Ctrl+Z 也能撤。
 */
export function MergeSuggestBar(): JSX.Element | null {
  const { t } = useTranslation()
  const toast = useUi((s) => s.toast)
  const setNav = useUi((s) => s.setNav)
  const refreshMeta = useUi((s) => s.refreshMeta)
  const [list, setList] = useState<MergeSuggestionView[]>([])
  const [busy, setBusy] = useState(false)

  const reload = useCallback(async () => {
    try {
      setList(await window.a.assets.mergeSuggestions())
    } catch {
      setList([])
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  // 库变了（入库/撤销/解散）之后重扫一次，不然横幅上的数字会一直停在旧值
  useEffect(() => {
    return window.a.on('data:changed', () => void reload())
  }, [reload])

  if (!list.length) return null
  const s = list[0]

  async function merge(): Promise<void> {
    setBusy(true)
    try {
      const r = await window.a.assets.mergeApply({ assetIds: s.assetIds, name: s.head })
      toast('ok', t('library.mergeDone', { count: r.moved }))
      await refreshMeta()
      setNav('bundle:' + r.containerId)
    } catch (e) {
      toast('bad', e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  async function dismiss(): Promise<void> {
    try {
      await window.a.assets.mergeDismiss(s.head)
      await reload()
    } catch (e) {
      toast('bad', e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <div
      className="flex shrink-0 flex-wrap items-center gap-2 border-b px-3 py-1.5 text-[12px]"
      style={{ borderColor: 'var(--line)', background: 'var(--accent-soft)' }}
    >
      <span className="min-w-0 flex-1 truncate">
        {t('library.mergeSuggest', { name: s.head, count: s.assetIds.length })}
        {s.dirLabel ? <span style={{ color: 'var(--faint)' }}> · {s.dirLabel}</span> : null}
      </span>
      <Button variant="accent" disabled={busy} onClick={() => void merge()}>
        {t('library.mergeDo')}
      </Button>
      <Button
        disabled={busy}
        onClick={() => {
          // 「查看这几个」= 用首词当搜索词，让外层列表只剩它们；不新建视图，也不动别的筛选
          useUi.getState().setSearch(s.head)
        }}
      >
        {t('library.mergeView', { count: s.assetIds.length })}
      </Button>
      <Button variant="ghost" disabled={busy} onClick={() => void dismiss()}>
        {t('library.mergeNever')}
      </Button>
      {list.length > 1 ? (
        <span className="text-[11px]" style={{ color: 'var(--muted)' }}>
          +{list.length - 1}
        </span>
      ) : null}
    </div>
  )
}
