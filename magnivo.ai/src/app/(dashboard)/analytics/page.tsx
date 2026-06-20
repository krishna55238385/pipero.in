import { getAnalytics } from '@/app/actions/crm'
import { getLlmUsageSummary, getMarketSizing, getIcps } from '@/app/actions/gtm'
import AnalyticsClient from '@/components/analytics/AnalyticsClient'
import GtmAnalytics from '@/components/analytics/GtmAnalytics'

export const dynamic = 'force-dynamic'

export default async function AnalyticsPage(props: { searchParams: Promise<{ days?: string }> }) {
    const searchParams = await props.searchParams
    const days = searchParams.days ? parseInt(searchParams.days) : 30
    const [data, usage, market, icps] = await Promise.all([
        getAnalytics(days),
        getLlmUsageSummary(),
        getMarketSizing(),
        getIcps(),
    ])

    return (
        <>
            <AnalyticsClient data={data} currentDays={days.toString()} />
            <div className="max-w-7xl mx-auto px-0 pb-12">
                <GtmAnalytics usage={usage} market={market} icps={icps} />
            </div>
        </>
    )
}
