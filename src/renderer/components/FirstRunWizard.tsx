import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  adoptOrFresh,
  canLeaveStep,
  directoryUnusable,
  stepDone,
  summaryLines,
  warnLowFreeSpace,
  warnSystemDrive,
  type SummaryLine,
  type LibraryChoice,
  type WizardStep
} from '../../shared/wizardState'
import type { ProjectInfo } from '../../shared/types'
import { humanBytes, humanNumber } from '../lib/format'
import { useUi } from '../stores/ui'
import { Badge, Button } from './ui'

/**
 * M7 · 首次启动向导（规格 01§8：① 选库位置 ② 选素材来源目录 ③ 装 Unity 桥接，可跳过）。
 *
 * ## 这个组件故意很薄
 *
 * 本仓库渲染层**零 DOM 测试**，所以"该不该画向导 / 这一步能不能走 / 接管要不要关自动归档"
 * 这些判断全在 `shared/wizardState.ts`（有 34 条用例钉着），动作在 `stores/ui.ts` 的 wizard 那一段。
 * 这里只做映射：读 store、按判据禁用按钮、把探测数字摆出来。
 *
 * ## 三条刻意的口径
 *
 *  1. **第 ① 步是唯一不能跳过的**（没库根产品是坏的），其余三步都能跳。
 *  2. **接管那条要说人话**：屏幕上必须写明"只登记、不搬你的文件"和"会顺手关掉高置信度自动归档"，
 *     因为这两件事以前只写在 README §收编 的文档里（Q3 的裁定就是把它变成界面上的显式状态）。
 *  3. **探测数字不许谎报**：主进程那边有封顶（深度 3 / 8000 条 / 500 个文件），
 *     `capped` 为真时写"500+"而不是"500"。
 */
export function FirstRunWizard(): JSX.Element | null {
  const { t, i18n } = useTranslation()
  const settings = useUi((s) => s.settings)
  const step = useUi((s) => s.wizardStep)
  const probe = useUi((s) => s.wizardProbe)
  const probing = useUi((s) => s.wizardProbing)
  const pickDirectory = useUi((s) => s.wizardPickDirectory)
  const probePath = useUi((s) => s.wizardProbePath)
  const chooseLibrary = useUi((s) => s.wizardChooseLibrary)
  const setStep = useUi((s) => s.wizardSetStep)
  const finish = useUi((s) => s.wizardFinish)
  const skip = useUi((s) => s.wizardSkip)
  const patchSettings = useUi((s) => s.patchSettings)
  const answerAutoLaunch = useUi((s) => s.answerAutoLaunch)
  const settleBridgeAsk = useUi((s) => s.settleBridgeAsk)
  const toast = useUi((s) => s.toast)

  const [projects, setProjects] = useState<ProjectInfo[]>([])
  const [typed, setTyped] = useState('')
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [installing, setInstalling] = useState(false)
  const [results, setResults] = useState<Array<{ name: string; text: string; ok: boolean }>>([])

  const locale = settings.language
  const facts = useMemo(
    () => ({
      libraryRoot: settings.libraryRoot,
      libraryRootForbidden: false,
      /** 库根已经落定但没记方式（老库、或手改过 settings.json）→ 当成建空库，不再拦 */
      libraryChoice: settings.libraryMode,
      watchedFolders: settings.watchedFolders,
      bridgesInstalled: results.filter((r) => r.ok).length,
      autoLaunchAsked: settings.autoLaunchAsked
    }),
    [settings, results]
  )
  const done = stepDone(facts)
  const askAdopt = probe ? adoptOrFresh(probe) === 'ask' : false

  /** 第 ③ 步进来时拉一次工程清单，默认全勾（Q9 乙：全勾、可逐个取消） */
  useEffect(() => {
    if (step !== 3) return
    let alive = true
    void window.a.unity.listProjects().then((list) => {
      if (!alive) return
      setProjects(list)
      setPicked(new Set(list.filter((p) => !p.bridgeInstalled).map((p) => p.id)))
    })
    return () => {
      alive = false
    }
  }, [step])

  async function installSelected(): Promise<void> {
    const targets = projects.filter((p) => picked.has(p.id) && !p.bridgeInstalled)
    if (!targets.length) return
    setInstalling(true)
    setResults([])
    /**
     * 串行装，一个装完再装下一个：`installBridge` 是同步复制，但真正的风险是
     * "同时往 8 个工程写"的时候说不清是谁失败了，所以逐条报，一条一条落。
     */
    for (const p of targets) {
      try {
        const r = await window.a.unity.installBridge(p.id)
        if (r.ok) settleBridgeAsk(p.id)
        setResults((prev) => [
          ...prev,
          r.ok
            ? { name: p.name, text: t('wizard.step3.resultOk', { copied: r.copied, target: r.target }), ok: true }
            : { name: p.name, text: t('wizard.step3.resultBad', { error: r.error ?? t('wizard.step3.unknownError') }), ok: false }
        ])
        if (!r.ok) toast('bad', p.name + '：' + (r.error ?? ''))
      } catch (e) {
        setResults((prev) => [
          ...prev,
          { name: p.name, text: t('wizard.step3.resultBad', { error: e instanceof Error ? e.message : String(e) }), ok: false }
        ])
      }
    }
    /** 装完刷新一次清单，让"已装"的标记是真的（不能只信我们自己的循环） */
    setProjects(await window.a.unity.listProjects())
    setInstalling(false)
  }

  const stepTitle: Record<WizardStep, string> = {
    1: t('wizard.step1.title'),
    2: t('wizard.step2.title'),
    3: t('wizard.step3.title'),
    4: t('wizard.step4.title')
  }

  return (
    <div className="flex h-full min-h-0 flex-col" style={{ background: 'var(--bg)' }}>
      <div className="drag flex items-center justify-between px-6 py-4" style={{ borderBottom: '1px solid var(--line)' }}>
        <div className="nodrag">
          <div className="text-[15px] font-semibold">{t('wizard.title')}</div>
          <div className="text-[11px]" style={{ color: 'var(--muted)' }}>
            {t('wizard.subtitle')}
          </div>
        </div>
        {/*
          pr-[140px] 和 TopBar 同一个数：窗口控制键（最小化/最大化/关闭）是系统画的，
          不给这块留空，步骤圆点会直接压在按钮底下（第一版截图里就是这样）。
        */}
        <div className="flex items-center gap-2 pr-[140px]">
          {([1, 2, 3, 4] as WizardStep[]).map((s) => (
            <span
              key={s}
              className="flex h-6 w-6 items-center justify-center rounded-full text-[11px]"
              style={{
                background: s === step ? 'var(--accent)' : done[s] ? 'var(--ok-dim, transparent)' : 'transparent',
                border: '1px solid var(--line)',
                color: s === step ? 'var(--bg)' : 'var(--muted)'
              }}
            >
              {s}
            </span>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto px-8 py-6">
        <div className="mx-auto flex max-w-[760px] flex-col gap-4">
          <div className="text-[14px] font-semibold">{stepTitle[step]}</div>

          {step === 1 ? (
            <>
              <p className="text-[12px] leading-5" style={{ color: 'var(--muted)' }}>
                {t('wizard.step1.body')}
              </p>
              <div className="flex items-center gap-3">
                <Button onClick={() => void pickDirectory()} disabled={probing}>
                  {probing ? t('wizard.step1.probing') : t('wizard.step1.pick')}
                </Button>
                {/*
                  手输路径那条也要留着：目录选择框是系统模态（脚本点不到，活体第 2 条就没法跑），
                  而且库根常常就是"我知道它在哪"的那种情况。
                */}
                <input
                  value={typed}
                  onChange={(e) => setTyped(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && typed.trim()) void probePath(typed)
                  }}
                  placeholder={t('wizard.step1.typePath')}
                  className="min-w-0 flex-1 rounded-md px-2 py-1 text-[12px]"
                  style={{ border: '1px solid var(--line)', background: 'var(--panel)', color: 'var(--text)' }}
                />
                <Button variant="ghost" disabled={probing || !typed.trim()} onClick={() => void probePath(typed)}>
                  {t('wizard.step1.look')}
                </Button>
                {settings.libraryRoot ? (
                  <span className="text-[12px] break-all" style={{ color: 'var(--text)' }}>
                    {settings.libraryRoot}
                    {settings.libraryMode ? (
                      <Badge tone={settings.libraryMode === 'adopt' ? 'warn' : 'ok'}>
                        {t(settings.libraryMode === 'adopt' ? 'wizard.step1.adoptShort' : 'wizard.step1.freshShort')}
                      </Badge>
                    ) : null}
                  </span>
                ) : null}
              </div>

              {probe ? (
                <div className="flex flex-col gap-2 rounded-md p-3" style={{ border: '1px solid var(--line)' }}>
                  <div className="text-[11px]" style={{ color: 'var(--muted)' }}>
                    {probe.path}
                  </div>
                  <div className="flex flex-wrap gap-4 text-[12px]">
                    <span>{t('wizard.step1.facts.dirs', { n: humanNumber(probe.dirCount, locale) })}</span>
                    <span>
                      {probe.supportedFileCount < 0
                        ? t('wizard.step1.facts.unknown')
                        : t('wizard.step1.facts.files', {
                            n: humanNumber(probe.supportedFileCount, locale) + (probe.capped ? '+' : '')
                          })}
                    </span>
                    {probe.freeBytes >= 0 ? (
                      <span>{t('wizard.step1.facts.free', { size: humanBytes(probe.freeBytes, locale) })}</span>
                    ) : null}
                  </div>
                  {directoryUnusable(probe) ? (
                    <div className="text-[12px]" style={{ color: 'var(--bad)' }}>
                      {t('wizard.step1.notFound')}
                    </div>
                  ) : null}
                  {warnSystemDrive(probe.path) ? (
                    <div className="text-[12px]" style={{ color: 'var(--warn)' }}>
                      {t('wizard.step1.warnSystemDrive')}
                    </div>
                  ) : null}
                  {warnLowFreeSpace(probe) ? (
                    <div className="text-[12px]" style={{ color: 'var(--warn)' }}>
                      {t('wizard.step1.warnLowFree')}
                    </div>
                  ) : null}

                  {askAdopt && !settings.libraryRoot ? (
                    <>
                      <div className="mt-1 text-[12px]">{t('wizard.step1.askTitle')}</div>
                      <div className="flex gap-3">
                        <ChoiceCard
                          title={t('wizard.step1.adoptTitle')}
                          body={t('wizard.step1.adoptBody')}
                          onPick={() => void chooseLibrary('adopt' satisfies LibraryChoice)}
                        />
                        <ChoiceCard
                          title={t('wizard.step1.freshTitle')}
                          body={t('wizard.step1.freshBody')}
                          onPick={() => void chooseLibrary('fresh' satisfies LibraryChoice)}
                        />
                      </div>
                    </>
                  ) : null}
                </div>
              ) : null}
            </>
          ) : null}

          {step === 2 ? (
            <>
              <p className="text-[12px] leading-5" style={{ color: 'var(--muted)' }}>
                {t('wizard.step2.body')}
              </p>
              {settings.watchedFolders.length === 0 ? (
                <div className="text-[12px]" style={{ color: 'var(--muted)' }}>
                  {t('wizard.step2.empty')}
                </div>
              ) : (
                <ul className="flex flex-col gap-1 text-[12px]">
                  {settings.watchedFolders.map((f) => (
                    <li key={f} className="flex items-center justify-between gap-3">
                      <span className="break-all">{f}</span>
                      <Button
                        variant="ghost"
                        onClick={() =>
                          void patchSettings({ watchedFolders: settings.watchedFolders.filter((x) => x !== f) })
                        }
                      >
                        {t('wizard.step2.remove')}
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
              <div>
                <Button
                  onClick={async () => {
                    const p = await window.a.system.pickDirectory({ title: t('wizard.step2.add') })
                    if (p && !settings.watchedFolders.includes(p)) {
                      await patchSettings({ watchedFolders: [...settings.watchedFolders, p] })
                    }
                  }}
                >
                  {t('wizard.step2.add')}
                </Button>
              </div>
            </>
          ) : null}

          {step === 3 ? (
            <>
              <p className="text-[12px] leading-5" style={{ color: 'var(--muted)' }}>
                {t('wizard.step3.body')}
              </p>
              {projects.length === 0 ? (
                <div className="text-[12px]" style={{ color: 'var(--muted)' }}>
                  {t('wizard.step3.none')}
                </div>
              ) : (
                <ul className="flex flex-col gap-1 text-[12px]">
                  {projects.map((p) => (
                    <li key={p.id} className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={p.bridgeInstalled || picked.has(p.id)}
                        disabled={p.bridgeInstalled || installing}
                        onChange={(e) => {
                          setPicked((prev) => {
                            const next = new Set(prev)
                            if (e.target.checked) next.add(p.id)
                            else next.delete(p.id)
                            return next
                          })
                        }}
                      />
                      <span>{p.name}</span>
                      <span style={{ color: 'var(--muted)' }}>{p.unityVersion ?? ''}</span>
                      {p.bridgeInstalled ? <Badge tone="ok">{t('wizard.step3.installed')}</Badge> : null}
                    </li>
                  ))}
                </ul>
              )}
              <div className="flex items-center gap-3">
                <Button
                  variant="accent"
                  disabled={installing || ![...picked].some((id) => !projects.find((p) => p.id === id)?.bridgeInstalled)}
                  onClick={() => void installSelected()}
                >
                  {t('wizard.step3.run')}
                </Button>
                <span className="text-[11px]" style={{ color: 'var(--muted)' }}>
                  {t('wizard.step3.onlyPackages')}
                </span>
              </div>
              {results.length ? (
                <ul className="flex flex-col gap-1 text-[11px]">
                  {results.map((r, i) => (
                    <li key={i} style={{ color: r.ok ? 'var(--ok)' : 'var(--bad)' }}>
                      {r.name} · {r.text}
                    </li>
                  ))}
                </ul>
              ) : null}
            </>
          ) : null}

          {step === 4 ? (
            <>
              <p className="text-[12px] leading-5" style={{ color: 'var(--muted)' }}>
                {t('wizard.step4.body')}
              </p>
              <div className="flex items-center gap-3">
                <Button variant={settings.autoLaunch ? 'accent' : 'default'} onClick={() => void answerAutoLaunch(true)}>
                  {t('wizard.step4.launchYes')}
                </Button>
                <Button variant="default" onClick={() => void answerAutoLaunch(false)}>
                  {t('wizard.step4.launchNo')}
                </Button>
                <span className="text-[11px]" style={{ color: 'var(--muted)' }}>
                  {t('wizard.step4.launchHint')}
                </span>
              </div>
              <div className="flex flex-col gap-1 rounded-md p-3 text-[12px]" style={{ border: '1px solid var(--line)' }}>
                <div className="mb-1 font-semibold">{t('wizard.step4.summary')}</div>
                {summaryLines({ ...facts, autoLaunch: settings.autoLaunch }, settings.libraryMode, hotkeyLabel(settings.globalHotkey)).map(
                  (l) => (
                    <div key={l.key} className="flex items-start justify-between gap-4">
                      <span style={{ color: 'var(--muted)' }}>
                        {summaryLabel(t, l.key)}
                        {l.touchesDisk ? <span style={{ color: 'var(--warn)' }}> · {t('wizard.touchesDisk')}</span> : null}
                      </span>
                      <span className="break-all text-right">
                        {l.key === 'mode'
                          ? t(l.value === 'adopt' ? 'wizard.step1.adoptShort' : 'wizard.step1.freshShort')
                          : l.key === 'autoLaunch'
                            ? t(l.value === 'on' ? 'wizard.step4.launchYes' : 'wizard.step4.launchNo')
                            : l.value}
                      </span>
                    </div>
                  )
                )}
              </div>
            </>
          ) : null}
        </div>
      </div>

      <div className="flex items-center justify-between px-8 py-4" style={{ borderTop: '1px solid var(--line)' }}>
        <Button variant="ghost" onClick={() => void skip()}>
          {t('wizard.skip')}
        </Button>
        <div className="flex items-center gap-2">
          {step > 1 ? (
            <Button onClick={() => setStep((step - 1) as WizardStep)}>{t('wizard.back')}</Button>
          ) : null}
          {step < 4 ? (
            <Button
              variant="accent"
              disabled={!canLeaveStep(step, facts)}
              title={step === 1 ? t('wizard.step1.needRoot') : undefined}
              onClick={() => setStep((step + 1) as WizardStep)}
            >
              {t('wizard.next')}
            </Button>
          ) : (
            <Button variant="accent" onClick={() => void finish()}>
              {t('wizard.finish')}
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}

function ChoiceCard({ title, body, onPick }: { title: string; body: string; onPick(): void }): JSX.Element {
  const { t } = useTranslation()
  return (
    <button
      type="button"
      onClick={onPick}
      className="flex flex-1 flex-col gap-2 rounded-md p-3 text-left"
      style={{ border: '1px solid var(--line)', background: 'var(--panel)' }}
    >
      <span className="text-[12px] font-semibold">{title}</span>
      <span className="text-[11px] leading-4" style={{ color: 'var(--muted)' }}>
        {body}
      </span>
      <span className="text-[11px]" style={{ color: 'var(--accent)' }}>
        {t('wizard.step1.chooseThis')}
      </span>
    </button>
  )
}

/**
 * 摘要那几行的标签。
 *
 * 写成逐个 `t(完整键)` 字面量而不是"前缀 + 变量"拼 key：
 * `tests/renderer/i18n.spec.ts` 只认字面量，动态拼出来的前缀要单独进它的白名单，
 * 而"漏翻译在运行时才发现"正是那条用例要防的事 —— 所以宁可写六行。
 */
function summaryLabel(t: (key: string) => string, key: SummaryLine['key']): string {
  if (key === 'libraryRoot') return t('wizard.summary.libraryRoot')
  if (key === 'mode') return t('wizard.summary.mode')
  if (key === 'watched') return t('wizard.summary.watched')
  if (key === 'bridges') return t('wizard.summary.bridges')
  if (key === 'autoLaunch') return t('wizard.summary.autoLaunch')
  return t('wizard.summary.hotkey')
}

/**
 * 热键给人看的写法。
 *
 * `globalHotkey` 存的是 Electron accelerator 原文（`CommandOrControl+Alt+A`），
 * 那是注册用的契约字符串，不能改；但摘要里照抄一遍就成了天书 —— 本机是 Windows，
 * `CommandOrControl` 就是 Ctrl（活体截图里那行就是这么露馅的）。
 */
function hotkeyLabel(accelerator: string): string {
  return accelerator.replace('CommandOrControl', 'Ctrl').replace('Super', 'Win')
}
