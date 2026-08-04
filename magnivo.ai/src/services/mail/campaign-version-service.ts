import type { CampaignVersion, CampaignApiResult } from '@/types/campaign'
import { CAMPAIGN_ERROR_MESSAGES } from '@/types/campaign'
import * as campaignRepo from '@/repositories/mail/campaign-repository'
import * as versionRepo from '@/repositories/mail/campaign-version-repository'
import pool from '@/lib/db'

type ActorInfo = {
  userId: string
  email: string
}

export async function saveVersion(
  campaignId: string,
  orgId: string,
  changeSummary: string,
  actor: ActorInfo
): Promise<CampaignApiResult<CampaignVersion>> {
  const campaign = await campaignRepo.findCampaignById(campaignId, orgId)
  if (!campaign) {
    return { success: false, error: CAMPAIGN_ERROR_MESSAGES.CAMPAIGN_NOT_FOUND }
  }

  try {
    const versions = await versionRepo.findVersionsByCampaignId(campaignId, orgId)
    const nextVersion = versions.length > 0 ? versions[0].versionNumber + 1 : 1

    const snapshot = {
      name: campaign.name,
      description: campaign.description,
      subject: campaign.subject,
      bodyHtml: campaign.bodyHtml,
      bodyText: campaign.bodyText,
      previewText: campaign.previewText,
      fromName: campaign.fromName,
      fromEmail: campaign.fromEmail,
      replyTo: campaign.replyTo,
      poolId: campaign.poolId,
      timezone: campaign.timezone,
      triggerType: campaign.triggerType,
      status: campaign.status,
    }

    const version = await versionRepo.insertVersion({
      campaignId,
      organizationId: orgId,
      versionNumber: nextVersion,
      snapshot,
      changeSummary,
      actorUserId: actor.userId,
      actorEmail: actor.email,
    })

    return { success: true, data: version }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to save version'
    console.error('[campaign-version-service] saveVersion:', message)
    return { success: false, error: message }
  }
}

export async function rollbackVersion(
  campaignId: string,
  orgId: string,
  versionNumber: number,
  actor: ActorInfo
): Promise<CampaignApiResult<boolean>> {
  const campaign = await campaignRepo.findCampaignById(campaignId, orgId)
  if (!campaign) {
    return { success: false, error: CAMPAIGN_ERROR_MESSAGES.CAMPAIGN_NOT_FOUND }
  }

  const targetVersion = await versionRepo.findVersionByNumber(campaignId, versionNumber, orgId)
  if (!targetVersion) {
    return { success: false, error: 'Version not found' }
  }

  const snapshot = targetVersion.snapshot as Record<string, unknown>

  try {
    const client = await pool.connect()
    try {
      await client.query('BEGIN')

      await client.query(
        `UPDATE public.campaigns SET
          name = $1, description = $2, subject = $3, body_html = $4,
          body_text = $5, preview_text = $6, from_name = $7, from_email = $8,
          reply_to = $9, pool_id = $10, timezone = $11, trigger_type = $12,
          version = version + 1, updated_at = NOW()
         WHERE id = $13 AND organization_id = $14`,
        [
          snapshot.name ?? campaign.name,
          snapshot.description ?? campaign.description,
          snapshot.subject ?? campaign.subject,
          snapshot.bodyHtml ?? campaign.bodyHtml,
          snapshot.bodyText ?? campaign.bodyText,
          snapshot.previewText ?? campaign.previewText,
          snapshot.fromName ?? campaign.fromName,
          snapshot.fromEmail ?? campaign.fromEmail,
          snapshot.replyTo ?? campaign.replyTo,
          snapshot.poolId ?? campaign.poolId,
          snapshot.timezone ?? campaign.timezone,
          snapshot.triggerType ?? campaign.triggerType,
          campaignId,
          orgId,
        ]
      )

      await client.query(
        `INSERT INTO public.campaign_history
          (campaign_id, organization_id, action, actor_user_id, actor_email,
           previous_status, new_status, change_summary, metadata)
         VALUES ($1, $2, 'rollback', $3, $4, $5, $6, $7, $8)`,
        [
          campaignId,
          orgId,
          actor.userId,
          actor.email,
          campaign.status,
          campaign.status,
          `Rolled back to version ${versionNumber}`,
          JSON.stringify({ targetVersion: versionNumber }),
        ]
      )

      await client.query('COMMIT')
      return { success: true, data: true }
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally {
      client.release()
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to rollback version'
    console.error('[campaign-version-service] rollbackVersion:', message)
    return { success: false, error: message }
  }
}

export async function listVersions(
  campaignId: string,
  orgId: string
): Promise<CampaignApiResult<CampaignVersion[]>> {
  const campaign = await campaignRepo.findCampaignById(campaignId, orgId)
  if (!campaign) {
    return { success: false, error: CAMPAIGN_ERROR_MESSAGES.CAMPAIGN_NOT_FOUND }
  }

  try {
    const versions = await versionRepo.findVersionsByCampaignId(campaignId, orgId)
    return { success: true, data: versions }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to list versions'
    console.error('[campaign-version-service] listVersions:', message)
    return { success: false, error: message }
  }
}

export async function getVersion(
  campaignId: string,
  versionNumber: number,
  orgId: string
): Promise<CampaignApiResult<CampaignVersion>> {
  try {
    const version = await versionRepo.findVersionByNumber(campaignId, versionNumber, orgId)
    if (!version) {
      return { success: false, error: 'Version not found' }
    }
    return { success: true, data: version }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to get version'
    console.error('[campaign-version-service] getVersion:', message)
    return { success: false, error: message }
  }
}
