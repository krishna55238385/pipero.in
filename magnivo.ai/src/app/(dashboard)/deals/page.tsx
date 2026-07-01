import { getDeals, getLeads } from '@/app/actions/crm'
import { getPipelineStages } from '@/app/actions/lead-management'
import DealsClient from '@/components/deals/DealsClient'

export default async function DealsPage({ searchParams }: { searchParams: Promise<any> }) {
  const resolvedParams = await searchParams
    // Await params if using Next 15+ 
    // const resolvedParams = await searchParams
    const [deals, response, pipelineStages] = await Promise.all([
    getDeals(resolvedParams.q),
    getLeads(),
    getPipelineStages()
])

    const leads = Array.isArray(response) ? response : (response?.data || [])

    return <DealsClient initialDeals={deals} leads={leads} pipelineStages={pipelineStages} searchParams={searchParams} />
}

