import { getTasks, getLeads, getOrgMembers } from '@/app/actions/crm'
import { getMockableUser } from '@/app/actions/notifications'
import FollowUpsClient from '@/components/followups/FollowUpsClient'
import { requireAuth } from '@/lib/auth'

export default async function FollowUpsPage() {
    const bypassAuth = process.env.NEXT_PUBLIC_BYPASS_AUTH === 'true'
    if (!bypassAuth) await requireAuth()

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
