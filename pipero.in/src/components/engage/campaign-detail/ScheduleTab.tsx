'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { updateEngageCampaign } from '@/app/actions/engage'
import type { EngageCampaign } from '@/types/engage'

// ISO -> value usable by <input type="datetime-local"> (local time, no TZ suffix).
function toLocalInput(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export default function ScheduleTab({ campaign }: { campaign: EngageCampaign }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [scheduleAt, setScheduleAt] = useState(toLocalInput(campaign.scheduleAt))
  const [dailyLimit, setDailyLimit] = useState(String(campaign.dailyLimit ?? 50))

  const save = () => {
    startTransition(async () => {
      try {
        await updateEngageCampaign(campaign.id, {
          scheduleAt: scheduleAt ? new Date(scheduleAt).toISOString() : campaign.scheduleAt,
          dailyLimit: Math.max(1, Math.trunc(Number(dailyLimit) || 50)),
        })
        toast.success('Schedule saved')
        router.refresh()
      } catch (error: unknown) {
        toast.error(error instanceof Error ? error.message : 'Failed to save schedule')
      }
    })
  }

  return (
    <Card className="rounded-2xl border bg-card">
      <CardHeader className="pb-2">
        <CardTitle>Schedule &amp; throttle</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="detail-schedule" className="text-sm">
              Start sending
            </Label>
            <Input
              id="detail-schedule"
              type="datetime-local"
              value={scheduleAt}
              onChange={(e) => setScheduleAt(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              The worker starts enrolling recipients at this time.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="detail-daily-limit" className="text-sm">
              Daily limit
            </Label>
            <Input
              id="detail-daily-limit"
              type="number"
              min={1}
              value={dailyLimit}
              onChange={(e) => setDailyLimit(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">Max emails sent per day for this campaign.</p>
          </div>
        </div>
        <div>
          <Button type="button" onClick={save} disabled={pending}>
            {pending ? 'Saving…' : 'Save schedule'}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
