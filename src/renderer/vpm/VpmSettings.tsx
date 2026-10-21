import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { VpmDataRootValidation, VpmStatus } from '../../shared/vpm/types'
import { errorText } from '../lib/msg'
import { Badge, Button, Field, Modal } from '../components/ui'

function shortHash(value: string): string {
  return value.length > 16 ? `${value.slice(0, 12)}…${value.slice(-4)}` : value
}

export function VpmSettings(): JSX.Element {
  const { t } = useTranslation()
  const [status, setStatus] = useState<VpmStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [pageError, setPageError] = useState<string | null>(null)
  const [enableOpen, setEnableOpen] = useState(false)
  const [disableOpen, setDisableOpen] = useState(false)
  const [picked, setPicked] = useState<string | null>(null)
  const [validation, setValidation] = useState<VpmDataRootValidation | null>(null)
  const [ack, setAck] = useState(false)
  const [busy, setBusy] = useState(false)
  const [dialogError, setDialogError] = useState<string | null>(null)

  const refresh = async (): Promise<void> => {
    try {
      const next = await window.a.vpm.status()
      setStatus(next)
      setPageError(null)
    } catch (error) {
      setPageError(errorText(error))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void refresh()
  }, [])

  const openEnable = (): void => {
    setPicked(null)
    setValidation(null)
    setAck(false)
    setDialogError(null)
    setEnableOpen(true)
  }

  const chooseRoot = async (): Promise<void> => {
    setDialogError(null)
    try {
      const result = await window.a.vpm.pickDataRoot()
      if (!result.path) return
      setPicked(result.path)
      setValidation(result.validation)
    } catch (error) {
      setDialogError(errorText(error))
    }
  }

  const enable = async (): Promise<void> => {
    if (!picked || !ack) return
    setBusy(true)
    setDialogError(null)
    try {
      const next = await window.a.vpm.enable(picked)
      setStatus(next)
      setEnableOpen(false)
    } catch (error) {
      setDialogError(errorText(error))
    } finally {
      setBusy(false)
    }
  }

  const disable = async (): Promise<void> => {
    setBusy(true)
    setDialogError(null)
    try {
      const next = await window.a.vpm.disable()
      setStatus(next)
      setDisableOpen(false)
    } catch (error) {
      setDialogError(errorText(error))
    } finally {
      setBusy(false)
    }
  }

  const badgeTone = status?.safeMode ? 'warn' : status?.enabled ? 'ok' : 'default'
  const badgeText = status?.safeMode
    ? t('vpm.safeMode')
    : status?.enabled
      ? t('vpm.enabled')
      : t('vpm.disabled')
  const canEnable = !!picked && ack && (validation === null || validation.ok) && !busy

  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        <h3 className="text-[14px] font-medium">{t('vpm.title')}</h3>
        {!loading && status ? <Badge tone={badgeTone}>{badgeText}</Badge> : null}
        {loading ? <span className="faint text-[11px]">{t('common.loading')}</span> : null}
      </div>
      <p className="mb-3 text-[12px] leading-relaxed" style={{ color: 'var(--muted)' }}>
        {t('vpm.intro')}
      </p>

      {pageError ? (
        <div className="mb-3 rounded border px-3 py-2 text-[12px]" style={{ borderColor: 'var(--bad)', color: 'var(--bad)' }}>
          {pageError}
          <div className="mt-2">
            <Button onClick={() => void refresh()}>{t('common.reload')}</Button>
          </div>
        </div>
      ) : null}

      {status?.safeMode ? (
        <div className="mb-3 rounded border px-3 py-2 text-[11px] leading-relaxed" style={{ borderColor: 'var(--warn)', color: 'var(--warn)' }}>
          {t('vpm.safeModeBody')}
        </div>
      ) : null}
      {status?.degraded ? (
        <div className="mb-3 rounded border px-3 py-2 text-[11px] leading-relaxed" style={{ borderColor: 'var(--warn)', color: 'var(--warn)' }}>
          {t('vpm.degradedBody')}
        </div>
      ) : null}
      {status?.configRecovered ? (
        <div className="mb-3 rounded border px-3 py-2 text-[11px] leading-relaxed" style={{ borderColor: 'var(--warn)', color: 'var(--warn)' }}>
          {t('vpm.errors.vpmConfigRecovered')}
        </div>
      ) : null}

      {status && !status.enabled ? (
        <div className="rounded border p-3" style={{ borderColor: 'var(--line)' }}>
          <div className="label mb-1.5">{t('vpm.dataRoot')}</div>
          <p className="mb-2 text-[11px] leading-relaxed" style={{ color: 'var(--muted)' }}>
            {t('vpm.dataRootHint')}
          </p>
          <p className="mb-3 text-[11px] leading-relaxed" style={{ color: 'var(--muted)' }}>
            {t('vpm.defaultOff')}
          </p>
          <Button variant="accent" onClick={openEnable} disabled={status.safeMode}>
            {t('vpm.enable')}
          </Button>
        </div>
      ) : null}

      {status?.enabled ? (
        <div>
          <Field label={t('vpm.dataRoot')} hint={status.dataRootValid ? undefined : t('vpm.dataRootUnavailable')}>
            <span className="break-all font-mono text-[11px]">{status.dataRoot ?? t('vpm.dataRootRequired')}</span>
          </Field>
          <Field label={t('vpm.snapshot')}>
            {status.rollbackSnapshot ? (
              <div className="text-[11px]">
                <div className="break-all font-mono">{status.rollbackSnapshot.path}</div>
                <div className="faint mt-0.5">
                  SHA-256 {shortHash(status.rollbackSnapshot.sha256)} · {status.rollbackSnapshot.createdAt}
                </div>
              </div>
            ) : (
              <span className="faint text-[11px]">{t('vpm.noSnapshot')}</span>
            )}
          </Field>
          <Field label={t('vpm.appVersion')}>
            <span className="faint text-[11px]">{status.appVersion || '—'}</span>
          </Field>
          <div className="mt-2 flex items-center gap-2">
            <Button onClick={() => setDisableOpen(true)} disabled={busy}>
              {t('vpm.disable')}
            </Button>
          </div>
          <div className="mt-3 rounded border px-3 py-2 text-[11px] leading-relaxed" style={{ borderColor: 'var(--line-2)', color: 'var(--muted)' }}>
            {t('vpm.placeholder')}
          </div>
        </div>
      ) : null}

      <Modal
        open={enableOpen}
        onOpenChange={(open) => {
          if (!busy) setEnableOpen(open)
        }}
        title={t('vpm.enableTitle')}
        footer={
          <>
            <Button onClick={() => setEnableOpen(false)} disabled={busy}>
              {t('common.cancel')}
            </Button>
            <Button variant="accent" onClick={() => void enable()} disabled={!canEnable}>
              {busy ? t('vpm.enabling') : t('vpm.enable')}
            </Button>
          </>
        }
      >
        <div className="space-y-3 text-[12px]">
          <div>
            <div className="label mb-1">{t('vpm.stepChoose')}</div>
            <div className="flex items-center gap-2">
              <input
                className="input font-mono"
                value={picked ?? ''}
                placeholder={t('vpm.dataRootRequired')}
                onChange={(event) => {
                  setPicked(event.target.value)
                  setValidation(null)
                  setDialogError(null)
                }}
              />
              <Button className="shrink-0 whitespace-nowrap" onClick={() => void chooseRoot()} disabled={busy}>
                {t('vpm.chooseDataRoot')}
              </Button>
            </div>
            {validation ? (
              validation.ok ? (
                <div className="mt-1 text-[11px]" style={{ color: 'var(--ok)' }}>
                  {t('vpm.validationOk')}
                </div>
              ) : (
                <div className="mt-1 text-[11px]" style={{ color: 'var(--bad)' }}>
                  {t(`vpm.errors.${validation.code}`)}
                </div>
              )
            ) : null}
            {validation?.ok
              ? validation.warnings.map((warning) => (
                  <div key={warning} className="mt-1 text-[11px]" style={{ color: 'var(--warn)' }}>
                    {t(`vpm.warnings.${warning}`)}
                  </div>
                ))
              : null}
          </div>

          <div>
            <div className="label mb-1">{t('vpm.stepConfirm')}</div>
            <label className="flex items-start gap-2 leading-relaxed" style={{ color: 'var(--muted)' }}>
              <input type="checkbox" className="mt-0.5" checked={ack} onChange={(event) => setAck(event.target.checked)} />
              <span>{t('vpm.risk')}</span>
            </label>
          </div>

          {dialogError ? (
            <div className="rounded border px-2 py-1.5 text-[11px]" style={{ borderColor: 'var(--bad)', color: 'var(--bad)' }}>
              {dialogError}
            </div>
          ) : null}
        </div>
      </Modal>

      <Modal
        open={disableOpen}
        onOpenChange={(open) => {
          if (!busy) setDisableOpen(open)
        }}
        title={t('vpm.disableTitle')}
        footer={
          <>
            <Button onClick={() => setDisableOpen(false)} disabled={busy}>
              {t('common.cancel')}
            </Button>
            <Button onClick={() => void disable()} disabled={busy}>
              {busy ? t('vpm.disabling') : t('vpm.disableConfirm')}
            </Button>
          </>
        }
      >
        <div className="text-[12px] leading-relaxed" style={{ color: 'var(--muted)' }}>
          {t('vpm.disableBody')}
          {dialogError ? (
            <div className="mt-2 rounded border px-2 py-1.5 text-[11px]" style={{ borderColor: 'var(--bad)', color: 'var(--bad)' }}>
              {dialogError}
            </div>
          ) : null}
        </div>
      </Modal>
    </div>
  )
}
