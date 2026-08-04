import pool from '@/lib/db'
import type { CampaignSequence, CampaignSequenceStep, SequenceStatus } from '@/types/campaign'

// ============================================================
// Row Types
// ============================================================

type CampaignSequenceRow = {
  id: string
  campaign_id: string
  organization_id: string
  name: string
  description: string
  status: string
  version: number
  metadata: Record<string, unknown>
  created_at: string
  updated_at: string
}

type CampaignSequenceStepRow = {
  id: string
  sequence_id: string
  organization_id: string
  step_number: number
  subject: string
  body_html: string
  body_text: string
  delay_days: number
  delay_hours: number
  condition_type: string | null
  condition_config: Record<string, unknown>
  metadata: Record<string, unknown>
  created_at: string
  updated_at: string
}

// ============================================================
// Mappers
// ============================================================

function mapSequenceRow(row: CampaignSequenceRow): CampaignSequence {
  return {
    id: row.id,
    campaignId: row.campaign_id,
    organizationId: row.organization_id,
    name: row.name,
    description: row.description,
    status: row.status as SequenceStatus,
    version: row.version,
    metadata: row.metadata || {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function mapStepRow(row: CampaignSequenceStepRow): CampaignSequenceStep {
  return {
    id: row.id,
    sequenceId: row.sequence_id,
    organizationId: row.organization_id,
    stepNumber: row.step_number,
    subject: row.subject,
    bodyHtml: row.body_html,
    bodyText: row.body_text,
    delayDays: row.delay_days,
    delayHours: row.delay_hours,
    conditionType: row.condition_type,
    conditionConfig: row.condition_config || {},
    metadata: row.metadata || {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

// ============================================================
// Sequence CRUD
// ============================================================

export async function findSequencesByCampaignId(campaignId: string, orgId: string): Promise<CampaignSequence[]> {
  const result = await pool.query<CampaignSequenceRow>(
    `SELECT * FROM public.campaign_sequences
     WHERE campaign_id = $1 AND organization_id = $2
     ORDER BY created_at ASC`,
    [campaignId, orgId]
  )
  return result.rows.map(mapSequenceRow)
}

export async function findSequencesByOrgId(orgId: string): Promise<CampaignSequence[]> {
  const result = await pool.query<CampaignSequenceRow>(
    `SELECT * FROM public.campaign_sequences
     WHERE organization_id = $1
     ORDER BY updated_at DESC
     LIMIT 500`,
    [orgId]
  )
  return result.rows.map(mapSequenceRow)
}

export async function findSequenceById(id: string, orgId: string): Promise<CampaignSequence | null> {
  const result = await pool.query<CampaignSequenceRow>(
    `SELECT * FROM public.campaign_sequences WHERE id = $1 AND organization_id = $2`,
    [id, orgId]
  )
  return result.rows[0] ? mapSequenceRow(result.rows[0]) : null
}

export async function insertSequence(data: {
  campaignId: string
  organizationId: string
  name: string
  description?: string
  status?: string
  metadata?: Record<string, unknown>
}): Promise<CampaignSequence> {
  const result = await pool.query<CampaignSequenceRow>(
    `INSERT INTO public.campaign_sequences
      (campaign_id, organization_id, name, description, status, metadata)
     VALUES ($1,$2,$3,$4,$5,$6)
     RETURNING *`,
    [
      data.campaignId,
      data.organizationId,
      data.name,
      data.description ?? '',
      data.status ?? 'draft',
      JSON.stringify(data.metadata ?? {}),
    ]
  )
  return mapSequenceRow(result.rows[0])
}

export async function updateSequence(
  id: string,
  orgId: string,
  data: Record<string, unknown>
): Promise<CampaignSequence | null> {
  const fieldMap: Record<string, string> = {
    name: 'name', description: 'description', status: 'status', metadata: 'metadata',
  }

  const setClauses: string[] = []
  const values: unknown[] = []
  let paramIndex = 1

  for (const [key, dbCol] of Object.entries(fieldMap)) {
    const val = data[key]
    if (val !== undefined) {
      setClauses.push(`${dbCol} = $${paramIndex++}`)
      values.push(key === 'metadata' ? JSON.stringify(val) : val)
    }
  }

  setClauses.push(`version = version + 1`)
  setClauses.push(`updated_at = NOW()`)

  values.push(id, orgId)

  const result = await pool.query<CampaignSequenceRow>(
    `UPDATE public.campaign_sequences SET ${setClauses.join(', ')}
     WHERE id = $${paramIndex} AND organization_id = $${paramIndex + 1}
     RETURNING *`,
    values
  )
  return result.rows[0] ? mapSequenceRow(result.rows[0]) : null
}

export async function deleteSequence(id: string, orgId: string): Promise<boolean> {
  const result = await pool.query(
    `DELETE FROM public.campaign_sequences WHERE id = $1 AND organization_id = $2`,
    [id, orgId]
  )
  return (result.rowCount ?? 0) > 0
}

// ============================================================
// Step CRUD
// ============================================================

export async function findStepsBySequenceId(sequenceId: string, orgId: string): Promise<CampaignSequenceStep[]> {
  const result = await pool.query<CampaignSequenceStepRow>(
    `SELECT * FROM public.campaign_sequence_steps
     WHERE sequence_id = $1 AND organization_id = $2
     ORDER BY step_number ASC`,
    [sequenceId, orgId]
  )
  return result.rows.map(mapStepRow)
}

export async function insertStep(data: {
  sequenceId: string
  organizationId: string
  stepNumber: number
  subject?: string
  bodyHtml?: string
  bodyText?: string
  delayDays?: number
  delayHours?: number
  conditionType?: string | null
  conditionConfig?: Record<string, unknown>
  metadata?: Record<string, unknown>
}): Promise<CampaignSequenceStep> {
  const result = await pool.query<CampaignSequenceStepRow>(
    `INSERT INTO public.campaign_sequence_steps
      (sequence_id, organization_id, step_number, subject, body_html, body_text,
       delay_days, delay_hours, condition_type, condition_config, metadata)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     RETURNING *`,
    [
      data.sequenceId,
      data.organizationId,
      data.stepNumber,
      data.subject ?? '',
      data.bodyHtml ?? '',
      data.bodyText ?? '',
      data.delayDays ?? 0,
      data.delayHours ?? 0,
      data.conditionType ?? null,
      JSON.stringify(data.conditionConfig ?? {}),
      JSON.stringify(data.metadata ?? {}),
    ]
  )
  return mapStepRow(result.rows[0])
}

export async function updateStep(
  id: string,
  orgId: string,
  data: Record<string, unknown>
): Promise<CampaignSequenceStep | null> {
  const fieldMap: Record<string, string> = {
    stepNumber: 'step_number', subject: 'subject',
    bodyHtml: 'body_html', bodyText: 'body_text',
    delayDays: 'delay_days', delayHours: 'delay_hours',
    conditionType: 'condition_type', conditionConfig: 'condition_config',
    metadata: 'metadata',
  }

  const setClauses: string[] = []
  const values: unknown[] = []
  let paramIndex = 1

  for (const [key, dbCol] of Object.entries(fieldMap)) {
    const val = data[key]
    if (val !== undefined) {
      setClauses.push(`${dbCol} = $${paramIndex++}`)
      values.push(
        key === 'metadata' || key === 'conditionConfig' ? JSON.stringify(val) : val
      )
    }
  }

  if (setClauses.length === 0) {
    return null
  }

  setClauses.push(`updated_at = NOW()`)
  values.push(id, orgId)

  const result = await pool.query<CampaignSequenceStepRow>(
    `UPDATE public.campaign_sequence_steps SET ${setClauses.join(', ')}
     WHERE id = $${paramIndex} AND organization_id = $${paramIndex + 1}
     RETURNING *`,
    values
  )
  return result.rows[0] ? mapStepRow(result.rows[0]) : null
}

export async function deleteStep(id: string, orgId: string): Promise<boolean> {
  const result = await pool.query(
    `DELETE FROM public.campaign_sequence_steps WHERE id = $1 AND organization_id = $2`,
    [id, orgId]
  )
  return (result.rowCount ?? 0) > 0
}
