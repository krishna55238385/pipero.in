import pool from '@/lib/db'
import type { CampaignEvent } from '@/types/campaign'

// ============================================================
// Row Types
// ============================================================

type CampaignEventRow = {
  id: string
  campaign_id: string
  organization_id: string
  event_type: string
  actor_user_id: string | null
  actor_email: string | null
  previous_status: string | null
  new_status: string | null
  message: string
  metadata: Record<string, unknown>
  created_at: string
}

// ============================================================
// Mappers
// ============================================================

function mapRow(row: CampaignEventRow): CampaignEvent {
  return {
    id: row.id,
    campaignId: row.campaign_id,
    organizationId: row.organization_id,
    eventType: row.event_type,
    actorUserId: row.actor_user_id,
    actorEmail: row.actor_email,
    previousStatus: row.previous_status,
    newStatus: row.new_status,
    message: row.message,
    metadata: row.metadata || {},
    createdAt: row.created_at,
  }
}

// ============================================================
// CRUD
// ============================================================

export async function insertEvent(data: {
  campaignId: string
  organizationId: string
  eventType: string
  actorUserId?: string | null
  actorEmail?: string | null
  previousStatus?: string | null
  newStatus?: string | null
  message?: string
  metadata?: Record<string, unknown>
}): Promise<CampaignEvent> {
  const result = await pool.query<CampaignEventRow>(
    `INSERT INTO public.campaign_events
      (campaign_id, organization_id, event_type, actor_user_id, actor_email,
       previous_status, new_status, message, metadata)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     RETURNING *`,
    [
      data.campaignId,
      data.organizationId,
      data.eventType,
      data.actorUserId ?? null,
      data.actorEmail ?? null,
      data.previousStatus ?? null,
      data.newStatus ?? null,
      data.message ?? '',
      JSON.stringify(data.metadata ?? {}),
    ]
  )
  return mapRow(result.rows[0])
}

export async function findEventsByCampaignId(
  campaignId: string,
  orgId: string,
  options?: { limit?: number; offset?: number }
): Promise<CampaignEvent[]> {
  const limit = options?.limit ?? 50
  const offset = options?.offset ?? 0

  const result = await pool.query<CampaignEventRow>(
    `SELECT * FROM public.campaign_events
     WHERE campaign_id = $1 AND organization_id = $2
     ORDER BY created_at DESC
     LIMIT $3 OFFSET $4`,
    [campaignId, orgId, limit, offset]
  )
  return result.rows.map(mapRow)
}
