import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { AssetCard, CategoryConfig } from '../../shared/types'
import { LONG_PRESS_MS } from '../../shared/cardGesture'
import { dimChips } from '../../shared/variantDims'
import { useUi } from '../stores/ui'
import { useLongPress } from '../lib/useLongPress'
import { MergeSuggestBar } from './MergeSuggestBar'
import { Modal } from './ui'
import { fileUrl } from '../lib/format'
import { CoverTaskButton } from './CoverTasks'
import { currentCoverTaskFilter } from '../stores/coverTasks'

/** 分类 key → 当前语言的显示名（提示条要把 'clothing/outfit' 写成「服装 / 套装」） */
function labelOfCat(
  cfg: CategoryConfig | null,
  cat: string | null,
  sub: string | null,
  locale: string
): string {
  const c = cfg?.categories.find((x) => x.key === cat)
  if (!c) return cat ?? '—'
  const name = c.label[locale as keyof typeof c.label] ?? c.label['zh-CN']
  if (!sub) return name
  const sc = c.subcategories.find((x) => x.key === sub)
  return name + ' / ' + (sc ? sc.label[locale as keyof typeof sc.label] ?? sc.label['zh-CN'] : sub)
}

function StatusDot({ status }: { status: AssetCard['status'] }): JSX.Element {
  const color =
    status === 'pending_confirm'
      ? 'var(--warn)'
      : status === 'inbox'
        ? 'var(--bad)'
        : status === 'classified'
          ? 'var(--accent)'
          : 'var(--ok)'
  return <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: color }} />
}

function Cover({ card }: { card: AssetCard }): JSX.Element {
  const letter = (card.name || card.rawName || '?').trim().slice(0, 1).toUpperCase()
  const [broken, setBroken] = useState(false)
  useEffect(() => setBroken(false), [card.coverImage])
  // 'none' 是主进程写下的"这包里确实没图"，不是路径 —— 当真 URL 请求会每张卡发一次失败请求
  const hasCover = !!card.coverImage && card.coverImage !== 'none'
  const src = hasCover && !broken ? (/^[a-z]+:/i.test(card.coverImage!) ? card.coverImage! : fileUrl(card.coverImage!)) : null
  if (src) {
    return (
      <img
        src={src}
        alt=""
        className="h-full w-full object-cover"
        loading="lazy"
        /* 长按封面时不许浏览器先起一个原生图片拖拽，否则 pointerleave/移动取消都会失真 */
        draggable={false}
        onError={() => setBroken(true)}
      />
    )
  }
  return (
    <div
      className="flex h-full w-full items-center justify-center text-[28px] font-semibold"
      style={{ background: 'var(--panel-2)', color: 'var(--faint)' }}
    >
      {letter}
    </div>
  )
}

function AssetCardView({ card }: { card: AssetCard }): JSX.Element {
  const { t } = useTranslation()
  const selection = useUi((s) => s.selection)
  const detailId = useUi((s) => s.detailId)
  const toggle = useUi((s) => s.toggleSelect)
  const openDetail = useUi((s) => s.openDetail)
  const setNav = useUi((s) => s.setNav)
  const selected = selection.includes(card.id)
  const focused = detailId === card.id
  /** dims 的三条判据（单值维度不显示 / 容器卡不重复数版本 / 超出要写"+N"）全在纯函数里 */
  const dimSet = dimChips(card.dims ?? [], { isBundle: card.isBundle, unitCount: card.unitCount })
  /**
   * 2026-10-21 · 双击的第一下 click 会把多选收敛成单张，第二下甚至会清空。
   * 所以在**第一次 click（detail===1）**时就把点击前的选区存下来，双击时用它还原。
   * 不能在 dblclick 里现读 selection —— 那时已经晚了。
   */
  const pressSelection = useRef<string[]>([])
  /** 长按只对合集卡生效；普通卡连进度条都不该出现 */
  const longPress = useLongPress({
    enabled: card.isBundle,
    onFire: () => setNav('bundle:' + card.id)
  })

  return (
    <div
      className={`card ${selected ? 'card-selected' : ''}`}
      onDragStart={(e) => e.preventDefault()}
      onClick={(e) => {
        if (e.detail === 1) pressSelection.current = useUi.getState().selection
        toggle(card.id, e.ctrlKey || e.metaKey || e.shiftKey)
        void openDetail(card.id)
      }}
      onDoubleClick={(e) => {
        /** 修饰键是在改选区，不是要导 —— 不在这种时候写工程 */
        if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return
        /**
         * 双击 = 导入这张卡（2026-10-21 用户裁定）。
         * 合集这张卡的实体是里面的包：开成员面板 + 全预勾，用户确认后才导。
         */
        if (card.isBundle) {
          void useUi.getState().importWhole(card.id)
          return
        }
        const snap = pressSelection.current
        if (snap.length > 1 && snap.includes(card.id)) {
          /** 多选里双击其中一张：把选区还原成点击前那批，再走原有批量链路 */
          useUi.setState({ selection: snap })
          void useUi.getState().importSelected(snap)
          return
        }
        void openDetail(card.id)
        void useUi.getState().importAsset(card.id)
      }}
      title={card.isBundle ? `${card.rawName}\n${t('library.bundleTitleHint')}` : card.rawName}
    >
      <div className="relative aspect-[4/3] w-full overflow-hidden" {...longPress.handlers}>
        <Cover card={card} />
        {longPress.pressing ? (
          <span
            className="card-hold-bar"
            style={{ animationDuration: `${LONG_PRESS_MS}ms` }}
            aria-hidden
          />
        ) : null}
        {card.isBundle ? (
          /**
           * §B6：容器卡要**一眼看出是文件夹**，不是普通素材。
           * 右上角那个折角 + 主色底的数字徽章就是干这个的 ——
           * 用户原话是"相同的素材合成一张卡，像是文件夹那样"。
           */
          <span
            className="absolute left-0 top-0 h-0 w-0"
            style={{ borderTop: '22px solid var(--accent)', borderRight: '22px solid transparent' }}
            aria-hidden
          />
        ) : null}
        <div className="absolute right-1 top-1 flex items-center gap-1">
          {card.isBundle ? (
            <span
              className="rounded px-1.5 py-0.5 text-[11px] font-medium"
              style={{ background: 'var(--accent-strong)', color: '#fff' }}
            >
              {card.containerKind === 'merged'
                ? t('library.containerMerged', { count: Math.max(card.unitCount, card.childCount) })
                : t('library.containerCollection', { count: card.childCount })}
            </span>
          ) : null}
          {card.variantCount > 1 ? (
            <span
              className="rounded px-1.5 py-0.5 text-[11px] font-medium"
              style={{ background: 'var(--accent-strong)', color: '#fff' }}
            >
              {t('library.variants', { count: card.variantCount })}
            </span>
          ) : null}
          <span
            className="flex h-5 w-5 items-center justify-center rounded-full"
            style={{ background: 'rgba(0,0,0,.45)' }}
          >
            <StatusDot status={card.status} />
          </span>
        </div>
        {focused ? (
          <span
            className="absolute bottom-1 left-1 rounded px-1.5 py-0.5 text-[10px]"
            style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}
          >
            {t('library.editMeta')}
          </span>
        ) : null}
      </div>
      <div className="p-2">
        <div className="truncate text-[13px]" title={card.name}>
          {card.name}
        </div>
        <div className="mt-0.5 truncate text-[11px]" style={{ color: 'var(--muted)' }}>
          {card.categoryLabel}
          {card.subcategoryLabel ? ` / ${card.subcategoryLabel}` : ''}
          {card.bundleName ? ` · ${t('library.bundle')}：${card.bundleName}` : ''}
        </div>
        {card.tags.length ? (
          <div className="mt-1 flex flex-wrap gap-1">
            {card.tags.slice(0, 4).map((tag) => (
              <span key={tag} className="chip">
                {tag}
              </span>
            ))}
          </div>
        ) : null}
        {/* R4 ⑤ · 变体分列：徽章说"几份"，这一行说"这几份差在哪"（判据在 shared/variantDims.ts） */}
        {dimSet.chips.length ? (
          <div className="mt-1 flex flex-wrap items-center gap-1">
            {dimSet.chips.map((c) => (
              <span key={c.kind} className="chip" title={c.title}>
                {t('library.dimChip', { label: t(c.key), count: c.count })}
              </span>
            ))}
            {dimSet.more ? (
              <span className="chip" title={t('library.dimMoreHint', { count: dimSet.more })}>
                +{dimSet.more}
              </span>
            ) : null}
          </div>
        ) : dimSet.emptyKey ? (
          <div className="mt-1 text-[10px]" style={{ color: 'var(--faint)' }}>
            {t(dimSet.emptyKey)}
          </div>
        ) : null}
      </div>
    </div>
  )
}

function AssetRowView({ card }: { card: AssetCard }): JSX.Element {
  const { t } = useTranslation()
  const selection = useUi((s) => s.selection)
  const toggle = useUi((s) => s.toggleSelect)
  const openDetail = useUi((s) => s.openDetail)
  const detailId = useUi((s) => s.detailId)
  const setNav = useUi((s) => s.setNav)
  const selected = selection.includes(card.id)
  /** 列表行与网格卡共用同一套手势；第一下 click 前存快照，供双击多选导入还原 */
  const pressSelection = useRef<string[]>([])
  const longPress = useLongPress({
    enabled: card.isBundle,
    onFire: () => setNav('bundle:' + card.id)
  })
  /** 列表行的"变体"列：份数 + 各维度分列（判据同 `dimChips`） */
  const rowDims: string[] = []
  if (card.variantCount > 1) rowDims.push(t('library.variants', { count: card.variantCount }))
  const rowDimSet = dimChips(card.dims ?? [], { isBundle: card.isBundle, unitCount: card.unitCount })
  for (const c of rowDimSet.chips) rowDims.push(t('library.dimChip', { label: t(c.key), count: c.count }))
  if (rowDimSet.more) rowDims.push('+' + rowDimSet.more)
  return (
    <div
      className={`relative flex cursor-pointer items-center gap-3 border-b px-3 py-1.5 ${detailId === card.id ? '' : ''}`}
      style={{
        borderColor: 'var(--line)',
        background: selected ? 'var(--accent-soft)' : 'transparent'
      }}
      onDragStart={(e) => e.preventDefault()}
      {...longPress.handlers}
      onClick={(e) => {
        if (e.detail === 1) pressSelection.current = useUi.getState().selection
        toggle(card.id, e.ctrlKey || e.metaKey || e.shiftKey)
        void openDetail(card.id)
      }}
      onDoubleClick={(e) => {
        if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return
        if (card.isBundle) {
          void useUi.getState().importWhole(card.id)
          return
        }
        const snap = pressSelection.current
        if (snap.length > 1 && snap.includes(card.id)) {
          useUi.setState({ selection: snap })
          void useUi.getState().importSelected(snap)
          return
        }
        void openDetail(card.id)
        void useUi.getState().importAsset(card.id)
      }}
      title={card.isBundle ? `${card.rawName}\n${t('library.bundleTitleHint')}` : card.rawName}
    >
      {longPress.pressing ? (
        <span
          className="card-hold-bar"
          style={{ animationDuration: `${LONG_PRESS_MS}ms` }}
          aria-hidden
        />
      ) : null}
      <StatusDot status={card.status} />
      {card.isBundle ? (
        <span className="chip chip-accent shrink-0">{t('library.bundle')}</span>
      ) : null}
      <span className="w-[280px] truncate text-[13px]">{card.name}</span>
      <span className="w-[150px] truncate text-[11px]" style={{ color: 'var(--muted)' }}>
        {card.categoryLabel}
        {card.subcategoryLabel ? ` / ${card.subcategoryLabel}` : ''}
      </span>
      {/*
        R4 ⑤ · 列表视图里"变体"这一列以前只有一个「N 变体」，
        而 11 个体型和 3 个版本 × 4 个语言在界面上长得一模一样。
        现在按维度分列：`2 变体 · 适配模型 ×2 · 版本 ×2`（沙盒活体实测的写法）。
        没有维度信息时（单件素材）退回「—」，不许显示成空白 ——
        空白会让人以为这列坏了，而不是"这件没有变体"。
      */}
      <span className="w-[220px] truncate text-[11px]" style={{ color: 'var(--muted)' }} title={rowDims.join(' · ')}>
        {rowDims.length ? rowDims.join(' · ') : '—'}
      </span>
      <span className="flex-1 truncate text-[11px]" style={{ color: 'var(--faint)' }} title={card.rawName}>
        {card.rawName}
      </span>
    </div>
  )
}

export function AssetGrid(): JSX.Element {
  const { t, i18n } = useTranslation()
  const cards = useUi((s) => s.cards)
  const layout = useUi((s) => s.layout)
  const setLayout = useUi((s) => s.setLayout)
  const view = useUi((s) => s.view)
  const setView = useUi((s) => s.setView)
  const selection = useUi((s) => s.selection)
  const trashSelected = useUi((s) => s.trashSelected)
  const undoLast = useUi((s) => s.undoLast)
  const collections = useUi((s) => s.collections)
  const addToCollection = useUi((s) => s.addToCollection)
  const [busyCollection, setBusyCollection] = useState(false)
  const nav = useUi((s) => s.nav)
  const search = useUi((s) => s.search)
  const categories = useUi((s) => s.categories)
  const locale = i18n.language as 'zh-CN' | 'en' | 'ja'

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        className="flex shrink-0 items-center gap-2 border-b px-3 py-1.5 text-[11px]"
        style={{ borderColor: 'var(--line)', color: 'var(--muted)' }}
      >
        <button type="button" className="btn btn-ghost px-2 py-0.5" onClick={() => setLayout(layout === 'grid' ? 'list' : 'grid')}>
          {layout === 'grid' ? t('library.list') : t('library.grid')}
        </button>
        <button type="button" className="btn btn-ghost px-2 py-0.5" onClick={() => setView(view === 'grouped' ? 'flat' : 'grouped')}>
          {view === 'grouped' ? t('library.flat') : t('library.grouped')}
        </button>
        {selection.length ? (
          <span className="chip chip-accent">{t('library.selected', { count: selection.length })}</span>
        ) : null}
        {/* 多选没有工具栏批量按钮了：唯一鼠标入口是双击其中一张，所以必须就地说出来 */}
        {selection.length > 1 ? (
          <span className="text-[11px]" style={{ color: 'var(--faint)' }}>
            {t('library.batchGestureHint', { count: selection.length })}
          </span>
        ) : null}
        <div className="ml-auto flex items-center gap-2">
          <CoverTaskButton assetIds={selection} filter={currentCoverTaskFilter({ nav, search, view })} />
          {/* 选中的东西能一键收进集合：集合页只管集合本身，成员得在这儿加 */}
          {selection.length && collections.length ? (
            <select
              className="input px-1 py-0.5 text-[11px]"
              style={{ width: 130 }}
              value=""
              disabled={busyCollection}
              onChange={(e) => {
                const id = e.target.value
                if (!id) return
                setBusyCollection(true)
                void addToCollection(id).finally(() => setBusyCollection(false))
              }}
            >
              <option value="">{t('collections.addTo')}</option>
              {collections.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          ) : null}
          <button type="button" className="btn px-2 py-0.5" onClick={() => void undoLast()} title="Ctrl+Z">
            {t('common.undo')}
          </button>
          <button
            type="button"
            className="btn px-2 py-0.5"
            disabled={!selection.length}
            onClick={() => void trashSelected()}
            title="Delete"
          >
            {t('common.trash')}
          </button>
        </div>
      </div>

      {/* §B5 同前缀建议合并的横幅：只在「全部素材 / 合集」这类浏览视图里出，收件箱里别打扰 */}
      {nav === 'all' || nav === 'bundles' || nav.startsWith('cat:') ? <MergeSuggestBar /> : null}

      {cards.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
          <div className="text-[15px]">{t('library.emptyTitle')}</div>
          <div className="max-w-md text-[12px] leading-relaxed" style={{ color: 'var(--muted)' }}>
            {t('library.emptyHint')}
          </div>
        </div>
      ) : layout === 'grid' ? (
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(168px, 1fr))' }}>
            {cards.map((c) => (
              <AssetCardView key={c.id} card={c} />
            ))}
          </div>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto">
          {cards.map((c) => (
            <AssetRowView key={c.id} card={c} />
          ))}
        </div>
      )}
    </div>
  )
}
