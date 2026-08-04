'use client'

import { useCallback, useState } from 'react'
import type { AnalyticsOverview } from '@/types/mail'
import { getMailAnalytics } from '@/app/actions/mail'

export function useMailAnalytics() {
  const [analytics, setAnalytics] = useState<AnalyticsOverview | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchAnalytics = useCallback(async () => {
    try {
      setIsLoading(true)
      setError(null)
      const data = await getMailAnalytics()
      setAnalytics(data)
    } catch {
      setError('Failed to load analytics')
    } finally {
      setIsLoading(false)
    }
  }, [])

  const refresh = useCallback(async () => {
    await fetchAnalytics()
  }, [fetchAnalytics])

  return { analytics, isLoading, error, fetch: fetchAnalytics, refresh }
}
