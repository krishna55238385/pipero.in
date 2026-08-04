import pool from '@/lib/db'
import type { CampaignHistory } from '@/types/campaign'

// ============================================================
// Row Types
// ============================================================

type CampaignHistoryRow = {
  id: string
  campaign_id: string
  organization_id: string
  action: string
  actor_user_id: string | null
  actor_email: string | null
  previous_status: string | null
  new_status: string | null
  change_summary: string
  previous_data: Record<string, unknown> | null
  new_data: Record<string, unknown> | null
  metadata: Record<string, unknown>
  created_at: string
}

// ============================================================
// Mappers
// ============================================================

function mapRow(row: CampaignHistoryRow): CampaignHistory {
  return {
    id: row.id,
    campaignId: row.campaign_id,
    organizationId: row.organization_id,
    action: row.action,
    actorUserId: row.actor_user_id,
    actorEmail: row.actor_email,
    previousStatus: row.previous_status,
    newStatus: row.new_status,
    changeSummary: row.change_summary,
    previousData: row.previous_data,
    newData: row.new_data,
    metadata: row.metadata || {},
    createdAt: row.created_at,
  }
}

// ============================================================
// CRUD
// ============================================================

export async function findHistoryByCampaignId(
  campaignId: string,
  orgId: string,
  options?: { limit?: number; offset?: number }
): Promise<CampaignHistory[]> {
  const limit = options?.limit ?? 50
  const offset = options?.offset ?? 0

  const result = await pool.query<CampaignHistoryRow>(
    `SELECT * FROM public.campaign_history
     WHERE campaign_id = $1 AND organization_id = $2
     ORDER BY created_at DESC
     LIMIT $3 OFFSET $4`,
    [campaignId, orgId, limit, offset]
  )
  return result.rows.map(mapRow)
}

export async function insertHistory(data: {
  campaignId: string
  organizationId: string
  action: string
  actorUserId?: string | null
  actorEmail?: string | null
  previousStatus?: string | null
  newStatus?: string | null
  changeSummary?: string
  previousData?: Record<string, unknown> | null
  newData?: Record<string, unknown> | null
  metadata?: Record<string, unknown>
}): Promise<CampaignHistory> {
  const result = await pool.query<CampaignHistoryRow>(
    `INSERT INTO public.campaign_history
      (campaign_id, organization_id, action, actor_user_id, actor_email,
       previous_status, new_status, change_summary, previous_data, new_data, metadata)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     RETURNING *`,
    [
      data.campaignId,
      data.organizationId,
      data.action,
      data.actorUserId ?? null,
      data.actorEmail ?? null,
      data.previousStatus ?? null,
      data.newStatus ?? null,
      data.changeSummary ?? '',
      data.previousData ? JSON.stringify(data.previousData) : null,
      data.newData ? JSON.stringify(data.newData) : null,
      JSON.stringify(data.metadata ?? {}),
    ]
  )
  return mapRow(result.rows[0])
}
