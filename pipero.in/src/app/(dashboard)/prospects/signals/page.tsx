import { SignalsClient } from '@/components/prospects/SignalsClient'
import { getSignalSummary, getRecentSignals } from '@/app/actions/gtm'

export const dynamic = 'force-dynamic'

export default async function SignalsPage() {
  const [summary, recent] = await Promise.all([getSignalSummary(), getRecentSignals(80)])
  return <SignalsClient summary={summary} recent={recent} />
}
