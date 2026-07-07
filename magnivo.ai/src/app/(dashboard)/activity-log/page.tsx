import ActivityIntelligenceClient from '@/components/dashboard/ActivityIntelligenceClient'
import { getGlobalActivities } from '@/app/actions/crm'
import { requireAuth } from '@/lib/auth'

export const metadata = {
    title: "Activity Intelligence | Magnivo AI",
    description: "Real-time global activity auditing and intelligence.",
}

export default async function ActivityLogPage() {
    const bypassAuth = process.env.NEXT_PUBLIC_BYPASS_AUTH === 'true'
    if (!bypassAuth) await requireAuth()

    const { data, total } = await getGlobalActivities({ limit: 20 })

    return <ActivityIntelligenceClient initialActivities={data} initialTotal={total} />
}
