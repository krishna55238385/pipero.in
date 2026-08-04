'use client'

import { useCallback, useState } from 'react'
import type { Campaign } from '@/types/mail'
import { getCampaigns } from '@/app/actions/mail'

export function useMailCampaigns() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchCampaigns = useCallback(async () => {
    try {
      setIsLoading(true)
      setError(null)
      const data = await getCampaigns()
      setCampaigns(data)
    } catch {
      setError('Failed to load campaigns')
    } finally {
      setIsLoading(false)
    }
  }, [])

  const refresh = useCallback(async () => {
    await fetchCampaigns()
  }, [fetchCampaigns])

  return { campaigns, isLoading, error, fetch: fetchCampaigns, refresh }
}
