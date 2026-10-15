import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'
import { migrate, type Db } from '../../src/main/db'
import { makeAssetRow, upsertAsset } from '../../src/main/db/repos/asset'
import { P, setAppPathsForTest } from '../../src/main/services/paths'
import { PackageCoverProvider } from '../../src/main/covers/packageProvider'

vi.mock('electron', () => ({ app: {}, nativeImage: {} }))
const A = 'a'.repeat(32), B = 'b'.repeat(32)
const original = { id: 'GlobalObjectId_V1-1-' + A + '-42-0', name: 'Chocolate', path: 'Assets/Chocolate.prefab', persistent: true, isScene: false, sourceGuid: A }
const PNG = Buffer.from('89504e470d0a1a0a0000000d4948445200000280000001e0', 'hex')
let root: string, db: Db, source: string, provider: PackageCoverProvider, worker: any, prepare: any, command: number
const progress = (): void => undefined
const signal = () => new AbortController().signal
beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'atrium-package-provider-')))
  setAppPathsForTest(path.join(root, 'app')); fs.mkdirSync(P.thumbs(), { recursive: true })
  source = path.join(root, 'Original.unitypackage'); fs.writeFileSync(source, 'original source')
  db = new Database(':memory:'); migrate(db)
  for (const id of ['one', 'two']) upsertAsset(db, makeAssetRow({ id, name: id, raw_name: id, category: 'props', source_path: source }))
  db.prepare('INSERT INTO project(id,path,name) VALUES(?,?,?)').run('shader', path.join(root, 'dependency'), 'Dependency')
  const shader = path.join(root, 'dependency', 'Packages', 'jp.lilxyzw.liltoon')
  fs.mkdirSync(path.join(shader, 'Shader'), { recursive: true })
  fs.writeFileSync(path.join(shader, 'package.json'), JSON.stringify({ name: 'jp.lilxyzw.liltoon', version: '2.3.4' }))
  fs.writeFileSync(path.join(shader, 'Shader', 'Preview.shader'), 'Shader "lilToon" {}')
  command = 0
  prepare = vi.fn(async (_db: Db, _id: string, destination: string) => {
    expect(fs.readdirSync(destination)).toEqual([])
    fs.writeFileSync(path.join(destination, 'Chocolate.prefab'), 'owned model')
    const stat = fs.statSync(source)
    return { guids: [A], memberPaths: { [A]: ['Original.unitypackage'] }, warnings: [], fingerprint: 'hash-one', sourceFiles: [{ path: source, size: stat.size, mtimeMs: stat.mtimeMs }] }
  })
  worker = { start: vi.fn(async () => undefined), stop: vi.fn(async () => undefined), dispose: vi.fn(),
    execute: vi.fn(async (project: string, type: string, payload: any) => {
      if (type === 'get_preview_candidates') return { ok: true, status: 'ok', data: { targets: [original], truncated: false }, commandId: 'find', error: null }
      expect(payload.targetId).toBe(original.id)
      const id = 'render-' + (++command)
      fs.mkdirSync(path.join(project, 'Temp', 'AVCABridge', 'previews'), { recursive: true })
      fs.writeFileSync(path.join(project, 'Temp', 'AVCABridge', 'previews', id + '.png'), PNG)
      return { ok: true, status: 'ok', data: { relativePath: 'previews/' + id + '.png', width: 640, height: 480, rendererCount: 1 }, commandId: id, error: null }
    }) }
  provider = new PackageCoverProvider({ db, manager: { execute: vi.fn() } as any, worker, prepare, editorPath: () => 'C:/Unity/Editor/Unity.exe' })
})
afterEach(async () => { await provider.dispose(); db.close(); fs.rmSync(root, { recursive: true, force: true }) })
const capture = (target: any) => ({ assetId: 'one', projectId: '', target, provider: 'package' as const,
  options: { direction: 'auto' as const, background: 'dark' as const }, requestId: 'preview' })

describe('package preview provider ownership and association', () => {
  it('prepares an owned empty project and returns a stable package GUID, keeping engine id private', async () => {
    const result = await provider.discover('one', 'find', undefined, signal(), progress)
    expect(result.targets[0]).toEqual({ ...original, id: 'package:' + A, memberPaths: ['Original.unitypackage'] })
    const project = worker.start.mock.calls[0][0]
    expect(project.startsWith(path.join(P.root(), 'cover-previews') + path.sep)).toBe(true)
    expect(JSON.parse(fs.readFileSync(path.join(project, '.atrium-cover-preview.json'), 'utf8')).kind).toBe('atrium-package-preview')
    expect(db.prepare('SELECT COUNT(*) AS n FROM project').get()).toEqual({ n: 1 })
    expect(db.prepare('SELECT COUNT(*) AS n FROM import_log').get()).toEqual({ n: 0 })
    expect(fs.readFileSync(source, 'utf8')).toBe('original source')
  })
  it('reuses the prepared same source and validates/cleans actual private preview output', async () => {
    const found = await provider.discover('one', 'find', undefined, signal(), progress)
    const rendered = await provider.preview(capture(found.targets[0]), signal(), progress)
    expect(rendered.bytes).toEqual(PNG); expect(rendered.fingerprint).toBe('hash-one')
    expect(prepare).toHaveBeenCalledTimes(1)
    expect(fs.readdirSync(path.join(worker.start.mock.calls[0][0], 'Temp', 'AVCABridge', 'previews'))).toEqual([])
  })
  it('rebuilds association from GUID alone after a fresh provider is constructed', async () => {
    const result = await provider.preview(capture({ ...original, id: 'package:' + A }), signal(), progress)
    expect(result.bytes).toEqual(PNG); expect(prepare).toHaveBeenCalledTimes(1)
  })
  it('rejects an unrequested bridge GUID instead of showing a different card object', async () => {
    worker.execute.mockResolvedValueOnce({ ok: true, data: { targets: [{ ...original, sourceGuid: B }], truncated: false } })
    await expect(provider.discover('one', 'find', undefined, signal(), progress)).rejects.toThrow('covers.invalidRequest')
  })
  it('does not render a target whose GUID is absent from the original source', async () => {
    await expect(provider.preview(capture({ ...original, id: 'package:' + B, sourceGuid: B }), signal(), progress)).rejects.toThrow('covers.targetMissing')
    expect(worker.execute.mock.calls.map((call: any[]) => call[1])).not.toContain('render_preview')
  })
  it('rejects output paths that do not belong to the exact render command', async () => {
    const found = await provider.discover('one', 'find', undefined, signal(), progress)
    worker.execute.mockResolvedValueOnce({ ok: true, commandId: 'render', data: { relativePath: '../outside.png', width: 640, height: 480, rendererCount: 1 } })
    await expect(provider.preview(capture(found.targets[0]), signal(), progress)).rejects.toThrow('covers.invalidImage')
  })
  it('refuses saving a fingerprint after the source file content changed', async () => {
    await provider.discover('one', 'find', undefined, signal(), progress)
    expect(() => provider.assertCurrent('one', 'hash-one')).not.toThrow()
    fs.appendFileSync(source, ' changed')
    expect(() => provider.assertCurrent('one', 'hash-one')).toThrow('covers.sourceChanged')
  })
  it('reprepares a changed original rather than using stale imported data', async () => {
    await provider.discover('one', 'find', undefined, signal(), progress)
    fs.appendFileSync(source, ' changed')
    await provider.discover('one', 'find-new', undefined, signal(), progress)
    expect(prepare).toHaveBeenCalledTimes(2)
  })
  it('refuses caller-provided dependency projects not registered in the database', async () => {
    await expect(provider.discover('one', 'find', 'unknown', signal(), progress)).rejects.toThrow('covers.projectMissing')
    expect(prepare).not.toHaveBeenCalled()
  })
  it('records dependency choice in captures so restart/batch can recreate materials', async () => {
    const found = await provider.discover('one', 'find', 'shader', signal(), progress)
    const rendered = await provider.preview({ ...capture(found.targets[0]), dependencyProjectId: 'shader' }, signal(), progress)
    expect(rendered.dependencyProjectId).toBe('shader')
  })
  it('rejects a registered dependency that disappeared before preparing or starting Unity', async () => {
    fs.renameSync(path.join(root, 'dependency', 'Packages', 'jp.lilxyzw.liltoon'), path.join(root, 'dependency', 'Packages', 'moved'))
    await expect(provider.discover('one', 'find', 'shader', signal(), progress)).rejects.toThrow('covers.dependencyMissing')
    expect(prepare).not.toHaveBeenCalled(); expect(worker.start).not.toHaveBeenCalled()
  })
  it('does not keep successful late preparation after cancellation', async () => {
    const controller = new AbortController()
    prepare.mockImplementationOnce(async () => { controller.abort(); return { guids: [A], memberPaths: {}, warnings: [], fingerprint: 'late', sourceFiles: [] } })
    await expect(provider.discover('one', 'find', undefined, controller.signal, progress)).rejects.toThrow('covers.cancelled')
    expect(worker.start).not.toHaveBeenCalled()
    expect(fs.readdirSync(path.join(P.root(), 'cover-previews'))).toEqual([])
  })
  it('removes successful cached projects only after its worker stops on disposal', async () => {
    await provider.discover('one', 'find', undefined, signal(), progress)
    const project = worker.start.mock.calls[0][0]
    let stopped = false
    worker.stop.mockImplementationOnce(async () => { expect(fs.existsSync(project)).toBe(true); stopped = true })
    await provider.dispose()
    expect(stopped).toBe(true)
    expect(fs.existsSync(project)).toBe(false)
  })
  it('prunes owned cache left by a prior app session before creating another project', async () => {
    await provider.discover('one', 'find', undefined, signal(), progress)
    const abandoned = worker.start.mock.calls[0][0]
    const replacement = new PackageCoverProvider({ db, manager: { execute: vi.fn() } as any, worker, prepare, editorPath: () => '' })
    await replacement.discover('two', 'new-session', undefined, signal(), progress)
    expect(fs.existsSync(abandoned)).toBe(false)
    expect(fs.readdirSync(path.join(P.root(), 'cover-previews'))).toHaveLength(1)
    await replacement.dispose()
  })
  it('preserves marked cache with a live Unity heartbeat and unmarked directories', async () => {
    await provider.discover('one', 'find', undefined, signal(), progress)
    const active = worker.start.mock.calls[0][0]
    fs.mkdirSync(path.join(active, 'Temp', 'AVCABridge'), { recursive: true })
    fs.writeFileSync(path.join(active, 'Temp', 'AVCABridge', 'bridge.json'), JSON.stringify({ pid: process.pid, projectPath: active }))
    const foreign = path.join(P.root(), 'cover-previews', 'job-' + 'z'.repeat(26))
    fs.mkdirSync(foreign); fs.writeFileSync(path.join(foreign, 'keep.txt'), 'user data')
    const replacement = new PackageCoverProvider({ db, manager: { execute: vi.fn() } as any, worker, prepare, editorPath: () => '' })
    await replacement.discover('two', 'new-session', undefined, signal(), progress)
    expect(fs.existsSync(active)).toBe(true)
    expect(fs.readFileSync(path.join(foreign, 'keep.txt'), 'utf8')).toBe('user data')
    await replacement.dispose()
  })
  it('preserves a starting worker before its first bridge heartbeat after an app restart', async () => {
    await provider.discover('one', 'find', undefined, signal(), progress)
    const active = worker.start.mock.calls[0][0]
    fs.mkdirSync(path.join(active, 'Temp', 'AVCABridge'), { recursive: true })
    fs.writeFileSync(path.join(active, 'Temp', 'AVCABridge', 'package-worker-owner.json'), JSON.stringify({ pid: process.pid, projectPath: active, parentPid: process.pid }))
    const replacement = new PackageCoverProvider({ db, manager: { execute: vi.fn() } as any, worker, prepare, editorPath: () => '' })
    await replacement.discover('two', 'new-session', undefined, signal(), progress)
    expect(fs.existsSync(active)).toBe(true)
    await replacement.dispose()
  })
})
