import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type {
  VpmRecentLocationDto,
  VpmTemplateDto,
  VpmUnityInstallDto
} from '../../../../shared/vpm/dto'
import { Badge, Button, Field, Modal } from '../../../components/ui'
import { errorParts, errorText } from '../../../lib/msg'
import { cleanText } from '../../lib/view'
import { vpmApi } from '../../api'

function baseName(value: string): string {
  const parts = value.split(/[\\/]/)
  return parts[parts.length - 1] || value
}

/**
 * 新建工程对话框（P5-D）。
 *
 * 两步压成一屏：模板卡片 → 名称/位置/版本 → "创建"。真正的校验与写盘都在主进程，
 * 这里只做选择与错误展示；创建失败不假装成功。
 */
export function VpmCreateProjectDialog({
  open,
  onOpenChange,
  onCreated
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: (projectKey: string) => void
}): JSX.Element {
  const { t } = useTranslation()
  const [templates, setTemplates] = useState<VpmTemplateDto[]>([])
  const [recent, setRecent] = useState<VpmRecentLocationDto[]>([])
  const [editors, setEditors] = useState<VpmUnityInstallDto[]>([])
  const [templateId, setTemplateId] = useState('builtin.blank')
  const [name, setName] = useState('')
  const [parentDir, setParentDir] = useState('')
  const [unityVersion, setUnityVersion] = useState('')
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [warning, setWarning] = useState<string | null>(null)
  const [parentNotice, setParentNotice] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoading(true)
    setError(null)
    setWarning(null)
    Promise.all([vpmApi.templateList(), vpmApi.templateRecent(), vpmApi.unityInstalls()])
      .then(([list, locations, installs]) => {
        if (cancelled) return
        setTemplates(list.filter((item) => item.visible && !item.broken))
        setRecent(locations)
        const usable = installs.filter((item) => !item.missing)
        setEditors(usable)
        const first = usable.find((item) => item.version)
        // 没探测到编辑器时给一个可编辑的默认值（2022.3.22f1 是唯一验证过的版本）
        setUnityVersion((current) => current || first?.version || '2022.3.22f1')
        if (locations[0]) setParentDir((current) => current || locations[0].path)
        if (usable.length === 0) {
          void vpmApi
            .unityRefresh()
            .then((refreshed) => {
              if (cancelled) return
              const next = refreshed.filter((item) => !item.missing)
              setEditors(next)
              const discovered = next.find((item) => item.version)
              if (discovered?.version) setUnityVersion(discovered.version)
            })
            .catch(() => undefined)
        }
      })
      .catch((cause) => {
        if (!cancelled) setError(errorText(cause))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open])

  const selected = templates.find((item) => item.id === templateId) ?? null

  /**
   * R14：位置归一化。用户（尤其同时装了 ALCOM 的人）很容易把"某个工程目录"
   * 当成"工程根"选进来；这里不报错，直接上移一级并说明改了什么。
   */
  const applyParent = async (raw: string): Promise<void> => {
    const value = raw.trim()
    if (!value) return
    try {
      const result = await vpmApi.projectParentCheck(value)
      setParentDir(result.parent)
      setParentNotice(
        result.adjustedFrom
          ? t('vpm.create.parentAdjusted', {
              name: baseName(result.adjustedFrom),
              parent: result.parent
            })
          : null
      )
    } catch {
      setParentDir(value)
      setParentNotice(null)
    }
  }

  const pickParent = async (): Promise<void> => {
    setError(null)
    try {
      const picked = await vpmApi.pickProjectDirectory(t('vpm.create.pickParent'))
      if (picked) await applyParent(picked)
    } catch (cause) {
      setError(errorText(cause))
    }
  }

  const toggleFavorite = async (template: VpmTemplateDto): Promise<void> => {
    if (template.builtin) return
    try {
      const next = await vpmApi.templateFavorite({ id: template.id, favorite: !template.favorite })
      setTemplates((current) => current.map((item) => (item.id === next.id ? next : item)))
    } catch (cause) {
      setError(errorText(cause))
    }
  }

  const submit = async (): Promise<void> => {
    setError(null)
    setWarning(null)
    setBusy(true)
    try {
      const result = await vpmApi.projectCreate({
        parentDir: parentDir.trim(),
        name: name.trim(),
        unityVersion: unityVersion.trim(),
        templateId
      })
      if (result.dependencyStatus === 'failed') {
        // 工程建出来了，但依赖没装完：不关窗，让用户看到原因。
        setWarning(t('vpm.create.dependenciesFailed'))
        onCreated(result.projectKey)
        return
      }
      onCreated(result.projectKey)
      onOpenChange(false)
    } catch (cause) {
      // vpmCreateRejected 的 reason 是一串代码（targetExists,parentUnsafe…），
      // 直接显示代码用户看不懂，这里逐条翻译。
      const { key, params } = errorParts(cause)
      const reason = typeof params.reason === 'string' ? params.reason : ''
      if (key === 'vpm.errors.vpmCreateRejected' && reason) {
        const lines = reason
          .split(',')
          .filter(Boolean)
          .map((code) => t(`vpm.create.reason.${code}`, { defaultValue: code }))
        setError(lines.join('；'))
      } else {
        setError(errorText(cause))
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onOpenChange={(next) => {
        if (!busy) onOpenChange(next)
      }}
      title={t('vpm.create.title')}
      footer={
        <>
          <Button onClick={() => onOpenChange(false)} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="accent"
            disabled={busy || !name.trim() || !parentDir.trim() || !unityVersion.trim()}
            onClick={() => void submit()}
          >
            {busy ? t('vpm.create.creating') : t('vpm.create.submit')}
          </Button>
        </>
      }
    >
      <div className="space-y-3 text-[12px]">
        <p className="faint text-[11px] leading-relaxed">{t('vpm.create.intro')}</p>

        <section>
          <div className="mb-1 flex items-center gap-2">
            <span className="text-[12px] font-medium">{t('vpm.create.template')}</span>
            {loading ? <span className="faint text-[10px]">{t('vpm.create.loading')}</span> : null}
          </div>
          <div className="grid max-h-[34vh] gap-2 overflow-y-auto sm:grid-cols-2" data-vpm-template-cards>
            {templates.map((template) => (
              <button
                key={template.id}
                type="button"
                className="rounded border px-3 py-2 text-left"
                style={{
                  borderColor: template.id === templateId ? 'var(--accent)' : 'var(--line)',
                  background: template.id === templateId ? 'var(--raise)' : 'transparent'
                }}
                onClick={() => setTemplateId(template.id)}
              >
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[12px] font-medium">{cleanText(template.name, 80)}</span>
                  {template.builtin ? <Badge>{t('vpm.create.builtin')}</Badge> : null}
                  {template.favorite ? <Badge tone="accent">{t('vpm.create.favorite')}</Badge> : null}
                  <span className="faint text-[10px]">
                    {t('vpm.create.counts', {
                      deps: Object.keys(template.dependencies).length,
                      files: template.unitypackages.length
                    })}
                  </span>
                </div>
                <div className="faint mt-1 line-clamp-2 text-[10px]">
                  {cleanText(template.description ?? '', 160)}
                </div>
                <div className="faint mt-1 flex items-center gap-2 text-[10px]">
                  <span>{`Unity ${template.unity.min}${template.unity.max ? ` – ${template.unity.max}` : '+'}`}</span>
                  {template.builtin ? null : (
                    <span
                      role="button"
                      tabIndex={0}
                      className="underline"
                      onClick={(event) => {
                        event.stopPropagation()
                        void toggleFavorite(template)
                      }}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.stopPropagation()
                          void toggleFavorite(template)
                        }
                      }}
                    >
                      {template.favorite ? t('vpm.create.unfavorite') : t('vpm.create.setFavorite')}
                    </span>
                  )}
                </div>
              </button>
            ))}
          </div>
        </section>

        <Field label={t('vpm.create.name')} hint={t('vpm.create.nameHint')}>
          <input
            className="input"
            value={name}
            placeholder="MyProject"
            onChange={(event) => setName(event.target.value)}
          />
        </Field>

        <Field label={t('vpm.create.parent')} hint={t('vpm.create.parentHint')}>
          <div className="flex gap-2">
            <input
              className="input flex-1 font-mono"
              value={parentDir}
              placeholder="E:\\projects"
              onChange={(event) => setParentDir(event.target.value)}
            />
            <Button variant="ghost" onClick={() => void pickParent()} disabled={busy}>
              {t('vpm.create.pick')}
            </Button>
          </div>
          {parentNotice ? (
            <p className="mt-1 text-[10px]" style={{ color: 'var(--muted)' }}>
              {parentNotice}
            </p>
          ) : null}
          {recent.length ? (
            <div className="mt-1 flex flex-wrap gap-1">
              {recent.slice(0, 4).map((item) => (
                <button
                  key={item.path}
                  type="button"
                  className="faint rounded border px-1.5 py-0.5 text-[10px]"
                  style={{ borderColor: 'var(--line)' }}
                  onClick={() => setParentDir(item.path)}
                >
                  {cleanText(item.path, 60)}
                </button>
              ))}
            </div>
          ) : null}
        </Field>

        <Field label={t('vpm.create.unityVersion')} hint={t('vpm.create.unityHint')}>
          {editors.some((item) => item.version) ? (
            <select
              className="input"
              value={unityVersion}
              onChange={(event) => setUnityVersion(event.target.value)}
            >
              {unityVersion && !editors.some((item) => item.version === unityVersion) ? (
                <option value={unityVersion}>{unityVersion}</option>
              ) : null}
              {editors
                .filter((item) => item.version)
                .map((item) => (
                  <option key={item.id} value={item.version ?? ''}>
                    {item.version}
                    {item.path ? ` · ${cleanText(item.path, 60)}` : ''}
                  </option>
                ))}
            </select>
          ) : (
            <div className="space-y-1">
              <div className="flex gap-2">
                <input
                  className="input flex-1 font-mono"
                  value={unityVersion}
                  placeholder="2022.3.22f1"
                  onChange={(event) => setUnityVersion(event.target.value)}
                />
                <Button
                  variant="ghost"
                  disabled={loading}
                  onClick={() => {
                    void vpmApi
                      .unityRefresh()
                      .then((list) => setEditors(list.filter((item) => !item.missing)))
                      .catch(() => undefined)
                  }}
                >
                  {t('vpm.create.rescan')}
                </Button>
              </div>
              <p className="text-[10px]" style={{ color: 'var(--warn)' }}>
                {t('vpm.create.noEditors')}
              </p>
            </div>
          )}
        </Field>

        {selected?.base ? (
          <p className="faint text-[10px]">{t('vpm.create.inherits', { base: selected.base })}</p>
        ) : null}

        {error ? (
          <div className="rounded border px-3 py-2 text-[11px]" style={{ borderColor: 'var(--bad)', color: 'var(--bad)' }}>
            {error}
          </div>
        ) : null}
        {warning ? (
          <div className="rounded border px-3 py-2 text-[11px]" style={{ borderColor: 'var(--warn)', color: 'var(--warn)' }}>
            {warning}
          </div>
        ) : null}
      </div>
    </Modal>
  )
}
