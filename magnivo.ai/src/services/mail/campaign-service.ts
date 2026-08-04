import type {
  Campaign,
  CampaignStatus,
  CampaignResponse,
  CampaignListResponse,
  CampaignSearchRequest,
  CampaignBulkRequest,
  CampaignBulkResult,
  CampaignDashboardStats,
  CreateCampaignRequest,
  UpdateCampaignRequest,
  CampaignApiResult,
  CampaignAuditAction,
} from '@/types/campaign'
import { CAMPAIGN_ERROR_MESSAGES } from '@/types/campaign'
import * as campaignRepo from '@/repositories/mail/campaign-repository'
import * as historyRepo from '@/repositories/mail/campaign-history-repository'
import * as eventRepo from '@/repositories/mail/campaign-event-repository'
import * as tagRepo from '@/repositories/mail/campaign-tag-repository'
import * as labelRepo from '@/repositories/mail/campaign-label-repository'
import * as poolRepo from '@/repositories/mail/mailbox-pool-repository'
import {
  validateCampaignName,
  validateCampaignNameUnique,
  validateCanUpdateCampaign,
  validateCanDeleteCampaign,
  validateCanArchiveCampaign,
  validateCanPauseCampaign,
  validateCanResumeCampaign,
  validateCanDuplicateCampaign,
  validatePoolAssignment,
  validateTimezone,
  validateVersionConflict,
  validateBulkOperation,
} from '@/services/mail/campaign-validation-service'
import { canTransition } from '@/lib/campaign-state-machine'
import pool from '@/lib/db'

// ============================================================
// Types
// ============================================================

type ActorInfo = {
  userId: string
  email: string
}

// ============================================================
// Response Mapping
// ============================================================

async function toCampaignResponse(campaign: Campaign): Promise<CampaignResponse> {
  const [tags, labels, folder] = await Promise.all([
    campaignRepo.findTagsByCampaignId(campaign.id),
    campaignRepo.findLabelsByCampaignId(campaign.id),
    campaign.folderId
      ? (await pool.query('SELECT name FROM public.campaign_folders WHERE id = $1', [campaign.folderId])).rows[0]
      : null,
    campaign.poolId
      ? poolRepo.findPoolById(campaign.poolId, campaign.organizationId)
      : null,
  ])

  return {
    ...campaign,
    folderName: folder?.name ?? null,
    poolName: null,
    tags,
    labels,
  }
}

// ============================================================
// Campaign CRUD
// ============================================================

export async function createCampaign(
  orgId: string,
  input: CreateCampaignRequest,
  actor: ActorInfo
): Promise<CampaignApiResult<CampaignResponse>> {
  const nameValidation = validateCampaignName(input.name)
  if (!nameValidation.valid) {
    return { success: false, error: nameValidation.errors.join('; ') }
  }

  const uniqueValidation = await validateCampaignNameUnique(
    input.name,
    orgId,
    input.folderId ?? null
  )
  if (!uniqueValidation.valid) {
    return { success: false, error: uniqueValidation.errors.join('; ') }
  }

  if (input.poolId) {
    const poolValidation = await validatePoolAssignment(input.poolId, orgId)
    if (!poolValidation.valid) {
      return { success: false, error: poolValidation.errors.join('; ') }
    }
  }

  const tzValidation = validateTimezone(input.timezone ?? 'UTC')
  if (!tzValidation.valid) {
    return { success: false, error: tzValidation.errors.join('; ') }
  }

  try {
    const client = await pool.connect()
    try {
      await client.query('BEGIN')

      const campaignResult = await client.query(
        `INSERT INTO public.campaigns
          (organization_id, folder_id, name, description, status, subject, body_html, body_text,
           preview_text, from_name, from_email, reply_to, pool_id, timezone, trigger_type,
           owner_id, recipient_count, metadata)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
         RETURNING *`,
        [
          orgId,
          input.folderId ?? null,
          input.name,
          input.description ?? '',
          'draft',
          input.subject ?? '',
          input.bodyHtml ?? '',
          input.bodyText ?? '',
          input.previewText ?? '',
          input.fromName ?? '',
          input.fromEmail ?? '',
          input.replyTo ?? '',
          input.poolId ?? null,
          input.timezone ?? 'UTC',
          input.triggerType ?? 'manual',
          actor.userId,
          0,
          JSON.stringify(input.metadata ?? {}),
        ]
      )

      const campaignId = campaignResult.rows[0].id

      await client.query(
        `INSERT INTO public.campaign_settings
          (campaign_id, organization_id)
         VALUES ($1, $2)`,
        [campaignId, orgId]
      )

      if (input.tagIds && input.tagIds.length > 0) {
        for (const tagId of input.tagIds) {
          await client.query(
            `INSERT INTO public.campaign_campaign_tags (campaign_id, tag_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
            [campaignId, tagId]
          )
        }
      }

      if (input.labelIds && input.labelIds.length > 0) {
        for (const labelId of input.labelIds) {
          await client.query(
            `INSERT INTO public.campaign_campaign_labels (campaign_id, label_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
            [campaignId, labelId]
          )
        }
      }

      await client.query('COMMIT')

      const campaign = await campaignRepo.findCampaignById(campaignId, orgId)
      if (!campaign) {
        return { success: false, error: CAMPAIGN_ERROR_MESSAGES.CAMPAIGN_DATABASE_FAILURE }
      }

      await recordAuditEvent(orgId, campaignId, actor, 'created', null, 'draft', 'Campaign created')
      await recordEvent(orgId, campaignId, actor, 'created', null, 'draft', 'Campaign created')

      const response = await toCampaignResponse(campaign)
      return { success: true, data: response }
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally {
      client.release()
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to create campaign'
    console.error('[campaign-service] createCampaign:', message)
    return { success: false, error: message }
  }
}

export async function updateCampaign(
  id: string,
  orgId: string,
  input: UpdateCampaignRequest,
  actor: ActorInfo
): Promise<CampaignApiResult<CampaignResponse>> {
  const existing = await campaignRepo.findCampaignById(id, orgId)
  if (!existing) {
    return { success: false, error: CAMPAIGN_ERROR_MESSAGES.CAMPAIGN_NOT_FOUND }
  }

  const updateValidation = validateCanUpdateCampaign(existing)
  if (!updateValidation.valid) {
    return { success: false, error: updateValidation.errors.join('; ') }
  }

  const versionConflict = validateVersionConflict(existing.version, input.version)
  if (!versionConflict.valid) {
    return { success: false, error: versionConflict.errors.join('; ') }
  }

  if (input.name !== undefined) {
    const nameValidation = validateCampaignName(input.name)
    if (!nameValidation.valid) {
      return { success: false, error: nameValidation.errors.join('; ') }
    }
    const uniqueValidation = await validateCampaignNameUnique(
      input.name,
      orgId,
      input.folderId ?? existing.folderId,
      id
    )
    if (!uniqueValidation.valid) {
      return { success: false, error: uniqueValidation.errors.join('; ') }
    }
  }

  if (input.poolId !== undefined) {
    const poolValidation = await validatePoolAssignment(input.poolId, orgId)
    if (!poolValidation.valid) {
      return { success: false, error: poolValidation.errors.join('; ') }
    }
  }

  if (input.timezone !== undefined) {
    const tzValidation = validateTimezone(input.timezone)
    if (!tzValidation.valid) {
      return { success: false, error: tzValidation.errors.join('; ') }
    }
  }

  try {
    const previousData = { ...existing }

    const updateData: Record<string, unknown> = {}
    if (input.name !== undefined) updateData.name = input.name
    if (input.description !== undefined) updateData.description = input.description
    if (input.folderId !== undefined) updateData.folderId = input.folderId
    if (input.subject !== undefined) updateData.subject = input.subject
    if (input.bodyHtml !== undefined) updateData.bodyHtml = input.bodyHtml
    if (input.bodyText !== undefined) updateData.bodyText = input.bodyText
    if (input.previewText !== undefined) updateData.previewText = input.previewText
    if (input.fromName !== undefined) updateData.fromName = input.fromName
    if (input.fromEmail !== undefined) updateData.fromEmail = input.fromEmail
    if (input.replyTo !== undefined) updateData.replyTo = input.replyTo
    if (input.poolId !== undefined) updateData.poolId = input.poolId
    if (input.timezone !== undefined) updateData.timezone = input.timezone
    if (input.triggerType !== undefined) updateData.triggerType = input.triggerType
    if (input.metadata !== undefined) updateData.metadata = input.metadata

    const updated = await campaignRepo.updateCampaign(id, orgId, updateData)
    if (!updated) {
      return { success: false, error: CAMPAIGN_ERROR_MESSAGES.CAMPAIGN_DATABASE_FAILURE }
    }

    if (input.tagIds !== undefined) {
      await campaignRepo.detachTagsFromCampaign(id)
      if (input.tagIds.length > 0) {
        await campaignRepo.attachTagsToCampaign(id, input.tagIds)
      }
    }

    if (input.labelIds !== undefined) {
      await campaignRepo.detachLabelsFromCampaign(id)
      if (input.labelIds.length > 0) {
        await campaignRepo.attachLabelsToCampaign(id, input.labelIds)
      }
    }

    await recordAuditEvent(orgId, id, actor, 'updated', previousData, updated, 'Campaign updated')
    await recordEvent(orgId, id, actor, 'updated', existing.status, existing.status, 'Campaign updated')

    const response = await toCampaignResponse(updated)
    return { success: true, data: response }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to update campaign'
    console.error('[campaign-service] updateCampaign:', message)
    return { success: false, error: message }
  }
}

export async function getCampaign(
  id: string,
  orgId: string
): Promise<CampaignApiResult<CampaignResponse>> {
  const campaign = await campaignRepo.findCampaignById(id, orgId)
  if (!campaign) {
    return { success: false, error: CAMPAIGN_ERROR_MESSAGES.CAMPAIGN_NOT_FOUND }
  }
  const response = await toCampaignResponse(campaign)
  return { success: true, data: response }
}

export async function deleteCampaign(
  id: string,
  orgId: string,
  actor: ActorInfo
): Promise<CampaignApiResult<boolean>> {
  const existing = await campaignRepo.findCampaignById(id, orgId)
  if (!existing) {
    return { success: false, error: CAMPAIGN_ERROR_MESSAGES.CAMPAIGN_NOT_FOUND }
  }

  const validation = validateCanDeleteCampaign(existing)
  if (!validation.valid) {
    return { success: false, error: validation.errors.join('; ') }
  }

  try {
    const deleted = await campaignRepo.softDeleteCampaign(id, orgId)
    if (deleted) {
      await recordAuditEvent(orgId, id, actor, 'deleted', existing, null, 'Campaign deleted')
      await recordEvent(orgId, id, actor, 'deleted', existing.status, null, 'Campaign deleted')
    }
    return { success: true, data: deleted }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to delete campaign'
    console.error('[campaign-service] deleteCampaign:', message)
    return { success: false, error: message }
  }
}

export async function archiveCampaign(
  id: string,
  orgId: string,
  actor: ActorInfo
): Promise<CampaignApiResult<boolean>> {
  const existing = await campaignRepo.findCampaignById(id, orgId)
  if (!existing) {
    return { success: false, error: CAMPAIGN_ERROR_MESSAGES.CAMPAIGN_NOT_FOUND }
  }

  const validation = validateCanArchiveCampaign(existing)
  if (!validation.valid) {
    return { success: false, error: validation.errors.join('; ') }
  }

  try {
    const archived = await campaignRepo.archiveCampaign(id, orgId)
    if (archived) {
      await recordAuditEvent(orgId, id, actor, 'archived', existing.status, 'archived', 'Campaign archived')
      await recordEvent(orgId, id, actor, 'archived', existing.status, 'archived', 'Campaign archived')
    }
    return { success: true, data: archived }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to archive campaign'
    console.error('[campaign-service] archiveCampaign:', message)
    return { success: false, error: message }
  }
}

export async function restoreCampaign(
  id: string,
  orgId: string,
  actor: ActorInfo
): Promise<CampaignApiResult<boolean>> {
  const existing = await campaignRepo.findCampaignById(id, orgId)
  if (!existing) {
    return { success: false, error: CAMPAIGN_ERROR_MESSAGES.CAMPAIGN_NOT_FOUND }
  }

  try {
    const restored = await campaignRepo.restoreCampaign(id, orgId)
    if (restored) {
      await recordAuditEvent(orgId, id, actor, 'restored', 'archived', 'draft', 'Campaign restored')
      await recordEvent(orgId, id, actor, 'restored', 'archived', 'draft', 'Campaign restored')
    }
    return { success: true, data: restored }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to restore campaign'
    console.error('[campaign-service] restoreCampaign:', message)
    return { success: false, error: message }
  }
}

// ============================================================
// Lifecycle
// ============================================================

/**
 * Launch a campaign into running state (PRD §6.4 / §13D / §14).
 * Hard-blocks: no pool, pool not warm, missing unsubscribe / physical address.
 */
export async function launchCampaign(
  id: string,
  orgId: string,
  actor: ActorInfo
): Promise<CampaignApiResult<CampaignResponse>> {
  const existing = await campaignRepo.findCampaignById(id, orgId)
  if (!existing) {
    return { success: false, error: CAMPAIGN_ERROR_MESSAGES.CAMPAIGN_NOT_FOUND }
  }

  if (!['draft', 'scheduled', 'active', 'paused'].includes(existing.status)) {
    return { success: false, error: `Cannot launch campaign with status "${existing.status}"` }
  }

  if (!existing.poolId) {
    return { success: false, error: 'Campaign must be attached to a mailbox pool before launch' }
  }

  const { assertCampaignMailboxesWarm } = await import('./send-dispatcher')
  const warmCheck = await assertCampaignMailboxesWarm(orgId, existing.poolId)
  if (!warmCheck.success) {
    return { success: false, error: warmCheck.error || 'Mailbox pool is not warm' }
  }

  const settings = await pool.query<{
    physical_address: string
    unsubscribe_link: boolean
    company_name: string
  }>(
    `SELECT physical_address, unsubscribe_link, company_name
     FROM public.mail_org_settings WHERE organization_id = $1`,
    [orgId]
  ).catch(() => ({ rows: [] as { physical_address: string; unsubscribe_link: boolean; company_name: string }[] }))

  const orgSettings = settings.rows[0]
  if (!orgSettings || orgSettings.unsubscribe_link === false) {
    return {
      success: false,
      error: 'Cannot launch: one-click unsubscribe is disabled. Enable it in Mail Settings (Google/Yahoo compliance).',
    }
  }
  if (!orgSettings || !(orgSettings.physical_address || '').trim()) {
    return {
      success: false,
      error: 'Cannot launch: physical mailing address required in Mail Settings (CAN-SPAM).',
    }
  }

  const transition = canTransition(existing.status, 'running')
  if (!transition.valid) {
    return { success: false, error: transition.reason }
  }

  try {
    const updated = await campaignRepo.updateCampaign(id, orgId, {
      status: 'running',
      startedAt: new Date().toISOString(),
      stoppedAt: null,
    })
    if (!updated) {
      return { success: false, error: CAMPAIGN_ERROR_MESSAGES.CAMPAIGN_DATABASE_FAILURE }
    }

    await recordAuditEvent(orgId, id, actor, 'launched', existing.status, 'running', 'Campaign launched')
    await recordEvent(orgId, id, actor, 'launched', existing.status, 'running', 'Campaign launched')

    const response = await toCampaignResponse(updated)
    return { success: true, data: response }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to launch campaign'
    console.error('[campaign-service] launchCampaign:', message)
    return { success: false, error: message }
  }
}

export async function pauseCampaign(
  id: string,
  orgId: string,
  actor: ActorInfo
): Promise<CampaignApiResult<CampaignResponse>> {
  const existing = await campaignRepo.findCampaignById(id, orgId)
  if (!existing) {
    return { success: false, error: CAMPAIGN_ERROR_MESSAGES.CAMPAIGN_NOT_FOUND }
  }

  const validation = validateCanPauseCampaign(existing)
  if (!validation.valid) {
    return { success: false, error: validation.errors.join('; ') }
  }

  const transition = canTransition(existing.status, 'paused')
  if (!transition.valid) {
    return { success: false, error: transition.reason }
  }

  try {
    const updated = await campaignRepo.updateCampaign(id, orgId, {
      status: 'paused',
      lastPausedAt: new Date().toISOString(),
      stoppedAt: new Date().toISOString(),
    })
    if (!updated) {
      return { success: false, error: CAMPAIGN_ERROR_MESSAGES.CAMPAIGN_DATABASE_FAILURE }
    }

    await recordAuditEvent(orgId, id, actor, 'paused', existing.status, 'paused', 'Campaign paused')
    await recordEvent(orgId, id, actor, 'paused', existing.status, 'paused', 'Campaign paused')

    const response = await toCampaignResponse(updated)
    return { success: true, data: response }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to pause campaign'
    console.error('[campaign-service] pauseCampaign:', message)
    return { success: false, error: message }
  }
}

export async function resumeCampaign(
  id: string,
  orgId: string,
  actor: ActorInfo
): Promise<CampaignApiResult<CampaignResponse>> {
  const existing = await campaignRepo.findCampaignById(id, orgId)
  if (!existing) {
    return { success: false, error: CAMPAIGN_ERROR_MESSAGES.CAMPAIGN_NOT_FOUND }
  }

  const validation = validateCanResumeCampaign(existing)
  if (!validation.valid) {
    return { success: false, error: validation.errors.join('; ') }
  }

  const transition = canTransition(existing.status, 'running')
  if (!transition.valid) {
    return { success: false, error: transition.reason }
  }

  // PRD §14 6.4: hard block if pool mailboxes are not Warm
  if (existing.poolId) {
    const { assertCampaignMailboxesWarm } = await import('./send-dispatcher')
    const warmCheck = await assertCampaignMailboxesWarm(orgId, existing.poolId)
    if (!warmCheck.success) {
      return { success: false, error: warmCheck.error || 'Mailbox pool is not warm' }
    }
  } else {
    return { success: false, error: 'Campaign must be attached to a mailbox pool before launch' }
  }

  try {
    const updated = await campaignRepo.updateCampaign(id, orgId, {
      status: 'running',
      startedAt: new Date().toISOString(),
      stoppedAt: null,
    })
    if (!updated) {
      return { success: false, error: CAMPAIGN_ERROR_MESSAGES.CAMPAIGN_DATABASE_FAILURE }
    }

    await recordAuditEvent(orgId, id, actor, 'resumed', existing.status, 'running', 'Campaign resumed')
    await recordEvent(orgId, id, actor, 'resumed', existing.status, 'running', 'Campaign resumed')

    const response = await toCampaignResponse(updated)
    return { success: true, data: response }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to resume campaign'
    console.error('[campaign-service] resumeCampaign:', message)
    return { success: false, error: message }
  }
}

// ============================================================
// Duplicate & Clone
// ============================================================

export async function duplicateCampaign(
  id: string,
  orgId: string,
  actor: ActorInfo,
  newName?: string
): Promise<CampaignApiResult<CampaignResponse>> {
  const existing = await campaignRepo.findCampaignById(id, orgId)
  if (!existing) {
    return { success: false, error: CAMPAIGN_ERROR_MESSAGES.CAMPAIGN_NOT_FOUND }
  }

  const validation = validateCanDuplicateCampaign(existing)
  if (!validation.valid) {
    return { success: false, error: validation.errors.join('; ') }
  }

  try {
    const duplicated = await campaignRepo.duplicateCampaign(id, orgId, { name: newName })
    if (!duplicated) {
      return { success: false, error: CAMPAIGN_ERROR_MESSAGES.CAMPAIGN_DATABASE_FAILURE }
    }

    const tags = await campaignRepo.findTagsByCampaignId(id)
    if (tags.length > 0) {
      await campaignRepo.attachTagsToCampaign(duplicated.id, tags.map(t => t.id))
    }

    const labels = await campaignRepo.findLabelsByCampaignId(id)
    if (labels.length > 0) {
      await campaignRepo.attachLabelsToCampaign(duplicated.id, labels.map(l => l.id))
    }

    await recordAuditEvent(orgId, duplicated.id, actor, 'duplicated', null, 'draft', `Duplicated from campaign "${existing.name}"`)
    await recordEvent(orgId, duplicated.id, actor, 'duplicated', null, 'draft', `Duplicated from campaign "${existing.name}"`)

    const response = await toCampaignResponse(duplicated)
    return { success: true, data: response }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to duplicate campaign'
    console.error('[campaign-service] duplicateCampaign:', message)
    return { success: false, error: message }
  }
}

// ============================================================
// Folder Management
// ============================================================

export async function moveCampaignToFolder(
  id: string,
  orgId: string,
  folderId: string | null,
  actor: ActorInfo
): Promise<CampaignApiResult<CampaignResponse>> {
  const existing = await campaignRepo.findCampaignById(id, orgId)
  if (!existing) {
    return { success: false, error: CAMPAIGN_ERROR_MESSAGES.CAMPAIGN_NOT_FOUND }
  }

  if (folderId) {
    const folderRepo = await import('@/repositories/mail/campaign-folder-repository')
    const folder = await folderRepo.findFolderById(folderId, orgId)
    if (!folder) {
      return { success: false, error: CAMPAIGN_ERROR_MESSAGES.CAMPAIGN_FOLDER_NOT_FOUND }
    }
  }

  try {
    const updated = await campaignRepo.moveCampaignToFolder(id, orgId, folderId)
    if (!updated) {
      return { success: false, error: CAMPAIGN_ERROR_MESSAGES.CAMPAIGN_DATABASE_FAILURE }
    }

    await recordAuditEvent(orgId, id, actor, 'folder_moved', existing.folderId, folderId, 'Campaign moved to folder')
    await recordEvent(orgId, id, actor, 'folder_moved', existing.status, existing.status, 'Campaign moved to folder')

    const response = await toCampaignResponse(updated)
    return { success: true, data: response }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to move campaign'
    console.error('[campaign-service] moveCampaignToFolder:', message)
    return { success: false, error: message }
  }
}

// ============================================================
// Tag & Label Management
// ============================================================

export async function updateCampaignTags(
  id: string,
  orgId: string,
  tagIds: string[],
  actor: ActorInfo
): Promise<CampaignApiResult<boolean>> {
  const existing = await campaignRepo.findCampaignById(id, orgId)
  if (!existing) {
    return { success: false, error: CAMPAIGN_ERROR_MESSAGES.CAMPAIGN_NOT_FOUND }
  }

  try {
    await campaignRepo.detachTagsFromCampaign(id)
    if (tagIds.length > 0) {
      await campaignRepo.attachTagsToCampaign(id, tagIds)
    }

    await recordAuditEvent(orgId, id, actor, 'tags_updated', null, null, `Tags updated (${tagIds.length} tags)`)
    return { success: true, data: true }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to update tags'
    console.error('[campaign-service] updateCampaignTags:', message)
    return { success: false, error: message }
  }
}

export async function updateCampaignLabels(
  id: string,
  orgId: string,
  labelIds: string[],
  actor: ActorInfo
): Promise<CampaignApiResult<boolean>> {
  const existing = await campaignRepo.findCampaignById(id, orgId)
  if (!existing) {
    return { success: false, error: CAMPAIGN_ERROR_MESSAGES.CAMPAIGN_NOT_FOUND }
  }

  try {
    await campaignRepo.detachLabelsFromCampaign(id)
    if (labelIds.length > 0) {
      await campaignRepo.attachLabelsToCampaign(id, labelIds)
    }

    await recordAuditEvent(orgId, id, actor, 'labels_updated', null, null, `Labels updated (${labelIds.length} labels)`)
    return { success: true, data: true }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to update labels'
    console.error('[campaign-service] updateCampaignLabels:', message)
    return { success: false, error: message }
  }
}

// ============================================================
// Search & List
// ============================================================

export async function listCampaigns(
  orgId: string,
  options?: { status?: CampaignStatus; folderId?: string | null; search?: string; isDeleted?: boolean }
): Promise<Campaign[]> {
  return campaignRepo.findCampaignsByOrg(orgId, options)
}

export async function searchCampaigns(
  orgId: string,
  params: CampaignSearchRequest
): Promise<CampaignListResponse> {
  const page = params.page ?? 1
  const pageSize = params.pageSize ?? 20

  const { campaigns, total } = await campaignRepo.searchCampaigns(orgId, params)

  const responses = await Promise.all(campaigns.map(c => toCampaignResponse(c)))

  return {
    campaigns: responses,
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
  }
}

export async function getDashboardStats(orgId: string): Promise<CampaignDashboardStats> {
  return campaignRepo.getDashboardStats(orgId)
}

// ============================================================
// Bulk Operations
// ============================================================

export async function bulkOperation(
  request: CampaignBulkRequest,
  orgId: string,
  actor: ActorInfo
): Promise<CampaignApiResult<CampaignBulkResult[]>> {
  const campaigns = await Promise.all(
    request.campaignIds.map(id => campaignRepo.findCampaignById(id, orgId))
  )

  const validCampaigns = campaigns.filter((c): c is Campaign => c !== null)
  const validation = validateBulkOperation(validCampaigns, request.operation)
  if (!validation.valid) {
    return { success: false, error: validation.errors.join('; ') }
  }

  const results: CampaignBulkResult[] = []

  for (const campaignId of request.campaignIds) {
    try {
      switch (request.operation) {
        case 'pause': {
          const c = validCampaigns.find(c => c.id === campaignId)
          if (c && ['running', 'scheduled'].includes(c.status)) {
            await campaignRepo.bulkUpdateCampaignStatus([campaignId], orgId, 'paused' as CampaignStatus)
            await recordAuditEvent(orgId, campaignId, actor, 'paused', c.status, 'paused', 'Bulk paused')
            results.push({ campaignId, success: true })
          } else {
            results.push({ campaignId, success: false, error: 'Cannot pause' })
          }
          break
        }
        case 'resume': {
          const c = validCampaigns.find(c => c.id === campaignId)
          if (c && c.status === 'paused') {
            await campaignRepo.bulkUpdateCampaignStatus([campaignId], orgId, 'running')
            await recordAuditEvent(orgId, campaignId, actor, 'resumed', 'paused', 'running', 'Bulk resumed')
            results.push({ campaignId, success: true })
          } else {
            results.push({ campaignId, success: false, error: 'Cannot resume' })
          }
          break
        }
        case 'archive': {
          const count = await campaignRepo.bulkArchiveCampaigns([campaignId], orgId)
          if (count > 0) {
            await recordAuditEvent(orgId, campaignId, actor, 'archived', null, 'archived', 'Bulk archived')
            results.push({ campaignId, success: true })
          } else {
            results.push({ campaignId, success: false, error: 'Cannot archive' })
          }
          break
        }
        case 'delete': {
          const count = await campaignRepo.bulkSoftDeleteCampaigns([campaignId], orgId)
          if (count > 0) {
            await recordAuditEvent(orgId, campaignId, actor, 'deleted', null, null, 'Bulk deleted')
            results.push({ campaignId, success: true })
          } else {
            results.push({ campaignId, success: false, error: 'Cannot delete' })
          }
          break
        }
      }
    } catch {
      results.push({ campaignId, success: false, error: 'Operation failed' })
    }
  }

  return { success: true, data: results }
}

// ============================================================
// Tag & Label CRUD (org-level)
// ============================================================

export async function listTags(orgId: string) {
  return tagRepo.findTagsByOrg(orgId)
}

export async function createTag(orgId: string, name: string, color?: string) {
  return tagRepo.insertTag({ organizationId: orgId, name, color })
}

export async function updateTag(id: string, orgId: string, data: { name?: string; color?: string }) {
  return tagRepo.updateTag(id, orgId, data)
}

export async function deleteTag(id: string, orgId: string) {
  return tagRepo.deleteTag(id, orgId)
}

export async function listLabels(orgId: string) {
  return labelRepo.findLabelsByOrg(orgId)
}

export async function createLabel(orgId: string, name: string, color?: string) {
  return labelRepo.insertLabel({ organizationId: orgId, name, color })
}

export async function updateLabel(id: string, orgId: string, data: { name?: string; color?: string }) {
  return labelRepo.updateLabel(id, orgId, data)
}

export async function deleteLabel(id: string, orgId: string) {
  return labelRepo.deleteLabel(id, orgId)
}

// ============================================================
// Audit & Event Recording
// ============================================================

async function recordAuditEvent(
  orgId: string,
  campaignId: string,
  actor: ActorInfo,
  action: CampaignAuditAction,
  previousData: unknown,
  newData: unknown,
  changeSummary: string
): Promise<void> {
  try {
    const previousCampaign = previousData && typeof previousData === 'object' && 'status' in (previousData as Record<string, unknown>)
      ? (previousData as Campaign)
      : null
    const newCampaign = newData && typeof newData === 'object' && 'status' in (newData as Record<string, unknown>)
      ? (newData as Campaign)
      : null

    await historyRepo.insertHistory({
      campaignId,
      organizationId: orgId,
      action,
      actorUserId: actor.userId,
      actorEmail: actor.email,
      previousStatus: previousCampaign?.status ?? null,
      newStatus: newCampaign?.status ?? null,
      changeSummary,
      previousData: previousCampaign ? previousCampaign as unknown as Record<string, unknown> : null,
      newData: newCampaign ? newCampaign as unknown as Record<string, unknown> : null,
    })
  } catch (err) {
    console.error('[campaign-service] recordAuditEvent:', err)
  }
}

async function recordEvent(
  orgId: string,
  campaignId: string,
  actor: ActorInfo,
  eventType: string,
  previousStatus: string | null,
  newStatus: string | null,
  message: string
): Promise<void> {
  try {
    await eventRepo.insertEvent({
      campaignId,
      organizationId: orgId,
      eventType,
      actorUserId: actor.userId,
      actorEmail: actor.email,
      previousStatus,
      newStatus,
      message,
    })
  } catch (err) {
    console.error('[campaign-service] recordEvent:', err)
  }
}

// ============================================================
// History & Events
// ============================================================

export async function getCampaignHistory(
  campaignId: string,
  orgId: string,
  limit?: number,
  offset?: number
) {
  return historyRepo.findHistoryByCampaignId(campaignId, orgId, { limit, offset })
}

export async function getCampaignEvents(
  campaignId: string,
  orgId: string,
  limit?: number,
  offset?: number
) {
  return eventRepo.findEventsByCampaignId(campaignId, orgId, { limit, offset })
}
