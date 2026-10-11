import fs from 'node:fs'
import path from 'node:path'
import { backupTo, type Db } from './index'

const SIDECARS = ['', '-wal', '-shm', '-journal']

class BackupError extends Error {
  constructor(key: 'backupProtectLiveDatabase' | 'backupInvalidTarget' | 'backupFailed' | 'backupTargetJournal', cause?: unknown) {
    super(`i18n:settings.${key}`, { cause })
  }
}

function pathKey(file: string): string {
  const resolved = path.resolve(file)
  if (process.platform !== 'win32') return resolved
  // Windows accepts case, extended-path and trailing-dot/space aliases. Compare
  // absent sidecars too, since realpath cannot resolve a journal that is not there.
  return resolved
    .replace(/^\\\\\?\\UNC\\/i, '\\\\')
    .replace(/^\\\\\?\\/, '')
    .split(path.sep)
    .map((part) => part.replace(/[. ]+$/, ''))
    .join(path.sep)
    .toLowerCase()
}

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException)?.code === 'ENOENT'
}

async function canonicalPath(file: string): Promise<string> {
  try {
    return await fs.promises.realpath(file)
  } catch (error) {
    if (!isMissing(error)) throw error
    return path.join(await fs.promises.realpath(path.dirname(file)), path.basename(file))
  }
}

async function statIfPresent(file: string): Promise<fs.BigIntStats | undefined> {
  try {
    return await fs.promises.stat(file, { bigint: true })
  } catch (error) {
    if (!isMissing(error)) throw error
    return undefined
  }
}

async function protectedPaths(db: Db, sourceFile: string): Promise<string[]> {
  const files = new Set<string>()
  const sources = new Set([path.resolve(sourceFile)])
  if (db.name && db.name !== ':memory:') sources.add(path.resolve(db.name))
  for (const source of sources) {
    const canonicalSource = await canonicalPath(source)
    for (const base of [source, canonicalSource]) {
      for (const suffix of SIDECARS) files.add(`${base}${suffix}`)
    }
  }
  return [...files]
}

async function assertSafeDestination(destination: string, protectedFiles: string[]): Promise<void> {
  const keys = new Set([pathKey(destination), pathKey(await canonicalPath(destination))])
  const destinationStat = await statIfPresent(destination)
  for (const file of protectedFiles) {
    if (keys.has(pathKey(file)) || keys.has(pathKey(await canonicalPath(file)))) {
      throw new BackupError('backupProtectLiveDatabase')
    }
    const sourceStat = await statIfPresent(file)
    if (
      destinationStat && sourceStat && sourceStat.ino !== 0n &&
      destinationStat.dev === sourceStat.dev && destinationStat.ino === sourceStat.ino
    ) {
      throw new BackupError('backupProtectLiveDatabase')
    }
  }
  if (destinationStat && !destinationStat.isFile()) throw new BackupError('backupInvalidTarget')
  // Replacing only the main file could replay an old destination WAL into the
  // new snapshot. Never remove journals belonging to another (possibly open) DB.
  for (const suffix of SIDECARS.slice(1)) {
    try {
      await fs.promises.lstat(`${destination}${suffix}`)
      throw new BackupError('backupTargetJournal')
    } catch (error) { if (!isMissing(error)) throw error }
  }
  // A dangling symlink is not an absent destination chosen in the save dialog.
  if (!destinationStat) {
    try {
      await fs.promises.lstat(destination)
      throw new BackupError('backupInvalidTarget')
    } catch (error) {
      if (!isMissing(error)) throw error
    }
  }
}

/** A standalone SQLite snapshot; material files stay in the library. */
export async function createDatabaseBackup(
  db: Db,
  sourceFile: string,
  destFile: string
): Promise<{ path: string; bytes: number }> {
  if (!destFile.trim() || destFile.includes('\0')) throw new BackupError('backupInvalidTarget')
  const destination = path.resolve(destFile)
  // Reject NTFS alternate data streams rather than writing into another file.
  if (process.platform === 'win32' && path.basename(destination).includes(':')) {
    throw new BackupError('backupInvalidTarget')
  }

  let stagingDirectory: string | undefined
  try {
    let parent: string
    try {
      parent = await fs.promises.realpath(path.dirname(destination))
      if (!(await fs.promises.stat(parent)).isDirectory()) throw new Error('Not a directory')
    } catch (error) {
      throw new BackupError('backupInvalidTarget', error)
    }
    const publishedPath = path.join(parent, path.basename(destination))
    const protectedFiles = await protectedPaths(db, sourceFile)
    await assertSafeDestination(destination, protectedFiles)
    await assertSafeDestination(publishedPath, protectedFiles)

    stagingDirectory = await fs.promises.mkdtemp(path.join(parent, '.atrium-db-backup-'))
    const snapshot = path.join(stagingDirectory, 'snapshot.db')
    await backupTo(db, snapshot)
    const bytes = (await fs.promises.stat(snapshot)).size

    // The backup yields to the event loop. Recheck aliases before publishing.
    await assertSafeDestination(destination, protectedFiles)
    await assertSafeDestination(publishedPath, protectedFiles)
    // Same-volume rename replaces an existing regular file on Windows too. Never
    // unlink the old backup first: a locked target must survive a failed rename.
    await fs.promises.rename(snapshot, publishedPath)
    return { path: publishedPath, bytes }
  } catch (error) {
    if (error instanceof BackupError) throw error
    throw new BackupError('backupFailed', error)
  } finally {
    if (stagingDirectory) {
      await fs.promises.rm(stagingDirectory, { recursive: true, force: true, maxRetries: 3 })
        .catch(() => undefined)
    }
  }
}
