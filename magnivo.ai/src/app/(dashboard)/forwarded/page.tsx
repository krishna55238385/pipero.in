import { getForwardedLeads, getLeads, getOrgMembers } from '@/app/actions/crm'
import ForwardedLeadsClient from '@/components/forwarded/ForwardedLeadsClient'
import { requireAuth } from '@/lib/auth'

export default async function ForwardedLeadsPage() {
    const bypassAuth = process.env.NEXT_PUBLIC_BYPASS_AUTH === 'true'
    if (!bypassAuth) await requireAuth()

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
