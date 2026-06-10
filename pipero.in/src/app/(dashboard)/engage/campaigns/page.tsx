import CampaignBuilder from '@/components/engage/CampaignBuilder'
import {
  getEngageCampaignProgress,
  getEngageCampaignSkips,
  getEngageCampaigns,
  getEngageLeads,
  getEngageSequences,
  getEngageTemplates,
} from '@/app/actions/engage'

export default async function EngageCampaignsPage() {
  let campaigns: Awaited<ReturnType<typeof getEngageCampaigns>> = []
  let templates: Awaited<ReturnType<typeof getEngageTemplates>> = []
  let sequences: Awaited<ReturnType<typeof getEngageSequences>> = []
  let leads: Awaited<ReturnType<typeof getEngageLeads>> = []
  let progress: Awaited<ReturnType<typeof getEngageCampaignProgress>> = {}
  let skips: Awaited<ReturnType<typeof getEngageCampaignSkips>> = {}
  try {
    ;[campaigns, templates, sequences, leads, progress, skips] = await Promise.all([
      getEngageCampaigns(),
      getEngageTemplates(),
      getEngageSequences(),
      getEngageLeads(),
      getEngageCampaignProgress(),
      getEngageCampaignSkips(),
    ])
  } catch {
    // No connected org / not authenticated yet — render clean empty state.
  }
  return (
    <CampaignBuilder
      initialCampaigns={campaigns}
      leads={leads}
      templates={templates}
      sequences={sequences}
      progress={progress}
      skips={skips}
    />
  )
}
