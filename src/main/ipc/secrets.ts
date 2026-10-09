/**
 * M7 ⑥ · 密码库的三条 IPC（规格 01§安全那条的"能看见、能删掉"那一半）。
 *
 * ⚠ 这里**没有任何一条会把明文递回渲染层**：`secrets:list` 走的是 `listRemembered()`，
 * 那份结构里只有文件名、路径、用的哪套加密、以及"现在解不解得开"。
 * 渲染层拿到 id 就能删，拿不到密码 —— 这是刻意的边界（`contextIsolation` 那套规矩的延伸）。
 */
import type { IpcRegistrar } from './types'
import { getDb } from '../db'
import { forgetRemembered, listRemembered, vaultAvailable } from '../services/secrets'

export function registerSecrets(registrar: IpcRegistrar): void {
  /** 这台机器现在能不能加密（false 时界面要老实说"存不了"，而不是勾了没反应） */
  registrar.ipc.handle('secrets:status', () => ({ available: vaultAvailable() }))

  registrar.ipc.handle('secrets:list', () => listRemembered(getDb()))

  registrar.ipc.handle('secrets:forget', (id: unknown) => {
    const n = Number(id)
    if (!Number.isFinite(n) || n <= 0) throw new Error('参数无效')
    return { ok: forgetRemembered(getDb(), n) }
  })
}
