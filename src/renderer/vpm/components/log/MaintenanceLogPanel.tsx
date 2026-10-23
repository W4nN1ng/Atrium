import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '../../../components/ui'
import { errorText } from '../../../lib/msg'
import { formatTimestamp } from '../../lib/view'
import { vpmApi } from '../../api'

type Usage = { cache: { bytes: number }; vault: { bytes: number }; backups: { bytes: number } }
type Entry = { id: string; projectName: string; kind: string; status: string; createdAt: number; errorCode: string | null; failedStep: string | null }

function size(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`
}

/** P8-B：用量、诊断导出、清缓存、最近操作。 */
export function MaintenanceLogPanel(): JSX.Element {
  const { t } = useTranslation()
  const [usage, setUsage] = useState<Usage | null>(null)
  const [entries, setEntries] = useState<Entry[]>([])
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (): Promise<void> => {
    try {
      const [nextUsage, nextEntries] = await Promise.all([vpmApi.usageSnapshot(), vpmApi.logRecent(8)])
      setUsage(nextUsage)
      setEntries(nextEntries)
    } catch (cause) {
      setError(errorText(cause))
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const run = async (task: () => Promise<string>): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      setNotice(await task())
      await load()
    } catch (cause) {
      setError(errorText(cause))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[14px] font-semibold">{t('vpm.log.title')}</span>
        <div className="ml-auto flex gap-2">
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                const result = await vpmApi.diagnosticsExport()
                return t('vpm.log.exported', { path: result.path })
              })
            }
          >
            {t('vpm.log.export')}
          </Button>
          <Button
            variant="ghost"
            disabled={busy || !usage}
            onClick={() =>
              void run(async () => {
                const result = await vpmApi.cacheClear()
                return t('vpm.log.cleared', { size: size(result.removedBytes) })
              })
            }
          >
            {t('vpm.log.clearCache')}
          </Button>
        </div>
      </div>
      {usage ? (
        <p className="text-[11px]" style={{ color: 'var(--muted)' }}>
          {t('vpm.log.usage', {
            cache: size(usage.cache.bytes),
            vault: size(usage.vault.bytes),
            backups: size(usage.backups.bytes)
          })}
        </p>
      ) : null}
      {notice ? <p className="text-[11px]" style={{ color: 'var(--ok)' }}>{notice}</p> : null}
      {error ? (
        <div className="rounded border px-3 py-2 text-[11px]" style={{ borderColor: 'var(--bad)', color: 'var(--bad)' }}>
          {error}
        </div>
      ) : null}
      {entries.length ? (
        <div className="rounded border" style={{ borderColor: 'var(--line)' }}>
          {entries.map((entry) => (
            <div
              key={entry.id}
              className="flex flex-wrap items-center gap-2 border-b px-3 py-1.5 text-[11px] last:border-b-0"
              style={{ borderColor: 'var(--line)' }}
            >
              <span>{formatTimestamp(entry.createdAt)}</span>
              <span style={{ color: 'var(--muted)' }}>{entry.projectName}</span>
              <span>{entry.kind}</span>
              <span style={{ color: entry.errorCode ? 'var(--bad)' : 'var(--ok)' }}>
                {entry.errorCode ?? entry.status}
              </span>
              {entry.failedStep ? <span style={{ color: 'var(--bad)' }}>{entry.failedStep}</span> : null}
            </div>
          ))}
        </div>
      ) : null}
    </section>
  )
}
