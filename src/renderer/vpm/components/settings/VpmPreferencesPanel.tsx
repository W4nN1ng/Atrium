import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { VpmPreferencesDto, VpmPreferencesPatch } from '../../../../shared/vpm/dto'
import { Button, Modal, Switch } from '../../../components/ui'
import { errorText } from '../../../lib/msg'
import { vpmApi } from '../../api'

/** 一行设置：左标题右控件；提示只在必要时出现，不铺一堆小字。 */
function Row({
  label,
  hint,
  children
}: {
  label: string
  hint?: string
  children: React.ReactNode
}): JSX.Element {
  return (
    <div
      className="flex items-center justify-between gap-4 border-b px-4 py-3 last:border-b-0"
      style={{ borderColor: 'var(--line)' }}
    >
      <div className="min-w-0">
        <div className="text-[13px]">{label}</div>
        {hint ? (
          <div className="mt-0.5 text-[12px]" style={{ color: 'var(--muted)' }}>
            {hint}
          </div>
        ) : null}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}

function QuotaInput({
  value,
  disabled,
  onCommit
}: {
  value: number
  disabled: boolean
  onCommit: (next: number) => void
}): JSX.Element {
  const [draft, setDraft] = useState(String(value))
  useEffect(() => setDraft(String(value)), [value])
  return (
    <input
      className="input w-[88px] text-right"
      type="number"
      min={1}
      max={1024}
      value={draft}
      disabled={disabled}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => {
        const next = Math.trunc(Number(draft))
        if (!Number.isFinite(next) || next < 1 || next > 1024) {
          setDraft(String(value))
          return
        }
        if (next !== value) onCommit(next)
      }}
    />
  )
}

/**
 * P8-C：VPM 偏好设置。
 *
 * 每项改完立刻落盘（开关即时、输入框失焦时），失败回滚成服务端返回的值 ——
 * 界面上看到的永远是磁盘里真实生效的那份。
 */
export function VpmPreferencesPanel(): JSX.Element {
  const { t } = useTranslation()
  const [prefs, setPrefs] = useState<VpmPreferencesDto | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [hiddenOpen, setHiddenOpen] = useState(false)
  const [hiddenDraft, setHiddenDraft] = useState('')
  const [argsDraft, setArgsDraft] = useState('')
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const flash = useCallback((): void => {
    setSaved(true)
    if (savedTimer.current) clearTimeout(savedTimer.current)
    savedTimer.current = setTimeout(() => setSaved(false), 1500)
  }, [])

  useEffect(() => {
    return () => {
      if (savedTimer.current) clearTimeout(savedTimer.current)
    }
  }, [])

  const load = useCallback(async (): Promise<void> => {
    try {
      const next = await vpmApi.settingsGet()
      setPrefs(next)
      setArgsDraft(next.defaultUnityArgs)
      setError(null)
    } catch (cause) {
      setError(errorText(cause))
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const patch = async (value: VpmPreferencesPatch): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const next = await vpmApi.settingsPatch(value)
      setPrefs(next)
      setArgsDraft(next.defaultUnityArgs)
      flash()
    } catch (cause) {
      setError(errorText(cause))
      await load()
    } finally {
      setBusy(false)
    }
  }

  const hidden = prefs?.hiddenPackageIds ?? []

  return (
    <section className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[14px] font-semibold">{t('vpm.prefs.title')}</span>
        {saved ? (
          <span className="text-[12px]" style={{ color: 'var(--ok)' }}>
            {t('vpm.prefs.saved')}
          </span>
        ) : null}
      </div>

      {error ? (
        <div
          className="rounded border px-3 py-2 text-[12px]"
          style={{ borderColor: 'var(--bad)', color: 'var(--bad)' }}
        >
          {error}
        </div>
      ) : null}

      {prefs ? (
        <div className="rounded border" style={{ borderColor: 'var(--line)' }}>
          <Row label={t('vpm.prefs.prerelease')} hint={t('vpm.prefs.prereleaseHint')}>
            <Switch
              checked={prefs.allowPrerelease}
              ariaLabel={t('vpm.prefs.prerelease')}
              onChange={(value) => {
                if (!busy) void patch({ allowPrerelease: value })
              }}
            />
          </Row>

          <Row
            label={t('vpm.prefs.hidden')}
            hint={
              hidden.length ? t('vpm.prefs.hiddenCount', { count: hidden.length }) : t('vpm.prefs.hiddenEmpty')
            }
          >
            <Button variant="ghost" onClick={() => setHiddenOpen(true)}>
              {t('vpm.prefs.manageHidden')}
            </Button>
          </Row>

          <Row label={t('vpm.prefs.cacheQuota')} hint={t('vpm.prefs.quotaHint')}>
            <QuotaInput
              value={prefs.cacheQuotaGb}
              disabled={busy}
              onCommit={(value) => void patch({ cacheQuotaGb: value })}
            />
          </Row>

          <Row label={t('vpm.prefs.vaultQuota')} hint={t('vpm.prefs.quotaHint')}>
            <QuotaInput
              value={prefs.vaultQuotaGb}
              disabled={busy}
              onCommit={(value) => void patch({ vaultQuotaGb: value })}
            />
          </Row>

          <Row label={t('vpm.prefs.checkUpdates')} hint={t('vpm.prefs.checkUpdatesHint')}>
            <Switch
              checked={prefs.checkUpdates}
              ariaLabel={t('vpm.prefs.checkUpdates')}
              onChange={(value) => {
                if (!busy) void patch({ checkUpdates: value })
              }}
            />
          </Row>

          <div className="px-4 py-3">
            <div className="text-[13px]">{t('vpm.prefs.unityArgs')}</div>
            <div className="mt-0.5 text-[12px]" style={{ color: 'var(--muted)' }}>
              {t('vpm.prefs.unityArgsHint')}
            </div>
            <textarea
              className="input mt-2 w-full font-mono text-[12px]"
              rows={2}
              value={argsDraft}
              disabled={busy}
              placeholder="-screen-fullscreen 0"
              onChange={(event) => setArgsDraft(event.target.value)}
              onBlur={() => {
                const next = argsDraft.trim()
                if (next !== prefs.defaultUnityArgs) void patch({ defaultUnityArgs: next })
              }}
            />
          </div>
        </div>
      ) : null}

      <Modal
        open={hiddenOpen}
        onOpenChange={setHiddenOpen}
        width={520}
        title={t('vpm.prefs.hidden')}
        footer={
          <Button onClick={() => setHiddenOpen(false)}>{t('common.close')}</Button>
        }
      >
        <div className="space-y-3 text-[13px]">
          <div className="flex items-center gap-2">
            <input
              className="input font-mono text-[12px]"
              value={hiddenDraft}
              placeholder={t('vpm.prefs.hiddenAdd')}
              onChange={(event) => setHiddenDraft(event.target.value)}
            />
            <Button
              className="shrink-0 whitespace-nowrap"
              disabled={busy || !hiddenDraft.trim()}
              onClick={() => {
                const id = hiddenDraft.trim()
                if (!id || hidden.includes(id)) {
                  setHiddenDraft('')
                  return
                }
                setHiddenDraft('')
                void patch({ hiddenPackageIds: [...hidden, id] })
              }}
            >
              {t('vpm.prefs.add')}
            </Button>
          </div>

          {hidden.length ? (
            <div className="rounded border" style={{ borderColor: 'var(--line)' }}>
              {hidden.map((id) => (
                <div
                  key={id}
                  className="flex items-center justify-between gap-3 border-b px-3 py-2 last:border-b-0"
                  style={{ borderColor: 'var(--line)' }}
                >
                  <span className="truncate font-mono text-[12px]">{id}</span>
                  <Button
                    variant="ghost"
                    disabled={busy}
                    onClick={() => void patch({ hiddenPackageIds: hidden.filter((item) => item !== id) })}
                  >
                    {t('vpm.prefs.unhide')}
                  </Button>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-[12px]" style={{ color: 'var(--muted)' }}>
              {t('vpm.prefs.hiddenEmpty')}
            </div>
          )}
        </div>
      </Modal>
    </section>
  )
}
