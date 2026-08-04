'use client'

import { useCallback, useState } from 'react'
import type { WarmupConfig } from '@/types/mail'
import { getWarmupConfigs } from '@/app/actions/mail'

export function useWarmupConfigs() {
  const [configs, setConfigs] = useState<WarmupConfig[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchConfigs = useCallback(async () => {
    try {
      setIsLoading(true)
      setError(null)
      const data = await getWarmupConfigs()
      setConfigs(data)
    } catch {
      setError('Failed to load warmup configs')
    } finally {
      setIsLoading(false)
    }
  }, [])

  const refresh = useCallback(async () => {
    await fetchConfigs()
  }, [fetchConfigs])

  return { configs, isLoading, error, fetch: fetchConfigs, refresh }
}
