'use client'

import { useState } from 'react'
import { Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'

export default function AIWriterPanel({
  onUse,
}: {
  onUse: (subject: string, bodyHtml: string) => void
}) {
  const [goal, setGoal] = useState('')
  const [audience, setAudience] = useState('')
  const [tone, setTone] = useState('Professional')
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const generate = async () => {
    setError('')
    setLoading(true)
    try {
      const res = await fetch('/api/engage/ai/generate-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ goal, audience, tone }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || 'Failed to generate')
      setSubject(data.subject || '')
      setBody(data.bodyHtml || '')
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'AI generation failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="rounded-2xl border bg-card p-4 space-y-3">
      <h3 className="text-base font-semibold">AI Email Writer</h3>
      <Input value={goal} onChange={(e) => setGoal(e.target.value)} placeholder="Goal (e.g. book a demo)" />
      <Input value={audience} onChange={(e) => setAudience(e.target.value)} placeholder="Audience (e.g. SaaS founders)" />
      <Input value={tone} onChange={(e) => setTone(e.target.value)} placeholder="Tone (e.g. professional, friendly)" />
      <Button type="button" onClick={generate} disabled={loading || !goal || !audience || !tone} className="w-full">
        <Sparkles className="h-4 w-4 mr-2" />
        {loading ? 'Generating...' : 'Generate Email'}
      </Button>
      {error ? <p className="text-xs text-red-500">{error}</p> : null}

      <div className="space-y-2">
        <Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Generated subject" />
        <Textarea value={body} onChange={(e) => setBody(e.target.value)} className="min-h-32" placeholder="Generated body" />
        <Button type="button" variant="outline" onClick={() => onUse(subject, body)} disabled={!subject || !body}>
          Use in composer
        </Button>
      </div>
    </div>
  )
}

