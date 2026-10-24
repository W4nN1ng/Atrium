import { app, dialog } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { IpcInvoke } from '../../../shared/ipc'
import { VpmError } from '../../../shared/vpm/errors'
import type { IpcApi } from '../../ipc/types'
import type { VpmRuntime } from '../index'
import { exportTemplate, parseTemplateFile, readVccSettings, type VccSettings } from '../interop'

export interface InteropIpcOptions {
  ipc: IpcApi
  getRuntime: () => VpmRuntime | null
}

/** VCC / ALCOM 设置文件的常见位置（只读；找到第一个存在的就用）。 */
function vccSettingsCandidates(): string[] {
  const roaming = app.getPath('appData')
  const local = app.getPath('userData')
  return [
    path.join(roaming, 'VRChatCreatorCompanion', 'settings.json'),
    path.join(roaming, 'ALCOM', 'settings.json'),
    path.join(path.dirname(local), 'VRChatCreatorCompanion', 'settings.json')
  ]
}

function peekVcc(): VccSettings & { parseError: boolean } {
  for (const candidate of vccSettingsCandidates()) {
    if (fs.existsSync(candidate)) return readVccSettings(candidate)
  }
  return {
    path: vccSettingsCandidates()[0],
    exists: false,
    repos: [],
    packageFolders: [],
    unityHint: null,
    unityArguments: [],
    skipped: [],
    parseError: false
  }
}

/**
 * 互操作（P7-D）：
 * - VCC/ALCOM 设置**只读**导入（仓库 + 本地包目录，逐个去重，绝不写回对方文件）；
 * - 模板导入（`.atriumtemplate` / `.alcomtemplate` / 任意 JSON）/ 导出。
 */
export function registerInteropIpc(options: InteropIpcOptions): void {
  const { ipc } = options
  const runtime = (): VpmRuntime => {
    const value = options.getRuntime()
    if (!value) throw new VpmError('vpmRuntimeNotReady')
    return value
  }

  ipc.handle(IpcInvoke.Vpm.InteropVccPeek, () => {
    const peeked = peekVcc()
    return {
      path: peeked.path,
      exists: peeked.exists,
      parseError: peeked.parseError,
      repos: peeked.repos,
      packageFolders: peeked.packageFolders,
      unityHint: peeked.unityHint,
      skipped: peeked.skipped
    }
  })

  ipc.handle(IpcInvoke.Vpm.InteropVccApply, async (input: unknown) => {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      throw new VpmError('vpmInternal')
    }
    const raw = input as { repos?: unknown; folders?: unknown }
    const wantRepos = raw.repos !== false
    const wantFolders = raw.folders !== false
    const peeked = peekVcc()
    if (!peeked.exists) throw new VpmError('vpmInteropNotFound', { field: 'vcc' })

    const current = runtime()
    let addedRepos = 0
    let addedFolders = 0
    const skipped: Array<{ value: string; reason: string }> = []

    if (wantRepos) {
      const existing = new Set(current.repos.listRepos().map((repo) => repo.url.toLowerCase()))
      for (const repo of peeked.repos) {
        if (existing.has(repo.url.toLowerCase())) {
          skipped.push({ value: repo.url, reason: 'duplicate' })
          continue
        }
        try {
          await current.repos.addRepo({ url: repo.url, ...(repo.name ? { name: repo.name } : {}) })
          existing.add(repo.url.toLowerCase())
          addedRepos += 1
        } catch {
          skipped.push({ value: repo.url, reason: 'failed' })
        }
      }
    }

    if (wantFolders) {
      for (const folder of peeked.packageFolders) {
        try {
          current.local.add({ path: folder })
          addedFolders += 1
        } catch (error) {
          skipped.push({
            value: folder,
            reason: (error as { params?: { reason?: string } }).params?.reason ?? 'failed'
          })
        }
      }
    }

    return { addedRepos, addedFolders, skipped }
  })

  ipc.handle(IpcInvoke.Vpm.TemplateImport, async (input: unknown) => {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      throw new VpmError('vpmTemplateInvalid', { reason: 'input' })
    }
    const raw = input as { path?: unknown }
    const file =
      typeof raw.path === 'string' && raw.path.trim()
        ? raw.path.trim()
        : (await dialog.showOpenDialog({
            title: '导入模板',
            filters: [
              { name: '模板', extensions: ['atriumtemplate', 'alcomtemplate', 'json'] },
              { name: '所有文件', extensions: ['*'] }
            ],
            properties: ['openFile']
          })).filePaths[0]
    if (!file) return { cancelled: true as const }

    let text: string
    try {
      text = fs.readFileSync(file, 'utf8')
    } catch {
      throw new VpmError('vpmTemplateInvalid', { reason: 'read' })
    }
    const parsed = parseTemplateFile(JSON.parse(text), path.basename(file, path.extname(file)))
    const entry = runtime().templates.create({
      name: parsed.manifest.name,
      description: parsed.manifest.description,
      base: parsed.manifest.base,
      unity: parsed.manifest.unity,
      dependencies: parsed.manifest.dependencies,
      unitypackages: parsed.manifest.unitypackages,
      settings: parsed.manifest.settings
    })
    return { cancelled: false as const, id: entry.id, name: entry.name, source: parsed.source }
  })

  ipc.handle(IpcInvoke.Vpm.TemplateExport, async (input: unknown) => {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      throw new VpmError('vpmTemplateInvalid', { reason: 'input' })
    }
    const raw = input as { id?: unknown }
    if (typeof raw.id !== 'string' || !raw.id.trim()) {
      throw new VpmError('vpmTemplateInvalid', { reason: 'id' })
    }
    const resolved = runtime().templates.get(raw.id.trim())
    const text = exportTemplate(resolved.manifest)
    const target = await dialog.showSaveDialog({
      title: '导出模板',
      defaultPath: `${resolved.manifest.name.replace(/[<>:"/\\|?*]+/g, '_')}.atriumtemplate`,
      filters: [{ name: 'Atrium 模板', extensions: ['atriumtemplate'] }]
    })
    if (target.canceled || !target.filePath) return { cancelled: true as const }
    fs.writeFileSync(target.filePath, text)
    return { cancelled: false as const, path: target.filePath }
  })
}
