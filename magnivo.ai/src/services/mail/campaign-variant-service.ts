import type { CampaignVariant, CampaignApiResult } from '@/types/campaign'
import * as variantRepo from '@/repositories/mail/campaign-variant-repository'
import * as campaignRepo from '@/repositories/mail/campaign-repository'

export async function listVariants(campaignId: string, orgId: string): Promise<CampaignVariant[]> {
  return variantRepo.findVariantsByCampaignId(campaignId, orgId)
}

export async function getVariant(id: string, orgId: string): Promise<CampaignVariant | null> {
  return variantRepo.findVariantById(id, orgId)
}

export async function createVariant(
  campaignId: string,
  orgId: string,
  data: {
    variantType: string
    name?: string
    subject?: string
    bodyHtml?: string
    bodyText?: string
    percentage?: number
  }
): Promise<CampaignApiResult<CampaignVariant>> {
  const campaign = await campaignRepo.findCampaignById(campaignId, orgId)
  if (!campaign) {
    return { success: false, error: 'Campaign not found' }
  }

  const validTypes = ['A', 'B', 'C']
  if (!validTypes.includes(data.variantType)) {
    return { success: false, error: `Invalid variant type "${data.variantType}". Must be A, B, or C` }
  }

  const existing = await variantRepo.findVariantsByCampaignId(campaignId, orgId)
  if (existing.some(v => v.variantType === data.variantType)) {
    return { success: false, error: `Variant ${data.variantType} already exists for this campaign` }
  }

  try {
    const variant = await variantRepo.insertVariant({
      campaignId,
      organizationId: orgId,
      variantType: data.variantType,
      name: data.name,
      subject: data.subject,
      bodyHtml: data.bodyHtml,
      bodyText: data.bodyText,
      percentage: data.percentage,
    })
    return { success: true, data: variant }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to create variant'
    console.error('[campaign-variant-service] createVariant:', message)
    return { success: false, error: message }
  }
}

export async function updateVariant(
  id: string,
  orgId: string,
  data: {
    name?: string
    subject?: string
    bodyHtml?: string
    bodyText?: string
    percentage?: number
    isWinner?: boolean
  }
): Promise<CampaignApiResult<CampaignVariant>> {
  try {
    const updated = await variantRepo.updateVariant(id, orgId, data)
    if (!updated) {
      return { success: false, error: 'Variant not found or no changes' }
    }
    return { success: true, data: updated }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to update variant'
    console.error('[campaign-variant-service] updateVariant:', message)
    return { success: false, error: message }
  }
}

export async function deleteVariant(
  id: string,
  orgId: string
): Promise<CampaignApiResult<boolean>> {
  try {
    const deleted = await variantRepo.deleteVariant(id, orgId)
    return { success: true, data: deleted }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to delete variant'
    console.error('[campaign-variant-service] deleteVariant:', message)
    return { success: false, error: message }
  }
}

export async function markWinner(
  campaignId: string,
  variantId: string,
  orgId: string
): Promise<CampaignApiResult<boolean>> {
  const campaign = await campaignRepo.findCampaignById(campaignId, orgId)
  if (!campaign) {
    return { success: false, error: 'Campaign not found' }
  }

  try {
    const variants = await variantRepo.findVariantsByCampaignId(campaignId, orgId)
    for (const v of variants) {
      await variantRepo.updateVariant(v.id, orgId, { isWinner: v.id === variantId })
    }
    return { success: true, data: true }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to mark winner'
    console.error('[campaign-variant-service] markWinner:', message)
    return { success: false, error: message }
  }
}
