import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { VpmStatus } from '../../shared/vpm/types'
import { errorText, msg } from '../lib/msg'
import { Badge, Button, Field } from '../components/ui'
import { vpmApi } from './api'
import { VpmWorkspace } from './VpmWorkspace'

function shortHash(value: string): string {
  return value.length > 16 ? `${value.slice(0, 12)}…${value.slice(-4)}` : value
}

/**
 * 设置 → 项目与包。
 *
 * **这里没有启用/停用按钮**（R20：项目与包随应用启动，不允许关闭）。
 * 2026-10-23（P9-D）删掉了两段**点不到的**弹窗：`enableOpen` / `disableOpen` 的
 * `Modal` 一直渲染着，但没有任何按钮能把它们打开 —— 留着会让回退手册以为
 * "界面上能停用"，而实际不能。`vpmApi.enable/disable` 仍保留在主进程/IPC 层
 * （`gate.spec.ts` 覆盖），只是没有界面入口。
 */
export function VpmSettings(): JSX.Element {
  const { t } = useTranslation()
  const [status, setStatus] = useState<VpmStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [pageError, setPageError] = useState<string | null>(null)

  const refresh = async (): Promise<void> => {
    try {
      const next = await vpmApi.status()
      setStatus(next)
      setPageError(null)
    } catch (error) {
      setPageError(errorText(error))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    const unsubscribe = vpmApi.onStatusChanged(() => void refresh())
    void refresh()
    return unsubscribe
  }, [])

  const badgeTone = status?.safeMode ? 'warn' : status?.enabled ? 'ok' : 'default'
  const badgeText = status?.safeMode
    ? t('vpm.safeMode')
    : status?.enabled
      ? t('vpm.enabled')
      : t('vpm.disabled')

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
        <div
          className="mb-3 rounded border px-3 py-2 text-[12px]"
          style={{ borderColor: 'var(--bad)', color: 'var(--bad)' }}
        >
          {pageError}
          <div className="mt-2">
            <Button onClick={() => void refresh()}>{t('common.reload')}</Button>
          </div>
        </div>
      ) : null}

      {status?.safeMode ? (
        <div
          className="mb-3 rounded border px-3 py-2 text-[11px] leading-relaxed"
          style={{ borderColor: 'var(--warn)', color: 'var(--warn)' }}
        >
          {t('vpm.safeModeBody')}
        </div>
      ) : null}
      {status?.degraded ? (
        <div
          className="mb-3 rounded border px-3 py-2 text-[11px] leading-relaxed"
          style={{ borderColor: 'var(--warn)', color: 'var(--warn)' }}
        >
          {t('vpm.degradedBody')}
          {status.degradedCode ? (
            <div className="mt-1">
              {msg(`vpm.errors.${status.degradedCode}`, undefined, status.degradedCode)}
            </div>
          ) : null}
        </div>
      ) : null}
      {status?.configRecovered ? (
        <div
          className="mb-3 rounded border px-3 py-2 text-[11px] leading-relaxed"
          style={{ borderColor: 'var(--warn)', color: 'var(--warn)' }}
        >
          {t('vpm.errors.vpmConfigRecovered')}
        </div>
      ) : null}

      {status?.enabled ? (
        <div>
          <Field label={t('vpm.snapshot')}>
            {status.rollbackSnapshot ? (
              <div className="text-[11px]">
                <div className="break-all font-mono">{status.rollbackSnapshot.path}</div>
                <div className="faint mt-0.5">
                  SHA-256 {shortHash(status.rollbackSnapshot.sha256)} ·{' '}
                  {status.rollbackSnapshot.createdAt}
                </div>
              </div>
            ) : (
              <span className="faint text-[11px]">{t('vpm.noSnapshot')}</span>
            )}
          </Field>
          <Field label={t('vpm.appVersion')}>
            <span className="faint text-[11px]">{status.appVersion || '—'}</span>
          </Field>
          {!status.safeMode && !status.degraded ? <VpmWorkspace enabled={status.enabled} /> : null}
        </div>
      ) : null}
    </div>
  )
}
