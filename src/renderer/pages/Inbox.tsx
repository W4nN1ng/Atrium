import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { IngestItemState } from '../../shared/api'
import type { CategoryConfig, LocaleKey } from '../../shared/types'
import { cleanDisplayName } from '../../shared/naming'
import { useUi } from '../stores/ui'
import { humanBytes } from '../lib/format'
import { msg } from '../lib/msg'
import { probeLabel } from '../lib/probeLabel'
import { Badge, Button, Select } from '../components/ui'
import { CommitAllButton } from '../components/CommitAll'

function StageBadge({ stage }: { stage: IngestItemState['stage'] }): JSX.Element {
  const { t } = useTranslation()
  const tone = stage === 'done' ? 'ok' : stage === 'failed' ? 'bad' : stage === 'duplicate' ? 'warn' : stage === 'cancelled' ? 'default' : 'accent'
  return <Badge tone={tone as 'ok' | 'bad' | 'default' | 'accent'}>{t(`inbox.stage.${stage}`)}</Badge>
}

/** 指纹做完 / 要密码 / 撞重复 —— 三种"等人"的状态都在这里处理 */
function ConfirmRow({ item, config }: { item: IngestItemState; config: CategoryConfig | null }): JSX.Element {
  const { t, i18n } = useTranslation()
  const locale = i18n.language as LocaleKey
  const toast = useUi((s) => s.toast)
  const refresh = useUi((s) => s.refreshList)
  const guess = cleanDisplayName(item.name)
  /** M3：有分类结果就用它预填，没有（老数据/关了自动分类）再退回名字清洗 */
  const model = item.units?.[0]
  const [name, setName] = useState(model?.name || guess.name)
  const [cat, setCat] = useState(model?.category || config?.categories[0]?.key || 'other')
  const [sub, setSub] = useState<string>(model?.subcategory ?? '')
  const [pw, setPw] = useState('')
  /** M7 ⑥ · 默认不勾：记住密码是"把密码交给这台机器的 DPAPI"，得他自己决定 */
  const [remember, setRemember] = useState(false)
  const [busy, setBusy] = useState(false)

  const catDef = config?.categories.find((c) => c.key === cat) ?? null
  const subs = catDef?.subcategories ?? []

  async function commit(): Promise<void> {
    setBusy(true)
    try {
      await window.a.ingest.commitManual({ jobId: item.jobId, name, category: cat, subcategory: sub || null, password: pw || undefined })
      await refresh()
    } catch (e) {
      toast('bad', e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mt-2 flex flex-col gap-2 rounded-md border p-2" style={{ borderColor: 'var(--line-2)', background: 'var(--panel-2)' }}>
      {item.needsPassword ? (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <span className="text-[12px]" style={{ color: 'var(--warn)' }}>
              {t('ingest.needPassword')}
            </span>
            <input className="input" style={{ width: 220 }} type="password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="****" />
            <Button
              disabled={!pw || busy}
              onClick={async () => {
                setBusy(true)
                try {
                  const r = await window.a.ingest.submitPassword(item.jobId, pw, remember)
                  /**
                   * 存不了要当场说，不能让人以为勾了"记住"就记住了。
                   * 主进程那边的规矩是"加密不可用就什么都不写"—— 绝不退回明文落盘。
                   */
                  if (remember && r.vault === 'unavailable') toast('warn', t('ingest.vaultUnavailable'))
                  else if (remember && r.vault === 'failed') toast('bad', t('ingest.vaultFailed'))
                  else if (remember && r.vault === 'stored') toast('ok', t('ingest.vaultStored'))
                } catch (e) {
                  toast('bad', e instanceof Error ? e.message : String(e))
                } finally {
                  setBusy(false)
                }
              }}
            >
              {t('ingest.retry')}
            </Button>
          </div>
          <label className="flex items-center gap-2 text-[11px]" style={{ color: 'var(--muted)' }}>
            <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
            {t('ingest.rememberPassword')}
            <span style={{ color: 'var(--faint)' }}>{t('ingest.rememberPasswordHint')}</span>
          </label>
        </div>
      ) : null}

      {item.stage === 'duplicate' && item.duplicateOf ? (
        <div className="flex flex-wrap items-center gap-2 text-[12px]">
          <span style={{ color: 'var(--warn)' }}>{t('ingest.duplicateFound', { name: item.duplicateOf.name })}</span>
          <span className="faint truncate" style={{ maxWidth: 320 }}>
            {item.duplicateOf.path ?? ''}
          </span>
          <Button
            onClick={() => {
              if (item.duplicateOf?.path) void window.a.system.reveal(item.duplicateOf.path).catch((e: Error) => toast('bad', e.message))
            }}
          >
            {t('ingest.duplicateOpen')}
          </Button>
          <Button
            onClick={async () => {
              // "仍然导入"：换个指纹无关的入库路径，靠 uniquePath 防覆盖
              await commit()
            }}
          >
            {t('ingest.duplicateImportAnyway')}
          </Button>
          <Button
            onClick={async () => {
              await window.a.ingest.dismiss(item.jobId)
            }}
          >
            {t('ingest.duplicateSkip')}
          </Button>
        </div>
      ) : null}

      {item.stage === 'awaiting_confirm' && !item.needsPassword ? (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <input className="input" style={{ width: 260 }} value={name} onChange={(e) => setName(e.target.value)} title={t('library.rename')} />
            <Select
              value={cat}
              onChange={(v) => {
                setCat(v)
                setSub('')
              }}
              options={(config?.categories ?? []).map((c) => ({ value: c.key, label: c.label[locale] ?? c.label['zh-CN'] }))}
            />
            <Select
              value={sub}
              onChange={setSub}
              options={[{ value: '', label: t('library.none') }, ...subs.map((s) => ({ value: s.key, label: s.label[locale] ?? s.label['zh-CN'] }))]}
            />
            <Button variant="accent" disabled={busy || !name.trim()} onClick={() => void commit()}>
              {t('ingest.commit')}
            </Button>
          </div>
          {model ? (
            <div className="flex flex-col gap-1">
              <div className="flex flex-wrap items-center gap-2 text-[11px]">
                <Badge tone={model.tone === 'ok' ? 'ok' : model.tone === 'warn' ? 'warn' : 'bad'}>
                  {t('inbox.confidence', { value: Math.round(model.confidence * 100) })}
                </Badge>
                {model.version ? <span className="muted">v{model.version}</span> : null}
                {model.targetAvatars.length ? <span className="muted">{model.targetAvatars.join(' · ')}</span> : null}
                {model.tags.slice(0, 6).map((tag) => (
                  <span key={tag} className="chip">
                    {tag}
                  </span>
                ))}
              </div>
              <div className="text-[11px] leading-relaxed" style={{ color: 'var(--faint)' }}>
                {t('inbox.why')}：
                {model.reasonParts.length
                  ? model.reasonParts.map((p, i) => <span key={i}>{msg(p.key, p.params, model.reason)}{'　'}</span>)
                  : model.reason}
              </div>
              {model.sourceItemId && model.sourceItemIdConfidence < 0.5 ? (
                <div className="text-[11px]" style={{ color: 'var(--warn)' }}>
                  {t('inbox.suspectedSource', { id: model.sourceItemId })}
                </div>
              ) : null}
            </div>
          ) : null}
          {item.bundle ? (
            <div
              className="flex flex-col gap-0.5 rounded border px-2 py-1 text-[11px]"
              style={{ borderColor: 'var(--line-2)', background: 'var(--panel-2)' }}
            >
              <div style={{ color: 'var(--accent)' }}>
                {t('inbox.bundleCard', { count: item.bundle.items.length })}
              </div>
              {item.bundle.items.slice(0, 5).map((it) => (
                <div key={it.name} className="flex items-center gap-2" style={{ color: 'var(--muted)' }}>
                  <span className="min-w-0 flex-1 truncate">{it.name}</span>
                  {it.versions > 1 ? (
                    <span style={{ color: 'var(--faint)' }}>
                      {t('library.bundleVersions', { count: it.versions })}
                      {it.topVersion ? ` · v${it.topVersion}` : ''}
                    </span>
                  ) : null}
                  <span style={{ color: 'var(--faint)' }}>{(it.confidence * 100).toFixed(0)}%</span>
                </div>
              ))}
              {item.bundle.items.length > 5 ? (
                <div style={{ color: 'var(--faint)' }}>{t('inbox.bundleMore', { count: item.bundle.items.length - 5 })}</div>
              ) : null}
              <div style={{ color: 'var(--faint)' }}>{t('inbox.bundleNoSplit')}</div>
            </div>
          ) : item.bundleName ? (
            <div className="text-[11px]" style={{ color: 'var(--accent)' }}>
              {t('inbox.splitInto', { count: item.units?.length ?? 0, bundle: item.bundleName })}
            </div>
          ) : null}
          {item.entriesPreview?.length ? (
            <div className="text-[11px] leading-relaxed" style={{ color: 'var(--faint)' }}>
              {t('ingest.entries', { count: item.entryCount ?? item.entriesPreview.length })}：
              {item.entriesPreview.slice(0, 6).join('，')}
              {(item.entryCount ?? 0) > 6 ? ' …' : ''}
            </div>
          ) : null}
          {item.warnings?.length ? (
            <div className="text-[11px] leading-relaxed" style={{ color: 'var(--warn)' }}>
              {item.warnings.map((w) => (
                <div key={w.key + JSON.stringify(w.params ?? {})}>· {msg(w.key, w.params, w.message)}</div>
              ))}
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  )
}

export function Inbox(): JSX.Element {
  const { t, i18n } = useTranslation()
  const items = useUi((s) => s.ingestItems)
  const config = useUi((s) => s.categories)
  const settings = useUi((s) => s.settings)
  const search = useUi((s) => s.search)
  const ingestPaths = useUi((s) => s.ingestPaths)
  const refreshIngestQueue = useUi((s) => s.refreshIngestQueue)
  const locale = i18n.language as LocaleKey

  const RUNNING: IngestItemState['stage'][] = [
    'queued',
    'hashing',
    'detecting',
    'extracting',
    'fingerprinting',
    'classifying',
    'committing'
  ]
  const running = items.filter((i) => RUNNING.includes(i.stage)).length
  const waiting = items.filter((i) => i.stage === 'awaiting_confirm' || i.stage === 'duplicate').length

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b px-3 py-2" style={{ borderColor: 'var(--line)' }}>
        <span className="text-[13px] font-medium">{t('inbox.title')}</span>
        <Badge>{items.length}</Badge>
        {running > 0 ? <Badge tone="accent">{t('inbox.active', { count: running })}</Badge> : null}
        {waiting > 0 ? <Badge tone="warn">{t('inbox.waiting', { count: waiting })}</Badge> : null}
        <div className="ml-auto flex items-center gap-2">
          <CommitAllButton
            items={items}
            search={search}
            locale={locale}
            confidenceAuto={settings.confidenceAuto ?? 0.75}
            libraryRoot={settings.libraryRoot}
            wouldMove={settings.storageMode !== 'indexed'}
            onDone={() => void refreshIngestQueue()}
          />
          <Button
            onClick={async () => {
              const picked = await window.a.system.pickFiles({ multiple: true, title: t('inbox.pickFiles') })
              if (picked.length) await ingestPaths(picked)
            }}
          >
            {t('inbox.pickFiles')}
          </Button>
          <Button
            onClick={async () => {
              const picked = await window.a.system.pickDirectory({ title: t('inbox.pickFiles') })
              if (picked) await ingestPaths([picked])
            }}
          >
            + {t('common.choose')}
          </Button>
          <Button
            onClick={async () => {
              await window.a.ingest.dismiss()
            }}
          >
            {t('inbox.clear')}
          </Button>
        </div>
      </div>

      <div
        className="shrink-0 border-b px-3 py-1.5 text-[11px]"
        style={{ borderColor: 'var(--line)', background: 'var(--accent-soft)', color: 'var(--accent)' }}
      >
        {t('inbox.m2Note')}
        {!settings.libraryRoot ? <span style={{ color: 'var(--warn)' }}> · {t('settings.libraryRootMissing')}</span> : null}
        {!settings.autoExtract ? <span className="faint"> · {t('inbox.autoExtractOff')}</span> : null}
      </div>

      {items.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
          <div className="text-[15px]">{t('library.emptyTitle')}</div>
          <div className="max-w-md text-[12px] leading-relaxed" style={{ color: 'var(--muted)' }}>
            {t('library.emptyHint')}
          </div>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto">
          {items.map((it) => (
            <div key={it.jobId} className="border-b px-3 py-2" style={{ borderColor: 'var(--line)' }}>
              <div className="flex items-center gap-3">
                <StageBadge stage={it.stage} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px]">{it.name}</div>
                  <div className="truncate text-[11px]" style={{ color: 'var(--faint)' }}>
                    {it.sourcePath}
                  </div>
                  <div className="mt-0.5 truncate text-[11px]" style={{ color: 'var(--muted)' }}>
                    {msg(it.messageKey, it.messageParams, it.message)}
                    {it.detectedKind ? ` · ${probeLabel(it.detectedKind)}` : ''}
                  </div>
                  {it.progress > 0 && it.progress < 1 ? (
                    <div className="mt-1 h-1 w-full overflow-hidden rounded" style={{ background: 'var(--line)' }}>
                      <div className="h-full" style={{ width: `${Math.round(it.progress * 100)}%`, background: 'var(--accent)' }} />
                    </div>
                  ) : null}
                  {it.error && it.stage === 'failed' ? (
                    <div className="mt-1 whitespace-pre-wrap text-[11px]" style={{ color: 'var(--bad)' }}>
                      {it.error}
                    </div>
                  ) : null}
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <span className="text-[11px] tabular-nums" style={{ color: 'var(--muted)' }}>
                    {humanBytes(it.bytes ?? null, locale)}
                  </span>
                  {it.stage === 'failed' || it.stage === 'cancelled' ? (
                    <button
                      type="button"
                      className="btn btn-ghost px-1.5 py-0.5 text-[11px]"
                      onClick={() => void ingestPaths([it.sourcePath])}
                    >
                      {t('ingest.retry')}
                    </button>
                  ) : null}
                </div>
              </div>
              {it.stage === 'awaiting_confirm' || it.stage === 'duplicate' ? (
                <ConfirmRow item={it} config={config} />
              ) : null}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
