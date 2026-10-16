import fs from 'node:fs'
import path from 'node:path'
import type { Db } from '../db'
import type { IpcRegistrar } from '../ipc/types'
import type { BridgeManager } from '../bridge/manager'
import { getProject } from '../db/repos/unity'
import { bridgeTemplateRoot } from '../services/paths'
import { installBridge } from '../bridge/installer'
import { CoverService } from './service'
import { CoverTasks } from './tasks'
import { PackageCoverProvider } from './packageProvider'
import { getSettings, setSettings } from '../services/settings'
import { buildPackageCoverSetup } from './dependencySetup'
import { assetRootDirectory } from './assetRoot'
import type { CoverRequest } from '../../shared/covers'
import type { CoverTaskRequest } from '../../shared/coverTasks'

export function registerCoverIpc(db: Db, manager: BridgeManager, registrar: IpcRegistrar): CoverService {
  const packageProvider = new PackageCoverProvider({ db, manager, editorPath: () => getSettings().unityExePath })
  let tasks: CoverTasks | undefined
  const service = new CoverService({ db, manager, packageProvider,
    onDispose: () => tasks?.dispose(),
    packageSaved: projectId => { setSettings({ coverDependencyProjectId: projectId ?? '' }) },
    changed: assetId => registrar.broadcast('data:changed', { reason: 'cover', assetId }) })
  tasks = new CoverTasks({ db, service,
    setup: assetId => buildPackageCoverSetup(db, assetId, getSettings().coverDependencyProjectId),
    changed: assetId => registrar.broadcast('data:changed', { reason: 'cover', assetId }) })
  const taskService = tasks
  const ipc = registrar.ipc
  ipc.handle('covers:package-setup', (assetId: string) => buildPackageCoverSetup(db, assetId, getSettings().coverDependencyProjectId))
  /**
   * 这个素材在磁盘上的根目录 —— 给「选择本地图片」的文件对话框当 `defaultPath` 用。
   *
   * 没有它的话对话框会沿用上一次的目录（Windows 的行为），
   * 用户在一个合集里连续给多个素材设封面时，每次都要自己翻回去（2026-10-15 报的 bug）。
   * 路径不存在时回 `null`，由界面决定回退（不传 `defaultPath` 就是系统默认行为）。
   */
  ipc.handle('covers:asset-root', (assetId: string) => assetRootDirectory(db, assetId))
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
  ipc.handle('covers:start-task', (request: CoverTaskRequest) => taskService.start(request))
  ipc.handle('covers:task-status', (id?: string) => taskService.status(id))
  ipc.handle('covers:task-choices', (id: string, assetId: string, offset?: number) => taskService.choices(id, assetId, offset))
  ipc.handle('covers:apply-task-choice', (id: string, assetId: string, targetId: string) => taskService.apply(id, assetId, targetId))
  ipc.handle('covers:retry-task', (id: string) => taskService.retry(id))
  ipc.handle('covers:cancel-task', (id: string) => taskService.cancel(id))
  ipc.handle('covers:undo-task', (id: string) => taskService.undo(id))
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
