import fs from 'node:fs'
import path from 'node:path'
import { normalizeProjectPath, type ProjectFsEntry, type ProjectReaderPort } from '../../../shared/vpm/domain/project'
import { VpmError } from '../../../shared/vpm/errors'

const MAX_READ_BYTES = 8 * 1024 * 1024

function inside(root: string, candidate: string): boolean {
  const base = root.toLowerCase()
  const target = candidate.toLowerCase()
  return target === base || target.startsWith(base + path.sep)
}

function normalizeRelative(value: string): string {
  const input = value.trim().replace(/\\/g, '/')
  if (input.startsWith('/') || /^[a-zA-Z]:/.test(input) || input.startsWith('//')) {
    throw new VpmError('vpmProjectAccessDenied', { field: 'path' })
  }
  const normalized = input.replace(/\/+$/g, '')
  if (!normalized) return ''
  if (normalized.split('/').some((part) => part === '..')) {
    throw new VpmError('vpmProjectAccessDenied', { field: 'path' })
  }
  return normalized
}

/**
 * `ProjectReaderPort` 的只读 fs 实现。
 *
 * - 构造时 realpath 工程根；所有相对路径都必须落在根内；
 * - 不跟随符号链接（symlink 条目会带 `symlink=true` 交给领域层跳过）；
 * - 只读，不创建/修改任何文件。
 */
export class ProjectFsReader implements ProjectReaderPort {
  readonly root: string

  constructor(projectPath: string) {
    let real: string
    try {
      real = fs.realpathSync.native(path.resolve(normalizeProjectPath(projectPath)))
    } catch (error) {
      throw new VpmError('vpmProjectInvalid', { field: 'path' }, error)
    }
    let stat: fs.Stats
    try {
      stat = fs.lstatSync(real)
    } catch (error) {
      throw new VpmError('vpmProjectInvalid', { field: 'path' }, error)
    }
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw new VpmError('vpmProjectInvalid', { field: 'path' })
    }
    this.root = real
  }

  read(relativePath: string): { text: string; mtime: number } | null {
    const target = this.resolve(relativePath)
    let stat: fs.Stats
    try {
      stat = fs.lstatSync(target)
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code === 'ENOENT') return null
      throw new VpmError('vpmProjectAccessDenied', { field: relativePath }, error)
    }
    if (stat.isSymbolicLink() || !stat.isFile()) {
      throw new VpmError('vpmProjectAccessDenied', { field: relativePath })
    }
    if (stat.size > MAX_READ_BYTES) {
      throw new VpmError('vpmProjectInvalid', { field: relativePath })
    }
    this.assertRealInside(target)
    try {
      return { text: fs.readFileSync(target, 'utf8'), mtime: stat.mtimeMs }
    } catch (error) {
      throw new VpmError('vpmProjectAccessDenied', { field: relativePath }, error)
    }
  }

  list(relativePath: string): ProjectFsEntry[] {
    const target = this.resolve(relativePath)
    let stat: fs.Stats
    try {
      stat = fs.lstatSync(target)
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code === 'ENOENT') return []
      throw new VpmError('vpmProjectAccessDenied', { field: relativePath }, error)
    }
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw new VpmError('vpmProjectAccessDenied', { field: relativePath })
    }
    this.assertRealInside(target)
    try {
      return fs
        .readdirSync(target, { withFileTypes: true })
        .map((entry) => ({
          name: entry.name,
          kind: entry.isDirectory() ? 'dir' : 'file',
          symlink: entry.isSymbolicLink()
        }))
    } catch (error) {
      throw new VpmError('vpmProjectAccessDenied', { field: relativePath }, error)
    }
  }

  stat(relativePath: string): ProjectFsEntry | null {
    const target = this.resolve(relativePath)
    let stat: fs.Stats
    try {
      stat = fs.lstatSync(target)
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code === 'ENOENT') return null
      throw new VpmError('vpmProjectAccessDenied', { field: relativePath }, error)
    }
    return {
      name: path.basename(target),
      kind: stat.isDirectory() ? 'dir' : 'file',
      symlink: stat.isSymbolicLink()
    }
  }

  private resolve(relativePath: string): string {
    const relative = normalizeRelative(relativePath)
    const target = path.resolve(this.root, relative)
    if (!inside(this.root, target)) {
      throw new VpmError('vpmProjectAccessDenied', { field: relativePath })
    }
    return target
  }

  private assertRealInside(target: string): void {
    let real: string
    try {
      real = fs.realpathSync.native(target)
    } catch (error) {
      throw new VpmError('vpmProjectAccessDenied', { field: target }, error)
    }
    if (!inside(this.root, real)) {
      throw new VpmError('vpmProjectAccessDenied', { field: target })
    }
  }
}
