import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getRepPerformanceData } from '@/app/actions/crm'
import RepMonitoringClient from '@/components/reps/RepMonitoringClient'

export const metadata = {
    title: "Rep Performance Monitor | Magnivo AI",
    description: "High-fidelity monitoring for sales representative performance, workload, and targets.",
}

export default async function RepMonitorPage() {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    const { cookies } = await import('next/headers')
    const cookieStore = await cookies()
    const isMockAuth = cookieStore.get('sb-mock-auth')?.value === 'true'
    const bypassAuth = process.env.NEXT_PUBLIC_BYPASS_AUTH === 'true'

    if (!user && !isMockAuth && !bypassAuth) {
        redirect('/login')
    }

    const data = await getRepPerformanceData()

    return <RepMonitoringClient initialData={data} />
}

