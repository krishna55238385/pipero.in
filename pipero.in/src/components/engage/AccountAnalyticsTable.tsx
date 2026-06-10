import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import type { EngageAccountStats } from '@/types/engage'

const fmt = (n: number) => n.toLocaleString()

function relativeTime(iso: string | null): string {
  if (!iso) return 'Never'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return 'Never'
  const diffMs = Date.now() - date.getTime()
  if (diffMs < 0) return 'Just now'
  const mins = Math.floor(diffMs / 60_000)
  if (mins < 1) return 'Just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d ago`
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

export default function AccountAnalyticsTable({
  accounts,
}: {
  accounts: EngageAccountStats[]
}) {
  return (
    <Card className="rounded-2xl border bg-card">
      <CardHeader className="pb-2">
        <CardTitle>Account analytics</CardTitle>
      </CardHeader>
      <CardContent>
        {accounts.length === 0 ? (
          <div className="rounded-xl border border-dashed p-8 text-center">
            <p className="text-sm text-muted-foreground">
              No mailbox connected. Connect an email account in Engage settings to start sending and tracking.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
          <Table className="min-w-[640px]">
            <TableHeader>
              <TableRow>
                <TableHead>Email account</TableHead>
                <TableHead>Provider</TableHead>
                <TableHead>Sync</TableHead>
                <TableHead>Last synced</TableHead>
                <TableHead className="text-right">Sent</TableHead>
                <TableHead className="text-right">Opens</TableHead>
                <TableHead className="text-right">Replies</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {accounts.map((a) => (
                <TableRow key={a.email}>
                  <TableCell className="font-medium">{a.email}</TableCell>
                  <TableCell className="capitalize">{a.provider}</TableCell>
                  <TableCell>
                    {a.watchActive ? (
                      <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400">
                        Push active
                      </Badge>
                    ) : (
                      <Badge variant="secondary">Polling</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {relativeTime(a.lastSyncedAt)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{fmt(a.sent)}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmt(a.opens)}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmt(a.replies)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
