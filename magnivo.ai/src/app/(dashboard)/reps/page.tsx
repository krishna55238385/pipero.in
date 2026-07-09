import { getRepPerformanceData } from '@/app/actions/crm'
import { requireAuth } from '@/lib/auth'
import RepMonitoringClient from '@/components/reps/RepMonitoringClient'
import { redirect } from 'next/navigation'

export const metadata = {
    title: "Rep Performance Monitor | Magnivo AI",
    description: "High-fidelity monitoring for sales representative performance, workload, and targets.",
}

export default async function RepMonitorPage() {
    const bypassAuth = process.env.NEXT_PUBLIC_BYPASS_AUTH === 'true'
    if (!bypassAuth) {
        const session = await requireAuth()
        if (session.role !== 'admin' && session.role !== 'super_admin') {
            redirect('/home')
        }
    }

    const data = await getRepPerformanceData()

    return <RepMonitoringClient initialData={data} />
}
