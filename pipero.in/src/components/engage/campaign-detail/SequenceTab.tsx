'use client'

import Link from 'next/link'
import { Mail, Pencil } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import type { EngageCampaign, EngageSequence, EngageTemplate } from '@/types/engage'

function delayLabel(days: number, index: number): string {
  if (index === 0 || days <= 0) return 'Sent immediately'
  return `Wait ${days} day${days === 1 ? '' : 's'}`
}

export default function SequenceTab({
  campaign,
  templates,
  sequences,
}: {
  campaign: EngageCampaign
  templates: EngageTemplate[]
  sequences: EngageSequence[]
}) {
  const templateById = (id: string) => templates.find((t) => t.id === id)

  if (campaign.sequenceId) {
    const seq = sequences.find((s) => s.id === campaign.sequenceId)
    if (!seq) {
      return (
        <Card className="rounded-2xl border bg-card">
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">
              This campaign references a sequence that is no longer available.
            </p>
          </CardContent>
        </Card>
      )
    }
    return (
      <Card className="rounded-2xl border bg-card">
        <CardContent className="space-y-4 pt-6">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-base font-semibold">{seq.name}</h3>
            <Link
              href="/engage/sequences"
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              <Pencil className="h-3 w-3" /> Edit sequence
            </Link>
          </div>
          <ol className="space-y-3">
            {seq.steps.map((step, i) => {
              const tpl = templateById(step.templateId)
              return (
                <li key={step.id} className="flex gap-3 rounded-xl border p-3">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-semibold tabular-nums">
                    {i + 1}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{tpl?.name ?? 'Untitled template'}</p>
                    {tpl?.subject ? (
                      <p className="truncate text-sm text-muted-foreground">{tpl.subject}</p>
                    ) : null}
                    <p className="mt-1 text-xs text-muted-foreground">{delayLabel(step.delayDays, i)}</p>
                  </div>
                </li>
              )
            })}
            {seq.steps.length === 0 ? (
              <li className="text-sm text-muted-foreground">This sequence has no steps.</li>
            ) : null}
          </ol>
        </CardContent>
      </Card>
    )
  }

  const tpl = templateById(campaign.templateId)
  return (
    <Card className="rounded-2xl border bg-card">
      <CardContent className="space-y-4 pt-6">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Mail className="h-4 w-4 text-muted-foreground" />
            <h3 className="text-base font-semibold">{tpl?.name ?? 'Single template'}</h3>
          </div>
          <Link
            href="/engage/templates"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <Pencil className="h-3 w-3" /> Edit template
          </Link>
        </div>
        {tpl ? (
          <div className="space-y-2">
            <div className="rounded-lg border bg-muted/40 px-3 py-2">
              <span className="text-xs uppercase tracking-wide text-muted-foreground">Subject</span>
              <p className="text-sm font-medium">{tpl.subject || '—'}</p>
            </div>
            <div
              className="prose prose-sm max-w-none rounded-xl border bg-background p-4 dark:prose-invert"
              dangerouslySetInnerHTML={{ __html: tpl.body || '<p>(empty body)</p>' }}
            />
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            This campaign references a template that is no longer available.
          </p>
        )}
      </CardContent>
    </Card>
  )
}
