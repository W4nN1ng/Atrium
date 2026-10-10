import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { NOTICE_AUTO_DISMISS_MS, noticeLines, noticeText } from '../../shared/autoRemerge'
import { useUi } from '../stores/ui'
import { Button } from './ui'

/**
 * 第 9 轮 ⑥ · 「自动收拾完顺手告知一句」那条横幅。
 *
 * ## 它存在的全部理由
 *
 * ② 那次把存量重并做成 `设置 → 维护 → 检查一遍 → 合并` 四步，他的原话是
 * 「这样步骤长根本不适于普通人高效率的使用工具」。现在那件事启动时自己做了，
 * 这块横幅只负责**事后说一句**：不动手、不挡路、不抢焦点、不等回答。
 *
 * 安全垫不是"让用户先确认"，而是这三条事实：一个文件都不搬、不改用户手调过的分类、
 * 一次撤销整批退回。所以横幅上那个「撤销」是真能用的东西 —— 它带的是**这一次合并自己的
 * batch id**，撤错了目标比不撤更糟（详见 `UndoDeps.onlyBatchId`）。
 *
 * ## 三条界面约束，都在这里做掉
 *
 *  - **没有看得见的变化就不出现**：`noticeText` 在 `moved === 0` 时返回 null。
 *    只修了归并键那种变更在界面上看不出来，弹条只会让人满库找"哪里变了"。
 *  - **12 秒自己收起**，但一点「看看改了什么」计时就停 —— 正在读的东西不该被程序收走。
 *  - **组件里没有判断**：该说什么、列哪几行、超过几处折成一句，全在 `shared/autoRemerge.ts`。
 */
export function RemergeNotice(): JSX.Element | null {
  const { t } = useTranslation()
  const notice = useUi((s) => s.remergeNotice)
  const dismiss = useUi((s) => s.dismissRemergeNotice)
  const undo = useUi((s) => s.undoRemerge)
  const [open, setOpen] = useState(false)
  const [hidden, setHidden] = useState(false)
  const [busy, setBusy] = useState(false)

  const head = notice ? noticeText(notice.clusters, notice.moved) : null
  const detail = notice ? noticeLines(notice.items) : { lines: [], more: 0 }
  /** 只把"有没有得说"当依赖：`head` 每次渲染都是新对象，拿它当依赖计时器会被一直重置 */
  const hasHead = !!head
  /** 每次告知换一批 id：换的那一次重新计时、重新折叠 */
  const batchId = notice?.batchId ?? ''

  useEffect(() => {
    setHidden(false)
    setOpen(false)
  }, [batchId])

  /** 展开着就不计时 —— 用户正在读，程序不该替他决定读完了 */
  useEffect(() => {
    if (!hasHead || open || hidden) return
    const timer = setTimeout(() => setHidden(true), NOTICE_AUTO_DISMISS_MS)
    return () => clearTimeout(timer)
  }, [hasHead, open, hidden])

  if (!notice || !head || hidden) return null

  return (
    <div
      className="flex shrink-0 flex-wrap items-center gap-2 border-b px-3 py-1.5 text-[11px]"
      style={{ borderColor: 'var(--line)', background: 'var(--accent-soft)', color: 'var(--text)' }}
    >
      <span className="min-w-0">{t(head.key, head.params)}</span>
      <div className="ml-auto flex flex-wrap items-center gap-2">
        <Button className="h-6 px-2 text-[11px]" onClick={() => setOpen((v) => !v)}>
          {t(open ? 'remerge.autoDetailHide' : 'remerge.autoDetail')}
        </Button>
        <Button
          className="h-6 px-2 text-[11px]"
          disabled={busy || !notice.batchId}
          onClick={() => {
            setBusy(true)
            void undo().finally(() => setBusy(false))
          }}
        >
          {t('remerge.autoUndo')}
        </Button>
        <Button className="h-6 px-2 text-[11px]" onClick={dismiss}>
          {t('remerge.autoOk')}
        </Button>
      </div>

      {open ? (
        <div className="flex w-full flex-col gap-0.5 pl-1" style={{ color: 'var(--muted)' }}>
          {detail.lines.map((l, i) => (
            <div key={l.name + String(i)} className="truncate" title={l.name}>
              {t(l.key, { name: l.name, count: l.count })}
            </div>
          ))}
          {detail.more ? (
            <div style={{ color: 'var(--faint)' }}>{t('remerge.autoMore', { count: detail.more })}</div>
          ) : null}
          <div style={{ color: 'var(--faint)' }}>{t('remerge.autoFoot')}</div>
        </div>
      ) : null}
    </div>
  )
}
