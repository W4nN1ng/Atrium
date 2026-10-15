import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'
import { migrate, type Db } from '../../src/main/db'
import { makeAssetRow, upsertAsset } from '../../src/main/db/repos/asset'
import { saveCover } from '../../src/main/db/repos/covers'
import { buildPackageCoverSetup, assertCoverDependency } from '../../src/main/covers/dependencySetup'

let root: string, db: Db
beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'atrium-cover-dependency-')))
  db = new Database(':memory:'); migrate(db)
  upsertAsset(db, makeAssetRow({ id: 'card', name: 'Card', raw_name: 'Card', category: 'props' }))
})
afterEach(() => { db.close(); fs.rmSync(root, { recursive: true, force: true }) })

function project(id: string, ready = true): string {
  const dir = path.join(root, id)
  fs.mkdirSync(dir)
  db.prepare('INSERT INTO project(id,path,name) VALUES(?,?,?)').run(id, dir, id)
  if (ready) {
    const lil = path.join(dir, 'Packages', 'jp.lilxyzw.liltoon')
    fs.mkdirSync(path.join(lil, 'Shader'), { recursive: true })
    fs.writeFileSync(path.join(lil, 'package.json'), '{"name":"jp.lilxyzw.liltoon","version":"2.3.4"}')
    fs.writeFileSync(path.join(lil, 'Shader', 'render.shader'), 'Shader "lilToon" {}')
  }
  return path.join(dir, 'Packages', 'jp.lilxyzw.liltoon')
}
function saved(projectId: string | null, source: 'package' | 'unity' | 'image' = 'package'): void {
  saveCover(db, { assetId: 'card', coverImage: 'athumb://cover.jpg', source, projectId, target: null, options: null })
}
function option(id: string) { return buildPackageCoverSetup(db, 'card', null).dependencies.find(item => item.projectId === id) }

describe('read-only package cover dependency setup', () => {
  it('recommends the sole usable registered lilToon source with its validated version', () => {
    project('valid')
    expect(buildPackageCoverSetup(db, 'card', null)).toEqual({ dependencies: [
      { projectId: 'valid', name: 'valid', version: '2.3.4', status: 'ready' }
    ], recommendedProjectId: 'valid', reason: 'single' })
    expect(() => assertCoverDependency(db, 'valid')).not.toThrow()
  })
  it('does not choose an arbitrary project when several sources are ready', () => {
    project('alpha'); project('beta')
    expect(buildPackageCoverSetup(db, 'card', null)).toMatchObject({ recommendedProjectId: null, reason: 'none' })
  })
  it('keeps missing and unreadable sources visible but never recommends them', () => {
    project('missing', false); const bad = project('bad'); fs.writeFileSync(path.join(bad, 'package.json'), '{')
    expect(buildPackageCoverSetup(db, 'card', null)).toEqual({ dependencies: [
      { projectId: 'bad', name: 'bad', version: null, status: 'unreadable' },
      { projectId: 'missing', name: 'missing', version: null, status: 'missing' }
    ], recommendedProjectId: null, reason: 'none' })
  })
  it('gives a saved package association priority over remembered and single choices', () => {
    project('alpha'); project('beta'); saved('beta')
    expect(buildPackageCoverSetup(db, 'card', 'alpha')).toMatchObject({ recommendedProjectId: 'beta', reason: 'saved' })
  })
  it('preserves a saved no-external-dependency choice', () => {
    project('alpha'); saved(null)
    expect(buildPackageCoverSetup(db, 'card', 'alpha')).toMatchObject({ recommendedProjectId: null, reason: 'saved' })
  })
  it.each(['deleted', 'missing', 'bad', '../stale'])('preserves saved %s source to expose its problem instead of silently replacing it', id => {
    project('alpha'); project('missing', false)
    const bad = project('bad'); fs.writeFileSync(path.join(bad, 'package.json'), '{}')
    saved(id)
    expect(buildPackageCoverSetup(db, 'card', 'alpha')).toMatchObject({ recommendedProjectId: id, reason: 'saved' })
  })
  it.each(['image', 'unity'] as const)('does not treat a %s cover project as a saved package dependency', source => {
    project('alpha'); project('beta'); saved('alpha', source)
    expect(buildPackageCoverSetup(db, 'card', 'beta')).toMatchObject({ recommendedProjectId: 'beta', reason: 'remembered' })
  })
  it('honours a remembered explicit no-external-dependency choice', () => {
    project('alpha')
    expect(buildPackageCoverSetup(db, 'card', '')).toMatchObject({ recommendedProjectId: null, reason: 'remembered' })
  })
  it('honours a remembered ready source even when more than one is available', () => {
    project('alpha'); project('beta')
    expect(buildPackageCoverSetup(db, 'card', 'beta')).toMatchObject({ recommendedProjectId: 'beta', reason: 'remembered' })
  })
  it.each(['deleted', 'missing', 'bad', '../stale'])('falls back to a sole ready source after stale preference %s', remembered => {
    project('alpha'); project('missing', false)
    const bad = project('bad'); fs.writeFileSync(path.join(bad, 'package.json'), '{}')
    expect(buildPackageCoverSetup(db, 'card', remembered)).toMatchObject({ recommendedProjectId: 'alpha', reason: 'single' })
  })
  it('does not resolve a stale preference to the first of multiple ready sources', () => {
    project('alpha'); project('beta')
    expect(buildPackageCoverSetup(db, 'card', 'deleted')).toMatchObject({ recommendedProjectId: null, reason: 'none' })
  })
  it('excludes marked preview projects from options and direct preflight', () => {
    const lil = project('preview')
    fs.writeFileSync(path.join(path.dirname(path.dirname(lil)), '.atrium-cover-preview.json'), '{}')
    expect(buildPackageCoverSetup(db, 'card', null)).toEqual({ dependencies: [], recommendedProjectId: null, reason: 'none' })
    expect(() => assertCoverDependency(db, 'preview')).toThrow('covers.projectMissing')
  })
  it.each(['', '../card', 'a'.repeat(81), null, 12])('rejects malformed asset ids (%s)', id => {
    expect(() => buildPackageCoverSetup(db, id as string, null)).toThrow('covers.invalidRequest')
  })
  it('reports unknown cards and registered projects separately', () => {
    expect(() => buildPackageCoverSetup(db, 'unknown', null)).toThrow('covers.assetMissing')
    expect(() => assertCoverDependency(db, 'unknown')).toThrow('covers.projectMissing')
  })
  it.each([undefined, 12, {}, []])('rejects malformed remembered preference types (%s)', remembered => {
    expect(() => buildPackageCoverSetup(db, 'card', remembered as string)).toThrow('covers.invalidRequest')
  })
  it.each(['', '../project', 'a'.repeat(81), null, 12])('rejects malformed dependency ids (%s)', id => {
    expect(() => assertCoverDependency(db, id as string)).toThrow('covers.invalidRequest')
  })
  it('reports a missing lilToon directory before any work can begin', () => {
    project('missing', false)
    expect(() => assertCoverDependency(db, 'missing')).toThrow('covers.dependencyMissing')
  })
  it.each([
    '{', '{}', 'null', '[]',
    '{"name":"wrong.package","version":"2.3.4"}',
    '{"name":"jp.lilxyzw.liltoon","version":234}',
    '{"name":"jp.lilxyzw.liltoon","version":"latest"}',
    '{"name":"jp.lilxyzw.liltoon","version":"02.3.4"}',
    '{"name":"jp.lilxyzw.liltoon","version":"2.3.4-01"}',
    '{"name":"jp.lilxyzw.liltoon","version":"2.3.4/../../bad"}',
    '{"name":"jp.lilxyzw.liltoon","version":"' + '1'.repeat(130) + '.0.0"}',
    ' '.repeat(65536) + '{}'
  ])('rejects malformed, wrongly named, invalid-version or oversized package metadata (%#)', metadata => {
    const lil = project('bad'); fs.writeFileSync(path.join(lil, 'package.json'), metadata)
    expect(option('bad')?.status).toBe('unreadable')
    expect(() => assertCoverDependency(db, 'bad')).toThrow('covers.sourceUnreadable')
  })
  it.each(['missing', 'directory'])('rejects %s package.json metadata', kind => {
    const lil = project('bad'); const file = path.join(lil, 'package.json'); fs.unlinkSync(file)
    if (kind === 'directory') fs.mkdirSync(file)
    expect(option('bad')?.status).toBe('unreadable')
  })
  it('rejects malformed UTF-8 rather than displaying replacement characters as a version', () => {
    const lil = project('bad')
    fs.writeFileSync(path.join(lil, 'package.json'), Buffer.from([0x7b, 0xff, 0x7d]))
    expect(option('bad')?.status).toBe('unreadable')
  })
  it('accepts a package manifest exactly at the size bound and rejects one byte over it', () => {
    const lil = project('valid'), file = path.join(lil, 'package.json')
    const json = '{"name":"jp.lilxyzw.liltoon","version":"2.3.4"}'
    fs.writeFileSync(file, json.padEnd(65536, ' '))
    expect(option('valid')?.status).toBe('ready')
    fs.appendFileSync(file, ' ')
    expect(option('valid')?.status).toBe('unreadable')
  })
  it('accepts bounded semver prerelease/build metadata without normalizing it', () => {
    const lil = project('valid'); fs.writeFileSync(path.join(lil, 'package.json'), '{"name":"jp.lilxyzw.liltoon","version":"2.3.4-beta.1+build.2"}')
    expect(option('valid')).toMatchObject({ version: '2.3.4-beta.1+build.2', status: 'ready' })
  })
  it.each(['absent', 'empty', 'directory'])('requires an actual nonempty shader resource (%s)', kind => {
    const lil = project('bad'); const shader = path.join(lil, 'Shader', 'render.shader'); fs.unlinkSync(shader)
    if (kind === 'empty') fs.writeFileSync(shader, '')
    if (kind === 'directory') fs.mkdirSync(shader)
    expect(option('bad')?.status).toBe('unreadable')
    expect(() => assertCoverDependency(db, 'bad')).toThrow('covers.sourceUnreadable')
  })
  it.each(['Packages', 'package', 'package-json', 'Shader', 'shader-meta'])('rejects junctions at the %s boundary without following outside resources', kind => {
    const lil = project('bad'); const outside = path.join(root, 'outside'); fs.mkdirSync(outside)
    let linked: string
    if (kind === 'Packages') linked = path.dirname(lil)
    else if (kind === 'package') linked = lil
    else if (kind === 'package-json') linked = path.join(lil, 'package.json')
    else if (kind === 'Shader') linked = path.join(lil, 'Shader')
    else linked = path.join(lil, 'Shader', 'render.shader.meta')
    if (fs.existsSync(linked)) fs.rmSync(linked, { recursive: true })
    fs.symlinkSync(outside, linked, process.platform === 'win32' ? 'junction' : 'dir')
    expect(option('bad')?.status).toBe('unreadable')
    expect(() => assertCoverDependency(db, 'bad')).toThrow('covers.sourceUnreadable')
    expect(fs.readdirSync(outside)).toEqual([])
  })
  it('rejects project paths through a linked ancestor', () => {
    project('actual'); const linked = path.join(root, 'alias')
    fs.symlinkSync(path.join(root, 'actual'), linked, process.platform === 'win32' ? 'junction' : 'dir')
    db.prepare('UPDATE project SET path=? WHERE id=?').run(linked, 'actual')
    expect(option('actual')?.status).toBe('unreadable')
  })
  it('does not read outside bounded shader locations in otherwise unrelated project trees', () => {
    const lil = project('bad'); fs.rmSync(path.join(lil, 'Shader'), { recursive: true })
    fs.mkdirSync(path.join(root, 'bad', 'Assets', 'Unrelated'), { recursive: true })
    fs.writeFileSync(path.join(root, 'bad', 'Assets', 'Unrelated', 'only.shader'), 'Shader "Not lilToon" {}')
    expect(option('bad')?.status).toBe('unreadable')
  })
  it('rejects oversized optional shader metadata without reading it as an unbounded file', () => {
    const lil = project('bad')
    fs.writeFileSync(path.join(lil, 'Shader', 'render.shader.meta'), ' '.repeat(65537))
    expect(option('bad')?.status).toBe('unreadable')
  })
  it('does not scan unbounded shader directory entries to find a possible source', () => {
    const lil = project('bad'), dir = path.join(lil, 'Shader')
    fs.unlinkSync(path.join(dir, 'render.shader'))
    for (let index = 0; index < 513; index++) fs.writeFileSync(path.join(dir, 'a' + String(index).padStart(4, '0') + '.txt'), '')
    fs.writeFileSync(path.join(dir, 'z-render.shader'), 'Shader "lilToon" {}')
    expect(option('bad')?.status).toBe('unreadable')
  })
  it('does not change database rows, registered source bytes or file timestamps during setup or preflight', () => {
    const lil = project('valid'); project('missing', false)
    const tracked = [path.join(lil, 'package.json'), path.join(lil, 'Shader', 'render.shader')]
    const before = tracked.map(file => ({ bytes: fs.readFileSync(file), stat: fs.statSync(file) }))
    const rows = db.prepare('SELECT * FROM project').all(), changes = db.prepare('SELECT total_changes() AS n').get()
    buildPackageCoverSetup(db, 'card', null); assertCoverDependency(db, 'valid')
    expect(() => assertCoverDependency(db, 'missing')).toThrow('covers.dependencyMissing')
    expect(db.prepare('SELECT * FROM project').all()).toEqual(rows)
    expect(db.prepare('SELECT total_changes() AS n').get()).toEqual(changes)
    tracked.forEach((file, index) => {
      expect(fs.readFileSync(file)).toEqual(before[index].bytes)
      expect(fs.statSync(file).mtimeMs).toBe(before[index].stat.mtimeMs)
    })
    expect(fs.readdirSync(path.join(root, 'missing'))).toEqual([])
  })
})
