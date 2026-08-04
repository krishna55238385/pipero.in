'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { EngageProductShell, EngageLoading } from '@/components/mail/EngageProductShell'
import { getEngageOverviewAction } from '@/app/actions/mail'
import {
  ArrowRight,
  Inbox,
  Mail,
  Megaphone,
  Shield,
  Flame,
  Users,
  Activity,
} from 'lucide-react'

const QUICK_LINKS = [
  { href: '/engage/accounts', label: 'Accounts', icon: Mail, desc: 'Connect & diagnose mailboxes' },
  { href: '/engage/warmup', label: 'Warmup', icon: Flame, desc: 'Ramp reputation safely' },
  { href: '/engage/campaigns', label: 'Campaigns', icon: Megaphone, desc: 'Launch sequences at scale' },
  { href: '/engage/deliverability', label: 'Deliverability', icon: Shield, desc: 'DNS, reputation, blacklists' },
  { href: '/engage/inbox', label: 'Inbox', icon: Inbox, desc: 'Replies & classification' },
  { href: '/engage/leads', label: 'Leads', icon: Users, desc: 'Lists, verify, suppress' },
  { href: '/engage/reports', label: 'Reports', icon: Activity, desc: 'Export performance CSVs' },
  { href: '/engage/operations', label: 'Operations', icon: Activity, desc: 'Queue, keys, webhooks' },
]

export default function EngageOverviewClient() {
  const [data, setData] = useState<Awaited<ReturnType<typeof getEngageOverviewAction>>>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    void getEngageOverviewAction()
      .then(setData)
      .finally(() => setLoading(false))
  }, [])

  if (loading) {
    return (
      <EngageProductShell title="Engage Overview" description="Enterprise outreach command center">
        <EngageLoading />
      </EngageProductShell>
    )
  }

  const stats = [
    { label: 'Mailboxes', value: data?.mailboxes.total ?? 0, hint: `${data?.mailboxes.connected ?? 0} connected` },
    { label: 'Reconnect needed', value: data?.mailboxes.reconnectRequired ?? 0, tone: (data?.mailboxes.reconnectRequired ?? 0) > 0 ? 'warn' as const : 'good' as const },
    { label: 'Campaigns running', value: data?.campaigns.running ?? 0, hint: `${data?.campaigns.total ?? 0} total` },
    { label: 'Warmup running', value: data?.warmup.running ?? 0, hint: `${data?.warmup.graduated ?? 0} graduated` },
    { label: 'Leads', value: data?.leads.total ?? 0, hint: `${data?.leads.valid ?? 0} valid` },
    { label: 'Domains healthy', value: data?.deliverability.healthy ?? 0, hint: `${data?.deliverability.domains ?? 0} total` },
    { label: 'Sent today', value: data?.sending.sentToday ?? 0, hint: `${data?.sending.pendingJobs ?? 0} queued` },
    { label: 'Inbox review', value: data?.inbox.needsReview ?? 0, hint: `${data?.inbox.unreadThreads ?? 0} unread` },
  ]

  return (
    <EngageProductShell
      title="Engage Overview"
      description="Instantly-class outreach workspace — accounts, warmup, campaigns, deliverability, and hygiene"
      stats={stats}
      actions={
        <div className="flex gap-2">
          <Button asChild size="sm">
            <Link href="/engage/accounts">Add account</Link>
          </Button>
          <Button asChild size="sm" variant="outline">
            <Link href="/engage/campaigns">New campaign</Link>
          </Button>
        </div>
      }
    >
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {QUICK_LINKS.map((item) => (
          <Link key={item.href} href={item.href} className="group">
            <Card className="h-full transition-colors group-hover:border-primary/40">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center justify-between gap-2">
                  <span className="flex items-center gap-2">
                    <item.icon className="h-4 w-4" />
                    {item.label}
                  </span>
                  <ArrowRight className="h-3.5 w-3.5 opacity-0 group-hover:opacity-100 transition-opacity" />
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-xs text-muted-foreground">{item.desc}</p>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Attention required</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {(data?.mailboxes.reconnectRequired ?? 0) > 0 ? (
            <Link href="/engage/accounts" className="flex justify-between rounded-md border px-3 py-2 hover:bg-muted/40">
              <span>{data!.mailboxes.reconnectRequired} mailbox(es) need reconnect</span>
              <span className="text-muted-foreground">Open accounts →</span>
            </Link>
          ) : (
            <p className="text-muted-foreground text-xs">No reconnect alerts</p>
          )}
          {(data?.deliverability.listed ?? 0) > 0 && (
            <Link href="/engage/deliverability" className="flex justify-between rounded-md border px-3 py-2 hover:bg-muted/40">
              <span>{data!.deliverability.listed} domain(s) on blacklist</span>
              <span className="text-muted-foreground">Deliverability →</span>
            </Link>
          )}
          {(data?.sending.failedJobs ?? 0) > 0 && (
            <Link href="/engage/operations" className="flex justify-between rounded-md border px-3 py-2 hover:bg-muted/40">
              <span>{data!.sending.failedJobs} failed send job(s)</span>
              <span className="text-muted-foreground">Operations →</span>
            </Link>
          )}
          {(data?.inbox.needsReview ?? 0) > 0 && (
            <Link href="/engage/inbox" className="flex justify-between rounded-md border px-3 py-2 hover:bg-muted/40">
              <span>{data!.inbox.needsReview} thread(s) need human review</span>
              <span className="text-muted-foreground">Inbox →</span>
            </Link>
          )}
        </CardContent>
      </Card>
    </EngageProductShell>
  )
}
