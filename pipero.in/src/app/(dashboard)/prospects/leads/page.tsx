import { ProspectLeadsClient } from '@/components/prospects/ProspectLeadsClient'
import { getIcps, getProspectLeads } from '@/app/actions/gtm'

export const dynamic = 'force-dynamic'

export default async function ProspectLeadsPage() {
  const [{ data, count }, icps] = await Promise.all([
    getProspectLeads({ page: 1, pageSize: 25 }),
    getIcps(),
  ])
  return <ProspectLeadsClient initialLeads={data} initialCount={count} icps={icps} />
}
