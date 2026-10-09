import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { BANNER_AUTO_HIDE_MS, bannerRenderState, type BannerButton } from '../../shared/bannerState'
import { useUi } from '../stores/ui'
import { Button } from './ui'

/**
 * M6 ⑤ · 顶部横幅（第 3 份 §4.3 步骤 3 那条）。
 *
 * 和 `ModelBackfillDialog` 一样：**组件里没有判断，只有映射** ——
 * 该不该出现、什么颜色、说哪句、给几个按钮，全在 `shared/bannerState.ts` 算完。
 * 这里只剩两件事：10 秒计时器（`autoHide`）和"不是这个集合"那个下拉的开合。
 */
export function ProjectBanner(): JSX.Element | null {
  const { t } = useTranslation()
  const banner = useUi((s) => s.banner)
  const collections = useUi((s) => s.collections)
  const search = useUi((s) => s.search)
  const pin = useUi((s) => s.pinBanner)
  const dismiss = useUi((s) => s.dismissBanner)
  const choose = useUi((s) => s.bannerChoose)
  const remember = useUi((s) => s.bannerRemember)

  const [hidden, setHidden] = useState(false)
  const [pickOpen, setPickOpen] = useState(false)

  const view = useMemo(
    () =>
      bannerRenderState({
        event: banner.event,
        search,
        pinned: banner.pinned,
        ignoredProjects: banner.ignoredProjects,
        otherCollections: collections
          .filter((c) => c.id !== banner.event?.collectionId)
          .map((c) => ({ id: c.id, name: c.name }))
      }),
    [banner.event, banner.pinned, banner.ignoredProjects, collections, search]
  )

  /** 换一条横幅就重新计时；固定之后不再计时（规格："10 秒后自动淡出，可固定"） */
  const autoHide = view.shown && view.autoHide
  useEffect(() => {
    setHidden(false)
    setPickOpen(false)
    if (!view.shown || !autoHide) return
    const timer = setTimeout(() => setHidden(true), BANNER_AUTO_HIDE_MS)
    return () => clearTimeout(timer)
  }, [view.shown, autoHide, banner.event?.at])

  if (!view.shown || hidden) return null

  const button = (id: BannerButton): JSX.Element | null => {
    switch (id) {
      case 'not-this':
        return (
          <Button className="h-6 px-2 text-[11px]" onClick={() => setPickOpen((v) => !v)}>
            {t('project.bannerBtn.notThis')} {pickOpen ? '▴' : '▾'}
          </Button>
        )
      case 'switch-now':
        return (
          <Button
            variant="accent"
            className="h-6 px-2 text-[11px]"
            onClick={() => {
              const e = banner.event
              if (e?.collectionId) void choose(e.collectionId)
            }}
          >
            {t('project.bannerBtn.switchNow')}
          </Button>
        )
      case 'remember':
        return (
          <Button className="h-6 px-2 text-[11px]" onClick={() => void remember()}>
            {t('project.bannerBtn.remember')}
          </Button>
        )
      case 'choose':
        return (
          <Button className="h-6 px-2 text-[11px]" onClick={() => setPickOpen((v) => !v)}>
            {t('project.bannerBtn.choose')}
          </Button>
        )
      case 'pin':
        return banner.pinned ? null : (
          <Button className="h-6 px-2 text-[11px]" onClick={pin}>
            {t('project.bannerBtn.pin')}
          </Button>
        )
      case 'ignore':
        return (
          <Button className="h-6 px-2 text-[11px]" onClick={dismiss}>
            {t('project.bannerBtn.ignore')}
          </Button>
        )
      default:
        return null
    }
  }

  return (
    <div
      className="flex shrink-0 flex-wrap items-center gap-2 border-b px-3 py-1.5 text-[11px]"
      style={{
        borderColor: 'var(--line)',
        background: view.tone === 'warn' ? 'var(--warn-soft)' : view.tone === 'ok' ? 'var(--accent-soft)' : 'var(--panel-2)',
        color: view.tone === 'warn' ? 'var(--warn)' : 'var(--text)'
      }}
    >
      <span className="min-w-0 truncate">{t(view.titleKey, view.titleParams)}</span>
      {view.bodyKey ? (
        <span style={{ color: 'var(--muted)' }}>{t(view.bodyKey, view.bodyParams ?? {})}</span>
      ) : null}
      <div className="ml-auto flex flex-wrap items-center gap-2">{view.buttons.map((b) => <span key={b}>{button(b)}</span>)}</div>
      {pickOpen ? (
        <div className="flex w-full flex-wrap gap-1 pl-1">
          {view.choices.length ? (
            view.choices.map((c) => (
              <button
                key={c.id}
                type="button"
                className="btn btn-ghost h-6 px-2 text-[11px]"
                onClick={() => {
                  setPickOpen(false)
                  void choose(c.id)
                }}
              >
                {c.name}
              </button>
            ))
          ) : (
            <span style={{ color: 'var(--faint)' }}>{t('project.bannerNoOtherCollections')}</span>
          )}
        </div>
      ) : null}
    </div>
  )
}
