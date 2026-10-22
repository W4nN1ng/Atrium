import { lazy, Suspense, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useUi } from '../stores/ui'
import { ImportHistoryDialog } from '../components/ImportHistoryDialog'

/** VPM 项目列表按需加载。 */
const VpmProjectsSection = lazy(() =>
  import('../vpm/components/projects/VpmProjectsSection').then((module) => ({
    default: module.VpmProjectsSection
  }))
)

/**
 * 项目页（R11）。
 *
 * 这里**只有一套列表**：VPM 项目列表。原来的核心 Unity 工程面板（工程行、
 * 导入历史 / 设为导入目标 / 高级连接选项、刷新工程列表、"导入目标"状态条）已删除——
 * 两套列表并存时用户不知道该看哪个，而且"导入目标"本来就能由"启动即绑定"决定。
 *
 * 连接状态仍然在后台跑（`useUi.connection`），这里只用它的 target 标记。
 */
export function Project(): JSX.Element {
  const { t } = useTranslation()
  const connection = useUi((s) => s.connection)
  const [historyProject, setHistoryProject] = useState<string | null>(null)

  return (
    <div className="flex h-full min-h-0 flex-col" data-page="projects">
      <div
        className="flex shrink-0 items-center gap-2 border-b px-3 py-2"
        style={{ borderColor: 'var(--line)' }}
      >
        <span className="text-[15px] font-medium">{t('nav.project')}</span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        <Suspense fallback={null}>
          <VpmProjectsSection
            targetProjectId={connection.targetProjectId}
            targetPending={connection.targetPending === true}
            onOpenHistory={(coreId) => setHistoryProject(coreId)}
          />
        </Suspense>
      </div>

      {historyProject ? (
        <ImportHistoryDialog projectId={historyProject} onClose={() => setHistoryProject(null)} />
      ) : null}
    </div>
  )
}
