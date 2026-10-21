import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type {
  VpmNetworkStatus,
  VpmOperationStart,
  VpmRepoDto
} from '../../../shared/vpm/dto'
import { errorText } from '../../lib/msg'
import { vpmApi } from '../api'

export interface VpmOperationState {
  operationId: string
  done: number
  total: number
}

export interface VpmReposState {
  repos: VpmRepoDto[]
  network: VpmNetworkStatus | null
  operation: VpmOperationState | null
  loading: boolean
  busy: boolean
  error: string | null
  notice: string | null
  reload: () => Promise<void>
  addRepo: (input: { url: string; name?: string }) => Promise<VpmRepoDto>
  removeRepo: (id: string) => Promise<void>
  refreshRepo: (id: string) => void
  refreshAll: () => void
  useOfficialRepos: () => void
  setNetwork: (enabled: boolean) => Promise<void>
  dismissNotice: () => void
}

export function useVpmRepos(enabled: boolean): VpmReposState {
  const { t } = useTranslation()
  const [repos, setRepos] = useState<VpmRepoDto[]>([])
  const [network, setNetworkState] = useState<VpmNetworkStatus | null>(null)
  const [operation, setOperation] = useState<VpmOperationState | null>(null)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const operationRef = useRef<string | null>(null)
  const autoRefreshStarted = useRef(false)

  const setOperationFromStart = useCallback((start: VpmOperationStart) => {
    operationRef.current = start.operationId
    setOperation((current) =>
      current?.operationId === start.operationId
        ? current
        : { operationId: start.operationId, done: 0, total: Math.max(1, start.repoIds.length) }
    )
  }, [])

  const reload = useCallback(async (): Promise<void> => {
    if (!enabled) return
    setLoading(true)
    try {
      const [nextRepos, nextNetwork] = await Promise.all([
        vpmApi.reposList(),
        vpmApi.networkStatus()
      ])
      setRepos(nextRepos)
      setNetworkState(nextNetwork)
      setError(null)
    } catch (cause) {
      setError(errorText(cause))
    } finally {
      setLoading(false)
    }
  }, [enabled])

  useEffect(() => {
    if (!enabled) {
      setRepos([])
      setNetworkState(null)
      setOperation(null)
      operationRef.current = null
      return
    }
    void reload()

    const offProgress = vpmApi.onRepoProgress((event) => {
      if (event.phase === 'start') {
        if (event.operationId !== operationRef.current) {
          operationRef.current = event.operationId
          setOperation({
            operationId: event.operationId,
            done: 0,
            total: Math.max(1, event.repoIds?.length ?? 1)
          })
        }
        return
      }
      if (event.result) {
        const result = event.result
        setRepos((current) =>
          current.map((repo) => (repo.id === result.repo.id ? result.repo : repo))
        )
      }
      if (event.operationId === operationRef.current) {
        setOperation((current) =>
          current && current.operationId === event.operationId
            ? { ...current, done: Math.min(current.total, current.done + 1) }
            : current
        )
      }
    })
    const offDone = vpmApi.onRepoDone((event) => {
      if (event.operationId === operationRef.current) {
        operationRef.current = null
        setOperation(null)
      }
      void reload()
    })
    return () => {
      offProgress()
      offDone()
    }
  }, [enabled, reload])

  const addRepo = useCallback(
    async (input: { url: string; name?: string }): Promise<VpmRepoDto> => {
      setBusy(true)
      setError(null)
      try {
        const repo = await vpmApi.repoAdd(input)
        await reload()
        setNotice(network?.allowed ? null : t('vpm.repos.addedOffline'))
        return repo
      } finally {
        setBusy(false)
      }
    },
    [network?.allowed, reload, t]
  )

  const removeRepo = useCallback(
    async (id: string): Promise<void> => {
      setBusy(true)
      setError(null)
      try {
        await vpmApi.repoRemove(id)
        await reload()
      } finally {
        setBusy(false)
      }
    },
    [reload]
  )

  const runRefreshRepo = useCallback(
    async (id: string): Promise<void> => {
      setError(null)
      try {
        setOperationFromStart(await vpmApi.repoRefresh(id))
      } catch (cause) {
        setError(errorText(cause))
      }
    },
    [setOperationFromStart]
  )

  const runRefreshAll = useCallback(async (): Promise<void> => {
    setError(null)
    try {
      setOperationFromStart(await vpmApi.repoRefreshAll())
    } catch (cause) {
      setError(errorText(cause))
    }
  }, [setOperationFromStart])

  const refreshRepo = useCallback(
    (id: string): void => {
      if (!network?.allowed) {
        setError(t('vpm.repos.noConsent'))
        return
      }
      void runRefreshRepo(id)
    },
    [network?.allowed, runRefreshRepo, t]
  )

  const refreshAll = useCallback((): void => {
    if (!network?.allowed) {
      setError(t('vpm.repos.noConsent'))
      return
    }
    void runRefreshAll()
  }, [network?.allowed, runRefreshAll, t])

  useEffect(() => {
    if (!enabled || loading || autoRefreshStarted.current) return
    if (!network?.allowed || !repos.length) return
    if (!repos.some((repo) => repo.lastSuccessAt === null)) return
    autoRefreshStarted.current = true
    void runRefreshAll()
  }, [enabled, loading, network?.allowed, repos, runRefreshAll])

  const setNetwork = useCallback(
    async (enabledNext: boolean): Promise<void> => {
      setBusy(true)
      setError(null)
      try {
        const next = await vpmApi.networkConsent(enabledNext)
        setNetworkState(next)
        await reload()
        if (enabledNext) {
          autoRefreshStarted.current = true
          await runRefreshAll()
        }
      } catch (cause) {
        setError(errorText(cause))
      } finally {
        setBusy(false)
      }
    },
    [reload, runRefreshAll]
  )

  const useOfficialRepos = useCallback((): void => {
    const run = async (): Promise<void> => {
      setBusy(true)
      setError(null)
      try {
        await vpmApi.networkConsent(true)
        await reload()
        setOperationFromStart(await vpmApi.repoRefreshAll())
      } catch (cause) {
        setError(errorText(cause))
      } finally {
        setBusy(false)
      }
    }
    void run()
  }, [reload, setOperationFromStart])

  return {
    repos,
    network,
    operation,
    loading,
    busy,
    error,
    notice,
    reload,
    addRepo,
    removeRepo,
    refreshRepo,
    refreshAll,
    useOfficialRepos,
    setNetwork,
    dismissNotice: () => setNotice(null)
  }
}
