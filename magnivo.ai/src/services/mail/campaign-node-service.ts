import type { CampaignNode, CampaignNodeEdge, CampaignNodeCondition, CampaignApiResult } from '@/types/campaign'
import * as nodeRepo from '@/repositories/mail/campaign-node-repository'
import * as campaignRepo from '@/repositories/mail/campaign-repository'

export async function listNodes(campaignId: string, orgId: string): Promise<CampaignNode[]> {
  return nodeRepo.findNodesByCampaignId(campaignId, orgId)
}

export async function getNode(id: string, orgId: string): Promise<CampaignNode | null> {
  return nodeRepo.findNodeById(id, orgId)
}

export async function createNode(
  campaignId: string,
  orgId: string,
  data: {
    nodeType: string
    label?: string
    positionX?: number
    positionY?: number
    config?: Record<string, unknown>
  }
): Promise<CampaignApiResult<CampaignNode>> {
  const campaign = await campaignRepo.findCampaignById(campaignId, orgId)
  if (!campaign) {
    return { success: false, error: 'Campaign not found' }
  }

  const validNodeTypes = ['start', 'email', 'wait', 'condition', 'split', 'goal', 'webhook', 'delay', 'exit']
  if (!validNodeTypes.includes(data.nodeType)) {
    return { success: false, error: `Invalid node type "${data.nodeType}". Must be one of: ${validNodeTypes.join(', ')}` }
  }

  try {
    const node = await nodeRepo.insertNode({
      campaignId,
      organizationId: orgId,
      nodeType: data.nodeType,
      label: data.label,
      positionX: data.positionX,
      positionY: data.positionY,
      config: data.config,
    })
    return { success: true, data: node }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to create node'
    console.error('[campaign-node-service] createNode:', message)
    return { success: false, error: message }
  }
}

export async function updateNode(
  id: string,
  orgId: string,
  data: {
    nodeType?: string
    label?: string
    positionX?: number
    positionY?: number
    config?: Record<string, unknown>
  }
): Promise<CampaignApiResult<CampaignNode>> {
  try {
    const updated = await nodeRepo.updateNode(id, orgId, data)
    if (!updated) {
      return { success: false, error: 'Node not found or no changes' }
    }
    return { success: true, data: updated }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to update node'
    console.error('[campaign-node-service] updateNode:', message)
    return { success: false, error: message }
  }
}

export async function deleteNode(
  id: string,
  orgId: string
): Promise<CampaignApiResult<boolean>> {
  try {
    await nodeRepo.deleteConditionsByNodeId(id, orgId)
    const deleted = await nodeRepo.deleteNode(id, orgId)
    return { success: true, data: deleted }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to delete node'
    console.error('[campaign-node-service] deleteNode:', message)
    return { success: false, error: message }
  }
}

export async function listEdges(campaignId: string, orgId: string): Promise<CampaignNodeEdge[]> {
  return nodeRepo.findEdgesByCampaignId(campaignId, orgId)
}

export async function createEdge(
  campaignId: string,
  orgId: string,
  data: {
    sourceNodeId: string
    targetNodeId: string
    label?: string
    sortOrder?: number
  }
): Promise<CampaignApiResult<CampaignNodeEdge>> {
  const campaign = await campaignRepo.findCampaignById(campaignId, orgId)
  if (!campaign) {
    return { success: false, error: 'Campaign not found' }
  }

  if (data.sourceNodeId === data.targetNodeId) {
    return { success: false, error: 'A node cannot connect to itself' }
  }

  try {
    const edge = await nodeRepo.insertEdge({
      campaignId,
      organizationId: orgId,
      sourceNodeId: data.sourceNodeId,
      targetNodeId: data.targetNodeId,
      label: data.label,
      sortOrder: data.sortOrder,
    })
    return { success: true, data: edge }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to create edge'
    console.error('[campaign-node-service] createEdge:', message)
    return { success: false, error: message }
  }
}

export async function deleteEdge(
  id: string,
  orgId: string
): Promise<CampaignApiResult<boolean>> {
  try {
    const deleted = await nodeRepo.deleteEdge(id, orgId)
    return { success: true, data: deleted }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to delete edge'
    console.error('[campaign-node-service] deleteEdge:', message)
    return { success: false, error: message }
  }
}

export async function listConditions(nodeId: string, orgId: string): Promise<CampaignNodeCondition[]> {
  return nodeRepo.findConditionsByNodeId(nodeId, orgId)
}

export async function createCondition(
  nodeId: string,
  orgId: string,
  data: {
    conditionType: string
    field: string
    operator: string
    value: string
    sortOrder?: number
  }
): Promise<CampaignApiResult<CampaignNodeCondition>> {
  try {
    const condition = await nodeRepo.insertCondition({
      nodeId,
      organizationId: orgId,
      conditionType: data.conditionType,
      field: data.field,
      operator: data.operator,
      value: data.value,
      sortOrder: data.sortOrder,
    })
    return { success: true, data: condition }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to create condition'
    console.error('[campaign-node-service] createCondition:', message)
    return { success: false, error: message }
  }
}

export async function deleteConditions(
  nodeId: string,
  orgId: string
): Promise<CampaignApiResult<boolean>> {
  try {
    const deleted = await nodeRepo.deleteConditionsByNodeId(nodeId, orgId)
    return { success: true, data: deleted }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to delete conditions'
    console.error('[campaign-node-service] deleteConditions:', message)
    return { success: false, error: message }
  }
}
