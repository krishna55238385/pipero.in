import {
    getOrganizationDetails,
    getUsersHubData,
    getIntegrations,
    getCurrentUser
} from '@/app/actions/crm'
import { requireAuth } from '@/lib/auth'
import SettingsContainer from '@/components/settings/SettingsContainer'

export const metadata = {
    title: "Settings | Magnivo AI",
    description: "Manage your personal and workspace settings.",
}

export default async function SettingsPage() {
    const bypassAuth = process.env.NEXT_PUBLIC_BYPASS_AUTH === 'true'
    if (!bypassAuth) await requireAuth()

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
