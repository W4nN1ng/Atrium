import { useCallback, useState } from 'react'
import type { VpmPlanDto, VpmPlanResolveInput } from '../../../shared/vpm/dto'
import { errorText } from '../../lib/msg'
import { vpmApi } from '../api'

export interface VpmPlanState {
  plan: VpmPlanDto | null
  loading: boolean
  error: string | null
  resolve: (input: VpmPlanResolveInput) => Promise<VpmPlanDto | null>
  reset: () => void
}

export function useVpmPlan(): VpmPlanState {
  const [plan, setPlan] = useState<VpmPlanDto | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const resolve = useCallback(async (input: VpmPlanResolveInput): Promise<VpmPlanDto | null> => {
    setLoading(true)
    setError(null)
    try {
      const next = await vpmApi.planResolve(input)
      setPlan(next)
      return next
    } catch (cause) {
      setError(errorText(cause))
      return null
    } finally {
      setLoading(false)
    }
  }, [])

  const reset = useCallback((): void => {
    setPlan(null)
    setError(null)
    setLoading(false)
  }, [])

  return { plan, loading, error, resolve, reset }
}
