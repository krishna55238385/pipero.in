import type { CampaignStatistics, CampaignApiResult } from '@/types/campaign'
import * as statsRepo from '@/repositories/mail/campaign-statistics-repository'
import * as campaignRepo from '@/repositories/mail/campaign-repository'

export async function getStatistics(
  campaignId: string,
  orgId: string
): Promise<CampaignApiResult<CampaignStatistics[]>> {
  const campaign = await campaignRepo.findCampaignById(campaignId, orgId)
  if (!campaign) {
    return { success: false, error: 'Campaign not found' }
  }

  try {
    const stats = await statsRepo.findStatisticsByCampaignId(campaignId, orgId)
    return { success: true, data: stats }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to get statistics'
    console.error('[campaign-statistics-service] getStatistics:', message)
    return { success: false, error: message }
  }
}

export async function getStatisticsByDateRange(
  campaignId: string,
  orgId: string,
  from: string,
  to: string
): Promise<CampaignApiResult<CampaignStatistics[]>> {
  const campaign = await campaignRepo.findCampaignById(campaignId, orgId)
  if (!campaign) {
    return { success: false, error: 'Campaign not found' }
  }

  try {
    const stats = await statsRepo.findStatisticsByDateRange(campaignId, orgId, from, to)
    return { success: true, data: stats }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to get statistics'
    console.error('[campaign-statistics-service] getStatisticsByDateRange:', message)
    return { success: false, error: message }
  }
}

export async function upsertStatistics(
  campaignId: string,
  orgId: string,
  date: string,
  data: {
    sent?: number
    delivered?: number
    opened?: number
    clicked?: number
    replied?: number
    bounced?: number
    unsubscribed?: number
    complaints?: number
  }
): Promise<CampaignApiResult<CampaignStatistics>> {
  const campaign = await campaignRepo.findCampaignById(campaignId, orgId)
  if (!campaign) {
    return { success: false, error: 'Campaign not found' }
  }

  try {
    const stats = await statsRepo.upsertStatistics(campaignId, orgId, date, data)
    return { success: true, data: stats }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to upsert statistics'
    console.error('[campaign-statistics-service] upsertStatistics:', message)
    return { success: false, error: message }
  }
}

export async function getAggregatedStats(
  campaignId: string,
  orgId: string
): Promise<CampaignApiResult<{
  totalSent: number
  totalDelivered: number
  totalOpened: number
  totalClicked: number
  totalReplied: number
  totalBounced: number
  totalUnsubscribed: number
}>> {
  const campaign = await campaignRepo.findCampaignById(campaignId, orgId)
  if (!campaign) {
    return { success: false, error: 'Campaign not found' }
  }

  try {
    const stats = await statsRepo.getAggregatedStats(campaignId, orgId)
    return { success: true, data: stats }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to get aggregated stats'
    console.error('[campaign-statistics-service] getAggregatedStats:', message)
    return { success: false, error: message }
  }
}
