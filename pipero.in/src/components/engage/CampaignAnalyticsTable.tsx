import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import type { EngageCampaignStats } from '@/types/engage'

const fmt = (n: number) => n.toLocaleString()

function statusVariant(status: string): 'default' | 'secondary' | 'outline' | 'destructive' {
  switch (status) {
    case 'running':
      return 'default'
    case 'scheduled':
    case 'completed':
      return 'secondary'
    case 'draft':
      return 'outline'
    default:
      return 'outline'
  }
}

export default function CampaignAnalyticsTable({
  campaigns,
}: {
  campaigns: EngageCampaignStats[]
}) {
  return (
    <Card className="rounded-2xl border bg-card">
      <CardHeader className="pb-2">
        <CardTitle>Campaign analytics</CardTitle>
      </CardHeader>
      <CardContent>
        {campaigns.length === 0 ? (
          <div className="rounded-xl border border-dashed p-8 text-center">
            <p className="text-sm text-muted-foreground">
              No campaign activity yet. Launch a campaign from Engage to see per-campaign performance here.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
          <Table className="min-w-[760px]">
            <TableHeader>
              <TableRow>
                <TableHead>Campaign</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Recipients</TableHead>
                <TableHead className="text-right">Sent</TableHead>
                <TableHead className="text-right">Opens</TableHead>
                <TableHead className="text-right">Clicks</TableHead>
                <TableHead className="text-right">Replies</TableHead>
                <TableHead className="text-right">Opportunities</TableHead>
                <TableHead className="w-44">Progress</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {campaigns.map((c) => {
                const progressPct =
                  c.recipients > 0 ? Math.min(100, (c.completed / c.recipients) * 100) : 0
                return (
                  <TableRow key={c.campaignId}>
                    <TableCell className="max-w-64 truncate font-medium" title={c.name}>
                      {c.name}
                    </TableCell>
                    <TableCell>
                      <Badge variant={statusVariant(c.status)} className="capitalize">
                        {c.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{fmt(c.recipients)}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmt(c.sent)}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {fmt(c.uniqueOpens)}
                      <span className="text-muted-foreground"> / {fmt(c.opens)}</span>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {fmt(c.uniqueClicks)}
                      <span className="text-muted-foreground"> / {fmt(c.clicks)}</span>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{fmt(c.replies)}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmt(c.opportunities)}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Progress value={progressPct} className="h-2 w-20" />
                        <span className="text-xs tabular-nums text-muted-foreground">
                          {fmt(c.completed)}/{fmt(c.recipients)}
                        </span>
                      </div>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
