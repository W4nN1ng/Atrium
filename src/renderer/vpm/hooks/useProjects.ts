import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  VpmProjectDetailDto,
  VpmProjectSummaryDto
} from '../../../shared/vpm/dto'
import type { VpmStatus } from '../../../shared/vpm/types'
import { errorText } from '../../lib/msg'
import { vpmApi } from '../api'

export interface VpmProjectsState {
  status: VpmStatus | null
  statusLoading: boolean
  items: VpmProjectSummaryDto[]
  loading: boolean
  busy: boolean
  error: string | null
  notice: string | null
  selectedKey: string | null
  detail: VpmProjectDetailDto | null
  detailLoading: boolean
  refresh: () => Promise<void>
  select: (projectKey: string) => Promise<void>
  closeDetail: () => void
  add: (path: string, options?: { select?: boolean }) => Promise<VpmProjectDetailDto>
  remove: (projectKey: string) => Promise<boolean>
  rescan: (projectKey: string) => Promise<VpmProjectDetailDto>
  openFolder: (projectKey: string) => Promise<void>
  pickDirectory: (title: string) => Promise<string | null>
  dismissNotice: () => void
  dismissError: () => void
}

export function useVpmProjects(): VpmProjectsState {
  const [status, setStatus] = useState<VpmStatus | null>(null)
  const [statusLoading, setStatusLoading] = useState(true)
  const [items, setItems] = useState<VpmProjectSummaryDto[]>([])
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [detail, setDetail] = useState<VpmProjectDetailDto | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const listSeq = useRef(0)
  const detailSeq = useRef(0)

  const loadItems = useCallback(async (): Promise<void> => {
    const id = ++listSeq.current
    setLoading(true)
    setError(null)
    try {
      const next = await vpmApi.projectsList()
      if (id !== listSeq.current) return
      setItems(next)
    } catch (cause) {
      if (id === listSeq.current) setError(errorText(cause))
    } finally {
      if (id === listSeq.current) setLoading(false)
    }
  }, [])

  const refresh = useCallback(async (): Promise<void> => {
    setStatusLoading(true)
    setError(null)
    try {
      const next = await vpmApi.status()
      setStatus(next)
      if (next.enabled && !next.safeMode && !next.degraded) {
        await loadItems()
      } else {
        setItems([])
        setSelectedKey(null)
        setDetail(null)
      }
    } catch (cause) {
      setError(errorText(cause))
    } finally {
      setStatusLoading(false)
    }
  }, [loadItems])

  useEffect(() => {
    void refresh()
  }, [refresh])

  /**
   * 运行状态（绿点 + 「已打开」）由主进程的三路探测（心跳/锁文件/wmi）决定，
   * 关掉 Unity 后它要过几秒才会翻。列表如果只在挂载时拉一次，就会一直显示"已打开"。
   * 这里每 5 秒轻量重拉一次列表（只在 VPM 启用时跑）。
   */
  useEffect(() => {
    if (!status?.enabled) return
    const timer = setInterval(() => {
      void loadItems()
    }, 5000)
    return () => clearInterval(timer)
  }, [status?.enabled, loadItems])

  const select = useCallback(async (projectKey: string): Promise<void> => {
    const id = ++detailSeq.current
    setSelectedKey(projectKey)
    setDetail(null)
    setDetailLoading(true)
    setError(null)
    try {
      const next = await vpmApi.projectDetail(projectKey)
      if (id === detailSeq.current) setDetail(next)
    } catch (cause) {
      if (id === detailSeq.current) setError(errorText(cause))
    } finally {
      if (id === detailSeq.current) setDetailLoading(false)
    }
  }, [])

  const closeDetail = useCallback((): void => {
    detailSeq.current++
    setSelectedKey(null)
    setDetail(null)
    setDetailLoading(false)
  }, [])

  const add = useCallback(
    async (path: string, options?: { select?: boolean }): Promise<VpmProjectDetailDto> => {
      setBusy(true)
      setError(null)
      setNotice(null)
      try {
        const next = await vpmApi.projectAdd({ path })
        // 批量添加时不要每次都把详情弹窗顶出来（R15）。
        if (options?.select !== false) {
          setSelectedKey(next.projectKey)
          setDetail(next)
        }
        await loadItems()
        return next
      } finally {
        setBusy(false)
      }
    },
    [loadItems]
  )

  const remove = useCallback(
    async (projectKey: string): Promise<boolean> => {
      setBusy(true)
      setError(null)
      try {
        const result = await vpmApi.projectRemove(projectKey)
        if (result.ok) {
          setNotice('removed')
          setSelectedKey(null)
          setDetail(null)
          await loadItems()
        }
        return result.ok
      } finally {
        setBusy(false)
      }
    },
    [loadItems]
  )

  const rescan = useCallback(
    async (projectKey: string): Promise<VpmProjectDetailDto> => {
      setBusy(true)
      setError(null)
      try {
        const next = await vpmApi.projectRescan(projectKey)
        setDetail(next)
        await loadItems()
        return next
      } finally {
        setBusy(false)
      }
    },
    [loadItems]
  )

  const openFolder = useCallback(async (projectKey: string): Promise<void> => {
    setError(null)
    try {
      await vpmApi.projectOpenFolder(projectKey)
    } catch (cause) {
      setError(errorText(cause))
    }
  }, [])

  const dismissNotice = useCallback((): void => setNotice(null), [])
  const dismissError = useCallback((): void => setError(null), [])

  return {
    status,
    statusLoading,
    items,
    loading,
    busy,
    error,
    notice,
    selectedKey,
    detail,
    detailLoading,
    refresh,
    select,
    closeDetail,
    add,
    remove,
    rescan,
    openFolder,
    pickDirectory: (title) => vpmApi.pickProjectDirectory(title),
    dismissNotice,
    dismissError
  }
}
