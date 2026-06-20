import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import {
    getOrganizationDetails,
    getUsersHubData,
    getIntegrations,
    getCurrentUser
} from '@/app/actions/crm'
import SettingsContainer from '@/components/settings/SettingsContainer'

export const metadata = {
    title: "Settings | Magnivo AI",
    description: "Manage your personal and workspace settings.",
}

export default async function SettingsPage() {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    const { cookies } = await import('next/headers')
    const cookieStore = await cookies()
    const isMockAuth = cookieStore.get('sb-mock-auth')?.value === 'true'
    const bypassAuth = process.env.NEXT_PUBLIC_BYPASS_AUTH === 'true'

    if (!user && !isMockAuth && !bypassAuth) {
        redirect('/login')
    }

    const [org, hubData, integrations, currentUser] = await Promise.all([
        getOrganizationDetails(),
        getUsersHubData(),
        getIntegrations(),
        getCurrentUser()
    ])

    return (
        <SettingsContainer
            currentUser={currentUser}
            initialOrg={org}
            initialMembers={hubData.users}
            initialInvites={hubData.invites}
        />
    )
}

