import fs from 'node:fs'
import path from 'node:path'
import type { Db } from '../db'
import { getAsset } from '../db/repos/asset'
import { getCover } from '../db/repos/covers'
import { getProject, listProjects } from '../db/repos/unity'
import type { ProjectRow } from '../../shared/types'
import type { CoverDependencyOption, PackageCoverSetup } from '../../shared/covers'

const PACKAGE = 'jp.lilxyzw.liltoon'
const MAX_METADATA_BYTES = 64 * 1024
const MAX_SHADER_ENTRIES = 512
// Keep this read-only probe independent of worker construction and application settings.
const PREVIEW_MARKER = '.atrium-cover-preview.json'

function unreadable(): never { throw new Error('covers.sourceUnreadable') }
function validId(value: unknown): value is string { return typeof value === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(value) }
function missing(error: unknown): boolean { return (error as NodeJS.ErrnoException)?.code === 'ENOENT' }
function statOrNull(file: string): fs.Stats | null {
  try { return fs.lstatSync(file) } catch (error) { if (missing(error)) return null; throw error }
}
function safeDirectory(dir: string): void {
  // Check every ancestor as well as the leaf, including Windows junctions.
  let current = dir
  for (;;) {
    const stat = fs.lstatSync(current)
    if (!stat.isDirectory() || stat.isSymbolicLink()) unreadable()
    const parent = path.dirname(current)
    if (current === parent) break
    current = parent
  }
}
function boundedFile(file: string, max = MAX_METADATA_BYTES): Buffer {
  const before = fs.lstatSync(file)
  if (!before.isFile() || before.isSymbolicLink() || before.size === 0 || before.size > max) unreadable()
  const fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0))
  try {
    const opened = fs.fstatSync(fd)
    if (!opened.isFile() || opened.size !== before.size || opened.dev !== before.dev || opened.ino !== before.ino) unreadable()
    const bytes = Buffer.alloc(before.size + 1)
    let length = 0
    while (length < bytes.length) {
      const read = fs.readSync(fd, bytes, length, bytes.length - length, null)
      if (!read) break
      length += read
    }
    const after = fs.lstatSync(file), final = fs.fstatSync(fd)
    if (length !== before.size || after.isSymbolicLink() || after.ino !== opened.ino || after.dev !== opened.dev
      || final.size !== before.size || final.mtimeMs !== opened.mtimeMs) unreadable()
    return bytes.subarray(0, length)
  } finally { fs.closeSync(fd) }
}
function validVersion(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 128) return false
  const match = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.exec(value)
  return !!match && (!match[1] || match[1].split('.').every(part => !/^\d+$/.test(part) || part === '0' || !part.startsWith('0')))
}
function shaderPresent(lil: string): boolean {
  // Inspect only known immediate shader locations, never recurse through the source project.
  for (const dir of [path.join(lil, 'Shader'), path.join(lil, 'Shaders'), lil]) {
    const stat = statOrNull(dir)
    if (!stat) continue
    safeDirectory(dir)
    const entries = fs.opendirSync(dir)
    try {
      let entry: fs.Dirent | null, count = 0
      while ((entry = entries.readSync())) {
        if (++count > MAX_SHADER_ENTRIES) unreadable()
        if (!entry.name.toLowerCase().endsWith('.shader')) continue
        const file = path.join(dir, entry.name), shader = fs.lstatSync(file)
        if (!shader.isFile() || shader.isSymbolicLink() || shader.size === 0) unreadable()
        const fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0))
        try {
          const opened = fs.fstatSync(fd), prefix = Buffer.alloc(1)
          if (!opened.isFile() || opened.ino !== shader.ino || opened.dev !== shader.dev || fs.readSync(fd, prefix, 0, 1, 0) !== 1) unreadable()
        } finally { fs.closeSync(fd) }
        // Metadata is optional for discovery; linked, oversized or non-file metadata is never usable.
        const meta = file + '.meta'
        if (statOrNull(meta)) boundedFile(meta)
        return true
      }
    } finally { entries.closeSync() }
  }
  return false
}
function markedPreview(project: ProjectRow): boolean {
  try { return statOrNull(path.join(project.path, PREVIEW_MARKER)) !== null } catch { return false }
}
function inspect(project: ProjectRow): CoverDependencyOption {
  const option: CoverDependencyOption = { projectId: project.id, name: project.name, version: null, status: 'unreadable' }
  try {
    if (!path.isAbsolute(project.path)) return option
    safeDirectory(project.path)
    const packages = path.join(project.path, 'Packages'), lil = path.join(packages, PACKAGE)
    if (!statOrNull(packages)) return { ...option, status: 'missing' }
    safeDirectory(packages)
    if (!statOrNull(lil)) return { ...option, status: 'missing' }
    safeDirectory(lil)
    const metadata: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(boundedFile(path.join(lil, 'package.json'))))
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return option
    const data = metadata as Record<string, unknown>
    if (data.name !== PACKAGE || !validVersion(data.version) || !shaderPresent(lil)) return option
    return { ...option, version: data.version, status: 'ready' }
  } catch { return option }
}

export function buildPackageCoverSetup(db: Db, assetId: string, remembered: string | null): PackageCoverSetup {
  if (!validId(assetId) || (remembered !== null && typeof remembered !== 'string')) throw new Error('covers.invalidRequest')
  if (!getAsset(db, assetId)) throw new Error('covers.assetMissing')
  const dependencies = listProjects(db).filter(project => !markedPreview(project)).map(inspect)
  const saved = getCover(db, assetId)
  if (saved?.source === 'package') return { dependencies, recommendedProjectId: saved.projectId, reason: 'saved' }
  if (remembered === '') return { dependencies, recommendedProjectId: null, reason: 'remembered' }
  const ready = dependencies.filter(option => option.status === 'ready')
  if (ready.some(option => option.projectId === remembered)) return { dependencies, recommendedProjectId: remembered, reason: 'remembered' }
  if (ready.length === 1) return { dependencies, recommendedProjectId: ready[0].projectId, reason: 'single' }
  return { dependencies, recommendedProjectId: null, reason: 'none' }
}
export function assertCoverDependency(db: Db, projectId: string): void {
  if (!validId(projectId)) throw new Error('covers.invalidRequest')
  const project = getProject(db, projectId)
  if (!project || markedPreview(project)) throw new Error('covers.projectMissing')
  const status = inspect(project).status
  if (status === 'missing') throw new Error('covers.dependencyMissing')
  if (status !== 'ready') unreadable()
}
