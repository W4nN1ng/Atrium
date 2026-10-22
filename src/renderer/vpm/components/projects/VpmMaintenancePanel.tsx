import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type {
  VpmBackupDto,
  VpmProjectDetailDto,
  VpmUnityInstallDto
} from '../../../../shared/vpm/dto'
import { Badge, Button, Field, Modal } from '../../../components/ui'
import { errorText } from '../../../lib/msg'
import { cleanText, formatTimestamp } from '../../lib/view'
import { vpmApi } from '../../api'

/**
 * 工程维护面板（P6-D 的 UI 部分）：备份 / 复制 / 换版本 / 旧式迁移。
 *
 * 按钮纪律：这里**没有**实心主按钮——工程详情的主按钮是"打开 Unity"，
 * 维护动作全部是次要按钮，危险动作（换版本、迁移）都走二次确认。
 */
export function VpmMaintenancePanel({
  projectKey,
  detail,
  onChanged
}: {
  projectKey: string
  detail: VpmProjectDetailDto
  onChanged: () => void
}): JSX.Element {
  const { t } = useTranslation()
  const [backups, setBackups] = useState<VpmBackupDto[]>([])
  const [backupBusy, setBackupBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copyOpen, setCopyOpen] = useState(false)
  const [copyParent, setCopyParent] = useState('')
  const [copyName, setCopyName] = useState('')
  const [copyBusy, setCopyBusy] = useState(false)
  const [versionOpen, setVersionOpen] = useState(false)
  const [editors, setEditors] = useState<VpmUnityInstallDto[]>([])
  const [targetVersion, setTargetVersion] = useState('')
  const [versionBusy, setVersionBusy] = useState(false)
  const [migrateOpen, setMigrateOpen] = useState(false)
  const [migrateSelected, setMigrateSelected] = useState<Set<string>>(new Set())
  const [migrateBusy, setMigrateBusy] = useState(false)

  const loadBackups = useCallback(async (): Promise<void> => {
    try {
      setBackups(await vpmApi.backupList(projectKey))
    } catch (cause) {
      setError(errorText(cause))
    }
  }, [projectKey])

  useEffect(() => {
    void loadBackups()
  }, [loadBackups])

  const createBackup = async (): Promise<void> => {
    setBackupBusy(true)
    setError(null)
    setNotice(null)
    try {
      const record = await vpmApi.backupCreate({ projectKey, compression: 'normal' })
      setNotice(t('vpm.maintenance.backupDone', { size: formatBytes(record.size ?? 0) }))
      await loadBackups()
    } catch (cause) {
      setError(errorText(cause))
    } finally {
      setBackupBusy(false)
    }
  }

  const reveal = async (id: string): Promise<void> => {
    try {
      const result = await vpmApi.backupReveal(id)
      if (!result.ok) setError(t('vpm.maintenance.revealFailed'))
    } catch (cause) {
      setError(errorText(cause))
    }
  }

  const openCopy = async (): Promise<void> => {
    setCopyName(`${detail.name}-copy`)
    setCopyParent('')
    setError(null)
    setCopyOpen(true)
  }

  const submitCopy = async (): Promise<void> => {
    if (!copyParent.trim() || !copyName.trim()) return
    setCopyBusy(true)
    setError(null)
    try {
      const result = await vpmApi.projectCopy({
        projectKey,
        targetDir: `${copyParent.trim().replace(/[\\/]+$/, '')}\\${copyName.trim()}`
      })
      setCopyOpen(false)
      setNotice(t('vpm.maintenance.copyDone', { files: result.files }))
      onChanged()
    } catch (cause) {
      setError(errorText(cause))
    } finally {
      setCopyBusy(false)
    }
  }

  const openVersion = async (): Promise<void> => {
    setError(null)
    setTargetVersion(detail.unityVersion ?? '')
    setVersionOpen(true)
    try {
      const list = await vpmApi.unityInstalls()
      setEditors(list.filter((item) => !item.missing && item.version))
    } catch {
      setEditors([])
    }
  }

  const submitVersion = async (): Promise<void> => {
    if (!targetVersion.trim()) return
    setVersionBusy(true)
    setError(null)
    try {
      const result = await vpmApi.projectVersionChange({
        projectKey,
        unityVersion: targetVersion.trim(),
        backupFirst: true
      })
      setVersionOpen(false)
      setNotice(
        result.downgrade
          ? t('vpm.maintenance.versionDowngraded', { from: result.previous, to: result.next })
          : t('vpm.maintenance.versionChanged', { from: result.previous, to: result.next })
      )
      onChanged()
    } catch (cause) {
      setError(errorText(cause))
    } finally {
      setVersionBusy(false)
    }
  }

  const candidates = detail.legacy.candidates.filter(
    (item) => item.match === 'packageJson' || item.match === 'legacyFolder'
  )

  const openMigrate = (): void => {
    setMigrateSelected(new Set())
    setError(null)
    setMigrateOpen(true)
  }

  const submitMigrate = async (): Promise<void> => {
    setMigrateBusy(true)
    setError(null)
    try {
      const picked = candidates.filter((item) =>
        migrateSelected.has(candidateKey(item.name, item.relativePath))
      )
      const result = await vpmApi.projectMigrate({
        projectKey,
        candidates: picked.map((item) => ({
          packageId: item.name,
          relativePath: item.relativePath,
          confidence: item.confidence
        }))
      })
      setMigrateOpen(false)
      setNotice(
        t('vpm.maintenance.migrateDone', {
          installed: result.installed.length,
          skipped: result.skipped.length,
          failed: result.failed.length
        })
      )
      onChanged()
    } catch (cause) {
      setError(errorText(cause))
    } finally {
      setMigrateBusy(false)
    }
  }

  return (
    <section className="space-y-2" data-vpm-maintenance>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[12px] font-medium">{t('vpm.maintenance.title')}</span>
        <Badge>{t('vpm.maintenance.backupCount', { count: backups.filter((item) => item.status === 'ok').length })}</Badge>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="ghost" disabled={backupBusy} onClick={() => void createBackup()}>
          {backupBusy ? t('vpm.maintenance.backingUp') : t('vpm.maintenance.backupNow')}
        </Button>
        <Button variant="ghost" disabled={detail.running} onClick={() => void openCopy()} title={detail.running ? t('vpm.maintenance.unityRunning') : undefined}>
          {t('vpm.maintenance.copy')}
        </Button>
        <Button variant="ghost" disabled={detail.running} onClick={() => void openVersion()} title={detail.running ? t('vpm.maintenance.unityRunning') : undefined}>
          {t('vpm.maintenance.changeVersion')}
        </Button>
        {candidates.length ? (
          <Button variant="ghost" disabled={detail.running} onClick={openMigrate}>
            {t('vpm.maintenance.migrate', { count: candidates.length })}
          </Button>
        ) : null}
      </div>

      {detail.running ? (
        <p className="text-[11px]" style={{ color: 'var(--warn)' }}>
          {t('vpm.maintenance.unityRunning')}
        </p>
      ) : null}
      {notice ? (
        <p className="text-[11px]" style={{ color: 'var(--ok)' }}>
          {notice}
        </p>
      ) : null}
      {error ? (
        <div className="rounded border px-3 py-2 text-[11px]" style={{ borderColor: 'var(--bad)', color: 'var(--bad)' }}>
          {error}
        </div>
      ) : null}

      {backups.length ? (
        <div className="rounded border" style={{ borderColor: 'var(--line)' }}>
          {backups.slice(0, 5).map((item) => (
            <div
              key={item.id}
              className="flex flex-wrap items-center gap-2 border-b px-3 py-1.5 last:border-b-0"
              style={{ borderColor: 'var(--line)' }}
            >
              <Badge tone={item.status === 'ok' ? 'ok' : item.status === 'failed' ? 'bad' : 'warn'}>
                {t(`vpm.maintenance.status.${item.status}`)}
              </Badge>
              <span className="faint text-[10px]">{formatTimestamp(item.createdAt)}</span>
              <span className="faint text-[10px]">{formatBytes(item.size ?? 0)}</span>
              {item.errorCode ? (
                <span className="faint font-mono text-[10px]">{item.errorCode}</span>
              ) : null}
              <span className="ml-auto">
                <Button variant="ghost" disabled={item.status !== 'ok'} onClick={() => void reveal(item.id)}>
                  {t('vpm.maintenance.reveal')}
                </Button>
              </span>
            </div>
          ))}
        </div>
      ) : (
        <p className="faint text-[11px]">{t('vpm.maintenance.noBackups')}</p>
      )}

      <Modal
        open={copyOpen}
        onOpenChange={(open) => {
          if (!copyBusy) setCopyOpen(open)
        }}
        title={t('vpm.maintenance.copyTitle')}
        footer={
          <>
            <Button onClick={() => setCopyOpen(false)} disabled={copyBusy}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="accent"
              onClick={() => void submitCopy()}
              disabled={copyBusy || !copyParent.trim() || !copyName.trim()}
            >
              {copyBusy ? t('vpm.maintenance.copying') : t('vpm.maintenance.copy')}
            </Button>
          </>
        }
      >
        <div className="space-y-3 text-[12px]">
          <p className="faint text-[11px] leading-relaxed">{t('vpm.maintenance.copyHint')}</p>
          <Field label={t('vpm.maintenance.copyParent')}>
            <div className="flex gap-2">
              <input
                className="input flex-1 font-mono"
                value={copyParent}
                placeholder="E:\\projects"
                onChange={(event) => setCopyParent(event.target.value)}
              />
              <Button
                variant="ghost"
                onClick={async () => {
                  const picked = await vpmApi.pickProjectDirectory(t('vpm.maintenance.copyParent'))
                  if (picked) setCopyParent(picked)
                }}
              >
                {t('vpm.create.pick')}
              </Button>
            </div>
          </Field>
          <Field label={t('vpm.maintenance.copyName')}>
            <input
              className="input"
              value={copyName}
              onChange={(event) => setCopyName(event.target.value)}
            />
          </Field>
        </div>
      </Modal>

      <Modal
        open={versionOpen}
        onOpenChange={(open) => {
          if (!versionBusy) setVersionOpen(open)
        }}
        title={t('vpm.maintenance.versionTitle')}
        footer={
          <>
            <Button onClick={() => setVersionOpen(false)} disabled={versionBusy}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="accent"
              onClick={() => void submitVersion()}
              disabled={versionBusy || !targetVersion.trim()}
            >
              {versionBusy ? t('vpm.maintenance.versionChanging') : t('vpm.maintenance.changeVersion')}
            </Button>
          </>
        }
      >
        <div className="space-y-3 text-[12px]">
          <p className="faint text-[11px] leading-relaxed">{t('vpm.maintenance.versionHint')}</p>
          <Field label={t('vpm.create.unityVersion')}>
            <select
              className="input"
              value={targetVersion}
              onChange={(event) => setTargetVersion(event.target.value)}
            >
              {targetVersion && !editors.some((item) => item.version === targetVersion) ? (
                <option value={targetVersion}>{targetVersion}</option>
              ) : null}
              {editors.map((item) => (
                <option key={item.id} value={item.version ?? ''}>
                  {item.version}
                </option>
              ))}
            </select>
          </Field>
          <p className="text-[11px]" style={{ color: 'var(--warn)' }}>
            {t('vpm.maintenance.versionWarning')}
          </p>
        </div>
      </Modal>

      <Modal
        open={migrateOpen}
        onOpenChange={(open) => {
          if (!migrateBusy) setMigrateOpen(open)
        }}
        title={t('vpm.maintenance.migrateTitle')}
        footer={
          <>
            <Button onClick={() => setMigrateOpen(false)} disabled={migrateBusy}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="accent"
              onClick={() => void submitMigrate()}
              disabled={migrateBusy || migrateSelected.size === 0}
            >
              {migrateBusy ? t('vpm.maintenance.migrating') : t('vpm.maintenance.migrateSelected')}
            </Button>
          </>
        }
      >
        <div className="space-y-2 text-[12px]">
          <p className="faint text-[11px] leading-relaxed">{t('vpm.maintenance.migrateHint')}</p>
          {candidates.map((item) => {
            const key = candidateKey(item.name, item.relativePath)
            return (
              <label key={key} className="flex items-start gap-2 rounded border px-3 py-2" style={{ borderColor: 'var(--line)' }}>
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={migrateSelected.has(key)}
                  onChange={(event) => {
                    setMigrateSelected((current) => {
                      const next = new Set(current)
                      if (event.target.checked) next.add(key)
                      else next.delete(key)
                      return next
                    })
                  }}
                />
                <span className="min-w-0 flex-1">
                  <span className="block break-all font-mono text-[11px]">
                    {cleanText(item.name ?? item.relativePath ?? '—', 200)}
                  </span>
                  <span className="faint text-[10px]">
                    {t(`vpm.projects.match.${item.match}`)} · {t(`vpm.projects.confidence.${item.confidence}`)}
                  </span>
                </span>
              </label>
            )
          })}
        </div>
      </Modal>
    </section>
  )
}

function candidateKey(name: string | null, relativePath: string | null): string {
  return `${name ?? ''}\0${relativePath ?? ''}`
}

function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  let size = value
  let index = 0
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024
    index++
  }
  return `${size.toFixed(index === 0 ? 0 : 1)} ${units[index]}`
}
