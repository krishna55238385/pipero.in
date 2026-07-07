import { getRepPerformanceData } from '@/app/actions/crm'
import { requireAuth } from '@/lib/auth'
import RepMonitoringClient from '@/components/reps/RepMonitoringClient'

export const metadata = {
    title: "Rep Performance Monitor | Magnivo AI",
    description: "High-fidelity monitoring for sales representative performance, workload, and targets.",
}

export default async function RepMonitorPage() {
    const bypassAuth = process.env.NEXT_PUBLIC_BYPASS_AUTH === 'true'
    if (!bypassAuth) await requireAuth()

    const data = await getRepPerformanceData()

    return <RepMonitoringClient initialData={data} />
}
