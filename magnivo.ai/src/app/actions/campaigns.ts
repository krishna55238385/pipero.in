'use server'

import { getSessionUser } from '@/lib/auth'
import * as campaignService from '@/services/mail/campaign-service'
import * as versionService from '@/services/mail/campaign-version-service'
import * as statsService from '@/services/mail/campaign-statistics-service'
import * as folderService from '@/services/mail/campaign-folder-service'
import * as templateService from '@/services/mail/campaign-template-service'
import * as sequenceService from '@/services/mail/campaign-sequence-service'
import * as nodeService from '@/services/mail/campaign-node-service'
import * as variantService from '@/services/mail/campaign-variant-service'
import type {
  CampaignResponse,
  CampaignListResponse,
  CampaignSearchRequest,
  CampaignBulkRequest,
  CampaignBulkResult,
  CampaignDashboardStats,
  CreateCampaignRequest,
  UpdateCampaignRequest,
  CampaignApiResult,
  CampaignVersion,
  CampaignStatistics,
  CampaignFolder,
  CampaignTemplate,
  CampaignSequence,
  CampaignSequenceStep,
  CampaignNode,
  CampaignNodeEdge,
  CampaignNodeCondition,
  CampaignVariant,
  CampaignHistory,
  CampaignEvent,
  CampaignPermissionType,
  CampaignPermissions,
  CreateFolderRequest,
  UpdateFolderRequest,
  CreateTemplateRequest,
  UpdateTemplateRequest,
  CampaignFilterState,
} from '@/types/campaign'
import { getCampaignErrorMessage } from '@/types/campaign'

// ============================================================
// Auth Helpers
// ============================================================

type ActorInfo = { userId: string; email: string }

type AuthContext = {
  orgId: string
  actor: ActorInfo
  permissions: CampaignPermissions
}

async function getOrgIdAndActor(): Promise<AuthContext | null> {
  const session = await getSessionUser()
  if (!session?.orgId) return null
  return {
    orgId: session.orgId,
    actor: { userId: session.userId, email: session.email },
    permissions: {
      canRead: true,
      canWrite: true,
      canManage: true,
      canAdmin: session.role === 'admin' || session.role === 'super_admin',
    },
  }
}

function requirePermission(ctx: AuthContext | null, action: CampaignPermissionType): CampaignApiResult<never> | null {
  if (!ctx) return { success: false, error: 'Organization not found' }
  const map: Record<CampaignPermissionType, keyof CampaignPermissions> = {
    'campaign.read': 'canRead',
    'campaign.write': 'canWrite',
    'campaign.manage': 'canManage',
    'campaign.admin': 'canAdmin',
  }
  if (!ctx.permissions[map[action]]) {
    return { success: false, error: getCampaignErrorMessage('permission denied') }
  }
  return null
}

// ============================================================
// Campaign Actions
// ============================================================

export async function createCampaignAction(
  input: CreateCampaignRequest
): Promise<CampaignApiResult<CampaignResponse>> {
  const ctx = await getOrgIdAndActor()
  if (!ctx) return { success: false, error: 'Organization not found' }
  const perm = requirePermission(ctx, 'campaign.write')
  if (perm) return perm
  return campaignService.createCampaign(ctx.orgId, input, ctx.actor)
}

export async function updateCampaignAction(
  id: string,
  input: UpdateCampaignRequest
): Promise<CampaignApiResult<CampaignResponse>> {
  const ctx = await getOrgIdAndActor()
  if (!ctx) return { success: false, error: 'Organization not found' }
  const perm = requirePermission(ctx, 'campaign.write')
  if (perm) return perm
  return campaignService.updateCampaign(id, ctx.orgId, input, ctx.actor)
}

export async function deleteCampaignAction(
  id: string
): Promise<CampaignApiResult<boolean>> {
  const ctx = await getOrgIdAndActor()
  if (!ctx) return { success: false, error: 'Organization not found' }
  const perm = requirePermission(ctx, 'campaign.manage')
  if (perm) return perm
  return campaignService.deleteCampaign(id, ctx.orgId, ctx.actor)
}

export async function archiveCampaignAction(
  id: string
): Promise<CampaignApiResult<boolean>> {
  const ctx = await getOrgIdAndActor()
  if (!ctx) return { success: false, error: 'Organization not found' }
  const perm = requirePermission(ctx, 'campaign.manage')
  if (perm) return perm
  return campaignService.archiveCampaign(id, ctx.orgId, ctx.actor)
}

export async function restoreCampaignAction(
  id: string
): Promise<CampaignApiResult<boolean>> {
  const ctx = await getOrgIdAndActor()
  if (!ctx) return { success: false, error: 'Organization not found' }
  const perm = requirePermission(ctx, 'campaign.manage')
  if (perm) return perm
  return campaignService.restoreCampaign(id, ctx.orgId, ctx.actor)
}

export async function duplicateCampaignAction(
  id: string,
  newName?: string
): Promise<CampaignApiResult<CampaignResponse>> {
  const ctx = await getOrgIdAndActor()
  if (!ctx) return { success: false, error: 'Organization not found' }
  const perm = requirePermission(ctx, 'campaign.write')
  if (perm) return perm
  return campaignService.duplicateCampaign(id, ctx.orgId, ctx.actor, newName)
}

export async function pauseCampaignAction(
  id: string
): Promise<CampaignApiResult<CampaignResponse>> {
  const ctx = await getOrgIdAndActor()
  if (!ctx) return { success: false, error: 'Organization not found' }
  const perm = requirePermission(ctx, 'campaign.write')
  if (perm) return perm
  return campaignService.pauseCampaign(id, ctx.orgId, ctx.actor)
}

export async function resumeCampaignAction(
  id: string
): Promise<CampaignApiResult<CampaignResponse>> {
  const ctx = await getOrgIdAndActor()
  if (!ctx) return { success: false, error: 'Organization not found' }
  const perm = requirePermission(ctx, 'campaign.write')
  if (perm) return perm
  return campaignService.resumeCampaign(id, ctx.orgId, ctx.actor)
}

export async function launchCampaignAction(
  id: string
): Promise<CampaignApiResult<CampaignResponse>> {
  const ctx = await getOrgIdAndActor()
  if (!ctx) return { success: false, error: 'Organization not found' }
  const perm = requirePermission(ctx, 'campaign.write')
  if (perm) return perm
  return campaignService.launchCampaign(id, ctx.orgId, ctx.actor)
}

export async function getCampaignAction(
  id: string
): Promise<CampaignApiResult<CampaignResponse>> {
  const ctx = await getOrgIdAndActor()
  if (!ctx) return { success: false, error: 'Organization not found' }
  return campaignService.getCampaign(id, ctx.orgId)
}

export async function listCampaignsAction(
  filters?: Partial<CampaignFilterState>
): Promise<CampaignListResponse> {
  const ctx = await getOrgIdAndActor()
  if (!ctx) return { campaigns: [], total: 0, page: 1, pageSize: 20, totalPages: 0 }

  const searchParams: CampaignSearchRequest = {
    search: filters?.search,
    status: filters?.status,
    folderId: filters?.folderId,
    tagId: filters?.tagId,
    labelId: filters?.labelId,
    ownerId: filters?.ownerId,
    poolId: filters?.poolId,
    sortBy: filters?.sortBy,
    sortDirection: filters?.sortDirection,
    page: filters?.page,
    pageSize: filters?.pageSize,
  }

  try {
    return await campaignService.searchCampaigns(ctx.orgId, searchParams)
  } catch (err) {
    console.error('[campaign-actions] listCampaignsAction:', err instanceof Error ? err.message : err)
    return { campaigns: [], total: 0, page: 1, pageSize: 20, totalPages: 0 }
  }
}

export async function searchCampaignsAction(
  params: CampaignSearchRequest
): Promise<CampaignListResponse> {
  const ctx = await getOrgIdAndActor()
  if (!ctx) return { campaigns: [], total: 0, page: 1, pageSize: 20, totalPages: 0 }
  try {
    return await campaignService.searchCampaigns(ctx.orgId, params)
  } catch (err) {
    console.error('[campaign-actions] searchCampaignsAction:', err instanceof Error ? err.message : err)
    return { campaigns: [], total: 0, page: 1, pageSize: 20, totalPages: 0 }
  }
}

export async function getDashboardStatsAction(): Promise<CampaignDashboardStats> {
  const ctx = await getOrgIdAndActor()
  if (!ctx) return { totalCampaigns: 0, draft: 0, scheduled: 0, running: 0, paused: 0, completed: 0, archived: 0, failed: 0, totalSent: 0, totalOpened: 0, totalClicked: 0, avgOpenRate: 0, avgClickRate: 0 }
  try {
    return await campaignService.getDashboardStats(ctx.orgId)
  } catch (err) {
    console.error('[campaign-actions] getDashboardStatsAction:', err instanceof Error ? err.message : err)
    return { totalCampaigns: 0, draft: 0, scheduled: 0, running: 0, paused: 0, completed: 0, archived: 0, failed: 0, totalSent: 0, totalOpened: 0, totalClicked: 0, avgOpenRate: 0, avgClickRate: 0 }
  }
}

export async function moveCampaignToFolderAction(
  id: string,
  folderId: string | null
): Promise<CampaignApiResult<CampaignResponse>> {
  const ctx = await getOrgIdAndActor()
  if (!ctx) return { success: false, error: 'Organization not found' }
  const perm = requirePermission(ctx, 'campaign.write')
  if (perm) return perm
  return campaignService.moveCampaignToFolder(id, ctx.orgId, folderId, ctx.actor)
}

// ============================================================
// Tag & Label Actions
// ============================================================

export async function updateCampaignTagsAction(
  id: string,
  tagIds: string[]
): Promise<CampaignApiResult<boolean>> {
  const ctx = await getOrgIdAndActor()
  if (!ctx) return { success: false, error: 'Organization not found' }
  const perm = requirePermission(ctx, 'campaign.write')
  if (perm) return perm
  return campaignService.updateCampaignTags(id, ctx.orgId, tagIds, ctx.actor)
}

export async function updateCampaignLabelsAction(
  id: string,
  labelIds: string[]
): Promise<CampaignApiResult<boolean>> {
  const ctx = await getOrgIdAndActor()
  if (!ctx) return { success: false, error: 'Organization not found' }
  const perm = requirePermission(ctx, 'campaign.write')
  if (perm) return perm
  return campaignService.updateCampaignLabels(id, ctx.orgId, labelIds, ctx.actor)
}

export async function listTagsAction() {
  const ctx = await getOrgIdAndActor()
  if (!ctx) return []
  try {
    return await campaignService.listTags(ctx.orgId)
  } catch (err) {
    console.error('[campaign-actions] listTagsAction:', err instanceof Error ? err.message : err)
    return []
  }
}

export async function createTagAction(name: string, color?: string) {
  const ctx = await getOrgIdAndActor()
  if (!ctx) return null
  const perm = requirePermission(ctx, 'campaign.write')
  if (perm) return null
  try {
    return await campaignService.createTag(ctx.orgId, name, color)
  } catch (err) {
    console.error('[campaign-actions] createTagAction:', err instanceof Error ? err.message : err)
    return null
  }
}

export async function updateTagAction(id: string, data: { name?: string; color?: string }) {
  const ctx = await getOrgIdAndActor()
  if (!ctx) return null
  try {
    return await campaignService.updateTag(id, ctx.orgId, data)
  } catch (err) {
    console.error('[campaign-actions] updateTagAction:', err instanceof Error ? err.message : err)
    return null
  }
}

export async function deleteTagAction(id: string) {
  const ctx = await getOrgIdAndActor()
  if (!ctx) return false
  const perm = requirePermission(ctx, 'campaign.manage')
  if (perm) return false
  try {
    return await campaignService.deleteTag(id, ctx.orgId)
  } catch (err) {
    console.error('[campaign-actions] deleteTagAction:', err instanceof Error ? err.message : err)
    return false
  }
}

export async function listLabelsAction() {
  const ctx = await getOrgIdAndActor()
  if (!ctx) return []
  try {
    return await campaignService.listLabels(ctx.orgId)
  } catch (err) {
    console.error('[campaign-actions] listLabelsAction:', err instanceof Error ? err.message : err)
    return []
  }
}

export async function createLabelAction(name: string, color?: string) {
  const ctx = await getOrgIdAndActor()
  if (!ctx) return null
  const perm = requirePermission(ctx, 'campaign.write')
  if (perm) return null
  try {
    return await campaignService.createLabel(ctx.orgId, name, color)
  } catch (err) {
    console.error('[campaign-actions] createLabelAction:', err instanceof Error ? err.message : err)
    return null
  }
}

export async function updateLabelAction(id: string, data: { name?: string; color?: string }) {
  const ctx = await getOrgIdAndActor()
  if (!ctx) return null
  try {
    return await campaignService.updateLabel(id, ctx.orgId, data)
  } catch (err) {
    console.error('[campaign-actions] updateLabelAction:', err instanceof Error ? err.message : err)
    return null
  }
}

export async function deleteLabelAction(id: string) {
  const ctx = await getOrgIdAndActor()
  if (!ctx) return false
  const perm = requirePermission(ctx, 'campaign.manage')
  if (perm) return false
  try {
    return await campaignService.deleteLabel(id, ctx.orgId)
  } catch (err) {
    console.error('[campaign-actions] deleteLabelAction:', err instanceof Error ? err.message : err)
    return false
  }
}

// ============================================================
// Bulk Operations
// ============================================================

export async function bulkCampaignAction(
  request: CampaignBulkRequest
): Promise<CampaignApiResult<CampaignBulkResult[]>> {
  const ctx = await getOrgIdAndActor()
  if (!ctx) return { success: false, error: 'Organization not found' }
  const perm = requirePermission(ctx, 'campaign.manage')
  if (perm) return perm
  return campaignService.bulkOperation(request, ctx.orgId, ctx.actor)
}

// ============================================================
// History & Events
// ============================================================

export async function getCampaignHistoryAction(
  campaignId: string,
  limit?: number,
  offset?: number
): Promise<CampaignHistory[]> {
  const ctx = await getOrgIdAndActor()
  if (!ctx) return []
  try {
    return await campaignService.getCampaignHistory(campaignId, ctx.orgId, limit, offset)
  } catch (err) {
    console.error('[campaign-actions] getCampaignHistoryAction:', err instanceof Error ? err.message : err)
    return []
  }
}

export async function getCampaignEventsAction(
  campaignId: string,
  limit?: number,
  offset?: number
): Promise<CampaignEvent[]> {
  const ctx = await getOrgIdAndActor()
  if (!ctx) return []
  try {
    return await campaignService.getCampaignEvents(campaignId, ctx.orgId, limit, offset)
  } catch (err) {
    console.error('[campaign-actions] getCampaignEventsAction:', err instanceof Error ? err.message : err)
    return []
  }
}

// ============================================================
// Version Actions
// ============================================================

export async function saveVersionAction(
  campaignId: string,
  changeSummary: string
): Promise<CampaignApiResult<CampaignVersion>> {
  const ctx = await getOrgIdAndActor()
  if (!ctx) return { success: false, error: 'Organization not found' }
  const perm = requirePermission(ctx, 'campaign.write')
  if (perm) return perm
  return versionService.saveVersion(campaignId, ctx.orgId, changeSummary, ctx.actor)
}

export async function rollbackVersionAction(
  campaignId: string,
  versionNumber: number
): Promise<CampaignApiResult<boolean>> {
  const ctx = await getOrgIdAndActor()
  if (!ctx) return { success: false, error: 'Organization not found' }
  const perm = requirePermission(ctx, 'campaign.manage')
  if (perm) return perm
  return versionService.rollbackVersion(campaignId, ctx.orgId, versionNumber, ctx.actor)
}

export async function listVersionsAction(
  campaignId: string
): Promise<CampaignApiResult<CampaignVersion[]>> {
  const ctx = await getOrgIdAndActor()
  if (!ctx) return { success: false, error: 'Organization not found' }
  return versionService.listVersions(campaignId, ctx.orgId)
}

// ============================================================
// Statistics Actions
// ============================================================

export async function getStatisticsAction(
  campaignId: string
): Promise<CampaignApiResult<CampaignStatistics[]>> {
  const ctx = await getOrgIdAndActor()
  if (!ctx) return { success: false, error: 'Organization not found' }
  return statsService.getStatistics(campaignId, ctx.orgId)
}

export async function getAggregatedStatsAction(
  campaignId: string
): Promise<CampaignApiResult<{
  totalSent: number
  totalDelivered: number
  totalOpened: number
  totalClicked: number
  totalReplied: number
  totalBounced: number
  totalUnsubscribed: number
}>> {
  const ctx = await getOrgIdAndActor()
  if (!ctx) return { success: false, error: 'Organization not found' }
  return statsService.getAggregatedStats(campaignId, ctx.orgId)
}

// ============================================================
// Folder Actions
// ============================================================

export async function listFoldersAction(): Promise<CampaignFolder[]> {
  const ctx = await getOrgIdAndActor()
  if (!ctx) return []
  try {
    return await folderService.listFolders(ctx.orgId)
  } catch (err) {
    console.error('[campaign-actions] listFoldersAction:', err instanceof Error ? err.message : err)
    return []
  }
}

export async function createFolderAction(
  input: CreateFolderRequest
): Promise<CampaignApiResult<CampaignFolder>> {
  const ctx = await getOrgIdAndActor()
  if (!ctx) return { success: false, error: 'Organization not found' }
  const perm = requirePermission(ctx, 'campaign.write')
  if (perm) return perm
  return folderService.createFolder(ctx.orgId, input)
}

export async function updateFolderAction(
  id: string,
  input: UpdateFolderRequest
): Promise<CampaignApiResult<CampaignFolder>> {
  const ctx = await getOrgIdAndActor()
  if (!ctx) return { success: false, error: 'Organization not found' }
  const perm = requirePermission(ctx, 'campaign.write')
  if (perm) return perm
  return folderService.updateFolder(id, ctx.orgId, input)
}

export async function deleteFolderAction(
  id: string
): Promise<CampaignApiResult<boolean>> {
  const ctx = await getOrgIdAndActor()
  if (!ctx) return { success: false, error: 'Organization not found' }
  const perm = requirePermission(ctx, 'campaign.manage')
  if (perm) return perm
  return folderService.deleteFolder(id, ctx.orgId)
}

// ============================================================
// Template Actions
// ============================================================

export async function listTemplatesAction(): Promise<CampaignTemplate[]> {
  const ctx = await getOrgIdAndActor()
  if (!ctx) return []
  try {
    return await templateService.listTemplates(ctx.orgId)
  } catch (err) {
    console.error('[campaign-actions] listTemplatesAction:', err instanceof Error ? err.message : err)
    return []
  }
}

export async function createTemplateAction(
  input: CreateTemplateRequest
): Promise<CampaignApiResult<CampaignTemplate>> {
  const ctx = await getOrgIdAndActor()
  if (!ctx) return { success: false, error: 'Organization not found' }
  const perm = requirePermission(ctx, 'campaign.write')
  if (perm) return perm
  return templateService.createTemplate(ctx.orgId, input)
}

export async function updateTemplateAction(
  id: string,
  input: UpdateTemplateRequest
): Promise<CampaignApiResult<CampaignTemplate>> {
  const ctx = await getOrgIdAndActor()
  if (!ctx) return { success: false, error: 'Organization not found' }
  const perm = requirePermission(ctx, 'campaign.write')
  if (perm) return perm
  return templateService.updateTemplate(id, ctx.orgId, input)
}

export async function deleteTemplateAction(
  id: string
): Promise<CampaignApiResult<boolean>> {
  const ctx = await getOrgIdAndActor()
  if (!ctx) return { success: false, error: 'Organization not found' }
  const perm = requirePermission(ctx, 'campaign.manage')
  if (perm) return perm
  return templateService.deleteTemplate(id, ctx.orgId)
}

export async function applyTemplateAction(
  campaignId: string,
  templateId: string
): Promise<CampaignApiResult<boolean>> {
  const ctx = await getOrgIdAndActor()
  if (!ctx) return { success: false, error: 'Organization not found' }
  const perm = requirePermission(ctx, 'campaign.write')
  if (perm) return perm
  return templateService.applyTemplate(campaignId, templateId, ctx.orgId)
}

// ============================================================
// Sequence Actions
// ============================================================

export async function listSequencesAction(
  campaignId: string
): Promise<CampaignSequence[]> {
  const ctx = await getOrgIdAndActor()
  if (!ctx) return []
  try {
    return await sequenceService.listSequences(campaignId, ctx.orgId)
  } catch (err) {
    console.error('[campaign-actions] listSequencesAction:', err instanceof Error ? err.message : err)
    return []
  }
}

export async function createSequenceAction(
  campaignId: string,
  data: { name: string; description?: string }
): Promise<CampaignApiResult<CampaignSequence>> {
  const ctx = await getOrgIdAndActor()
  if (!ctx) return { success: false, error: 'Organization not found' }
  const perm = requirePermission(ctx, 'campaign.write')
  if (perm) return perm
  return sequenceService.createSequence(campaignId, ctx.orgId, data)
}

export async function updateSequenceAction(
  id: string,
  data: { name?: string; description?: string; status?: string }
): Promise<CampaignApiResult<CampaignSequence>> {
  const ctx = await getOrgIdAndActor()
  if (!ctx) return { success: false, error: 'Organization not found' }
  const perm = requirePermission(ctx, 'campaign.write')
  if (perm) return perm
  return sequenceService.updateSequence(id, ctx.orgId, data)
}

export async function deleteSequenceAction(
  id: string
): Promise<CampaignApiResult<boolean>> {
  const ctx = await getOrgIdAndActor()
  if (!ctx) return { success: false, error: 'Organization not found' }
  const perm = requirePermission(ctx, 'campaign.manage')
  if (perm) return perm
  return sequenceService.deleteSequence(id, ctx.orgId)
}

export async function createSequenceStepAction(
  sequenceId: string,
  data: { stepNumber: number; subject?: string; bodyHtml?: string; bodyText?: string; delayDays?: number; delayHours?: number }
): Promise<CampaignApiResult<CampaignSequenceStep>> {
  const ctx = await getOrgIdAndActor()
  if (!ctx) return { success: false, error: 'Organization not found' }
  const perm = requirePermission(ctx, 'campaign.write')
  if (perm) return perm
  return sequenceService.createStep(sequenceId, ctx.orgId, data)
}

export async function updateSequenceStepAction(
  id: string,
  data: { stepNumber?: number; subject?: string; bodyHtml?: string; bodyText?: string; delayDays?: number; delayHours?: number }
): Promise<CampaignApiResult<CampaignSequenceStep>> {
  const ctx = await getOrgIdAndActor()
  if (!ctx) return { success: false, error: 'Organization not found' }
  const perm = requirePermission(ctx, 'campaign.write')
  if (perm) return perm
  return sequenceService.updateStep(id, ctx.orgId, data)
}

export async function deleteSequenceStepAction(
  id: string
): Promise<CampaignApiResult<boolean>> {
  const ctx = await getOrgIdAndActor()
  if (!ctx) return { success: false, error: 'Organization not found' }
  const perm = requirePermission(ctx, 'campaign.manage')
  if (perm) return perm
  return sequenceService.deleteStep(id, ctx.orgId)
}

// ============================================================
// Node Actions
// ============================================================

export async function listNodesAction(
  campaignId: string
): Promise<CampaignNode[]> {
  const ctx = await getOrgIdAndActor()
  if (!ctx) return []
  try {
    return await nodeService.listNodes(campaignId, ctx.orgId)
  } catch (err) {
    console.error('[campaign-actions] listNodesAction:', err instanceof Error ? err.message : err)
    return []
  }
}

export async function createNodeAction(
  campaignId: string,
  data: { nodeType: string; label?: string; positionX?: number; positionY?: number; config?: Record<string, unknown> }
): Promise<CampaignApiResult<CampaignNode>> {
  const ctx = await getOrgIdAndActor()
  if (!ctx) return { success: false, error: 'Organization not found' }
  const perm = requirePermission(ctx, 'campaign.write')
  if (perm) return perm
  return nodeService.createNode(campaignId, ctx.orgId, data)
}

export async function updateNodeAction(
  id: string,
  data: { label?: string; positionX?: number; positionY?: number; config?: Record<string, unknown> }
): Promise<CampaignApiResult<CampaignNode>> {
  const ctx = await getOrgIdAndActor()
  if (!ctx) return { success: false, error: 'Organization not found' }
  const perm = requirePermission(ctx, 'campaign.write')
  if (perm) return perm
  return nodeService.updateNode(id, ctx.orgId, data)
}

export async function deleteNodeAction(
  id: string
): Promise<CampaignApiResult<boolean>> {
  const ctx = await getOrgIdAndActor()
  if (!ctx) return { success: false, error: 'Organization not found' }
  const perm = requirePermission(ctx, 'campaign.manage')
  if (perm) return perm
  return nodeService.deleteNode(id, ctx.orgId)
}

export async function createEdgeAction(
  campaignId: string,
  data: { sourceNodeId: string; targetNodeId: string; label?: string }
): Promise<CampaignApiResult<CampaignNodeEdge>> {
  const ctx = await getOrgIdAndActor()
  if (!ctx) return { success: false, error: 'Organization not found' }
  const perm = requirePermission(ctx, 'campaign.write')
  if (perm) return perm
  return nodeService.createEdge(campaignId, ctx.orgId, data)
}

export async function deleteEdgeAction(
  id: string
): Promise<CampaignApiResult<boolean>> {
  const ctx = await getOrgIdAndActor()
  if (!ctx) return { success: false, error: 'Organization not found' }
  const perm = requirePermission(ctx, 'campaign.manage')
  if (perm) return perm
  return nodeService.deleteEdge(id, ctx.orgId)
}

export async function createConditionAction(
  nodeId: string,
  data: { conditionType: string; field: string; operator: string; value: string }
): Promise<CampaignApiResult<CampaignNodeCondition>> {
  const ctx = await getOrgIdAndActor()
  if (!ctx) return { success: false, error: 'Organization not found' }
  const perm = requirePermission(ctx, 'campaign.write')
  if (perm) return perm
  return nodeService.createCondition(nodeId, ctx.orgId, data)
}

// ============================================================
// Variant Actions
// ============================================================

export async function listVariantsAction(
  campaignId: string
): Promise<CampaignVariant[]> {
  const ctx = await getOrgIdAndActor()
  if (!ctx) return []
  try {
    return await variantService.listVariants(campaignId, ctx.orgId)
  } catch (err) {
    console.error('[campaign-actions] listVariantsAction:', err instanceof Error ? err.message : err)
    return []
  }
}

export async function createVariantAction(
  campaignId: string,
  data: { variantType: string; name?: string; subject?: string; bodyHtml?: string; bodyText?: string; percentage?: number }
): Promise<CampaignApiResult<CampaignVariant>> {
  const ctx = await getOrgIdAndActor()
  if (!ctx) return { success: false, error: 'Organization not found' }
  const perm = requirePermission(ctx, 'campaign.write')
  if (perm) return perm
  return variantService.createVariant(campaignId, ctx.orgId, data)
}

export async function updateVariantAction(
  id: string,
  data: { name?: string; subject?: string; bodyHtml?: string; bodyText?: string; percentage?: number }
): Promise<CampaignApiResult<CampaignVariant>> {
  const ctx = await getOrgIdAndActor()
  if (!ctx) return { success: false, error: 'Organization not found' }
  const perm = requirePermission(ctx, 'campaign.write')
  if (perm) return perm
  return variantService.updateVariant(id, ctx.orgId, data)
}

export async function deleteVariantAction(
  id: string
): Promise<CampaignApiResult<boolean>> {
  const ctx = await getOrgIdAndActor()
  if (!ctx) return { success: false, error: 'Organization not found' }
  const perm = requirePermission(ctx, 'campaign.manage')
  if (perm) return perm
  return variantService.deleteVariant(id, ctx.orgId)
}

export async function markWinnerAction(
  campaignId: string,
  variantId: string
): Promise<CampaignApiResult<boolean>> {
  const ctx = await getOrgIdAndActor()
  if (!ctx) return { success: false, error: 'Organization not found' }
  const perm = requirePermission(ctx, 'campaign.write')
  if (perm) return perm
  return variantService.markWinner(campaignId, variantId, ctx.orgId)
}

export async function generateAiVariantsAction(
  input: import('@/services/mail/ai-variant-service').GenerateAiVariantsInput
): Promise<CampaignApiResult<import('@/services/mail/ai-variant-service').GenerateAiVariantsResult>> {
  const ctx = await getOrgIdAndActor()
  if (!ctx) return { success: false, error: 'Organization not found' }
  const perm = requirePermission(ctx, 'campaign.write')
  if (perm) return perm
  try {
    const { generateAiEmailVariants } = await import('@/services/mail/ai-variant-service')
    const data = await generateAiEmailVariants(input)
    return { success: true, data }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'AI variant generation failed'
    return { success: false, error: message }
  }
}

// ============================================================
// Builder Convenience Actions
// ============================================================

import type { CampaignRecord } from '@/types/campaign'

export async function getCampaign(id: string): Promise<CampaignRecord | null> {
  const ctx = await getOrgIdAndActor()
  if (!ctx) return null
  try {
    const result = await campaignService.getCampaign(id, ctx.orgId)
    if (!result.success) return null
    const base = result.data

    const [sequences, nodes, edges, variants] = await Promise.all([
      sequenceService.listSequences(id, ctx.orgId).catch(() => []),
      nodeService.listNodes(id, ctx.orgId).catch(() => []),
      nodeService.listEdges(id, ctx.orgId).catch(() => []),
      variantService.listVariants(id, ctx.orgId).catch(() => []),
    ])

    const sequencesWithSteps = await Promise.all(
      sequences.map(async (seq) => {
        try {
          const steps = await sequenceService.listSteps(seq.id, ctx.orgId)
          return { ...seq, steps }
        } catch {
          return { ...seq, steps: [] }
        }
      }),
    )

    return {
      ...base,
      sequences: sequencesWithSteps,
      nodes,
      edges,
      variants,
    } as CampaignRecord
  } catch (err) {
    console.error('[campaign-actions] getCampaign:', err instanceof Error ? err.message : err)
    return null
  }
}

export async function persistCampaign(data: {
  id: string
  name?: string
  nodes?: { id: string; type: string; name: string; positionX: number; positionY: number; subject?: string; body?: string; duration?: number; unit?: string; field?: string; operator?: string; value?: string; url?: string; method?: string; goalName?: string; goalType?: string }[]
  edges?: { id: string; source: string; target: string; label?: string }[]
}): Promise<void> {
  const ctx = await getOrgIdAndActor()
  if (!ctx) throw new Error('Organization not found')

  if (data.name) {
    await campaignService.updateCampaign(data.id, ctx.orgId, {
      name: data.name,
    }, ctx.actor)
  }

  if (data.nodes) {
    const existingNodes = await nodeService.listNodes(data.id, ctx.orgId)
    const existingIds = new Set(existingNodes.map((n) => n.id))

    for (const node of data.nodes) {
      if (existingIds.has(node.id)) {
        await nodeService.updateNode(node.id, ctx.orgId, {
          label: node.name,
          positionX: node.positionX,
          positionY: node.positionY,
          config: {
            subject: node.subject,
            body: node.body,
            duration: node.duration,
            unit: node.unit,
            field: node.field,
            operator: node.operator,
            value: node.value,
            url: node.url,
            method: node.method,
            goalName: node.goalName,
            goalType: node.goalType,
          },
        })
      } else {
        await nodeService.createNode(data.id, ctx.orgId, {
          nodeType: node.type,
          label: node.name,
          positionX: node.positionX,
          positionY: node.positionY,
          config: {
            subject: node.subject,
            body: node.body,
            duration: node.duration,
            unit: node.unit,
            field: node.field,
            operator: node.operator,
            value: node.value,
            url: node.url,
            method: node.method,
            goalName: node.goalName,
            goalType: node.goalType,
          },
        })
      }
    }

    for (const existing of existingNodes) {
      if (!data.nodes.find((n) => n.id === existing.id)) {
        await nodeService.deleteNode(existing.id, ctx.orgId)
      }
    }
  }

  if (data.edges) {
    const existingEdges = await nodeService.listEdges(data.id, ctx.orgId)
    for (const existing of existingEdges) {
      await nodeService.deleteEdge(existing.id, ctx.orgId)
    }
    for (const edge of data.edges) {
      await nodeService.createEdge(data.id, ctx.orgId, {
        sourceNodeId: edge.source,
        targetNodeId: edge.target,
        label: edge.label,
      })
    }
  }
}

export async function getVersionHistory(campaignId: string): Promise<CampaignApiResult<CampaignVersion[]>> {
  return listVersionsAction(campaignId)
}

export async function restoreCampaignVersion(data: { campaignId: string; versionId: string }): Promise<void> {
  const ctx = await getOrgIdAndActor()
  if (!ctx) throw new Error('Organization not found')
  const perm = requirePermission(ctx, 'campaign.manage')
  if (perm) throw new Error('Permission denied')

  const versions = await versionService.listVersions(data.campaignId, ctx.orgId)
  if (!versions.success) throw new Error('Failed to list versions')
  const version = versions.data.find((v) => v.id === data.versionId)
  if (!version) throw new Error('Version not found')

  const result = await versionService.rollbackVersion(data.campaignId, ctx.orgId, version.versionNumber, ctx.actor)
  if (!result.success) throw new Error(result.error || 'Failed to restore version')
}

/** Render first email step with sample merge tags (PRD §6.4.39). */
export async function previewCampaignEmailAction(input: {
  campaignId: string
  sample?: {
    first_name?: string
    name?: string
    company?: string
    job_title?: string
    email?: string
  }
  sendTo?: string
}): Promise<CampaignApiResult<{ subject: string; bodyHtml: string; sent?: boolean }>> {
  const ctx = await getOrgIdAndActor()
  if (!ctx) return { success: false, error: 'Organization not found' }
  const perm = requirePermission(ctx, 'campaign.write')
  if (perm) return perm

  const campaign = await campaignService.getCampaign(input.campaignId, ctx.orgId)
  if (!campaign.success || !campaign.data) return { success: false, error: 'Campaign not found' }

  const nodes = await nodeService.listNodes(input.campaignId, ctx.orgId)
  const emailNode = nodes.find((n) => n.nodeType === 'email') || null

  const subjectTpl = String(emailNode?.config?.subject || campaign.data.name || 'Preview')
  const bodyTpl = String(emailNode?.config?.body || '<p>Hello {{first_name}},</p><p>Preview body.</p>')

  const sample = {
    first_name: input.sample?.first_name || 'Alex',
    name: input.sample?.name || 'Alex Rivera',
    company: input.sample?.company || 'Acme Corp',
    job_title: input.sample?.job_title || 'VP Sales',
    email: input.sample?.email || 'alex@example.com',
    sender_name: 'Magnivo',
    unsubscribe_url: '#unsubscribe',
  }

  const apply = (tpl: string) =>
    tpl
      .replace(/\{\{first_name\}\}/gi, sample.first_name)
      .replace(/\{\{name\}\}/gi, sample.name)
      .replace(/\{\{company\}\}/gi, sample.company)
      .replace(/\{\{job_title\}\}/gi, sample.job_title)
      .replace(/\{\{email\}\}/gi, sample.email)
      .replace(/\{\{sender_name\}\}/gi, sample.sender_name)
      .replace(/\{\{unsubscribe_url\}\}/gi, sample.unsubscribe_url)

  const subject = apply(subjectTpl)
  const bodyHtml = apply(bodyTpl)

  if (input.sendTo) {
    try {
      const { sendSystemNotificationEmail } = await import('@/services/mail/system-notify-email')
      const sent = await sendSystemNotificationEmail({
        to: input.sendTo,
        subject: `[Preview] ${subject}`,
        text: bodyHtml.replace(/<[^>]+>/g, ' '),
        html: bodyHtml,
      })
      return {
        success: true,
        data: { subject, bodyHtml, sent: sent.success },
      }
    } catch {
      return { success: true, data: { subject, bodyHtml, sent: false } }
    }
  }

  return { success: true, data: { subject, bodyHtml } }
}
