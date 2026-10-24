import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { VpmTemplateDto } from '../../../../shared/vpm/dto'
import { Badge, Button, Modal } from '../../../components/ui'
import { errorText } from '../../../lib/msg'
import { cleanText } from '../../lib/view'
import { vpmApi } from '../../api'

interface Peek {
  path: string
  exists: boolean
  parseError: boolean
  repos: Array<{ url: string; name: string | null }>
  packageFolders: string[]
  unityHint: string | null
  skipped: Array<{ value: string; reason: string }>
}

/**
 * 互操作（P7-D）：从 VCC/ALCOM 只读导入 + 模板导入/导出。
 *
 * 导入前一定先「看一眼」：把找到的仓库数、目录数、被跳过的条目摆出来，
 * 用户勾选后才真正写进 Atrium——不偷偷改别人的设置，也不偷偷加信任。
 */
export function InteropPanel(): JSX.Element {
  const { t } = useTranslation()
  const [peek, setPeek] = useState<Peek | null>(null)
  const [open, setOpen] = useState(false)
  const [wantRepos, setWantRepos] = useState(true)
  const [wantFolders, setWantFolders] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [templates, setTemplates] = useState<VpmTemplateDto[]>([])

  const loadTemplates = useCallback(async (): Promise<void> => {
    try {
      setTemplates((await vpmApi.templateList()).filter((item) => !item.builtin && item.visible))
    } catch {
      /* 模板列表拿不到不影响导入 VCC */
    }
  }, [])

  useEffect(() => {
    void loadTemplates()
  }, [loadTemplates])

  const openPeek = async (): Promise<void> => {
    setError(null)
    setNotice(null)
    setOpen(true)
    try {
      setPeek(await vpmApi.interopVccPeek())
    } catch (cause) {
      setError(errorText(cause))
    }
  }

  const apply = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const result = await vpmApi.interopVccApply({ repos: wantRepos, folders: wantFolders })
      setNotice(
        t('vpm.interop.imported', { repos: result.addedRepos, folders: result.addedFolders })
      )
      setOpen(false)
    } catch (cause) {
      setError(errorText(cause))
    } finally {
      setBusy(false)
    }
  }

  const importTemplate = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const result = await vpmApi.templateImport({})
      if (!result.cancelled) {
        setNotice(t('vpm.interop.templateImported', { name: result.name }))
        await loadTemplates()
      }
    } catch (cause) {
      setError(errorText(cause))
    } finally {
      setBusy(false)
    }
  }

  const exportTemplate = async (id: string): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const result = await vpmApi.templateExport({ id })
      if (!result.cancelled) setNotice(t('vpm.interop.templateExported', { path: result.path }))
    } catch (cause) {
      setError(errorText(cause))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[14px] font-semibold">{t('vpm.interop.title')}</span>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Button variant="ghost" disabled={busy} onClick={() => void openPeek()}>
            {t('vpm.interop.fromVcc')}
          </Button>
          <Button variant="ghost" disabled={busy} onClick={() => void importTemplate()}>
            {t('vpm.interop.importTemplate')}
          </Button>
        </div>
      </div>
      <p className="text-[11px]" style={{ color: 'var(--muted)' }}>
        {t('vpm.interop.hint')}
      </p>

      {notice ? (
        <p className="text-[11px]" style={{ color: 'var(--ok)' }}>
          {notice}
        </p>
      ) : null}
      {error ? (
        <div
          className="rounded border px-3 py-2 text-[11px]"
          style={{ borderColor: 'var(--bad)', color: 'var(--bad)' }}
        >
          {error}
        </div>
      ) : null}

      {templates.length ? (
        <div className="rounded border" style={{ borderColor: 'var(--line)' }}>
          {templates.map((template) => (
            <div
              key={template.id}
              className="flex items-center gap-2 border-b px-3 py-2 last:border-b-0"
              style={{ borderColor: 'var(--line)' }}
            >
              <span className="min-w-0 flex-1 truncate text-[12px]">{cleanText(template.name, 120)}</span>
              <Badge>{Object.keys(template.dependencies).length}</Badge>
              <Button variant="ghost" disabled={busy} onClick={() => void exportTemplate(template.id)}>
                {t('vpm.interop.exportTemplate')}
              </Button>
            </div>
          ))}
        </div>
      ) : null}

      <Modal
        open={open}
        onOpenChange={(next) => {
          if (!busy) setOpen(next)
        }}
        title={t('vpm.interop.peekTitle')}
        footer={
          <>
            <Button onClick={() => setOpen(false)} disabled={busy}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="accent"
              onClick={() => void apply()}
              disabled={busy || !peek?.exists || peek.parseError}
            >
              {busy ? t('vpm.interop.importing') : t('vpm.interop.apply')}
            </Button>
          </>
        }
      >
        <div className="space-y-2 text-[12px]">
          {!peek ? (
            <p className="faint">{t('common.loading')}</p>
          ) : !peek.exists ? (
            <p style={{ color: 'var(--muted)' }}>{t('vpm.interop.notFound', { path: peek.path })}</p>
          ) : peek.parseError ? (
            <p style={{ color: 'var(--bad)' }}>{t('vpm.interop.parseError')}</p>
          ) : (
            <>
              <div className="break-all font-mono text-[11px]" style={{ color: 'var(--faint)' }}>
                {peek.path}
              </div>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={wantRepos}
                  onChange={(event) => setWantRepos(event.target.checked)}
                />
                <span>{t('vpm.interop.repos', { count: peek.repos.length })}</span>
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={wantFolders}
                  onChange={(event) => setWantFolders(event.target.checked)}
                />
                <span>{t('vpm.interop.folders', { count: peek.packageFolders.length })}</span>
              </label>
              {peek.skipped.length ? (
                <p className="text-[11px]" style={{ color: 'var(--muted)' }}>
                  {t('vpm.interop.skipped', { count: peek.skipped.length })}
                </p>
              ) : null}
            </>
          )}
        </div>
      </Modal>
    </section>
  )
}
