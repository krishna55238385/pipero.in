import pool from '@/lib/db'
import type { CampaignStatistics } from '@/types/campaign'

// ============================================================
// Row Types
// ============================================================

type CampaignStatisticsRow = {
  id: string
  campaign_id: string
  organization_id: string
  date: string
  sent: number
  delivered: number
  opened: number
  clicked: number
  replied: number
  bounced: number
  unsubscribed: number
  complaints: number
  metadata: Record<string, unknown>
  created_at: string
  updated_at: string
}

// ============================================================
// Mappers
// ============================================================

function mapRow(row: CampaignStatisticsRow): CampaignStatistics {
  return {
    id: row.id,
    campaignId: row.campaign_id,
    organizationId: row.organization_id,
    date: row.date,
    sent: row.sent,
    delivered: row.delivered,
    opened: row.opened,
    clicked: row.clicked,
    replied: row.replied,
    bounced: row.bounced,
    unsubscribed: row.unsubscribed,
    complaints: row.complaints,
    metadata: row.metadata || {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

// ============================================================
// CRUD
// ============================================================

export async function findStatisticsByCampaignId(
  campaignId: string,
  orgId: string
): Promise<CampaignStatistics[]> {
  const result = await pool.query<CampaignStatisticsRow>(
    `SELECT * FROM public.campaign_statistics
     WHERE campaign_id = $1 AND organization_id = $2
     ORDER BY date DESC`,
    [campaignId, orgId]
  )
  return result.rows.map(mapRow)
}

export async function findStatisticsByDateRange(
  campaignId: string,
  orgId: string,
  from: string,
  to: string
): Promise<CampaignStatistics[]> {
  const result = await pool.query<CampaignStatisticsRow>(
    `SELECT * FROM public.campaign_statistics
     WHERE campaign_id = $1 AND organization_id = $2 AND date >= $3 AND date <= $4
     ORDER BY date ASC`,
    [campaignId, orgId, from, to]
  )
  return result.rows.map(mapRow)
}

export async function upsertStatistics(
  campaignId: string,
  orgId: string,
  date: string,
  data: {
    sent?: number
    delivered?: number
    opened?: number
    clicked?: number
    replied?: number
    bounced?: number
    unsubscribed?: number
    complaints?: number
    metadata?: Record<string, unknown>
  }
): Promise<CampaignStatistics> {
  const result = await pool.query<CampaignStatisticsRow>(
    `INSERT INTO public.campaign_statistics
      (campaign_id, organization_id, date, sent, delivered, opened, clicked,
       replied, bounced, unsubscribed, complaints, metadata)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     ON CONFLICT (campaign_id, date) DO UPDATE SET
       sent = EXCLUDED.sent,
       delivered = EXCLUDED.delivered,
       opened = EXCLUDED.opened,
       clicked = EXCLUDED.clicked,
       replied = EXCLUDED.replied,
       bounced = EXCLUDED.bounced,
       unsubscribed = EXCLUDED.unsubscribed,
       complaints = EXCLUDED.complaints,
       metadata = EXCLUDED.metadata,
       updated_at = NOW()
     RETURNING *`,
    [
      campaignId,
      orgId,
      date,
      data.sent ?? 0,
      data.delivered ?? 0,
      data.opened ?? 0,
      data.clicked ?? 0,
      data.replied ?? 0,
      data.bounced ?? 0,
      data.unsubscribed ?? 0,
      data.complaints ?? 0,
      JSON.stringify(data.metadata ?? {}),
    ]
  )
  return mapRow(result.rows[0])
}

export async function getAggregatedStats(
  campaignId: string,
  orgId: string
): Promise<{
  totalSent: number
  totalDelivered: number
  totalOpened: number
  totalClicked: number
  totalReplied: number
  totalBounced: number
  totalUnsubscribed: number
}> {
  const result = await pool.query(
    `SELECT
       COALESCE(SUM(sent), 0)::int AS total_sent,
       COALESCE(SUM(delivered), 0)::int AS total_delivered,
       COALESCE(SUM(opened), 0)::int AS total_opened,
       COALESCE(SUM(clicked), 0)::int AS total_clicked,
       COALESCE(SUM(replied), 0)::int AS total_replied,
       COALESCE(SUM(bounced), 0)::int AS total_bounced,
       COALESCE(SUM(unsubscribed), 0)::int AS total_unsubscribed
     FROM public.campaign_statistics
     WHERE campaign_id = $1 AND organization_id = $2`,
    [campaignId, orgId]
  )
  const row = result.rows[0]
  return {
    totalSent: row?.total_sent ?? 0,
    totalDelivered: row?.total_delivered ?? 0,
    totalOpened: row?.total_opened ?? 0,
    totalClicked: row?.total_clicked ?? 0,
    totalReplied: row?.total_replied ?? 0,
    totalBounced: row?.total_bounced ?? 0,
    totalUnsubscribed: row?.total_unsubscribed ?? 0,
  }
}
