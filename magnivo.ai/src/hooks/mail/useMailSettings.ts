'use client'

import { useCallback, useState } from 'react'
import type { MailSettings } from '@/types/mail'
import { getMailSettings } from '@/app/actions/mail'

export function useMailSettings() {
  const [settings, setSettings] = useState<MailSettings | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchSettings = useCallback(async () => {
    try {
      setIsLoading(true)
      setError(null)
      const data = await getMailSettings()
      setSettings(data)
    } catch {
      setError('Failed to load mail settings')
    } finally {
      setIsLoading(false)
    }
  }, [])

  const refresh = useCallback(async () => {
    await fetchSettings()
  }, [fetchSettings])

  return { settings, isLoading, error, fetch: fetchSettings, refresh }
}
