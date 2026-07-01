import { getTasks, getLeads, getOrgMembers } from '@/app/actions/crm'
import { getMockableUser } from '@/app/actions/notifications'
import { redirect } from 'next/navigation'
import FollowUpsClient from '@/components/followups/FollowUpsClient'
import { cookies } from 'next/headers'
import { currentUser } from '@clerk/nextjs/server'

export default async function FollowUpsPage() {
    const cookieStore = await cookies()
    const isMockAuth = cookieStore.get('sb-mock-auth')?.value === 'true'
    const bypassAuth = process.env.NEXT_PUBLIC_BYPASS_AUTH === 'true'
    const clerkUser = await currentUser()

    if (!clerkUser && !isMockAuth && !bypassAuth) {
        redirect('/login')
    }

    const mockUser = await getMockableUser()
    const currentUserRole: string = mockUser?.role || 'admin'

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
