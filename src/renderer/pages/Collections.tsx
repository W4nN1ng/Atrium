import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { CollectionRow } from '../../shared/types'
import { useUi } from '../stores/ui'
import { Badge, Button, EmptyState, Field, Modal, Select, Switch } from '../components/ui'

interface Rule {
  keywords?: string[]
  matchMode?: 'any' | 'all'
  priority?: number
  projectPaths?: string[]
}

function parseRule(row: CollectionRow): Rule {
  if (!row.rule_json) return {}
  try {
    return JSON.parse(row.rule_json) as Rule
  } catch {
    return {}
  }
}

export function Collections(): JSX.Element {
  const { t } = useTranslation()
  const collections = useUi((s) => s.collections)
  const refreshMeta = useUi((s) => s.refreshMeta)
  const setNav = useUi((s) => s.setNav)
  const [edit, setEdit] = useState<CollectionRow | null>(null)
  const [keywords, setKeywords] = useState('')
  const [priority, setPriority] = useState(0)
  const [matchMode, setMatchMode] = useState<'any' | 'all'>('any')
  const [confirmDelete, setConfirmDelete] = useState<CollectionRow | null>(null)

  function openEditor(row: CollectionRow): void {
    const r = parseRule(row)
    setEdit(row)
    setKeywords((r.keywords ?? []).join(', '))
    setPriority(r.priority ?? row.priority ?? 0)
    setMatchMode(r.matchMode ?? 'any')
  }

  async function save(): Promise<void> {
    if (!edit) return
    const rule: Rule = {
      keywords: keywords
        .split(/[,，、\n]/)
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean),
      matchMode,
      priority,
      projectPaths: parseRule(edit).projectPaths ?? []
    }
    try {
      await window.a.collections.update(edit.id, { rule_json: JSON.stringify(rule), name: edit.name })
      setEdit(null)
      await refreshMeta()
    } catch (e) {
      useUi.getState().toast('bad', e instanceof Error ? e.message : String(e))
    }
  }

  async function remove(row: CollectionRow): Promise<void> {
    try {
      await window.a.collections.remove(row.id)
      setConfirmDelete(null)
      setNav('all')
      await refreshMeta()
    } catch (e) {
      useUi.getState().toast('bad', e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b px-3 py-2" style={{ borderColor: 'var(--line)' }}>
        <span className="text-[13px] font-medium">{t('nav.collections')}</span>
        <Badge>{collections.length}</Badge>
      </div>
      <div
        className="shrink-0 border-b px-3 py-2 text-[11px]"
        style={{ borderColor: 'var(--line)', background: 'var(--accent-soft)', color: 'var(--accent)' }}
      >
        {t('collections.autoSwitchNote')}
      </div>

      {collections.length === 0 ? (
        <EmptyState title={t('common.empty')} hint={t('nav.newCollection')} />
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto">
          {collections.map((row) => {
            const r = parseRule(row)
            return (
              <div key={row.id} className="flex items-center gap-3 border-b px-3 py-2" style={{ borderColor: 'var(--line)' }}>
                <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: 'var(--accent)' }} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px]">{row.name}</div>
                  <div className="mt-0.5 flex flex-wrap gap-1">
                    {(r.keywords ?? []).slice(0, 8).map((k) => (
                      <span key={k} className="chip">
                        {k}
                      </span>
                    ))}
                    {(r.projectPaths ?? []).slice(0, 2).map((p) => (
                      <span key={p} className="chip chip-accent">
                        {p}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="flex shrink-0 gap-2">
                  <Button onClick={() => openEditor(row)}>{t('library.editMeta')}</Button>
                  <Button onClick={() => setConfirmDelete(row)}>{t('common.remove')}</Button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      <Modal
        open={edit !== null}
        onOpenChange={(v) => !v && setEdit(null)}
        title={`${t('nav.collections')} · ${edit?.name ?? ''}`}
        footer={
          <>
            <Button onClick={() => setEdit(null)}>{t('common.cancel')}</Button>
            <Button variant="accent" onClick={() => void save()}>
              {t('common.save')}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-2 py-1">
          <Field label={t('collections.keywords')} hint={t('collections.keywordsHint')}>
            <input className="input" value={keywords} onChange={(e) => setKeywords(e.target.value)} placeholder="shinano, しなの, シナノ" />
          </Field>
          <Field label={t('collections.matchMode')}>
            <Select
              value={matchMode}
              onChange={setMatchMode}
              options={[
                { value: 'any', label: 'any' },
                { value: 'all', label: 'all' }
              ]}
            />
          </Field>
          <Field label={t('collections.priority')}>
            <input
              className="input"
              style={{ width: 90 }}
              type="number"
              value={priority}
              onChange={(e) => setPriority(Number(e.target.value) || 0)}
            />
          </Field>
        </div>
      </Modal>

      <Modal
        open={confirmDelete !== null}
        onOpenChange={(v) => !v && setConfirmDelete(null)}
        title={t('common.remove')}
        footer={
          <>
            <Button onClick={() => setConfirmDelete(null)}>{t('common.cancel')}</Button>
            <Button variant="accent" onClick={() => confirmDelete && void remove(confirmDelete)}>
              {t('common.confirm')}
            </Button>
          </>
        }
      >
        <div className="py-1 text-[12px]">{confirmDelete?.name}</div>
      </Modal>
    </div>
  )
}
