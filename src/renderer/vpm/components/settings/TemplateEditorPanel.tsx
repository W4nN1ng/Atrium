import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type {
  VpmTemplateDto,
  VpmTemplatePatch
} from '../../../../shared/vpm/dto'
import { normalizePackageId } from '../../../../shared/vpm/domain/packageId'
import { tryParseVpmRange } from '../../../../shared/vpm/domain/range'
import { Badge, Button, Field, MenuButton, Modal } from '../../../components/ui'
import { errorText } from '../../../lib/msg'
import { cleanText } from '../../lib/view'
import { vpmApi } from '../../api'

export interface TemplateDependencyIssue {
  kind: 'line' | 'name' | 'range' | 'duplicate'
  line: number
  name?: string
}

/** `name range` 一行；注释/空行跳过。range 可以带空格（如 `>= 1.0.0 < 2.0.0`）。 */
export function parseDependenciesText(text: string): {
  dependencies: Record<string, string>
  issues: TemplateDependencyIssue[]
} {
  const dependencies: Record<string, string> = {}
  const issues: TemplateDependencyIssue[] = []
  for (const [index, raw] of text.split(/\r?\n/).entries()) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const match = /^(\S+)(?:\s+(.+))?$/.exec(line)
    if (!match || !match[2]?.trim()) {
      issues.push({ kind: 'line', line: index + 1 })
      continue
    }
    let name: string
    try {
      name = normalizePackageId(match[1])
    } catch {
      issues.push({ kind: 'name', line: index + 1 })
      continue
    }
    const range = match[2].trim()
    if (!tryParseVpmRange(range)) {
      issues.push({ kind: 'range', line: index + 1 })
      continue
    }
    if (dependencies[name]) {
      issues.push({ kind: 'duplicate', line: index + 1, name })
      continue
    }
    dependencies[name] = range
  }
  return { dependencies, issues }
}

export function dependenciesText(dependencies: Record<string, string>): string {
  return Object.entries(dependencies)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, range]) => `${name} ${range}`)
    .join('\n')
}

/** base 下拉：排除自己和自己的后代，避免写进文件后变成循环模板。 */
export function templateBaseCandidates(
  entries: readonly VpmTemplateDto[],
  currentId: string | null
): VpmTemplateDto[] {
  const blocked = new Set<string>()
  if (currentId) {
    blocked.add(currentId)
    let changed = true
    while (changed) {
      changed = false
      for (const entry of entries) {
        if (entry.base && blocked.has(entry.base) && !blocked.has(entry.id)) {
          blocked.add(entry.id)
          changed = true
        }
      }
    }
  }
  return entries.filter(
    (entry) => !blocked.has(entry.id) && entry.visible && !entry.broken
  )
}

interface Draft {
  mode: 'create' | 'edit'
  id: string | null
  name: string
  description: string
  base: string
  unityMin: string
  unityMax: string
  unityRecommended: string
  dependencies: string
  attachments: VpmTemplateDto['unitypackages']
}

function emptyDraft(): Draft {
  return {
    mode: 'create',
    id: null,
    name: '',
    description: '',
    base: '',
    unityMin: '2022.3',
    unityMax: '',
    unityRecommended: '',
    dependencies: '',
    attachments: []
  }
}

function draftOf(entry: VpmTemplateDto): Draft {
  return {
    mode: 'edit',
    id: entry.id,
    name: entry.name,
    description: entry.description ?? '',
    base: entry.base ?? '',
    unityMin: entry.unity.min,
    unityMax: entry.unity.max ?? '',
    unityRecommended: entry.unity.recommended ?? '',
    dependencies: dependenciesText(entry.dependencies),
    attachments: entry.unitypackages
  }
}

function unityLabel(entry: VpmTemplateDto): string {
  return `Unity ${entry.unity.min}${entry.unity.max ? ` – ${entry.unity.max}` : '+'}`
}

/**
 * P8-F：设置里的模板编辑面板。
 *
 * 只通过 IPC 调 TemplateService；渲染层不碰 template.json/路径。
 * 删除引用 = 从列表隐藏，不删磁盘；恢复从"显示已移除"里回来。
 */
export function TemplateEditorPanel(): JSX.Element {
  const { t } = useTranslation()
  const [entries, setEntries] = useState<VpmTemplateDto[]>([])
  const [includeHidden, setIncludeHidden] = useState(false)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [editorError, setEditorError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [removeTarget, setRemoveTarget] = useState<VpmTemplateDto | null>(null)

  const load = useCallback(async (): Promise<void> => {
    setLoading(true)
    try {
      const list = await vpmApi.templateList({ includeHidden })
      setEntries(list)
      setError(null)
    } catch (cause) {
      setError(errorText(cause))
    } finally {
      setLoading(false)
    }
  }, [includeHidden])

  useEffect(() => {
    void load()
  }, [load])

  const openCreate = (): void => {
    setEditorError(null)
    setDraft(emptyDraft())
  }

  const openEdit = (entry: VpmTemplateDto): void => {
    setEditorError(null)
    setDraft(draftOf(entry))
  }

  const issueText = (issue: TemplateDependencyIssue): string => {
    if (issue.kind === 'duplicate') return t('vpm.templates.depDuplicate', { name: issue.name ?? '' })
    if (issue.kind === 'name') return t('vpm.templates.depName', { line: issue.line })
    if (issue.kind === 'range') return t('vpm.templates.depRange', { line: issue.line })
    return t('vpm.templates.depLine', { line: issue.line })
  }

  const save = async (): Promise<void> => {
    if (!draft) return
    const name = draft.name.trim()
    if (!name) {
      setEditorError(t('vpm.templates.nameRequired'))
      return
    }
    const min = draft.unityMin.trim()
    if (!min) {
      setEditorError(t('vpm.templates.unityMinRequired'))
      return
    }
    const parsed = parseDependenciesText(draft.dependencies)
    if (parsed.issues.length) {
      setEditorError(issueText(parsed.issues[0]))
      return
    }
    const patch: VpmTemplatePatch = {
      name,
      description: draft.description.trim() ? draft.description.trim() : null,
      base: draft.base || null,
      unity: {
        min,
        max: draft.unityMax.trim() || null,
        recommended: draft.unityRecommended.trim() || null
      },
      dependencies: parsed.dependencies
    }
    setSaving(true)
    setEditorError(null)
    try {
      if (draft.mode === 'create') {
        await vpmApi.templateCreate({ ...patch, name })
      } else if (draft.id) {
        await vpmApi.templateUpdate({ ...patch, id: draft.id })
      }
      setDraft(null)
      setNotice(t('vpm.templates.saved'))
      await load()
    } catch (cause) {
      setEditorError(errorText(cause))
    } finally {
      setSaving(false)
    }
  }

  const duplicate = async (entry: VpmTemplateDto): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      await vpmApi.templateDuplicate({ id: entry.id })
      setNotice(t('vpm.templates.duplicated'))
      await load()
    } catch (cause) {
      setError(errorText(cause))
    } finally {
      setBusy(false)
    }
  }

  const favorite = async (entry: VpmTemplateDto): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      await vpmApi.templateFavorite({ id: entry.id, favorite: !entry.favorite })
      await load()
    } catch (cause) {
      setError(errorText(cause))
    } finally {
      setBusy(false)
    }
  }

  const remove = async (): Promise<void> => {
    if (!removeTarget) return
    setBusy(true)
    setError(null)
    try {
      await vpmApi.templateRemoveReference({ id: removeTarget.id })
      setRemoveTarget(null)
      setNotice(t('vpm.templates.removedNotice'))
      await load()
    } catch (cause) {
      setError(errorText(cause))
    } finally {
      setBusy(false)
    }
  }

  const restore = async (entry: VpmTemplateDto): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      await vpmApi.templateRestore({ id: entry.id })
      setNotice(t('vpm.templates.restored'))
      await load()
    } catch (cause) {
      setError(errorText(cause))
    } finally {
      setBusy(false)
    }
  }

  const baseOptions = draft
    ? templateBaseCandidates(entries, draft.id)
    : templateBaseCandidates(entries, null)
  const baseMissing =
    !!draft?.base && !baseOptions.some((entry) => entry.id === draft.base)
  const userCount = entries.filter((entry) => !entry.builtin && entry.visible).length

  return (
    <section className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[14px] font-semibold">{t('vpm.templates.title')}</span>
        <Badge>{userCount}</Badge>
        <span className="faint text-[11px]">{t('vpm.templates.intro')}</span>
        <label className="ml-auto flex items-center gap-1 text-[11px]">
          <input
            type="checkbox"
            checked={includeHidden}
            aria-label={t('vpm.templates.showRemoved')}
            onChange={(event) => setIncludeHidden(event.target.checked)}
          />
          {t('vpm.templates.showRemoved')}
        </label>
        <Button variant="accent" disabled={busy || loading} onClick={openCreate}>
          {t('vpm.templates.new')}
        </Button>
      </div>

      {error ? (
        <div className="rounded border px-3 py-2 text-[11px]" role="alert" style={{ borderColor: 'var(--bad)', color: 'var(--bad)' }}>
          {error}
          <div className="mt-2">
            <Button onClick={() => void load()}>{t('common.reload')}</Button>
          </div>
        </div>
      ) : null}
      {notice ? (
        <p className="text-[11px]" role="status" style={{ color: 'var(--ok)' }}>
          {notice}
        </p>
      ) : null}

      <div className="rounded border" style={{ borderColor: 'var(--line)' }}>
        {entries.map((entry) => (
          <div
            key={entry.id}
            className="flex flex-wrap items-start gap-2 border-b px-3 py-2 text-[12px] last:border-b-0"
            style={{ borderColor: 'var(--line)' }}
          >
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[13px] font-medium">{cleanText(entry.name, 120)}</span>
                {entry.builtin ? <Badge>{t('vpm.create.builtin')}</Badge> : null}
                {entry.source === 'imported' ? <Badge>{t('vpm.templates.imported')}</Badge> : null}
                {entry.favorite ? <Badge tone="accent">{t('vpm.create.favorite')}</Badge> : null}
                {!entry.visible ? <Badge tone="warn">{t('vpm.templates.removed')}</Badge> : null}
                {entry.broken ? <Badge tone="bad">{t('vpm.templates.broken')}</Badge> : null}
              </div>
              <div className="faint mt-0.5 text-[11px]">
                {cleanText(entry.description ?? '', 160) || t('vpm.templates.noDescription')}
              </div>
              <div className="faint mt-1 flex flex-wrap items-center gap-2 text-[10px]">
                <span>{unityLabel(entry)}</span>
                <span>
                  {t('vpm.create.counts', {
                    deps: Object.keys(entry.dependencies).length,
                    files: entry.unitypackages.length
                  })}
                </span>
              </div>
              {entry.broken && entry.issues.length ? (
                <p
                  className="mt-1 text-[10px]"
                  role="alert"
                  title={entry.issues.slice(0, 6).join(' · ')}
                  style={{ color: 'var(--bad)' }}
                >
                  {t('vpm.templates.brokenHint')}{' '}
                  {t('vpm.templates.brokenIssues', { count: entry.issues.length })}
                </p>
              ) : null}
            </div>
            <div className="flex shrink-0 items-center gap-1">
              {!entry.builtin && !entry.broken ? (
                <Button variant="ghost" disabled={busy} onClick={() => openEdit(entry)}>
                  {t('vpm.templates.edit')}
                </Button>
              ) : null}
              {!entry.broken ? (
                <Button variant="ghost" disabled={busy} onClick={() => void duplicate(entry)}>
                  {t('vpm.templates.duplicate')}
                </Button>
              ) : null}
              {!entry.builtin ? (
                <MenuButton
                  title={t('vpm.templates.actions')}
                  items={[
                    ...(entry.broken
                      ? []
                      : [{
                          key: 'favorite',
                          label: entry.favorite ? t('vpm.create.unfavorite') : t('vpm.create.setFavorite'),
                          onSelect: () => void favorite(entry)
                        }]),
                    ...(entry.visible
                      ? [{
                          key: 'remove',
                          label: t('vpm.templates.remove'),
                          danger: true,
                          onSelect: () => setRemoveTarget(entry)
                        }]
                      : [{
                          key: 'restore',
                          label: t('vpm.templates.restore'),
                          onSelect: () => void restore(entry)
                        }])
                  ]}
                />
              ) : null}
            </div>
          </div>
        ))}
      </div>
      {!loading && userCount === 0 ? (
        <p className="faint text-[11px]">{t('vpm.templates.emptyHint')}</p>
      ) : null}

      <Modal
        open={draft !== null}
        onOpenChange={(open) => {
          if (!open && !saving) setDraft(null)
        }}
        title={draft?.mode === 'edit' ? t('vpm.templates.editTitle') : t('vpm.templates.createTitle')}
        width={720}
        footer={
          <>
            <Button disabled={saving} onClick={() => setDraft(null)}>
              {t('common.cancel')}
            </Button>
            <Button variant="accent" disabled={saving} onClick={() => void save()}>
              {saving ? t('vpm.templates.saving') : t('common.save')}
            </Button>
          </>
        }
      >
        {draft ? (
          <div className="space-y-3 text-[12px]">
            <Field label={t('vpm.templates.name')} hint={t('vpm.templates.nameHint')}>
              <input
                className="input w-full"
                maxLength={120}
                value={draft.name}
                autoFocus
                onChange={(event) => setDraft({ ...draft, name: event.target.value })}
              />
            </Field>
            <Field label={t('vpm.templates.description')}>
              <textarea
                className="input min-h-[64px] w-full"
                maxLength={2000}
                value={draft.description}
                onChange={(event) => setDraft({ ...draft, description: event.target.value })}
              />
            </Field>
            <Field label={t('vpm.templates.base')} hint={t('vpm.templates.baseHint')}>
              <select
                className="input w-full"
                aria-label={t('vpm.templates.base')}
                value={draft.base}
                onChange={(event) => setDraft({ ...draft, base: event.target.value })}
              >
                <option value="">{t('vpm.templates.baseNone')}</option>
                {baseMissing ? (
                  <option value={draft.base} disabled>
                    {draft.base} · {t('vpm.templates.baseUnavailable')}
                  </option>
                ) : null}
                {baseOptions.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.name}
                  </option>
                ))}
              </select>
            </Field>
            <div className="grid gap-2 sm:grid-cols-3">
              <Field label={t('vpm.templates.unityMin')}>
                <input
                  className="input w-full"
                  maxLength={64}
                  value={draft.unityMin}
                  placeholder="2022.3"
                  onChange={(event) => setDraft({ ...draft, unityMin: event.target.value })}
                />
              </Field>
              <Field label={t('vpm.templates.unityMax')}>
                <input
                  className="input w-full"
                  maxLength={64}
                  value={draft.unityMax}
                  placeholder={t('vpm.templates.unityEmpty')}
                  onChange={(event) => setDraft({ ...draft, unityMax: event.target.value })}
                />
              </Field>
              <Field label={t('vpm.templates.unityRecommended')}>
                <input
                  className="input w-full"
                  maxLength={64}
                  value={draft.unityRecommended}
                  placeholder={t('vpm.templates.unityEmpty')}
                  onChange={(event) => setDraft({ ...draft, unityRecommended: event.target.value })}
                />
              </Field>
            </div>
            <Field label={t('vpm.templates.dependencies')} hint={t('vpm.templates.dependenciesHint')}>
              <textarea
                className="input min-h-[96px] w-full font-mono"
                value={draft.dependencies}
                placeholder={t('vpm.templates.dependenciesPlaceholder')}
                onChange={(event) => setDraft({ ...draft, dependencies: event.target.value })}
              />
            </Field>
            {draft.attachments.length ? (
              <p className="faint text-[11px]">
                {t('vpm.templates.attachments', { count: draft.attachments.length })}
              </p>
            ) : null}
            {editorError ? (
              <div className="rounded border px-3 py-2 text-[11px]" role="alert" style={{ borderColor: 'var(--bad)', color: 'var(--bad)' }}>
                {editorError}
              </div>
            ) : null}
          </div>
        ) : null}
      </Modal>

      <Modal
        open={removeTarget !== null}
        onOpenChange={(open) => {
          if (!open && !busy) setRemoveTarget(null)
        }}
        title={t('vpm.templates.removeTitle')}
        footer={
          <>
            <Button disabled={busy} onClick={() => setRemoveTarget(null)}>
              {t('common.cancel')}
            </Button>
            <Button disabled={busy} onClick={() => void remove()}>
              {busy ? t('vpm.templates.saving') : t('vpm.templates.removeConfirm')}
            </Button>
          </>
        }
      >
        <p className="text-[12px]" style={{ color: 'var(--muted)' }}>
          {t('vpm.templates.removeHint', { name: removeTarget?.name ?? '' })}
        </p>
      </Modal>
    </section>
  )
}
