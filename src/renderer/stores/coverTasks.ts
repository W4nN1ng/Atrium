import { create } from 'zustand'
import type { AssetFilter } from '../../shared/types'
import type { CoverTask, CoverTaskChoices, CoverTaskRequest, CoverTaskUndoResult } from '../../shared/coverTasks'

export interface CoverTaskError { key: string; detail: string }
interface CoverTasksState {
  task: CoverTask | null
  open: boolean
  starting: boolean
  refreshing: boolean
  mutation: 'stop' | 'retry' | 'undo' | null
  applying: boolean
  error: CoverTaskError | null
  undoResult: CoverTaskUndoResult | null
  reviewAssetId: string | null
  choices: CoverTaskChoices | null
  choicesOffset: number
  choicesLoading: boolean
  choicesError: CoverTaskError | null
  start(request: CoverTaskRequest): Promise<void>
  refresh(): Promise<void>
  show(): Promise<void>
  hide(): void
  selectReview(assetId: string, offset?: number): Promise<void>
  applyChoice(targetId: string): Promise<void>
  retry(): Promise<void>
  stop(): Promise<void>
  undo(): Promise<void>
}

/** Keep the query itself: the grid's loaded page is only a portion of this scope. */
export function currentCoverTaskFilter(s: { nav: string; search: string; view: 'grouped' | 'flat' }): AssetFilter {
  const filter: AssetFilter = { view: s.view }
  if (s.search) filter.search = s.search
  if (s.nav.startsWith('col:')) filter.collectionId = s.nav.slice(4)
  if (s.nav.startsWith('cat:')) filter.category = s.nav.slice(4)
  if (s.nav.startsWith('bundle:')) filter.parentId = s.nav.slice(7)
  if (s.nav === 'inbox') filter.status = 'inbox'
  if (s.nav === 'review') filter.reviewOnly = true
  if (s.nav === 'bundles') filter.bundlesOnly = true
  return filter
}

function failure(error: unknown): CoverTaskError {
  const detail = (error instanceof Error ? error.message : String(error)).slice(0, 4000)
  return { key: detail.match(/(?:covers|coverTasks)\.[A-Za-z]+/)?.[0] ?? 'coverTasks.requestFailed', detail }
}

export const useCoverTasks = create<CoverTasksState>((set, get) => {
  // Task and command revisions reject stale status calls; view revisions reject
  // image pages from a hidden or replaced review without cancelling the task.
  let taskRevision = 0
  let commandRevision = 0
  let viewRevision = 0
  let pollRevision = 0
  const clearChoices = () => {
    viewRevision++
    set({ reviewAssetId: null, choices: null, choicesOffset: 0, choicesError: null })
  }
  const commandsBusy = () => get().starting || get().applying || !!get().mutation
  const busy = () => commandsBusy() || get().choicesLoading
  const accept = (value: CoverTask) => {
    set({ task: value })
    if (get().reviewAssetId && !value.items.some(item => item.assetId === get().reviewAssetId && item.state === 'review')) clearChoices()
  }

  return {
    task: null, open: false, starting: false, refreshing: false, mutation: null, applying: false,
    error: null, undoResult: null, reviewAssetId: null, choices: null, choicesOffset: 0,
    choicesLoading: false, choicesError: null,

    async start(request) {
      if (busy() || get().task?.running) return
      const revision = ++taskRevision
      commandRevision++
      clearChoices()
      set({ starting: true, open: false, task: null, error: null, undoResult: null, refreshing: false })
      try {
        const value = await window.a.covers.startTask(request)
        if (revision === taskRevision) accept(value)
      } catch (error) {
        if (revision === taskRevision) set({ error: failure(error) })
      } finally {
        if (revision === taskRevision) set({ starting: false })
      }
    },

    async refresh() {
      if (get().refreshing) return
      const revision = taskRevision, command = commandRevision, poll = ++pollRevision
      const id = get().task?.id
      if (commandsBusy()) return
      set({ refreshing: true })
      const current = () => revision === taskRevision && command === commandRevision && poll === pollRevision
      try {
        const value = await window.a.covers.taskStatus(id)
        if (!current()) return
        if (value && (!get().task || (value.id === get().task?.id && value.updatedAt >= get().task!.updatedAt))) {
          accept(value)
          set({ error: null })
          const first = value.items.find(item => item.state === 'review')
          if (!value.running && get().open && !get().reviewAssetId && !busy() && first) void get().selectReview(first.assetId)
        }
      } catch (error) {
        if (current()) set({ error: failure(error) })
      } finally {
        if (current()) set({ refreshing: false })
      }
    },

    async show() {
      clearChoices()
      set({ open: true })
      const first = get().task?.items.find(item => item.state === 'review')
      if (first) await get().selectReview(first.assetId)
    },
    hide() { clearChoices(); set({ open: false }) },

    async selectReview(assetId, offset = 0) {
      const task = get().task
      if (!task || task.running || task.cancelled || !get().open || busy() || !task.items.some(item => item.assetId === assetId && item.state === 'review')) return
      const revision = taskRevision, view = ++viewRevision
      const page = Math.max(0, Math.floor(offset / 8) * 8)
      set({ reviewAssetId: assetId, choices: null, choicesOffset: page, choicesLoading: true, choicesError: null })
      const current = () => revision === taskRevision && view === viewRevision && get().open
      try {
        const choices = await window.a.covers.taskChoices(task.id, assetId, page)
        if (current()) set({ choices: { ...choices, choices: choices.choices.slice(0, 8) } })
      } catch (error) {
        if (current()) set({ choicesError: failure(error) })
      } finally {
        if (revision === taskRevision) {
          set({ choicesLoading: false })
          const first = get().task?.items.find(item => item.state === 'review')
          // Reopening while the old page finishes waits for the exclusive IPC,
          // then requests a fresh page instead of reviving the hidden response.
          if (get().open && !get().reviewAssetId && first && !get().task?.cancelled) void get().selectReview(first.assetId)
        }
      }
    },

    async applyChoice(targetId) {
      const { task, reviewAssetId, choices } = get()
      if (!task || task.running || task.cancelled || !reviewAssetId || busy() || !choices?.choices.some(choice => choice.target.id === targetId && choice.preview && !choice.error)) return
      const revision = taskRevision, view = viewRevision
      const command = ++commandRevision
      set({ applying: true, error: null, undoResult: null, refreshing: false })
      try {
        const value = await window.a.covers.applyTaskChoice(task.id, reviewAssetId, targetId)
        if (revision !== taskRevision || command !== commandRevision) return
        // Clear saved thumbnails before the next asset's page is requested.
        const advance = get().open && view === viewRevision
        clearChoices()
        accept(value)
        set({ applying: false })
        const next = value.items.find(item => item.state === 'review')
        if (advance && next) await get().selectReview(next.assetId)
      } catch (error) {
        if (revision === taskRevision && command === commandRevision) set({ error: failure(error) })
      } finally {
        if (revision === taskRevision) set({ applying: false })
      }
    },

    async retry() {
      const task = get().task
      if (!task || task.running || busy() || !task.items.some(item => item.state === 'failed')) return
      const revision = taskRevision
      commandRevision++
      clearChoices()
      set({ mutation: 'retry', error: null, undoResult: null, refreshing: false })
      try {
        const value = await window.a.covers.retryTask(task.id)
        if (revision === taskRevision) accept(value)
      } catch (error) {
        if (revision === taskRevision) set({ error: failure(error) })
      } finally {
        if (revision === taskRevision) set({ mutation: null })
      }
    },

    async stop() {
      const task = get().task
      if (!task || task.cancelled || (!task.running && !get().choicesLoading && !get().applying) || get().starting || get().mutation) return
      const revision = taskRevision
      commandRevision++
      clearChoices()
      set({ mutation: 'stop', error: null, refreshing: false })
      try {
        await window.a.covers.cancelTask(task.id)
        const value = await window.a.covers.taskStatus(task.id)
        if (revision === taskRevision && value) accept(value)
      } catch (error) {
        if (revision === taskRevision) set({ error: failure(error) })
      } finally {
        if (revision === taskRevision) set({ mutation: null })
      }
    },

    async undo() {
      const task = get().task
      if (!task?.canUndo || task.running || busy()) return
      const revision = taskRevision
      commandRevision++
      clearChoices()
      set({ mutation: 'undo', error: null, undoResult: null, refreshing: false })
      try {
        const result = await window.a.covers.undoTask(task.id)
        if (revision !== taskRevision) return
        set({ undoResult: result, task: { ...get().task!, canUndo: false } })
        const value = await window.a.covers.taskStatus(task.id)
        if (revision === taskRevision && value) accept(value)
      } catch (error) {
        if (revision === taskRevision) set({ error: failure(error) })
      } finally {
        if (revision === taskRevision) set({ mutation: null })
      }
    }
  }
})
