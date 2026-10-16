import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProjectInfo, UnityStatus } from '../../src/shared/types'
import type { UnityConnectionSnapshot } from '../../src/shared/unityConnection'
import { UnityConnections } from '../../src/main/project/connections'

type Status = Pick<UnityStatus, 'bridgeReady' | 'isCompiling' | 'isUpdating' | 'isPlaying' | 'busyReason'>
const asleep: Status = { bridgeReady: false, isCompiling: false, isUpdating: false, isPlaying: false, busyReason: null }
let root: string
let controllers: UnityConnections[]

function project(id: string, options: Partial<ProjectInfo> = {}): ProjectInfo {
  const dir = path.join(root, id)
  fs.mkdirSync(path.join(dir, 'Assets'), { recursive: true })
  fs.mkdirSync(path.join(dir, 'Packages'), { recursive: true })
  fs.mkdirSync(path.join(dir, 'ProjectSettings'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'ProjectSettings', 'ProjectVersion.txt'), 'm_EditorVersion: 2022.3.22f1\n')
  return { id, path: dir, name: id, unityVersion: '2022.3.22f1', running: true, detectedBy: ['lockfile'], bridgeVersion: null, bridgeInstalled: false, ...options }
}

function packageAt(p: ProjectInfo): void {
  const dir = path.join(p.path, 'Packages', 'com.avca.bridge')
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'package.json'), '{"name":"com.avca.bridge","unity":"2022.3"}')
  fs.writeFileSync(path.join(dir, 'UserModification.cs'), '// preserve this')
}

function harness(install?: (p: ProjectInfo) => { ok: boolean; error: string | null } | Promise<{ ok: boolean; error: string | null }>) {
  const config = { enabled: true, excludedProjectIds: [] as string[] }
  const statuses = new Map<string, Status>()
  const installFn = vi.fn(install ?? ((p: ProjectInfo) => { packageAt(p); return { ok: true, error: null } }))
  const watch = vi.fn()
  const changed = vi.fn<(snapshot: UnityConnectionSnapshot) => void>()
  const controller = new UnityConnections({ config: () => config, install: installFn, watch, changed, statusOf: (dir) => statuses.get(dir) ?? asleep })
  controllers.push(controller)
  return { controller, config, statuses, install: installFn, watch, changed }
}

async function flush(): Promise<void> { await Promise.resolve(); await Promise.resolve(); await Promise.resolve() }

beforeEach(() => { root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'atrium-connections-')); controllers = [] })
afterEach(() => {
  for (const c of controllers) c.dispose()
  vi.useRealTimers()
  fs.rmSync(root, { recursive: true, force: true })
})

describe('automatic connection boundaries', () => {
  it('does not install or watch closed projects', () => {
    const p = project('closed', { running: false })
    const h = harness()
    h.controller.update([p])
    expect(h.controller.snapshot().projects[0].phase).toBe('closed')
    expect(h.install).not.toHaveBeenCalled()
    expect(h.watch).not.toHaveBeenCalled()
    expect(h.controller.snapshot().targetProjectId).toBeNull()
  })

  it('never installs an owned preview even when it is running', () => {
    const p = project('preview')
    fs.writeFileSync(path.join(p.path, '.atrium-cover-preview.json'), JSON.stringify({ kind: 'atrium-package-preview', version: 1, projectPath: p.path }))
    const h = harness()
    h.controller.update([p])
    expect(h.install).not.toHaveBeenCalled()
    expect(h.watch).not.toHaveBeenCalled()
    expect(h.controller.snapshot().projects[0].phase).toBe('unsupported')
    expect(h.controller.snapshot().targetProjectId).toBeNull()
  })

  it('reserves a dangling preview marker instead of treating a damaged worker as a user project', async () => {
    const p = project('damaged-preview')
    fs.symlinkSync(path.join(root, 'missing-marker-target'), path.join(p.path, '.atrium-cover-preview.json'), 'junction')
    const h = harness()
    h.controller.update([p])
    await flush()
    expect(h.install).not.toHaveBeenCalled()
    expect(h.controller.snapshot().projects[0].phase).toBe('unsupported')
  })

  it('verifies the actual Unity version rather than stale discovery metadata', () => {
    const p = project('unsupported')
    fs.writeFileSync(path.join(p.path, 'ProjectSettings', 'ProjectVersion.txt'), 'm_EditorVersion: 6000.0.1f1\n')
    const h = harness()
    h.controller.update([p])
    expect(h.install).not.toHaveBeenCalled()
    expect(h.controller.snapshot().projects[0]).toMatchObject({ phase: 'unsupported', reasonKey: 'project.connectionUnsupported' })
  })

  it('rejects a nonexistent or relative project directory', () => {
    const p = project('missing')
    fs.rmSync(p.path, { recursive: true })
    const h = harness()
    h.controller.update([p, { ...p, id: 'relative', path: 'relative' }])
    expect(h.install).not.toHaveBeenCalled()
    expect(h.controller.snapshot().projects.map((p) => p.phase)).toEqual(['failed', 'failed'])
    expect(h.controller.snapshot().targetProjectId).toBeNull()
  })

  it.each(['project', 'ancestor', 'Packages', 'Assets', 'ProjectSettings', 'bridge'])('rejects a linked %s before any install or watch', (part) => {
    const p = project('linked')
    const outside = path.join(root, 'outside')
    fs.mkdirSync(outside)
    if (part === 'project') {
      fs.renameSync(p.path, outside + '-project')
      fs.symlinkSync(outside + '-project', p.path, 'junction')
    } else if (part === 'ancestor') {
      const alias = path.join(root, 'alias')
      fs.symlinkSync(root, alias, 'junction')
      p.path = path.join(alias, 'linked')
    } else {
      const target = part === 'bridge' ? path.join(p.path, 'Packages', 'com.avca.bridge') : path.join(p.path, part)
      fs.rmSync(target, { recursive: true, force: true })
      fs.symlinkSync(outside, target, 'junction')
    }
    const h = harness()
    h.controller.update([p])
    expect(h.install).not.toHaveBeenCalled()
    expect(h.watch).not.toHaveBeenCalled()
    expect(h.controller.snapshot().projects[0]).toMatchObject({ phase: 'failed', reasonKey: 'project.connectionUnsafe' })
  })

  it('allows a real project whose Packages directory does not exist yet', async () => {
    const p = project('new')
    fs.rmdirSync(path.join(p.path, 'Packages'))
    const h = harness()
    h.controller.update([p])
    await flush()
    expect(fs.existsSync(path.join(p.path, 'Packages', 'com.avca.bridge', 'package.json'))).toBe(true)
    expect(h.controller.snapshot().projects[0].phase).toBe('connecting')
  })

  it('deduplicates concurrent install attempts and never mistakes installed for ready', async () => {
    const p = project('one')
    let complete!: (result: { ok: boolean; error: string | null }) => void
    const h = harness(() => new Promise((resolve) => { complete = resolve }))
    expect(h.controller.update([p])).toBeUndefined()
    await flush()
    h.controller.update([p])
    expect(h.install).toHaveBeenCalledTimes(1)
    expect(h.install).toHaveBeenCalledWith(p)
    expect(h.controller.snapshot().projects[0].phase).toBe('installing')
    complete({ ok: true, error: null })
    await flush()
    expect(h.controller.snapshot().projects[0].phase).toBe('connecting')
    h.controller.update([p])
    expect(h.install).toHaveBeenCalledTimes(1)
    h.statuses.set(p.path, { ...asleep, bridgeReady: true, isCompiling: true, isPlaying: true })
    expect(h.controller.snapshot().projects[0].phase).toBe('ready')
    h.statuses.set(p.path, asleep)
    expect(h.controller.snapshot().projects[0].phase).toBe('connecting')
  })

  it('reuses an installed bridge without overwriting user changes', async () => {
    const p = project('existing', { bridgeInstalled: false })
    packageAt(p)
    const h = harness()
    h.controller.update([p])
    await flush()
    expect(h.install).not.toHaveBeenCalled()
    expect(h.watch).toHaveBeenCalledWith(p.path)
    expect(fs.readFileSync(path.join(p.path, 'Packages', 'com.avca.bridge', 'UserModification.cs'), 'utf8')).toBe('// preserve this')
    expect(h.controller.snapshot().projects[0].phase).toBe('connecting')
  })

  it('blocks missing installs globally but still accepts existing bridge heartbeats', async () => {
    const a = project('missing'), b = project('existing')
    packageAt(b)
    const h = harness()
    h.config.enabled = false
    h.statuses.set(b.path, { ...asleep, bridgeReady: true })
    h.controller.update([a, b])
    await flush()
    expect(h.install).not.toHaveBeenCalled()
    expect(h.controller.snapshot().projects.map((p) => p.phase)).toEqual(['disabled', 'ready'])
    expect(h.controller.snapshot().targetProjectId).toBe('existing')
  })

  it('permits one explicit retry with global automatic connection off without enabling other projects', async () => {
    const a = project('manual-off'), b = project('still-off')
    const h = harness()
    h.config.enabled = false
    h.controller.update([a, b])
    h.controller.retry(a.id)
    h.controller.retry(a.id)
    expect(h.controller.snapshot().projects[0].phase).toBe('installing')
    await flush()
    expect(h.config.enabled).toBe(false)
    expect(h.install).toHaveBeenCalledTimes(1)
    expect(h.install).toHaveBeenCalledWith(a)
    expect(h.controller.snapshot().projects.map((p) => p.phase)).toEqual(['connecting', 'disabled'])
    h.statuses.set(a.path, { ...asleep, bridgeReady: true })
    await expect(h.controller.prepare(a.id)).resolves.toMatchObject({ projectId: a.id, phase: 'ready' })
    h.controller.update([a, b])
    expect(h.install).toHaveBeenCalledTimes(1)
  })

  it('keeps an explicit retry failure visible with automatic connection off without retrying again', async () => {
    const p = project('manual-failed')
    const h = harness(() => ({ ok: false, error: 'manual attempt denied' }))
    h.config.enabled = false
    h.controller.update([p])
    h.controller.retry(p.id)
    await flush()
    h.controller.update([p])
    expect(h.install).toHaveBeenCalledTimes(1)
    expect(h.controller.snapshot().projects[0]).toMatchObject({ phase: 'failed', detail: 'manual attempt denied' })
    h.controller.retry(p.id)
    await flush()
    expect(h.install).toHaveBeenCalledTimes(2)
  })

  it.each(['close', 'remove', 'path-change', 'exclude', 'dispose'])('revokes a queued explicit retry on %s while automatic connection is off', async (condition) => {
    const p = project('manual-queued'), replacement = project('replacement')
    const h = harness()
    h.config.enabled = false
    h.controller.update([p])
    h.controller.retry(p.id)
    if (condition === 'close') h.controller.update([{ ...p, running: false }])
    if (condition === 'remove') h.controller.update([])
    if (condition === 'path-change') h.controller.update([{ ...p, path: replacement.path }])
    if (condition === 'exclude') { h.config.excludedProjectIds = [p.id]; h.controller.update([p]) }
    if (condition === 'dispose') h.controller.dispose()
    await flush()
    expect(h.install).not.toHaveBeenCalled()
    expect(fs.existsSync(path.join(p.path, 'Packages', 'com.avca.bridge'))).toBe(false)
  })

  it.each(['close', 'remove', 'exclude'])('does not resurrect a one-shot retry after %s is reversed before dispatch', async (condition) => {
    const p = project('manual-reopened')
    const h = harness()
    h.config.enabled = false
    h.controller.update([p])
    h.controller.retry(p.id)
    if (condition === 'close') h.controller.update([{ ...p, running: false }])
    if (condition === 'remove') h.controller.update([])
    if (condition === 'exclude') { h.config.excludedProjectIds = [p.id]; h.controller.update([p]) }
    h.config.excludedProjectIds = []
    h.controller.update([p])
    await flush()
    expect(h.install).not.toHaveBeenCalled()
    expect(h.controller.snapshot().projects[0].phase).toBe('disabled')
  })

  it('honors a new global disable after an explicit retry was queued while enabled', async () => {
    const p = project('manual-global-disable')
    const h = harness(() => ({ ok: false, error: 'initial failure' }))
    h.controller.update([p])
    await flush()
    h.controller.retry(p.id)
    h.config.enabled = false
    h.controller.update([p])
    await flush()
    expect(h.install).toHaveBeenCalledTimes(1)
    expect(h.controller.snapshot().projects[0].phase).toBe('disabled')
  })

  it('restores bridge watching on explicit retry after an uninstall removed its external watcher', async () => {
    const p = project('rewatch')
    packageAt(p)
    const h = harness()
    h.controller.update([p])
    expect(h.watch).toHaveBeenCalledTimes(1)
    h.config.excludedProjectIds = [p.id]
    h.controller.update([p])
    fs.rmSync(path.join(p.path, 'Packages', 'com.avca.bridge'), { recursive: true })
    h.config.excludedProjectIds = []
    h.controller.retry(p.id)
    await flush()
    expect(h.watch).toHaveBeenCalledTimes(2)
    expect(h.watch).toHaveBeenLastCalledWith(p.path)
  })

  it('honors per-project exclusion even with an existing live bridge', async () => {
    const p = project('excluded')
    packageAt(p)
    const h = harness()
    h.config.excludedProjectIds = [p.id]
    h.statuses.set(p.path, { ...asleep, bridgeReady: true })
    h.controller.update([p])
    await flush()
    expect(h.install).not.toHaveBeenCalled()
    expect(h.watch).not.toHaveBeenCalled()
    expect(h.controller.snapshot().projects[0].phase).toBe('disabled')
    expect(() => h.controller.retry(p.id)).toThrow('project.connectionDisabled')
  })

  it('retains failures across updates and performs exactly one explicit retry', async () => {
    const p = project('failure')
    const h = harness(() => ({ ok: false, error: 'EPERM: denied' }))
    h.controller.update([p])
    await flush()
    h.controller.update([p])
    expect(h.install).toHaveBeenCalledTimes(1)
    expect(h.controller.snapshot().projects[0]).toMatchObject({ phase: 'failed', detail: 'EPERM: denied', reasonKey: 'project.connectionFailed' })
    h.controller.retry(p.id)
    h.controller.retry(p.id)
    await flush()
    expect(h.install).toHaveBeenCalledTimes(2)
    h.controller.update([p])
    expect(h.install).toHaveBeenCalledTimes(2)
  })

  it('captures thrown installer errors and stops retrying on polling', async () => {
    const p = project('throws')
    const h = harness(() => { throw new Error('template missing') })
    h.controller.update([p])
    await flush()
    h.controller.update([p])
    expect(h.install).toHaveBeenCalledTimes(1)
    expect(h.controller.snapshot().projects[0]).toMatchObject({ phase: 'failed', detail: 'template missing' })
  })

  it('suppresses reinstallation after exclusion and uninstall until explicit re-enable/retry', async () => {
    const p = project('removed')
    const h = harness()
    h.controller.update([p])
    await flush()
    h.config.excludedProjectIds = [p.id]
    fs.rmSync(path.join(p.path, 'Packages', 'com.avca.bridge'), { recursive: true })
    h.controller.update([p])
    h.controller.update([p])
    expect(h.install).toHaveBeenCalledTimes(1)
    h.config.excludedProjectIds = []
    h.controller.retry(p.id)
    await flush()
    expect(h.install).toHaveBeenCalledTimes(2)
  })

  it('does not apply a late install result after a project closes', async () => {
    const p = project('closing')
    let complete!: (result: { ok: boolean; error: string | null }) => void
    const h = harness(() => new Promise((resolve) => { complete = resolve }))
    h.controller.update([p])
    await flush()
    h.controller.update([{ ...p, running: false }])
    complete({ ok: false, error: 'late failure' })
    await flush()
    expect(h.controller.snapshot().projects[0].phase).toBe('closed')
    expect(() => h.controller.retry(p.id)).toThrow('project.connectionClosed')
  })

  it.each(['close', 'exclude', 'global-off', 'dispose'])('cancels a queued install before dispatch on %s', async (condition) => {
    const p = project('queued')
    const h = harness()
    h.controller.update([p])
    if (condition === 'close') h.controller.update([{ ...p, running: false }])
    if (condition === 'exclude') h.config.excludedProjectIds = [p.id]
    if (condition === 'global-off') h.config.enabled = false
    if (condition === 'dispose') h.controller.dispose()
    await flush()
    expect(h.install).not.toHaveBeenCalled()
    expect(fs.existsSync(path.join(p.path, 'Packages', 'com.avca.bridge'))).toBe(false)
  })

  it('revalidates a Packages link introduced between scheduling and dispatch', async () => {
    const p = project('replaced')
    const outside = path.join(root, 'external')
    fs.mkdirSync(outside)
    const h = harness()
    h.controller.update([p])
    fs.rmdirSync(path.join(p.path, 'Packages'))
    fs.symlinkSync(outside, path.join(p.path, 'Packages'), 'junction')
    await flush()
    expect(h.install).not.toHaveBeenCalled()
    expect(fs.readdirSync(outside)).toEqual([])
    expect(h.controller.snapshot().projects[0].reasonKey).toBe('project.connectionUnsafe')
  })

  it('keeps attempts for an earlier project path isolated from a replacement path', async () => {
    const a = project('a'), b = project('b')
    let complete!: (result: { ok: boolean; error: string | null }) => void
    const h = harness((p) => p.path === a.path
      ? new Promise((resolve) => { complete = resolve })
      : { ok: true, error: null })
    h.controller.update([a])
    await flush()
    h.controller.update([{ ...a, path: b.path }])
    await flush()
    complete({ ok: false, error: 'old path failed' })
    await flush()
    expect(h.install).toHaveBeenCalledTimes(2)
    expect(h.controller.snapshot().projects[0]).toMatchObject({ projectPath: b.path, phase: 'connecting', detail: null })
  })

  it('does not reinstall a failed bridge on closing and reopening the same project', async () => {
    const p = project('reopened')
    const h = harness(() => ({ ok: false, error: 'denied' }))
    h.controller.update([p])
    await flush()
    h.controller.update([{ ...p, running: false }])
    h.controller.update([p])
    await flush()
    expect(h.install).toHaveBeenCalledTimes(1)
    expect(h.controller.snapshot().projects[0].phase).toBe('failed')
  })

  it('publishes changed phases without repeating unchanged snapshots', async () => {
    const p = project('published')
    const h = harness()
    h.controller.update([p])
    await flush()
    h.controller.update([p])
    const unchangedCount = h.changed.mock.calls.length
    h.controller.update([p])
    expect(h.changed).toHaveBeenCalledTimes(unchangedCount)
    h.statuses.set(p.path, { ...asleep, bridgeReady: true })
    h.controller.update([p])
    expect(h.changed.mock.calls.map(([s]) => s.projects[0].phase)).toEqual(['installing', 'connecting', 'ready'])
  })
})

describe('import target selection', () => {
  it('automatically selects exactly one eligible running project', () => {
    const h = harness()
    h.controller.update([project('one'), project('closed', { running: false })])
    expect(h.controller.snapshot()).toMatchObject({ targetProjectId: 'one', targetMode: 'auto', ambiguous: false })
  })

  it('does not turn an earlier automatic choice into a manual choice on multi-open', () => {
    const a = project('a'), b = project('b')
    const h = harness()
    h.controller.update([a])
    h.controller.update([a, b])
    expect(h.controller.snapshot()).toMatchObject({ targetProjectId: null, targetMode: 'auto', ambiguous: true })
    h.controller.select('b')
    expect(h.controller.snapshot()).toMatchObject({ targetProjectId: 'b', targetMode: 'manual', ambiguous: false })
    h.controller.update([b, a])
    expect(h.controller.snapshot().targetProjectId).toBe('b')
    h.controller.select(null)
    expect(h.controller.snapshot()).toMatchObject({ targetProjectId: null, targetMode: 'auto', ambiguous: true })
  })

  it('clears an unavailable manual choice rather than resurrecting it on reopen', () => {
    const a = project('a'), b = project('b')
    const h = harness()
    h.controller.update([a, b])
    h.controller.select('a')
    h.controller.update([{ ...a, running: false }, b])
    expect(h.controller.snapshot()).toMatchObject({ targetProjectId: 'b', targetMode: 'auto' })
    h.controller.update([a, b])
    expect(h.controller.snapshot()).toMatchObject({ targetProjectId: null, ambiguous: true })
    expect(() => h.controller.select('missing')).toThrow('project.connectionProjectMissing')
  })

  it('clears an excluded manual choice while leaving failures available for explicit retry', async () => {
    const a = project('a'), b = project('b')
    const h = harness(() => ({ ok: false, error: 'denied' }))
    h.controller.update([a, b])
    await flush()
    h.controller.select(a.id)
    h.config.excludedProjectIds = [a.id]
    h.controller.update([a, b])
    expect(h.controller.snapshot()).toMatchObject({ targetProjectId: b.id, targetMode: 'auto', ambiguous: false })
    expect(() => h.controller.select(a.id)).toThrow('project.connectionDisabled')
  })
})

describe('fixed-project connection preparation', () => {
  it('waits for a real heartbeat and keeps its project when the global choice changes', async () => {
    vi.useFakeTimers()
    const a = project('a'), b = project('b')
    const h = harness()
    h.controller.update([a, b])
    const waiting = h.controller.prepare(a.id)
    h.controller.select(b.id)
    await flush()
    h.statuses.set(a.path, { ...asleep, bridgeReady: true, isUpdating: true, busyReason: 'updating' })
    await vi.advanceTimersByTimeAsync(500)
    await expect(waiting).resolves.toMatchObject({ projectId: 'a', projectPath: a.path, phase: 'ready' })
    expect(h.controller.snapshot().targetProjectId).toBe('b')
  })

  it.each(['closed', 'excluded', 'removed', 'path-changed', 'unsupported'])('rejects a pending wait when its fixed project becomes %s', async (condition) => {
    vi.useFakeTimers()
    const a = project('a'), b = project('b')
    const h = harness()
    h.controller.update([a, b])
    const waiting = h.controller.prepare(a.id)
    const reason = condition === 'closed' ? 'Closed' : condition === 'excluded' ? 'Disabled' : condition === 'unsupported' ? 'Unsupported' : 'ProjectMissing'
    const rejected = expect(waiting).rejects.toThrow(`project.connection${reason}`)
    if (condition === 'excluded') h.config.excludedProjectIds = [a.id]
    if (condition === 'unsupported') fs.writeFileSync(path.join(a.path, 'ProjectSettings', 'ProjectVersion.txt'), 'm_EditorVersion: 6000.0.1f1')
    h.controller.update(condition === 'removed' ? [b] : [{ ...a, running: condition !== 'closed', path: condition === 'path-changed' ? b.path : a.path }, b])
    await vi.advanceTimersByTimeAsync(500)
    await rejected
  })

  it('rejects install failure immediately and does not wait for the deadline', async () => {
    const a = project('a')
    const h = harness(() => ({ ok: false, error: 'disk full' }))
    h.controller.update([a])
    const waiting = h.controller.prepare(a.id)
    await expect(waiting).rejects.toThrow('project.connectionFailed')
  })

  it('uses a bounded default 180-second wait', async () => {
    vi.useFakeTimers()
    const a = project('a')
    const h = harness()
    h.controller.update([a])
    let settled = false
    const waiting = h.controller.prepare(a.id).finally(() => { settled = true })
    const rejected = expect(waiting).rejects.toThrow('project.connectionTimeout')
    await vi.advanceTimersByTimeAsync(179_999)
    expect(settled).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    await rejected
  })

  it('honors a shorter caller deadline', async () => {
    vi.useFakeTimers()
    const a = project('a')
    const h = harness()
    h.controller.update([a])
    const rejected = expect(h.controller.prepare(a.id, { timeoutMs: 40 })).rejects.toThrow('project.connectionTimeout')
    await vi.advanceTimersByTimeAsync(40)
    await rejected
  })

  it('rejects a wait if automatic connection is switched off before a plugin is installed', async () => {
    vi.useFakeTimers()
    const p = project('toggle')
    const h = harness(() => new Promise(() => {}))
    h.controller.update([p])
    const rejected = expect(h.controller.prepare(p.id)).rejects.toThrow('project.connectionDisabled')
    await flush()
    h.config.enabled = false
    h.controller.update([p])
    await rejected
  })

  it('does not overwrite an existing plugin on explicit retry', async () => {
    const p = project('manual-existing')
    packageAt(p)
    const h = harness()
    h.controller.update([p])
    h.controller.retry(p.id)
    await flush()
    expect(h.install).not.toHaveBeenCalled()
    expect(fs.readFileSync(path.join(p.path, 'Packages', 'com.avca.bridge', 'UserModification.cs'), 'utf8')).toBe('// preserve this')
  })

  it('cancels one waiter without affecting another waiter for the same project', async () => {
    vi.useFakeTimers()
    const a = project('a')
    const h = harness()
    h.controller.update([a])
    const signal = new AbortController()
    const cancelled = expect(h.controller.prepare(a.id, { signal: signal.signal })).rejects.toThrow('project.connectionCancelled')
    const remaining = h.controller.prepare(a.id)
    signal.abort()
    await cancelled
    h.statuses.set(a.path, { ...asleep, bridgeReady: true })
    await vi.advanceTimersByTimeAsync(500)
    await expect(remaining).resolves.toMatchObject({ projectId: 'a', phase: 'ready' })
  })

  it('rejects an already-aborted preparation even for a ready project', async () => {
    const a = project('a')
    const h = harness()
    h.controller.update([a])
    h.statuses.set(a.path, { ...asleep, bridgeReady: true })
    const signal = new AbortController()
    signal.abort()
    await expect(h.controller.prepare(a.id, { signal: signal.signal })).rejects.toThrow('project.connectionCancelled')
  })

  it('terminates pending waits and ignores late install callbacks on disposal', async () => {
    const a = project('a')
    let complete!: (result: { ok: boolean; error: string | null }) => void
    const h = harness(() => new Promise((resolve) => { complete = resolve }))
    h.controller.update([a])
    await flush()
    const rejected = expect(h.controller.prepare(a.id)).rejects.toThrow('project.connectionCancelled')
    h.controller.dispose()
    await rejected
    const notifications = h.changed.mock.calls.length
    complete({ ok: true, error: null })
    await flush()
    expect(h.changed).toHaveBeenCalledTimes(notifications)
    await expect(h.controller.prepare(a.id)).rejects.toThrow('project.connectionCancelled')
  })
})
