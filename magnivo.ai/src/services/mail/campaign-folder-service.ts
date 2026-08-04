import type { CampaignFolder, CampaignApiResult } from '@/types/campaign'
import { CAMPAIGN_ERROR_MESSAGES } from '@/types/campaign'
import * as folderRepo from '@/repositories/mail/campaign-folder-repository'

export async function listFolders(orgId: string): Promise<CampaignFolder[]> {
  return folderRepo.findFoldersByOrg(orgId)
}

export async function getFolder(id: string, orgId: string): Promise<CampaignFolder | null> {
  return folderRepo.findFolderById(id, orgId)
}

export async function createFolder(
  orgId: string,
  data: { name: string; description?: string; parentId?: string | null }
): Promise<CampaignApiResult<CampaignFolder>> {
  if (!data.name || data.name.trim().length === 0) {
    return { success: false, error: 'Folder name is required' }
  }
  if (data.name.length > 255) {
    return { success: false, error: 'Folder name must be 255 characters or less' }
  }

  if (data.parentId) {
    const parent = await folderRepo.findFolderById(data.parentId, orgId)
    if (!parent) {
      return { success: false, error: 'Parent folder not found' }
    }
  }

  try {
    const folder = await folderRepo.insertFolder({
      organizationId: orgId,
      name: data.name.trim(),
      description: data.description ?? '',
      parentId: data.parentId ?? null,
    })
    return { success: true, data: folder }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to create folder'
    if (message.includes('duplicate') || message.includes('unique')) {
      return { success: false, error: 'A folder with this name already exists' }
    }
    console.error('[campaign-folder-service] createFolder:', message)
    return { success: false, error: message }
  }
}

export async function updateFolder(
  id: string,
  orgId: string,
  data: { name?: string; description?: string; parentId?: string | null; sortOrder?: number }
): Promise<CampaignApiResult<CampaignFolder>> {
  const existing = await folderRepo.findFolderById(id, orgId)
  if (!existing) {
    return { success: false, error: CAMPAIGN_ERROR_MESSAGES.CAMPAIGN_FOLDER_NOT_FOUND }
  }

  if (data.parentId === id) {
    return { success: false, error: 'A folder cannot be its own parent' }
  }

  try {
    const updated = await folderRepo.updateFolder(id, orgId, data)
    if (!updated) {
      return { success: false, error: 'Failed to update folder' }
    }
    return { success: true, data: updated }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to update folder'
    console.error('[campaign-folder-service] updateFolder:', message)
    return { success: false, error: message }
  }
}

export async function deleteFolder(
  id: string,
  orgId: string
): Promise<CampaignApiResult<boolean>> {
  const existing = await folderRepo.findFolderById(id, orgId)
  if (!existing) {
    return { success: false, error: CAMPAIGN_ERROR_MESSAGES.CAMPAIGN_FOLDER_NOT_FOUND }
  }

  try {
    const deleted = await folderRepo.softDeleteFolder(id, orgId)
    return { success: true, data: deleted }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to delete folder'
    console.error('[campaign-folder-service] deleteFolder:', message)
    return { success: false, error: message }
  }
}
