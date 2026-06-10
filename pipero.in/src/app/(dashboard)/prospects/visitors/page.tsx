import { VisitorsClient } from '@/components/prospects/VisitorsClient'
import { getVisitorSignals, getGa4Connections } from '@/app/actions/gtm'

export const dynamic = 'force-dynamic'

export default async function AnonymousVisitorsPage() {
  const [visitors, connections] = await Promise.all([
    getVisitorSignals({ limit: 100 }),
    getGa4Connections(),
  ])
  return <VisitorsClient initialVisitors={visitors} initialConnections={connections} />
}
