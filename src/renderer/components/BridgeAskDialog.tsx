import { useTranslation } from 'react-i18next'
import { canSilenceRestBridgeAsks, restBridgeAskCount } from '../../shared/bridgeAsk'
import { useUi } from '../stores/ui'
import { Button, Modal } from './ui'

/**
 * R4 ⑦ · 第一次发现某个 Unity 工程时弹的三按钮窗（规格 R-10：`[安装] [以后都自动安装] [暂不]`）。
 *
 * ## 为什么这么薄
 *
 * 该不该弹、弹完存什么，全在 `shared/bridgeAsk.ts`（纯函数 + 单测）。
 * 本仓库渲染层零 DOM 测试，组件里只要写了判断就等于没测 —— 这里只做映射。
 * （连"后面还排着几个"要不要显示那句也不许再写 `waiting > 1` 在这里，走
 * `canSilenceRestBridgeAsks` / `restBridgeAskCount`。）
 *
 * ## 措辞是特意写长的
 *
 * M6 Q3 那条教训：`autoLaunch`（开机自启）和"常驻托盘"混在一句话里，用户以为勾了才会收进托盘。
 * 这次中间那个按钮叫「以后都自动安装」，很容易被理解成"以后所有工程都自动装"或者"开机自动装"，
 * 所以按钮上直接带"只这个工程"，正文下面再补一句说明。
 *
 * ## M7 Q10 加的第四颗
 *
 * 全新安装一次发现一批工程会连问 N 次（第 2 轮实测真机 8 个）。多出来那颗「剩下这些都不再问」
 * 只把**队列里其余那些**各写一行 never，屏幕上这条照旧要答 ——
 * 故意不做成"全局静音"，判据必须继续只有一个真相来源。
 */
export function BridgeAskDialog(): JSX.Element | null {
  const { t } = useTranslation()
  /** 一次只弹队首：全新安装会一轮发现一批工程，每条都得问到（答完自动轮下一条） */
  const ask = useUi((s) => s.bridgeAsk[0])
  const waiting = useUi((s) => s.bridgeAsk.length)
  const answer = useUi((s) => s.answerBridgeAsk)
  const dismiss = useUi((s) => s.dismissBridgeAsk)
  const silenceRest = useUi((s) => s.silenceRestBridgeAsks)

  if (!ask) return null

  return (
    <Modal open onOpenChange={() => dismiss()} title={t('project.bridgeAskTitle', { name: ask.name })}>
      <div className="flex flex-col gap-3 text-[12px]">
        <div style={{ color: 'var(--muted)', lineHeight: 1.7 }}>{t('project.bridgeAskBody')}</div>
        <div className="text-[11px]" style={{ color: 'var(--warn)', lineHeight: 1.7 }}>
          {t('project.bridgeAskNote')}
        </div>
        {/* 后面还排着几个：先说清楚，不然用户答完以为已经问完了 */}
        {canSilenceRestBridgeAsks(waiting) ? (
          <div className="flex items-center justify-between gap-3">
            <span className="text-[11px]" style={{ color: 'var(--muted)' }}>
              {t('project.bridgeAskMore', { n: restBridgeAskCount(waiting) })}
            </span>
            <Button variant="ghost" onClick={() => void silenceRest()}>
              {t('project.bridgeAskSilenceRest', { n: restBridgeAskCount(waiting) })}
            </Button>
          </div>
        ) : null}
        <div className="flex flex-wrap justify-end gap-2">
          <Button onClick={() => void answer('never')}>{t('project.bridgeAskNever')}</Button>
          <Button onClick={() => void answer('install-once')}>{t('project.bridgeAskInstall')}</Button>
          <Button variant="accent" onClick={() => void answer('always')}>
            {t('project.bridgeAskAlways')}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
