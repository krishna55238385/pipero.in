import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import { currentUser } from '@clerk/nextjs/server'
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
    const cookieStore = await cookies()
    const isMockAuth = cookieStore.get('sb-mock-auth')?.value === 'true'
    const bypassAuth = process.env.NEXT_PUBLIC_BYPASS_AUTH === 'true'
    const clerkUser = await currentUser()

    if (!clerkUser && !isMockAuth && !bypassAuth) {
        redirect('/login')
    }

    const [org, hubData, , currentUserData] = await Promise.all([
        getOrganizationDetails(),
        getUsersHubData(),
        getIntegrations(),
        getCurrentUser()
    ])

    return (
        <SettingsContainer
            currentUser={currentUserData}
            initialOrg={org}
            initialMembers={hubData.users}
            initialInvites={hubData.invites}
        />
    )
}
