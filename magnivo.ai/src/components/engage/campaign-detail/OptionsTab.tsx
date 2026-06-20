'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { updateEngageCampaign } from '@/app/actions/engage'
import type { EngageCampaign } from '@/types/engage'

export default function OptionsTab({ campaign }: { campaign: EngageCampaign }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [stopOnReply, setStopOnReply] = useState(campaign.stopOnReply ?? true)
  const [openTracking, setOpenTracking] = useState(campaign.openTracking ?? true)
  const [linkTracking, setLinkTracking] = useState(campaign.linkTracking ?? true)

  const save = () => {
    startTransition(async () => {
      try {
        await updateEngageCampaign(campaign.id, {
          stopOnReply,
          openTracking,
          linkTracking,
        })
        toast.success('Options saved')
        router.refresh()
      } catch (error: unknown) {
        toast.error(error instanceof Error ? error.message : 'Failed to save options')
      }
    })
  }

  const toggles: Array<{ label: string; desc: string; value: boolean; set: (v: boolean) => void }> = [
    { label: 'Stop on reply', desc: 'Halt the sequence for a recipient once they reply.', value: stopOnReply, set: setStopOnReply },
    { label: 'Open tracking', desc: 'Insert a tracking pixel to measure opens.', value: openTracking, set: setOpenTracking },
    { label: 'Link tracking', desc: 'Rewrite links to measure clicks.', value: linkTracking, set: setLinkTracking },
  ]

  return (
    <Card className="rounded-2xl border bg-card">
      <CardHeader className="pb-2">
        <CardTitle>Sending options</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-3">
          {toggles.map((t) => (
            <div key={t.label} className="flex items-center justify-between gap-4 rounded-xl border p-3">
              <div className="min-w-0">
                <p className="text-sm font-medium">{t.label}</p>
                <p className="text-xs text-muted-foreground">{t.desc}</p>
              </div>
              <Switch checked={t.value} onCheckedChange={t.set} />
            </div>
          ))}
        </div>

        <div>
          <Button type="button" onClick={save} disabled={pending}>
            {pending ? 'Saving…' : 'Save options'}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
