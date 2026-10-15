import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { CoverCandidate, CoverPreview, CoverStatus, PackageCoverProgress, PackageCoverSetup, PackageCoverStatus, PreviewDirection, PreviewOptions, PreviewTarget } from '../../shared/covers'
import { candidateKind, coverErrorAdvice, selectCoverCandidates } from '../../shared/coverPresentation'
import { useUi } from '../stores/ui'
import { Button, Modal } from './ui'

const angleKeys: Record<PreviewDirection, string> = {
  auto: 'covers.angleAuto', scene: 'covers.angleScene', front: 'covers.angleFront', back: 'covers.angleBack',
  left: 'covers.angleLeft', right: 'covers.angleRight', top: 'covers.angleTop', bottom: 'covers.angleBottom'
}
const candidatePageSize = 8
type CandidateImage = { preview?: CoverPreview; loading?: boolean; error?: string }
type Provider = 'project' | 'package'
const packageStageKeys: Record<string, string> = {
  queued: 'covers.queued',
  reading: 'covers.packageReading', preparing: 'covers.packagePreparing', starting: 'covers.packageStarting',
  loading: 'covers.packageLoading', discovering: 'covers.packageDiscovering', rendering: 'covers.packageRendering'
}
const dependencyReasonKeys: Record<PackageCoverSetup['reason'], string> = {
  saved: 'covers.dependencyReasonSaved', remembered: 'covers.dependencyReasonRemembered',
  single: 'covers.dependencyReasonSingle', none: 'covers.dependencyReasonNone'
}

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
  const [provider, setProvider] = useState<Provider>('package')
  const [projectId, setProject] = useState(defaultProject ?? projects[0]?.id ?? '')
  const [dependencyProjectId, setDependencyProject] = useState('')
  const [setup, setSetup] = useState<PackageCoverSetup | null>(null)
  const [setupState, setSetupState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [setupRevision, setSetupRevision] = useState(0)
  const [bootstrapped, setBootstrapped] = useState(false)
  const [packageStatus, setPackageStatus] = useState<PackageCoverStatus | null>(null)
  const [progressRequest, setProgressRequest] = useState<string | null>(null)
  const [packageProgress, setPackageProgress] = useState<PackageCoverProgress | null>(null)
  const [status, setStatus] = useState<CoverStatus | null>(null)
  const [target, setTarget] = useState<PreviewTarget | null>(null)
  const [targets, setTargets] = useState<PreviewTarget[]>([])
  const [candidates, setCandidates] = useState<CoverCandidate[]>([])
  const [candidateImages, setCandidateImages] = useState<Record<string, CandidateImage>>({})
  const [visibleCount, setVisibleCount] = useState(candidatePageSize)
  const [warnings, setWarnings] = useState<string[]>([])
  const [candidateRendering, setCandidateRendering] = useState(false)
  const [query, setQuery] = useState('')
  const [candidateQuery, setCandidateQuery] = useState('')
  const [kind, setKind] = useState<'all' | 'prefab' | 'model'>('all')
  const [candidateRevision, setCandidateRevision] = useState(0)
  const [options, setOptions] = useState<PreviewOptions>({ direction: 'auto', background: 'dark' })
  const [preview, setPreview] = useState<CoverPreview | null>(null)
  const [phase, setPhase] = useState<'discover' | 'targets' | 'preview' | 'action' | null>(null)
  const busy = phase !== null
  const [error, setError] = useState('')
  const [errorDetail, setErrorDetail] = useState('')
  const [notice, setNotice] = useState('')
  const [retryAction, setRetryAction] = useState<'discover' | 'preview' | null>(null)
  const [startedAt, setStartedAt] = useState<number | null>(null)
  const [now, setNow] = useState(Date.now())
  const requests = useRef(new Set<string>())
  const candidateCache = useRef(new Map<string, CoverPreview>())
  const candidateFailures = useRef(new Set<string>())
  const selectedPreviewRequest = useRef<{ id: string; targetId: string } | null>(null)
  const cancellation = useRef(Promise.resolve())
  const dependencyOverridden = useRef(false)
  const selected = useRef<PreviewTarget | null>(null)
  const attemptedSource = useRef<string | null>(null)
  const statusProject = useRef('')
  const generation = useRef(0)
  const initialized = useRef(false)
  const mounted = useRef(true)
  const discardRequest = (id: string): void => {
    const pending = window.a.covers.discard(id).catch(() => undefined)
    cancellation.current = Promise.all([cancellation.current, pending]).then(() => undefined)
    requests.current.delete(id)
  }
  const discard = (): void => {
    generation.current++
    selectedPreviewRequest.current = null
    for (const id of requests.current) discardRequest(id)
    candidateCache.current.clear()
    candidateFailures.current.clear()
    setPreview(null); setCandidateImages({}); setCandidateRendering(false); setPhase(null)
    setProgressRequest(null); setPackageProgress(null)
  }
  const chooseTarget = (value: PreviewTarget | null): void => {
    selected.current = value; setTarget(value)
  }
  const clearCandidates = (): void => {
    setCandidates([]); setVisibleCount(candidatePageSize); setWarnings([]); setCandidateQuery(''); setKind('all')
  }
  const clearMessages = (): void => {
    setError(''); setErrorDetail(''); setNotice(''); setRetryAction(null)
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
          if (value.record?.source === 'unity' || value.record?.source === 'package') {
            const savedProvider = value.record.source === 'package' ? 'package' : 'project'
            setProvider(savedProvider)
            if (savedProvider === 'project' && value.record.projectId) setProject(value.record.projectId)
            if (value.record.target) { chooseTarget(value.record.target); setTargets([value.record.target]) }
            if (value.record.options) setOptions({ ...value.record.options,
              direction: savedProvider === 'package' && value.record.options.direction === 'scene' ? 'auto' : value.record.options.direction })
          }
          setBootstrapped(true)
        }
      }).catch(() => { if (active) setStatus(null) })
    }
    refresh(); const timer = setInterval(refresh, 2000)
    return () => { active = false; clearInterval(timer) }
  }, [assetId, projectId])
  useEffect(() => {
    let active = true
    setSetupState('loading')
    void window.a.covers.packageSetup(assetId).then(value => {
      if (!active || !mounted.current) return
      setSetup(value)
      if (!dependencyOverridden.current) setDependencyProject(value.recommendedProjectId ?? '')
      setSetupState('ready')
    }).catch(() => { if (active && mounted.current) setSetupState('error') })
    return () => { active = false }
  }, [assetId, setupRevision])
  const working = (busy && phase !== 'action') || candidateRendering
  useEffect(() => {
    if (!working) return
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(timer)
  }, [working, startedAt])
  useEffect(() => {
    let active = true
    const refresh = (): void => {
      void window.a.covers.packageStatus().then(value => { if (active) setPackageStatus(value) })
        .catch(() => { if (active) setPackageStatus({ available: false, editorPath: null, version: null }) })
    }
    refresh(); const timer = setInterval(refresh, 2000)
    return () => { active = false; clearInterval(timer) }
  }, [])
  useEffect(() => {
    if (provider !== 'package' || !progressRequest) return
    let active = true
    const current = generation.current
    const refresh = (): void => {
      void window.a.covers.packageProgress(progressRequest).then(value => {
        if (active && mounted.current && current === generation.current) setPackageProgress(value)
      }).catch(() => undefined)
    }
    refresh(); const timer = setInterval(refresh, 500)
    return () => { active = false; clearInterval(timer) }
  }, [provider, progressRequest])
  const errorKey = (e: unknown): string => {
    const key = e instanceof Error ? e.message.match(/covers\.[A-Za-z]+/)?.[0] : null
    if (provider === 'package' && key === 'covers.missingShader') return 'covers.packageMissingShader'
    if (provider === 'package' && key === 'covers.inventoryLimited') return 'covers.packageLimitExceeded'
    return key && i18n.exists(key) ? key : 'covers.renderFailed'
  }
  const fail = (e: unknown, retry: 'discover' | 'preview' | null = null): void => {
    setError(errorKey(e))
    setErrorDetail((e instanceof Error ? e.message : String(e)).slice(0, 4000))
    setRetryAction(retry)
  }
  const dependencyUsable = !dependencyProjectId || setup?.dependencies.some(item => item.projectId === dependencyProjectId && item.status === 'ready')
  const ready = bootstrapped && (provider === 'package' ? Boolean(packageStatus?.available && setupState === 'ready' && dependencyUsable) : status?.bridge === 'ready')
  async function discover(): Promise<void> {
    if (!ready || phase === 'action') return
    discard(); clearCandidates(); chooseTarget(null); setTargets([]); clearMessages(); setPhase('discover')
    setStartedAt(Date.now())
    attemptedSource.current = provider === 'package' ? `package:${dependencyProjectId}` : `project:${projectId}`
    const id = crypto.randomUUID(); requests.current.add(id)
    if (provider === 'package') setProgressRequest(id)
    const current = generation.current
    try {
      await cancellation.current
      if (!mounted.current || current !== generation.current) return
      const found = provider === 'package'
        ? await window.a.covers.discoverPackage(assetId, id, dependencyProjectId || undefined)
        : await window.a.covers.discover(assetId, projectId, id)
      if (!mounted.current || current !== generation.current) { discardRequest(id); return }
      setCandidates(selectCoverCandidates(found.targets, '', 'all').slice(0, 50))
      setWarnings([...new Set([...found.warnings, ...(found.truncated || found.targets.length > 50 ?
        [provider === 'package' ? 'covers.packageCandidatesLimited' : 'covers.candidatesLimited'] : [])])])
      if (!found.targets.length) setNotice(provider === 'package' ? 'covers.packageNoCandidates' : 'covers.noCandidates')
    } catch (e) { if (mounted.current && current === generation.current) fail(e, 'discover') }
    finally { if (mounted.current && current === generation.current) { setPhase(null); setProgressRequest(null); setPackageProgress(null) } }
  }
  useEffect(() => {
    if (!bootstrapped || !ready || target || targets.length || phase === 'action') return
    const source = provider === 'package' ? `package:${dependencyProjectId}` : `project:${projectId}`
    const available = provider === 'package' ? packageStatus?.available :
      statusProject.current === projectId && projectId && status?.bridge === 'ready' && status.candidates
    if (available && attemptedSource.current !== source) void discover()
  }, [bootstrapped, ready, provider, projectId, dependencyProjectId, packageStatus?.available, status, target, targets.length, phase])
  const filteredCandidates = useMemo(() => selectCoverCandidates(candidates, candidateQuery, kind), [candidates, candidateQuery, kind])
  const visibleCandidates = useMemo(() => filteredCandidates.slice(0, visibleCount), [filteredCandidates, visibleCount])
  useEffect(() => {
    if (selected.current && candidates.some(item => item.id === selected.current?.id) && !visibleCandidates.some(item => item.id === selected.current?.id)) {
      chooseTarget(null); setPreview(null)
    }
  }, [candidates, visibleCandidates])
  useEffect(() => {
    if (!visibleCandidates.length || !ready || phase === 'action') return
    let active = true
    const pending = new Set<string>()
    const current = generation.current
    const visible = visibleCandidates
    const queue = selected.current ? [
      ...visible.filter(item => item.id === selected.current?.id),
      ...visible.filter(item => item.id !== selected.current?.id)
    ] : visible
    setCandidateRendering(true)
    setStartedAt(Date.now())
    void (async () => {
      await cancellation.current
      for (const item of queue) {
        if (!active || !mounted.current || current !== generation.current) return
        if (candidateCache.current.has(item.id) || candidateFailures.current.has(item.id)) continue
        const id = crypto.randomUUID(); requests.current.add(id); pending.add(id)
        if (provider === 'package') setProgressRequest(id)
        setCandidateImages(images => ({ ...images, [item.id]: { loading: true } }))
        try {
          const result = await window.a.covers.preview({ assetId, projectId: provider === 'package' ? '' : projectId,
            provider, dependencyProjectId: provider === 'package' ? dependencyProjectId || undefined : undefined,
            target: item, options, requestId: id })
          pending.delete(id)
          if (!active || !mounted.current || current !== generation.current) { discardRequest(id); return }
          candidateCache.current.set(item.id, result)
          setCandidateImages(images => ({ ...images, [item.id]: { preview: result } }))
          if (selected.current?.id === item.id) setPreview(result)
        } catch (e) {
          pending.delete(id)
          if (!active || !mounted.current || current !== generation.current) return
          discardRequest(id)
          candidateFailures.current.add(item.id)
          setCandidateImages(images => ({ ...images, [item.id]: { error: errorKey(e) } }))
        }
      }
    })().finally(() => {
      if (active && mounted.current && current === generation.current) {
        setCandidateRendering(false); setProgressRequest(null); setPackageProgress(null)
      }
    })
    return () => {
      active = false
      for (const id of pending) discardRequest(id)
      setCandidateRendering(false)
      setCandidateImages(images => Object.fromEntries(Object.entries(images).filter(([, image]) => !image.loading)))
      setProgressRequest(null); setPackageProgress(null)
    }
  }, [visibleCandidates, provider, projectId, dependencyProjectId, options, ready, candidateRevision, phase === 'action'])
  async function loadTargets(search: string): Promise<void> {
    discard(); clearCandidates(); chooseTarget(null); setTargets([]); clearMessages(); setPhase('targets')
    setStartedAt(Date.now())
    attemptedSource.current = `project:${projectId}`
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
    if (!target || !ready || phase === 'action') return
    const isCandidate = candidates.some(item => item.id === target.id)
    if (isCandidate) {
      const prior = candidateCache.current.get(target.id)
      if (prior) discardRequest(prior.id)
      candidateCache.current.delete(target.id)
      candidateFailures.current.delete(target.id)
      setCandidateImages(images => ({ ...images, [target.id]: { loading: true } })); setPreview(null)
    } else discard()
    clearMessages(); setPhase('preview')
    setStartedAt(Date.now())
    const id = crypto.randomUUID(); requests.current.add(id)
    selectedPreviewRequest.current = { id, targetId: target.id }
    if (provider === 'package') setProgressRequest(id)
    const current = generation.current
    const isCurrent = (): boolean => mounted.current && current === generation.current && selectedPreviewRequest.current?.id === id
    try {
      await cancellation.current
      if (!isCurrent()) return
      const result = await window.a.covers.preview({ assetId, projectId: provider === 'package' ? '' : projectId,
        provider, dependencyProjectId: provider === 'package' ? dependencyProjectId || undefined : undefined,
        target, options, requestId: id })
      if (!isCurrent()) { discardRequest(id); return }
      setPreview(result)
      if (isCandidate) {
        candidateCache.current.set(target.id, result)
        setCandidateImages(images => ({ ...images, [target.id]: { preview: result } }))
      }
    } catch (e) {
      if (isCurrent()) {
        fail(e, 'preview')
        if (isCandidate) {
          candidateFailures.current.add(target.id)
          setCandidateImages(images => ({ ...images, [target.id]: { error: errorKey(e) } }))
        }
      }
    }
    finally {
      if (isCurrent()) {
        selectedPreviewRequest.current = null
        setPhase(null); setProgressRequest(null); setPackageProgress(null)
      }
    }
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
  async function chooseEditor(): Promise<void> {
    await action(async () => {
      const files = await window.a.system.pickFiles({ title: t('covers.packageChooseEditor'),
        filters: [{ name: t('covers.packageEditorFile'), extensions: ['exe'] }] })
      if (!files.length || !mounted.current) return
      await window.a.settings.setMany({ unityExePath: files[0] })
      const next = await window.a.covers.packageStatus()
      if (mounted.current) { attemptedSource.current = null; setPackageStatus(next) }
    }, false, '')
  }
  const invalidateSource = (): void => {
    discard(); clearCandidates(); chooseTarget(null); setTargets([]); clearMessages()
    attemptedSource.current = null
  }
  const changeOptions = (value: PreviewOptions): void => {
    const finding = phase === 'discover'
    discard(); clearMessages(); setOptions(value)
    if (finding) attemptedSource.current = null
  }
  const refreshSetup = (): void => {
    invalidateSource(); setSetupState('loading'); setSetupRevision(value => value + 1)
  }
  const retryCandidate = (id: string): void => {
    candidateFailures.current.delete(id)
    setCandidateRevision(value => value + 1)
  }
  const changeCandidateView = (search: string, type: typeof kind): void => {
    const visible = selectCoverCandidates(candidates, search, type).slice(0, candidatePageSize)
    if (selected.current && !visible.some(item => item.id === selected.current?.id)) {
      const pending = selectedPreviewRequest.current
      if (pending?.targetId === selected.current.id) {
        selectedPreviewRequest.current = null
        discardRequest(pending.id)
        setPhase(null); setProgressRequest(null); setPackageProgress(null)
      }
      chooseTarget(null); setPreview(null)
    }
    setCandidateQuery(search); setKind(type); setVisibleCount(candidatePageSize)
  }
  const invalidateImage = (id: string): void => {
    const image = candidateCache.current.get(id)
    if (image) discardRequest(image.id)
    candidateCache.current.delete(id)
    candidateFailures.current.add(id)
    setCandidateImages(images => ({ ...images, [id]: { error: 'covers.invalidImage' } }))
    if (selected.current?.id === id) setPreview(null)
  }
  return <Modal open onOpenChange={value => { if (!value && phase !== 'action') close() }} title={t('covers.title', { name })} footer={<>
    <Button disabled={phase === 'action'} onClick={close}>{t('common.cancel')}</Button>
    <Button variant="accent" disabled={busy || !preview} onClick={() => void action(() => window.a.covers.save(assetId, preview!.id))}>{t('covers.save')}</Button>
  </>}>
    <div className="max-h-[70vh] space-y-3 overflow-y-auto text-[12px]">
      <p className="muted">{t('covers.intro')}</p>
      <label className="block">{t('covers.provider')}
        <select data-cover-provider className="input mt-1 w-full" value={provider} disabled={phase === 'action'} onChange={e => {
          invalidateSource(); setProvider(e.target.value as Provider)
          if (e.target.value === 'package' && options.direction === 'scene') setOptions({ ...options, direction: 'auto' })
        }}>
          <option value="package">{t('covers.providerPackage')}</option><option value="project">{t('covers.providerProject')}</option>
        </select>
      </label>
      {provider === 'package' ? <div className="space-y-2">
        <p className="muted">{t('covers.packageHint')}</p>
        <label className="block">{t('covers.packageDependency')}
          <select data-cover-dependency className="input mt-1 w-full" value={dependencyProjectId} disabled={phase === 'action' || setupState !== 'ready'} onChange={e => {
            dependencyOverridden.current = true
            invalidateSource(); setDependencyProject(e.target.value)
          }}>
            <option value="">{t('covers.packageNoDependency')}</option>
            {setup?.dependencies.map(project => <option key={project.projectId} value={project.projectId} disabled={project.status !== 'ready'}>
              {project.name}{project.version ? ` · lilToon ${project.version}` : ''}{project.status !== 'ready' ? ` · ${t(project.status === 'missing' ? 'covers.dependencyMissingOption' : 'covers.dependencyUnreadableOption')}` : ''}
            </option>)}
            {dependencyProjectId && !setup?.dependencies.some(item => item.projectId === dependencyProjectId) ? <option value={dependencyProjectId} disabled>
              {projects.find(item => item.id === dependencyProjectId)?.name ?? dependencyProjectId} · {t('covers.dependencyMissingOption')}
            </option> : null}
          </select>
        </label>
        {setupState === 'loading' ? <p data-cover-setup-loading role="status" className="muted">{t('covers.dependencyChecking')}</p> :
          setupState === 'error' ? <div data-cover-setup-error role="alert"><p>{t('covers.dependencySetupFailed')}</p>
            <button type="button" data-cover-retry-setup disabled={phase === 'action'} onClick={refreshSetup} className="btn">{t('covers.retrySetup')}</button></div> : <>
            <p data-cover-recommendation className="muted">{t(dependencyReasonKeys[setup?.reason ?? 'none'])}</p>
            {dependencyOverridden.current ? <p className="faint">{t('covers.dependencyOverride')}</p> : null}
            {!dependencyUsable ? <p role="alert">{t('covers.dependencyUnavailable')}</p> : null}
          </>}
        <Button disabled={phase === 'action' || setupState === 'loading'} onClick={refreshSetup}>{t('covers.refreshDependencies')}</Button>
        <p className="faint">{t('covers.packageDependencyHint')}</p>
        {packageStatus?.available ? <p className="muted">{t('covers.packageEditorReady', { version: packageStatus.version ?? 'Unity' })}</p> :
          packageStatus ? <div className="flex items-center justify-between gap-2"><p>{t('covers.packageEditorMissing')}</p>
            <Button disabled={busy} onClick={() => void chooseEditor()}>{t('covers.packageChooseEditor')}</Button></div> :
            <p role="status" className="muted">{t('covers.packageCheckingEditor')}</p>}
      </div> : <>
      <label className="block">{t('covers.project')}
        <select className="input mt-1 w-full" value={projectId} disabled={phase === 'action'} onChange={e => {
          invalidateSource(); setStatus(null); setProject(e.target.value)
        }}>
          <option value="">{t('covers.chooseProject')}</option>
          {projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}
        </select>
      </label>
      {status?.bridge === 'offline' ? <p className="muted">{t('covers.offline')}</p> : null}
      {status?.bridge === 'busy' ? <p className="muted">{t('covers.unityBusy')}</p> : null}
      {status?.bridge === 'upgrade' ? <div className="flex items-center justify-between gap-2"><p>{t('covers.bridgeUpgrade')}</p><Button disabled={busy} onClick={() => void action(() => window.a.covers.upgradeBridge(projectId), false)}>{t('covers.upgrade')}</Button></div> : null}
      {ready && !status?.candidates ? <div className="flex items-center justify-between gap-2"><p className="muted">{t('covers.candidatesUpgrade')}</p><Button disabled={busy} onClick={() => void action(() => window.a.covers.upgradeBridge(projectId), false)}>{t('covers.upgrade')}</Button></div> : null}
      </>}
      {ready && (provider === 'package' || status?.candidates) ? <div className="flex items-center justify-between gap-2">
        <p className="muted">{t(provider === 'package' ? 'covers.packageCandidatesHint' : 'covers.candidatesHint')}</p>
        <Button disabled={busy || candidateRendering} onClick={() => void discover()}>{t('covers.rediscover')}</Button>
      </div> : null}
      {working ? <p role="status" className="muted">{t(provider === 'package' ? packageStageKeys[packageProgress?.stage ?? 'queued'] ?? 'covers.packagePreparing' : phase === 'discover' ? 'covers.discovering' : 'covers.generating')}
        {typeof packageProgress?.done === 'number' && typeof packageProgress.total === 'number' ? ` · ${packageProgress.done} / ${packageProgress.total}` : ''}
        <span data-cover-elapsed> · {t('covers.elapsed', { seconds: Math.max(0, Math.floor((now - (startedAt ?? now)) / 1000)) })}</span>
      </p> : null}
      {candidates.length ? <div className="space-y-2">
        <p>{t('covers.candidateCount', { count: candidates.length })}</p>
        <div className="flex flex-wrap gap-2">
          <input data-cover-candidate-search aria-label={t('covers.candidateSearch')} className="input min-w-0 flex-1" placeholder={t('covers.candidateSearch')}
            value={candidateQuery} disabled={phase === 'action'} maxLength={200} onChange={e => changeCandidateView(e.target.value, kind)} />
          <select data-cover-candidate-kind aria-label={t('covers.candidateFilter')} className="input" value={kind} disabled={phase === 'action'} onChange={e => changeCandidateView(candidateQuery, e.target.value as typeof kind)}>
            <option value="all">{t('covers.kindAll')}</option><option value="prefab">{t('covers.kindPrefab')}</option><option value="model">{t('covers.kindModel')}</option>
          </select>
        </div>
        {!filteredCandidates.length ? <p className="muted">{t('covers.candidateNoMatch')}</p> : null}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {visibleCandidates.map(item => {
            const image = candidateImages[item.id]
            const chosen = target?.id === item.id
            return <div key={item.id} className="min-w-0 overflow-hidden rounded border" style={{ background: 'var(--panel-2)', borderColor: chosen ? 'var(--accent)' : 'var(--line)' }}>
              <button type="button" data-cover-candidate={item.id} data-cover-kind={candidateKind(item)} aria-pressed={chosen}
              disabled={busy} onClick={() => { chooseTarget(item); setPreview(candidateCache.current.get(item.id) ?? null); clearMessages() }}
              className="block w-full min-w-0 overflow-hidden text-left disabled:opacity-50"
              title={[item.path, ...item.memberPaths].join('\n')}>
              <span className="flex aspect-[4/3] items-center justify-center overflow-hidden">
                {image?.preview ? <img className="h-full w-full object-contain" src={image.preview.url} alt={t('covers.candidateAlt', { name: item.name })} onError={() => invalidateImage(item.id)} /> :
                  <span className="faint px-2 text-center text-[11px]">{t(image?.error ?? (image?.loading ? 'covers.candidateGenerating' : 'covers.queued'))}</span>}
              </span>
              <span className="block truncate px-2 pt-1 font-medium">{item.name}</span>
              <span className="faint block px-2 pt-1 text-[10px]">{t(candidateKind(item) === 'prefab' ? 'covers.kindPrefab' : 'covers.kindModel')}</span>
              {image?.error ? <span className="block px-2 pt-1 text-[11px]">{t(coverErrorAdvice(image.error))}</span> : null}
              <span className="muted block break-all px-2 pb-2 pt-1 text-[10px]">{item.memberPaths[0] ?? item.path}{item.memberPaths.length > 1 ? ` · ${t('covers.moreMembers', { count: item.memberPaths.length - 1 })}` : ''}</span>
              </button>
              {image?.error ? <button type="button" data-cover-retry-candidate={item.id} className="m-2 text-[11px] underline" disabled={busy || candidateRendering} onClick={() => retryCandidate(item.id)}>{t('covers.retryCandidate')}</button> : null}
            </div>
          })}
        </div>
        {candidateRendering ? <p role="status" className="muted">{t('covers.candidateProgress', { done: visibleCandidates.filter(item => candidateImages[item.id]?.preview || candidateImages[item.id]?.error).length, total: visibleCandidates.length })}</p> : null}
        {visibleCount < filteredCandidates.length ? <Button disabled={busy || candidateRendering} onClick={() => setVisibleCount(count => count + candidatePageSize)}>{t('covers.showMore')}</Button> : null}
      </div> : null}
      {warnings.map(key => <p key={key} className="muted">{t(i18n.exists(key) ? key : 'covers.sourceUnreadable')}</p>)}
      {provider === 'project' ? <>
      <div className="flex flex-wrap gap-2">
        <Button disabled={phase === 'action' || !ready} onClick={() => void loadTargets('')}>{t('covers.selection')}</Button>
        <input aria-label={t('covers.search')} className="input min-w-0 flex-1" maxLength={100} placeholder={t('covers.search')} value={query} disabled={busy} onChange={e => setQuery(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); if (ready && !busy && query.trim()) void loadTargets(query.trim()) } }} />
        <Button disabled={phase === 'action' || !ready || !query.trim()} onClick={() => void loadTargets(query.trim())}>{t('common.search')}</Button>
      </div>
      <p className="faint">{t('covers.selectionHint')}</p>
      </> : null}
      {targets.length ? <label className="block">{t('covers.object')}
        <select className="input mt-1 w-full" value={target?.id ?? ''} disabled={busy} onChange={e => { discard(); chooseTarget(targets.find(item => item.id === e.target.value) ?? null) }}>
          <option value="">{t('covers.chooseObject')}</option>
          {targets.map(item => <option key={item.id} value={item.id}>{item.name} — {item.path}</option>)}
        </select>
      </label> : null}
      {target && !target.persistent ? <p style={{ color: 'var(--warn)' }}>{t('covers.temporaryTarget')}</p> : null}
      <div className="flex flex-wrap items-end gap-3">
        <label>{t('covers.angle')}<select data-cover-angle className="input ml-2" value={options.direction} disabled={phase === 'action'} onChange={e => changeOptions({ ...options, direction: e.target.value as PreviewDirection })}>
          {Object.entries(angleKeys).filter(([value]) => provider === 'project' || value !== 'scene').map(([value, label]) => <option key={value} value={value}>{t(label)}</option>)}
        </select></label>
        <label>{t('covers.background')}<select className="input ml-2" value={options.background} disabled={phase === 'action'} onChange={e => changeOptions({ ...options, background: e.target.value as 'dark' | 'light' })}>
          <option value="dark">{t('covers.dark')}</option><option value="light">{t('covers.light')}</option>
        </select></label>
        <Button disabled={busy || candidateRendering || !ready || !target} onClick={() => void generate()}>{t('covers.generate')}</Button>
      </div>
      <div data-cover-selected-preview className="flex aspect-[4/3] max-h-[300px] items-center justify-center overflow-hidden rounded border" style={{ background: 'var(--panel-2)', borderColor: 'var(--line)' }}>
        {preview ? <img className="h-full w-full object-contain" src={preview.url} alt={t('covers.previewAlt', { name })} onError={() => { setPreview(null); setError('covers.invalidImage') }} /> : <span className="faint px-4 text-center">{t(busy ? 'covers.generating' : 'covers.previewHint')}</span>}
      </div>
      {error ? <div role="alert" style={{ color: 'var(--bad)' }}><p>{t(error)}</p>
        <p className="mt-1">{t(coverErrorAdvice(error))}</p>
        {retryAction === 'discover' ? <button type="button" data-cover-retry-discovery className="mt-1 underline" disabled={!ready || busy || candidateRendering} onClick={() => void discover()}>{t('covers.retryDiscovery')}</button> : null}
        {retryAction === 'preview' ? <button type="button" data-cover-retry-preview className="mt-1 underline" disabled={!ready || busy || candidateRendering || !target} onClick={() => void generate()}>{t('covers.retryPreview')}</button> : null}
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
