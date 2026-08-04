'use client'

import { useCallback, useState } from 'react'
import type { Lead } from '@/types/mail'
import { getMailLeads } from '@/app/actions/mail'

export function useMailLeads() {
  const [leads, setLeads] = useState<Lead[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchLeads = useCallback(async () => {
    try {
      setIsLoading(true)
      setError(null)
      const data = await getMailLeads()
      setLeads(data)
    } catch {
      setError('Failed to load leads')
    } finally {
      setIsLoading(false)
    }
  }, [])

  const refresh = useCallback(async () => {
    await fetchLeads()
  }, [fetchLeads])

  return { leads, isLoading, error, fetch: fetchLeads, refresh }
}
