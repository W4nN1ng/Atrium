import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { HealthAssetRef, HealthReport, LocaleKey } from '../../shared/types'
import { useUi } from '../stores/ui'
import { humanBytes, humanDate } from '../lib/format'
import { Badge, Button } from './ui'

/**
 * F9 库健康检查面板（设置 → 维护）。
 *
 * 规矩：扫描只读，所以进来先看到的是一个按钮而不是一堆数字；
 * 每个区块自己决定"要不要动东西"，动的部分一律要点明确的按钮，
 * 而且没有一个是"帮你删文件" —— 重复项只列不删，僵尸条目只标不删。
 */

function Row({ item, locale, onReveal }: { item: HealthAssetRef; locale: LocaleKey; onReveal: (p: string) => void }): JSX.Element {
  return (
    <div className="flex items-center gap-2 border-b py-1 text-[11px]" style={{ borderColor: 'var(--line)' }}>
      <span className="min-w-0 flex-1 truncate" title={item.path ?? item.name}>
        {item.name}
      </span>
      <span className="faint shrink-0">{humanBytes(item.sizeBytes, locale)}</span>
      {item.path ? (
        <button type="button" className="btn btn-ghost shrink-0 px-1.5 py-0.5 text-[11px]" onClick={() => onReveal(item.path as string)}>
          …
        </button>
      ) : null}
    </div>
  )
}

function Section({
  title,
  hint,
  count,
  tone,
  actions,
  children
}: {
  title: string
  hint: string
  count: number
  tone?: 'ok' | 'warn' | 'bad'
  actions?: ReactNode
  children?: ReactNode
}): JSX.Element {
  const { t } = useTranslation()
  return (
    <div className="mt-3 rounded border p-2" style={{ borderColor: 'var(--line)' }}>
      <div className="flex items-center gap-2">
        <span className="text-[12px] font-medium">{title}</span>
        <Badge tone={count === 0 ? 'ok' : tone ?? 'warn'}>{count === 0 ? t('health.clean') : String(count)}</Badge>
        <div className="ml-auto flex items-center gap-1">{count > 0 ? actions : null}</div>
      </div>
      <div className="mt-1 text-[11px] leading-relaxed" style={{ color: 'var(--muted)' }}>
        {hint}
      </div>
      {count > 0 ? <div className="mt-1 max-h-[168px] overflow-y-auto">{children}</div> : null}
    </div>
  )
}

export function HealthPanel(): JSX.Element {
  const { t, i18n } = useTranslation()
  const toast = useUi((s) => s.toast)
  const locale = i18n.language as LocaleKey
  const [report, setReport] = useState<HealthReport | null>(null)
  const [busy, setBusy] = useState(false)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  /** 分批收编：只扫这一棵子树（null = 整个库根） */
  const [under, setUnder] = useState<string | null>(null)
  /** 勾选要登记的游离项 —— 没有这一步就只能"整库一把梭" */
  const [strayPicked, setStrayPicked] = useState<Set<string>>(new Set())

  const bytes = (n: number): string => humanBytes(n, locale)

  async function scan(scope: string | null = under): Promise<void> {
    setBusy(true)
    try {
      const r = await window.a.health.scan({ under: scope })
      setReport(r)
      setPicked(new Set())
      setStrayPicked(new Set())
    } catch (e) {
      toast('bad', e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  async function pickScope(): Promise<void> {
    try {
      const d = await window.a.system.pickDirectory({
        title: t('health.scopePick'),
        defaultPath: report?.libraryRoot ?? undefined
      })
      if (!d) return
      setUnder(d)
      await scan(d)
    } catch (e) {
      toast('bad', e instanceof Error ? e.message : String(e))
    }
  }

  async function run(label: string, fn: () => Promise<unknown>): Promise<void> {
    setBusy(true)
    try {
      await fn()
      toast('info', label)
      const r = await window.a.health.scan({ under })
      setReport(r)
      setPicked(new Set())
      setStrayPicked(new Set())
    } catch (e) {
      toast('bad', e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const toggle = (id: string): void => {
    setPicked((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleStray = (p: string): void => {
    setStrayPicked((prev) => {
      const next = new Set(prev)
      if (next.has(p)) next.delete(p)
      else next.add(p)
      return next
    })
  }

  const reveal = (p: string): void => {
    void window.a.system.reveal(p).catch((e: Error) => toast('bad', e.message))
  }

  if (!report) {
    return (
      <div className="mt-1">
        <div className="text-[11px] leading-relaxed" style={{ color: 'var(--muted)' }}>
          {t('health.intro')}
        </div>
        <div className="mt-2">
          <Button variant="accent" disabled={busy} onClick={() => void scan()}>
            {busy ? t('health.scanning') : t('health.scan')}
          </Button>
        </div>
      </div>
    )
  }

  const pickedMissing = report.missing.filter((m) => picked.has(m.id))

  return (
    <div className="mt-1">
      <div className="flex flex-wrap items-center gap-2 text-[11px]" style={{ color: 'var(--muted)' }}>
        <span>{t('health.scannedAt', { time: humanDate(report.scannedAt, locale) })}</span>
        <span>·</span>
        <span>
          {t('health.summary', {
            assets: report.totals.assets,
            groups: report.totals.groups,
            bytes: bytes(report.totals.bytes)
          })}
        </span>
        <Button className="ml-auto" disabled={busy} onClick={() => void scan()}>
          {busy ? t('health.scanning') : t('health.scan')}
        </Button>
      </div>

      <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px]">
        <span className="faint">{t('health.scope')}</span>
        <span className="min-w-0 max-w-[420px] truncate" title={under ?? report.libraryRoot ?? ''}>
          {under ?? (report.libraryRoot || '—')}
        </span>
        <Button disabled={busy} onClick={() => void pickScope()}>
          {t('health.scopePick')}
        </Button>
        {under ? (
          <Button
            disabled={busy}
            onClick={() => {
              setUnder(null)
              void scan(null)
            }}
          >
            {t('health.scopeWhole')}
          </Button>
        ) : null}
      </div>
      {report.truncated ? (
        <div className="mt-1 text-[11px]" style={{ color: 'var(--warn)' }}>
          {t('health.truncated')}
        </div>
      ) : null}
      {!report.libraryRoot ? <div className="mt-1 text-[11px] faint">{t('health.noLibrary')}</div> : null}

      <Section
        title={t('health.missing')}
        hint={t('health.missingHint')}
        count={report.missing.length}
        tone="bad"
        actions={
          <>
            <Button
              disabled={busy || pickedMissing.length === 0}
              onClick={() =>
                void run(t('health.marked', { count: pickedMissing.length }), () => window.a.health.markMissing(pickedMissing.map((m) => m.id)))
              }
            >
              {t('health.markMissing')}
            </Button>
            <Button
              disabled={busy || pickedMissing.length === 0}
              onClick={() =>
                void run(t('health.restored', { count: pickedMissing.length }), () => window.a.health.unmarkMissing(pickedMissing.map((m) => m.id)))
              }
            >
              {t('health.unmarkMissing')}
            </Button>
          </>
        }
      >
        {report.missing.map((m) => (
          <label key={m.id} className="flex cursor-pointer items-center gap-2 border-b py-1 text-[11px]" style={{ borderColor: 'var(--line)' }}>
            <input type="checkbox" checked={picked.has(m.id)} onChange={() => toggle(m.id)} />
            <span className="min-w-0 flex-1 truncate" title={m.path ?? m.name}>
              {m.name}
            </span>
            <span className="faint shrink-0">{bytes(m.sizeBytes ?? 0)}</span>
          </label>
        ))}
      </Section>

      <Section
        title={t('health.duplicates')}
        hint={t('health.duplicatesHint')}
        count={report.duplicates.length}
        actions={
          <span className="faint text-[11px]">{t('health.reclaim', { bytes: bytes(report.totals.duplicateBytes) })}</span>
        }
      >
        {report.duplicates.map((d) => (
          <div key={d.hash} className="border-b py-1" style={{ borderColor: 'var(--line)' }}>
            <div className="text-[11px] faint">
              {d.hash} · {bytes(d.sizeBytes)} × {d.assets.length}
            </div>
            {d.assets.map((a) => (
              <Row key={a.id} item={a} locale={locale} onReveal={reveal} />
            ))}
          </div>
        ))}
      </Section>

      <Section title={t('health.similar')} hint={t('health.similarHint')} count={report.similar.length}>
        {report.similar.map((s, i) => (
          <div key={s.a.id + s.b.id + i} className="border-b py-1" style={{ borderColor: 'var(--line)' }}>
            <div className="text-[11px] faint">{t('health.distance', { n: s.distance })}</div>
            <Row item={s.a} locale={locale} onReveal={reveal} />
            <Row item={s.b} locale={locale} onReveal={reveal} />
          </div>
        ))}
      </Section>

      <Section
        title={t('health.strays')}
        hint={t('health.straysHint')}
        count={report.strays.length}
        actions={
          <>
            <span className="faint text-[11px]">{bytes(report.strays.reduce((a, s) => a + s.sizeBytes, 0))}</span>
            <Button
              disabled={busy || strayPicked.size === 0}
              onClick={async () => {
                setBusy(true)
                try {
                  const paths = report.strays.filter((s) => strayPicked.has(s.path)).map((s) => s.path)
                  const r = await window.a.ingest.fromPaths(paths)
                  // 报"成功"之前得看清楚 accepted —— 这活儿以前是全被校验器拒了还弹成功
                  if (r.accepted.length === 0) {
                    toast('bad', t('health.reclaimNone', { count: r.rejected.length }))
                  } else if (r.rejected.length) {
                    toast('warn', t('health.reclaimPartial', { ok: r.accepted.length, no: r.rejected.length }))
                  } else {
                    toast('ok', t('health.queued', { count: r.accepted.length }))
                  }
                  setReport(await window.a.health.scan({ under }))
                  setStrayPicked(new Set())
                } catch (e) {
                  toast('bad', e instanceof Error ? e.message : String(e))
                } finally {
                  setBusy(false)
                }
              }}
            >
              {t('health.reindexSelected', { count: strayPicked.size })}
            </Button>
            <Button
              disabled={busy || strayPicked.size === 0}
              onClick={async () => {
                const paths = report.strays.filter((s) => strayPicked.has(s.path)).map((s) => s.path)
                const ok = window.confirm(t('health.trashConfirm', { count: paths.length }))
                if (!ok) return
                setBusy(true)
                try {
                  const r = await window.a.health.trashStrays(paths)
                  if (r.failed.length) toast('warn', t('health.trashPartial', { ok: r.trashed.length, no: r.failed.length }))
                  else toast('ok', t('health.trashed', { count: r.trashed.length }))
                  setReport(await window.a.health.scan({ under }))
                  setStrayPicked(new Set())
                } catch (e) {
                  toast('bad', e instanceof Error ? e.message : String(e))
                } finally {
                  setBusy(false)
                }
              }}
            >
              {t('health.trashSelected', { count: strayPicked.size })}
            </Button>
          </>
        }
      >
        <div className="flex items-center gap-2 pb-1 text-[11px]">
          <button
            type="button"
            className="btn btn-ghost px-1.5 py-0.5 text-[11px]"
            onClick={() =>
              setStrayPicked(strayPicked.size === report.strays.length ? new Set() : new Set(report.strays.map((s) => s.path)))
            }
          >
            {strayPicked.size === report.strays.length ? t('health.clearAll') : t('health.selectAll')}
          </button>
          <span className="faint">{t('health.autoArchiveNudge')}</span>
        </div>
        {report.strays.map((s) => (
          <div key={s.path} className="border-b py-1 text-[11px]" style={{ borderColor: 'var(--line)' }}>
            <div className="flex items-center gap-2">
              <input type="checkbox" checked={strayPicked.has(s.path)} onChange={() => toggleStray(s.path)} />
              <button type="button" className="min-w-0 flex-1 truncate text-left" title={s.path} onClick={() => reveal(s.path)}>
                {s.path}
              </button>
              <span className="faint shrink-0">
                {s.isDir ? s.entries + ' · ' : ''}
                {bytes(s.sizeBytes)}
              </span>
            </div>
            {s.alsoDirs?.length ? (
              <div className="ml-6 text-[10px]" style={{ color: 'var(--faint)' }}>
                {t('health.hasExtracted', { n: s.alsoDirs.length })}
              </div>
            ) : null}
          </div>
        ))}
      </Section>

      <Section title={t('health.largest')} hint={t('health.largestHint')} count={report.largest.length} tone="ok">
        {report.largest.map((l) => (
          <Row key={l.id} item={l} locale={locale} onReveal={reveal} />
        ))}
      </Section>

      <Section
        title={t('health.orphans')}
        hint={t('health.orphansHint')}
        count={report.orphanGroups.length}
        actions={
          <Button
            disabled={busy}
            onClick={() =>
              void run(
                t('health.dissolved', {
                  count: report.orphanGroups.length,
                  freed: report.orphanGroups.filter((o) => o.assetId).length
                }),
                () => window.a.health.dissolveOrphans()
              )
            }
          >
            {t('health.dissolve')}
          </Button>
        }
      >
        {report.orphanGroups.map((o) => (
          <div key={o.groupId} className="flex items-center gap-2 border-b py-1 text-[11px]" style={{ borderColor: 'var(--line)' }}>
            <span className="min-w-0 flex-1 truncate">{o.name}</span>
            <span className="faint shrink-0">{o.key}</span>
          </div>
        ))}
      </Section>

      <div className="mt-3 rounded border p-2" style={{ borderColor: 'var(--line)' }}>
        <div className="flex items-center gap-2">
          <span className="text-[12px] font-medium">{t('health.thumbs')}</span>
          <div className="ml-auto">
            <Button
              disabled={busy}
              onClick={async () => {
                setBusy(true)
                try {
                  const r = await window.a.health.pruneThumbs()
                  toast('info', t('health.pruned', { removed: r.removed, kept: r.kept }))
                } catch (e) {
                  toast('bad', e instanceof Error ? e.message : String(e))
                } finally {
                  setBusy(false)
                }
              }}
            >
              {t('health.pruneThumbs')}
            </Button>
          </div>
        </div>
        <div className="mt-1 text-[11px] leading-relaxed" style={{ color: 'var(--muted)' }}>
          {t('health.thumbsHint')}
        </div>
      </div>
    </div>
  )
}
