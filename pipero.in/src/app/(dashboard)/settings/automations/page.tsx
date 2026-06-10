import { getFlows, getAutomationRuns } from '@/app/actions/automation'
import AutomationsClient from '../../../../components/settings/AutomationsClient'

export default async function AutomationsPage() {
    const [flows, runs] = await Promise.all([
        getFlows(),
        getAutomationRuns()
    ])

    return <AutomationsClient initialFlows={flows} initialRuns={runs} />
}
