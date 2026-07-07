'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

// Polls for changes instead of subscribing to Supabase real-time (removed
// along with the Supabase→RDS migration). Refreshing the route re-runs
// whichever server action the page already uses to load this table's data.
export function useSupabaseRealtime(table: 'leads' | 'deals' | 'tasks') {
  const router = useRouter()

  useEffect(() => {
    const interval = setInterval(() => {
      router.refresh()
    }, 30000)

    return () => clearInterval(interval)
  }, [table, router])
}
