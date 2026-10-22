import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Badge, Button } from '../../../components/ui'
import { errorText } from '../../../lib/msg'
import { vpmApi } from '../../api'

interface LocalRoot {
  id: string
  path: string
  label: string | null
  lastScanAt: number | null
  packageCount: number
}

interface LocalPackage {
  name: string
  version: string
  path: string
  unity: string | null
  rootId: string
}

/**
 * 本地包目录（P7-C）。
 *
 * 只有用户**显式添加**的目录才会被扫；这里不自动扫全盘。
 * 添加后立刻扫一次，把包名/版本列出来——看得见才敢信任。
 */
export function LocalPackagesPanel(): JSX.Element {
  const { t } = useTranslation()
  const [roots, setRoots] = useState<LocalRoot[]>([])
  const [packages, setPackages] = useState<LocalPackage[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (): Promise<void> => {
    try {
      const [nextRoots, nextPackages] = await Promise.all([vpmApi.localRoots(), vpmApi.localScan()])
      setRoots(nextRoots)
      setPackages(nextPackages)
    } catch (cause) {
      setError(errorText(cause))
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const add = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const picked = await vpmApi.pickProjectDirectory(t('vpm.local.pick'))
      if (!picked) return
      await vpmApi.localAdd({ path: picked })
      await load()
    } catch (cause) {
      setError(errorText(cause))
    } finally {
      setBusy(false)
    }
  }

  const remove = async (id: string): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      await vpmApi.localRemove(id)
      await load()
    } catch (cause) {
      setError(errorText(cause))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="space-y-2">
      <div className="flex items-center gap-2">
        <span className="text-[14px] font-semibold">{t('vpm.local.title')}</span>
        <Badge>{roots.length}</Badge>
        <Button variant="accent" className="ml-auto" onClick={() => void add()} disabled={busy}>
          {t('vpm.local.add')}
        </Button>
      </div>
      <p className="text-[11px]" style={{ color: 'var(--muted)' }}>
        {t('vpm.local.hint')}
      </p>

      {error ? (
        <div
          className="rounded border px-3 py-2 text-[11px]"
          style={{ borderColor: 'var(--bad)', color: 'var(--bad)' }}
        >
          {error}
        </div>
      ) : null}

      {roots.length === 0 ? (
        <p className="text-[12px]" style={{ color: 'var(--faint)' }}>
          {t('vpm.local.empty')}
        </p>
      ) : (
        <div className="rounded border" style={{ borderColor: 'var(--line)' }}>
          {roots.map((root) => {
            const own = packages.filter((pkg) => pkg.rootId === root.id)
            return (
              <div key={root.id} className="border-b p-3 last:border-b-0" style={{ borderColor: 'var(--line)' }}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[13px]">{root.label ?? root.path.split(/[\\/]/).pop()}</span>
                  <Badge>{t('vpm.local.count', { count: own.length })}</Badge>
                  <span className="ml-auto">
                    <Button variant="ghost" disabled={busy} onClick={() => void remove(root.id)}>
                      {t('vpm.local.remove')}
                    </Button>
                  </span>
                </div>
                <div className="mt-1 break-all font-mono text-[11px]" style={{ color: 'var(--faint)' }}>
                  {root.path}
                </div>
                {own.length ? (
                  <div className="mt-2 space-y-1">
                    {own.map((pkg) => (
                      <div key={`${pkg.name}@${pkg.version}`} className="flex flex-wrap items-center gap-2 text-[12px]">
                        <span className="font-mono">{pkg.name}</span>
                        <span style={{ color: 'var(--muted)' }}>{pkg.version}</span>
                        {pkg.unity ? <Badge>{`Unity ${pkg.unity}`}</Badge> : null}
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}
