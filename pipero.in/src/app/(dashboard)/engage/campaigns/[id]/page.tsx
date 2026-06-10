import { notFound } from 'next/navigation'
import {
  getCampaignDetail,
  getEngageSequences,
  getEngageTemplates,
} from '@/app/actions/engage'
import CampaignDetailClient from '@/components/engage/campaign-detail/CampaignDetailClient'

export default async function CampaignDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params

  const detail = await getCampaignDetail(id)
  if (!detail) notFound()

  const [templates, sequences] = await Promise.all([
    getEngageTemplates().catch(() => []),
    getEngageSequences().catch(() => []),
  ])

  return (
    <CampaignDetailClient detail={detail} templates={templates} sequences={sequences} />
  )
}
