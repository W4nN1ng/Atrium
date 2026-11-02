import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { DEFAULTS } from '../../src/shared/settingsDefaults'

let events: Map<string, (payload: unknown) => void>, queue: ReturnType<typeof vi.fn>
const deferred = () => { let resolve!: (value: any) => void; const promise = new Promise<any>(done => { resolve = done }); return { promise, resolve } }
const item = (stage: string) => ({ jobId: 'restored-plan', sourcePath: 'C:/fixture/source', name: 'source', stage, progress: stage === 'queued' ? 0 : 1 })
const snapshot = (revision: number, items: any[]) => ({ revision, items })
beforeEach(() => {
  vi.resetModules(); events = new Map(); queue = vi.fn(async () => snapshot(0, []))
  vi.stubGlobal('window', { location: { search: '' }, a: {
    system: { info: async () => ({}), paths: async () => ({}) },
    settings: { getAll: async () => ({ ...DEFAULTS, onboardingDone: true, libraryRoot: null }) },
    unity: { status: async () => ({}), connection: async () => ({ targetProjectId: null, projects: [] }) },
    assets: { list: async () => ({ cards: [], total: 0 }), stats: async () => ({}) },
    collections: { list: async () => [] }, categories: { list: async () => null }, ingest: { queueSnapshot: queue },
    on: (name: string, listener: (payload: unknown) => void) => { events.set(name, listener) }
  } })
  vi.stubGlobal('document', { documentElement: { classList: { toggle: () => undefined }, lang: '' } })
})
afterEach(() => vi.unstubAllGlobals())
async function store() {
  const { initI18n } = await import('../../src/renderer/i18n'); await initI18n('en')
  return (await import('../../src/renderer/stores/ui')).useUi
}
it('keeps a restored confirmation event when the boot queue request later returns an older queued snapshot', async () => {
  const ui = await store(), pending = deferred(); queue.mockImplementationOnce(() => pending.promise)
  const boot = ui.getState().boot()
  await vi.waitFor(() => expect(queue).toHaveBeenCalled())
  events.get('ingest:progress')!(snapshot(2, [{ ...item('awaiting_confirm'), planId: 'saved-plan' }]))
  pending.resolve(snapshot(1, [item('queued')])); await boot
  expect(ui.getState().bootError).toBeNull()
  expect(ui.getState().ingestItems).toMatchObject([{ stage: 'awaiting_confirm', planId: 'saved-plan' }])
})
it('does not revive a dismissed row when an earlier manual refresh finishes after the latest refresh', async () => {
  const ui = await store(); await ui.getState().boot()
  const old = deferred(), latest = deferred()
  queue.mockImplementationOnce(() => old.promise).mockImplementationOnce(() => latest.promise)
  const a = ui.getState().refreshIngestQueue(), b = ui.getState().refreshIngestQueue()
  latest.resolve(snapshot(2, [])); await b; old.resolve(snapshot(1, [item('queued')])); await a
  expect(ui.getState().ingestItems).toEqual([])
})
it('ignores a queued event delivered after a newer restored confirmation event', async () => {
  const ui = await store(); await ui.getState().boot(); const emit = events.get('ingest:progress')!
  emit(snapshot(2, [{ ...item('awaiting_confirm'), planId: 'saved-plan' }]))
  emit(snapshot(1, [item('queued')]))
  expect(ui.getState().ingestItems).toMatchObject([{ stage: 'awaiting_confirm', planId: 'saved-plan' }])
})
it('does not revive a dismissed job from an older full event snapshot', async () => {
  const ui = await store(); await ui.getState().boot(); const emit = events.get('ingest:progress')!
  emit(snapshot(3, [])); emit(snapshot(2, [item('awaiting_confirm')]))
  expect(ui.getState().ingestItems).toEqual([])
})
it('ignores an old event delivered after an authoritative queue response', async () => {
  const ui = await store(); await ui.getState().boot()
  queue.mockResolvedValueOnce(snapshot(3, [{ ...item('awaiting_confirm'), planId: 'saved-plan' }]))
  await ui.getState().refreshIngestQueue()
  events.get('ingest:progress')!(snapshot(2, [item('queued')]))
  expect(ui.getState().ingestItems).toMatchObject([{ stage: 'awaiting_confirm', planId: 'saved-plan' }])
})
it('accepts a real newer cancel, resume and confirmation sequence', async () => {
  const ui = await store(); await ui.getState().boot(); const emit = events.get('ingest:progress')!
  for (const [revision, stage] of [[1, 'awaiting_confirm'], [2, 'cancelled'], [3, 'queued'], [4, 'awaiting_confirm']] as const) {
    emit(snapshot(revision, [{ ...item(stage), planId: 'saved-plan' }]))
    expect(ui.getState().ingestItems[0].stage).toBe(stage)
  }
})
