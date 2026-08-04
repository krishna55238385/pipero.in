import pool from '@/lib/db'
import type { CampaignVersion } from '@/types/campaign'

// ============================================================
// Row Types
// ============================================================

type CampaignVersionRow = {
  id: string
  campaign_id: string
  organization_id: string
  version_number: number
  snapshot: Record<string, unknown>
  change_summary: string
  actor_user_id: string | null
  actor_email: string | null
  metadata: Record<string, unknown>
  created_at: string
}

// ============================================================
// Mappers
// ============================================================

function mapRow(row: CampaignVersionRow): CampaignVersion {
  return {
    id: row.id,
    campaignId: row.campaign_id,
    organizationId: row.organization_id,
    versionNumber: row.version_number,
    snapshot: row.snapshot || {},
    changeSummary: row.change_summary,
    actorUserId: row.actor_user_id,
    actorEmail: row.actor_email,
    metadata: row.metadata || {},
    createdAt: row.created_at,
  }
}

// ============================================================
// CRUD
// ============================================================

export async function findVersionsByCampaignId(campaignId: string, orgId: string): Promise<CampaignVersion[]> {
  const result = await pool.query<CampaignVersionRow>(
    `SELECT * FROM public.campaign_versions
     WHERE campaign_id = $1 AND organization_id = $2
     ORDER BY version_number DESC`,
    [campaignId, orgId]
  )
  return result.rows.map(mapRow)
}

export async function findVersionByNumber(
  campaignId: string,
  versionNumber: number,
  orgId: string
): Promise<CampaignVersion | null> {
  const result = await pool.query<CampaignVersionRow>(
    `SELECT * FROM public.campaign_versions
     WHERE campaign_id = $1 AND version_number = $2 AND organization_id = $3`,
    [campaignId, versionNumber, orgId]
  )
  return result.rows[0] ? mapRow(result.rows[0]) : null
}

export async function insertVersion(data: {
  campaignId: string
  organizationId: string
  versionNumber: number
  snapshot: Record<string, unknown>
  changeSummary: string
  actorUserId?: string | null
  actorEmail?: string | null
  metadata?: Record<string, unknown>
}): Promise<CampaignVersion> {
  const result = await pool.query<CampaignVersionRow>(
    `INSERT INTO public.campaign_versions
      (campaign_id, organization_id, version_number, snapshot, change_summary,
       actor_user_id, actor_email, metadata)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     RETURNING *`,
    [
      data.campaignId,
      data.organizationId,
      data.versionNumber,
      JSON.stringify(data.snapshot),
      data.changeSummary,
      data.actorUserId ?? null,
      data.actorEmail ?? null,
      JSON.stringify(data.metadata ?? {}),
    ]
  )
  return mapRow(result.rows[0])
}
