'use client'

import { useCallback, useState } from 'react'
import type { MailboxPoolResponse } from '@/types/mail'
import { getMailboxPools } from '@/app/actions/mail'

export function useMailboxPools() {
  const [pools, setPools] = useState<MailboxPoolResponse[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchPools = useCallback(async () => {
    try {
      setIsLoading(true)
      setError(null)
      const data = await getMailboxPools()
      setPools(data)
    } catch {
      setError('Failed to load mailbox pools')
    } finally {
      setIsLoading(false)
    }
  }, [])

  const refresh = useCallback(async () => {
    await fetchPools()
  }, [fetchPools])

  return { pools, isLoading, error, fetch: fetchPools, refresh }
}
