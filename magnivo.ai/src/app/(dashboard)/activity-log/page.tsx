import ActivityIntelligenceClient from '@/components/dashboard/ActivityIntelligenceClient'
import { getGlobalActivities } from '@/app/actions/crm'
import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import { currentUser } from '@clerk/nextjs/server'

export const metadata = {
    title: "Activity Intelligence | Magnivo AI",
    description: "Real-time global activity auditing and intelligence.",
}

export default async function ActivityLogPage() {
    const cookieStore = await cookies()
    const isMockAuth = cookieStore.get('sb-mock-auth')?.value === 'true'
    const bypassAuth = process.env.NEXT_PUBLIC_BYPASS_AUTH === 'true'
    const clerkUser = await currentUser()

    if (!clerkUser && !isMockAuth && !bypassAuth) {
        redirect('/login')
    }

    const { data, total } = await getGlobalActivities({ limit: 20 })

    return <ActivityIntelligenceClient initialActivities={data} initialTotal={total} />
}
