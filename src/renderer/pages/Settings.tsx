import { lazy, Suspense, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { AppSettings, LocaleKey } from '../../shared/types'
import { LOCALES, LOCALE_LABELS } from '../i18n'
import { useUi } from '../stores/ui'
import { Badge, Button, Field, Select, Switch } from '../components/ui'
import { HealthPanel } from '../components/HealthPanel'
import { RebundlePanel } from '../components/RebundlePanel'
import { RegroupPanel } from '../components/RegroupPanel'
import { RemergePanel } from '../components/RemergePanel'
import { ReanalyzePanel } from '../components/ReanalyzePanel'
import { TaxonomyPanel } from '../components/TaxonomyPanel'
import { LearnModelsPanel } from '../components/LearnModelsPanel'
import { PasswordVaultPanel } from '../components/PasswordVaultPanel'
import { DatabaseBackupPanel } from '../components/DatabaseBackupPanel'

type TabKey = 'general' | 'library' | 'classify' | 'unity' | 'vpm' | 'integration' | 'maintenance' | 'about'

const TABS: TabKey[] = ['general', 'library', 'classify', 'unity', 'vpm', 'integration', 'maintenance', 'about']

/**
 * VPM 外壳只在打开这个页签时加载。
 * P0 里它只是一个开关；P1 起这里会挂仓库/包目录，不能让它拖慢启动。
 */
const VpmSettings = lazy(() => import('../vpm/VpmSettings').then((m) => ({ default: m.VpmSettings })))

function PathEntry({ value, onCommit, onRemove }: {
  value: string; onCommit: (value: string) => void; onRemove: () => void
}): JSX.Element {
  const { t } = useTranslation()
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])
  return (
    <div className="flex items-center gap-2">
      <input className="input" value={draft} onChange={event => setDraft(event.target.value)}
        onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur() }}
        onBlur={() => { if (draft !== value) onCommit(draft) }} />
      <Button onClick={onRemove}>{t('common.remove')}</Button>
    </div>
  )
}

function ListEditor({
  items,
  onChange,
  pickDirectory
}: {
  items: string[]
  onChange: (next: string[]) => void
  pickDirectory: boolean
}): JSX.Element {
  const { t } = useTranslation()
  return (
    <div className="flex flex-col gap-1.5">
      {items.length === 0 ? <div className="faint text-[11px]">{t('common.empty')}</div> : null}
      {items.map((v, i) => (
        <PathEntry key={i} value={v} onCommit={value => {
          const next = [...items]
          next[i] = value
          onChange(next)
        }} onRemove={() => onChange(items.filter((_, j) => j !== i))} />
      ))}
      <div>
        <Button
          onClick={async () => {
            const picked = pickDirectory
              ? await window.a.system.pickDirectory({})
              : (await window.a.system.pickFiles({ multiple: false }))[0]
            if (picked && !items.includes(picked)) onChange([...items, picked])
          }}
        >
          {t('common.add')}
        </Button>
      </div>
    </div>
  )
}

export function Settings(): JSX.Element {
  const { t, i18n } = useTranslation()
  const settings = useUi((s) => s.settings)
  const patch = useUi((s) => s.patchSettings)
  const info = useUi((s) => s.info)
  const paths = useUi((s) => s.paths)
  const categories = useUi((s) => s.categories)
  const toast = useUi((s) => s.toast)
  const [tab, setTab] = useState<TabKey>('general')
  const [draft, setDraft] = useState<AppSettings>(settings)
  const [shell, setShell] = useState<{ installed: boolean; target: string | null; current: string } | null>(null)
  const [watching, setWatching] = useState<string[]>([])
  const [busyShell, setBusyShell] = useState(false)

  const reloadShellState = async (): Promise<void> => {
    try {
      const [st, ws] = await Promise.all([window.a.integration.shellMenuState(), window.a.integration.watcherState()])
      setShell(st)
      setWatching(ws.watching)
    } catch {
      /* 拿不到就当没登记 */
    }
  }
  useEffect(() => {
    void reloadShellState()
  }, [])
  // 监视目录一改，主进程那边就重启 watcher，这里跟着刷一次状态
  useEffect(() => {
    const timer = window.setTimeout(() => void reloadShellState(), 600)
    return () => window.clearTimeout(timer)
  }, [settings.watchedFolders])

  // draft 只给"要手打的"文本框用；Select/Switch 是点一下就立刻生效的，
  // 所以设置一变就得把 draft 拉齐，否则下拉框会停在旧值上——
  // 而 DOM 的 value 没变时 onChange 根本不触发，语言就切不回来了（实测踩过）。
  useEffect(() => {
    setDraft(settings)
  }, [settings])

  const locale = i18n.language as LocaleKey
  const set = <K extends keyof AppSettings>(key: K, value: AppSettings[K]): void => {
    setDraft({ ...draft, [key]: value })
  }

  return (
    <div className="flex min-h-0 flex-1">
      <nav
        className="w-[150px] shrink-0 border-r p-2"
        style={{ borderColor: 'var(--line)', background: 'var(--panel)' }}
      >
        {TABS.map((k) => (
          <button
            key={k}
            type="button"
            className={`nav-item ${tab === k ? 'nav-active' : ''}`}
            onClick={() => {
              setTab(k)
              setDraft(settings)
            }}
          >
            {t(`settings.tabs.${k}`)}
          </button>
        ))}
      </nav>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <div className="mx-auto max-w-[720px]">
          <div className="mb-3 flex items-center gap-2">
            <h2 className="text-[15px] font-medium">{t('settings.title')}</h2>
            <Badge>{t(`settings.tabs.${tab}`)}</Badge>
          </div>

          {tab === 'general' ? (
            <>
              <Field label={t('settings.language')}>
                <Select
                  value={draft.language}
                  onChange={(v) => void patch({ language: v })}
                  options={LOCALES.map((l) => ({ value: l, label: LOCALE_LABELS[l] }))}
                />
              </Field>
              <Field label={t('settings.theme')}>
                <Select
                  value={draft.theme}
                  onChange={(v) => void patch({ theme: v })}
                  options={[
                    { value: 'dark', label: t('settings.themeDark') },
                    { value: 'light', label: t('settings.themeLight') }
                  ]}
                />
              </Field>
              <Field label={t('settings.libraryLocale')} hint={t('settings.libraryLocaleHint')}>
                <Select
                  value={draft.libraryLocale}
                  onChange={(v) => void patch({ libraryLocale: v })}
                  options={LOCALES.map((l) => ({ value: l, label: LOCALE_LABELS[l] }))}
                />
              </Field>
              <Field label={t('settings.autoLaunch')} hint={t('settings.autoLaunchHint')} inline>
                <Switch checked={draft.autoLaunch} onChange={(v) => void patch({ autoLaunch: v })} />
              </Field>
              <Field label={t('settings.minimizeToTray')} inline>
                <Switch checked={draft.minimizeToTray} onChange={(v) => void patch({ minimizeToTray: v })} />
              </Field>
              <Field label={t('settings.hotkey')} hint="CommandOrControl+Alt+A">
                <div className="flex gap-2">
                  <input
                    className="input"
                    style={{ width: 260 }}
                    value={draft.globalHotkey}
                    onChange={(e) => set('globalHotkey', e.target.value)}
                  />
                  <Button onClick={() => void patch({ globalHotkey: draft.globalHotkey })}>{t('common.apply')}</Button>
                </div>
              </Field>
            </>
          ) : null}

          {tab === 'library' ? (
            <>
              <Field label={t('settings.libraryRoot')} hint={t('settings.libraryRootHint')}>
                <div className="flex gap-2">
                  <input
                    className="input"
                    style={{ width: 380 }}
                    value={draft.libraryRoot ?? ''}
                    onChange={(e) => set('libraryRoot', e.target.value || null)}
                  />
                  <Button
                    onClick={async () => {
                      const picked = await window.a.system.pickDirectory({ title: t('settings.libraryRoot') })
                      if (picked) {
                        set('libraryRoot', picked)
                        await patch({ libraryRoot: picked })
                      }
                    }}
                  >
                    {t('common.choose')}
                  </Button>
                  <Button variant="accent" onClick={() => void patch({ libraryRoot: draft.libraryRoot })}>
                    {t('common.apply')}
                  </Button>
                </div>
                {paths && !draft.libraryRoot ? (
                  <div className="mt-1 text-[11px]" style={{ color: 'var(--warn)' }}>
                    {t('settings.libraryRootMissing')}
                  </div>
                ) : null}
                {paths && draft.libraryRoot && !paths.libraryAccessible ? (
                  <div className="mt-1 text-[11px]" style={{ color: 'var(--bad)' }}>
                    {paths.libraryProblem ?? '无法访问'}
                  </div>
                ) : null}
              </Field>
              <Field label={t('settings.storageMode')}>
                <Select
                  value={draft.storageMode}
                  onChange={(v) => void patch({ storageMode: v })}
                  options={[
                    { value: 'archived', label: t('settings.modeArchived') },
                    { value: 'indexed', label: t('settings.modeIndexed') }
                  ]}
                />
              </Field>
              <Field label={t('settings.dirTemplate')} hint={t('settings.dirTemplateHint')}>
                <input
                  className="input"
                  value={draft.dirTemplate}
                  onChange={(e) => set('dirTemplate', e.target.value)}
                  onBlur={() => void patch({ dirTemplate: draft.dirTemplate })}
                />
              </Field>
              <Field label={t('settings.extractRoot')} hint={t('settings.extractRootHint')}>
                <input
                  className="input"
                  placeholder={t('settings.extractRootPlaceholder')}
                  value={draft.extractRoot}
                  onChange={(e) => set('extractRoot', e.target.value)}
                  onBlur={() => void patch({ extractRoot: draft.extractRoot })}
                />
              </Field>
              <Field label={t('settings.keepOriginal')} hint={t('settings.keepOriginalHint')} inline>
                <Switch checked={draft.keepOriginalArchive} onChange={(v) => void patch({ keepOriginalArchive: v })} />
              </Field>
              <Field label={t('settings.autoExtract')} hint={t('settings.autoExtractHint')} inline>
                <Switch checked={draft.autoExtract} onChange={(v) => void patch({ autoExtract: v })} />
              </Field>
              <Field label={t('settings.autoArchive')} hint={t('settings.autoArchiveHint')} inline>
                <Switch checked={draft.autoArchive} onChange={(v) => void patch({ autoArchive: v })} />
              </Field>
              {/* M7 ⑥ · 记住的加密包密码：能看见、能逐条删（这里永远不显示密码本身） */}
              <PasswordVaultPanel />
            </>
          ) : null}

          {tab === 'classify' ? (
            <>
              <Field label={t('settings.confidenceAuto')} hint={t('settings.confidenceAutoHint')}>
                <input
                  className="input"
                  style={{ width: 110 }}
                  type="number"
                  step="0.05"
                  min="0"
                  max="1"
                  value={draft.confidenceAuto}
                  onChange={(e) => set('confidenceAuto', Number(e.target.value))}
                  onBlur={() => void patch({ confidenceAuto: draft.confidenceAuto })}
                />
              </Field>
              <Field label={t('settings.confidenceConfirm')} hint={t('settings.confidenceConfirmHint')}>
                <input
                  className="input"
                  style={{ width: 110 }}
                  type="number"
                  step="0.05"
                  min="0"
                  max="1"
                  value={draft.confidenceConfirm}
                  onChange={(e) => set('confidenceConfirm', Number(e.target.value))}
                  onBlur={() => void patch({ confidenceConfirm: draft.confidenceConfirm })}
                />
              </Field>
              <Field label={t('settings.grouping')} inline>
                <Switch checked={draft.groupingEnabled} onChange={(v) => void patch({ groupingEnabled: v })} />
              </Field>
              <Field label={t('settings.bundleSplit')} inline>
                <Switch checked={draft.bundleSplitEnabled} onChange={(v) => void patch({ bundleSplitEnabled: v })} />
              </Field>
              <Field label={t('settings.llm')} hint={t('settings.llmWarn')} inline>
                <Switch checked={draft.llmEnabled} onChange={(v) => void patch({ llmEnabled: v })} />
              </Field>
              {draft.llmEnabled ? (
                <>
                  <Field label="Endpoint">
                    <input className="input" value={draft.llmEndpoint} onChange={(e) => set('llmEndpoint', e.target.value)} />
                  </Field>
                  <Field label="Model">
                    <input className="input" value={draft.llmModel} onChange={(e) => set('llmModel', e.target.value)} />
                  </Field>
                </>
              ) : null}
              <div className="mt-3 rounded border p-2 text-[11px] leading-relaxed" style={{ borderColor: 'var(--line)', color: 'var(--muted)' }}>
                {t('settings.privacy')}
              </div>
              <div className="mt-2">
                <div className="text-[12px] font-medium">{t('settings.dictionary')}</div>
                <div className="mt-0.5 text-[11px] leading-relaxed" style={{ color: 'var(--muted)' }}>
                  {t('settings.dictionaryHint')}
                </div>
              </div>
              <TaxonomyPanel categories={categories} />
              {/* §B4 从库中学习模型名：词典能自己长，不用每来一个新模型就改代码重打包 */}
              <div className="mt-4">
                <div className="text-[12px] font-medium">{t('settings.learnTitle')}</div>
                <div className="mt-1">
                  <LearnModelsPanel />
                </div>
              </div>
            </>
          ) : null}

          {tab === 'unity' ? (
            <>
              <Field label={t('settings.unityExe')}>
                <input
                  className="input"
                  value={draft.unityExePath}
                  placeholder="E:\unity\2022.3.22f1\Editor\Unity.exe"
                  onChange={(e) => set('unityExePath', e.target.value)}
                  onBlur={() => void patch({ unityExePath: draft.unityExePath })}
                />
              </Field>
              <Field label={t('settings.projectRoots')} hint={t('settings.detectVcc')}>
                <ListEditor
                  items={draft.projectRoots}
                  onChange={(v) => void patch({ projectRoots: v })}
                  pickDirectory
                />
              </Field>
              <Field label={t('settings.confirmBeforeImport')} inline>
                <Switch checked={draft.confirmBeforeImport} onChange={(v) => void patch({ confirmBeforeImport: v })} />
              </Field>
              <Field label={t('settings.backupOverwritten')} inline>
                <Switch checked={draft.backupOverwritten} onChange={(v) => void patch({ backupOverwritten: v })} />
              </Field>
              <details className="mt-3 rounded border p-3" style={{ borderColor: 'var(--line)' }}>
                <summary className="cursor-pointer text-[12px]">{t('project.connectionAdvanced')}</summary>
                <Field label={t('settings.unityAutoConnect')} hint={t('settings.unityAutoConnectHint')} inline>
                  <Switch checked={draft.unityAutoConnect} onChange={(v) => void patch({ unityAutoConnect: v })} />
                </Field>
              </details>
              {/*
                M6 ⑥：这三条是 §4.3 的"自动切换 + 防打扰"在设置页的落点。
                `autoSwitchBehavior` 这个设置从 M1 起就有默认值和类型，**但界面上从来没有控件、
                主进程也没人读** —— 所以这里补的不只是一个下拉，而是把一条死设置接活。
              */}
              <Field label={t('settings.autoSwitchBehavior')} hint={t('settings.autoSwitchBehaviorHint')}>
                <Select
                  value={draft.autoSwitchBehavior}
                  onChange={(v) => void patch({ autoSwitchBehavior: v })}
                  options={[
                    { value: 'always', label: t('settings.asbAlways') },
                    { value: 'when_matched', label: t('settings.asbWhenMatched') },
                    { value: 'never', label: t('settings.asbNever') }
                  ]}
                />
              </Field>
              {/* 抽取根那一格在「库」tab（和闸门文案「请到 设置 → 库」对得上），这里不放第二份 */}
              <div className="rounded border px-2 py-1.5 text-[11px]" style={{ borderColor: 'var(--line-2)', color: 'var(--muted)' }}>
                {t('settings.trayRequiredNote')}
              </div>
            </>
          ) : null}

          {tab === 'vpm' ? (
            <Suspense fallback={<div className="faint text-[11px]">{t('common.loading')}</div>}>
              <VpmSettings />
            </Suspense>
          ) : null}

          {tab === 'integration' ? (
            <>
              <Field
                label={t('settings.watchedFolders')}
                hint={
                  watching.length
                    ? t('settings.watchedRunning', { count: watching.length })
                    : t('settings.watchedFoldersHint')
                }
              >
                <ListEditor items={draft.watchedFolders} onChange={(v) => void patch({ watchedFolders: v })} pickDirectory />
              </Field>
              <Field
                label={t('settings.contextMenu')}
                hint={
                  shell?.installed
                    ? t('settings.contextMenuOn', { exe: shell.target ?? shell.current })
                    : t('settings.contextMenuOff')
                }
                inline
              >
                <div className="flex gap-2">
                  <Button
                    variant="accent"
                    disabled={busyShell || !!shell?.installed}
                    onClick={async () => {
                      setBusyShell(true)
                      try {
                        const r = await window.a.integration.shellMenuInstall(t('settings.contextMenuLabel'))
                        toast(r.ok ? 'ok' : 'bad', t(r.messageKey))
                      } catch (e) {
                        toast('bad', e instanceof Error ? e.message : String(e))
                      }
                      setBusyShell(false)
                      void reloadShellState()
                    }}
                  >
                    {t('settings.contextMenuInstall')}
                  </Button>
                  <Button
                    disabled={busyShell || !shell?.installed}
                    onClick={async () => {
                      setBusyShell(true)
                      try {
                        const r = await window.a.integration.shellMenuUninstall()
                        toast(r.ok ? 'ok' : 'bad', t(r.messageKey))
                      } catch (e) {
                        toast('bad', e instanceof Error ? e.message : String(e))
                      }
                      setBusyShell(false)
                      void reloadShellState()
                    }}
                  >
                    {t('settings.contextMenuUninstall')}
                  </Button>
                </div>
              </Field>
            </>
          ) : null}

          {tab === 'maintenance' ? (
            <>
              <DatabaseBackupPanel />
              <Field label={t('settings.dataDir')} hint={paths?.dbPath}>
                <div className="flex gap-2">
                  <Button
                    onClick={() => {
                      if (paths) void window.a.system.reveal(paths.appData).catch((e: Error) => toast('bad', e.message))
                    }}
                  >
                    {t('settings.openAppData')}
                  </Button>
                  {/*
                    第 10 轮 F：这颗原来按下只弹一句「该功能将在 M7 交付」——
                    按钮看着能用、实际什么都没做，而那句承诺本身会过期（报障 1 就是同一族病）。
                    现在做的是"日志"这件事的真版本：打开日志所在文件夹，
                    要发给别人排查，在那里复制那个文件就行。
                  */}
                  <Button
                    onClick={() => {
                      if (paths) void window.a.system.reveal(paths.logs).catch((e: Error) => toast('bad', e.message))
                    }}
                  >
                    {t('settings.openLogDir')}
                  </Button>
                </div>
              </Field>
              <Field label={t('settings.rebuildIndex')} hint={t('settings.rebuildHint')}>
                <Button
                  onClick={async () => {
                    try {
                      const r = await window.a.health.rebuildIndex()
                      if (r.errors.length) toast('warn', r.errors.join(' / '))
                      toast('info', t('health.rebuilt', { count: r.rebuilt, docs: r.docs }))
                    } catch (e) {
                      toast('bad', e instanceof Error ? e.message : String(e))
                    }
                  }}
                >
                  {t('settings.rebuildIndex')}
                </Button>
              </Field>
              <Field label={t('settings.rebundle')} hint={t('settings.rebundleHint')}>
                <RebundlePanel />
              </Field>
              {/* #40：归并的前提是同一目录。V4 只挡"以后"，存量靠这一栏按目录拆开 */}
              <Field label={t('settings.regroup')} hint={t('settings.regroupHint')}>
                <RegroupPanel />
              </Field>
              {/*
                第 9 轮 ② · B4：和上面那栏是**反方向**的同一件事 ——
                Regroup 把"以后不该并的"拆开，Remerge 把"规则修好之前错拆开的"并回去。
                两栏都必须存在：只留一个，另一类症状就没人管。
              */}
              <Field label={t('settings.remerge')} hint={t('settings.remergeFieldHint')}>
                <RemergePanel />
              </Field>
              {/* 改动单 2 §交付 4：改完规则要能把已入库的数据重算一遍，且按下前先看到影响条数 */}
              <Field label={t('settings.reanalyzeTitle')}>
                <ReanalyzePanel />
              </Field>
              <Field label={t('settings.health')} hint={t('health.intro')}>
                <HealthPanel />
              </Field>
            </>
          ) : null}

          {tab === 'about' ? (
            <>
              <div className="flex flex-col gap-1.5 text-[12px]">
                <div>
                  <span className="faint">{t('settings.version')}：</span>
                  {info?.version} · Electron {info?.electron} · Node {info?.node} · Chromium {info?.chrome}
                </div>
                <div>
                  <span className="faint">{t('settings.stack')}：</span>Electron + React + Tailwind + Radix + better-sqlite3
                </div>
                <div>
                  <span className="faint">{t('settings.libraryLocale')}：</span>
                  {LOCALE_LABELS[settings.libraryLocale] ?? locale}
                </div>
              </div>
              <div
                className="mt-4 rounded border p-3 text-[11px] leading-relaxed"
                style={{ borderColor: 'var(--line)', color: 'var(--muted)' }}
              >
                <div className="mb-1 font-medium">{t('settings.license')}</div>
                <div>{t('settings.sevenZip')}</div>
                <div className="mt-2">{t('settings.privacy')}</div>
              </div>
            </>
          ) : null}
        </div>
      </div>
    </div>
  )
}
