import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import { currentUser } from '@clerk/nextjs/server'
import { getRepPerformanceData } from '@/app/actions/crm'
import RepMonitoringClient from '@/components/reps/RepMonitoringClient'

export const metadata = {
    title: "Rep Performance Monitor | Magnivo AI",
    description: "High-fidelity monitoring for sales representative performance, workload, and targets.",
}

export default async function RepMonitorPage() {
    const cookieStore = await cookies()
    const isMockAuth = cookieStore.get('sb-mock-auth')?.value === 'true'
    const bypassAuth = process.env.NEXT_PUBLIC_BYPASS_AUTH === 'true'
    const clerkUser = await currentUser()

    if (!clerkUser && !isMockAuth && !bypassAuth) {
        redirect('/login')
    }

    const data = await getRepPerformanceData()

    return <RepMonitoringClient initialData={data} />
}
