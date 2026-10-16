import { useTranslation } from 'react-i18next'
import { importQueueRenderState } from '../../shared/importQueue'
import { importResultNote } from '../../shared/importNotes'
import { useUi } from '../stores/ui'
import { Badge, Button, Modal } from './ui'

/**
 * 导入流程的**常驻**界面：冲突确认对话框 + 进行中提示 + 上次导入结果条（带撤销）。
 *
 * ## 为什么必须是常驻组件
 *
 * 发起导入的地方有好几个（卡片双击、详情面板按钮、以后的批量按钮），
 * 而冲突确认对话框要等用户决定。如果把它放在发起方组件里，一旦那个组件卸载
 * （切页、切换筛选、批量导入后列表刷新），对话框就跟着消失，而导入还挂在那儿 ——
 * 用户会觉得"程序卡住了"。所以状态放 store，这个组件在 `App` 里挂一次。
 *
 * ## 为什么"撤销"不做成 Toast 按钮
 *
 * 用户裁定过（04 §1.2）：本应用 Toast 是**纯文本**，带按钮的一律做成常驻结果条。
 * 所以撤销入口在这一条里，不在 Toast 上。
 */
export function ImportFlow(): JSX.Element | null {
  const { t } = useTranslation()
  const flow = useUi((s) => s.importFlow)
  const resolve = useUi((s) => s.resolveImportConflict)
  const rollback = useUi((s) => s.rollbackLastImport)
  const dismiss = useUi((s) => s.dismissImportResult)
  const backupOverwritten = useUi((s) => s.settings.backupOverwritten)
  const cancelPreparation = useUi((s) => s.cancelImportPreparation)

  const pending = flow.pending
  /**
   * R4 ① · 一批的逐条进度。判据全在 `shared/importQueue.ts` 里，
   * 这个组件只把 `rows` 画出来 —— 组件里再写一个 `if (status === 'ok')` 就是
   * "看着有进度条，其实没人测过"的那种东西（本仓库渲染层零 DOM 测试）。
   */
  const q = importQueueRenderState(flow.queue)

  return (
    <>
      {q.show ? (
        <div
          className="shrink-0 border-b px-3 py-1.5 text-[11px]"
          style={{ borderColor: 'var(--line)', background: 'var(--accent-soft)', color: 'var(--accent)' }}
        >
          <div className="flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate">
              {t(q.titleKey, q.titleParams)}
              {/* 不摆 batchId：用户拿它什么都做不了，而它会把真正要紧的"成功/失败/未执行"挤出可视区 */}
            </span>
            {q.queuedNoteKey ? (
              <span style={{ color: 'var(--warn)' }}>{t(q.queuedNoteKey, q.queuedNoteParams ?? {})}</span>
            ) : null}
          </div>
          {/* 只有一条时不摆表格：单包导入的观感要和 M5-A 一样，就一行字 */}
          {!q.single ? (
            <div className="mt-1 flex max-h-[132px] flex-col gap-0.5 overflow-y-auto">
              {q.rows.map((r) => (
                <div key={r.key} className="flex items-center gap-2" style={{ color: 'var(--fg)' }}>
                  <span
                    className="shrink-0 rounded px-1 text-[10px]"
                    style={{
                      background: 'var(--panel-2)',
                      color:
                        r.tone === 'ok' ? 'var(--ok)' : r.tone === 'bad' ? 'var(--bad)' : r.tone === 'warn' ? 'var(--warn)' : 'var(--muted)'
                    }}
                  >
                    {t(r.statusKey, r.statusParams ?? {})}
                  </span>
                  <span className="min-w-0 flex-1 truncate" title={r.label} style={{ color: 'var(--muted)' }}>
                    {r.label}
                  </span>
                  {r.noteKey ? <span style={{ color: 'var(--faint)' }}>{t(r.noteKey, r.noteParams ?? {})}</span> : null}
                  {typeof r.percent === 'number' ? (
                    <span className="shrink-0 tabular-nums" style={{ color: 'var(--faint)' }}>
                      {r.percent}%
                    </span>
                  ) : null}
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {/* 进行中：别让用户以为点了没反应 */}
      {flow.busy ? (
        <div
          className="shrink-0 border-b px-3 py-1.5 text-[11px]"
          style={{ borderColor: 'var(--line)', background: 'var(--accent-soft)', color: 'var(--accent)' }}
        >
          {/*
            ⚠ 排队态与进行态要**分开说**。
            第一版这里只有"正在导入 {{name}}"，于是 Play 模式下点了导入，
            界面会一直显示"正在导入 …"几分钟不变 —— 用户以为卡死了。
            实际是 Unity 在 Play 模式不接命令、只回 busy，A 正在退避重投
            （§8-5 的验收口径点名要求显示「Unity 正在运行，已排队」）。
          */}
          {flow.busyReason === 'connecting' ? (
            <div className="flex items-center gap-3" role="status">
              <span className="min-w-0 flex-1 truncate">{t('project.preparingImport', { name: flow.projectName ?? '' })}</span>
              <Button onClick={cancelPreparation}>{t('project.cancelWaiting')}</Button>
            </div>
          ) : flow.busyReason ? (
            <>
              {t('library.queuedTitle', { reason: flow.busyReason })}
              {flow.busyRetry > 0 ? ` · ${t('library.queuedRetry', { n: flow.busyRetry })}` : ''}
              {flow.busyNextDelayMs > 0
                ? ` · ${t('library.queuedNext', { s: Math.round(flow.busyNextDelayMs / 1000) })}`
                : ''}
              {flow.packageName ? ` — ${flow.packageName}` : ''}
            </>
          ) : (
            <>
              {t('library.importing', { name: flow.packageName ?? '' })}
              {flow.projectName ? ` → ${flow.projectName}` : ''}
            </>
          )}
        </div>
      ) : null}

      {/* 上次导入结果条：带撤销。这是撤销的唯一入口（Toast 不做按钮） */}
      {flow.last && !flow.busy ? (
        <div
          className="flex shrink-0 items-center gap-2 border-b px-3 py-1.5 text-[11px]"
          style={{ borderColor: 'var(--line)', background: 'var(--panel-2)' }}
        >
          <Badge tone="ok">{t('library.importOk')}</Badge>
          <span className="min-w-0 flex-1 truncate">
            {t('library.importResult', {
              project: flow.last.projectName,
              created: flow.last.created,
              overwritten: flow.last.overwritten
            })}
            {(() => {
              /** 判据在 `shared/importNotes.ts`：备份目录存在 ≠ 真存下了文件 */
              const note = importResultNote(flow.last)
              return note ? ` · ${t(note.key, note.params)}` : ''
            })()}
          </span>
          <Button className="shrink-0" onClick={() => void rollback()}>
            {t('library.rollbackImport')}
          </Button>
          <button
            type="button"
            className="btn btn-ghost shrink-0 px-1.5 py-0.5 text-[11px]"
            onClick={dismiss}
          >
            {t('common.close')}
          </button>
        </div>
      ) : null}

      {/*
        冲突确认（§5.1④）：**必须列出具体文件路径**，而不是只说"有 12 个冲突"。
        三选一的文案照规格原文：取消 / 继续 / 继续并备份被覆盖文件。
      */}
      <Modal
        open={!!pending}
        onOpenChange={(v) => {
          if (!v) void resolve('cancel')
        }}
        title={pending?.conflicts.length ? t('library.conflictTitle', { count: pending.conflicts.length }) : t('library.importConfirmTitle')}
        footer={
          <>
            <Button onClick={() => void resolve('cancel')}>{t('common.cancel')}</Button>
            <Button variant={pending?.conflicts.length ? 'default' : 'accent'} onClick={() => void resolve('continue')}>
              {t(pending?.conflicts.length ? 'library.conflictContinue' : 'library.importConfirmAction')}
            </Button>
            {pending?.conflicts.length ? <Button variant="accent" onClick={() => void resolve('continue-with-backup')}>
              {t('library.conflictContinueBackup')}
            </Button> : null}
          </>
        }
      >
        <div className="flex flex-col gap-3 text-[12px]">
          <div>{flow.packageName} → {flow.projectName}</div>
          <div style={{ color: 'var(--muted)' }}>
            {t(pending?.conflicts.length ? 'library.conflictIntro' : 'library.importConfirmIntro', {
              total: pending?.entryCount ?? 0,
              fresh: pending?.fresh ?? 0
            })}
          </div>

          {pending?.conflicts.length ? <div
            className="max-h-[220px] overflow-y-auto rounded border px-2 py-1 font-mono text-[11px]"
            style={{ borderColor: 'var(--line-2)', background: 'var(--panel-2)' }}
          >
            {(pending?.conflicts ?? []).map((c) => (
              <div key={c.guid} className="border-b py-0.5 last:border-b-0" style={{ borderColor: 'var(--line)' }}>
                <div style={{ color: 'var(--warn)' }}>{c.existingPath}</div>
                <div style={{ color: 'var(--faint)' }}>
                  {t('library.conflictIncoming')} {c.incomingPath}
                </div>
              </div>
            ))}
          </div> : null}

          {pending?.conflicts.length ? <div style={{ color: 'var(--muted)' }}>
            {backupOverwritten ? t('library.conflictBackupOn') : t('library.conflictBackupOff')}
          </div> : null}
        </div>
      </Modal>
    </>
  )
}
