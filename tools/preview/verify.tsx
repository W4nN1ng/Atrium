import React from 'react'
import { createRoot } from 'react-dom/client'
import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import zh from '../../src/renderer/i18n/zh-CN.json'
import { VpmProjectsSection } from '../../src/renderer/vpm/components/projects/VpmProjectsSection'

/**
 * 自验页：挂真实的 `VpmProjectsSection`，只把 `window.a.vpm` 换成内存实现。
 * 用来在没有人工点击的情况下验证 R17（删除进回收站）与 R18（列表显示全部工程）。
 */

const now = Date.now()

function project(name: string, path: string, hasLedger: boolean) {
  return {
    projectKey: path.toLowerCase(),
    coreId: `core-${name}`,
    path,
    name,
    unityVersion: '2022.3.22f1',
    running: name === '22' || name === 'Lime',
    detectedBy: [],
    bridgeVersion: null,
    busyReason: null,
    linked: true,
    hasLedger,
    lastScanAt: now,
    packageCount: 0,
    legacyCount: 0,
    hasVpmManifest: true,
    manifestHash: null,
    manifestMtime: null,
    unityExePath: null,
    unityArgsJson: null
  }
}

const items = [
  project('22', 'E:\\AtriumProject\\22', true),
  project('a', 'E:\\AtriumProject\\a', true),
  project('Lime', 'E:\\ALCOMprojects\\Lime', false)
]

const log: string[] = []
;(window as unknown as { __log: string[] }).__log = log

const vpm = {
  status: async () => ({
    enabled: true,
    safeMode: false,
    degraded: false,
    dataRoot: 'E:\\ALCOMprojects',
    dataRootValid: true,
    legacyGuard: null,
    backupPath: null,
    appVersion: '0.9.0'
  }),
  // 返回副本：这样"主进程改了但渲染层没刷新"才会暴露出来（R18/R17 的回归点）。
  projectsList: async () => items.map((item) => ({ ...item })),
  projectsEnsureLedgers: async () => {
    log.push('ensureLedgers')
    // 模拟补建：把没有台账的那个变成有台账
    const target = items.find((item) => !item.hasLedger)
    if (target) target.hasLedger = true
    return { created: 1, failed: [] }
  },
  projectDetail: async (key: string) => {
    const item = items.find((entry) => entry.projectKey === key)
    return {
      ...item,
      packages: [],
      warnings: [],
      legacy: { readOnly: true, truncated: false, candidates: [] }
    }
  },
  projectAdd: async (input: { path: string }) => {
    log.push(`add:${input.path}`)
    const next = project(input.path.split('\\').pop() ?? 'new', input.path, true)
    items.push(next)
    return next
  },
  projectRemove: async (key: string) => {
    log.push(`remove:${key}`)
    return { ok: true }
  },
  projectTrash: async (key: string) => {
    log.push(`trash:${key}`)
    const index = items.findIndex((entry) => entry.projectKey === key)
    if (index >= 0) items.splice(index, 1)
    return { ok: true }
  },
  projectRescan: async (key: string) => {
    log.push(`rescan:${key}`)
    return items.find((entry) => entry.projectKey === key)
  },
  projectOpenFolder: async (key: string) => {
    log.push(`openFolder:${key}`)
  },
  projectLaunch: async (input: { projectKey: string }) => {
    log.push(`launch:${input.projectKey}`)
    return { status: 'launched', exePath: 'x', version: '2022.3.22f1', args: [], pid: 1, verified: true }
  },
  projectScanRoot: async (root: string) => {
    log.push(`scan:${root}`)
    return { root, candidates: [] }
  },
  projectParentCheck: async (path: string) => ({ parent: path, adjustedFrom: null }),
  unityInstalls: async () => [],
  unityRefresh: async () => [],
  backupList: async () => [],
  backupCreate: async () => ({}),
  backupReveal: async () => ({ ok: true }),
  projectCopy: async () => ({ projectPath: '', files: 0, bytes: 0 }),
  projectVersionChange: async () => ({
    previous: '',
    next: '',
    downgrade: false,
    backupId: null,
    backupSkipped: true
  }),
  projectMigrate: async () => ({ backupId: null, installed: [], skipped: [], failed: [] })
}

const stub = {
  vpm,
  system: {
    pickDirectory: async () => null,
    openExternal: async () => undefined
  },
  on: () => () => undefined
}
;(window as unknown as { a: unknown }).a = stub

void i18n.use(initReactI18next).init({
  lng: 'zh-CN',
  fallbackLng: 'zh-CN',
  resources: { 'zh-CN': { translation: zh } },
  interpolation: { escapeValue: false }
})

function App(): JSX.Element {
  return (
    <div className="min-h-screen p-4" style={{ background: 'var(--bg)', color: 'var(--text)' }}>
      <div className="mx-auto max-w-[1100px]">
        <VpmProjectsSection targetProjectId={null} targetPending={false} onOpenHistory={() => undefined} />
      </div>
    </div>
  )
}

createRoot(document.getElementById('root') as HTMLElement).render(<App />)
