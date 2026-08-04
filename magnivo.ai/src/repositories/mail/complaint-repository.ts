import pool from '@/lib/db'
import type { ComplaintRecord, ComplaintStatus, ComplaintDashboardStats } from '@/types/deliverability'

type ComplaintRecordRow = {
  id: string
  organization_id: string
  domain_id: string
  mailbox_id: string | null
  campaign_id: string | null
  complaint_type: string
  source: string
  status: ComplaintStatus
  auto_paused_mailbox: boolean
  notified_workspace: boolean
  resolved_at: string | null
  resolved_by: string | null
  metadata: Record<string, unknown>
  created_at: string
  updated_at: string
}

function mapComplaintRow(row: ComplaintRecordRow): ComplaintRecord {
  return {
    id: row.id,
    organizationId: row.organization_id,
    domainId: row.domain_id,
    mailboxId: row.mailbox_id,
    campaignId: row.campaign_id,
    complaintType: row.complaint_type,
    source: row.source,
    status: row.status,
    autoPausedMailbox: row.auto_paused_mailbox,
    notifiedWorkspace: row.notified_workspace,
    resolvedAt: row.resolved_at,
    resolvedBy: row.resolved_by,
    metadata: row.metadata || {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export async function findComplaintsByOrg(orgId: string, limit: number = 50): Promise<ComplaintRecord[]> {
  const result = await pool.query<ComplaintRecordRow>(
    `SELECT * FROM public.mail_complaint_records
     WHERE organization_id = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [orgId, limit]
  )
  return result.rows.map(mapComplaintRow)
}

export async function findActiveComplaints(orgId: string): Promise<ComplaintRecord[]> {
  const result = await pool.query<ComplaintRecordRow>(
    `SELECT * FROM public.mail_complaint_records
     WHERE organization_id = $1 AND status IN ('new', 'investigating')
     ORDER BY created_at DESC`,
    [orgId]
  )
  return result.rows.map(mapComplaintRow)
}

export async function findComplaintById(id: string, orgId: string): Promise<ComplaintRecord | null> {
  const result = await pool.query<ComplaintRecordRow>(
    `SELECT * FROM public.mail_complaint_records
     WHERE id = $1 AND organization_id = $2`,
    [id, orgId]
  )
  return result.rows[0] ? mapComplaintRow(result.rows[0]) : null
}

export async function insertComplaint(data: {
  organizationId: string
  domainId: string
  mailboxId?: string
  campaignId?: string
  complaintType: string
  source: string
  autoPausedMailbox?: boolean
  notifiedWorkspace?: boolean
}): Promise<ComplaintRecord> {
  const result = await pool.query<ComplaintRecordRow>(
    `INSERT INTO public.mail_complaint_records
      (organization_id, domain_id, mailbox_id, campaign_id, complaint_type, source, auto_paused_mailbox, notified_workspace)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [data.organizationId, data.domainId, data.mailboxId ?? null, data.campaignId ?? null, data.complaintType, data.source, data.autoPausedMailbox ?? false, data.notifiedWorkspace ?? false]
  )
  return mapComplaintRow(result.rows[0])
}

export async function updateComplaint(id: string, orgId: string, data: {
  status?: ComplaintStatus
  resolvedAt?: string
  resolvedBy?: string
}): Promise<ComplaintRecord | null> {
  const setClauses: string[] = []
  const values: (string | number | boolean | null)[] = []
  let paramIndex = 1

  for (const [key, value] of Object.entries(data)) {
    if (value !== undefined) {
      const dbKey = key.replace(/([A-Z])/g, '_$1').toLowerCase()
      setClauses.push(`${dbKey} = $${paramIndex}`)
      values.push(value as string | number | boolean | null)
      paramIndex++
    }
  }

  if (setClauses.length === 0) return null

  setClauses.push(`updated_at = NOW()`)
  values.push(id, orgId)

  const result = await pool.query<ComplaintRecordRow>(
    `UPDATE public.mail_complaint_records
     SET ${setClauses.join(', ')}
     WHERE id = $${paramIndex} AND organization_id = $${paramIndex + 1}
     RETURNING *`,
    values
  )
  return result.rows[0] ? mapComplaintRow(result.rows[0]) : null
}

export async function getComplaintDashboardStats(orgId: string): Promise<ComplaintDashboardStats> {
  const totalResult = await pool.query(
    `SELECT COUNT(*)::int AS count FROM public.mail_complaint_records WHERE organization_id = $1`,
    [orgId]
  )
  const activeResult = await pool.query(
    `SELECT COUNT(*)::int AS count FROM public.mail_complaint_records
     WHERE organization_id = $1 AND status IN ('new', 'investigating')`,
    [orgId]
  )
  const resolvedResult = await pool.query(
    `SELECT COUNT(*)::int AS count FROM public.mail_complaint_records
     WHERE organization_id = $1 AND status = 'resolved'`,
    [orgId]
  )
  const pausedResult = await pool.query(
    `SELECT COUNT(*)::int AS count FROM public.mail_complaint_records
     WHERE organization_id = $1 AND auto_paused_mailbox = TRUE AND status != 'resolved'`,
    [orgId]
  )
  const recentResult = await pool.query<ComplaintRecordRow>(
    `SELECT * FROM public.mail_complaint_records
     WHERE organization_id = $1
     ORDER BY created_at DESC
     LIMIT 10`,
    [orgId]
  )

  return {
    totalComplaints: totalResult.rows[0]?.count ?? 0,
    activeComplaints: activeResult.rows[0]?.count ?? 0,
    resolvedComplaints: resolvedResult.rows[0]?.count ?? 0,
    autoPausedMailboxes: pausedResult.rows[0]?.count ?? 0,
    recentComplaints: recentResult.rows.map(mapComplaintRow),
  }
}
