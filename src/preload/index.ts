import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { IpcEvent, IpcInvoke } from '../shared/ipc'
import type { AApi } from '../shared/api'

/** 渲染进程能调用的通道全集 */
const ALLOWED = new Set<string>(
  Object.values(IpcInvoke).flatMap((group) => Object.values(group as Record<string, string>))
)
const ALLOWED_EVENTS = new Set<string>(Object.values(IpcEvent))

interface Envelope {
  ok: boolean
  data?: unknown
  error?: string
}

async function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  if (!ALLOWED.has(channel)) throw new Error('preload：通道不在白名单 ' + channel)
  const res = (await ipcRenderer.invoke(channel, ...args)) as Envelope
  if (res && typeof res === 'object' && 'ok' in res) {
    if (res.ok) return res.data as T
    throw new Error(res.error ?? '主进程返回了未知错误')
  }
  return res as T
}

function on(event: string, cb: (...args: unknown[]) => void): () => void {
  if (!ALLOWED_EVENTS.has(event)) throw new Error('preload：事件不在白名单 ' + event)
  const listener = (_e: Electron.IpcRendererEvent, payload: unknown): void => {
    cb(payload)
  }
  ipcRenderer.on(event, listener)
  return () => {
    ipcRenderer.removeListener(event, listener)
  }
}

const api: AApi = {
  covers: {
    packageSetup: (assetId) => invoke('covers:package-setup', assetId),
    assetRoot: (assetId) => invoke('covers:asset-root', assetId),
    packageStatus: () => invoke('covers:package-status'),
    discoverPackage: (assetId, requestId, dependencyProjectId) => invoke('covers:discover-package', assetId, requestId, dependencyProjectId),
    packageProgress: (requestId) => invoke('covers:package-progress', requestId),
    status: (assetId, projectId) => invoke('covers:status', assetId, projectId),
    targets: (projectId, query) => invoke('covers:targets', projectId, query),
    discover: (assetId, projectId, requestId) => invoke('covers:discover', assetId, projectId, requestId),
    preview: (request) => invoke('covers:preview', request),
    save: (assetId, id) => invoke('covers:save', assetId, id),
    discard: (id) => invoke('covers:discard', id),
    upload: (assetId, file) => invoke('covers:upload', assetId, file),
    restore: (assetId) => invoke('covers:restore', assetId),
    startBatch: (ids) => invoke('covers:start-batch', ids),
    batchStatus: (id) => invoke('covers:batch-status', id),
    cancelBatch: (id) => invoke('covers:cancel-batch', id),
    startTask: (request) => invoke('covers:start-task', request),
    taskStatus: (id) => invoke('covers:task-status', id),
    taskChoices: (id, assetId, offset) => invoke('covers:task-choices', id, assetId, offset),
    applyTaskChoice: (id, assetId, targetId) => invoke('covers:apply-task-choice', id, assetId, targetId),
    retryTask: (id) => invoke('covers:retry-task', id),
    cancelTask: (id) => invoke('covers:cancel-task', id),
    undoTask: (id) => invoke('covers:undo-task', id),
    upgradeBridge: (projectId) => invoke('covers:upgrade-bridge', projectId)
  },
  system: {
    nudgeFront: (on) => invoke('system:nudge-front', on),
    info: () => invoke('system:info'),
    paths: () => invoke('system:paths'),
    backupDatabase: (title) => invoke('system:backup-database', title),
    probeDirectory: (p) => invoke('system:probe-directory', p),
    pickDirectory: (opts) => invoke('system:pick-directory', opts),
    pickFiles: (opts) => invoke('system:pick-files', opts),
    reveal: (p) => invoke('system:reveal', p),
    trash: (paths) => invoke('system:trash', paths),
    openExternal: (url) => invoke('system:open-external', url),
    minimize: () => invoke('system:win-minimize'),
    toggleMaximize: () => invoke('system:win-toggle-maximize'),
    close: () => invoke('system:win-close'),
    isMaximized: () => invoke('system:win-is-maximized'),
    pathForFile: (file) => webUtils.getPathForFile(file as never),
    restart: () => invoke('system:restart')
  },
  settings: {
    getAll: () => invoke('settings:get-all'),
    set: (key, value) => invoke('settings:set', key, value),
    setMany: (patch) => invoke('settings:set-many', patch),
    reset: () => invoke('settings:reset')
  },
  vpm: {
    status: () => invoke('vpm:status'),
    enable: (dataRoot) => invoke('vpm:enable', { dataRoot }),
    disable: () => invoke('vpm:disable'),
    pickDataRoot: () => invoke('vpm:pick-data-root'),
    reposList: () => invoke('vpm:repos-list'),
    repoAdd: (input) => invoke('vpm:repo-add', input),
    repoRemove: (id) => invoke('vpm:repo-remove', id),
    repoUpdate: (input) => invoke('vpm:repo-update', input),
    repoReorder: (ids) => invoke('vpm:repo-reorder', ids),
    repoImport: (text) => invoke('vpm:repo-import', text),
    repoExport: () => invoke('vpm:repo-export'),
    repoHeaders: (id) => invoke('vpm:repo-headers', id),
    repoHeadersSet: (input) => invoke('vpm:repo-headers-set', input),
    repoHeadersClear: (id) => invoke('vpm:repo-headers-clear', id),
    repoTest: (id) => invoke('vpm:repo-test', id),
    backupCreate: (input) => invoke('vpm:backup-create', input),
    backupList: (projectKey) => invoke('vpm:backup-list', projectKey),
    backupReveal: (id) => invoke('vpm:backup-reveal', id),
    projectCopy: (input) => invoke('vpm:project-copy', input),
    projectVersionChange: (input) => invoke('vpm:project-version-change', input),
    projectMigrate: (input) => invoke('vpm:project-migrate', input),
    projectParentCheck: (path) => invoke('vpm:project-parent-check', path),
    projectScanRoot: (path) => invoke('vpm:project-scan-root', path),
    repoRefresh: (id) => invoke('vpm:repo-refresh', id),
    repoRefreshAll: () => invoke('vpm:repo-refresh-all'),
    networkStatus: () => invoke('vpm:network-status'),
    networkConsent: (allow) => invoke('vpm:network-consent', { allow }),
    catalogQuery: (query) => invoke('vpm:catalog-query', query),
    packageDetail: (name) => invoke('vpm:package-detail', name),
    packageVersions: (name) => invoke('vpm:package-versions', name),
    projectsList: () => invoke('vpm:projects-list'),
    projectDetail: (projectKey) => invoke('vpm:project-detail', projectKey),
    projectAdd: (input) => invoke('vpm:project-add', input),
    projectRemove: (projectKey) => invoke('vpm:project-remove', projectKey),
    projectTrash: (projectKey) => invoke('vpm:project-trash', projectKey),
    projectsEnsureLedgers: () => invoke('vpm:projects-ensure-ledgers'),
    projectRescan: (projectKey) => invoke('vpm:project-rescan', projectKey),
    projectOpenFolder: (projectKey) => invoke('vpm:project-open-folder', projectKey),
    planResolve: (input) => invoke('vpm:plan-resolve', input),
    planExplain: (planId, name) => invoke('vpm:plan-explain', planId, name),
    planApply: (input) => invoke('vpm:plan-apply', input),
    operationStatus: (operationId) => invoke('vpm:operation-status', operationId),
    operationCancel: (operationId) => invoke('vpm:operation-cancel', operationId),
    operationHistory: (projectKey) => invoke('vpm:operation-history', projectKey),
    operationUndo: (operationId) => invoke('vpm:operation-undo', operationId),
    projectCatalog: (projectKey) => invoke('vpm:project-catalog', projectKey),
    unityInstalls: () => invoke('vpm:unity-installs'),
    unityRefresh: () => invoke('vpm:unity-refresh'),
    projectLaunch: (input) => invoke('vpm:project-launch', input),
    projectLaunchArgs: (input) => invoke('vpm:project-launch-args', input),
    projectCreate: (input) => invoke('vpm:project-create', input),
    localRoots: () => invoke('vpm:local-roots'),
    localAdd: (input) => invoke('vpm:local-add', input),
    localRemove: (id) => invoke('vpm:local-remove', id),
    localScan: () => invoke('vpm:local-scan'),
    localInstall: (input) => invoke('vpm:local-install', input),
    logRecent: (limit) => invoke('vpm:log-recent', limit),
    usageSnapshot: () => invoke('vpm:usage'),
    cacheClear: () => invoke('vpm:cache-clear'),
    diagnosticsExport: () => invoke('vpm:diagnostics-export'),
    interopVccPeek: () => invoke('vpm:interop-vcc-peek'),
    interopVccApply: (input) => invoke('vpm:interop-vcc-apply', input),
    templateImport: (input) => invoke('vpm:template-import', input ?? {}),
    templateExport: (input) => invoke('vpm:template-export', input),
    templateList: (input) => invoke('vpm:template-list', input ?? {}),
    templateFavorite: (input) => invoke('vpm:template-favorite', input),
    templateRecent: () => invoke('vpm:template-recent'),
    templateCreate: (input) => invoke('vpm:template-create', input),
    templateUpdate: (input) => invoke('vpm:template-update', input),
    templateDuplicate: (input) => invoke('vpm:template-duplicate', input),
    templateRemoveReference: (input) => invoke('vpm:template-remove-reference', input),
    templateRestore: (input) => invoke('vpm:template-restore', input),
    settingsGet: () => invoke('vpm:settings-get'),
    settingsPatch: (patch) => invoke('vpm:settings-patch', patch),
    updateCheck: (input) => invoke('vpm:update-check', input ?? {}),
    updateDownload: () => invoke('vpm:update-download'),
    updateInstall: (input) => invoke('vpm:update-install', input)
  },
  categories: {
    list: () => invoke('categories:list'),
    save: (cfg) => invoke('categories:save', cfg)
  },
  /** M7 ⑥ · 密码库：只出状态与"能不能解开"，永不出明文 */
  secrets: {
    status: () => invoke('secrets:status'),
    list: () => invoke('secrets:list'),
    forget: (id) => invoke('secrets:forget', id)
  },
  assets: {
    list: (filter) => invoke('assets:list', filter),
    get: (id) => invoke('assets:get', id),
    detail: (id) => invoke('assets:detail', id),
    patch: (id, patch) => invoke('assets:patch', id, patch),
    rename: (id, name) => invoke('assets:rename', id, name),
    trash: (ids) => invoke('assets:trash', ids),
    stats: () => invoke('assets:stats'),
    groups: () => invoke('assets:groups'),
    reclassify: (id, category, subcategory) => invoke('assets:reclassify', id, category, subcategory),
    rearchivePlan: (id, category, subcategory) => invoke('assets:rearchive-plan', id, category, subcategory),
    rearchive: (input) => invoke('assets:rearchive', input),
    resolvePending: (id, accept) => invoke('assets:resolve-pending', id, accept),
    bundle: (id) => invoke('assets:bundle', id),
    reparent: (ids, parentId) => invoke('assets:reparent', ids, parentId),
    dissolveBundle: (id) => invoke('assets:dissolve-bundle', id),
    mergeSuggestions: () => invoke('assets:merge-suggestions'),
    mergeApply: (input) => invoke('assets:merge-apply', input),
    mergeDismiss: (head) => invoke('assets:merge-dismiss', head),
    learnScan: () => invoke('assets:learn-scan'),
    learnAdd: (tokens) => invoke('assets:learn-add', tokens),
    backfillThumbs: (budget) => invoke('assets:backfill-thumbs', budget)
  },
  collections: {
    list: () => invoke('collections:list'),
    create: (input) => invoke('collections:create', input),
    update: (id, patch) => invoke('collections:update', id, patch),
    remove: (id) => invoke('collections:remove', id),
    addAssets: (collectionId, assetIds) => invoke('collections:add-assets', collectionId, assetIds),
    removeAsset: (collectionId, assetId) => invoke('collections:remove-asset', collectionId, assetId),
    planBackfill: () => invoke('collections:plan-backfill'),
    applyBackfill: (names) => invoke('collections:apply-backfill', names)
  },
  journal: {
    list: (limit) => invoke('journal:list', limit),
    undoLast: (batchId?: string | null) => invoke('journal:undo-last', batchId ?? null)
  },
  ingest: {
    fromPaths: (paths) => invoke('ingest:from-paths', paths),
    pickAndStart: (title?: string) => invoke('ingest:pick-and-start', title),
    cancel: (jobId) => invoke('ingest:cancel', jobId),
    dismiss: (jobId) => invoke('ingest:dismiss', jobId),
    submitPassword: (jobId, password, remember) => invoke('ingest:submit-password', jobId, password, remember === true),
    queue: () => invoke('ingest:queue'),
    restoreQueue: () => invoke('ingest:restore-queue'),
    queueFile: () => invoke('ingest:queue-file'),
    commitManual: (input) => invoke('ingest:commit-manual', input),
    commitAll: (input) => invoke('ingest:commit-all', input)
  },
  unity: {
    instances: () => invoke('unity:instances'),
    status: () => invoke('unity:status'),
    listProjects: () => invoke('unity:list-projects'),
    refreshProjects: () => invoke('unity:refresh-projects'),
    setTarget: (projectId) => invoke('unity:set-target', projectId),
    connection: () => invoke('unity:connection'),
    resolveTarget: () => invoke('unity:resolve-target'),
    prepareTarget: (projectId, requestId) => invoke('unity:prepare-target', projectId, requestId),
    cancelTargetPreparation: (requestId) => invoke('unity:cancel-target-preparation', requestId),
    retryConnection: (projectId) => invoke('unity:retry-connection', projectId),
    importLogs: (assetId) => invoke('unity:import-logs', assetId),
    importHistory: (query) => invoke('unity:import-history', query),
    bridgeTemplateCheck: () => invoke('unity:bridge-template-check'),
    installBridge: (projectId) => invoke('unity:install-bridge', projectId),
    answerBridgeAsk: (projectId, choice) => invoke('unity:answer-bridge-ask', { projectId, choice }),
    /** M7 Q10：「剩下这些都不再问」= 每个工程各写一行 never，不是全局静音 */
    bridgeAskNeverRest: (exceptProjectId) => invoke('unity:bridge-ask-never-rest', { exceptProjectId }),
    /** R4 ⑦：界面启动时把主进程攒下的桥接决定取回来（广播在窗口就绪前会丢） */
    pendingBridgeAsk: () => invoke('unity:bridge-ask-pending'),
    bridgeAskDone: (projectId) => invoke('unity:bridge-ask-done', projectId),
    uninstallBridge: (projectId) => invoke('unity:uninstall-bridge', projectId),
    uninstallBridgeAll: () => invoke('unity:uninstall-bridge-all'),
    packagesOfAsset: (assetId) => invoke('unity:packages-of-asset', assetId),
    preflight: (input) => invoke('unity:preflight', input),
    importPackage: (input) => invoke('unity:import-package', input),
    importPlan: (input) => invoke('unity:import-plan', input),
    importCommit: (input) => invoke('unity:import-commit', input),
    importAbandon: (batchId) => invoke('unity:import-abandon', batchId),
    cancelBatch: (batchId) => invoke('unity:cancel-batch', batchId),
    rollbackImport: (logId) => invoke('unity:rollback-import', logId),
    rollbackBatch: (batchId) => invoke('unity:rollback-batch', batchId),
    extractUsage: () => invoke('unity:extract-usage'),
    extractClean: () => invoke('unity:extract-clean')
  },
  health: {
    scan: (opts) => invoke('health:scan', opts),
    scanRebundle: () => invoke('health:scan-rebundle'),
    applyRebundle: (dirs) => invoke('health:apply-rebundle', dirs),
    planRegroup: () => invoke('health:plan-regroup'),
    applyRegroup: (keys) => invoke('health:apply-regroup', keys),
    planRemerge: () => invoke('health:plan-remerge'),
    applyRemerge: (keys) => invoke('health:apply-remerge', keys),
    planReanalyze: () => invoke('health:plan-reanalyze'),
    applyReanalyze: (ids) => invoke('health:apply-reanalyze', ids),
    dropJunkRows: (ids) => invoke('health:drop-junk-rows', ids),
    markMissing: (ids) => invoke('health:mark-missing', ids),
    unmarkMissing: (ids) => invoke('health:unmark-missing', ids),
    dissolveOrphans: () => invoke('health:dissolve-orphans'),
    trashStrays: (paths) => invoke('health:trash-strays', paths),
    pruneThumbs: () => invoke('health:prune-thumbs'),
    rebuildIndex: () => invoke('health:rebuild-index'),
    duplicateReport: () => invoke('health:duplicates')
  },
  taxonomy: {
    learningList: () => invoke('taxonomy:learning-list'),
    learningDelete: (id) => invoke('taxonomy:learning-delete', id),
    userTerms: () => invoke('taxonomy:user-terms'),
    termAdd: (input) => invoke('taxonomy:term-add', input),
    termRemove: (term) => invoke('taxonomy:term-remove', term),
    builtinCount: () => invoke('taxonomy:builtin-count')
  },
  integration: {
    shellMenuState: () => invoke('integration:shell-menu-state'),
    shellMenuInstall: (label: string) => invoke('integration:shell-menu-install', label),
    shellMenuUninstall: () => invoke('integration:shell-menu-uninstall'),
    watcherState: () => invoke('integration:watcher-state')
  },
  on
}

contextBridge.exposeInMainWorld('a', api)
