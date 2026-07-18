import { Sidebar } from '@/components/layout/Sidebar'
import { GlobalHeader } from '@/components/layout/GlobalHeader'
import { redirect } from 'next/navigation'
import { getOrganizationDetails, getCurrentUser } from '@/app/actions/crm'
import { WorkspaceProvider } from '@/components/providers/WorkspaceProvider';
import { MainContent } from '@/components/layout/MainContent'

export default async function DashboardLayout({
    children,
}: {
    children: React.ReactNode
}) {
    const bypassAuth = process.env.NEXT_PUBLIC_BYPASS_AUTH === 'true'

    let user: Awaited<ReturnType<typeof getCurrentUser>> = null
    let org: Awaited<ReturnType<typeof getOrganizationDetails>> = null
    try {
        user = await getCurrentUser()
        org = await getOrganizationDetails()
    } catch (e) {
        if (process.env.NODE_ENV === 'development') console.warn('Dashboard layout auth/org failed', e)
        if (bypassAuth) {
            user = { id: 'bypass', full_name: 'User', role: 'admin', organization_id: '', permissions: null }
            org = { name: 'Workspace', currency: 'USD', timezone: 'UTC' }
        }
    }

    if (!user && !bypassAuth) {
        redirect('/login')
    }
    if (!user && bypassAuth) {
        user = { id: 'bypass', full_name: 'User', role: 'admin', organization_id: '', permissions: null }
    }
    if (!org) {
        org = { name: 'Workspace', currency: 'USD', timezone: 'UTC' }
    }

    return (
        <WorkspaceProvider
            workspaceName={org?.name}
            currency={org?.currency}
            timezone={org?.timezone}
            userRole={user?.role}
            permissions={user?.permissions || {}}
        >
            <div className="flex h-screen overflow-hidden bg-background text-foreground selection:bg-primary/20">
                <Sidebar workspaceName={org?.name || 'Workspace'} />
                <div className="flex flex-col flex-1 overflow-hidden bg-background">
                    <GlobalHeader />
                    <MainContent>
                        {children}
                    </MainContent>
                </div>
            </div>
        </WorkspaceProvider>
    )
}
