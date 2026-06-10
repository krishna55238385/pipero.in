import { getContentDetail } from '@/app/actions/content-intelligence'
import ContentDetailClient from '@/components/content/ContentDetailClient'

export default async function ContentDetailPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params
  const detail = await getContentDetail(params.id)

  if (!detail) {
    return (
      <div className="flex flex-col items-center justify-center h-[50vh] space-y-2">
        <h1 className="text-xl font-semibold">Content not found</h1>
        <p className="text-sm text-muted-foreground">It may have been deleted or you don’t have access.</p>
      </div>
    )
  }

  return <ContentDetailClient detail={detail as any} />
}
