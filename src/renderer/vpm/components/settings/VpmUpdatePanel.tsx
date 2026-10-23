import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { VpmUpdateCheckDto, VpmUpdateDownloadDto } from '../../../../shared/vpm/dto'
import { Badge, Button, Modal } from '../../../components/ui'
import { errorText, msg } from '../../../lib/msg'
import { vpmApi } from '../../api'

function size(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${Math.round(bytes / 1024)} KB`
}

/**
 * P8-C：手动更新检查。
 *
 * 三步都要用户点：检查 → 下载 → 运行安装包。没有定时器、没有静默下载、
 * 没有 hash 就不允许安装。关掉联网时按钮直接禁用，不偷偷连 github.com。
 */
export function VpmUpdatePanel({ networkAllowed }: { networkAllowed: boolean }): JSX.Element {
  const { t } = useTranslation()
  const [info, setInfo] = useState<VpmUpdateCheckDto | null>(null)
  const [downloaded, setDownloaded] = useState<VpmUpdateDownloadDto | null>(null)
  const [busy, setBusy] = useState<'check' | 'download' | 'install' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [autoTried, setAutoTried] = useState(false)

  const check = useCallback(
    async (force: boolean): Promise<void> => {
      setBusy('check')
      setError(null)
      setNotice(null)
      try {
        const next = await vpmApi.updateCheck(force)
        setInfo(next)
        if (next.errorCode) setError(msg(`vpm.errors.${next.errorCode}`, undefined, next.errorCode))
      } catch (cause) {
        setError(errorText(cause))
      } finally {
        setBusy(null)
      }
    },
    []
  )

  // 设置里勾了"打开时自动检查"才在首次挂载时查一次；否则等用户点按钮。
  useEffect(() => {
    if (autoTried || !networkAllowed) return
    setAutoTried(true)
    void (async () => {
      try {
        const prefs = await vpmApi.settingsGet()
        if (prefs.checkUpdates) await check(false)
      } catch {
        /* 设置读不到就当没勾 */
      }
    })()
  }, [autoTried, networkAllowed, check])

  const download = async (): Promise<void> => {
    setBusy('download')
    setError(null)
    setNotice(null)
    try {
      const result = await vpmApi.updateDownload()
      setDownloaded(result)
      if (result.status === 'ready') setNotice(t('vpm.update.downloaded'))
      else if (result.status === 'hash-mismatch') setError(t('vpm.update.hashMismatch'))
      else if (result.status === 'cancelled') setNotice(t('vpm.update.cancelled'))
      else setError(result.errorCode ? msg(`vpm.errors.${result.errorCode}`, undefined, result.errorCode) : t('vpm.update.busy'))
    } catch (cause) {
      setError(errorText(cause))
    } finally {
      setBusy(null)
    }
  }

  const install = async (): Promise<void> => {
    if (!downloaded?.path) return
    setBusy('install')
    setError(null)
    try {
      const result = await vpmApi.updateInstall(downloaded.path)
      if (result.ok) setNotice(t('vpm.update.installStarted'))
      else setError(t('vpm.update.installFailed'))
    } catch (cause) {
      setError(errorText(cause))
    } finally {
      setBusy(null)
      setConfirmOpen(false)
    }
  }

  const openRelease = async (): Promise<void> => {
    if (!info?.releaseUrl) return
    try {
      await vpmApi.openExternal(info.releaseUrl)
    } catch (cause) {
      setError(errorText(cause))
    }
  }

  const hasUpdate = info?.status === 'update'
  const installer = info?.installer ?? null

  return (
    <section className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[14px] font-semibold">{t('vpm.update.title')}</span>
        {info ? (
          <Badge tone={hasUpdate ? 'accent' : 'ok'}>
            {hasUpdate
              ? t('vpm.update.available', { version: info.latestVersion ?? '' })
              : t('vpm.update.upToDate')}
          </Badge>
        ) : null}
        <div className="ml-auto flex gap-2">
          {info?.releaseUrl ? (
            <Button variant="ghost" onClick={() => void openRelease()}>
              {t('vpm.update.openRelease')}
            </Button>
          ) : null}
          <Button
            variant="ghost"
            disabled={busy !== null || !networkAllowed}
            onClick={() => void check(true)}
          >
            {busy === 'check' ? t('vpm.update.checking') : t('vpm.update.check')}
          </Button>
        </div>
      </div>

      <p className="text-[12px]" style={{ color: 'var(--muted)' }}>
        {info
          ? t('vpm.update.current', { version: info.currentVersion })
          : t('vpm.update.hint')}
      </p>

      {!networkAllowed ? (
        <p className="text-[12px]" style={{ color: 'var(--warn)' }}>
          {t('vpm.update.networkOff')}
        </p>
      ) : null}

      {hasUpdate && installer ? (
        <div className="rounded border" style={{ borderColor: 'var(--line)' }}>
          <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2.5" style={{ borderColor: 'var(--line)' }}>
            <span className="font-mono text-[12px]">{installer.name}</span>
            <span className="text-[12px]" style={{ color: 'var(--muted)' }}>
              {size(installer.size)}
            </span>
            {installer.sha256 ? null : <Badge tone="warn">{t('vpm.update.noHash')}</Badge>}
            <div className="ml-auto flex gap-2">
              {downloaded?.status === 'ready' ? (
                <Button variant="accent" disabled={busy !== null} onClick={() => setConfirmOpen(true)}>
                  {t('vpm.update.runInstaller')}
                </Button>
              ) : (
                <Button
                  variant="accent"
                  disabled={busy !== null || !installer.sha256}
                  onClick={() => void download()}
                >
                  {busy === 'download' ? t('vpm.update.downloading') : t('vpm.update.download')}
                </Button>
              )}
            </div>
          </div>
          {info.notes ? (
            <div className="max-h-[180px] overflow-auto whitespace-pre-wrap px-4 py-3 text-[12px] leading-relaxed" style={{ color: 'var(--muted)' }}>
              {info.notes}
            </div>
          ) : null}
        </div>
      ) : null}

      {notice ? (
        <p className="text-[12px]" style={{ color: 'var(--ok)' }}>
          {notice}
        </p>
      ) : null}
      {error ? (
        <div className="rounded border px-3 py-2 text-[12px]" style={{ borderColor: 'var(--bad)', color: 'var(--bad)' }}>
          {error}
        </div>
      ) : null}

      <Modal
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        width={480}
        title={t('vpm.update.installConfirmTitle')}
        footer={
          <>
            <Button disabled={busy === 'install'} onClick={() => setConfirmOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button variant="accent" disabled={busy === 'install'} onClick={() => void install()}>
              {t('vpm.update.runInstaller')}
            </Button>
          </>
        }
      >
        <div className="text-[13px] leading-relaxed" style={{ color: 'var(--muted)' }}>
          {t('vpm.update.installConfirmBody', { name: installer?.name ?? '' })}
        </div>
      </Modal>
    </section>
  )
}
