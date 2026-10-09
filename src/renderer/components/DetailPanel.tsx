import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { LocaleKey } from '../../shared/types'
import { installedWhereState } from '../../shared/installedWhere'
import { useUi } from '../stores/ui'
import { humanBytes, humanDate, fileUrl } from '../lib/format'
import { Badge, Button, EmptyState, Field, Modal, Select } from './ui'

function Row({ label, children }: { label: string; children: React.ReactNode }): JSX.Element {
  return (
    <div className="flex items-start justify-between gap-3 border-b py-1.5 text-[12px]" style={{ borderColor: 'var(--line)' }}>
      <span className="shrink-0" style={{ color: 'var(--faint)' }}>
        {label}
      </span>
      <span className="min-w-0 truncate text-right" title={typeof children === 'string' ? children : undefined}>
        {children}
      </span>
    </div>
  )
}

export function DetailPanel(): JSX.Element {
  const { t, i18n } = useTranslation()
  const detail = useUi((s) => s.detail)
  const categories = useUi((s) => s.categories)
  const saveCategory = useUi((s) => s.saveCategory)
  const planning = useUi((s) => s.rearchive.loading)
  const resolvePending = useUi((s) => s.resolvePending)
  const selection = useUi((s) => s.selection)
  const trashSelected = useUi((s) => s.trashSelected)
  /** 顶栏当前选的导入目标：反查列表要把"就是现在这个工程"标出来 */
  const targetProjectId = useUi((s) => s.unity.targetProjectId)
  const locale = i18n.language as LocaleKey

  const [cat, setCat] = useState('')
  const [sub, setSub] = useState('')
  const [renameOpen, setRenameOpen] = useState(false)
  const [renameValue, setRenameValue] = useState('')

  const asset = detail?.asset ?? null

  useEffect(() => {
    if (asset) {
      setCat(asset.category)
      setSub(asset.subcategory ?? '')
      setRenameValue(asset.name)
    }
  }, [asset?.id, asset?.category, asset?.subcategory, asset?.name])

  if (!detail || !asset) {
    return (
      <aside
        className="flex w-[320px] shrink-0 flex-col overflow-y-auto border-l"
        style={{ borderColor: 'var(--line)', background: 'var(--panel)' }}
      >
        <EmptyState title={t('common.empty')} hint={t('library.emptyHint')} />
      </aside>
    )
  }

  const catDef = categories?.categories.find((c) => c.key === cat) ?? null
  /** R4 ⑥ · 反查那块：判据在 shared/installedWhere.ts，这里只排版 */
  const where = installedWhereState(detail.installedAcross, targetProjectId)
  /**
   * 分类的中文名（预览卡标题要用「材质 → 道具 / 武器」这种看得懂的形式）。
   * 二级拼在一后面而不是分两段显示：标题只有一行，两个名字挤在一起比"道具的武器"好读。
   */
  const labelOf = (key: string, sub: string | null): string => {
    const c = categories?.categories.find((x) => x.key === key)
    if (!c) return key
    const main = c.label[locale] ?? c.label['zh-CN']
    const s = sub ? c.subcategories.find((x) => x.key === sub) : null
    const second = s ? s.label[locale] ?? s.label['zh-CN'] : null
    return second ? `${main} / ${second}` : main
  }
  const installed = detail.installedInProject
  const installedLabel =
    !installed || installed.state === 'unknown'
      ? t('library.unknown')
      : installed.state === 'full'
        ? t('library.installed')
        : installed.state === 'partial'
          ? t('library.partial', { hit: installed.hit, total: installed.total })
          : t('library.notInstalled')

  async function doRename(): Promise<void> {
    try {
      await window.a.assets.rename(asset!.id, renameValue)
      setRenameOpen(false)
      await useUi.getState().openDetail(asset!.id)
      await useUi.getState().refreshList()
    } catch (e) {
      useUi.getState().toast('bad', e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <aside
      className="flex w-[320px] shrink-0 flex-col overflow-y-auto border-l"
      style={{ borderColor: 'var(--line)', background: 'var(--panel)' }}
    >
      <div className="border-b p-3" style={{ borderColor: 'var(--line)' }}>
        {asset.cover_image && asset.cover_image !== 'none' ? (
          <img
            src={/^[a-z]+:/i.test(asset.cover_image) ? asset.cover_image : fileUrl(asset.cover_image)}
            alt=""
            className="mb-2 aspect-[4/3] w-full rounded object-cover"
            style={{ background: 'var(--panel-2)' }}
            onError={(e) => {
              ;(e.currentTarget as HTMLImageElement).style.display = 'none'
            }}
          />
        ) : null}
        <div className="text-[14px] font-medium">{asset.name}</div>
        <div className="mt-0.5 truncate text-[11px]" style={{ color: 'var(--faint)' }} title={asset.raw_name}>
          {asset.raw_name}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-1">
          <Badge tone={asset.status === 'pending_confirm' ? 'warn' : asset.status === 'inbox' ? 'bad' : 'ok'}>
            {t('status.' + asset.status)}
          </Badge>
          <Badge>{t('library.confidence')} {Math.round(asset.confidence * 100)}%</Badge>
          {asset.locale_tag ? <Badge tone="accent">{asset.locale_tag}</Badge> : null}
          {asset.version ? <Badge>v{asset.version}</Badge> : null}
        </div>
        {!detail.pathExists ? (
          <div className="mt-2 rounded border px-2 py-1 text-[11px]" style={{ borderColor: 'var(--bad)', color: 'var(--bad)' }}>
            {t('library.pathMissing')}
          </div>
        ) : null}
      </div>

      <div className="px-3 py-2">
        <Field label={t('library.category')} hint={t('library.fixCategory')}>
          <div className="flex flex-col gap-1.5">
            <Select
              value={cat}
              onChange={(v) => {
                setCat(v)
                setSub('')
              }}
              options={(categories?.categories ?? []).map((c) => ({
                value: c.key,
                label: c.label[locale] ?? c.label['zh-CN']
              }))}
            />
            <Select
              value={sub}
              onChange={setSub}
              options={[
                { value: '', label: t('library.none') },
                ...(catDef?.subcategories ?? []).map((s) => ({
                  value: s.key,
                  label: s.label[locale] ?? s.label['zh-CN']
                }))
              ]}
            />
            {(cat !== asset.category || (sub || '') !== (asset.subcategory ?? '')) && catDef ? (
              <Button
                variant="accent"
                disabled={planning}
                onClick={() =>
                  void saveCategory({
                    assetId: asset.id,
                    category: cat,
                    subcategory: sub || null,
                    fromLabel: labelOf(asset.category, asset.subcategory),
                    toLabel: labelOf(cat, sub || null)
                  })
                }
              >
                {planning ? t('rearchive.planning') : t('common.save')}
              </Button>
            ) : null}
          </div>
        </Field>

        {asset.source_url || asset.source_item_id ? (
          <Row label={t('library.source')}>
            <span className="flex flex-col items-end gap-0.5">
              {asset.source_url ? (
                <button
                  type="button"
                  className="underline"
                  style={{ color: 'var(--accent)' }}
                  onClick={() => void window.a.system.openExternal(asset.source_url as string)}
                >
                  {asset.source_url}
                </button>
              ) : null}
              {asset.source_item_id ? (
                <span className="faint text-[11px]">
                  {asset.source_item_id_confidence !== null && asset.source_item_id_confidence < 1
                    ? t('library.suspectedSource')
                    : 'ID'}
                  :{asset.source_item_id}
                  {asset.source_item_id_confidence !== null && asset.source_item_id_confidence < 1 ? (
                    <button
                      type="button"
                      className="ml-1 underline"
                      onClick={() =>
                        void window.a.assets
                          .patch(asset.id, { source_item_id_confidence: 1 })
                          .then(() => useUi.getState().openDetail(asset.id))
                      }
                    >
                      {t('common.confirm')}
                    </button>
                  ) : null}
                </span>
              ) : null}
            </span>
          </Row>
        ) : null}

        {asset.author ? <Row label={t('library.author')}>{asset.author}</Row> : null}
        <Row label={t('library.version')}>{asset.version ?? t('library.none')}</Row>
        <Row label={t('library.size')}>{humanBytes(asset.size_bytes, locale)}</Row>
        <Row label={t('library.storage')}>{asset.storage_mode === 'indexed' ? t('settings.modeIndexed') : t('settings.modeArchived')}</Row>
        <Row label={t('library.kind')}>{asset.kind ?? t('library.none')}</Row>
        <Row label={t('library.updated')}>{humanDate(asset.updated_at, locale)}</Row>

        {detail.variants.length > 1 ? (
          <div className="mt-3">
            <div className="label mb-1">{t('library.variants', { count: detail.variants.length })}</div>
            <div className="flex flex-wrap gap-1">
              {detail.variants.map((v) => (
                <span key={v.id} className="chip">
                  {v.variant_kind}:{v.variant_value}
                </span>
              ))}
            </div>
          </div>
        ) : null}

        {detail.tags.length ? (
          <div className="mt-3">
            <div className="label mb-1">{t('library.tags')}</div>
            <div className="flex flex-wrap gap-1">
              {detail.tags.map((tag) => (
                <span key={tag.id} className="chip">
                  {tag.name}
                </span>
              ))}
            </div>
          </div>
        ) : null}

        {detail.packageSummary ? (
          <div className="mt-3">
            <div className="label mb-1">{t('library.contentPkg')}</div>
            <div className="flex flex-wrap gap-1">
              {Object.entries(detail.packageSummary.byKind).map(([k, n]) => (
                <span key={k} className="chip">
                  {k} × {n}
                </span>
              ))}
            </div>
          </div>
        ) : null}

        {detail.dependencies.external > 0 ? (
          <Row label={t('library.depends')}>
            {t('library.dependsCount', {
              external: detail.dependencies.external,
              resolved: detail.dependencies.resolved,
              missing: detail.dependencies.missing.length
            })}
          </Row>
        ) : null}

        <Row label={t('library.importState')}>{installedLabel}</Row>
        <Row label={t('library.lastImport')}>
          {detail.lastImport ? humanDate(detail.lastImport.finished_at ?? 0, locale) : t('library.never')}
        </Row>

        {/*
          R4 ⑥ · 跨工程反查。判据（空列表也要画、退回过的次数不许抹掉、
          时间未知不许显示成 1970）全在 `shared/installedWhere.ts`。
        */}
        <div className="mt-3">
          <div className="label mb-1">{t('installed.title', { count: where.count })}</div>
          {where.emptyKey ? <div className="text-[11px]" style={{ color: 'var(--faint)' }}>{t(where.emptyKey)}</div> : null}
          {where.lines.map((l) => (
            <div key={l.projectId} className="border-b py-1" style={{ borderColor: 'var(--line)' }}>
              <div className="flex items-start gap-2 text-[11px]">
                <span className="min-w-0 flex-1 truncate" title={l.name || l.projectId}>
                  {l.known ? l.name || l.projectId : t('installed.ghost')}
                  {l.isCurrent ? <span style={{ color: 'var(--accent)' }}> · {t('installed.current')}</span> : null}
                </span>
                <span className="shrink-0" style={{ color: 'var(--faint)' }}>
                  {l.hasTime ? humanDate(l.at, locale) : t('installed.timeUnknown')}
                </span>
              </div>
              <div className="mt-0.5 flex flex-wrap gap-1 text-[10px]" style={{ color: 'var(--faint)' }}>
                {l.chips.map((c) => (
                  <span key={c.key} className="chip">
                    {t(c.key, c.params)}
                  </span>
                ))}
              </div>
            </div>
          ))}
          {where.noteKeys.map((n) => (
            <div key={n.key} className="mt-1 text-[10px] leading-relaxed" style={{ color: 'var(--warn)' }}>
              {t(n.key, n.params ?? {})}
            </div>
          ))}
        </div>
      </div>

      <div className="mt-auto flex flex-col gap-2 border-t p-3" style={{ borderColor: 'var(--line)' }}>
        <Button
          variant="accent"
          onClick={() => void useUi.getState().importAsset(asset.id)}
          title={t('library.importToUnityHint')}
        >
          {t('library.importToUnity')}
        </Button>
        <div className="flex flex-wrap gap-2">
          <Button
            disabled={!(asset.library_path ?? asset.source_path)}
            onClick={() => {
              const p = asset.library_path ?? asset.source_path
              if (p) void window.a.system.reveal(p).catch((e: Error) => useUi.getState().toast('bad', e.message))
            }}
          >
            {t('library.reveal')}
          </Button>
          <Button onClick={() => setRenameOpen(true)}>{t('library.rename')}</Button>
          <Button
            disabled={selection.length === 0}
            onClick={() => void trashSelected()}
          >
            {t('common.trash')}
          </Button>
        </div>
        {asset.status === 'pending_confirm' ? (
          <div className="flex gap-2">
            <Button variant="accent" onClick={() => void resolvePending(asset.id, true)}>
              {t('library.acceptClassification') || '接受'}
            </Button>
            <Button onClick={() => void resolvePending(asset.id, false)}>{t('common.cancel')}</Button>
          </div>
        ) : null}
      </div>

      <Modal
        open={renameOpen}
        onOpenChange={setRenameOpen}
        title={t('library.rename')}
        footer={
          <>
            <Button onClick={() => setRenameOpen(false)}>{t('common.cancel')}</Button>
            <Button variant="accent" onClick={() => void doRename()}>
              {t('common.save')}
            </Button>
          </>
        }
      >
        <div className="py-1">
          <input className="input" autoFocus value={renameValue} onChange={(e) => setRenameValue(e.target.value)} />
        </div>
      </Modal>
    </aside>
  )
}
