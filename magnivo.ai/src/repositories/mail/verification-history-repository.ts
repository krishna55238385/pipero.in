import pool from '@/lib/db'
import type { VerificationHistoryEntry, VerificationSource, VerificationResult } from '@/types/deliverability'

type HistoryRow = {
  id: string
  domain_id: string
  organization_id: string
  record_type: string
  previous_value: string | null
  new_value: string | null
  previous_status: string | null
  new_status: string | null
  action: string
  actor_user_id: string | null
  actor_email: string | null
  verified_by: VerificationSource
  result: VerificationResult
  error_message: string | null
  duration_ms: number | null
  metadata: Record<string, unknown>
  created_at: string
}

function mapHistoryRow(row: HistoryRow): VerificationHistoryEntry {
  return {
    id: row.id,
    domainId: row.domain_id,
    organizationId: row.organization_id,
    recordType: row.record_type,
    previousValue: row.previous_value,
    newValue: row.new_value,
    previousStatus: row.previous_status,
    newStatus: row.new_status,
    action: row.action,
    actorUserId: row.actor_user_id,
    actorEmail: row.actor_email,
    verifiedBy: row.verified_by,
    result: row.result,
    errorMessage: row.error_message,
    durationMs: row.duration_ms,
    metadata: row.metadata || {},
    createdAt: row.created_at,
  }
}

export async function insertVerificationHistory(data: {
  domainId: string
  organizationId: string
  recordType: string
  previousValue?: string | null
  newValue?: string | null
  previousStatus?: string | null
  newStatus?: string | null
  action: string
  actorUserId?: string | null
  actorEmail?: string | null
  verifiedBy: VerificationSource
  result: VerificationResult
  errorMessage?: string | null
  durationMs?: number | null
  metadata?: Record<string, unknown>
}): Promise<VerificationHistoryEntry> {
  const result = await pool.query<HistoryRow>(
    `INSERT INTO public.mail_verification_history
      (domain_id, organization_id, record_type, previous_value, new_value,
       previous_status, new_status, action, actor_user_id, actor_email,
       verified_by, result, error_message, duration_ms, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
     RETURNING *`,
    [
      data.domainId,
      data.organizationId,
      data.recordType,
      data.previousValue ?? null,
      data.newValue ?? null,
      data.previousStatus ?? null,
      data.newStatus ?? null,
      data.action,
      data.actorUserId ?? null,
      data.actorEmail ?? null,
      data.verifiedBy,
      data.result,
      data.errorMessage ?? null,
      data.durationMs ?? null,
      JSON.stringify(data.metadata ?? {}),
    ]
  )
  return mapHistoryRow(result.rows[0])
}

export async function findHistoryByDomain(
  domainId: string,
  limit: number = 50,
  offset: number = 0
): Promise<VerificationHistoryEntry[]> {
  const result = await pool.query<HistoryRow>(
    `SELECT * FROM public.mail_verification_history
     WHERE domain_id = $1
     ORDER BY created_at DESC
     LIMIT $2 OFFSET $3`,
    [domainId, limit, offset]
  )
  return result.rows.map(mapHistoryRow)
}

export async function findHistoryByOrg(
  orgId: string,
  limit: number = 100,
  offset: number = 0
): Promise<VerificationHistoryEntry[]> {
  const result = await pool.query<HistoryRow>(
    `SELECT * FROM public.mail_verification_history
     WHERE organization_id = $1
     ORDER BY created_at DESC
     LIMIT $2 OFFSET $3`,
    [orgId, limit, offset]
  )
  return result.rows.map(mapHistoryRow)
}

export async function countHistoryByDomain(domainId: string): Promise<number> {
  const result = await pool.query(
    `SELECT COUNT(*)::int AS count FROM public.mail_verification_history
     WHERE domain_id = $1`,
    [domainId]
  )
  return result.rows[0]?.count ?? 0
}

export async function getLatestVerificationByDomainAndType(
  domainId: string,
  recordType: string
): Promise<VerificationHistoryEntry | null> {
  const result = await pool.query<HistoryRow>(
    `SELECT * FROM public.mail_verification_history
     WHERE domain_id = $1 AND record_type = $2
     ORDER BY created_at DESC
     LIMIT 1`,
    [domainId, recordType]
  )
  return result.rows[0] ? mapHistoryRow(result.rows[0]) : null
}
