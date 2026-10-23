import { useCallback, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useUi } from './stores/ui'
import { Sidebar, StatusBar, Toasts, TopBar } from './components/chrome'
import { DropOverlay, useDropZone } from './components/DropOverlay'
import { ImportFlow } from './components/ImportFlow'
import { BatchImportDialog } from './components/BatchImportDialog'
import { RearchiveDialog } from './components/RearchiveDialog'
import { MemberPicker } from './components/MemberPicker'
import { ModelBackfillDialog } from './components/ModelBackfillDialog'
import { CoverTasks } from './components/CoverTasks'
import { ProjectBanner } from './components/ProjectBanner'
import { RemergeNotice } from './components/RemergeNotice'
import { DeepLinkHost } from './vpm/components/DeepLinkHost'
import { AutoLaunchAsk } from './components/AutoLaunchAsk'
import { ImportTargetPicker } from './components/ImportTargetPicker'
import { FirstRunWizard } from './components/FirstRunWizard'
import { wizardGate } from '../shared/wizardState'
import { dropEmptyKey, type DropEmptyInfo } from '../shared/dropDiagnostics'
import { Inbox } from './pages/Inbox'
import { Library } from './pages/Library'
import { Project } from './pages/Project'
import { Collections } from './pages/Collections'
import { Settings } from './pages/Settings'

/**
 * 第 10 轮 E：拖进来了、却没解析出本地路径时**必须说一句**。
 *
 * 老写法是 `if (paths.length) onPaths(paths)`，else 什么都不做 ——
 * 他录屏里那次「把西装拖进 A，A 一点反应也没有」，读到的就是这个静默。
 * 说什么由 `shared/dropDiagnostics.ts` 判（"带了文件但没路径"和"压根没文件"是两件事，
 * 那边的用例钉着），这里只负责把它变成一条 toast。
 */
function useDropEmpty(): (info: DropEmptyInfo) => void {
  const { t } = useTranslation()
  const toast = useUi((s) => s.toast)
  return useCallback(
    (info: DropEmptyInfo) => {
      const key = dropEmptyKey(info)
      if (key) toast('warn', t(key))
    },
    [t, toast]
  )
}

function MiniDrop(): JSX.Element {
  const { t } = useTranslation()
  const ingestPaths = useUi((s) => s.ingestPaths)
  const onEmpty = useDropEmpty()
  const { active, handlers } = useDropZone(ingestPaths, onEmpty)
  const items = useUi((s) => s.ingestItems)

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') window.close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div
      className="drag flex h-full flex-col items-center justify-center gap-2 rounded-xl border p-3 text-center"
      style={{
        background: 'var(--panel)',
        borderColor: active ? 'var(--accent)' : 'var(--line-2)',
        boxShadow: '0 12px 40px rgba(0,0,0,.5)'
      }}
      {...handlers}
    >
      <div className="text-[13px]" style={{ color: active ? 'var(--accent)' : 'var(--text)' }}>
        {active ? t('library.dropHint') : t('library.emptyTitle')}
      </div>
      <div className="nodrag text-[11px]" style={{ color: 'var(--faint)' }}>
        {t('inbox.title')}：{items.length}
      </div>
    </div>
  )
}

export function App(): JSX.Element {
  const { t } = useTranslation()
  const booted = useUi((s) => s.booted)
  const bootError = useUi((s) => s.bootError)
  const nav = useUi((s) => s.nav)
  const setNav = useUi((s) => s.setNav)
  const ingestPaths = useUi((s) => s.ingestPaths)
  const undoLast = useUi((s) => s.undoLast)
  const trashSelected = useUi((s) => s.trashSelected)
  const selectAll = useUi((s) => s.selectAll)
  const clearSelection = useUi((s) => s.clearSelection)
  const settings = useUi((s) => s.settings)
  const wizardStartedHere = useUi((s) => s.wizardStartedHere)
  const onEmpty = useDropEmpty()
  const { active, handlers } = useDropZone(ingestPaths, onEmpty)

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const target = e.target as HTMLElement | null
      const typing = !!target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
      if (typing || e.isComposing) return
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        void undoLast()
        return
      }
      if (e.key === 'Escape') clearSelection()
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
        e.preventDefault()
        selectAll()
      }
      if (e.key === 'Delete') void trashSelected()
      if (e.key === 'Enter') {
        /** 焦点在按钮/链接/下拉上时，Enter 是“按那个控件”，不是全局导入（输入框由上面的 typing 闸兜住） */
        if (target && (target.tagName === 'BUTTON' || target.tagName === 'A' || target.tagName === 'SELECT')) return
        /** 容器内部有自己的 Enter（打开成员面板），这里不许再抢一次 */
        if (nav.startsWith('bundle:')) return
        const st = useUi.getState()
        const sel = st.selection
        /**
         * 2026-10-21：
         * - Shift+Enter = 打开选中的合集（长按是鼠标专属，键盘必须有等价入口）；
         * - Enter = 导入选中项；选 1 张合集时和双击合集同一条路（成员面板 + 全预勾）；
         * - 多选仍走批量，语义不变。
         */
        if (e.shiftKey) {
          if (sel.length === 1) {
            const card = st.cards.find((c) => c.id === sel[0])
            if (card?.isBundle) {
              e.preventDefault()
              setNav('bundle:' + sel[0])
            }
          }
          return
        }
        if (!sel.length) return
        e.preventDefault()
        if (sel.length > 1) void st.importSelected()
        else {
          const card = st.cards.find((c) => c.id === sel[0])
          if (card?.isBundle) void st.importWhole(sel[0])
          else void st.importAsset(sel[0])
        }
      }
      if (e.key >= '1' && e.key <= '9' && (e.ctrlKey || e.metaKey)) {
        const list = useUi.getState().collections
        const row = list[Number(e.key) - 1]
        if (row) {
          e.preventDefault()
          setNav('col:' + row.id)
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [clearSelection, ingestPaths, nav, selectAll, setNav, t, trashSelected, undoLast])

  if (typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('view') === 'mini') {
    return (
      <div className="h-full">
        <MiniDrop />
      </div>
    )
  }

  if (bootError) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <div
          className="max-w-lg rounded-lg border p-4 text-[12px] leading-relaxed"
          style={{ borderColor: 'var(--bad)', color: 'var(--bad)', background: 'var(--panel)' }}
        >
          <div className="mb-2 text-[14px]">{t('error.bootFailed')}</div>
          <pre className="whitespace-pre-wrap font-mono">{bootError}</pre>
        </div>
      </div>
    )
  }

  if (!booted) {
    return <div className="flex h-full items-center justify-center muted">{t('common.loading')}</div>
  }

  /**
   * M7 · 首启向导。判据在 `shared/wizardState.ts` 的 `wizardGate`（有 34 条用例钉着），
   * 这里只问一句"该画哪个"。
   *
   * 早退在 `booted` 之后、`view=mini` 之后：小窗（拖放快捷入口）不该被向导顶掉。
   * 向导期间这些全局模态都不挂载 —— 全新安装那一次本来就不该同时弹桥接窗（第 2 轮实测连问 8 次的那族问题）。
   */
  if (
    wizardGate({
      onboardingDone: settings.onboardingDone,
      onboardingSkippedAt: settings.onboardingSkippedAt,
      /** 只看"启动时库根空不空"，不看当前值 —— 否则第 ① 步一落库根，向导就自己关了 */
      startedHere: wizardStartedHere,
      booted
    }) === 'wizard'
  ) {
    return <FirstRunWizard />
  }

  const showDetail = nav === 'bundles' || nav.startsWith('bundle:') || nav === 'all' || nav === 'recent' || nav.startsWith('cat:') || nav.startsWith('col:')
  const useLibrary = showDetail || nav === 'favorites'

  return (
    <div className="flex h-full flex-col" {...handlers}>
      <TopBar />
      {/* M6 ⑤：自动切换的横幅。挂在 App 这一层 —— 它要活过切页（用户此刻很可能正在别的页面上） */}
      <ProjectBanner />
      {/*
        第 9 轮 ⑥：自动收拾完历史遗留那句告知。同样挂在 App 这一层，
        因为它产生的那一刻用户可能正停在任何页面上，而它要说的事只和"卡片分组"有关。
      */}
      <RemergeNotice />
      <DeepLinkHost />
      {/*
        导入流程的常驻界面：冲突确认对话框 + 进行中提示 + 上次结果条（带撤销）。
        **必须挂在 App 这一层**，不能挂在发起导入的组件里 ——
        宿主一卸载（切页/切筛选）对话框就没了，而导入还挂在后台。
      */}
      <ImportFlow />
      <ImportTargetPicker />
      {/*
        容器成员选择面板（M5-B ⑥）。挂在 App 而不是容器视图里，理由和上面那条一样：
        "已经抽好、等用户点确认"的那一批副本活在主进程内存里，宿主组件卸载不能把它丢下。
      */}
      <MemberPicker />
      {/* R4 ② · 多选卡批量的确认/结果面板。挂在这里的理由和 MemberPicker 一样：
          发起方是网格或快捷键，它们一卸载面板就该还在，否则导入挂在没人看的窗后面 */}
      <BatchImportDialog />
      <ModelBackfillDialog />
      <CoverTasks />
      {/*
        R4 ③ · 改分类搬文件的确认卡。发起方是详情面板那两个下拉，而详情面板会随切页卸载 ——
        "已经算好预览、等用户点搬"的那份计划必须活在 App 这一层，否则用户切个页回来，
        决定点没了，而那次改分类只改了一半（卡片改了、文件没动）。
      */}
      <RearchiveDialog />
      <AutoLaunchAsk />
      <div className="flex min-h-0 flex-1">
        <Sidebar />
        <main className="flex min-w-0 flex-1 flex-col">
          {nav === 'inbox' ? <Inbox /> : null}
          {nav === 'project' ? <Project /> : null}
          {nav === 'collections' ? <Collections /> : null}
          {nav === 'settings' ? <Settings /> : null}
          {useLibrary ? <Library /> : null}
        </main>
      </div>
      <StatusBar dropActive={active} />
      <DropOverlay active={active} />
      <Toasts />
    </div>
  )
}
