import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { LocaleKey, PlanItemView } from '../../shared/types'
import { capNoteKeys, planSummary, totalBytesOf, IMPORT_BATCH_MAX } from '../../shared/memberPick'
import { humanBytes } from '../lib/format'
import { useUi } from '../stores/ui'
import { Badge, Button, Modal, Tip } from './ui'

/**
 * 容器成员选择面板（M5-B ⑥）。
 *
 * 一张卡三步：**勾选 → 这一批的冲突汇总 → 这一批的结果**（然后才问要不要下一批）。
 *
 * ## 为什么"预勾"必须写明依据，而且允许什么都不勾
 *
 * 一次导 8 个包，Play 模式下最坏要等 8 次排队，按错一次代价不小。所以规矩是：
 * 只有**名字匹配**才允许替他勾，而且那一行要写出"因为工程里有 shinano 才勾上"；
 * 命中面太宽（一个词勾上一大半、或超过一批）就**一个都不勾**并说明原因 ——
 * 那种时候"替他全选"只是把取消的工作推给用户，还多出误点的可能。
 *
 * ## 为什么一次只抽一批
 *
 * 主进程那条链的空间闸门是按"这一批落多少字节"量的，界面切成 8 个一批正好对上。
 * 先把 87 个全抽出来再问用户，等于把闸门要防的那件事自己做掉。
 *
 * ## 为什么挂 App 而不是 BundleDetail 里
 *
 * 和 `ImportFlow` 同一个理由：发起的地方不止一处（容器视图的按钮、双击多成员卡），
 * 而"抽好了等确认"这一步必须活过宿主组件的卸载（切页、切筛选），
 * 否则对话框跟着没了、副本却还躺在盘上。
 */
export function MemberPicker(): JSX.Element | null {
  const { t, i18n } = useTranslation()
  const locale = i18n.language as LocaleKey
  const p = useUi((s) => s.memberPicker)
  const close = useUi((s) => s.closeMemberPicker)
  const toggle = useUi((s) => s.toggleMemberPick)
  const pickAll = useUi((s) => s.pickAllMembers)
  const clearPicks = useUi((s) => s.clearMemberPicks)
  const pickUnder = useUi((s) => s.pickMembersUnder)
  const start = useUi((s) => s.runMemberBatches)
  const decide = useUi((s) => s.decideMemberPlan)
  const next = useUi((s) => s.nextMemberBatch)
  const stop = useUi((s) => s.stopMemberBatches)
  const reload = useUi((s) => s.reloadMemberPicker)
  const rollbackBatch = useUi((s) => s.rollbackMemberOutcome)
  const backupOverwritten = useUi((s) => s.settings.backupOverwritten)
  /** 批大小以**主进程返回的那个**为准（返回之前先用默认值占位，两边共用一个常量） */
  const batchMax = p.plan?.batchMax ?? IMPORT_BATCH_MAX
  /** 一个目录里挤 17 个、整容器 400 个的时候不能一口气往 DOM 里塞 */
  const [limit, setLimit] = useState(60)

  const totals = useMemo(() => totalBytesOf(p.packages), [p.packages])
  const pickedBytes = useMemo(
    () => p.packages.filter((x) => p.picked.includes(x.relPath)).reduce((a, x) => a + x.sizeBytes, 0),
    [p.packages, p.picked]
  )
  const notes = useMemo(() => capNoteKeys(p.notes), [p.notes])
  const batchCount = Math.ceil(p.picked.length / batchMax)
  const summary = p.plan ? planSummary(p.plan) : null

  useEffect(() => {
    if (!p.open) setLimit(60)
  }, [p.open])

  if (!p.open) return null

  const step: 'pick' | 'plan' | 'result' = p.plan ? 'plan' : p.outcome ? 'result' : 'pick'

  return (
    <Modal
      open
      onOpenChange={(v) => {
        /** 点遮罩 / Esc 也算"反悔"：已经抽出来的副本要当场退回去 */
        if (!v) close()
      }}
      title={t('library.memberTitle')}
    >
      <div className="flex flex-col gap-2 text-[12px]">
        <div className="text-[11px]" style={{ color: 'var(--muted)' }}>
          {p.containerName ? p.containerName + ' · ' : ''}
          {p.loading ? t('library.memberLoading') : t('library.memberFound', { count: p.packages.length })}
        </div>

        {/* 没列全 / 要密码 / 包里还有压缩包 —— 一句都不许省（P0-4：撞线要明说） */}
        {notes.map((k) => (
          <div
            key={k}
            className="rounded border px-2 py-1 text-[11px]"
            style={{ borderColor: 'var(--line-2)', background: 'var(--warn-soft)', color: 'var(--warn)' }}
          >
            {t(k, { count: p.notes?.cappedCount ?? 0, depth: p.notes?.cappedDepth ?? 0, max: batchMax })}
          </div>
        ))}
        {p.tooBroad ? (
          <div className="rounded border px-2 py-1 text-[11px]" style={{ borderColor: 'var(--line-2)', background: 'var(--accent-soft)' }}>
            {t('library.memberTooBroad', { matched: p.tooBroad.matched, hits: p.tooBroad.hits, total: p.tooBroad.total })}
          </div>
        ) : null}
        {!p.tooBroad && !p.loading && p.packages.length > 0 && !p.picked.length ? (
          <div className="text-[11px]" style={{ color: 'var(--faint)' }}>
            {t('library.memberNoPreselect')}
          </div>
        ) : null}
        {p.reasonKey ? (
          <div className="rounded border px-2 py-1 text-[11px]" style={{ borderColor: 'var(--bad)', color: 'var(--bad)' }}>
            {t(p.reasonKey, p.reasonParams)}
          </div>
        ) : null}

        {step === 'pick' ? (
          <>
            <div className="flex flex-wrap items-center gap-2 text-[11px]">
              <Button variant="accent" disabled={p.loading || p.running || !p.picked.length} onClick={() => void start()}>
                {t('library.memberStart', { count: p.picked.length })}
              </Button>
              <Button disabled={p.loading || !p.packages.length} onClick={pickAll}>
                {t('library.memberPickAll')}
              </Button>
              <Button disabled={!p.picked.length} onClick={clearPicks}>
                {t('library.memberClear')}
              </Button>
              <Tip label={t('library.memberUnderHint')}>
                <Button disabled={p.loading} onClick={() => pickUnder(100 * 1024 * 1024)}>
                  {t('library.memberUnder')}
                </Button>
              </Tip>
              <Button className="ml-auto" disabled={p.loading} onClick={() => void reload()}>
                {t('library.memberReload')}
              </Button>
            </div>
            <div style={{ color: 'var(--muted)' }} className="text-[11px]">
              {t('library.memberPicked', { count: p.picked.length, size: humanBytes(pickedBytes, locale), batches: batchCount })}
            </div>
            {batchCount > 1 ? (
              <div className="text-[11px]" style={{ color: 'var(--faint)' }}>
                {t('library.memberWillBatch', { batches: batchCount, max: batchMax })}
              </div>
            ) : null}

            <div className="max-h-[52vh] overflow-y-auto rounded border" style={{ borderColor: 'var(--line)' }}>
              {p.packages.slice(0, limit).map((m) => {
                const on = p.picked.includes(m.relPath)
                const why = p.reasons[m.relPath]
                const segs = m.relPath.split('/')
                return (
                  <label
                    key={m.relPath}
                    className="flex cursor-pointer items-center gap-2 border-b px-2 py-1 text-[11px] last:border-b-0"
                    style={{ borderColor: 'var(--line)', background: on ? 'var(--accent-soft)' : 'transparent' }}
                  >
                    <input type="checkbox" checked={on} onChange={() => toggle(m.relPath)} />
                    <span className="min-w-0 shrink truncate" style={{ maxWidth: '42%' }} title={m.relPath}>
                      {segs.pop()}
                    </span>
                    <span className="shrink-0" style={{ color: 'var(--muted)' }}>
                      {m.sizeBytes > 0 ? humanBytes(m.sizeBytes, locale) : t('library.memberUnknownSize')}
                    </span>
                    {segs.length ? (
                      <span className="shrink-0 truncate" style={{ color: 'var(--faint)', maxWidth: '22%' }} title={segs.join('/')}>
                        {t('library.memberDepth', { depth: segs.length + 1 })} {segs.join('/')}
                      </span>
                    ) : null}
                    {/* 磁盘上就有的不用抽；压缩包成员要先抽 —— 这两种在界面上必须分得清 */}
                    <Badge tone={m.path ? 'ok' : 'warn'}>{m.path ? t('library.memberOnDisk') : t('library.memberInArchive')}</Badge>
                    {why ? (
                      <span className="ml-auto shrink-0 truncate" style={{ color: 'var(--accent)' }} title={why.matched}>
                        {t(why.reasonKey === 'pickByProject' ? 'library.pickByProject' : 'library.pickByCollection', {
                          matched: why.matched
                        })}
                      </span>
                    ) : null}
                  </label>
                )
              })}
              {p.packages.length > limit ? (
                <button className="w-full px-2 py-1.5 text-[11px]" style={{ color: 'var(--muted)' }} onClick={() => setLimit((n) => n + 100)}>
                  {t('library.memberShowMore', { left: p.packages.length - limit })}
                </button>
              ) : null}
            </div>
            {totals.unknown ? (
              <div className="text-[10px]" style={{ color: 'var(--faint)' }}>
                {t('library.memberSizeUnknown', { count: totals.unknown })}
              </div>
            ) : null}
          </>
        ) : null}

        {step === 'plan' && p.plan && summary ? (
          <>
            <div className="text-[11px]" style={{ color: 'var(--muted)' }}>
              {t('library.memberPlanSummary', {
                packages: summary.packages,
                fresh: summary.fresh,
                withConflicts: summary.withConflicts,
                entries: summary.conflictEntries
              })}
            </div>
            <div className="max-h-[46vh] overflow-y-auto rounded border" style={{ borderColor: 'var(--line)' }}>
              {p.plan.items.map((it) => (
                <PlanRow key={it.relPath} item={it} locale={locale} />
              ))}
              {p.plan.blocked.map((b, i) => (
                <div key={`${b.relPath}-${i}`} className="flex items-center gap-2 border-t px-2 py-1 text-[11px]" style={{ borderColor: 'var(--line)' }}>
                  <span className="min-w-0 flex-1 truncate" style={{ color: 'var(--bad)' }} title={b.relPath}>
                    {b.relPath}
                  </span>
                  <span style={{ color: 'var(--muted)' }}>{t(b.reasonKey)}</span>
                </div>
              ))}
            </div>
            {p.plan.blocked.length ? (
              <div className="text-[10px]" style={{ color: 'var(--faint)' }}>
                {t('library.memberBlocked', { count: p.plan.blocked.length })}
              </div>
            ) : null}
            <div className="flex items-center gap-2">
              <Button disabled={p.running} onClick={() => void decide('cancel')}>
                {t('common.cancel')}
              </Button>
              <Button disabled={p.running || !summary.withConflicts} onClick={() => void decide('continue')}>
                {t('library.conflictContinue')}
              </Button>
              <Button variant="accent" disabled={p.running} onClick={() => void decide('continue-with-backup')}>
                {t('library.conflictContinueBackup')}
              </Button>
            </div>
            <div className="text-[10px]" style={{ color: 'var(--faint)' }}>
              {t('library.memberOneDecision', { count: summary.packages })}
            </div>
            <div className="text-[10px]" style={{ color: backupOverwritten ? 'var(--faint)' : 'var(--warn)' }}>
              {backupOverwritten ? t('library.conflictBackupOn') : t('library.conflictBackupOff')}
            </div>
          </>
        ) : null}

        {step === 'result' && p.outcome ? (
          <>
            <div className="text-[11px]" style={{ color: 'var(--muted)' }}>
              {t('library.memberOutcome', { ok: p.outcome.imported, bad: p.outcome.failed, skip: p.outcome.notRun })}
            </div>
            <div className="max-h-[40vh] overflow-y-auto rounded border" style={{ borderColor: 'var(--line)' }}>
              {p.outcome.results.map((r) => (
                <div
                  key={r.relPath}
                  className="flex items-center gap-2 border-b px-2 py-1 text-[11px] last:border-b-0"
                  style={{ borderColor: 'var(--line)' }}
                >
                  <span className="min-w-0 flex-1 truncate" title={r.relPath}>
                    {r.relPath}
                  </span>
                  <Badge tone={r.ok ? 'ok' : 'bad'}>{r.status}</Badge>
                  {r.error ? <span style={{ color: 'var(--muted)' }}>{String(r.error).slice(0, 60)}</span> : null}
                </div>
              ))}
              {p.outcome.blocked.map((b, i) => (
                <div key={`${b.relPath}-b${i}`} className="flex items-center gap-2 border-t px-2 py-1 text-[11px]" style={{ borderColor: 'var(--line)' }}>
                  <span className="min-w-0 flex-1 truncate" title={b.relPath}>
                    {b.relPath}
                  </span>
                  <span style={{ color: 'var(--muted)' }}>{t(b.reasonKey)}</span>
                </div>
              ))}
            </div>
            {p.outcome.failed || p.outcome.notRun ? (
              <div className="text-[10px]" style={{ color: 'var(--warn)' }}>
                {t('library.memberHalfBatch')}
              </div>
            ) : null}
            {p.outcome.imported ? (
              <div className="text-[10px]" style={{ color: 'var(--faint)' }}>
                {t('library.memberUndoHint')}
              </div>
            ) : null}
            <div className="flex items-center gap-2">
              {p.outcome.imported ? (
                <Button onClick={() => void rollbackBatch()}>{t('library.rollbackBatch')}</Button>
              ) : null}
              {p.queue.length ? (
                <>
                  <Button variant="accent" disabled={p.running} onClick={() => void next()}>
                    {t('library.memberNextBatch', { left: p.queue.length })}
                  </Button>
                  <Button disabled={p.running} onClick={stop}>
                    {t('library.memberStopBatches')}
                  </Button>
                </>
              ) : (
                <Button onClick={close}>{t('common.close')}</Button>
              )}
            </div>
          </>
        ) : null}
      </div>
    </Modal>
  )
}

/** 一批里某一个包：名字 · 体积 · 条目数 · 冲突的**具体路径**（§5.1④ 点名的就是这个） */
function PlanRow({ item, locale }: { item: PlanItemView; locale: LocaleKey }): JSX.Element {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  return (
    <div className="border-b px-2 py-1 text-[11px] last:border-b-0" style={{ borderColor: 'var(--line)' }}>
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate" title={item.relPath}>
          {item.relPath}
        </span>
        <span style={{ color: 'var(--muted)' }}>{humanBytes(item.sizeBytes, locale)}</span>
        <span style={{ color: 'var(--faint)' }}>{t('library.memberEntries', { count: item.entryCount })}</span>
        {item.conflictCount ? (
          <button className="underline" style={{ color: 'var(--bad)' }} onClick={() => setOpen((v) => !v)}>
            {t('library.memberConflicts', { count: item.conflictCount })}
          </button>
        ) : (
          <Badge tone="ok">{t('library.memberAllFresh', { count: item.fresh })}</Badge>
        )}
        {!item.extracted ? <Badge tone="default">{t('library.memberOnDisk')}</Badge> : null}
      </div>
      {open && item.conflictCount ? (
        <div className="mt-1 flex flex-col gap-0.5 pl-2 font-mono" style={{ color: 'var(--muted)' }}>
          {item.conflicts.slice(0, 3).map((c) => (
            <div key={c.guid} className="truncate" title={`${c.incomingPath} → ${c.existingPath}`}>
              <span style={{ color: 'var(--warn)' }}>{c.existingPath}</span>
              <span style={{ color: 'var(--faint)' }}> ← {c.incomingPath}</span>
            </div>
          ))}
          {item.conflicts.length > 3 ? (
            <div style={{ color: 'var(--faint)' }}>{t('library.memberMoreConflicts', { count: item.conflicts.length - 3 })}</div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
