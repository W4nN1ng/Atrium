import { useTranslation } from 'react-i18next'
import { rearchiveDialogState } from '../../shared/rearchiveDialog'
import type { LocaleKey } from '../../shared/types'
import { useUi } from '../stores/ui'
import { humanBytes } from '../lib/format'
import { Button, Modal } from './ui'

/**
 * R4 ③ · 「改分类要把文件也搬过去吗」确认卡。
 *
 * ## 为什么必须存在这一张卡
 *
 * 这是这一轮**唯一直接动素材磁盘**的操作（真实库 25 GB）。
 * 老行为是"改分类只改卡片、文件留在原地"，于是卡片写着道具、文件夹还在 `材质/` 下面，
 * 按分类浏览找不到、按目录浏览对不上。改成"默认就搬"更糟：一次误点就搬几百个 G。
 * 所以：只读预览 → 说清"搬到哪、几个文件、多大、会不会撞名" → 用户点头才执行。
 *
 * ## 这个组件里一个判断都没有
 *
 * 给不给「搬过去」、要说哪几句提醒、默认键盘落点，全部来自
 * `shared/rearchiveDialog.ts`（纯函数 + 回归用例）。这里只做 key → 文字 → 排版。
 */
export function RearchiveDialog(): JSX.Element | null {
  const { t, i18n } = useTranslation()
  const st = useUi((s) => s.rearchive)
  const confirm = useUi((s) => s.confirmRearchive)
  const recordOnly = useUi((s) => s.rearchiveRecordOnly)
  const close = useUi((s) => s.closeRearchive)

  const pending = st.pending
  const s = rearchiveDialogState(pending, st.plan)
  if (!s.show || !pending) return null

  const locale = i18n.language as LocaleKey

  return (
    <Modal
      open
      onOpenChange={(v) => {
        if (!v) close()
      }}
      title={t('rearchive.title', { from: pending.fromLabel, to: pending.toLabel })}
      footer={
        <>
          <Button onClick={close} disabled={st.busy}>
            {t('common.cancel')}
          </Button>
          {s.canRecordOnly ? (
            <Button onClick={() => void recordOnly()} disabled={st.busy}>
              {t('rearchive.recordOnly')}
            </Button>
          ) : null}
          {s.canMove ? (
            <Button variant="accent" onClick={() => void confirm()} disabled={st.busy}>
              {st.busy ? t('rearchive.moving') : t('rearchive.moveIt')}
            </Button>
          ) : null}
        </>
      }
    >
      <div className="flex flex-col gap-2 text-[12px]">
        <div className="flex flex-col gap-1">
          <div className="flex items-start gap-2">
            <span className="w-16 shrink-0" style={{ color: 'var(--faint)' }}>
              {t('rearchive.now')}
            </span>
            <span className="min-w-0 break-all font-mono text-[11px]">{s.fromDir ?? t('rearchive.unknownPath')}</span>
          </div>
          {s.willMove ? (
            <div className="flex items-start gap-2">
              <span className="w-16 shrink-0" style={{ color: 'var(--faint)' }}>
                {t('rearchive.target')}
              </span>
              <span className="min-w-0 break-all font-mono text-[11px]" style={{ color: 'var(--accent)' }}>
                {s.toDir ?? ''}
              </span>
            </div>
          ) : null}
        </div>

        {s.willMove ? (
          <div style={{ color: 'var(--muted)' }}>
            {t('rearchive.size', { files: s.fileCount, size: humanBytes(s.bytes, locale) })}
          </div>
        ) : null}

        {s.notes.map((n) => (
          <div
            key={n.key}
            className="rounded border px-2 py-1.5"
            style={{ borderColor: 'var(--warn)', color: 'var(--warn)' }}
          >
            {t(n.key, n.params ?? {})}
          </div>
        ))}

        {s.willMove ? <div style={{ color: 'var(--faint)' }}>{t('rearchive.undoHint')}</div> : null}
        <div style={{ color: 'var(--faint)' }}>{t('rearchive.recordOnlyHint')}</div>
      </div>
    </Modal>
  )
}
