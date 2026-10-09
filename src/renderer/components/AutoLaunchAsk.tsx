import { useTranslation } from 'react-i18next'
import { shouldAskAutoLaunch } from '../../shared/bannerState'
import { useUi } from '../stores/ui'
import { Button, Modal } from './ui'

/**
 * M6 ⑥（Q3 裁定）：那条"要不要开机常驻托盘"的提示，**应用内问一次**。
 *
 * 边界写死在这里：
 *  - 只有他点"好"，才走 `settings.set('autoLaunch', true)` → 那条才会去写登录启动项；
 *  - 点"不用了"也只写一个 `autoLaunchAsked` 标记，不碰系统；
 *  - 规格 §4.3 要的是"默认开启"，这一版**故意不照做**（不擅自改用户的登录项），
 *    偏离的理由写在 `shared/types.ts` 里 `autoLaunchAsked` 那段注释上。
 *
 * 措辞也刻意分开：`autoLaunch` 是"开机自启"，"常驻托盘"是运行时行为（`minimizeToTray`），
 * 两件事混成一句会让人以为勾了这个才会收进托盘。
 */
export function AutoLaunchAsk(): JSX.Element | null {
  const { t } = useTranslation()
  const autoLaunch = useUi((s) => s.settings.autoLaunch)
  const asked = useUi((s) => s.settings.autoLaunchAsked)
  const sawUnityStart = useUi((s) => s.banner.sawUnityStart)
  const answer = useUi((s) => s.answerAutoLaunch)

  if (!shouldAskAutoLaunch({ autoLaunch, alreadyAsked: asked, sawUnityStart })) return null

  return (
    <Modal open onOpenChange={() => undefined} title={t('settings.autoLaunchAskTitle')}>
      <div className="flex flex-col gap-3 text-[12px]">
        <div style={{ color: 'var(--muted)' }}>{t('settings.autoLaunchAskBody')}</div>
        <div className="flex justify-end gap-2">
          <Button onClick={() => void answer(false)}>{t('settings.autoLaunchAskNo')}</Button>
          <Button variant="accent" onClick={() => void answer(true)}>
            {t('settings.autoLaunchAskYes')}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
