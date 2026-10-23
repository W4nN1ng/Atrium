import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, Modal } from '../../components/ui'
import { errorText } from '../../lib/msg'
import { useUi } from '../../stores/ui'
import { vpmApi } from '../api'

type Intent =
  | { kind: 'open-project'; path: string }
  | { kind: 'add-repo'; url: string; name: string | null; source: 'atrium' | 'vcc' }

/**
 * 深链宿主（P7-E）。
 *
 * - `atrium://open?path=…` → 切到项目页并把工程加进列表（**不自动启动 Unity**）
 * - `atrium://add-repo?url=…` / `vcc://vpm/addRepo?url=…` → **弹确认**，用户点「添加」才写
 *
 * 深链**永远不能绕过确认**直接改仓库或装包；带凭据的链接在主进程就被拒了。
 */
export function DeepLinkHost(): JSX.Element | null {
  const { t } = useTranslation()
  const [pending, setPending] = useState<Intent | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const setNav = useUi((state) => state.setNav)
  const toast = useUi((state) => state.toast)

  useEffect(() => {
    return vpmApi.onDeepLink((payload) => {
      const intent = payload as Intent | null
      if (!intent) return
      if (intent.kind === 'add-repo') {
        setError(null)
        setPending(intent)
        return
      }
      if (intent.kind === 'open-project') {
        setNav('project')
        void vpmApi
          .projectAdd({ path: intent.path })
          .then(() => toast('ok', t('vpm.deeplink.projectOpened')))
          .catch((cause) => toast('bad', errorText(cause)))
      }
    })
  }, [setNav, t, toast])

  const confirmAdd = async (): Promise<void> => {
    if (!pending || pending.kind !== 'add-repo') return
    setBusy(true)
    setError(null)
    try {
      await vpmApi.repoAdd({
        url: pending.url,
        ...(pending.name ? { name: pending.name } : {})
      })
      toast('ok', t('vpm.deeplink.repoAdded'))
      setPending(null)
    } catch (cause) {
      setError(errorText(cause))
    } finally {
      setBusy(false)
    }
  }

  // 只有 add-repo 需要确认；open-project 已经在上面直接处理掉了
  if (!pending || pending.kind !== 'add-repo') return null
  const repo = pending

  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open && !busy) setPending(null)
      }}
      title={t('vpm.deeplink.title')}
      footer={
        <>
          <Button onClick={() => setPending(null)} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button variant="accent" onClick={() => void confirmAdd()} disabled={busy}>
            {busy ? t('vpm.deeplink.adding') : t('vpm.deeplink.add')}
          </Button>
        </>
      }
    >
      <div className="space-y-2 text-[12px]">
        <p className="text-[11px]" style={{ color: 'var(--muted)' }}>
          {t('vpm.deeplink.body')}
        </p>
        <div className="break-all font-mono text-[11px]">{repo.url}</div>
        {repo.source === 'vcc' ? (
          <p className="text-[11px]" style={{ color: 'var(--warn)' }}>
            {t('vpm.deeplink.fromVcc')}
          </p>
        ) : null}
        {error ? (
          <div
            className="rounded border px-2 py-1.5 text-[11px]"
            style={{ borderColor: 'var(--bad)', color: 'var(--bad)' }}
          >
            {error}
          </div>
        ) : null}
      </div>
    </Modal>
  )
}
