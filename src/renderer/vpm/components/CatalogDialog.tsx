import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type {
  VpmCatalogPackageDetail,
  VpmCatalogPackageSummary,
  VpmCatalogVersionDto
} from '../../../shared/vpm/dto'
import { errorText } from '../../lib/msg'
import { Badge, Button, Modal } from '../../components/ui'
import { vpmApi } from '../api'
import { cleanText, isHttpLink } from '../lib/view'

function shortHash(hash: string): string {
  return hash.length > 16 ? `${hash.slice(0, 10)}…${hash.slice(-4)}` : hash
}

function VersionRow({
  version,
  onOpenLink
}: {
  version: VpmCatalogVersionDto
  onOpenLink: (url: string) => void
}): JSX.Element {
  const { t } = useTranslation()
  const links = [
    { label: t('vpm.catalog.changelog'), url: version.changelogUrl },
    { label: t('vpm.catalog.documentation'), url: version.documentationUrl }
  ].filter((link): link is { label: string; url: string } => isHttpLink(link.url))

  return (
    <div className="border-t py-2 first:border-t-0" style={{ borderColor: 'var(--line)' }}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-[11px]">{version.version}</span>
        {version.unityMin ? (
          <span className="faint text-[10px]">
            {t('vpm.catalog.unity', { version: version.unityMin })}
          </span>
        ) : null}
        {version.yanked ? <Badge tone="bad">{t('vpm.catalog.yanked')}</Badge> : null}
        {version.hidden ? <Badge tone="warn">{t('vpm.catalog.hidden')}</Badge> : null}
        {version.deprecated ? <Badge>{t('vpm.catalog.deprecated')}</Badge> : null}
      </div>
      <div className="faint mt-1 text-[10px]">
        {t('vpm.catalog.sources')}: {version.sources.map((source) => source.repoName).join(' · ')}
      </div>
      {version.yankedReason ? (
        <div className="mt-1 text-[10px]" style={{ color: 'var(--bad)' }}>
          {cleanText(version.yankedReason, 500)}
        </div>
      ) : null}
      {links.length ? (
        <div className="mt-1.5 flex flex-wrap items-center gap-2">
          {links.map((link) => (
            <Button key={link.url} variant="ghost" onClick={() => onOpenLink(link.url)}>
              {link.label}
            </Button>
          ))}
        </div>
      ) : null}
    </div>
  )
}

export function CatalogDialog({
  open,
  onOpenChange,
  networkAllowed,
  onEnableNetwork
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  networkAllowed: boolean
  onEnableNetwork: () => void
}): JSX.Element {
  const { t } = useTranslation()
  const [query, setQuery] = useState('')
  const [items, setItems] = useState<VpmCatalogPackageSummary[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [detail, setDetail] = useState<VpmCatalogPackageDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [pendingLink, setPendingLink] = useState<string | null>(null)
  const [linkError, setLinkError] = useState<string | null>(null)
  const [hiding, setHiding] = useState(false)
  const seq = useRef(0)
  const detailSeq = useRef(0)
  const wasNetworkAllowed = useRef(networkAllowed)

  const load = async (reset: boolean, text: string, offset: number): Promise<void> => {
    const id = ++seq.current
    setLoading(true)
    setError(null)
    try {
      const page = await vpmApi.catalogQuery({
        text: text.trim() || undefined,
        limit: 100,
        offset
      })
      if (id !== seq.current) return
      setItems((current) => (reset ? page.items : [...current, ...page.items]))
      setTotal(page.total)
      if (reset) {
        detailSeq.current++
        setSelected(null)
        setDetail(null)
        setDetailLoading(false)
      }
    } catch (cause) {
      if (id === seq.current) setError(errorText(cause))
    } finally {
      if (id === seq.current) setLoading(false)
    }
  }

  useEffect(() => {
    if (!open) {
      setQuery('')
      return
    }
    const timer = setTimeout(() => {
      void load(true, query, 0)
    }, query.trim() ? 250 : 0)
    return () => clearTimeout(timer)
    // load 是当前 render 的闭包；只需要 query/open 驱动一次搜索。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, query])

  useEffect(() => {
    const was = wasNetworkAllowed.current
    wasNetworkAllowed.current = networkAllowed
    if (open && networkAllowed && !was) void load(true, query, 0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, networkAllowed])

  const selectPackage = async (name: string): Promise<void> => {
    const id = ++detailSeq.current
    setSelected(name)
    setDetail(null)
    setDetailLoading(true)
    try {
      const next = await vpmApi.packageDetail(name)
      if (id === detailSeq.current) setDetail(next)
    } catch (cause) {
      if (id === detailSeq.current) setError(errorText(cause))
    } finally {
      if (id === detailSeq.current) setDetailLoading(false)
    }
  }

  /**
   * P8-C：把当前包加进"隐藏列表"。
   *
   * 隐藏是用户偏好（存在 VPM 设置里），不是仓库里的 hidden 标记：
   * 只影响这个用户看到的列表，不影响解析和已装包。
   */
  const hidePackage = async (name: string): Promise<void> => {
    setHiding(true)
    setError(null)
    try {
      const prefs = await vpmApi.settingsGet()
      if (!prefs.hiddenPackageIds.includes(name)) {
        await vpmApi.settingsPatch({
          hiddenPackageIds: [...prefs.hiddenPackageIds, name]
        })
      }
      detailSeq.current++
      setSelected(null)
      setDetail(null)
      await load(true, query, 0)
    } catch (cause) {
      setError(errorText(cause))
    } finally {
      setHiding(false)
    }
  }

  const requestLink = (url: string): void => {
    if (!isHttpLink(url)) return
    setLinkError(null)
    setPendingLink(url)
  }

  const openLink = async (): Promise<void> => {
    if (!pendingLink) return
    try {
      await vpmApi.openExternal(pendingLink)
      setPendingLink(null)
    } catch (cause) {
      setLinkError(errorText(cause))
    }
  }

  const selectHint = selected && !detail && !detailLoading ? t('vpm.catalog.noResult') : t('vpm.catalog.select')

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={t('vpm.catalog.title')}
      footer={
        <Button onClick={() => onOpenChange(false)}>
          {t('vpm.catalog.close')}
        </Button>
      }
    >
      <div className="space-y-3 text-[12px]">
        <p className="faint text-[11px] leading-relaxed">{t('vpm.catalog.intro')}</p>

        {!networkAllowed ? (
          <div
            className="flex items-center justify-between gap-3 rounded border px-3 py-2 text-[11px]"
            style={{ borderColor: 'var(--warn)', color: 'var(--warn)' }}
          >
            <span>{t('vpm.repos.noConsent')}</span>
            <Button variant="ghost" onClick={onEnableNetwork}>
              {t('vpm.repos.allowNetwork')}
            </Button>
          </div>
        ) : null}

        <input
          className="input"
          value={query}
          placeholder={t('vpm.catalog.search')}
          onChange={(event) => setQuery(event.target.value)}
        />
        <div className="flex flex-wrap items-center gap-2 text-[10px]">
          <Badge>{t('vpm.catalog.filterAll')}</Badge>
          <Button variant="ghost" disabled>
            {t('vpm.catalog.filterInstalled')}
          </Button>
          <Button variant="ghost" disabled>
            {t('vpm.catalog.filterUpdatable')}
          </Button>
          <span className="faint">{t('vpm.catalog.filterUnavailable')}</span>
        </div>

        {error ? (
          <div
            className="rounded border px-3 py-2 text-[11px]"
            style={{ borderColor: 'var(--bad)', color: 'var(--bad)' }}
          >
            <div>{error}</div>
            <div className="mt-2">
              <Button variant="ghost" onClick={() => void load(true, query, 0)}>
                {t('common.reload')}
              </Button>
            </div>
          </div>
        ) : null}

        <div className="grid min-h-[320px] grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] gap-3">
          <div
            className="max-h-[52vh] overflow-auto rounded border"
            style={{ borderColor: 'var(--line)' }}
          >
            {loading && !items.length ? (
              <div className="faint p-3 text-[11px]">{t('common.loading')}</div>
            ) : null}
            {!loading && !items.length ? (
              <div className="p-3 text-[11px] leading-relaxed" style={{ color: 'var(--muted)' }}>
                {!networkAllowed ? `${t('vpm.repos.cacheOnly')}：` : ''}
                {query.trim() ? t('vpm.catalog.noResult') : t('vpm.catalog.empty')}
              </div>
            ) : null}
            {items.map((item) => {
              const active = item.name === selected
              return (
                <button
                  key={item.name}
                  type="button"
                  onClick={() => void selectPackage(item.name)}
                  className="block w-full border-b px-3 py-2 text-left last:border-b-0"
                  style={{
                    borderColor: 'var(--line)',
                    background: active ? 'var(--accent-soft)' : undefined
                  }}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-[12px]">{cleanText(item.displayName, 120) || item.name}</span>
                    {item.hasConflict ? <Badge tone="warn">{t('vpm.catalog.conflict')}</Badge> : null}
                  </div>
                  <div className="faint mt-0.5 truncate font-mono text-[10px]">{item.name}</div>
                  <div className="faint mt-1 flex flex-wrap gap-x-2 gap-y-0.5 text-[10px]">
                    <span>{t('vpm.catalog.latest', { version: item.latestVersion })}</span>
                    <span>{t('vpm.catalog.sources')}: {item.sources.slice(0, 2).map((source) => source.repoName).join(' · ')}{item.sources.length > 2 ? ' …' : ''}</span>
                    <span>{t('vpm.catalog.versions', { count: item.versionCount })}</span>
                    {item.unityMin ? (
                      <span>{t('vpm.catalog.unity', { version: item.unityMin })}</span>
                    ) : null}
                  </div>
                </button>
              )
            })}
            {items.length < total ? (
              <div className="p-2">
                <Button
                  variant="ghost"
                  onClick={() => void load(false, query, items.length)}
                  disabled={loading}
                >
                  {loading ? t('common.loading') : t('vpm.catalog.loadMore')}
                </Button>
              </div>
            ) : null}
          </div>

          <div
            className="max-h-[52vh] overflow-auto rounded border p-3"
            style={{ borderColor: 'var(--line)' }}
          >
            {!selected ? (
              <div className="faint text-[11px] leading-relaxed">{selectHint}</div>
            ) : detailLoading ? (
              <div className="faint text-[11px]">{t('common.loading')}</div>
            ) : !detail ? (
              <div className="faint text-[11px]">{selectHint}</div>
            ) : (
              <div className="space-y-3">
                <div>
                  <div className="text-[13px] font-medium">
                    {cleanText(detail.displayName, 200) || detail.name}
                  </div>
                  <div className="faint mt-0.5 break-all font-mono text-[10px]">{detail.name}</div>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5">
                    <Badge>{t('vpm.catalog.versions', { count: detail.versionCount })}</Badge>
                    {detail.hasConflict ? <Badge tone="warn">{t('vpm.catalog.conflict')}</Badge> : null}
                    {detail.hasYanked ? <Badge tone="bad">{t('vpm.catalog.yanked')}</Badge> : null}
                    {detail.hidden ? <Badge tone="warn">{t('vpm.catalog.hidden')}</Badge> : null}
                  </div>
                  <div className="faint mt-1 text-[10px]">
                    {t('vpm.catalog.sources')}: {detail.sources.map((source) => source.repoName).join(' · ')}
                  </div>
                  <div className="mt-2">
                    <Button
                      variant="ghost"
                      disabled={hiding}
                      onClick={() => void hidePackage(detail.name)}
                    >
                      {t('vpm.catalog.hide')}
                    </Button>
                  </div>
                </div>

                <div>
                  <div className="label mb-1">{t('vpm.catalog.description')}</div>
                  <div className="whitespace-pre-wrap text-[11px] leading-relaxed" style={{ color: 'var(--muted)' }}>
                    {cleanText(detail.description) || t('vpm.catalog.noDescription')}
                  </div>
                </div>

                {detail.conflicts.length ? (
                  <div
                    className="rounded border px-2 py-1.5 text-[10px] leading-relaxed"
                    style={{ borderColor: 'var(--warn)', color: 'var(--warn)' }}
                  >
                    <div>{t('vpm.catalog.conflictBody')}</div>
                    {detail.conflicts.map((conflict) => (
                      <div key={conflict.version} className="mt-1">
                        <span className="font-mono">{conflict.version}</span> ·{' '}
                        {conflict.sources.join(' / ')} · {conflict.hashes.map(shortHash).join(' / ')}
                      </div>
                    ))}
                  </div>
                ) : null}

                <div>
                  <div className="label mb-1">{t('vpm.catalog.versionList')}</div>
                  {detail.versions.map((version) => (
                    <VersionRow key={version.version} version={version} onOpenLink={requestLink} />
                  ))}
                </div>

                <div className="faint text-[10px] leading-relaxed">{t('vpm.catalog.installLater')}</div>
              </div>
            )}
          </div>
        </div>

      <Modal
        open={!!pendingLink}
        onOpenChange={(next) => {
          if (!next) {
            setPendingLink(null)
            setLinkError(null)
          }
        }}
        title={t('vpm.external.title')}
        footer={
          <>
            <Button onClick={() => setPendingLink(null)}>{t('vpm.external.cancel')}</Button>
            <Button variant="accent" onClick={() => void openLink()}>
              {t('vpm.external.open')}
            </Button>
          </>
        }
      >
        <div className="space-y-2 text-[12px]">
          <div>{t('vpm.external.body', { url: pendingLink ?? '' })}</div>
          <div className="break-all font-mono text-[11px]">{pendingLink}</div>
          {linkError ? (
            <div className="rounded border px-2 py-1.5 text-[11px]" style={{ borderColor: 'var(--bad)', color: 'var(--bad)' }}>
              {linkError}
            </div>
          ) : null}
        </div>
      </Modal>
      </div>
    </Modal>
  )
}
