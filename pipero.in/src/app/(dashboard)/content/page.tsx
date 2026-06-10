import ContentLibraryClient from '@/components/content/ContentLibraryClient'
import { getContentItems, type ContentType, type FunnelStage } from '@/app/actions/content-intelligence'

export default async function ContentLibraryPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; type?: string; stage?: string; persona?: string; industry?: string }>
}) {
  const sp = await searchParams

  const initialFilters = {
    q: sp.q || '',
    content_type: (sp.type as ContentType) || 'all',
    funnel_stage: (sp.stage as FunnelStage) || 'all',
    persona: sp.persona || 'all',
    industry: sp.industry || 'all',
  }

  const dbItems = await getContentItems({
    q: initialFilters.q || undefined,
    content_type: initialFilters.content_type,
    funnel_stage: initialFilters.funnel_stage,
    persona: initialFilters.persona,
    industry: initialFilters.industry,
  } as any)

  const items = dbItems || []

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Content Intelligence</h1>
        <p className="text-sm text-muted-foreground">AI-powered content library + execution layer.</p>
      </div>
      <ContentLibraryClient initialItems={items as any[]} initialFilters={initialFilters as any} />
    </div>
  )
}
