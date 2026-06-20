import { CompetitorsClient } from '@/components/prospects/CompetitorsClient'
import { getIcps, getCompetitors } from '@/app/actions/gtm'
import type { CompetitorIntel } from '@/types/gtm'

export const dynamic = 'force-dynamic'

export default async function CompetitorsPage() {
  const icps = await getIcps()

  // Competitor intelligence is keyed by ICP. Load each ICP's competitors up
  // front (there are only a handful of ICPs) so the client can switch instantly.
  const competitorsByIcp: Record<number, CompetitorIntel[]> = {}
  await Promise.all(
    icps.map(async (icp) => {
      competitorsByIcp[icp.id] = await getCompetitors(icp.id)
    }),
  )

  return <CompetitorsClient icps={icps} competitorsByIcp={competitorsByIcp} />
}
