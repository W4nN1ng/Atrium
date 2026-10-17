import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import type { Db } from '../db'
import { getAsset, queryAssetIds } from '../db/repos/asset'
import { captureCoverSnapshot, hasCoverTaskUndo, pruneCoverTaskBackups, recordCoverTaskApplied,
  rememberCoverTaskBefore, sameCoverSnapshot, undoCoverTask, type CoverSnapshot } from '../db/repos/coverTasks'
import type { CoverTask, CoverTaskChoices, CoverTaskItem, CoverTaskRequest, CoverTaskUndoResult } from '../../shared/coverTasks'
import type { CoverCandidate, CoverDiscovery, CoverPreview, CoverRecord, PackageCoverSetup, PreviewOptions } from '../../shared/covers'
import { ulid } from '../../shared/ulid'
import { COVER_NONE } from '../library/thumbRules'
import type { CoverService } from './service'
import { resolveIndexedAssetFilter } from '../search/filter'

interface Dependencies {
  db: Db
  service: Pick<CoverService, 'discoverPackage' | 'preview' | 'save' | 'discard'>
  setup: (assetId: string) => PackageCoverSetup | Promise<PackageCoverSetup>
  changed?: (assetId: string) => void
}
interface Discovered { assetId: string; discovery: CoverDiscovery; fingerprint: string; dependency: string | undefined }
interface Data {
  task: CoverTask
  before: Map<string, CoverSnapshot | null>
  pending: Set<string>
  choice: Discovered | null
}
const DEFAULT_OPTIONS: PreviewOptions = { direction: 'auto', background: 'dark' }
const HISTORY = 10
const PAGE = 8

/** Main-process ownership keeps tasks alive when their renderer panel closes. */
export class CoverTasks {
  private readonly tasks = new Map<string, Data>()
  private readonly staged = new Map<string, { data: Data; assetId: string; targetId: string; preview: CoverPreview }>()
  private busy: string | null = null
  private disposed = false
  constructor(private readonly deps: Dependencies) { pruneCoverTaskBackups(deps.db, HISTORY) }

  start(request: CoverTaskRequest): CoverTask {
    if (this.disposed) throw new Error('covers.cancelled')
    if (this.busy) throw new Error('covers.batchBusy')
    if (!request || !['all', 'ids', 'filtered'].includes(request.scope) ||
      (request.scope === 'ids' && (!Array.isArray(request.assetIds) || !request.assetIds.length || request.assetIds.some(id => typeof id !== 'string' || !id))) ||
      (request.scope === 'filtered' && !validFilter(request.filter))) throw new Error('covers.invalidRequest')
    const filter = request.scope === 'filtered' ? resolveIndexedAssetFilter(request.filter!) : null
    const ids = request.scope === 'all' ? queryAssetIds(this.deps.db, { scope: 'all' }) : request.scope === 'filtered'
      ? filter ? queryAssetIds(this.deps.db, filter) : [] : [...new Set(request.assetIds!)]
    while (this.tasks.size >= HISTORY) {
      const oldest = this.tasks.entries().next().value!
      this.clearPreviews(oldest[1]); this.tasks.delete(oldest[0])
    }
    const task: CoverTask = { id: ulid(), running: true, cancelled: false, canUndo: false, updatedAt: Date.now(),
      items: ids.map(assetId => ({ assetId, name: getAsset(this.deps.db, assetId)?.name ?? assetId, state: 'queued', reason: null })) }
    const data: Data = { task, before: new Map(ids.map(id => [id, captureCoverSnapshot(this.deps.db, id)])), pending: new Set(), choice: null }
    this.tasks.set(task.id, data)
    void this.exclusive(data, async () => {
      for (const item of task.items) await this.process(data, item)
    }).catch(() => undefined)
    return structuredClone(task)
  }

  status(id?: string): CoverTask | null {
    const data = id ? this.tasks.get(id) : [...this.tasks.values()].at(-1)
    if (!data) return null
    data.task.canUndo = hasCoverTaskUndo(this.deps.db, data.task.id)
    return structuredClone(data.task)
  }

  async choices(id: string, assetId: string, offset = 0): Promise<CoverTaskChoices> {
    if (this.busy) throw new Error('covers.batchBusy')
    const data = this.get(id), item = this.choiceItem(data, assetId)
    if (!Number.isInteger(offset) || offset < 0) throw new Error('covers.invalidRequest')
    return this.exclusive(data, async () => {
      this.checkCurrent(data, assetId)
      this.clearPreviews()
      const found = await this.discover(data, assetId)
      data.choice = found
      const choices: CoverTaskChoices['choices'] = []
      for (const target of found.discovery.targets.slice(offset, offset + PAGE)) {
        this.checkCurrent(data, assetId)
        const requestId = this.request(data)
        try {
          const preview = await this.deps.service.preview({ assetId, projectId: '', provider: 'package',
            dependencyProjectId: found.dependency, target, options: DEFAULT_OPTIONS, requestId })
          this.checkCurrent(data, assetId); await this.checkSource(data, found)
          this.staged.set(requestId, { data, assetId, targetId: target.id, preview })
          choices.push({ target, preview, error: null })
        } catch (error) {
          this.discard(data, requestId)
          this.checkCurrent(data, assetId)
          if (reason(error) === 'covers.sourceChanged') throw error
          choices.push({ target, preview: null, error: detail(error) })
        }
      }
      item.state = 'review'; this.touch(data)
      return { choices, total: found.discovery.targets.length, truncated: found.discovery.truncated }
    }).catch(error => { this.clearPreviews(data); this.fail(data, item, error); throw error })
  }

  async apply(id: string, assetId: string, targetId: string): Promise<CoverTask> {
    if (this.busy) throw new Error('covers.batchBusy')
    const data = this.get(id), item = this.choiceItem(data, assetId)
    if (typeof targetId !== 'string' || !targetId) throw new Error('covers.invalidRequest')
    await this.exclusive(data, async () => {
      this.checkCurrent(data, assetId)
      const displayed = data.choice
      if (!displayed || displayed.assetId !== assetId || !displayed.discovery.targets.some(target => target.id === targetId)) throw new Error('covers.targetMissing')
      if (await this.fingerprint(data, assetId) !== displayed.fingerprint) {
        this.clearPreviews(data); data.choice = null
        throw new Error('covers.sourceChanged')
      }
      const fresh = await this.discover(data, assetId)
      const target = fresh.discovery.targets.find(candidate => candidate.id === targetId)
      if (!target) throw new Error('covers.targetMissing')
      if (fresh.fingerprint !== displayed.fingerprint || fresh.dependency !== displayed.dependency ||
        !isDeepStrictEqual(target, displayed.discovery.targets.find(candidate => candidate.id === targetId))) {
        data.choice = null; this.clearPreviews(data); throw new Error('covers.sourceChanged')
      }
      const cached = [...this.staged.values()].find(value => value.data === data && value.assetId === assetId && value.targetId === targetId)
      if (cached) {
        try {
          await this.commit(data, assetId, cached.preview.id, fresh)
          item.state = 'done'; item.reason = null; item.detail = null; this.clearPreviews(data); this.touch(data); return
        } catch (error) {
          if (reason(error) !== 'covers.previewExpired') throw error
        }
      }
      this.clearPreviews(data)
      await this.capture(data, item, target, DEFAULT_OPTIONS, undefined, fresh)
    }).catch(error => { this.fail(data, item, error); throw error })
    return this.status(id)!
  }

  retry(id: string): CoverTask {
    const data = this.get(id)
    this.check(data)
    if (this.busy) throw new Error('covers.batchBusy')
    const failed = data.task.items.filter(item => item.state === 'failed')
    for (const item of failed) { item.state = 'queued'; item.reason = null; item.detail = null }
    void this.exclusive(data, async () => { for (const item of failed) await this.process(data, item) }).catch(() => undefined)
    return structuredClone(data.task)
  }

  cancel(id: string): void {
    const data = this.tasks.get(id)
    if (!data) return
    data.task.cancelled = true
    for (const requestId of [...data.pending]) this.discard(data, requestId)
    this.clearPreviews(data)
    for (const item of data.task.items) if (['queued', 'running', 'review'].includes(item.state)) {
      item.state = 'cancelled'; item.reason = 'covers.cancelled'
    }
    this.touch(data)
  }

  undo(id: string): CoverTaskUndoResult {
    if (this.disposed) throw new Error('covers.cancelled')
    if (this.busy) throw new Error('covers.batchBusy')
    const data = this.tasks.get(id)
    const result = undoCoverTask(this.deps.db, id, assetId => {
      const item = data?.task.items.find(item => item.assetId === assetId)
      if (item) { item.state = 'restored'; item.reason = null }
      this.deps.changed?.(assetId)
    })
    if (data) { data.task.canUndo = hasCoverTaskUndo(this.deps.db, id); this.touch(data) }
    return result
  }

  dispose(): void {
    this.disposed = true
    for (const id of this.tasks.keys()) this.cancel(id)
    this.clearPreviews()
  }

  private async exclusive<T>(data: Data, work: () => Promise<T>): Promise<T> {
    this.check(data)
    if (this.busy) throw new Error('covers.batchBusy')
    this.busy = data.task.id; data.task.running = true; this.touch(data)
    try { return await work() }
    finally {
      this.busy = null; data.task.running = false
      if (!this.disposed) { data.task.canUndo = hasCoverTaskUndo(this.deps.db, data.task.id); pruneCoverTaskBackups(this.deps.db, HISTORY) }
      this.touch(data)
    }
  }
  private get(id: string): Data {
    const data = this.tasks.get(id)
    if (!data) throw new Error('covers.invalidRequest')
    return data
  }
  private check(data: Data): void {
    if (this.disposed || data.task.cancelled) throw new Error('covers.cancelled')
  }
  private checkCurrent(data: Data, assetId: string): void {
    this.check(data)
    const snapshot = captureCoverSnapshot(this.deps.db, assetId)
    if (!snapshot) throw new Error('covers.assetMissing')
    if (!sameCoverSnapshot(snapshot, data.before.get(assetId) ?? null)) throw new Error('covers.changed')
  }
  private choiceItem(data: Data, assetId: string): CoverTaskItem {
    this.check(data)
    const item = data.task.items.find(item => item.assetId === assetId)
    if (!item || !['review', 'failed'].includes(item.state)) throw new Error('covers.invalidRequest')
    return item
  }
  private touch(data: Data): void { data.task.updatedAt = Date.now() }
  private request(data: Data): string { const id = ulid().toLowerCase(); data.pending.add(id); return id }
  private discard(data: Data, requestId: string): void {
    this.deps.service.discard(requestId); data.pending.delete(requestId); this.staged.delete(requestId)
  }
  private clearPreviews(only?: Data): void {
    for (const [id, value] of this.staged) if (!only || value.data === only) this.discard(value.data, id)
  }
  private fail(data: Data, item: CoverTaskItem, error: unknown): void {
    item.state = data.task.cancelled || this.disposed ? 'cancelled' : reason(error) === 'covers.sourceChanged' ? 'review' : 'failed'
    item.reason = reason(error); item.detail = detail(error); this.touch(data)
  }
  private async process(data: Data, item: CoverTaskItem): Promise<void> {
    if (data.task.cancelled || this.disposed) { item.state = 'cancelled'; item.reason = 'covers.cancelled'; return }
    item.state = 'running'; this.touch(data)
    try {
      this.checkCurrent(data, item.assetId)
      const before = data.before.get(item.assetId)!
      const asset = getAsset(this.deps.db, item.assetId)!
      const record = before!.record
      const skip = (key: string): void => { item.state = 'skipped'; item.reason = key; this.touch(data) }
      if (asset.attachment_kind) return skip('covers.unlinkedSkipped')
      if (record?.source === 'image') return skip('covers.manualSkipped')
      if (!record && before!.image && before!.image !== COVER_NONE) return skip('covers.productSkipped')
      if (record) {
        if (record.coverImage !== before!.image) throw new Error('covers.changed')
        if (!record.target?.persistent || !record.options || (record.source === 'unity' && !record.projectId)) return skip('covers.unlinkedSkipped')
        await this.capture(data, item, record.target as CoverCandidate, record.options, record)
        return
      }
      const found = await this.discover(data, item.assetId)
      if (!found.discovery.targets.length) return skip(found.discovery.warnings[0] ?? 'covers.noCandidates')
      if (found.discovery.targets.length !== 1 || found.discovery.truncated || found.discovery.warnings.length) {
        item.state = 'review'; item.reason = found.discovery.warnings[0] ?? (found.discovery.truncated ? 'covers.inventoryLimited' : 'covers.reviewRequired')
        item.detail = found.discovery.warnings.join('\n') || null; return
      }
      await this.capture(data, item, found.discovery.targets[0], DEFAULT_OPTIONS, undefined, found)
    } catch (error) { this.fail(data, item, error) }
    finally { this.touch(data) }
  }
  private async discover(data: Data, assetId: string): Promise<Discovered> {
    this.checkCurrent(data, assetId)
    const fingerprint = await this.fingerprint(data, assetId)
    const setup = await this.deps.setup(assetId)
    this.checkCurrent(data, assetId)
    const dependency = setup.recommendedProjectId ?? undefined
    const requestId = this.request(data)
    try {
      const discovery = await this.deps.service.discoverPackage(assetId, requestId, dependency)
      this.checkCurrent(data, assetId)
      const result = { assetId, discovery, fingerprint, dependency }
      await this.checkSource(data, result)
      return result
    } finally { this.discard(data, requestId) }
  }
  private async capture(data: Data, item: CoverTaskItem, target: CoverCandidate, options: PreviewOptions, record?: CoverRecord, found?: Discovered): Promise<void> {
    const assetId = item.assetId
    this.checkCurrent(data, assetId)
    const source = record?.source === 'unity' ? undefined : found ?? {
      assetId, fingerprint: await this.fingerprint(data, assetId), discovery: { targets: [], warnings: [], truncated: false }, dependency: record?.projectId ?? undefined }
    const requestId = this.request(data)
    try {
      await this.deps.service.preview({ assetId, projectId: record?.source === 'unity' ? record.projectId! : '', provider: record?.source === 'unity' ? 'project' : 'package',
        dependencyProjectId: source?.dependency, target, options, requestId })
      await this.commit(data, assetId, requestId, source)
      item.state = 'done'; item.reason = null; item.detail = null
    } finally { this.discard(data, requestId) }
  }
  private async commit(data: Data, assetId: string, previewId: string, source?: Discovered): Promise<void> {
    if (source) await this.checkSource(data, source)
    this.checkCurrent(data, assetId)
    this.deps.db.transaction(() => {
      rememberCoverTaskBefore(this.deps.db, data.task.id, assetId, data.before.get(assetId)!)
      this.deps.service.save(assetId, previewId)
      recordCoverTaskApplied(this.deps.db, data.task.id, assetId, captureCoverSnapshot(this.deps.db, assetId)!)
    })()
    data.task.canUndo = true
  }
  private async checkSource(data: Data, found: Discovered): Promise<void> {
    if (await this.fingerprint(data, found.assetId) !== found.fingerprint) throw new Error('covers.sourceChanged')
  }

  /** Async, bounded package-only scan. Ancestor folders never become this card's source. */
  private async fingerprint(data: Data, assetId: string): Promise<string> {
    const hash = createHash('sha256'), seen = new Set<string>()
    let count = 0, id: string | null = assetId
    const walk = async (file: string, depth = 0): Promise<void> => {
      this.check(data)
      const resolved = path.resolve(file)
      if (seen.has(resolved)) return
      if (++count > 20_000) throw new Error('covers.inventoryLimited')
      seen.add(resolved)
      let stat: fs.Stats
      try { stat = await fs.promises.lstat(resolved) } catch { hash.update(JSON.stringify([resolved, 'missing'])); return }
      hash.update(JSON.stringify([resolved, stat.size, stat.mtimeMs, stat.isSymbolicLink()]))
      if (stat.isDirectory() && !stat.isSymbolicLink()) {
        if (depth >= 8) throw new Error('covers.inventoryLimited')
        const children: string[] = []
        for await (const child of await fs.promises.opendir(resolved)) {
          this.check(data)
          if (children.length + count > 20_000) throw new Error('covers.inventoryLimited')
          children.push(child.name)
        }
        for (const child of children.sort()) await walk(path.join(resolved, child), depth + 1)
      }
    }
    const ancestors = new Set<string>()
    while (id && !ancestors.has(id)) {
      ancestors.add(id)
      const asset = getAsset(this.deps.db, id)
      if (!asset) throw new Error('covers.assetMissing')
      hash.update(JSON.stringify([asset.id, asset.library_path, asset.source_path, asset.parent_asset_id, asset.raw_name]))
      if (id === assetId) for (const file of new Set([asset.library_path, asset.source_path])) if (file) await walk(file)
      const entries = this.deps.db.prepare('SELECT guid, unity_path, entry_kind, size FROM package_entry WHERE asset_id=? ORDER BY guid, unity_path').all(id)
      hash.update(JSON.stringify(entries)); id = asset.parent_asset_id
    }
    return hash.digest('hex')
  }
}
function reason(error: unknown): string { return detail(error).match(/covers\.[A-Za-z]+/)?.[0] ?? 'covers.renderFailed' }
function detail(error: unknown): string { return (error instanceof Error ? error.message : String(error)).slice(0, 4000) }

function validFilter(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const filter = value as Record<string, unknown>
  for (const key of ['search', 'category', 'subcategory', 'collectionId', 'status', 'groupId', 'parentId', 'attachmentKind']) {
    if (filter[key] !== undefined && filter[key] !== null && typeof filter[key] !== 'string') return false
  }
  /**
   * 布尔档位的白名单。`reviewOnly` 已随「待复核」功能（2026-10-15）一起移除，
   * `AssetFilter` 里不再有这一项 —— 这里列着它等于放行一个没人认识的字段。
   */
  for (const key of ['attachmentsOnly', 'bundlesOnly']) {
    if (filter[key] !== undefined && typeof filter[key] !== 'boolean') return false
  }
  if (filter.ids !== undefined && (!Array.isArray(filter.ids) || filter.ids.some(id => typeof id !== 'string'))) return false
  if (filter.scope !== undefined && !['top', 'all'].includes(filter.scope as string)) return false
  if (filter.view !== undefined && !['grouped', 'flat'].includes(filter.view as string)) return false
  return true
}
