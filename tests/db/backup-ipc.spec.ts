import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'
import { openDatabase, closeDatabase } from '../../src/main/db'
import { P, setAppPathsForTest } from '../../src/main/services/paths'
import { registerSystem } from '../../src/main/ipc/system'

const { save } = vi.hoisted(() => ({ save: vi.fn() }))
vi.mock('electron', () => ({
  app: { commandLine: { hasSwitch: () => false }, getPath: () => process.env.TEMP },
  dialog: { showSaveDialog: save }, BrowserWindow: {}, shell: {}
}))
let root: string
let handler: (title?: string) => Promise<{ cancelled: boolean; path: string | null; bytes: number }>
beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'atrium-backup-ipc-')))
  setAppPathsForTest(root)
  const db = openDatabase(P.db())
  db.exec("CREATE TABLE test_note(value TEXT); INSERT INTO test_note VALUES ('visible in backup')")
  save.mockReset()
  registerSystem({ handle(channel, fn) { if (channel === 'system:backup-database') handler = fn as unknown as typeof handler } }, () => null, () => true)
})
afterEach(() => { closeDatabase(); fs.rmSync(root, { recursive: true, force: true }) })

describe('database backup save flow', () => {
  it('cancel creates no file and leaves the live database usable', async () => {
    const files = fs.readdirSync(root)
    save.mockResolvedValue({ canceled: true })
    expect(await handler()).toEqual({ cancelled: true, path: null, bytes: 0 })
    expect(fs.readdirSync(root)).toEqual(files)
  })
  it('writes a readable full database to the selected file and rejects selecting the live file', async () => {
    const dest = path.join(root, 'chosen.db')
    save.mockResolvedValueOnce({ canceled: false, filePath: dest })
    expect(await handler('Save backup')).toMatchObject({ cancelled: false, path: dest, bytes: expect.any(Number) })
    const snapshot = new Database(dest, { readonly: true })
    try { expect(snapshot.prepare('SELECT value FROM test_note').get()).toEqual({ value: 'visible in backup' }) }
    finally { snapshot.close() }
    save.mockResolvedValueOnce({ canceled: false, filePath: P.db() })
    await expect(handler()).rejects.toThrow('i18n:settings.backupProtectLiveDatabase')
  })
  it('prevents duplicate dialogs while the first save flow is pending, then allows a later backup', async () => {
    let finish!: (value: { canceled: boolean }) => void
    save.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const first = handler()
    await expect(handler()).rejects.toThrow('i18n:settings.backupBusy')
    finish({ canceled: true })
    await first
    save.mockResolvedValueOnce({ canceled: true })
    expect((await handler()).cancelled).toBe(true)
  })
})
