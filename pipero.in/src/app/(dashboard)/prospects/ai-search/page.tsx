import { AiSearchClient } from '@/components/prospects/AiSearchClient'
import { getPhaseRuns } from '@/app/actions/gtm'

export const dynamic = 'force-dynamic'

export default async function AIProspectSearchPage() {
  const runs = await getPhaseRuns(15)
  return <AiSearchClient runs={runs} />
}
