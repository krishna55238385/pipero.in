import { getTasks, getLeads, getOrgMembers } from '@/app/actions/crm'
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import FollowUpsClient from '@/components/followups/FollowUpsClient'

export default async function FollowUpsPage() {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    const { cookies } = await import('next/headers')
    const cookieStore = await cookies()
    const isMockAuth = cookieStore.get('sb-mock-auth')?.value === 'true'
    const bypassAuth = process.env.NEXT_PUBLIC_BYPASS_AUTH === 'true'

    if (!user && !isMockAuth && !bypassAuth) {
        redirect('/login')
    }

    // Fetch current user's role
    let currentUserRole = 'admin' // default to admin for local dev / mock auth
    if (user) {
        const { data: profile } = await supabase
            .from('users')
            .select('role')
            .eq('id', user.id)
            .single()
        if (profile?.role) currentUserRole = profile.role
    }

    const [tasks, leadsRes, members] = await Promise.all([
        getTasks(),
        getLeads(),
        getOrgMembers(),
    ])
    const leads = Array.isArray(leadsRes) ? leadsRes : (leadsRes?.data || [])

    return (
        <FollowUpsClient
            tasks={tasks}
            leads={leads}
            members={members}
            currentUserRole={currentUserRole}
        />
    )
}

