'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

export function useSupabaseRealtime(table: 'leads' | 'deals' | 'tasks') {
  const router = useRouter()

  useEffect(() => {
    const supabase = createClient()

    const channel = supabase
      .channel(`realtime_${table}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: table },
        () => {
          // Whenever a change happens (insert, update, delete), refresh the route
          router.refresh()
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [table, router])
}
