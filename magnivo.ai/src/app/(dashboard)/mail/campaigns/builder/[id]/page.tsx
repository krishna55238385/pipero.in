import { getCampaign } from '@/app/actions/campaigns'
import CampaignBuilder from '@/components/mail/builder/CampaignBuilder'

type Props = {
  params: Promise<{ id: string }>
}

export default async function CampaignBuilderPage({ params }: Props) {
  const { id } = await params

  const campaign = await getCampaign(id)

  if (!campaign) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <div className="text-center space-y-2">
          <h2 className="text-lg font-semibold">Campaign not found</h2>
          <p className="text-sm text-muted-foreground">The campaign you are looking for does not exist.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="h-[calc(100vh-120px)]">
      <CampaignBuilder campaign={campaign} />
    </div>
  )
}
