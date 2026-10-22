import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  VpmOperationDto,
  VpmOperationProgressEvent,
  VpmOperationSummaryDto
} from '../../../shared/vpm/dto'
import { errorText } from '../../lib/msg'
import { vpmApi } from '../api'

export interface OperationProgressState {
  step: string
  phase: 'start' | 'done' | 'failed'
  index: number
  total: number
}

export interface OperationRun {
  operationId: string
  projectKey: string
  progress: OperationProgressState | null
  result: VpmOperationDto | null
  error: string | null
  running: boolean
}

export interface VpmOperationsState {
  run: OperationRun | null
  history: VpmOperationSummaryDto[]
  historyLoading: boolean
  historyError: string | null
  apply: (planId: string) => Promise<VpmOperationDto | null>
  cancel: () => Promise<boolean>
  undo: (operationId: string) => Promise<VpmOperationDto | null>
  reloadHistory: () => Promise<void>
  dismiss: () => void
}

/**
 * 操作状态 + 历史。
 *
 * 事件只是加速：`planApply` 的返回值本身就是最终状态，
 * 所以事件丢了也能恢复（重新打开面板会重新拉 history）。
 */
export function useVpmOperations(projectKey: string): VpmOperationsState {
  const [run, setRun] = useState<OperationRun | null>(null)
  const [history, setHistory] = useState<VpmOperationSummaryDto[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyError, setHistoryError] = useState<string | null>(null)
  const runRef = useRef<OperationRun | null>(null)
  runRef.current = run

  const patch = useCallback((next: (current: OperationRun) => OperationRun) => {
    setRun((current) => (current ? next(current) : current))
  }, [])

  const reloadHistory = useCallback(async (): Promise<void> => {
    if (!projectKey) {
      setHistory([])
      return
    }
    setHistoryLoading(true)
    setHistoryError(null)
    try {
      setHistory(await vpmApi.operationHistory(projectKey))
    } catch (cause) {
      setHistoryError(errorText(cause))
    } finally {
      setHistoryLoading(false)
    }
  }, [projectKey])

  useEffect(() => {
    void reloadHistory()
  }, [reloadHistory])

  useEffect(() => {
    if (!projectKey) return
    const offStarted = vpmApi.onOperationStarted((event) => {
      if (event.projectKey !== projectKey) return
      setRun({
        operationId: event.operationId,
        projectKey: event.projectKey,
        progress: null,
        result: null,
        error: null,
        running: true
      })
    })
    const offProgress = vpmApi.onOperationProgress((event: VpmOperationProgressEvent) => {
      if (event.projectKey !== projectKey) return
      patch((current) => ({
        ...current,
        operationId: current.operationId || event.operationId,
        progress: {
          step: event.step,
          phase: event.phase,
          index: event.index,
          total: event.total
        }
      }))
    })
    const offDone = vpmApi.onOperationDone((event) => {
      if (event.projectKey !== projectKey) return
      patch((current) => ({ ...current, running: false }))
      void reloadHistory()
    })
    return () => {
      offStarted()
      offProgress()
      offDone()
    }
  }, [projectKey, patch, reloadHistory])

  const apply = useCallback(
    async (planId: string): Promise<VpmOperationDto | null> => {
      setRun({
        operationId: '',
        projectKey,
        progress: null,
        result: null,
        error: null,
        running: true
      })
      try {
        const result = await vpmApi.planApply({ projectKey, planId })
        setRun((current) => ({
          operationId: result.operationId,
          projectKey,
          progress: current?.progress ?? null,
          result,
          error: null,
          running: false
        }))
        await reloadHistory()
        return result
      } catch (cause) {
        setRun((current) => ({
          operationId: current?.operationId ?? '',
          projectKey,
          progress: current?.progress ?? null,
          result: null,
          error: errorText(cause),
          running: false
        }))
        return null
      }
    },
    [projectKey, reloadHistory]
  )

  const cancel = useCallback(async (): Promise<boolean> => {
    const current = runRef.current
    if (!current?.operationId) return false
    try {
      const result = await vpmApi.operationCancel(current.operationId)
      return result.ok
    } catch {
      return false
    }
  }, [])

  const undo = useCallback(
    async (operationId: string): Promise<VpmOperationDto | null> => {
      setRun({
        operationId: '',
        projectKey,
        progress: null,
        result: null,
        error: null,
        running: true
      })
      try {
        const result = await vpmApi.operationUndo(operationId)
        setRun((current) => ({
          operationId: result.operationId,
          projectKey,
          progress: current?.progress ?? null,
          result,
          error: null,
          running: false
        }))
        await reloadHistory()
        return result
      } catch (cause) {
        setRun((current) => ({
          operationId: current?.operationId ?? '',
          projectKey,
          progress: current?.progress ?? null,
          result: null,
          error: errorText(cause),
          running: false
        }))
        return null
      }
    },
    [projectKey, reloadHistory]
  )

  const dismiss = useCallback((): void => setRun(null), [])

  return { run, history, historyLoading, historyError, apply, cancel, undo, reloadHistory, dismiss }
}
