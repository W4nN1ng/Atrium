import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { VpmProjectDetailDto, VpmProjectSummaryDto } from '../../../../shared/vpm/dto'
import {
  EMPTY_PROJECT_LAYOUT,
  PROJECT_DRAG_MIME,
  applyProjectLayout,
  dropKey,
  togglePinned,
  type ProjectLayout
} from '../../../../shared/projectLayout'
import { Badge, Button, Field, MenuButton, Modal } from '../../../components/ui'
import { errorText } from '../../../lib/msg'
import { cleanText, formatTimestamp, vpmCodeLabel } from '../../lib/view'
import { useUi } from '../../../stores/ui'
import { targetBadge } from '../../lib/target'
import { useVpmProjects } from '../../hooks/useProjects'
import { VpmPlanSheet } from '../plan/VpmPlanSheet'
import { VpmPackagesPanel } from '../packages/VpmPackagesPanel'
import { VpmCreateProjectDialog } from './VpmCreateProjectDialog'
import { VpmMaintenancePanel } from './VpmMaintenancePanel'
import { vpmApi } from '../../api'
import type { VpmUnityInstallDto } from '../../../../shared/vpm/dto'

function shortHash(value: string | null): string {
  if (!value) return ''
  return value.length > 18 ? `${value.slice(0, 12)}…${value.slice(-4)}` : value
}

function stateTone(state: string): 'default' | 'accent' | 'ok' | 'warn' | 'bad' {
  if (state === 'installed') return 'ok'
  if (state === 'missing') return 'bad'
  if (state === 'mismatch') return 'warn'
  if (state === 'protected') return 'accent'
  return 'default'
}

/**
 * "打开 Unity"：默认按工程版本匹配，也可以本次临时选另一个编辑器。
 * 启动前主进程会先绑定导入目标；失败会清掉绑定并给错误。
 */
function LaunchControl({
  projectKey,
  running,
  onError
}: {
  projectKey: string
  running: boolean
  onError: (message: string | null) => void
}): JSX.Element {
  const { t } = useTranslation()
  const [editors, setEditors] = useState<VpmUnityInstallDto[]>([])
  const [editorPath, setEditorPath] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [waiting, setWaiting] = useState(false)

  useEffect(() => {
    let cancelled = false
    vpmApi
      .unityInstalls()
      .then((list) => {
        if (!cancelled) setEditors(list.filter((item) => !item.missing))
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [])

  /**
   * 启动后最多等 60 秒：Unity 起来但没连上（登录/许可证对话框、桥接没装）时
   * 不能一直显示"正在连接"，要给一句能照着做的话。
   */
  useEffect(() => {
    if (!waiting) return
    if (running) {
      setWaiting(false)
      setNotice(t('vpm.projects.launched'))
      return
    }
    const timer = setTimeout(() => {
      setWaiting(false)
      setNotice(t('vpm.projects.launchTimeout'))
    }, 60_000)
    return () => clearTimeout(timer)
  }, [waiting, running, t])

  const launch = async (): Promise<void> => {
    setBusy(true)
    setNotice(null)
    onError(null)
    try {
      const result = await vpmApi.projectLaunch({
        projectKey,
        ...(editorPath ? { editorPath } : {})
      })
      if (result.status === 'alreadyRunning') {
        setNotice(t('vpm.projects.alreadyRunning'))
      } else if (result.status === 'unverified') {
        // 命令发出去了，但 45 秒没看到工程被打开：不要再装作"正在连接"。
        setWaiting(false)
        setNotice(null)
        onError(t('vpm.projects.launchUnverified'))
      } else {
        setNotice(t('vpm.projects.launching'))
        setWaiting(true)
      }
    } catch (cause) {
      onError(errorText(cause))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <select
        className="input h-7 w-[190px] text-[11px]"
        value={editorPath}
        onChange={(event) => setEditorPath(event.target.value)}
        aria-label={t('vpm.projects.editor')}
      >
        <option value="">{t('vpm.projects.editorAuto')}</option>
        {editors.map((item) => (
          <option key={item.id} value={item.path}>
            {item.version ?? item.path}
          </option>
        ))}
      </select>
      <Button variant="accent" disabled={busy} onClick={() => void launch()}>
        {busy ? t('vpm.projects.launching') : t('vpm.projects.openUnity')}
      </Button>
      {notice ? (
        <span className="text-[10px]" style={{ color: 'var(--ok)' }}>
          {notice}
        </span>
      ) : null}
    </div>
  )
}

function DetailBody({
  detail,
  onChanged,
  onOpenFolder,
  onRescan,
  onPreview,
  onRemove
}: {
  detail: VpmProjectDetailDto
  onChanged: () => void
  onOpenFolder: () => void
  onRescan: () => void
  onPreview: () => void
  onRemove: () => void
}): JSX.Element {
  const { t } = useTranslation()
  const [advancedOpen, setAdvancedOpen] = useState(false)
  return (
    <div className="max-h-[76vh] space-y-4 overflow-y-auto pr-1 text-[13px]" data-vpm-project-detail>
      {/* 头部只放名字、版本、运行点；路径/哈希这些排障信息在下面的"高级"里 */}
      <div className="flex flex-wrap items-center gap-2">
        <span
          className="h-2.5 w-2.5 shrink-0 rounded-full"
          style={{ background: detail.running ? 'var(--ok)' : 'var(--faint)' }}
        />
        {/* 名字只在弹窗标题里出现一次（R10） */}
        {detail.unityVersion ? <Badge>{detail.unityVersion}</Badge> : null}
        {!detail.linked ? <Badge tone="warn">{t('vpm.projects.unlinkedShort')}</Badge> : null}
        <MenuButton
          className="ml-auto"
          title={t('vpm.projects.more')}
          items={[
            { key: 'folder', label: t('vpm.projects.openFolder'), onSelect: onOpenFolder },
            { key: 'rescan', label: t('vpm.projects.rescan'), onSelect: onRescan },
            { key: 'plan', label: t('vpm.plan.preview'), onSelect: onPreview },
            { key: 'remove', label: t('vpm.projects.remove'), danger: true, onSelect: onRemove }
          ]}
        />
      </div>

      {!detail.linked ? (
        <div className="rounded border px-3 py-2 text-[11px]" style={{ borderColor: 'var(--warn)', color: 'var(--warn)' }}>
          {t('vpm.projects.notLinked')}
        </div>
      ) : null}

      {detail.warnings.length ? (
        <div className="space-y-1.5">
          {detail.warnings.map((warning, index) => (
            <div
              key={`${warning.code}-${index}`}
              className="rounded border px-3 py-2 text-[11px]"
              style={{ borderColor: 'var(--warn)', color: 'var(--warn)' }}
            >
              {vpmCodeLabel(warning.code)}
              {warning.path ? (
                <span className="faint ml-2 break-all font-mono">{cleanText(warning.path, 400)}</span>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}

      <VpmPackagesPanel projectKey={detail.projectKey} detail={detail} onChanged={onChanged} />

      <VpmMaintenancePanel projectKey={detail.projectKey} detail={detail} onChanged={onChanged} />

      <details
        open={advancedOpen}
        onToggle={(event) => setAdvancedOpen((event.target as HTMLDetailsElement).open)}
      >
        <summary className="cursor-pointer select-none text-[12px]" style={{ color: 'var(--muted)' }}>
          {t('vpm.projects.advanced')}
        </summary>
        <div className="mt-2 grid grid-cols-[96px_1fr] gap-x-3 gap-y-1.5 text-[11px]">
          <span className="faint">{t('vpm.projects.path')}</span>
          <span className="break-all font-mono">{cleanText(detail.path, 1000)}</span>
          <span className="faint">{t('vpm.projects.editor')}</span>
          <span className="break-all font-mono">
            {detail.unityExePath ? cleanText(detail.unityExePath, 1000) : t('vpm.projects.notRecorded')}
          </span>
          <span className="faint">{t('vpm.projects.manifest')}</span>
          <span>
            {detail.hasVpmManifest ? t('vpm.projects.manifestPresent') : t('vpm.projects.manifestMissing')}
            {detail.manifestHash ? (
              <span className="faint ml-2 font-mono">{shortHash(detail.manifestHash)}</span>
            ) : null}
          </span>
          <span className="faint">{t('vpm.projects.lastScan')}</span>
          <span>{formatTimestamp(detail.lastScanAt) || t('vpm.projects.notRecorded')}</span>
        </div>
      </details>
    </div>
  )
}

/** 名字为空时用文件夹名兜底（老工程的核心记录里 name 可能是空的）。 */
function baseNameOf(value: string): string {
  const parts = value.split(/[\\/]/).filter(Boolean)
  return parts[parts.length - 1] || value
}

export function VpmProjectsSection({
  targetProjectId = null,
  targetPending = false,
  onOpenHistory
}: {
  targetProjectId?: string | null
  targetPending?: boolean
  /** 打开该工程的素材导入历史（R11：入口从行内按钮挪进 ⋯）。 */
  onOpenHistory?: (coreId: string) => void
}): JSX.Element | null {
  const { t } = useTranslation()
  const projects = useVpmProjects()
  const setUnityTarget = useUi((state) => state.setUnityTarget)
  const [query, setQuery] = useState('')
  const [addOpen, setAddOpen] = useState(false)
  const [addPath, setAddPath] = useState('')
  const [addError, setAddError] = useState<string | null>(null)
  const [scan, setScan] = useState<{
    root: string
    candidates: Array<{ path: string; name: string; unityVersion: string | null; added: boolean }>
  } | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [scanning, setScanning] = useState(false)
  const [removeTarget, setRemoveTarget] = useState<VpmProjectSummaryDto | null>(null)
  const [removeError, setRemoveError] = useState<string | null>(null)
  const [removing, setRemoving] = useState(false)
  const [trashNote, setTrashNote] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [planProjectKey, setPlanProjectKey] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)

  /**
   * 列表顺序与 📌（存在 `setting` 表的 `ui.projectLayout`）。
   * 拖拽只在同一组内生效，钉住/取消钉住走 📌，规则全在 `shared/projectLayout.ts` 里，
   * 这里只负责“点/拖 → 存”。
   */
  const [layout, setLayout] = useState<ProjectLayout>(EMPTY_PROJECT_LAYOUT)
  const [dragKey, setDragKey] = useState<string | null>(null)
  const [dropHint, setDropHint] = useState<{ key: string; position: 'before' | 'after' } | null>(null)
  useEffect(() => {
    let cancelled = false
    void vpmApi
      .projectLayoutGet()
      .then((next) => {
        if (!cancelled) setLayout(next)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [])
  const saveLayout = (next: ProjectLayout): void => {
    setLayout(next)
    void vpmApi.projectLayoutSet(next).catch(() => undefined)
  }

  // R18：进页面时给"核心表里有、VPM 台账没有"的老工程补建台账，然后刷新列表。
  const ensured = useRef(false)
  useEffect(() => {
    if (ensured.current || !projects.status?.enabled) return
    ensured.current = true
    void vpmApi
      .projectsEnsureLedgers()
      .then((result) => {
        if (result.created > 0) void projects.refresh()
      })
      .catch(() => undefined)
  }, [projects.status?.enabled, projects.refresh])

  useEffect(() => {
    if (!projects.notice) return
    const timer = setTimeout(() => projects.dismissNotice(), 4000)
    return () => clearTimeout(timer)
  }, [projects.notice, projects.dismissNotice])

  if (projects.statusLoading || !projects.status) return null
  if (!projects.status.enabled || projects.status.safeMode || projects.status.degraded) {
    // R11：这一页现在只有项目列表，停用时不能整页空白。
    return (
      <div className="rounded border px-3 py-6 text-center" style={{ borderColor: 'var(--line)' }}>
        <div className="text-[14px]">{t('vpm.projects.disabledTitle')}</div>
        <p className="mt-1 text-[12px]" style={{ color: 'var(--muted)' }}>
          {t('vpm.projects.disabledHint')}
        </p>
      </div>
    )
  }

  // R18：不再按 hasLedger 过滤——R11 之后这一页是唯一的工程列表，
  // 早先接桥进核心表的老工程也要显示（它们的台账会在打开页面时自动补建）。
  const allKeys = projects.items.map((item) => item.projectKey)
  // 顺序在这里定：固定项永远在最上面，其余按用户拖出来的顺序
  const visible = applyProjectLayout(projects.items, (item) => item.projectKey, layout)
  // R21：同时开多个工程时，才出现「设为导入目标」——平时不占位置。
  const runningCount = visible.filter((item) => item.running).length
  const filtered = visible.filter((item) => {
    const text = query.trim().toLowerCase()
    return !text || item.name.toLowerCase().includes(text) || item.path.toLowerCase().includes(text)
  })

  const openAdd = (): void => {
    setAddPath('')
    setAddError(null)
    setScan(null)
    setSelected(new Set())
    setAddOpen(true)
  }

  /**
   * R15：选一个"工程根目录"就能把里面所有工程一次加进来
   * （ALCOM 用户把 `E://ALCOMProjects` 选进来即可）。
   */
  const scanRoot = async (raw: string): Promise<void> => {
    const value = raw.trim()
    if (!value) return
    setScanning(true)
    setAddError(null)
    try {
      const result = await vpmApi.projectScanRoot(value)
      setScan(result)
      setSelected(new Set(result.candidates.filter((item) => !item.added).map((item) => item.path)))
      if (result.candidates.length === 0) setAddError(t('vpm.projects.scanEmpty'))
    } catch (cause) {
      setScan(null)
      setAddError(errorText(cause))
    } finally {
      setScanning(false)
    }
  }

  const pickPath = async (): Promise<void> => {
    setAddError(null)
    try {
      const picked = await projects.pickDirectory(t('vpm.projects.addTitle'))
      if (picked) {
        setAddPath(picked)
        await scanRoot(picked)
      }
    } catch (cause) {
      setAddError(errorText(cause))
    }
  }

  const submitAdd = async (): Promise<void> => {
    setAddError(null)
    const targets = scan
      ? scan.candidates.filter((item) => !item.added && selected.has(item.path)).map((item) => item.path)
      : [addPath.trim()].filter(Boolean)
    if (targets.length === 0) {
      setAddError(t('vpm.projects.scanEmpty'))
      return
    }
    const failures: string[] = []
    for (const target of targets) {
      try {
        await projects.add(target, { select: false })
      } catch (cause) {
        failures.push(`${target}: ${errorText(cause)}`)
      }
    }
    await projects.refresh()
    if (failures.length > 0) {
      setAddError(failures.join('\n'))
      await scanRoot(scan?.root ?? addPath.trim())
      return
    }
    setAddOpen(false)
  }

  const openFromRow = async (key: string): Promise<void> => {
    setActionError(null)
    try {
      await vpmApi.projectLaunch({ projectKey: key })
      await projects.refresh()
    } catch (cause) {
      setActionError(errorText(cause))
    }
  }

  const openDetail = async (key: string): Promise<void> => {
    setActionError(null)
    await projects.select(key)
  }

  const rescan = async (key: string): Promise<void> => {
    setActionError(null)
    try {
      await projects.rescan(key)
    } catch (cause) {
      setActionError(errorText(cause))
    }
  }

  const confirmRemove = async (): Promise<void> => {
    if (!removeTarget || removing) return
    setRemoveError(null)
    setRemoving(true)
    try {
      // R17：删除就是删除——整个工程文件夹进回收站（可还原），没有"只移除台账"。
      const result = await vpmApi.projectTrash(removeTarget.projectKey)
      const ok = result.ok
      if (ok && result.mode === 'atrium') setTrashNote(t('vpm.projects.trashFallback'))
      if (ok) {
        setRemoveTarget(null)
        setActionError(null)
        // 主进程已经删掉了台账 + 核心表，但渲染层的列表还是旧的快照 —— 立刻重拉，
        // 否则用户要手动点「刷新」才看到它消失。
        await projects.refresh()
      } else {
        setRemoveError(t('vpm.projects.notLinked'))
      }
    } catch (cause) {
      setRemoveError(errorText(cause))
    } finally {
      setRemoving(false)
    }
  }

  const detail = projects.detail

  return (
    <section className="space-y-2" data-vpm-projects>
      <div className="flex flex-wrap items-center gap-2">
        <div className="ml-auto flex gap-2">
          <Button variant="accent" onClick={() => setCreateOpen(true)} disabled={projects.busy}>
            {t('vpm.create.title')}
          </Button>
          <Button variant="ghost" onClick={openAdd} disabled={projects.busy}>
            {t('vpm.projects.add')}
          </Button>
          <Button onClick={() => void projects.refresh()} disabled={projects.loading || projects.busy}>
            {t('vpm.projects.refresh')}
          </Button>
        </div>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <input
          className="input min-w-[220px] flex-1"
          value={query}
          placeholder={t('vpm.projects.search')}
          onChange={(event) => setQuery(event.target.value)}
        />
        {projects.notice ? (
          <span className="text-[11px]" style={{ color: 'var(--ok)' }}>
            {t('vpm.projects.removeDone')}
          </span>
        ) : null}
      </div>

      {trashNote ? (
        <p className="mt-1 text-[11px]" style={{ color: 'var(--muted)' }}>
          {trashNote}
        </p>
      ) : null}

      {projects.error ? (
        <div className="mt-2 rounded border px-3 py-2 text-[11px]" style={{ borderColor: 'var(--bad)', color: 'var(--bad)' }}>
          {projects.error}
        </div>
      ) : null}

      {filtered.length ? (
        <div className="mt-2 rounded border" style={{ borderColor: 'var(--line)' }}>
          {filtered.map((item) => {
            const pinned = layout.pinned.includes(item.projectKey)
            const hint = dropHint?.key === item.projectKey ? dropHint.position : null
            return (
            <div
              key={item.projectKey}
              className="flex min-h-[56px] items-center gap-3 border-b px-3 py-3 text-[13px] last:border-b-0"
              style={{
                borderColor: 'var(--line)',
                /**
                 * 落点指示线画在行上（不是单独一个 div）：行内插入一个元素会改变行高，
                 * 拖过 10 行就抖 10 次。`boxShadow: inset` 不占布局。
                 */
                boxShadow: hint
                  ? hint === 'before'
                    ? 'inset 0 2px 0 0 var(--accent)'
                    : 'inset 0 -2px 0 0 var(--accent)'
                  : undefined,
                opacity: dragKey === item.projectKey ? 0.45 : 1
              }}
              data-vpm-project={item.projectKey}
              /**
               * **整行可拖**（不只 ⠿ 手柄）。原来只有手柄能拖，用户按着行标题拖，
               * 浏览器起的是一次文本拖动 —— 会点亮「松手即自动分类」遮罩，顺序却纹丝不动。
               * 搜索时关掉：`filtered` 只是子集，落点算在全表上，边搜边拖会对不上。
               */
              draggable={!query.trim()}
              onDragStart={(event) => {
                const origin = event.target as HTMLElement | null
                /** 按在按钮/输入框上时不抢拖拽，否则"点打开"会变成"拖这一行" */
                if (origin?.closest('button, input, textarea, select, a')) {
                  event.preventDefault()
                  return
                }
                setDragKey(item.projectKey)
                event.dataTransfer.effectAllowed = 'move'
                /** Firefox 必须写一条数据才肯起拖 */
                event.dataTransfer.setData('text/plain', item.projectKey)
                /** 让全窗口的"拖文件即自动分类"认出这是内部拖动，别接管 */
                event.dataTransfer.setData(PROJECT_DRAG_MIME, item.projectKey)
              }}
              onDragEnd={() => {
                setDragKey(null)
                setDropHint(null)
              }}
              onDragOver={(event) => {
                if (!dragKey || dragKey === item.projectKey) return
                event.preventDefault()
                event.stopPropagation()
                event.dataTransfer.dropEffect = 'move'
                const rect = event.currentTarget.getBoundingClientRect()
                const position = event.clientY < rect.top + rect.height / 2 ? 'before' : 'after'
                if (hint !== position) setDropHint({ key: item.projectKey, position })
              }}
              onDragLeave={(event) => {
                /**
                 * 只有指针真的离开这一行才灭指示线。行里有子元素，鼠标从行移到子元素上
                 * 也会触发 dragleave —— 不判 relatedTarget 的话指示线会一路闪。
                 */
                const next = event.relatedTarget
                if (next instanceof Node && event.currentTarget.contains(next)) return
                if (dropHint?.key === item.projectKey) setDropHint(null)
              }}
              onDrop={(event) => {
                event.preventDefault()
                event.stopPropagation()
                const position = dropHint?.key === item.projectKey ? dropHint.position : 'before'
                if (dragKey && dragKey !== item.projectKey) {
                  saveLayout(dropKey(allKeys, layout, dragKey, item.projectKey, position))
                }
                setDragKey(null)
                setDropHint(null)
              }}
            >
              {/*
               * 拖拽手柄只是**视觉提示**（真正起拖在整行上，见上面的 onDragStart）。
               * 不给它挂 button 的 ARIA 角色：P8-E 闸门禁止在卡片里造伪按钮
               * （键盘可达性走 📌 和 ⋯ 菜单，不靠拖）。
               */}
              <span
                aria-hidden="true"
                title={t('vpm.projects.dragHint')}
                className="shrink-0 cursor-grab select-none px-0.5 text-[14px] leading-none"
                style={{ color: 'var(--faint)' }}
              >
                ⠿
              </span>
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ background: item.running ? 'var(--ok)' : 'var(--faint)' }}
                title={item.running ? t('vpm.projects.running') : undefined}
              />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="truncate text-[17px] font-semibold">
                    {cleanText(item.name || baseNameOf(item.path), 200)}
                  </span>
                  {item.unityVersion ? (
                    <span className="text-[12px]" style={{ color: 'var(--muted)' }}>
                      {item.unityVersion}
                    </span>
                  ) : null}
                  {(() => {
                    const badge = targetBadge(item, targetProjectId, targetPending)
                    if (!badge) return null
                    // 静态 key：i18n 检查脚本要能扫到，不用动态拼接。
                    return (
                      <Badge tone={badge.tone}>
                        {badge.key === 'isTarget' ? t('project.isTarget') : t('project.targetWaiting')}
                      </Badge>
                    )
                  })()}
                  {!item.linked ? <Badge tone="warn">{t('vpm.projects.unlinkedShort')}</Badge> : null}
                  {item.legacyCount ? (
                    <Badge tone="warn">{t('vpm.projects.legacyCount', { count: item.legacyCount })}</Badge>
                  ) : null}
                </div>
                <div className="truncate text-[12px]" style={{ color: 'var(--faint)' }}>
                  {cleanText(item.path, 1000)}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                {/*
                 * R21：多开时才出现这一列「设为导入目标」。
                 * 给它固定宽度（没在跑的行留空），这样「打开」在所有行里对齐。
                 */}
                {runningCount > 1 ? (
                  <span className="flex w-[104px] shrink-0 justify-end">
                    {item.running && item.coreId ? (
                      <Button
                        variant="ghost"
                        disabled={item.coreId === targetProjectId}
                        onClick={() => setUnityTarget(item.coreId as string)}
                      >
                        {t('vpm.projects.setTarget')}
                      </Button>
                    ) : null}
                  </span>
                ) : null}
                <Button onClick={() => void openFromRow(item.projectKey)} disabled={projects.busy}>
                  {t('vpm.projects.open')}
                </Button>
                <Button variant="ghost" onClick={() => void openDetail(item.projectKey)}>
                  {t('vpm.projects.manage')}
                </Button>
                {/*
                 * 📌：钉住就永远排在最上面（新扫描出来的工程不会插到它前面）。
                 * 用 unicode 图钉而不是图标库：少一个依赖，深浅色都跟着文字走。
                 */}
                <Button
                  variant="ghost"
                  className={pinned ? 'vpm-pin-on' : 'vpm-pin-off'}
                  title={pinned ? t('vpm.projects.unpin') : t('vpm.projects.pin')}
                  ariaLabel={pinned ? t('vpm.projects.unpin') : t('vpm.projects.pin')}
                  onClick={() => saveLayout(togglePinned(allKeys, layout, item.projectKey))}
                >
                  📌
                </Button>
                <MenuButton
                  title={t('vpm.projects.more')}
                  items={[
                    ...(onOpenHistory && item.coreId
                      ? [
                          {
                            key: 'history',
                            label: t('vpm.projects.importHistory'),
                            onSelect: () => onOpenHistory(item.coreId as string)
                          }
                        ]
                      : []),
                    { key: 'rescan', label: t('vpm.projects.rescan'), onSelect: () => void rescan(item.projectKey) },
                    {
                      key: 'folder',
                      label: t('vpm.projects.openFolder'),
                      onSelect: () => void projects.openFolder(item.projectKey)
                    },
                    {
                      key: 'remove',
                      label: t('vpm.projects.remove'),
                      danger: true,
                      onSelect: () => {
                        setRemoveError(null)
                        setRemoveTarget(item)
                      }
                    }
                  ]}
                />
              </div>
            </div>
            )
          })}
        </div>
      ) : visible.length === 0 ? (
        <div className="mt-3 rounded border px-3 py-4 text-center" style={{ borderColor: 'var(--line)' }}>
          <div className="text-[12px]">{t('vpm.projects.empty')}</div>
          <div className="faint mt-1 text-[11px]">{t('vpm.projects.emptyHint')}</div>
          <div className="mt-2">
            <Button onClick={openAdd} disabled={projects.busy}>
              {t('vpm.projects.add')}
            </Button>
          </div>
        </div>
      ) : (
        <div className="faint mt-3 text-[11px]">{t('vpm.projects.noMatch')}</div>
      )}

      <Modal
        open={addOpen}
        onOpenChange={(open) => {
          if (!projects.busy) setAddOpen(open)
        }}
        title={t('vpm.projects.addTitle')}
        footer={
          <>
            <Button onClick={() => setAddOpen(false)} disabled={projects.busy}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="accent"
              onClick={() => void submitAdd()}
              disabled={projects.busy || scanning || (scan ? selected.size === 0 : !addPath.trim())}
            >
              {projects.busy
                ? t('vpm.projects.scanAdding')
                : scan && scan.candidates.length > 0
                  ? t('vpm.projects.scanAdd', { count: selected.size })
                  : t('vpm.projects.add')}
            </Button>
          </>
        }
      >
        <div className="space-y-3 text-[12px]">
          <Field label={t('vpm.projects.path')} hint={t('vpm.projects.addHint')}>
            <div className="flex gap-2">
              <input
                className="input flex-1 font-mono"
                value={addPath}
                placeholder={t('vpm.projects.pathPlaceholder')}
                onChange={(event) => {
                  setAddPath(event.target.value)
                  setAddError(null)
                  setScan(null)
                }}
                onBlur={(event) => void scanRoot(event.target.value)}
              />
              <Button variant="ghost" onClick={() => void pickPath()} disabled={projects.busy}>
                {t('vpm.projects.pick')}
              </Button>
            </div>
          </Field>
          {scanning ? (
            <p className="text-[11px]" style={{ color: 'var(--muted)' }}>
              {t('vpm.projects.scanning')}
            </p>
          ) : null}

          {scan && scan.candidates.length > 0 ? (
            <div className="space-y-1">
              <p className="text-[11px]" style={{ color: 'var(--muted)' }}>
                {t('vpm.projects.scanTitle', { root: scan.root, count: scan.candidates.length })}
              </p>
              <div className="max-h-[36vh] overflow-y-auto rounded border" style={{ borderColor: 'var(--line)' }}>
                {scan.candidates.map((candidate) => (
                  <label
                    key={candidate.path}
                    className="flex items-center gap-2 border-b px-2 py-1.5 text-[12px] last:border-b-0"
                    style={{ borderColor: 'var(--line)', opacity: candidate.added ? 0.55 : 1 }}
                  >
                    <input
                      type="checkbox"
                      disabled={candidate.added}
                      checked={selected.has(candidate.path)}
                      onChange={(event) => {
                        setSelected((current) => {
                          const next = new Set(current)
                          if (event.target.checked) next.add(candidate.path)
                          else next.delete(candidate.path)
                          return next
                        })
                      }}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px]">{cleanText(candidate.name, 120)}</span>
                      <span className="block truncate text-[11px]" style={{ color: 'var(--faint)' }}>
                        {cleanText(candidate.path, 300)}
                      </span>
                    </span>
                    {candidate.unityVersion ? (
                      <span className="text-[11px]" style={{ color: 'var(--muted)' }}>
                        {candidate.unityVersion}
                      </span>
                    ) : null}
                    {candidate.added ? <Badge>{t('vpm.projects.scanAlready')}</Badge> : null}
                  </label>
                ))}
              </div>
            </div>
          ) : null}

          {addError ? (
            <div className="whitespace-pre-wrap rounded border px-2 py-1.5 text-[11px]" style={{ borderColor: 'var(--bad)', color: 'var(--bad)' }}>
              {addError}
            </div>
          ) : null}
        </div>
      </Modal>

      <Modal
        open={removeTarget !== null}
        onOpenChange={(open) => {
          if (!open && !projects.busy && !removing) setRemoveTarget(null)
        }}
        title={t('vpm.projects.removeTitle')}
        footer={
          <>
            <Button onClick={() => setRemoveTarget(null)} disabled={projects.busy || removing}>
              {t('common.cancel')}
            </Button>
            <Button onClick={() => void confirmRemove()} disabled={projects.busy || removing || removeTarget?.running}>
              {t('vpm.projects.remove')}
            </Button>
          </>
        }
      >
        <div className="text-[12px] leading-relaxed" style={{ color: 'var(--muted)' }}>
          <div>
            {t('vpm.projects.removeBody')}
            {removeTarget ? (
              <span className="mt-2 block break-all font-mono text-[11px]" style={{ color: 'var(--text)' }}>
                {cleanText(removeTarget.name, 200)} · {cleanText(removeTarget.path, 300)}
              </span>
            ) : null}
          </div>
          {removeTarget?.running ? <div role="status">{t('vpm.errors.vpmUnityRunning')}</div> : null}
          {removeError ? (
            <div
              className="mt-2 rounded border px-2 py-1.5 text-[11px]"
              style={{ borderColor: 'var(--bad)', color: 'var(--bad)' }}
            >
              {removeError}
            </div>
          ) : null}
        </div>
      </Modal>

      <Modal
        open={projects.selectedKey !== null}
        onOpenChange={(open) => {
          if (!open) {
            projects.closeDetail()
            setActionError(null)
            setRemoveTarget(null)
          }
        }}
        width={1080}
        title={detail ? cleanText(detail.name, 120) : t('vpm.projects.detailTitle')}
        footer={
          <>
            {detail ? (
              <LaunchControl
                projectKey={detail.projectKey}
                running={detail.running}
                onError={(message) => setActionError(message)}
              />
            ) : null}
            <Button onClick={() => projects.closeDetail()}>{t('vpm.projects.close')}</Button>
          </>
        }
      >
        <div className="space-y-3 text-[12px]">
          {projects.detailLoading ? (
            <p className="faint">{t('vpm.projects.loading')}</p>
          ) : detail ? (
            <>
              {actionError ? (
                <div className="rounded border px-3 py-2 text-[11px]" style={{ borderColor: 'var(--bad)', color: 'var(--bad)' }}>
                  {actionError}
                </div>
              ) : null}
              <DetailBody
                detail={detail}
                onChanged={() => {
                  void projects.select(detail.projectKey)
                }}
                onOpenFolder={() => void projects.openFolder(detail.projectKey)}
                onRescan={() => void rescan(detail.projectKey)}
                onPreview={() => {
                  setPlanProjectKey(detail.projectKey)
                  projects.closeDetail()
                  setActionError(null)
                  setRemoveTarget(null)
                }}
                onRemove={() => {
                  setRemoveError(null)
                  setRemoveTarget(detail)
                }}
              />
            </>
          ) : (
            <p className="faint">{projects.error ?? t('vpm.projects.noMatch')}</p>
          )}

        </div>
      </Modal>

      <VpmCreateProjectDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={(projectKey) => {
          void projects.refresh()
          void projects.select(projectKey)
        }}
      />

      <VpmPlanSheet
        open={planProjectKey !== null}
        projectKey={planProjectKey ?? ''}
        onOpenChange={(next) => {
          if (!next) setPlanProjectKey(null)
        }}
      />
    </section>
  )
}
