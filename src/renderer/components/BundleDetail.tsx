import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { BundleView } from '../../shared/api'
import type { AssetRow, AttachmentKind, CategoryConfig, LocaleKey } from '../../shared/types'
import { modelNamesFromVariantRaw } from '../../shared/naming'
import { humanBytes } from '../lib/format'
import { msg } from '../lib/msg'
import { useUi } from '../stores/ui'
import { Badge, Button, Select } from './ui'
import { CoverEditor } from './CoverEditor'
import { CoverBatch } from './CoverBatch'

/** 分类下拉的选项（和收件箱、详情面板一个口径） */
function catOptions(config: CategoryConfig | null, locale: LocaleKey): Array<{ value: string; label: string }> {
  return (config?.categories ?? []).map((c) => ({ value: c.key, label: c.label[locale] ?? c.label['zh-CN'] }))
}

function subOptions(config: CategoryConfig | null, cat: string, locale: LocaleKey): Array<{ value: string; label: string }> {
  const c = config?.categories.find((x) => x.key === cat)
  return [{ value: '', label: '-' }, ...(c?.subcategories ?? []).map((s) => ({ value: s.key, label: s.label[locale] ?? s.label['zh-CN'] }))]
}

function labelOf(config: CategoryConfig | null, cat: string, sub: string | null, locale: LocaleKey): string {
  const c = config?.categories.find((x) => x.key === cat)
  const cl = c ? c.label[locale] ?? c.label['zh-CN'] : cat
  if (!sub) return cl
  const s = c?.subcategories.find((x) => x.key === sub)
  return cl + ' / ' + (s ? s.label[locale] ?? s.label['zh-CN'] : sub)
}

/**
 * 容器里的一行。
 *
 * **有 ≥2 个版本时按版本铺平**，否则一行就是子项自己 ——
 * 20 个 Libero 在库里是「1 个容器 → 1 个子项 → 20 个版本」，
 * 但用户要看到的是 20 行（05 §B6 的示意图就是这么画的），不是 1 行点开再数 20 个。
 */
interface Row {
  id: string
  itemId: string
  label: string
  rawName: string
  models: string[]
  version: string | null
  category: string
  subcategory: string | null
  sizeBytes: number
  needsReview: boolean
  isVersion: boolean
}

const ATTACH_SECTIONS: AttachmentKind[] = ['image', 'video', 'doc', 'link', 'source', 'audio']

/**
 * 附属资源分区的标题。**必须是写死的 key，不许拼字符串** ——
 * i18n 守卫测试（tests/renderer/i18n.spec.ts）扫的就是这个，
 * 拼出来的 key 在语言文件里查不到，界面上会直接显示 `library.attImage` 这种鬼东西。
 */
const ATTACH_LABEL_KEY: Record<AttachmentKind, string> = {
  image: 'library.attImage',
  video: 'library.attVideo',
  doc: 'library.attDoc',
  link: 'library.attLink',
  source: 'library.attSource',
  audio: 'library.attAudio'
}

function rowsOf(view: BundleView): Row[] {
  const out: Row[] = []
  for (const { item, versions } of view.items) {
    const useVersions = versions.length > 1
    const list = useVersions ? versions : [item]
    for (const r of list) {
      out.push({
        id: r.id,
        itemId: item.id,
        label: useVersions ? r.raw_name.replace(/\.[A-Za-z0-9]+$/, '') : r.name,
        rawName: r.raw_name,
        models: modelNamesFromVariantRaw(r.variant_raw),
        version: r.version,
        category: r.category,
        subcategory: r.subcategory,
        sizeBytes: r.size_bytes ?? 0,
        needsReview: Number(r.needs_review) === 1,
        isVersion: useVersions
      })
    }
  }
  return out
}

/**
 * 容器内部视图（增量改动单 2 §B6）。
 *
 * 这是**页面切换，不是弹窗** —— 用户要的是"像文件夹那样双击进去"。
 * 三条硬规矩：
 *  - 面包屑可点、Esc 也能返回上一级；
 *  - Ctrl+A 全选、Enter 导入选中项；
 *  - 进来时**不清空**用户在外面的搜索框和筛选（05「不要做的事」#7），
 *    容器内自己的搜索/筛选是独立的一套 state，出去就丢。
 *
 * 合集型和归并型共用这一个组件（§B7）：只有标题旁边那行字不同。
 */
export function BundleDetail({ bundleId }: { bundleId: string }): JSX.Element {
  const { t, i18n } = useTranslation()
  const locale = i18n.language as LocaleKey
  const config = useUi((s) => s.categories)
  const toast = useUi((s) => s.toast)
  const openMemberPicker = useUi((s) => s.openMemberPicker)
  /** 第 10 轮 B：容器里每一行也是素材卡，那颗「导入」必须走和外面网格同一条路 */
  const importAsset = useUi((s) => s.importAsset)
  const openDetail = useUi((s) => s.openDetail)
  const pickAllMembers = useUi((s) => s.pickAllMembers)
  const settings = useUi((s) => s.settings)
  const setNav = useUi((s) => s.setNav)
  const refreshMeta = useUi((s) => s.refreshMeta)
  /** 第 9 轮 ① · 复核标记走 store 那条（它会连着刷侧栏那个数），不再直接摸 IPC */
  const setReview = useUi((s) => s.setReview)
  const [view, setView] = useState<BundleView | null>(null)
  const [missing, setMissing] = useState(false)
  const [picked, setPicked] = useState<string[]>([])
   /** 容器内的搜索与分组方式，和外层的全局搜索互不相干 */
  const [q, setQ] = useState('')
  const [mode, setMode] = useState<'all' | 'model' | 'version'>('all')
  const [modelFilter, setModelFilter] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [showAttach, setShowAttach] = useState(false)

  const reload = useCallback(async () => {
    try {
      const r = await window.a.assets.bundle(bundleId)
      setView(r)
      setMissing(!r)
    } catch (e) {
      setMissing(true)
      toast('bad', e instanceof Error ? e.message : String(e))
    }
  }, [bundleId, toast])

  useEffect(() => {
    void reload()
  }, [reload])

  const rows = useMemo(() => (view ? rowsOf(view) : []), [view])
  const allModels = useMemo(() => {
    const s = new Set<string>()
    for (const r of rows) for (const m of r.models) s.add(m)
    return Array.from(s).sort((a, b) => a.localeCompare(b))
  }, [rows])

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return rows.filter((r) => {
      if (modelFilter && !r.models.includes(modelFilter)) return false
      if (!needle) return true
      return (
        r.label.toLowerCase().includes(needle) ||
        r.rawName.toLowerCase().includes(needle) ||
        (r.version ?? '').toLowerCase().includes(needle) ||
        r.models.some((m) => m.toLowerCase().includes(needle))
      )
    })
  }, [rows, q, modelFilter])

  /** 按模型 / 按版本分组时的分桶顺序（'all' 不分桶） */
  const buckets = useMemo(() => {
    if (mode === 'all') return [{ key: '', rows: shown }]
    const map = new Map<string, Row[]>()
    for (const r of shown) {
      const keys = mode === 'model' ? (r.models.length ? r.models : ['—']) : [r.version ? 'v' + r.version : '—']
      for (const k of keys) {
        const list = map.get(k) ?? []
        list.push(r)
        map.set(k, list)
      }
    }
    return Array.from(map.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([key, list]) => ({ key, rows: list }))
  }, [mode, shown])

  async function patch(row: AssetRow, p: Partial<AssetRow>): Promise<void> {
    try {
      await window.a.assets.patch(row.id, p)
      await reload()
      await refreshMeta()
    } catch (e) {
      toast('bad', e instanceof Error ? e.message : String(e))
    }
  }

  async function reparent(ids: string[], parentId: string | null): Promise<void> {
    setBusy(true)
    try {
      const r = await window.a.assets.reparent(ids, parentId)
      toast('ok', t('library.bundleExtract') + ' · ' + r.moved)
      setPicked([])
      await reload()
    } catch (e) {
      toast('bad', e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  async function dissolve(): Promise<void> {
    setBusy(true)
    try {
      const r = await window.a.assets.dissolveBundle(bundleId)
      toast('ok', t('library.bundleDissolve') + ' · ' + r.released)
      setNav('all')
    } catch (e) {
      toast('bad', e instanceof Error ? e.message : String(e))
      setBusy(false)
    }
  }

  const toggle = (id: string, on: boolean): void => setPicked(on ? [...picked, id] : picked.filter((x) => x !== id))

  /** Esc 返回上一级、Ctrl+A 全选、Enter 导入 —— 都挂在这一层，焦点在搜索框里也照样生效 */
  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if ((e.target as Element | null)?.closest('[role="dialog"]')) return
      if (e.key === 'Escape') {
        e.preventDefault()
        setNav('bundles')
        return
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
        e.preventDefault()
        setPicked(shown.map((r) => r.id))
        return
      }
      /**
       * Enter = 打开成员选择面板。
       *
       * 第 10 轮之前这里是 `toast('bad', 'Unity 导入在 M5 交付')` —— 一句过期的占位话。
       * 为什么不直接导 `picked` 里那几张：面板要的是**包**（`relPath`），而这里的行是**卡**，
       * 一张卡背后可能是 1 个包也可能是 3 个版本，替他映射等于替他做决定。
       * 所以 Enter 与那颗按钮走同一个入口，勾哪个由他在面板里说。
       */
      if (e.key === 'Enter' && picked.length) {
        e.preventDefault()
        void openMemberPicker(bundleId)
        toast('info', t('library.memberAllHint'))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [setNav, shown, picked.length, toast, t, bundleId, openMemberPicker])

  if (missing) {
    return (
      <div className="flex flex-1 items-center justify-center text-[12px]" style={{ color: 'var(--muted)' }}>
        {t('common.empty')}
      </div>
    )
  }
  if (!view) return <div className="flex flex-1 items-center justify-center muted">{t('common.loading')}</div>

  const b = view.bundle
  const merged = b.container_kind === 'merged'
  /** §B7：两种容器只有这一行字不同 —— 归并型说"几个模型变体"，合集型说"含几项" */
  const subtitle = merged
    ? t('library.containerMerged', { count: rows.length })
    : t('library.containerCollection', { count: view.items.length })
  const totalBytes = rows.reduce((a, r) => a + r.sizeBytes, 0)
  const attachments = [...(view.attachments ?? []), ...view.items.flatMap((i) => i.attachments ?? [])]

  return (
    /**
     * ⚠ `min-h-0` 不是多余的：这一层是 `main`（列向 flex）里的 `flex-1` 子元素，
     * 不写 `min-h-0` 就是 `min-height:auto` —— 它会被 20 多行列表撑到内容那么高，
     * 于是下面那个 `overflow-y-auto` 永远拿不到"有下界的盒子"，
     * **滚动条不出现、滚轮按下去一点反应都没有**，最下面几行直接看不着（第 10 轮报障 2）。
     * 外面每个页面根（AssetGrid / Inbox / Collections / Project / Settings）都带着这一句，
     * 全仓就这一处漏了 —— 2026-10-10 扫过确认。
     */
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      {/* 面包屑：可点返回（§B6） */}
      <div className="flex shrink-0 items-center gap-1 border-b px-3 py-2 text-[12px]" style={{ borderColor: 'var(--line)' }}>
        <button type="button" className="btn btn-ghost px-1.5 py-0.5" onClick={() => setNav('all')}>
          {t('library.containerCrumbAll')}
        </button>
        <span style={{ color: 'var(--faint)' }}>/</span>
        <button type="button" className="btn btn-ghost px-1.5 py-0.5" onClick={() => setNav('bundles')}>
          {t('nav.bundles')}
        </button>
        <span style={{ color: 'var(--faint)' }}>/</span>
        <span className="min-w-0 truncate font-medium">{b.name}</span>
        <Badge tone={merged ? 'default' : 'accent'}>{subtitle}</Badge>
        <span className="text-[11px] tabular-nums" style={{ color: 'var(--muted)' }}>
          {humanBytes(totalBytes || b.size_bytes || 0, locale)}
        </span>
        <span className="text-[11px]" style={{ color: 'var(--faint)' }}>
          {labelOf(config, b.category, b.subcategory, locale)}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <CoverEditor assetId={b.id} name={b.name} />
          {picked.length ? <CoverBatch assetIds={picked} /> : null}
          {/*
            第 10 轮 Q3 甲：这颗以前是 `disabled` + 一句"Unity 导入在 M5 交付"。
            现在它**开面板并把包全预勾上** —— 不静默替他导 22 个包，也不再是颗假按钮。
            （预勾要在 `openMemberPicker` 拉完清单之后做，所以这里是 async 串起来。）
          */}
          <Button
            disabled={busy}
            onClick={() => {
              void (async () => {
                await openMemberPicker(bundleId)
                pickAllMembers()
              })()
            }}
          >
            {t('library.bundleImportWhole')}
          </Button>
          <Button disabled={busy} onClick={() => void dissolve()}>
            {t('library.bundleDissolve')}
          </Button>
        </div>
      </div>

      {/* 容器内自己的筛选条：搜索 + 分组方式 + 模型徽章。出去就丢，不动外层的全局搜索 */}
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b px-3 py-1.5" style={{ borderColor: 'var(--line)' }}>
        <input
          className="input h-7 w-[220px] text-[12px]"
          value={q}
          placeholder={t('library.containerSearchPh')}
          onChange={(e) => setQ(e.target.value)}
        />
        <div className="flex items-center gap-1 text-[11px]">
          {(['all', 'model', 'version'] as const).map((m) => (
            <button
              key={m}
              type="button"
              className={'btn px-2 py-0.5 ' + (mode === m ? 'btn-accent' : 'btn-ghost')}
              onClick={() => setMode(m)}
            >
              {m === 'all' ? t('library.containerFilterAll', { count: rows.length }) : m === 'model' ? t('library.containerFilterModel') : t('library.containerFilterVersion')}
            </button>
          ))}
        </div>
        {allModels.length ? (
          <div className="flex min-w-0 flex-wrap items-center gap-1">
            <span className="text-[10px]" style={{ color: 'var(--faint)' }}>
              {t('library.containerModelBadge')}
            </span>
            <button
              type="button"
              className={'chip ' + (modelFilter === null ? 'chip-accent' : '')}
              onClick={() => setModelFilter(null)}
            >
              *
            </button>
            {allModels.map((m) => (
              <button
                key={m}
                type="button"
                className={'chip ' + (modelFilter === m ? 'chip-accent' : '')}
                onClick={() => setModelFilter(modelFilter === m ? null : m)}
              >
                {m}
              </button>
            ))}
          </div>
        ) : null}
        {attachments.length ? (
          <button type="button" className="btn btn-ghost ml-auto px-2 py-0.5 text-[11px]" onClick={() => setShowAttach(!showAttach)}>
            {t('library.containerAttachments')} · {attachments.length}
          </button>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {buckets.map((bucket) => (
          <div key={bucket.key || '__all'}>
            {mode !== 'all' ? (
              <div className="sticky top-0 z-10 px-3 py-1 text-[11px] font-medium" style={{ background: 'var(--bg)', color: 'var(--muted)' }}>
                {bucket.key} · {bucket.rows.length}
              </div>
            ) : null}
            {bucket.rows.map((r) => (
              <div
                key={r.id}
                className="flex items-center gap-2 border-b px-3 py-1.5 text-[12px]"
                style={{ borderColor: 'var(--line)' }}
                /**
                 * 第 10 轮 Q1 甲：**和外面那张网格一模一样** —— 先开详情，再按设置里的
                 * 「双击行为」决定要不要导（判据在 `shared/memberPick.ts:cardImportChoice`：
                 * 单个包直接导、多个包弹成员面板，不替他挑）。
                 * 以前这里是一句过期的 `toast('bad','Unity 导入在 M5 交付')`。
                 */
                onDoubleClick={() => {
                  void openDetail(r.id)
                  if (settings.doubleClickAction === 'import') void importAsset(r.id)
                  else if (settings.doubleClickAction === 'reveal') toast('info', t('library.revealHint'))
                }}
              >
                <input type="checkbox" checked={picked.includes(r.id)} onChange={(e) => toggle(r.id, e.target.checked)} />
                <span className="min-w-0 flex-1 truncate" title={r.rawName}>
                  {r.label}
                </span>
                {/* 模型徽章：Chiffon&Chocolat 要出两个（验收 9） */}
                {r.models.map((m) => (
                  <span key={m} className="chip shrink-0">
                    {m}
                  </span>
                ))}
                {r.needsReview ? <Badge tone="warn">{t('library.bundleLowConf')}</Badge> : null}
                <span className="w-[110px] shrink-0 truncate text-[11px]" style={{ color: 'var(--muted)' }}>
                  {labelOf(config, r.category, r.subcategory, locale)}
                </span>
                <span className="w-[70px] shrink-0 text-right text-[11px] tabular-nums" style={{ color: 'var(--muted)' }}>
                  {humanBytes(r.sizeBytes, locale)}
                </span>
                {/* 第 10 轮 B：这颗以前是 disabled 的占位，现在和双击同一条路（多个包会弹面板） */}
                <Button className="shrink-0" onClick={() => void importAsset(r.id)} title={t('library.importToUnityHint')}>
                  {t('common.import')}
                </Button>
              </div>
            ))}
          </div>
        ))}

        {showAttach && attachments.length ? (
          <div className="border-t px-3 py-2" style={{ borderColor: 'var(--line)' }}>
            <div className="mb-1 text-[11px]" style={{ color: 'var(--muted)' }}>
              {t('library.containerAttachments')}
            </div>
            {ATTACH_SECTIONS.map((kind) => {
              const list = attachments.filter((a) => a.attachment_kind === kind)
              if (!list.length) return null
              return (
                <div key={kind} className="mb-1.5">
                  <div className="text-[10px]" style={{ color: 'var(--faint)' }}>
                    {t(ATTACH_LABEL_KEY[kind])} · {list.length}
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {list.map((a) => (
                      <span key={a.id} className="chip" title={a.library_path ?? a.raw_name}>
                        {a.name}
                      </span>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        ) : null}

        {/* 子项级别的分类修正：容器里某一件分错了，在这里改，不用退出去找 */}
        {view.items.length > 1 ? (
          <div className="border-t px-3 py-2" style={{ borderColor: 'var(--line)' }}>
            {view.items.map(({ item }) => (
              <div key={item.id} className="mb-1 flex items-center gap-2 text-[11px]">
                <span className="min-w-0 flex-1 truncate">{item.name}</span>
                {item.needs_review ? (
                  <Button className="shrink-0" onClick={() => void patch(item, { needs_review: 0 })}>
                    {t('library.bundleMarkReviewed')}
                  </Button>
                ) : null}
                <Select
                  className="shrink-0"
                  value={item.category}
                  onChange={(v) => void patch(item, { category: v, subcategory: null })}
                  options={catOptions(config, locale)}
                />
                <Select
                  className="shrink-0"
                  value={item.subcategory ?? ''}
                  onChange={(v) => void patch(item, { subcategory: v || null })}
                  options={subOptions(config, item.category, locale)}
                />
                <Button className="shrink-0" disabled={busy} onClick={() => void reparent([item.id], null)}>
                  {t('library.bundleExtract')}
                </Button>
              </div>
            ))}
          </div>
        ) : null}
      </div>

      <div className="flex shrink-0 items-center gap-2 border-t px-3 py-1.5 text-[11px]" style={{ borderColor: 'var(--line)' }}>
        <span style={{ color: 'var(--muted)' }}>{t('library.bundleSelected', { count: picked.length })}</span>
        <span style={{ color: 'var(--faint)' }}>{t('library.containerKeys')}</span>
        <div className="ml-auto flex gap-2">
          <Button disabled={!picked.length || busy} onClick={() => void reparent(picked, null)}>
            {t('library.bundleExtract')}
          </Button>
          {/*
            第 9 轮 ① · 这颗改走 store 那条（原来直接调 IPC），有两个原因是它原来会留死账：
            1) 不调 `refreshMeta()` → 侧栏那个数不动，用户点完了还以为没点；
            2) 只清**成员行**的标记，不清这张**合集卡自己**那行。而卡的 `needs_review`
               入库时是 `items.some(...)`（`commit.ts:540`）—— 成员全清完它仍然是 1，
               于是它留在「待复核」里，而 `singleReviewAction` 对 `isBundle` 一律不出按钮
               （不留两个入口）。两头一夹就是**进得去出不来**，正是本轮要治的那个毛病。
            这里把 `bundleId` 一起带上：勾了成员就是"这一堆我看过了"，容器那行同属一个意图。
          */}
          <Button
            disabled={!picked.length}
            onClick={() => void setReview([...picked, bundleId], false).then(() => void reload())}
          >
            {t('library.bundleMarkReviewed')}
          </Button>
          {/*
            M5-B ⑥：这里以前是个 disabled 的占位按钮（"批量选择在 M5-B 交付"）。
            现在真的能用了：打开成员选择面板，让他勾要导哪几个 ——
            **不替他挑**（面板里预勾只按名字匹配，而且会写明依据）。
          */}
          <Button
            onClick={() => {
              if (!picked.length) {
                toast('info', t('library.memberAllHint'))
              }
              void openMemberPicker(bundleId)
            }}
          >
            {t('library.bundleImportMembers')}
          </Button>
        </div>
      </div>
      <div className="shrink-0 px-3 py-1 text-[10px]" style={{ color: 'var(--faint)' }}>
        {msg('library.bundleNoMove', undefined, '合集里的文件不会被拆开移动')}
      </div>
    </div>
  )
}
