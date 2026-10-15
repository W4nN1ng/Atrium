import fs from 'node:fs'
import path from 'node:path'
import type { Db } from '../db'
import type { IpcRegistrar } from '../ipc/types'
import type { BridgeManager } from '../bridge/manager'
import { getProject } from '../db/repos/unity'
import { bridgeTemplateRoot } from '../services/paths'
import { installBridge } from '../bridge/installer'
import { CoverService } from './service'
import { PackageCoverProvider } from './packageProvider'
import { getSettings, setSettings } from '../services/settings'
import { buildPackageCoverSetup } from './dependencySetup'
import type { CoverRequest } from '../../shared/covers'

export function registerCoverIpc(db: Db, manager: BridgeManager, registrar: IpcRegistrar): CoverService {
  const packageProvider = new PackageCoverProvider({ db, manager, editorPath: () => getSettings().unityExePath })
  const service = new CoverService({ db, manager, packageProvider,
    packageSaved: projectId => { setSettings({ coverDependencyProjectId: projectId ?? '' }) },
    changed: assetId => registrar.broadcast('data:changed', { reason: 'cover', assetId }) })
  const ipc = registrar.ipc
  ipc.handle('covers:package-setup', (assetId: string) => buildPackageCoverSetup(db, assetId, getSettings().coverDependencyProjectId))
  ipc.handle('covers:package-status', () => service.packageStatus())
  ipc.handle('covers:discover-package', (assetId: string, requestId: string, dependencyProjectId?: string) => service.discoverPackage(assetId, requestId, dependencyProjectId))
  ipc.handle('covers:package-progress', (id: string) => service.packageProgress(id))
  ipc.handle('covers:status', (assetId: string, projectId: string) => service.status(assetId, projectId))
  ipc.handle('covers:targets', (projectId: string, query: string) => service.targets(projectId, query))
  ipc.handle('covers:discover', (assetId: string, projectId: string, requestId: string) => service.discover(assetId, projectId, requestId))
  ipc.handle('covers:preview', (request: CoverRequest) => service.preview(request))
  ipc.handle('covers:save', (assetId: string, id: string) => service.save(assetId, id))
  ipc.handle('covers:discard', (id: string) => service.discard(id))
  ipc.handle('covers:upload', (assetId: string, file: string) => service.upload(assetId, file))
  ipc.handle('covers:restore', (assetId: string) => service.restore(assetId))
  ipc.handle('covers:start-batch', (ids: string[]) => service.startBatch(ids))
  ipc.handle('covers:batch-status', (id: string) => service.batchStatus(id))
  ipc.handle('covers:cancel-batch', (id: string) => service.cancelBatch(id))
  ipc.handle('covers:upgrade-bridge', (projectId: string) => {
    const project = getProject(db, projectId)
    if (!project) throw new Error('covers.projectMissing')
    const template = bridgeTemplateRoot()
    if (!fs.existsSync(path.join(template, 'Editor', 'AVCAPreview.cs'))) throw new Error('covers.bridgeUpgradeFailed')
    const result = installBridge(db, project.path, template, { force: true })
    if (!result.ok) throw new Error(('covers.bridgeUpgradeFailed\n' + (result.error ?? '')).slice(0, 4000))
    return result
  })
  return service
}
