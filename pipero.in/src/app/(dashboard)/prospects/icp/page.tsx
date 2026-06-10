import { IcpClient } from '@/components/prospects/IcpClient'
import { getIcps, getPhaseRuns, getMarketSizing } from '@/app/actions/gtm'

export const dynamic = 'force-dynamic'

export default async function IcpPage() {
  const [icps, runs, market] = await Promise.all([
    getIcps(),
    getPhaseRuns(20),
    getMarketSizing(),
  ])
  return <IcpClient icps={icps} runs={runs} market={market} />
}
