'use client'

import Link from 'next/link'
import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { createPlaybook, type FunnelStage } from '@/app/actions/content-intelligence'

export default function PlaybooksListClient({ playbooks }: { playbooks: any[] }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  const onCreate = (form: HTMLFormElement) => {
    const fd = new FormData(form)
    const title = String(fd.get('title') || '').trim()
    if (!title) return alert('Title is required')
    const funnel_stage = String(fd.get('funnel_stage') || 'awareness') as FunnelStage
    const persona = String(fd.get('persona') || '').trim()
    const industry = String(fd.get('industry') || '').trim()
    const tags = String(fd.get('tags') || '').split(',').map(t => t.trim()).filter(Boolean)

    startTransition(async () => {
      const res = await createPlaybook({ title, funnel_stage, persona: persona || undefined, industry: industry || undefined, tags })
      if ('error' in res) return alert(res.error)
      router.push(`/content/playbooks/${res.data.id}`)
    })
  }

  return (
    <div className="space-y-6">
      <Card className="rounded-xl">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Create playbook</CardTitle>
          <CardDescription>Build multi-step execution workflows.</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="grid grid-cols-1 md:grid-cols-4 gap-3" onSubmit={(e) => { e.preventDefault(); onCreate(e.currentTarget) }}>
            <Input name="title" placeholder="Playbook title" />
            <Input name="funnel_stage" defaultValue="awareness" placeholder="awareness/consideration/conversion" />
            <Input name="persona" placeholder="Persona (optional)" />
            <Input name="industry" placeholder="Industry (optional)" />
            <div className="md:col-span-4">
              <Input name="tags" placeholder="Tags (comma-separated)" />
            </div>
            <div className="md:col-span-4">
              <Button type="submit" disabled={isPending}>Create playbook</Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {playbooks.map((p) => (
          <Link key={p.id} href={`/content/playbooks/${p.id}`} className="group">
            <Card className="rounded-xl h-full transition-shadow group-hover:shadow-md">
              <CardHeader className="pb-2">
                <CardTitle className="text-base line-clamp-2">{p.title}</CardTitle>
                <CardDescription className="line-clamp-2">{p.description || '—'}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="flex flex-wrap gap-2">
                  <Badge variant="secondary">{p.funnel_stage}</Badge>
                  {p.persona && <Badge variant="outline">{p.persona}</Badge>}
                  {p.industry && <Badge variant="outline">{p.industry}</Badge>}
                </div>
                {Array.isArray(p.tags) && p.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {p.tags.slice(0, 8).map((t: string) => (
                      <span key={t} className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
                        {t}
                      </span>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  )
}

