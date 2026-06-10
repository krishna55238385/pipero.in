import TemplatesClient from '@/components/engage/TemplatesClient'
import { getEngageTemplates } from '@/app/actions/engage'

export default async function EngageTemplatesPage() {
  let templates: Awaited<ReturnType<typeof getEngageTemplates>> = []
  try {
    templates = await getEngageTemplates()
  } catch {
    // No connected org / not authenticated yet — render clean empty state.
  }
  return (
    <div className="flex h-full flex-col gap-4">
      <h1 className="shrink-0 text-2xl font-semibold">Templates</h1>
      <TemplatesClient initialTemplates={templates} />
    </div>
  )
}
