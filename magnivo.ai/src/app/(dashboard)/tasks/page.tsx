import { getTasks, getLeads, getDeals, getOrgMembers } from '@/app/actions/crm'
import { getMockableUser } from '@/app/actions/notifications'
import { createClient } from '@/lib/supabase/server'
import TasksClient from '@/components/tasks/TasksClient'

export default async function TasksPage(props: { searchParams: Promise<{ repId?: string }> }) {
    const searchParams = await props.searchParams
    const repId = searchParams.repId

    // Fetch live data
    const tasks = await getTasks(undefined, repId)
    const leadsRes = await getLeads()
    const leads = Array.isArray(leadsRes) ? leadsRes : (leadsRes?.data || [])
    const deals = await getDeals()

    // Get org members for assignment and filtering
    const members = await getOrgMembers()

    // Determine if admin
    let isAdmin = false
    const supabase = await createClient()
    const user = await getMockableUser()
    if (user) {
        const { data: userData } = await supabase.from('users').select('role').eq('id', user.id).single()
        isAdmin = userData?.role === 'admin' || userData?.role === 'super_admin'
    }

    return <TasksClient initialTasks={tasks} leads={leads} deals={deals} members={members} isAdmin={isAdmin} currentRepId={repId} />
}

