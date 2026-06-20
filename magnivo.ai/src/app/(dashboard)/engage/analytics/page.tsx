import Link from 'next/link'
import { getEngageAnalytics, getOutreachDeliveryStats } from '@/app/actions/engage'
import type { EngageAnalyticsData, DeliveryStats } from '@/types/engage'
import AnalyticsCards from '@/components/engage/AnalyticsCards'
import AnalyticsChart from '@/components/engage/AnalyticsChart'
import CampaignAnalyticsTable from '@/components/engage/CampaignAnalyticsTable'
import AccountAnalyticsTable from '@/components/engage/AccountAnalyticsTable'
import DeliveryResults from '@/components/engage/DeliveryResults'
import { cn } from '@/lib/utils'

const RANGES = [7, 30, 90] as const
type RangeDays = (typeof RANGES)[number]

const EMPTY: EngageAnalyticsData = {
  totals: {
    sends: 0, opens: 0, uniqueOpens: 0, clicks: 0, uniqueClicks: 0,
    replies: 0, uniqueReplies: 0, unsubscribes: 0, opportunities: 0,
  },
  openRate: 0,
  clickRate: 0,
  replyRate: 0,
  unsubscribeRate: 0,
  timeSeries: [],
  campaigns: [],
  accounts: [],
}

export default async function EngageAnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string }>
}) {
  const params = await searchParams
  const parsed = Number(params.days)
  const days: RangeDays = (RANGES as readonly number[]).includes(parsed) ? (parsed as RangeDays) : 30

  let analytics: EngageAnalyticsData = EMPTY
  let delivery: DeliveryStats[] = []
  try {
    const [analyticsResult, deliveryResult] = await Promise.all([
      getEngageAnalytics(days),
      getOutreachDeliveryStats(days),
    ])
    analytics = analyticsResult
    delivery = deliveryResult
  } catch {
    // No connected org / not authenticated yet — render clean empty state.
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Engage Analytics</h1>
          <p className="text-sm text-muted-foreground">
            Email outreach performance across campaigns and connected accounts.
          </p>
        </div>
        <div className="flex items-center gap-1 rounded-xl border bg-card p-1">
          {RANGES.map((r) => (
            <Link
              key={r}
              href={`/engage/analytics?days=${r}`}
              aria-current={r === days ? 'page' : undefined}
              className={cn(
                'rounded-lg px-3 py-1.5 text-sm font-medium transition-colors',
                r === days
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
              )}
            >
              Last {r} days
            </Link>
          ))}
        </div>
      </div>

      <AnalyticsCards data={analytics} />

      <AnalyticsChart data={analytics.timeSeries} />

      <CampaignAnalyticsTable campaigns={analytics.campaigns} />

      <AccountAnalyticsTable accounts={analytics.accounts} />

      <DeliveryResults rows={delivery} />
    </div>
  )
}
