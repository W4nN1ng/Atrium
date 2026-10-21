import Database from 'better-sqlite3'
import fs from 'node:fs'
import path from 'node:path'
import { VpmError } from '../../../shared/vpm/errors'
import type { VpmDb } from './types'

function stamp(date: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0')
  return (
    String(date.getFullYear()) +
    pad(date.getMonth() + 1) +
    pad(date.getDate()) +
    '-' +
    pad(date.getHours()) +
    pad(date.getMinutes()) +
    pad(date.getSeconds())
  )
}

function uniqueBackupPath(dir: string, fromVersion: number, date: Date): string {
  const base = `vpm.db.bak-v${fromVersion}-${stamp(date)}`
  for (let i = 0; i < 100; i++) {
    const file = path.join(dir, i === 0 ? base : `${base}-${i}`)
    if (!fs.existsSync(file)) return file
  }
  throw new VpmError('vpmDbBackupFailed')
}

/**
 * 迁移前备份并校验。
 *
 * 用 better-sqlite3 的 `backup()`（会处理 WAL），不用 fs.copyFile；
 * 备份后只读打开，检查 integrity_check 和 user_version，确认不是半个文件。
 * 失败时删掉本次生成的坏备份（不碰用户旧文件）并抛 `vpmDbBackupFailed`。
 */
export async function backupVpmDb(
  db: VpmDb,
  fromVersion: number,
  backupsDir: string,
  now: () => Date = () => new Date()
): Promise<string> {
  let dir: string
  try {
    fs.mkdirSync(backupsDir, { recursive: true })
    dir = backupsDir
  } catch (error) {
    throw new VpmError('vpmDbBackupFailed', undefined, error)
  }

  const file = uniqueBackupPath(dir, fromVersion, now())
  try {
    await db.backup(file)
  } catch (error) {
    try {
      fs.rmSync(file, { force: true })
    } catch {
      /* 备份没写成时本来就没有完整文件 */
    }
    throw new VpmError('vpmDbBackupFailed', undefined, error)
  }

  try {
    const check = new Database(file, { readonly: true, fileMustExist: true })
    try {
      const integrity = check.pragma('integrity_check', { simple: true })
      const version = Number(check.pragma('user_version', { simple: true }))
      if (integrity !== 'ok' || version !== fromVersion) {
        throw new Error(`backup integrity=${String(integrity)} version=${version}`)
      }
    } finally {
      check.close()
    }
    return file
  } catch (error) {
    try {
      fs.rmSync(file, { force: true })
    } catch {
      /* ignore */
    }
    throw new VpmError('vpmDbBackupFailed', undefined, error)
  }
}
