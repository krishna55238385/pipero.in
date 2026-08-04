import type { CampaignTemplate, CampaignApiResult } from '@/types/campaign'
import { CAMPAIGN_ERROR_MESSAGES } from '@/types/campaign'
import * as templateRepo from '@/repositories/mail/campaign-template-repository'
import * as campaignRepo from '@/repositories/mail/campaign-repository'

export async function listTemplates(orgId: string): Promise<CampaignTemplate[]> {
  return templateRepo.findTemplatesByOrg(orgId)
}

export async function getTemplate(id: string, orgId: string): Promise<CampaignTemplate | null> {
  return templateRepo.findTemplateById(id, orgId)
}

export async function createTemplate(
  orgId: string,
  data: {
    name: string
    description?: string
    category?: string
    subject?: string
    bodyHtml?: string
    bodyText?: string
    previewText?: string
    fromName?: string
    fromEmail?: string
    settings?: Record<string, unknown>
  }
): Promise<CampaignApiResult<CampaignTemplate>> {
  if (!data.name || data.name.trim().length === 0) {
    return { success: false, error: 'Template name is required' }
  }

  try {
    const template = await templateRepo.insertTemplate({
      organizationId: orgId,
      name: data.name.trim(),
      description: data.description ?? '',
      category: data.category ?? 'general',
      subject: data.subject ?? '',
      bodyHtml: data.bodyHtml ?? '',
      bodyText: data.bodyText ?? '',
      previewText: data.previewText ?? '',
      fromName: data.fromName ?? '',
      fromEmail: data.fromEmail ?? '',
      settings: data.settings ?? {},
    })
    return { success: true, data: template }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to create template'
    if (message.includes('duplicate') || message.includes('unique')) {
      return { success: false, error: 'A template with this name already exists' }
    }
    console.error('[campaign-template-service] createTemplate:', message)
    return { success: false, error: message }
  }
}

export async function updateTemplate(
  id: string,
  orgId: string,
  data: {
    name?: string
    description?: string
    category?: string
    subject?: string
    bodyHtml?: string
    bodyText?: string
    previewText?: string
    fromName?: string
    fromEmail?: string
    settings?: Record<string, unknown>
  }
): Promise<CampaignApiResult<CampaignTemplate>> {
  const existing = await templateRepo.findTemplateById(id, orgId)
  if (!existing) {
    return { success: false, error: CAMPAIGN_ERROR_MESSAGES.CAMPAIGN_TEMPLATE_NOT_FOUND }
  }

  try {
    const updated = await templateRepo.updateTemplate(id, orgId, data)
    if (!updated) {
      return { success: false, error: 'Failed to update template' }
    }
    return { success: true, data: updated }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to update template'
    console.error('[campaign-template-service] updateTemplate:', message)
    return { success: false, error: message }
  }
}

export async function deleteTemplate(
  id: string,
  orgId: string
): Promise<CampaignApiResult<boolean>> {
  const existing = await templateRepo.findTemplateById(id, orgId)
  if (!existing) {
    return { success: false, error: CAMPAIGN_ERROR_MESSAGES.CAMPAIGN_TEMPLATE_NOT_FOUND }
  }

  try {
    const deleted = await templateRepo.softDeleteTemplate(id, orgId)
    return { success: true, data: deleted }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to delete template'
    console.error('[campaign-template-service] deleteTemplate:', message)
    return { success: false, error: message }
  }
}

export async function applyTemplate(
  campaignId: string,
  templateId: string,
  orgId: string
): Promise<CampaignApiResult<boolean>> {
  const campaign = await campaignRepo.findCampaignById(campaignId, orgId)
  if (!campaign) {
    return { success: false, error: CAMPAIGN_ERROR_MESSAGES.CAMPAIGN_NOT_FOUND }
  }

  if (campaign.status !== 'draft' && campaign.status !== 'scheduled' && campaign.status !== 'paused') {
    return { success: false, error: `Cannot apply template to campaign with status "${campaign.status}"` }
  }

  const template = await templateRepo.findTemplateById(templateId, orgId)
  if (!template) {
    return { success: false, error: CAMPAIGN_ERROR_MESSAGES.CAMPAIGN_TEMPLATE_NOT_FOUND }
  }

  try {
    const updated = await campaignRepo.updateCampaign(campaignId, orgId, {
      subject: template.subject,
      bodyHtml: template.bodyHtml,
      bodyText: template.bodyText,
      previewText: template.previewText,
      fromName: template.fromName,
      fromEmail: template.fromEmail,
    })

    if (updated) {
      await templateRepo.incrementTemplateUseCount(templateId)
    }

    return { success: true, data: !!updated }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to apply template'
    console.error('[campaign-template-service] applyTemplate:', message)
    return { success: false, error: message }
  }
}
