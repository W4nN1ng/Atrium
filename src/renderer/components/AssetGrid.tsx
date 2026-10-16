import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { AssetCard, CategoryConfig } from '../../shared/types'
import { dimChips } from '../../shared/variantDims'
import { reviewConfirmCount, reviewTargets, showBatchReview, showReviewAllOnScreen } from '../../shared/reviewState'
import { useUi } from '../stores/ui'
import { MergeSuggestBar } from './MergeSuggestBar'
import { Modal } from './ui'
import { fileUrl } from '../lib/format'
import { CoverBatch } from './CoverBatch'

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
  const settings = useUi((s) => s.settings)
  const selected = selection.includes(card.id)
  const focused = detailId === card.id
  /** dims 的三条判据（单值维度不显示 / 容器卡不重复数版本 / 超出要写"+N"）全在纯函数里 */
  const dimSet = dimChips(card.dims ?? [], { isBundle: card.isBundle, unitCount: card.unitCount })

  return (
    <div
      className={`card ${selected ? 'card-selected' : ''}`}
      onClick={(e) => {
        toggle(card.id, e.ctrlKey || e.metaKey || e.shiftKey)
        void openDetail(card.id)
      }}
      onDoubleClick={() => {
        /** 合集点进去是二级列表（子项 + 版本），不是单素材详情（改动单 §3） */
        if (card.isBundle) {
          setNav('bundle:' + card.id)
          return
        }
        void openDetail(card.id)
        /**
         * M5-A：双击普通素材卡按设置里的「双击行为」走。
         * `import` 现在是**真的导入**（预扫描 → 有冲突就弹确认 → 导入），
         * 不再是那句"Unity 导入在 M5 交付"。
         */
        if (settings.doubleClickAction === 'import') {
          void useUi.getState().importAsset(card.id)
        } else if (settings.doubleClickAction === 'reveal') {
          /**
           * ⚠ `AssetCard` 不带磁盘路径（只给界面看的字段），所以这里查不到。
           * 详情面板里那个「打开所在文件夹」拿的是 `DetailInfo.asset`，那条路是对的。
           * 卡片的 reveal 要么给 AssetCard 补字段、要么多跑一次 IPC ——
           * 后者是"双击打开文件夹"这个设置项该处理的事，不属于 M5-A 的导入链路，
           * 所以这里**如实说一句**，不假装做到了。
           */
          useUi.getState().toast('info', t('library.revealHint'))
        }
      }}
      title={card.rawName}
    >
      <div className="relative aspect-[4/3] w-full overflow-hidden">
        <Cover card={card} />
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
              style={{ background: 'var(--accent)', color: '#fff' }}
            >
              {card.containerKind === 'merged'
                ? t('library.containerMerged', { count: Math.max(card.unitCount, card.childCount) })
                : t('library.containerCollection', { count: card.childCount })}
            </span>
          ) : null}
          {card.needsReview && !card.isBundle ? (
            <span
              className="rounded px-1.5 py-0.5 text-[11px] font-medium"
              style={{ background: 'var(--warn)', color: '#111' }}
            >
              {t('library.bundleLowConf')}
            </span>
          ) : null}
          {card.variantCount > 1 ? (
            <span
              className="rounded px-1.5 py-0.5 text-[11px] font-medium"
              style={{ background: 'var(--accent)', color: '#fff' }}
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
  const selected = selection.includes(card.id)
  /** 列表行的"变体"列：份数 + 各维度分列（判据同 `dimChips`） */
  const rowDims: string[] = []
  if (card.variantCount > 1) rowDims.push(t('library.variants', { count: card.variantCount }))
  const rowDimSet = dimChips(card.dims ?? [], { isBundle: card.isBundle, unitCount: card.unitCount })
  for (const c of rowDimSet.chips) rowDims.push(t('library.dimChip', { label: t(c.key), count: c.count }))
  if (rowDimSet.more) rowDims.push('+' + rowDimSet.more)
  return (
    <div
      className={`flex cursor-pointer items-center gap-3 border-b px-3 py-1.5 ${detailId === card.id ? '' : ''}`}
      style={{
        borderColor: 'var(--line)',
        background: selected ? 'var(--accent-soft)' : 'transparent'
      }}
      onClick={(e) => {
        toggle(card.id, e.ctrlKey || e.metaKey || e.shiftKey)
        void openDetail(card.id)
      }}
    >
      <StatusDot status={card.status} />
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
  /** R4 ② · 框选几张卡一起导（规格 §8-4） */
  const importSelected = useUi((s) => s.importSelected)
  const importTargetName = useUi((s) => s.connection.projects.find((p) => p.projectId === s.connection.targetProjectId)?.name)
  /** 面板开着 / 正在导的时候不许再开一批（一次只跑一件事，两批并行会把撤销顺序搅乱） */
  const batchBusy = useUi((s) => s.batchImport.open || s.memberPicker.open || s.importFlow.busy || s.targetPicker.open)
  const collections = useUi((s) => s.collections)
  const addToCollection = useUi((s) => s.addToCollection)
  const [busyCollection, setBusyCollection] = useState(false)
  const nav = useUi((s) => s.nav)
  const categories = useUi((s) => s.categories)
  const locale = i18n.language as 'zh-CN' | 'en' | 'ja'
  const [hint, setHint] = useState<{ rules: number; token: string; category: string; subcategory: string | null } | null>(null)
  /** 第 9 轮 ① · 「标记已复核」的二次确认（Q2 甲：批量出口必须有确认，且要说清条数） */
  const setReview = useUi((s) => s.setReview)
  const [reviewAsk, setReviewAsk] = useState<{ ids: string[]; n: number } | null>(null)

  /**
   * 这一屏与"选中的那些"里真正会变的行。判据全在 `shared/reviewState.ts`
   * （合集卡与附属在那层就被剔掉了 —— 它们各自的复核走各自那条路，不留两个入口）。
   */
  const onReviewScreen = nav === 'review'
  const reviewable = cards.map((c) => ({ id: c.id, needsReview: c.needsReview, isBundle: c.isBundle }))
  const selectedReview = reviewTargets(reviewable.filter((c) => selection.includes(c.id)), 'done')
  const screenReview = reviewTargets(reviewable, 'done')

  useEffect(() => {
    if (nav !== 'review') {
      setHint(null)
      return
    }
    void window.a.assets.learnedHint().then(setHint).catch(() => setHint(null))
  }, [nav, cards])

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
        <div className="ml-auto flex items-center gap-2">
          {selection.length ? <CoverBatch assetIds={selection} /> : null}
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
          {/*
            多选批量导入（R4 ②，规格 §8-4）。
            只在选了两张以上时出现：单张卡走双击/Enter 那条老路，
            这里再摆一个按钮就是两个入口两套说法。
          */}
          {selection.length > 1 ? (
            <button
              type="button"
              className="btn btn-accent px-2 py-0.5"
              disabled={batchBusy}
              onClick={() => void importSelected()}
              title={t('library.batchImportHint')}
            >
              {importTargetName ? t('library.batchImportToProject', { count: selection.length, name: importTargetName }) : t('library.batchImport', { count: selection.length })}
            </button>
          ) : null}
          {/*
            第 9 轮 ① · 待复核的批量出口（A2）。
            59 条待复核里绝大多数是单卡，而原来唯一那颗"标记已复核"长在合集详情里 ——
            单卡进得去出不来。这两颗只在**待复核视图**里出（判据在 shared/reviewState.ts）：
            在别的视图里也长，用户会以为"待复核"是个可以批量抹掉的过滤器，而不是要逐条看过的状态。
          */}
          {showBatchReview({ onReviewScreen, selected: selection.length, targets: selectedReview.length }) ? (
            <button
              type="button"
              className="btn px-2 py-0.5"
              onClick={() => setReviewAsk({ ids: selectedReview, n: reviewConfirmCount(selectedReview.length) })}
            >
              {t('library.markReviewedN', { count: reviewConfirmCount(selectedReview.length) })}
            </button>
          ) : null}
          {showReviewAllOnScreen({ onReviewScreen, targets: screenReview.length }) ? (
            <button
              type="button"
              className="btn btn-ghost px-2 py-0.5"
              onClick={() => setReviewAsk({ ids: screenReview, n: reviewConfirmCount(screenReview.length) })}
            >
              {t('library.reviewAllOnScreen', { count: reviewConfirmCount(screenReview.length) })}
            </button>
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

      {nav === 'review' && hint ? (
        <div
          className="shrink-0 border-b px-3 py-1 text-[11px]"
          style={{ borderColor: 'var(--line)', background: 'var(--panel-2)', color: 'var(--muted)' }}
        >
          {t('library.learnedStrip', {
            rules: hint.rules,
            token: hint.token,
            cat: labelOfCat(categories, hint.category, hint.subcategory, locale)
          })}
        </div>
      ) : null}

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

      {/*
        二次确认（Q2 甲）。条数只来自"真的会变的行数"（`reviewConfirmCount`），
        不是 `selection.length` —— 选到已经看过的卡时那两个数不一样，说错数字比不说更糟。
      */}
      <Modal
        open={!!reviewAsk}
        onOpenChange={(v) => {
          if (!v) setReviewAsk(null)
        }}
        title={t('library.reviewConfirmTitle')}
        footer={
          <>
            <button type="button" className="btn px-3 py-1" onClick={() => setReviewAsk(null)}>
              {t('common.cancel')}
            </button>
            <button
              type="button"
              className="btn btn-accent px-3 py-1"
              onClick={() => {
                const a = reviewAsk
                setReviewAsk(null)
                if (a) void setReview(a.ids, false)
              }}
            >
              {t('library.reviewConfirmOk')}
            </button>
          </>
        }
      >
        <div className="text-[12px] leading-relaxed" style={{ color: 'var(--muted)' }}>
          {t('library.reviewConfirmBody', { count: reviewAsk?.n ?? 0 })}
        </div>
      </Modal>
    </div>
  )
}
