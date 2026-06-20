'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { DialerLead } from '@/components/dialer/types'
import NotesEditor from '@/components/dialer/NotesEditor'

function scriptForLead(lead: DialerLead | null) {
  if (!lead) return 'Select a lead to view AI-suggested script.'
  if (lead.status === 'Hot') {
    return `Hi ${lead.name}, thanks for taking the time. Since ${lead.company} is actively evaluating solutions, I’d like to quickly align on priority outcomes and share a practical rollout path.`
  }
  if (lead.status === 'Warm') {
    return `Hi ${lead.name}, wanted to follow up and understand your current priorities at ${lead.company}. I can share examples from similar teams and map next steps if relevant.`
  }
  return `Hi ${lead.name}, this is a quick introduction. I noticed ${lead.company} may be expanding in this area and thought a short conversation could be useful.`
}

function objectionsForLead(lead: DialerLead | null) {
  if (!lead) return ['Pricing concern', 'No urgency', 'Already using another tool']
  if (lead.status === 'Hot') return ['Implementation timeline', 'ROI proof', 'Team onboarding effort']
  if (lead.status === 'Warm') return ['Need internal alignment', 'Feature fit concern', 'Budget cycle timing']
  return ['No immediate need', 'Too early', 'Ask to email details']
}

export default function AIAssistantPanel({
  lead,
  notes,
  onNotesChange,
}: {
  lead: DialerLead | null
  notes: string
  onNotesChange: (value: string) => void
}) {
  const objections = objectionsForLead(lead)

  return (
    <div className="space-y-4">
      <Card className="rounded-2xl">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">AI Assistant</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <p className="text-sm font-medium">Suggested script</p>
            <div className="rounded-xl border bg-muted/20 p-3 text-sm text-muted-foreground">
              {scriptForLead(lead)}
            </div>
          </div>

          <div className="space-y-2">
            <p className="text-sm font-medium">Objection handling tips</p>
            <ul className="space-y-2">
              {objections.map((tip) => (
                <li key={tip} className="rounded-lg border p-2 text-xs text-muted-foreground">
                  {tip}
                </li>
              ))}
            </ul>
          </div>

          <NotesEditor value={notes} onChange={onNotesChange} />

          <div className="rounded-xl border border-dashed p-3 text-xs text-muted-foreground">
            AI live suggestions will appear here during active calls.
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

