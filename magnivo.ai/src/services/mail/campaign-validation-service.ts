import type { Campaign, CampaignStatus } from '@/types/campaign'
import * as campaignRepo from '@/repositories/mail/campaign-repository'
import * as poolRepo from '@/repositories/mail/mailbox-pool-repository'

export function validateCampaignName(name: string): { valid: boolean; errors: string[] } {
  const errors: string[] = []
  if (!name || name.trim().length === 0) {
    errors.push('Campaign name is required')
  }
  if (name && name.length > 255) {
    errors.push('Campaign name must be 255 characters or less')
  }
  return { valid: errors.length === 0, errors }
}

export async function validateCampaignNameUnique(
  name: string,
  orgId: string,
  folderId: string | null,
  excludeCampaignId?: string
): Promise<{ valid: boolean; errors: string[] }> {
  const errors: string[] = []
  const existing = await campaignRepo.findCampaignByName(orgId, name, folderId)
  if (existing && existing.id !== excludeCampaignId) {
    errors.push('A campaign with this name already exists in this folder')
  }
  return { valid: errors.length === 0, errors }
}

export function validateCanUpdateCampaign(campaign: Campaign): { valid: boolean; errors: string[] } {
  const errors: string[] = []
  const allowed: CampaignStatus[] = ['draft', 'scheduled', 'paused']
  if (!allowed.includes(campaign.status)) {
    errors.push(`Cannot update campaign with status "${campaign.status}". Must be "draft", "scheduled", or "paused"`)
  }
  return { valid: errors.length === 0, errors }
}

export function validateCanDeleteCampaign(campaign: Campaign): { valid: boolean; errors: string[] } {
  const errors: string[] = []
  if (campaign.status === 'running') {
    errors.push('Cannot delete a running campaign. Pause it first.')
  }
  if (campaign.status === 'scheduled') {
    errors.push('Cannot delete a scheduled campaign. Unschedule it first.')
  }
  return { valid: errors.length === 0, errors }
}

export function validateCanArchiveCampaign(campaign: Campaign): { valid: boolean; errors: string[] } {
  const errors: string[] = []
  if (campaign.status === 'running') {
    errors.push('Cannot archive a running campaign. Pause it first.')
  }
  if (campaign.isDeleted) {
    errors.push('Cannot archive a deleted campaign')
  }
  return { valid: errors.length === 0, errors }
}

export function validateCanPauseCampaign(campaign: Campaign): { valid: boolean; errors: string[] } {
  const errors: string[] = []
  if (!['running', 'scheduled'].includes(campaign.status)) {
    errors.push(`Cannot pause campaign with status "${campaign.status}". Must be "running" or "scheduled"`)
  }
  return { valid: errors.length === 0, errors }
}

export function validateCanResumeCampaign(campaign: Campaign): { valid: boolean; errors: string[] } {
  const errors: string[] = []
  if (campaign.status !== 'paused') {
    errors.push(`Cannot resume campaign with status "${campaign.status}". Must be "paused"`)
  }
  return { valid: errors.length === 0, errors }
}

export function validateCanDuplicateCampaign(_campaign: Campaign): { valid: boolean; errors: string[] } {
  return { valid: true, errors: [] }
}

export async function validatePoolAssignment(
  poolId: string | null | undefined,
  orgId: string
): Promise<{ valid: boolean; errors: string[] }> {
  const errors: string[] = []
  if (!poolId) return { valid: true, errors }

  const pool = await poolRepo.findPoolById(poolId, orgId)
  if (!pool) {
    errors.push('The assigned mailbox pool was not found')
    return { valid: false, errors }
  }
  if (pool.status !== 'active') {
    errors.push('The mailbox pool is inactive')
  }
  return { valid: errors.length === 0, errors }
}

export function validateTimezone(timezone: string): { valid: boolean; errors: string[] } {
  const errors: string[] = []
  if (!timezone || timezone.trim().length === 0) {
    errors.push('Timezone is required')
  }
  return { valid: errors.length === 0, errors }
}

export function validateVersionConflict(
  campaignVersion: number,
  providedVersion?: number
): { valid: boolean; errors: string[] } {
  const errors: string[] = []
  if (providedVersion !== undefined && providedVersion !== campaignVersion) {
    errors.push('The campaign has been modified by another user. Please refresh and try again.')
  }
  return { valid: errors.length === 0, errors }
}

export function validateBulkOperation(
  campaigns: Campaign[],
  operation: string
): { valid: boolean; errors: string[] } {
  const errors: string[] = []

  if (campaigns.length === 0) {
    errors.push('No campaigns provided')
    return { valid: false, errors }
  }

  switch (operation) {
    case 'pause': {
      const nonPausable = campaigns.filter(c => !['running', 'scheduled'].includes(c.status))
      if (nonPausable.length > 0) {
        errors.push(`${nonPausable.length} campaign(s) cannot be paused (statuses: ${nonPausable.map(c => c.status).join(', ')})`)
      }
      break
    }
    case 'resume': {
      const nonResumable = campaigns.filter(c => c.status !== 'paused')
      if (nonResumable.length > 0) {
        errors.push(`${nonResumable.length} campaign(s) cannot be resumed (statuses: ${nonResumable.map(c => c.status).join(', ')})`)
      }
      break
    }
    case 'archive': {
      const active = campaigns.filter(c => c.status === 'running')
      if (active.length > 0) {
        errors.push(`${active.length} campaign(s) are running and cannot be archived`)
      }
      break
    }
    case 'delete': {
      const undeletable = campaigns.filter(c => c.status === 'running' || c.status === 'scheduled')
      if (undeletable.length > 0) {
        errors.push(`${undeletable.length} campaign(s) cannot be deleted (statuses: ${undeletable.map(c => c.status).join(', ')})`)
      }
      break
    }
    default:
      errors.push(`Unknown operation "${operation}"`)
  }

  return { valid: errors.length === 0, errors }
}
