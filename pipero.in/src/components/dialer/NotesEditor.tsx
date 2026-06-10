'use client'

import { Textarea } from '@/components/ui/textarea'

export default function NotesEditor({
  value,
  onChange,
}: {
  value: string
  onChange: (value: string) => void
}) {
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">Notes</p>
      <Textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Add call notes, next steps, and action items..."
        className="min-h-[140px]"
      />
    </div>
  )
}

