import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type {
  VpmCatalogPackageDetail,
  VpmCatalogPackageSummary,
  VpmCatalogVersionDto
} from '../../../../shared/vpm/dto'
import { Badge, Button, Modal } from '../../../components/ui'
import { errorText } from '../../../lib/msg'
import { vpmApi } from '../../api'
import { actionFor } from '../../lib/cart'
import { cleanText } from '../../lib/view'

export interface AddPackagePick {
  name: string
  version: string
}

/**
 * 从仓库里挑一个包安装到当前工程。
 *
 * 只负责收集 `{ name, version }`；真正的依赖解析、冲突检查和写入都走
 * 现有的 `VpmApplyPlanSheet → PlanService → 安装事务`，这里不拼计划。
 */
export function VpmAddPackageDialog({
  open,
  onOpenChange,
  installed,
  networkAllowed,
  onEnableNetwork,
  onPick
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 工程里已安装的包名 → 版本；用于显示“已安装”和选升级/降级/重装。 */
  installed: ReadonlyMap<string, string | null>
  networkAllowed: boolean
  onEnableNetwork: () => void
  onPick: (pick: AddPackagePick) => void
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
  const [version, setVersion] = useState('')
  const [allowPrerelease, setAllowPrerelease] = useState(false)
  const seq = useRef(0)
  const detailSeq = useRef(0)

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
        setVersion('')
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
    let cancelled = false
    vpmApi
      .settingsGet()
      .then((prefs) => {
        if (!cancelled) setAllowPrerelease(prefs.allowPrerelease)
      })
      .catch(() => {
        /* 设置读坏了按默认“不显示预发布” */
      })
    return () => {
      cancelled = true
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const timer = setTimeout(() => {
      void load(true, query, 0)
    }, query.trim() ? 250 : 0)
    return () => clearTimeout(timer)
    // load 是当前 render 的闭包；只需要 query/open 驱动一次搜索。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, query])

  const installedVersion = selected ? (installed.get(selected) ?? null) : null

  const versions = useMemo<VpmCatalogVersionDto[]>(() => {
    if (!detail) return []
    const available = detail.versions.filter(
      (item) => !item.yanked && (allowPrerelease || !item.version.includes('-') || item.version === installedVersion)
    )
    if (available.length) return available
    return detail.versions.filter((item) => !item.yanked)
  }, [detail, allowPrerelease, installedVersion])

  useEffect(() => {
    if (!detail) return
    setVersion((current) =>
      current && versions.some((item) => item.version === current)
        ? current
        : versions[0]?.version ?? ''
    )
  }, [detail, versions])

  const selectPackage = async (name: string): Promise<void> => {
    const id = ++detailSeq.current
    setSelected(name)
    setDetail(null)
    setVersion('')
    setDetailLoading(true)
    setError(null)
    try {
      const next = await vpmApi.packageDetail(name)
      if (id === detailSeq.current) setDetail(next)
    } catch (cause) {
      if (id === detailSeq.current) setError(errorText(cause))
    } finally {
      if (id === detailSeq.current) setDetailLoading(false)
    }
  }

  const action = version ? actionFor(installedVersion, version) : null

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      width={900}
      title={t('vpm.addPackage.title')}
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>{t('vpm.addPackage.cancel')}</Button>
          <Button
            variant="accent"
            disabled={!selected || !version || detailLoading}
            onClick={() => {
              if (!selected || !version) return
              onPick({ name: selected, version })
              onOpenChange(false)
            }}
          >
            {action ? t(`vpm.plan.action.${action}`) : t('vpm.addPackage.add')}
          </Button>
        </>
      }
    >
      <div className="space-y-3 text-[12px]">
        <p className="faint text-[11px] leading-relaxed">{t('vpm.addPackage.intro')}</p>

        {!networkAllowed ? (
          <div
            className="flex items-center justify-between gap-2 rounded border px-3 py-2 text-[11px]"
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
          aria-label={t('vpm.catalog.search')}
        />

        {error ? (
          <div
            className="rounded border px-3 py-2 text-[11px]"
            role="alert"
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

        <div className="grid min-h-[360px] grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] gap-3">
          <div className="max-h-[52vh] overflow-auto rounded border" style={{ borderColor: 'var(--line)' }}>
            {loading && !items.length ? (
              <div className="faint p-3 text-[11px]">{t('common.loading')}</div>
            ) : null}
            {!loading && !items.length ? (
              <div className="p-3 text-[11px] leading-relaxed" style={{ color: 'var(--muted)' }}>
                {query.trim() ? t('vpm.catalog.noResult') : t('vpm.catalog.empty')}
              </div>
            ) : null}
            {items.map((item) => {
              const active = item.name === selected
              const current = installed.get(item.name) ?? null
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
                    <span className="truncate text-[12px]">
                      {cleanText(item.displayName, 120) || item.name}
                    </span>
                    {current ? (
                      <Badge tone="ok">{t('vpm.addPackage.installed', { version: current })}</Badge>
                    ) : null}
                  </div>
                  <div className="faint mt-0.5 truncate font-mono text-[10px]">{item.name}</div>
                  <div className="faint mt-1 flex flex-wrap gap-x-2 gap-y-0.5 text-[10px]">
                    <span>{t('vpm.catalog.latest', { version: item.latestVersion })}</span>
                    <span>
                      {t('vpm.catalog.sources')}:{' '}
                      {item.sources.slice(0, 2).map((source) => source.repoName).join(' · ')}
                      {item.sources.length > 2 ? ' …' : ''}
                    </span>
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

          <div className="max-h-[52vh] overflow-auto rounded border p-3" style={{ borderColor: 'var(--line)' }}>
            {!selected ? (
              <div className="faint text-[11px] leading-relaxed">{t('vpm.addPackage.select')}</div>
            ) : detailLoading ? (
              <div className="faint text-[11px]">{t('common.loading')}</div>
            ) : !detail ? (
              <div className="faint text-[11px]">{t('vpm.catalog.noResult')}</div>
            ) : (
              <div className="space-y-2">
                <div className="text-[13px] font-semibold">
                  {cleanText(detail.displayName, 200) || detail.name}
                </div>
                <div className="faint break-all font-mono text-[10px]">{detail.name}</div>
                {detail.description ? (
                  <p className="faint text-[11px] leading-relaxed">{cleanText(detail.description, 800)}</p>
                ) : null}
                <div className="faint text-[10px]">
                  {t('vpm.catalog.sources')}:{' '}
                  {detail.sources.map((source) => source.repoName).join(' · ')}
                </div>
                <label className="block space-y-1">
                  <span className="faint text-[10px]">{t('vpm.addPackage.version')}</span>
                  <select
                    className="input h-8 w-full font-mono text-[11px]"
                    value={version}
                    onChange={(event) => setVersion(event.target.value)}
                  >
                    {versions.map((item) => (
                      <option key={item.version} value={item.version}>
                        {item.version}
                        {item.version === installedVersion ? ` ${t('vpm.packages.current')}` : ''}
                        {item.deprecated ? ` · ${t('vpm.catalog.deprecated')}` : ''}
                      </option>
                    ))}
                  </select>
                </label>
                {versions.find((item) => item.version === version)?.unityMin ? (
                  <div className="faint text-[10px]">
                    {t('vpm.catalog.unity', {
                      version: versions.find((item) => item.version === version)?.unityMin
                    })}
                  </div>
                ) : null}
                {detail.hasConflict ? <Badge tone="warn">{t('vpm.catalog.conflict')}</Badge> : null}
              </div>
            )}
          </div>
        </div>
      </div>
    </Modal>
  )
}
