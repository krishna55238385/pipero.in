import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { getLeadGtmData, getProspectLeadById, getSignalsForLead } from '@/app/actions/gtm'
import { ProspectLeadDetail } from '@/components/prospects/ProspectLeadDetail'

export const dynamic = 'force-dynamic'

export default async function ProspectLeadDetailPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params
  const leadId = Number(params.id)

  if (!Number.isFinite(leadId)) {
    return <NotFound />
  }

  const [lead, gtm, signals] = await Promise.all([
    getProspectLeadById(leadId),
    getLeadGtmData(leadId),
    getSignalsForLead(leadId),
  ])

  if (!lead) return <NotFound />

  return <ProspectLeadDetail lead={lead} gtm={gtm} signals={signals} />
}

function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center h-[50vh] space-y-4">
      <h1 className="text-2xl font-bold">Prospect lead not found</h1>
      <Link href="/prospects/leads">
        <Button variant="outline">
          <ArrowLeft className="mr-2 h-4 w-4" /> Back to Prospect Leads
        </Button>
      </Link>
    </div>
  )
}
