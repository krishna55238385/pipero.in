import { getLeads, getLeadFilterOptions } from '@/app/actions/crm'
import { getLeadStatuses, getLeadManagementSettings, getLeadDuplicates } from '@/app/actions/lead-management'
import LeadsClient from '@/components/leads/LeadsClient'
import DuplicatesPanel from '@/components/leads/DuplicatesPanel'

export default async function LeadsPage({ searchParams }: { searchParams: Promise<{ q?: string, temperature?: string, status?: string, source?: string, subject?: string, campaign?: string, owner_id?: string, dateRange?: string, dateFrom?: string, dateTo?: string, page?: string, pageSize?: string }> }) {
    // Fetch live data from Supabase backend based on URL filters
    const resolvedParams = await searchParams
    const page = parseInt(resolvedParams.page || '1')
    const pageSize = parseInt(resolvedParams.pageSize || '20')

    const [response, leadStatuses, settings, filterOptions, duplicates] = await Promise.all([
        getLeads({ ...resolvedParams, page, pageSize }),
        getLeadStatuses(),
        getLeadManagementSettings(),
        getLeadFilterOptions(),
        getLeadDuplicates()
    ])

    const leads = response?.data || []
    const totalCount = response?.count || 0

    return (
        <>
            <LeadsClient
                initialLeads={leads}
                totalCount={totalCount}
                leadStatuses={leadStatuses}
                searchParams={{ ...resolvedParams, page, pageSize }}
                settings={settings}
                filterOptions={filterOptions}
            />
            <div className="mt-6">
                <DuplicatesPanel initialDuplicates={duplicates as any} />
            </div>
        </>
    )
}

