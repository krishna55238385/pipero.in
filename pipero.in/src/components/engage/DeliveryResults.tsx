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
import type { DeliveryStats } from '@/types/engage'

const fmt = (n: number) => n.toLocaleString()

const SOURCE_META: Record<
  DeliveryStats['source'],
  { label: string; className: string }
> = {
  campaign: {
    label: 'Manual',
    className: 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-400',
  },
  gtm: {
    label: 'Auto (AI pipeline)',
    className:
      'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400',
  },
  manual: {
    label: 'Composer',
    className:
      'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  },
}

export default function DeliveryResults({ rows }: { rows: DeliveryStats[] }) {
  return (
    <Card className="rounded-2xl border bg-card">
      <CardHeader className="pb-2">
        <CardTitle>Delivery results</CardTitle>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <div className="rounded-xl border border-dashed p-8 text-center">
            <p className="text-sm text-muted-foreground">
              No sends recorded in this period.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
          <Table className="min-w-[640px]">
            <TableHeader>
              <TableRow>
                <TableHead>Campaign</TableHead>
                <TableHead>Source</TableHead>
                <TableHead className="text-right">Attempted</TableHead>
                <TableHead className="text-right">Sent</TableHead>
                <TableHead className="text-right">Failed</TableHead>
                <TableHead className="text-right">Skipped</TableHead>
                <TableHead className="w-44">Sent rate</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => {
                const meta = SOURCE_META[r.source]
                const sentRate =
                  r.attempted > 0
                    ? Math.min(100, (r.sent / r.attempted) * 100)
                    : 0
                return (
                  <TableRow key={r.campaignId}>
                    <TableCell
                      className="max-w-64 truncate font-medium"
                      title={r.name}
                    >
                      {r.name}
                    </TableCell>
                    <TableCell>
                      <Badge className={meta.className}>{meta.label}</Badge>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {fmt(r.attempted)}
                    </TableCell>
                    <TableCell className="text-right font-medium tabular-nums text-green-600 dark:text-green-400">
                      {fmt(r.sent)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-red-600 dark:text-red-400">
                      {fmt(r.failed)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-amber-600 dark:text-amber-400">
                      {fmt(r.skipped)}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Progress value={sentRate} className="h-1.5 w-20" />
                        <span className="text-xs tabular-nums text-muted-foreground">
                          {sentRate.toFixed(0)}%
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
