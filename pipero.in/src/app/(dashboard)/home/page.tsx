import { getDeals, getLeads, getActivities, getAnalytics, getTasks, getTeamPerformance, getCurrentUser } from '@/app/actions/crm'
import DashboardClient from '@/components/dashboard/DashboardClient'

export default async function DashboardPage() {
    // Fetch live data from Supabase backend
    const deals = await getDeals()
    const leadsRes = await getLeads()
    const leads = Array.isArray(leadsRes) ? leadsRes : (leadsRes?.data || [])
    const activities = await getActivities(5) // Limit to 5 recent activities

    // Fetch new rich dashboard data
    const analytics = await getAnalytics(30)
    const upcomingTasks = await getTasks() // gets all relevant tasks based on user role
    const teamStatus = await getTeamPerformance() ?? undefined

    // Get user for greeting
    const user = await getCurrentUser()

    return (
        <DashboardClient
            user={user}
            deals={deals}
            leads={leads}
            activities={activities}
            analytics={analytics}
            upcomingTasks={upcomingTasks}
            teamStatus={teamStatus}
        />
    )
}

