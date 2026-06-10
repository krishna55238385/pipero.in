import { getLeadById, getActivities, getTasks, getOrgMembers } from '@/app/actions/crm'
import { getLeadStatuses } from '@/app/actions/lead-management'
import { getGtmDataForCrmLead } from '@/app/actions/gtm'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { ArrowLeft } from "lucide-react"
import LeadDetailClient from '@/components/leads/LeadDetailClient'
import { GtmIntelligence } from '@/components/leads/GtmIntelligence'

export const dynamic = 'force-dynamic'

export default async function LeadDetailPage(props: { params: Promise<{ id: string }> }) {
    const params = await props.params
    const [lead, activities, tasks, members, leadStatuses, gtmData] = await Promise.all([
        getLeadById(params.id),
        getActivities(10, params.id),
        getTasks(params.id),
        getOrgMembers(),
        getLeadStatuses(),
        getGtmDataForCrmLead(params.id)
    ])

    if (!lead) {
        return (
            <div className="flex flex-col items-center justify-center h-[50vh] space-y-4">
                <h1 className="text-2xl font-bold">Lead Not Found</h1>
                <Link href="/leads">
                    <Button variant="outline"><ArrowLeft className="mr-2 h-4 w-4" /> Back to Leads</Button>
                </Link>
            </div>
        )
    }

    return (
        <div className="space-y-6">
            <LeadDetailClient lead={lead} activities={activities} tasks={tasks} members={members} leadStatuses={leadStatuses} />
            <div className="max-w-6xl mx-auto px-0">
                <GtmIntelligence data={gtmData} />
            </div>
        </div>
    )
}
