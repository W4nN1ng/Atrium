import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { CoverPreview, CoverStatus, PreviewDirection, PreviewOptions, PreviewTarget } from '../../shared/covers'
import { useUi } from '../stores/ui'
import { Button, Modal } from './ui'

const angleKeys: Record<PreviewDirection, string> = {
  auto: 'covers.angleAuto', scene: 'covers.angleScene', front: 'covers.angleFront', back: 'covers.angleBack',
  left: 'covers.angleLeft', right: 'covers.angleRight', top: 'covers.angleTop', bottom: 'covers.angleBottom'
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
  const [projectId, setProject] = useState(defaultProject ?? projects[0]?.id ?? '')
  const [status, setStatus] = useState<CoverStatus | null>(null)
  const [target, setTarget] = useState<PreviewTarget | null>(null)
  const [targets, setTargets] = useState<PreviewTarget[]>([])
  const [query, setQuery] = useState('')
  const [options, setOptions] = useState<PreviewOptions>({ direction: 'auto', background: 'dark' })
  const [preview, setPreview] = useState<CoverPreview | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [errorDetail, setErrorDetail] = useState('')
  const [notice, setNotice] = useState('')
  const request = useRef<string | null>(null)
  const generation = useRef(0)
  const initialized = useRef(false)
  const mounted = useRef(true)
  const discard = (): void => {
    generation.current++
    if (request.current) void window.a.covers.discard(request.current).catch(() => undefined)
    request.current = null; setPreview(null)
  }
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false; generation.current++
      if (request.current) void window.a.covers.discard(request.current).catch(() => undefined)
    }
  }, [])
  useEffect(() => {
    let active = true
    const refresh = (): void => {
      void window.a.covers.status(assetId, projectId).then(value => {
        if (!active) return
        setStatus(value)
        if (!initialized.current) {
          initialized.current = true
          if (value.record?.source === 'unity') {
            if (value.record.projectId) setProject(value.record.projectId)
            if (value.record.target) { setTarget(value.record.target); setTargets([value.record.target]) }
            if (value.record.options) setOptions(value.record.options)
          }
        }
      }).catch(() => { if (active) setStatus(null) })
    }
    refresh(); const timer = setInterval(refresh, 2000)
    return () => { active = false; clearInterval(timer) }
  }, [assetId, projectId])
  const fail = (e: unknown): void => {
    const key = e instanceof Error ? e.message.match(/covers\.[A-Za-z]+/)?.[0] : null
    setError(key && i18n.exists(key) ? key : 'covers.renderFailed')
    setErrorDetail((e instanceof Error ? e.message : String(e)).slice(0, 4000))
  }
  async function loadTargets(search: string): Promise<void> {
    discard(); setBusy(true); setError(''); setNotice('')
    const current = generation.current
    try {
      const found = await window.a.covers.targets(projectId, search)
      if (!mounted.current || current !== generation.current) return
      setTargets(found); setTarget(found.length === 1 ? found[0] : null)
      if (!found.length) setNotice(search ? 'covers.noResults' : 'covers.noSelection')
    } catch (e) { if (mounted.current && current === generation.current) fail(e) }
    finally { if (mounted.current && current === generation.current) setBusy(false) }
  }
  async function generate(): Promise<void> {
    if (!target) return
    discard(); setError(''); setNotice(''); setBusy(true)
    const id = crypto.randomUUID(); request.current = id
    const current = generation.current
    try {
      const result = await window.a.covers.preview({ assetId, projectId, target, options, requestId: id })
      if (!mounted.current || current !== generation.current) { void window.a.covers.discard(id); return }
      setPreview(result)
    } catch (e) { if (mounted.current && current === generation.current) fail(e) }
    finally { if (mounted.current && current === generation.current) setBusy(false) }
  }
  async function action(fn: () => Promise<unknown>, finish = true, message = 'covers.upgraded'): Promise<void> {
    setBusy(true); setError('')
    try {
      await fn()
      if (!mounted.current) return
      if (finish) { useUi.getState().toast('ok', t('covers.saved')); close() }
      else if (message) setNotice(message)
    } catch (e) { if (mounted.current) fail(e) }
    finally { if (mounted.current) setBusy(false) }
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
  return <Modal open onOpenChange={value => { if (!value) close() }} title={t('covers.title', { name })} footer={<>
    <Button onClick={close}>{t('common.cancel')}</Button>
    <Button variant="accent" disabled={busy || !preview} onClick={() => void action(() => window.a.covers.save(assetId, preview!.id))}>{t('covers.save')}</Button>
  </>}>
    <div className="max-h-[70vh] space-y-3 overflow-y-auto text-[12px]">
      <p className="muted">{t('covers.intro')}</p>
      <label className="block">{t('covers.project')}
        <select className="input mt-1 w-full" value={projectId} disabled={busy} onChange={e => { discard(); setProject(e.target.value); setTargets([]); setTarget(null); setError(''); setNotice('') }}>
          <option value="">{t('covers.chooseProject')}</option>
          {projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}
        </select>
      </label>
      {status?.bridge === 'offline' ? <p className="muted">{t('covers.offline')}</p> : null}
      {status?.bridge === 'busy' ? <p className="muted">{t('covers.unityBusy')}</p> : null}
      {status?.bridge === 'upgrade' ? <div className="flex items-center justify-between gap-2"><p>{t('covers.bridgeUpgrade')}</p><Button disabled={busy} onClick={() => void action(() => window.a.covers.upgradeBridge(projectId), false)}>{t('covers.upgrade')}</Button></div> : null}
      <div className="flex flex-wrap gap-2">
        <Button disabled={busy || !ready} onClick={() => void loadTargets('')}>{t('covers.selection')}</Button>
        <input aria-label={t('covers.search')} className="input min-w-0 flex-1" maxLength={100} placeholder={t('covers.search')} value={query} disabled={busy} onChange={e => setQuery(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); if (ready && !busy && query.trim()) void loadTargets(query.trim()) } }} />
        <Button disabled={busy || !ready || !query.trim()} onClick={() => void loadTargets(query.trim())}>{t('common.search')}</Button>
      </div>
      <p className="faint">{t('covers.selectionHint')}</p>
      {targets.length ? <label className="block">{t('covers.object')}
        <select className="input mt-1 w-full" value={target?.id ?? ''} disabled={busy} onChange={e => { discard(); setTarget(targets.find(item => item.id === e.target.value) ?? null) }}>
          <option value="">{t('covers.chooseObject')}</option>
          {targets.map(item => <option key={item.id} value={item.id}>{item.name} — {item.path}</option>)}
        </select>
      </label> : null}
      {target && !target.persistent ? <p style={{ color: 'var(--warn)' }}>{t('covers.temporaryTarget')}</p> : null}
      <div className="flex flex-wrap items-end gap-3">
        <label>{t('covers.angle')}<select className="input ml-2" value={options.direction} disabled={busy} onChange={e => { discard(); setOptions({ ...options, direction: e.target.value as PreviewDirection }) }}>
          {Object.entries(angleKeys).map(([value, label]) => <option key={value} value={value}>{t(label)}</option>)}
        </select></label>
        <label>{t('covers.background')}<select className="input ml-2" value={options.background} disabled={busy} onChange={e => { discard(); setOptions({ ...options, background: e.target.value as 'dark' | 'light' }) }}>
          <option value="dark">{t('covers.dark')}</option><option value="light">{t('covers.light')}</option>
        </select></label>
        <Button disabled={busy || !ready || !target} onClick={() => void generate()}>{t('covers.generate')}</Button>
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
        {busy && request.current ? <Button onClick={() => { discard(); setBusy(false); setNotice('covers.cancelled') }}>{t('common.cancel')}</Button> : null}
      </div>
    </div>
  </Modal>
}
