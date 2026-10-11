import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { errorText } from '../lib/msg'
import { useUi } from '../stores/ui'
import { Button, Field } from './ui'

export function DatabaseBackupPanel(): JSX.Element {
  const { t } = useTranslation()
  const toast = useUi(s => s.toast)
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState<{ path: string; bytes: number } | null>(null)
  async function backup(): Promise<void> {
    setBusy(true)
    try {
      const result = await window.a.system.backupDatabase(t('settings.databaseBackup'))
      if (!result.cancelled && result.path) {
        setSaved({ path: result.path, bytes: result.bytes })
        toast('ok', t('settings.backupDone'))
      }
    } catch (e) { toast('bad', errorText(e)) }
    finally { setBusy(false) }
  }
  return <Field label={t('settings.databaseBackup')} hint={t('settings.databaseBackupHint')}>
    <div className="flex flex-col gap-2">
      <div><Button disabled={busy} onClick={() => void backup()}>{t(busy ? 'settings.backupSaving' : 'settings.backupChoose')}</Button></div>
      {saved ? <div className="flex flex-wrap items-center gap-2 text-[12px]">
        <span className="break-all">{saved.path} · {(saved.bytes / 1048576).toFixed(2)} MB</span>
        <Button onClick={() => void window.a.system.reveal(saved.path).catch(e => toast('bad', errorText(e)))}>{t('settings.backupShow')}</Button>
      </div> : null}
    </div>
  </Field>
}
