import fs from 'node:fs'
import path from 'node:path'

export interface BackupSaved { guid: string; assetPath: string; file: string }
export interface BackupManifest { projectPath: string; saved: BackupSaved[]; missing: string[] }

/** Missing, corrupt or unsafe manifests cannot be used to restore project files. */
export function readBackupManifest(dir: string): BackupManifest | null {
  try {
    const data = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8')) as BackupManifest
    if (!data || typeof data.projectPath !== 'string' || !Array.isArray(data.saved) || !Array.isArray(data.missing)) return null
    if (!data.missing.every(s => typeof s === 'string')) return null
    if (!data.saved.every(s => s && typeof s.guid === 'string' && typeof s.file === 'string' &&
      s.file.length > 0 && !/[\\/]/.test(s.file) && s.file !== '.' && s.file !== '..' &&
      typeof s.assetPath === 'string' && /^Assets\//i.test(s.assetPath) &&
      !s.assetPath.split(/[\\/]/).some(part => part === '..' || part === '.'))) return null
    return data
  } catch { return null }
}
