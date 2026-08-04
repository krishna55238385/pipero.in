'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { MailStatsSkeleton } from '@/components/mail/MailSkeleton'
import { MailPageHeader } from '@/components/mail/MailPageHeader'
import { Inbox } from 'lucide-react'

type MailDashboardClientProps = {
  isLoading?: boolean
}

export default function MailDashboardClient({ isLoading = false }: MailDashboardClientProps) {
  if (isLoading) {
    return (
      <div className="space-y-6">
        <MailPageHeader
          title="Mail Dashboard"
          description="Overview of your mail performance"
        />
        <MailStatsSkeleton />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <MailSkeletonCard />
          <MailSkeletonCard />
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <MailPageHeader
        title="Mail Dashboard"
        description="Overview of your mail performance"
      />
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard title="Total Mailboxes" value="0" description="Connected accounts" />
        <StatCard title="Active Campaigns" value="0" description="Currently running" />
        <StatCard title="Emails Sent" value="0" description="Last 30 days" />
        <StatCard title="Open Rate" value="0%" description="Average across campaigns" />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Recent Activity</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <Inbox className="h-10 w-10 mb-3 opacity-40" />
              <p className="text-sm">No recent activity</p>
              <p className="text-xs mt-1">Connect a mailbox to get started</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Campaign Performance</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <Inbox className="h-10 w-10 mb-3 opacity-40" />
              <p className="text-sm">No campaign data</p>
              <p className="text-xs mt-1">Create a campaign to see performance</p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

function StatCard({
  title,
  value,
  description,
}: {
  title: string
  value: string
  description: string
}) {
  return (
    <Card className="py-4">
      <CardContent className="space-y-1">
        <p className="text-xs font-medium text-muted-foreground">{title}</p>
        <p className="text-2xl font-bold tracking-tight">{value}</p>
        <p className="text-xs text-muted-foreground">{description}</p>
      </CardContent>
    </Card>
  )
}

function MailSkeletonCard() {
  return (
    <Card>
      <CardHeader>
        <div className="h-4 w-32 bg-muted animate-pulse rounded-md" />
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          <div className="h-3 w-full bg-muted animate-pulse rounded-md" />
          <div className="h-3 w-3/4 bg-muted animate-pulse rounded-md" />
        </div>
      </CardContent>
    </Card>
  )
}
