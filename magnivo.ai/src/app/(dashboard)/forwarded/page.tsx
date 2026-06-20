import { getForwardedLeads, getLeads, getOrgMembers } from '@/app/actions/crm'
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import ForwardedLeadsClient from '@/components/forwarded/ForwardedLeadsClient'
import { cookies } from 'next/headers'

export default async function ForwardedLeadsPage() {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    const cookieStore = await cookies()
    const isMockAuth = cookieStore.get('sb-mock-auth')?.value === 'true'
    const bypassAuth = process.env.NEXT_PUBLIC_BYPASS_AUTH === 'true'

    if (!user && !isMockAuth && !bypassAuth) {
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

