import { getTasks, getLeads, getDeals, getOrgMembers } from '@/app/actions/crm'
import { getMockableUser } from '@/app/actions/notifications'
import TasksClient from '@/components/tasks/TasksClient'

export default async function TasksPage(props: { searchParams: Promise<{ repId?: string }> }) {
    const searchParams = await props.searchParams
    const repId = searchParams.repId

    const tasks = await getTasks(undefined, repId)
    const leadsRes = await getLeads()
    const leads = Array.isArray(leadsRes) ? leadsRes : (leadsRes?.data || [])
    const deals = await getDeals()
    const members = await getOrgMembers()

    const user = await getMockableUser()
    const isAdmin = user?.role === 'admin' || user?.role === 'super_admin'

    return <TasksClient initialTasks={tasks} leads={leads} deals={deals} members={members} isAdmin={isAdmin} currentRepId={repId} />
}
