import { VisitorsClient } from '@/components/prospects/VisitorsClient'
import { InboundCapturesCard } from '@/components/prospects/InboundCapturesCard'
import { getVisitorSignals, getGa4Connections, getInboundSignalCaptures } from '@/app/actions/gtm'

export const dynamic = 'force-dynamic'

export default async function AnonymousVisitorsPage() {
  const [visitors, connections, captures] = await Promise.all([
    getVisitorSignals({ limit: 100 }),
    getGa4Connections(),
    getInboundSignalCaptures(50),
  ])
  return (
    <div className="space-y-6">
      <VisitorsClient initialVisitors={visitors} initialConnections={connections} />
      <InboundCapturesCard captures={captures} />
    </div>
  )
}
