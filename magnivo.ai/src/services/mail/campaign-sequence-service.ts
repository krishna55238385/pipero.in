import type { CampaignSequence, CampaignSequenceStep, CampaignApiResult } from '@/types/campaign'
import * as seqRepo from '@/repositories/mail/campaign-sequence-repository'
import * as campaignRepo from '@/repositories/mail/campaign-repository'

export async function listSequences(campaignId: string, orgId: string): Promise<CampaignSequence[]> {
  return seqRepo.findSequencesByCampaignId(campaignId, orgId)
}

export async function listOrgSequences(orgId: string): Promise<CampaignSequence[]> {
  return seqRepo.findSequencesByOrgId(orgId)
}

export async function getSequence(id: string, orgId: string): Promise<CampaignSequence | null> {
  return seqRepo.findSequenceById(id, orgId)
}

export async function createSequence(
  campaignId: string,
  orgId: string,
  data: { name: string; description?: string; status?: string }
): Promise<CampaignApiResult<CampaignSequence>> {
  const campaign = await campaignRepo.findCampaignById(campaignId, orgId)
  if (!campaign) {
    return { success: false, error: 'Campaign not found' }
  }

  if (!data.name || data.name.trim().length === 0) {
    return { success: false, error: 'Sequence name is required' }
  }

  try {
    const sequence = await seqRepo.insertSequence({
      campaignId,
      organizationId: orgId,
      name: data.name.trim(),
      description: data.description ?? '',
      status: data.status ?? 'draft',
    })
    return { success: true, data: sequence }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to create sequence'
    console.error('[campaign-sequence-service] createSequence:', message)
    return { success: false, error: message }
  }
}

export async function updateSequence(
  id: string,
  orgId: string,
  data: { name?: string; description?: string; status?: string }
): Promise<CampaignApiResult<CampaignSequence>> {
  const existing = await seqRepo.findSequenceById(id, orgId)
  if (!existing) {
    return { success: false, error: 'Sequence not found' }
  }

  try {
    const updated = await seqRepo.updateSequence(id, orgId, data)
    if (!updated) {
      return { success: false, error: 'Failed to update sequence' }
    }
    return { success: true, data: updated }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to update sequence'
    console.error('[campaign-sequence-service] updateSequence:', message)
    return { success: false, error: message }
  }
}

export async function deleteSequence(
  id: string,
  orgId: string
): Promise<CampaignApiResult<boolean>> {
  const existing = await seqRepo.findSequenceById(id, orgId)
  if (!existing) {
    return { success: false, error: 'Sequence not found' }
  }

  try {
    const deleted = await seqRepo.deleteSequence(id, orgId)
    return { success: true, data: deleted }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to delete sequence'
    console.error('[campaign-sequence-service] deleteSequence:', message)
    return { success: false, error: message }
  }
}

export async function listSteps(sequenceId: string, orgId: string): Promise<CampaignSequenceStep[]> {
  return seqRepo.findStepsBySequenceId(sequenceId, orgId)
}

export async function createStep(
  sequenceId: string,
  orgId: string,
  data: {
    stepNumber: number
    subject?: string
    bodyHtml?: string
    bodyText?: string
    delayDays?: number
    delayHours?: number
    conditionType?: string | null
    conditionConfig?: Record<string, unknown>
  }
): Promise<CampaignApiResult<CampaignSequenceStep>> {
  const sequence = await seqRepo.findSequenceById(sequenceId, orgId)
  if (!sequence) {
    return { success: false, error: 'Sequence not found' }
  }

  try {
    const step = await seqRepo.insertStep({
      sequenceId,
      organizationId: orgId,
      stepNumber: data.stepNumber,
      subject: data.subject,
      bodyHtml: data.bodyHtml,
      bodyText: data.bodyText,
      delayDays: data.delayDays,
      delayHours: data.delayHours,
      conditionType: data.conditionType,
      conditionConfig: data.conditionConfig,
    })
    return { success: true, data: step }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to create step'
    console.error('[campaign-sequence-service] createStep:', message)
    return { success: false, error: message }
  }
}

export async function updateStep(
  id: string,
  orgId: string,
  data: {
    stepNumber?: number
    subject?: string
    bodyHtml?: string
    bodyText?: string
    delayDays?: number
    delayHours?: number
    conditionType?: string | null
    conditionConfig?: Record<string, unknown>
  }
): Promise<CampaignApiResult<CampaignSequenceStep>> {
  try {
    const updated = await seqRepo.updateStep(id, orgId, data)
    if (!updated) {
      return { success: false, error: 'Step not found or no changes' }
    }
    return { success: true, data: updated }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to update step'
    console.error('[campaign-sequence-service] updateStep:', message)
    return { success: false, error: message }
  }
}

export async function deleteStep(
  id: string,
  orgId: string
): Promise<CampaignApiResult<boolean>> {
  try {
    const deleted = await seqRepo.deleteStep(id, orgId)
    return { success: true, data: deleted }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to delete step'
    console.error('[campaign-sequence-service] deleteStep:', message)
    return { success: false, error: message }
  }
}
