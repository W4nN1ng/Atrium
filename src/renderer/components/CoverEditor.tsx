import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { CoverCandidate, CoverPreview, CoverStatus, PreviewDirection, PreviewOptions, PreviewTarget } from '../../shared/covers'
import { useUi } from '../stores/ui'
import { Button, Modal } from './ui'

const angleKeys: Record<PreviewDirection, string> = {
  auto: 'covers.angleAuto', scene: 'covers.angleScene', front: 'covers.angleFront', back: 'covers.angleBack',
  left: 'covers.angleLeft', right: 'covers.angleRight', top: 'covers.angleTop', bottom: 'covers.angleBottom'
}
const candidatePageSize = 8
type CandidateImage = { preview?: CoverPreview; loading?: boolean; error?: string }

export function CoverEditor({ assetId, name }: { assetId: string; name: string }): JSX.Element {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  useEffect(() => setOpen(false), [assetId])
  return <>
    <Button onClick={() => setOpen(true)}>{t('covers.edit')}</Button>
    {open ? <CoverSession key={assetId} assetId={assetId} name={name} close={() => setOpen(false)} /> : null}
  </>
}

function CoverSession({ assetId, name, close }: { assetId: string; name: string; close: () => void }): JSX.Element {
  const { t, i18n } = useTranslation()
  const projects = useUi(s => s.projects)
  const defaultProject = useUi(s => s.unity.targetProjectId)
  const [projectId, setProject] = useState(defaultProject ?? projects[0]?.id ?? '')
  const [status, setStatus] = useState<CoverStatus | null>(null)
  const [target, setTarget] = useState<PreviewTarget | null>(null)
  const [targets, setTargets] = useState<PreviewTarget[]>([])
  const [candidates, setCandidates] = useState<CoverCandidate[]>([])
  const [candidateImages, setCandidateImages] = useState<Record<string, CandidateImage>>({})
  const [visibleCount, setVisibleCount] = useState(candidatePageSize)
  const [warnings, setWarnings] = useState<string[]>([])
  const [candidateRendering, setCandidateRendering] = useState(false)
  const [query, setQuery] = useState('')
  const [options, setOptions] = useState<PreviewOptions>({ direction: 'auto', background: 'dark' })
  const [preview, setPreview] = useState<CoverPreview | null>(null)
  const [phase, setPhase] = useState<'discover' | 'targets' | 'preview' | 'action' | null>(null)
  const busy = phase !== null
  const [error, setError] = useState('')
  const [errorDetail, setErrorDetail] = useState('')
  const [notice, setNotice] = useState('')
  const requests = useRef(new Set<string>())
  const candidateCache = useRef(new Map<string, CoverPreview>())
  const selected = useRef<PreviewTarget | null>(null)
  const attemptedProject = useRef<string | null>(null)
  const statusProject = useRef('')
  const generation = useRef(0)
  const initialized = useRef(false)
  const mounted = useRef(true)
  const discardRequest = (id: string): void => {
    void window.a.covers.discard(id).catch(() => undefined)
    requests.current.delete(id)
  }
  const discard = (): void => {
    generation.current++
    for (const id of requests.current) discardRequest(id)
    candidateCache.current.clear()
    setPreview(null); setCandidateImages({}); setCandidateRendering(false); setPhase(null)
  }
  const chooseTarget = (value: PreviewTarget | null): void => {
    selected.current = value; setTarget(value)
  }
  const clearCandidates = (): void => {
    setCandidates([]); setVisibleCount(candidatePageSize); setWarnings([])
  }
  const clearMessages = (): void => {
    setError(''); setErrorDetail(''); setNotice('')
  }
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false; generation.current++
      for (const id of requests.current) discardRequest(id)
    }
  }, [])
  useEffect(() => {
    let active = true
    const refresh = (): void => {
      void window.a.covers.status(assetId, projectId).then(value => {
        if (!active) return
        statusProject.current = projectId
        setStatus(value)
        if (!initialized.current) {
          initialized.current = true
          if (value.record?.source === 'unity') {
            if (value.record.projectId) setProject(value.record.projectId)
            if (value.record.target) { chooseTarget(value.record.target); setTargets([value.record.target]) }
            if (value.record.options) setOptions(value.record.options)
          }
        }
      }).catch(() => { if (active) setStatus(null) })
    }
    refresh(); const timer = setInterval(refresh, 2000)
    return () => { active = false; clearInterval(timer) }
  }, [assetId, projectId])
  const errorKey = (e: unknown): string => {
    const key = e instanceof Error ? e.message.match(/covers\.[A-Za-z]+/)?.[0] : null
    return key && i18n.exists(key) ? key : 'covers.renderFailed'
  }
  const fail = (e: unknown): void => {
    setError(errorKey(e))
    setErrorDetail((e instanceof Error ? e.message : String(e)).slice(0, 4000))
  }
  async function discover(): Promise<void> {
    discard(); clearCandidates(); chooseTarget(null); setTargets([]); clearMessages(); setPhase('discover')
    attemptedProject.current = projectId
    const id = crypto.randomUUID(); requests.current.add(id)
    const current = generation.current
    try {
      const found = await window.a.covers.discover(assetId, projectId, id)
      if (!mounted.current || current !== generation.current) { discardRequest(id); return }
      setCandidates(found.targets)
      setWarnings([...new Set([...found.warnings, ...(found.truncated ? ['covers.candidatesLimited'] : [])])])
      if (!found.targets.length) setNotice('covers.noCandidates')
    } catch (e) { if (mounted.current && current === generation.current) fail(e) }
    finally { if (mounted.current && current === generation.current) setPhase(null) }
  }
  useEffect(() => {
    if (statusProject.current === projectId && projectId && status?.bridge === 'ready' && status.candidates &&
      status.record?.source !== 'unity' && attemptedProject.current !== projectId) void discover()
  }, [projectId, status?.bridge, status?.candidates, status?.record?.source])
  useEffect(() => {
    if (!candidates.length) return
    let active = true
    const current = generation.current
    const visible = candidates.slice(0, visibleCount)
    const queue = selected.current ? [
      ...visible.filter(item => item.id === selected.current?.id),
      ...visible.filter(item => item.id !== selected.current?.id)
    ] : visible
    setCandidateRendering(true)
    void (async () => {
      for (const item of queue) {
        if (!active || !mounted.current || current !== generation.current) return
        if (candidateCache.current.has(item.id)) continue
        const id = crypto.randomUUID(); requests.current.add(id)
        setCandidateImages(images => ({ ...images, [item.id]: { loading: true } }))
        try {
          const result = await window.a.covers.preview({ assetId, projectId, target: item, options, requestId: id })
          if (!active || !mounted.current || current !== generation.current) { discardRequest(id); return }
          candidateCache.current.set(item.id, result)
          setCandidateImages(images => ({ ...images, [item.id]: { preview: result } }))
          if (selected.current?.id === item.id) setPreview(result)
        } catch (e) {
          if (!active || !mounted.current || current !== generation.current) return
          discardRequest(id)
          setCandidateImages(images => ({ ...images, [item.id]: { error: errorKey(e) } }))
        }
      }
    })().finally(() => {
      if (active && mounted.current && current === generation.current) setCandidateRendering(false)
    })
    return () => { active = false }
  }, [candidates, visibleCount, projectId, options])
  async function loadTargets(search: string): Promise<void> {
    discard(); clearCandidates(); chooseTarget(null); setTargets([]); clearMessages(); setPhase('targets')
    attemptedProject.current = projectId
    const current = generation.current
    try {
      const found = await window.a.covers.targets(projectId, search)
      if (!mounted.current || current !== generation.current) return
      setTargets(found); chooseTarget(found.length === 1 ? found[0] : null)
      if (!found.length) setNotice(search ? 'covers.noResults' : 'covers.noSelection')
    } catch (e) { if (mounted.current && current === generation.current) fail(e) }
    finally { if (mounted.current && current === generation.current) setPhase(null) }
  }
  async function generate(): Promise<void> {
    if (!target) return
    const isCandidate = candidates.some(item => item.id === target.id)
    if (isCandidate) {
      const prior = candidateCache.current.get(target.id)
      if (prior) discardRequest(prior.id)
      candidateCache.current.delete(target.id)
      setCandidateImages(images => ({ ...images, [target.id]: { loading: true } })); setPreview(null)
    } else discard()
    clearMessages(); setPhase('preview')
    const id = crypto.randomUUID(); requests.current.add(id)
    const current = generation.current
    try {
      const result = await window.a.covers.preview({ assetId, projectId, target, options, requestId: id })
      if (!mounted.current || current !== generation.current) { discardRequest(id); return }
      setPreview(result)
      if (isCandidate) {
        candidateCache.current.set(target.id, result)
        setCandidateImages(images => ({ ...images, [target.id]: { preview: result } }))
      }
    } catch (e) {
      if (mounted.current && current === generation.current) {
        fail(e)
        if (isCandidate) setCandidateImages(images => ({ ...images, [target.id]: { error: errorKey(e) } }))
      }
    }
    finally { if (mounted.current && current === generation.current) setPhase(null) }
  }
  async function action(fn: () => Promise<unknown>, finish = true, message = 'covers.upgraded'): Promise<void> {
    setPhase('action'); clearMessages()
    try {
      await fn()
      if (!mounted.current) return
      if (finish) { useUi.getState().toast('ok', t('covers.saved')); close() }
      else if (message) setNotice(message)
    } catch (e) { if (mounted.current) fail(e) }
    finally { if (mounted.current) setPhase(null) }
  }
  async function upload(): Promise<void> {
    await action(async () => {
      const files = await window.a.system.pickFiles({ title: t('covers.upload'), filters: [{ name: t('covers.imageFiles'), extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp'] }] })
      if (!files.length || !mounted.current) return
      await window.a.covers.upload(assetId, files[0])
      if (mounted.current) { useUi.getState().toast('ok', t('covers.saved')); close() }
    }, false, '')
  }
  const ready = status?.bridge === 'ready'
  const changeOptions = (value: PreviewOptions): void => {
    const finding = phase === 'discover'
    discard(); clearMessages(); setOptions(value)
    if (finding) void discover()
  }
  const invalidateImage = (id: string): void => {
    const image = candidateCache.current.get(id)
    if (image) discardRequest(image.id)
    candidateCache.current.delete(id)
    setCandidateImages(images => ({ ...images, [id]: { error: 'covers.invalidImage' } }))
    if (selected.current?.id === id) setPreview(null)
  }
  return <Modal open onOpenChange={value => { if (!value) close() }} title={t('covers.title', { name })} footer={<>
    <Button onClick={close}>{t('common.cancel')}</Button>
    <Button variant="accent" disabled={busy || !preview} onClick={() => void action(() => window.a.covers.save(assetId, preview!.id))}>{t('covers.save')}</Button>
  </>}>
    <div className="max-h-[70vh] space-y-3 overflow-y-auto text-[12px]">
      <p className="muted">{t('covers.intro')}</p>
      <label className="block">{t('covers.project')}
        <select className="input mt-1 w-full" value={projectId} disabled={phase === 'action'} onChange={e => {
          discard(); clearCandidates(); chooseTarget(null); setTargets([]); clearMessages(); setStatus(null)
          attemptedProject.current = null; setProject(e.target.value)
        }}>
          <option value="">{t('covers.chooseProject')}</option>
          {projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}
        </select>
      </label>
      {status?.bridge === 'offline' ? <p className="muted">{t('covers.offline')}</p> : null}
      {status?.bridge === 'busy' ? <p className="muted">{t('covers.unityBusy')}</p> : null}
      {status?.bridge === 'upgrade' ? <div className="flex items-center justify-between gap-2"><p>{t('covers.bridgeUpgrade')}</p><Button disabled={busy} onClick={() => void action(() => window.a.covers.upgradeBridge(projectId), false)}>{t('covers.upgrade')}</Button></div> : null}
      {ready && !status?.candidates ? <div className="flex items-center justify-between gap-2"><p className="muted">{t('covers.candidatesUpgrade')}</p><Button disabled={busy} onClick={() => void action(() => window.a.covers.upgradeBridge(projectId), false)}>{t('covers.upgrade')}</Button></div> : null}
      {ready && status?.candidates ? <div className="flex items-center justify-between gap-2">
        <p className="muted">{t('covers.candidatesHint')}</p>
        <Button disabled={busy || candidateRendering} onClick={() => void discover()}>{t('covers.rediscover')}</Button>
      </div> : null}
      {phase === 'discover' ? <p role="status" className="muted">{t('covers.discovering')}</p> : null}
      {candidates.length ? <div className="space-y-2">
        <p>{t('covers.candidateCount', { count: candidates.length })}</p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {candidates.slice(0, visibleCount).map(item => {
            const image = candidateImages[item.id]
            const chosen = target?.id === item.id
            return <button type="button" key={item.id} data-cover-candidate={item.id} aria-pressed={chosen}
              disabled={busy} onClick={() => { chooseTarget(item); setPreview(candidateCache.current.get(item.id) ?? null); clearMessages() }}
              className="min-w-0 overflow-hidden rounded border text-left disabled:opacity-50"
              style={{ background: 'var(--panel-2)', borderColor: chosen ? 'var(--accent)' : 'var(--line)' }}
              title={[item.path, ...item.memberPaths].join('\n')}>
              <span className="flex aspect-[4/3] items-center justify-center overflow-hidden">
                {image?.preview ? <img className="h-full w-full object-contain" src={image.preview.url} alt={t('covers.candidateAlt', { name: item.name })} onError={() => invalidateImage(item.id)} /> :
                  <span className="faint px-2 text-center text-[11px]">{t(image?.error ?? (image?.loading ? 'covers.candidateGenerating' : 'covers.queued'))}</span>}
              </span>
              <span className="block truncate px-2 pt-1 font-medium">{item.name}</span>
              <span className="muted block break-all px-2 pb-2 pt-1 text-[10px]">{item.memberPaths[0] ?? item.path}{item.memberPaths.length > 1 ? ` · ${t('covers.moreMembers', { count: item.memberPaths.length - 1 })}` : ''}</span>
            </button>
          })}
        </div>
        {candidateRendering ? <p role="status" className="muted">{t('covers.candidateProgress', { done: Object.values(candidateImages).filter(image => image.preview || image.error).length, total: Math.min(visibleCount, candidates.length) })}</p> : null}
        {visibleCount < candidates.length ? <Button disabled={busy || candidateRendering} onClick={() => setVisibleCount(count => count + candidatePageSize)}>{t('covers.showMore')}</Button> : null}
      </div> : null}
      {warnings.map(key => <p key={key} className="muted">{t(i18n.exists(key) ? key : 'covers.sourceUnreadable')}</p>)}
      <div className="flex flex-wrap gap-2">
        <Button disabled={phase === 'action' || !ready} onClick={() => void loadTargets('')}>{t('covers.selection')}</Button>
        <input aria-label={t('covers.search')} className="input min-w-0 flex-1" maxLength={100} placeholder={t('covers.search')} value={query} disabled={busy} onChange={e => setQuery(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); if (ready && !busy && query.trim()) void loadTargets(query.trim()) } }} />
        <Button disabled={phase === 'action' || !ready || !query.trim()} onClick={() => void loadTargets(query.trim())}>{t('common.search')}</Button>
      </div>
      <p className="faint">{t('covers.selectionHint')}</p>
      {targets.length ? <label className="block">{t('covers.object')}
        <select className="input mt-1 w-full" value={target?.id ?? ''} disabled={busy} onChange={e => { discard(); chooseTarget(targets.find(item => item.id === e.target.value) ?? null) }}>
          <option value="">{t('covers.chooseObject')}</option>
          {targets.map(item => <option key={item.id} value={item.id}>{item.name} — {item.path}</option>)}
        </select>
      </label> : null}
      {target && !target.persistent ? <p style={{ color: 'var(--warn)' }}>{t('covers.temporaryTarget')}</p> : null}
      <div className="flex flex-wrap items-end gap-3">
        <label>{t('covers.angle')}<select className="input ml-2" value={options.direction} disabled={phase === 'action'} onChange={e => changeOptions({ ...options, direction: e.target.value as PreviewDirection })}>
          {Object.entries(angleKeys).map(([value, label]) => <option key={value} value={value}>{t(label)}</option>)}
        </select></label>
        <label>{t('covers.background')}<select className="input ml-2" value={options.background} disabled={phase === 'action'} onChange={e => changeOptions({ ...options, background: e.target.value as 'dark' | 'light' })}>
          <option value="dark">{t('covers.dark')}</option><option value="light">{t('covers.light')}</option>
        </select></label>
        <Button disabled={busy || candidateRendering || !ready || !target} onClick={() => void generate()}>{t('covers.generate')}</Button>
      </div>
      <div className="flex aspect-[4/3] max-h-[300px] items-center justify-center overflow-hidden rounded border" style={{ background: 'var(--panel-2)', borderColor: 'var(--line)' }}>
        {preview ? <img className="h-full w-full object-contain" src={preview.url} alt={t('covers.previewAlt', { name })} onError={() => { setPreview(null); setError('covers.invalidImage') }} /> : <span className="faint px-4 text-center">{t(busy ? 'covers.generating' : 'covers.previewHint')}</span>}
      </div>
      {error ? <div role="alert" style={{ color: 'var(--bad)' }}><p>{t(error)}</p>
        {errorDetail ? <details className="mt-1"><summary>{t('covers.errorDetails')}</summary><pre className="mt-1 whitespace-pre-wrap break-words text-[11px]">{errorDetail}</pre></details> : null}
      </div> : null}
      {notice ? <p role="status" className="muted">{t(notice)}</p> : null}
      <div className="flex gap-2 border-t pt-3" style={{ borderColor: 'var(--line)' }}>
        <Button disabled={busy} onClick={() => void upload()}>{t('covers.upload')}</Button>
        <Button disabled={busy || !status?.record} onClick={() => void action(() => window.a.covers.restore(assetId))}>{t('covers.restore')}</Button>
        {phase !== 'action' && (busy || candidateRendering) ? <Button onClick={() => {
          discard(); clearCandidates(); chooseTarget(null); setTargets([]); setNotice('covers.cancelled')
        }}>{t('covers.cancelFind')}</Button> : null}
      </div>
    </div>
  </Modal>
}
