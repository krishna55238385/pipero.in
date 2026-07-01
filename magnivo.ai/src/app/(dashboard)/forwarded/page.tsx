import { getForwardedLeads, getLeads, getOrgMembers } from '@/app/actions/crm'
import { redirect } from 'next/navigation'
import ForwardedLeadsClient from '@/components/forwarded/ForwardedLeadsClient'
import { cookies } from 'next/headers'
import { currentUser } from '@clerk/nextjs/server'

export default async function ForwardedLeadsPage() {
    const cookieStore = await cookies()
    const isMockAuth = cookieStore.get('sb-mock-auth')?.value === 'true'
    const bypassAuth = process.env.NEXT_PUBLIC_BYPASS_AUTH === 'true'
    const clerkUser = await currentUser()

    if (!clerkUser && !isMockAuth && !bypassAuth) {
        redirect('/login')
    }

    const [forwarded, leadsRes, members] = await Promise.all([
        getForwardedLeads(),
        getLeads(),
        getOrgMembers(),
    ])
    const leads = Array.isArray(leadsRes) ? leadsRes : (leadsRes?.data || [])

    return (
        <ForwardedLeadsClient
            initialReceived={(forwarded as any).received ?? []}
            initialSent={(forwarded as any).sent ?? []}
            leads={leads}
            members={members}
        />
    )
}
