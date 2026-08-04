import pool from '@/lib/db'
import type { CampaignNode, CampaignNodeEdge, CampaignNodeCondition, NodeType } from '@/types/campaign'

// ============================================================
// Row Types
// ============================================================

type CampaignNodeRow = {
  id: string
  campaign_id: string
  organization_id: string
  node_type: string
  label: string
  position_x: number
  position_y: number
  config: Record<string, unknown>
  metadata: Record<string, unknown>
  created_at: string
  updated_at: string
}

type CampaignNodeEdgeRow = {
  id: string
  campaign_id: string
  organization_id: string
  source_node_id: string
  target_node_id: string
  label: string
  sort_order: number
  metadata: Record<string, unknown>
  created_at: string
}

type CampaignNodeConditionRow = {
  id: string
  node_id: string
  organization_id: string
  condition_type: string
  field: string
  operator: string
  value: string
  sort_order: number
  metadata: Record<string, unknown>
  created_at: string
}

// ============================================================
// Mappers
// ============================================================

function mapNodeRow(row: CampaignNodeRow): CampaignNode {
  return {
    id: row.id,
    campaignId: row.campaign_id,
    organizationId: row.organization_id,
    nodeType: row.node_type as NodeType,
    label: row.label,
    positionX: row.position_x,
    positionY: row.position_y,
    config: row.config || {},
    metadata: row.metadata || {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function mapEdgeRow(row: CampaignNodeEdgeRow): CampaignNodeEdge {
  return {
    id: row.id,
    campaignId: row.campaign_id,
    organizationId: row.organization_id,
    sourceNodeId: row.source_node_id,
    targetNodeId: row.target_node_id,
    label: row.label,
    sortOrder: row.sort_order,
    metadata: row.metadata || {},
    createdAt: row.created_at,
  }
}

function mapConditionRow(row: CampaignNodeConditionRow): CampaignNodeCondition {
  return {
    id: row.id,
    nodeId: row.node_id,
    organizationId: row.organization_id,
    conditionType: row.condition_type,
    field: row.field,
    operator: row.operator,
    value: row.value,
    sortOrder: row.sort_order,
    metadata: row.metadata || {},
    createdAt: row.created_at,
  }
}

// ============================================================
// Node CRUD
// ============================================================

export async function findNodesByCampaignId(campaignId: string, orgId: string): Promise<CampaignNode[]> {
  const result = await pool.query<CampaignNodeRow>(
    `SELECT * FROM public.campaign_nodes
     WHERE campaign_id = $1 AND organization_id = $2
     ORDER BY created_at ASC`,
    [campaignId, orgId]
  )
  return result.rows.map(mapNodeRow)
}

export async function findNodeById(id: string, orgId: string): Promise<CampaignNode | null> {
  const result = await pool.query<CampaignNodeRow>(
    `SELECT * FROM public.campaign_nodes WHERE id = $1 AND organization_id = $2`,
    [id, orgId]
  )
  return result.rows[0] ? mapNodeRow(result.rows[0]) : null
}

export async function insertNode(data: {
  campaignId: string
  organizationId: string
  nodeType: string
  label?: string
  positionX?: number
  positionY?: number
  config?: Record<string, unknown>
  metadata?: Record<string, unknown>
}): Promise<CampaignNode> {
  const result = await pool.query<CampaignNodeRow>(
    `INSERT INTO public.campaign_nodes
      (campaign_id, organization_id, node_type, label, position_x, position_y, config, metadata)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     RETURNING *`,
    [
      data.campaignId,
      data.organizationId,
      data.nodeType,
      data.label ?? '',
      data.positionX ?? 0,
      data.positionY ?? 0,
      JSON.stringify(data.config ?? {}),
      JSON.stringify(data.metadata ?? {}),
    ]
  )
  return mapNodeRow(result.rows[0])
}

export async function updateNode(
  id: string,
  orgId: string,
  data: Record<string, unknown>
): Promise<CampaignNode | null> {
  const fieldMap: Record<string, string> = {
    nodeType: 'node_type', label: 'label',
    positionX: 'position_x', positionY: 'position_y',
    config: 'config', metadata: 'metadata',
  }

  const setClauses: string[] = []
  const values: unknown[] = []
  let paramIndex = 1

  for (const [key, dbCol] of Object.entries(fieldMap)) {
    const val = data[key]
    if (val !== undefined) {
      setClauses.push(`${dbCol} = $${paramIndex++}`)
      values.push(key === 'config' || key === 'metadata' ? JSON.stringify(val) : val)
    }
  }

  if (setClauses.length === 0) {
    return findNodeById(id, orgId)
  }

  setClauses.push(`updated_at = NOW()`)
  values.push(id, orgId)

  const result = await pool.query<CampaignNodeRow>(
    `UPDATE public.campaign_nodes SET ${setClauses.join(', ')}
     WHERE id = $${paramIndex} AND organization_id = $${paramIndex + 1}
     RETURNING *`,
    values
  )
  return result.rows[0] ? mapNodeRow(result.rows[0]) : null
}

export async function deleteNode(id: string, orgId: string): Promise<boolean> {
  const result = await pool.query(
    `DELETE FROM public.campaign_nodes WHERE id = $1 AND organization_id = $2`,
    [id, orgId]
  )
  return (result.rowCount ?? 0) > 0
}

// ============================================================
// Edge CRUD
// ============================================================

export async function findEdgesByCampaignId(campaignId: string, orgId: string): Promise<CampaignNodeEdge[]> {
  const result = await pool.query<CampaignNodeEdgeRow>(
    `SELECT * FROM public.campaign_node_edges
     WHERE campaign_id = $1 AND organization_id = $2
     ORDER BY sort_order ASC`,
    [campaignId, orgId]
  )
  return result.rows.map(mapEdgeRow)
}

export async function insertEdge(data: {
  campaignId: string
  organizationId: string
  sourceNodeId: string
  targetNodeId: string
  label?: string
  sortOrder?: number
  metadata?: Record<string, unknown>
}): Promise<CampaignNodeEdge> {
  const result = await pool.query<CampaignNodeEdgeRow>(
    `INSERT INTO public.campaign_node_edges
      (campaign_id, organization_id, source_node_id, target_node_id, label, sort_order, metadata)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     RETURNING *`,
    [
      data.campaignId,
      data.organizationId,
      data.sourceNodeId,
      data.targetNodeId,
      data.label ?? '',
      data.sortOrder ?? 0,
      JSON.stringify(data.metadata ?? {}),
    ]
  )
  return mapEdgeRow(result.rows[0])
}

export async function deleteEdge(id: string, orgId: string): Promise<boolean> {
  const result = await pool.query(
    `DELETE FROM public.campaign_node_edges WHERE id = $1 AND organization_id = $2`,
    [id, orgId]
  )
  return (result.rowCount ?? 0) > 0
}

// ============================================================
// Condition CRUD
// ============================================================

export async function findConditionsByNodeId(nodeId: string, orgId: string): Promise<CampaignNodeCondition[]> {
  const result = await pool.query<CampaignNodeConditionRow>(
    `SELECT * FROM public.campaign_node_conditions
     WHERE node_id = $1 AND organization_id = $2
     ORDER BY sort_order ASC`,
    [nodeId, orgId]
  )
  return result.rows.map(mapConditionRow)
}

export async function insertCondition(data: {
  nodeId: string
  organizationId: string
  conditionType: string
  field: string
  operator: string
  value: string
  sortOrder?: number
  metadata?: Record<string, unknown>
}): Promise<CampaignNodeCondition> {
  const result = await pool.query<CampaignNodeConditionRow>(
    `INSERT INTO public.campaign_node_conditions
      (node_id, organization_id, condition_type, field, operator, value, sort_order, metadata)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     RETURNING *`,
    [
      data.nodeId,
      data.organizationId,
      data.conditionType,
      data.field,
      data.operator,
      data.value,
      data.sortOrder ?? 0,
      JSON.stringify(data.metadata ?? {}),
    ]
  )
  return mapConditionRow(result.rows[0])
}

export async function deleteConditionsByNodeId(nodeId: string, orgId: string): Promise<boolean> {
  const result = await pool.query(
    `DELETE FROM public.campaign_node_conditions WHERE node_id = $1 AND organization_id = $2`,
    [nodeId, orgId]
  )
  return (result.rowCount ?? 0) > 0
}
