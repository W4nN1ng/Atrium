import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { LocaleKey } from '../../shared/types'
import type { ProjectConnection } from '../../shared/unityConnection'
import { needsLibrarySetup } from '../../shared/wizardState'
import { useUi } from '../stores/ui'
import { humanNumber } from '../lib/format'
import { Badge, Button, Modal, Tip } from './ui'
import { ConnectionBadge, connectionText } from './ImportTargetPicker'

const QUICK: Array<{ key: string; labelKey: string }> = [
  { key: 'inbox', labelKey: 'nav.inbox' },
  { key: 'recent', labelKey: 'nav.recent' },
  { key: 'all', labelKey: 'nav.allAssets' },
  /** 合集单独一个入口（改动单 §3）；库里它是一张卡，这里给个直达列表 */
  { key: 'bundles', labelKey: 'nav.bundles' }
]

export function TopBar(): JSX.Element {
  const { t, i18n } = useTranslation()
  const search = useUi((s) => s.search)
  const setSearch = useUi((s) => s.setSearch)
  const unity = useUi((s) => s.unity)
  const connection = useUi((s) => s.connection)
  const projects = useUi((s) => s.projects)
  const refreshProjects = useUi((s) => s.refreshProjects)
  const setUnityTarget = useUi((s) => s.setUnityTarget)
  const setNav = useUi((s) => s.setNav)
  const info = useUi((s) => s.info)
  const inputRef = useRef<HTMLInputElement>(null)
  const [pickerOpen, setPickerOpen] = useState(false)

  /** 首次挂载就把工程列表拉好，否则切换器一开始是空的 */
  useEffect(() => {
    void refreshProjects()
  }, [refreshProjects])

  /** 点别处收起下拉 */
  useEffect(() => {
    if (!pickerOpen) return
    const onDown = (e: MouseEvent): void => {
      const el = e.target as HTMLElement | null
      if (el?.closest('[data-project-picker]')) return
      setPickerOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [pickerOpen])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        inputRef.current?.focus()
        inputRef.current?.select()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const target = connection.projects.find((p) => p.projectId === connection.targetProjectId) ?? null
  const running = connection.projects.filter((p) => projects.some((project) => project.id === p.projectId && project.running))
  const dot = target?.phase === 'ready' ? 'var(--ok)' : target?.phase === 'failed' ? 'var(--bad)' : target?.phase === 'installing' || target?.phase === 'connecting' ? 'var(--warn)' : 'var(--faint)'

  function pick(p: ProjectConnection): void {
    setPickerOpen(false)
    void setUnityTarget(p.projectId)
  }

  return (
    <header
      className="drag flex h-[38px] shrink-0 items-center gap-3 border-b px-3"
      style={{ borderColor: 'var(--line)', background: 'var(--panel)' }}
    >
      <div className="flex items-center gap-2">
        <span
          className="flex h-[18px] w-[18px] items-center justify-center rounded-[4px] text-[11px] font-bold"
          style={{ background: 'var(--text)', color: 'var(--bg)' }}
        >
          A
        </span>
        <span className="text-[13px] font-medium">{t('common.appName')}</span>
      </div>

      <div className="nodrag ml-2 w-[420px]">
        <input
          ref={inputRef}
          className="input"
          placeholder={`${t('common.searchPlaceholder')}  (Ctrl+K)`}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div className="ml-auto flex items-center gap-2 pr-[140px]">
        {/* 导入目标切换器（§4.3 步骤 4）：选中的工程就是导入目标 */}
        <div className="relative nodrag" data-project-picker>
          <Tip
            label={
              target
                ? `${target.projectPath}\n${connectionText(t, target.phase)}`
                : connection.ambiguous ? t('project.chooseImportTarget') : t('project.openUnityHint')
            }
          >
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => {
                setPickerOpen((v) => !v)
                if (!pickerOpen) void refreshProjects()
              }}
            >
              <span className="h-2 w-2 rounded-full" style={{ background: dot }} />
              <span className="muted max-w-[190px] truncate">
                {t('project.target')}：{target?.name ?? t('project.noTarget')}
              </span>
              {target ? <ConnectionBadge phase={target.phase} /> : null}
              {unity.isPlaying ? <Badge tone="warn">Play</Badge> : null}
              {unity.isCompiling ? <Badge tone="warn">{t('project.compiling')}</Badge> : null}
              {unity.queueLength > 0 ? <Badge tone="accent">{t('project.queued', { count: unity.queueLength })}</Badge> : null}
            </button>
          </Tip>

          {pickerOpen ? (
            <div
              className="absolute right-0 top-[30px] z-30 max-h-[320px] w-[330px] overflow-y-auto rounded border shadow-lg"
              style={{ borderColor: 'var(--line-2)', background: 'var(--panel)' }}
            >
              {running.length === 0 ? (
                <div className="px-3 py-2 text-[11px]" style={{ color: 'var(--muted)' }}>
                  {t('project.openUnityHint')}
                </div>
              ) : (
                running.map((p) => (
                  <button
                    key={p.projectId}
                    type="button"
                    data-project-target={p.projectId}
                    disabled={p.phase === 'unsupported' || p.phase === 'disabled' || p.reasonKey === 'project.connectionUnsafe'}
                    className="flex w-full items-center gap-2 border-b px-3 py-2 text-left"
                    style={{
                      borderColor: 'var(--line)',
                      background: p.projectId === connection.targetProjectId ? 'var(--accent-soft)' : 'transparent'
                    }}
                    onClick={() => pick(p)}
                  >
                    <span
                      className="h-2 w-2 shrink-0 rounded-full"
                      style={{ background: p.phase === 'ready' ? 'var(--ok)' : p.phase === 'failed' ? 'var(--bad)' : 'var(--warn)' }}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12px]">{p.name}</span>
                      <span className="block truncate text-[10px]" style={{ color: 'var(--faint)' }}>
                        {p.projectPath}
                      </span>
                    </span>
                    <ConnectionBadge phase={p.phase} />
                  </button>
                ))
              )}
              <button
                type="button"
                className="w-full px-3 py-2 text-left text-[11px]"
                style={{ color: 'var(--muted)' }}
                onClick={() => {
                  setPickerOpen(false)
                  setNav('project')
                }}
              >
                {t('project.manage')}
              </button>
            </div>
          ) : null}
        </div>

        <Tip label={`${t('common.appName')} ${i18n.language}`}>
          <span className="nodrag">
            {info?.version ? <Badge>{`v${info.version}`}</Badge> : null}
          </span>
        </Tip>
      </div>
    </header>
  )
}

export function Sidebar(): JSX.Element {
  const { t } = useTranslation()
  const nav = useUi((s) => s.nav)
  const setNav = useUi((s) => s.setNav)
  const stats = useUi((s) => s.stats)
  const categories = useUi((s) => s.categories)
  const collections = useUi((s) => s.collections)
  const openModelBackfill = useUi((s) => s.openModelBackfill)
  const settings = useUi((s) => s.settings)
  const reopenWizard = useUi((s) => s.reopenWizard)
  const createCollection = useUi((s) => s.patchSettings)
  const [newOpen, setNewOpen] = useState(false)
  const [name, setName] = useState('')

  const locale = settings.language as LocaleKey

  async function submitNew(): Promise<void> {
    const trimmed = name.trim()
    if (!trimmed) return
    try {
      const row = await window.a.collections.create({ name: trimmed })
      setNewOpen(false)
      setName('')
      await useUi.getState().refreshMeta()
      setNav('col:' + row.id)
    } catch (e) {
      useUi.getState().toast('bad', e instanceof Error ? e.message : String(e))
    }
    void createCollection
  }

  const count = (key: string): number | null => {
    if (!stats) return null
    if (key === 'inbox') return stats.inbox
    if (key === 'bundles') return stats.bundles ?? 0
    if (key === 'pending') return stats.pendingConfirm
    return null
  }

  return (
    <aside
      className="flex w-[224px] shrink-0 flex-col gap-4 overflow-y-auto border-r p-2"
      style={{ borderColor: 'var(--line)', background: 'var(--panel)' }}
    >
      <nav className="flex flex-col">
        {QUICK.map((q) => {
          const c = count(q.key)
          return (
            <button
              key={q.key}
              type="button"
              className={`nav-item ${nav === q.key ? 'nav-active' : ''}`}
              onClick={() => setNav(q.key)}
            >
              <span className="flex-1 truncate">{t(q.labelKey)}</span>
              {c !== null && c > 0 ? <Badge tone="default">{c}</Badge> : null}
            </button>
          )
        })}
      </nav>

      <section>
        <div className="mb-1 flex items-center justify-between px-2">
          <button
            type="button"
            className={`label hover:underline ${nav === 'collections' ? 'nav-active' : ''}`}
            onClick={() => setNav('collections')}
          >
            {t('nav.collections')}
          </button>
          <button type="button" className="btn btn-ghost px-1 py-0 text-[11px]" onClick={() => setNewOpen(true)}>
            + {t('nav.newCollection')}
          </button>
        </div>
        {/*
          补建的入口。**不塞进上面那一行**：侧栏只有 224px，三个中文按钮并排会挤成
          "集 合 / 新建集 合 / 按库里出现过的模 型补建" 那种断字（沙盒活体截图里就是这个样子）。
          空集合时它是一条显眼的主按钮 + 一句为什么需要它；有集合之后降成一行小按钮，还在老位置下面。
        */}
        {collections.length ? (
          <button
            type="button"
            className="nav-item text-left text-[11px]"
            style={{ color: 'var(--muted)' }}
            title={t('collections.backfillHint')}
            onClick={() => void openModelBackfill()}
          >
            {t('collections.backfillCta')}
          </button>
        ) : null}
        <div className="flex flex-col">
          {collections.length === 0 ? (
            /**
             * M6 ④：这是自动切换的**第一入口** —— 一个集合都没有时，
             * "打开 Unity 自动切到对应集合"永远不可能发生（没有可切的），
             * 所以空状态不给一句"这里还什么都没有"就完事，直接给按钮。
             */
            <div className="px-2 py-1">
              <button type="button" className="btn btn-accent w-full text-[11px]" onClick={() => void openModelBackfill()}>
                {t('collections.backfillCta')}
              </button>
              <div className="faint mt-1 text-[10px]">{t('collections.backfillEmptyHint')}</div>
            </div>
          ) : (
            collections.map((c) => (
              <button
                key={c.id}
                type="button"
                className={`nav-item ${nav === 'col:' + c.id ? 'nav-active' : ''}`}
                onClick={() => setNav('col:' + c.id)}
              >
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: 'var(--accent)' }} />
                <span className="flex-1 truncate">{c.name}</span>
              </button>
            ))
          )}
        </div>
      </section>

      <section>
        <div className="mb-1 px-2 label">{t('nav.categories')}</div>
        <div className="flex flex-col">
          {(categories?.categories ?? [])
            .slice()
            .sort((a, b) => a.order - b.order)
            .map((c) => (
              <button
                key={c.key}
                type="button"
                className={`nav-item ${nav === 'cat:' + c.key ? 'nav-active' : ''}`}
                onClick={() => setNav('cat:' + c.key)}
              >
                <span className="flex-1 truncate">{c.label[locale] ?? c.label['zh-CN']}</span>
              </button>
            ))}
        </div>
      </section>

      <div className="mt-auto flex flex-col gap-1">
        {/*
          M7 · 「稍后配置」留下的口子。跳过向导之后不再拦人，但库根还是空的 ——
          这时候拖什么都只会拿到一句报错，所以入口必须一直看得见（判据 `needsLibrarySetup`）。
        */}
        {needsLibrarySetup(settings.libraryRoot) ? (
          <button
            type="button"
            className="nav-item"
            style={{ color: 'var(--warn)', border: '1px dashed var(--warn)' }}
            onClick={() => void reopenWizard()}
          >
            {t('library.setupNeeded')}
          </button>
        ) : null}
        <button type="button" className={`nav-item ${nav === 'project' ? 'nav-active' : ''}`} onClick={() => setNav('project')}>
          {t('nav.project')}
        </button>
        <button type="button" className={`nav-item ${nav === 'settings' ? 'nav-active' : ''}`} onClick={() => setNav('settings')}>
          {t('nav.settings')}
        </button>
      </div>

      <Modal
        open={newOpen}
        onOpenChange={setNewOpen}
        title={t('nav.newCollection')}
        footer={
          <>
            <Button onClick={() => setNewOpen(false)}>{t('common.cancel')}</Button>
            <Button variant="accent" onClick={() => void submitNew()}>
              {t('common.confirm')}
            </Button>
          </>
        }
      >
        <div className="py-2">
          <input
            className="input"
            autoFocus
            placeholder={t('nav.collectionName')}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void submitNew()
            }}
          />
        </div>
      </Modal>
    </aside>
  )
}

export function StatusBar({ dropActive }: { dropActive: boolean }): JSX.Element {
  const { t } = useTranslation()
  const stats = useUi((s) => s.stats)
  const paths = useUi((s) => s.paths)
  const settings = useUi((s) => s.settings)
  const total = useUi((s) => s.total)
  const locale = settings.language as LocaleKey

  return (
    <footer
      className="flex h-[26px] shrink-0 items-center gap-3 border-t px-3 text-[11px]"
      style={{ borderColor: 'var(--line)', background: 'var(--panel)', color: 'var(--muted)' }}
    >
      <span>{dropActive ? t('library.dropHint') : t('library.emptyHint')}</span>
      <span className="faint">·</span>
      <span className="truncate" style={{ maxWidth: 360 }}>
        {t('settings.libraryRoot')}:{' '}
        {stats && paths?.libraryRoot ? paths.libraryRoot : <span style={{ color: 'var(--warn)' }}>{t('common.notSet')}</span>}
      </span>
      <span className="ml-auto tabular-nums">
        {humanNumber(total, locale)} / {stats ? humanNumber(stats.assets, locale) : 0}
      </span>
    </footer>
  )
}

export function Toasts(): JSX.Element {
  const toasts = useUi((s) => s.toasts)
  const dismiss = useUi((s) => s.dismissToast)
  const color = (tone: string): string =>
    tone === 'ok' ? 'var(--ok)' : tone === 'warn' ? 'var(--warn)' : tone === 'bad' ? 'var(--bad)' : 'var(--accent)'

  return (
    <div className="fixed bottom-8 right-4 z-50 flex w-[380px] flex-col gap-2">
      {toasts.map((toast) => (
        <button
          key={toast.id}
          type="button"
          onClick={() => dismiss(toast.id)}
          className="rounded-md border px-3 py-2 text-left text-[12px] shadow-panel"
          style={{
            background: 'var(--panel)',
            borderColor: 'var(--line-2)',
            borderLeft: `3px solid ${color(toast.tone)}`
          }}
        >
          {toast.text}
        </button>
      ))}
    </div>
  )
}
