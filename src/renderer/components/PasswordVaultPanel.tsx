import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { RememberedEntry } from '../../shared/types'
import { useUi } from '../stores/ui'
import { Button, Field } from './ui'

/**
 * M7 ⑥ · 「已记住的密码」（设置 → 库）。
 *
 * ## 为什么这一屏必须存在
 *
 * 记住密码这件事，用户要能**看见记了哪些**、**逐条删掉**。
 * 只进不出的密码库等于替用户多存了一份秘密，而他自己不知道。
 *
 * ## 三条口径
 *
 *  1. 这里**永远不显示密码本身**，连点一下看明文都不给 —— 主进程递过来的那份结构里就没有明文。
 *  2. 加密不可用时顶部直接说"这台机器存不了"，而不是让那个勾看起来生效了。
 *  3. `readable:false` 的那条要标出来：那是换过机器 / 换过 Windows 用户留下的解不开的密文，
 *     留着没用但也**不偷偷删**，让他自己点删除。
 */
export function PasswordVaultPanel(): JSX.Element {
  const { t } = useTranslation()
  const toast = useUi((s) => s.toast)
  const [rows, setRows] = useState<RememberedEntry[]>([])
  const [available, setAvailable] = useState(true)
  const [loaded, setLoaded] = useState(false)

  const reload = useCallback(async () => {
    try {
      const [st, list] = await Promise.all([window.a.secrets.status(), window.a.secrets.list()])
      setAvailable(st.available)
      setRows(list)
    } catch (e) {
      toast('bad', e instanceof Error ? e.message : String(e))
    } finally {
      setLoaded(true)
    }
  }, [toast])

  useEffect(() => {
    void reload()
  }, [reload])

  async function forget(id: number): Promise<void> {
    try {
      await window.a.secrets.forget(id)
      await reload()
    } catch (e) {
      toast('bad', e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <Field label={t('settings.vaultTitle')} hint={available ? t('settings.vaultHint') : t('settings.vaultUnavailable')}>
      <div className="flex flex-col gap-1">
        {!loaded ? <span className="text-[11px]" style={{ color: 'var(--faint)' }}>{t('common.loading')}</span> : null}
        {loaded && !rows.length ? (
          <span className="text-[11px]" style={{ color: 'var(--faint)' }}>
            {t('settings.vaultEmpty')}
          </span>
        ) : null}
        {rows.map((r) => (
          <div key={r.id} className="flex items-center gap-2 text-[11px]">
            <span className="flex-1 truncate" title={r.path}>
              {r.hint || r.path}
            </span>
            {!r.readable ? (
              <span style={{ color: 'var(--warn)' }} title={t('settings.vaultUnreadableHint')}>
                {t('settings.vaultUnreadable')}
              </span>
            ) : null}
            <Button variant="ghost" onClick={() => void forget(r.id)}>
              {t('common.remove')}
            </Button>
          </div>
        ))}
      </div>
    </Field>
  )
}
