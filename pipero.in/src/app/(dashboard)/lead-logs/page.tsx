import { getLeadAuditLogs } from '@/app/actions/lead-management'
import { getOrgMembers } from '@/app/actions/crm'
import LeadLogsClient from '@/components/leads/LeadLogsClient'

export default async function LeadLogsPage() {
    const [logs, members] = await Promise.all([
        getLeadAuditLogs(),
        getOrgMembers()
    ])

    return <LeadLogsClient initialLogs={logs} members={members} />
}
