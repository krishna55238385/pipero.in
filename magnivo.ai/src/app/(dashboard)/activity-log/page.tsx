import { History } from 'lucide-react'
import ActivityIntelligenceClient from '@/components/dashboard/ActivityIntelligenceClient'
import { getGlobalActivities } from '@/app/actions/crm'
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'

export const metadata = {
    title: "Activity Intelligence | Magnivo AI",
    description: "Real-time global activity auditing and intelligence.",
}

export default async function ActivityLogPage() {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    const { cookies } = await import('next/headers')
    const cookieStore = await cookies()
    const isMockAuth = cookieStore.get('sb-mock-auth')?.value === 'true'
    const bypassAuth = process.env.NEXT_PUBLIC_BYPASS_AUTH === 'true'

    if (!user && !isMockAuth && !bypassAuth) {
        redirect('/login')
    }

    const { data, total } = await getGlobalActivities({ limit: 20 })

    return <ActivityIntelligenceClient initialActivities={data} initialTotal={total} />
}

